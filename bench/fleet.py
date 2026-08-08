#!/usr/bin/env python3
"""
Creates and destroys the throwaway workspaces and API keys that scenario 4b needs, so a
multi-workspace run leaves nothing behind.

4a drives N writers through one workspace and one key, which keeps the auth caches warm
and isolates plot serialization. 4b gives every writer its own workspace and its own key,
so each one pays a cold gateway resolve — the synchronous call on Tornado's event loop
that CONCERNS.md §1c flags. The gap between the two runs is the cost of the auth path.

  python fleet.py setup --count 50 > fleet.json
  python fleet.py teardown --manifest fleet.json
  python fleet.py teardown --prefix bench- --discover

`setup` writes the manifest to stdout, including on partial failure, so a run that dies
halfway can still be cleaned up. `--discover` ignores the manifest entirely and finds
everything matching the slug prefix, for when the manifest is lost.

Credentials come from BENCH_EMAIL and BENCH_PASSWORD. Workspace creation needs a user
session; an API key cannot mint other API keys.
"""

import argparse
import json
import os
import sys

import requests

GATEWAY = os.environ.get("BENCH_GATEWAY", "http://proxy:80")
API = GATEWAY.rstrip("/") + "/api/v1"
TIMEOUT = 20


def bearer(token):
    return {"Authorization": "Bearer %s" % token}


def login():
    email = os.environ.get("BENCH_EMAIL", "")
    password = os.environ.get("BENCH_PASSWORD", "")
    if not email or not password:
        sys.exit("fleet: BENCH_EMAIL and BENCH_PASSWORD must be set")

    resp = requests.post(
        API + "/auth/login",
        data={"username": email, "password": password},
        timeout=TIMEOUT,
    )
    if resp.status_code != 200:
        sys.exit("fleet: login failed with %d: %s" % (resp.status_code, resp.text[:200]))
    return resp.json()["access_token"]


def create_one(token, slug):
    ws = requests.post(
        API + "/workspaces",
        json={"name": slug, "slug": slug},
        headers=bearer(token),
        timeout=TIMEOUT,
    )
    if ws.status_code == 400 and "already exists" in ws.text:
        raise RuntimeError(
            "workspace %r already exists. Tear down the previous fleet first: "
            "fleet.py teardown --prefix <prefix> --discover" % slug
        )
    if ws.status_code != 201:
        raise RuntimeError("create workspace %r -> %d: %s" % (slug, ws.status_code, ws.text[:200]))
    workspace_id = ws.json()["id"]

    key = requests.post(
        API + "/keys",
        json={"name": slug, "scope": "workspace", "workspace_ids": [workspace_id]},
        headers=bearer(token),
        timeout=TIMEOUT,
    )
    if key.status_code != 201:
        raise RuntimeError("create key for %r -> %d: %s" % (slug, key.status_code, key.text[:200]))
    body = key.json()

    return {
        "slug": slug,
        "workspace_id": workspace_id,
        "key_id": body["id"],
        "key": body["raw_key"],
    }


def setup(args):
    token = login()
    fleet = []
    failure = None
    for i in range(args.count):
        try:
            fleet.append(create_one(token, "%s%d" % (args.prefix, i)))
        except (RuntimeError, requests.RequestException) as exc:
            failure = exc
            break

    json.dump(fleet, sys.stdout, indent=2)
    sys.stdout.write("\n")

    if failure is not None:
        sys.stderr.write(
            "fleet: setup failed after %d of %d (%s).\nThe manifest above covers what was "
            "created — tear it down before retrying.\n" % (len(fleet), args.count, failure)
        )
        return 1

    sys.stderr.write("fleet: created %d workspaces and keys\n" % len(fleet))
    return 0


def discover(token, prefix):
    workspaces = requests.get(API + "/workspaces", headers=bearer(token), timeout=TIMEOUT)
    if workspaces.status_code != 200:
        sys.exit("fleet: listing workspaces -> %d" % workspaces.status_code)
    keys = requests.get(API + "/keys", headers=bearer(token), timeout=TIMEOUT)
    if keys.status_code != 200:
        sys.exit("fleet: listing keys -> %d" % keys.status_code)

    by_slug = {}
    for workspace in workspaces.json():
        if workspace["slug"].startswith(prefix):
            by_slug[workspace["slug"]] = {
                "slug": workspace["slug"],
                "workspace_id": workspace["id"],
                "key_id": None,
            }

    for key in keys.json():
        for summary in key.get("workspaces", []):
            if summary["slug"] in by_slug:
                by_slug[summary["slug"]]["key_id"] = key["id"]

    return list(by_slug.values())


def teardown(args):
    token = login()

    if args.discover:
        fleet = discover(token, args.prefix)
    elif args.manifest:
        with open(args.manifest) as fh:
            fleet = json.load(fh)
    else:
        fleet = json.load(sys.stdin)

    if not fleet:
        sys.stderr.write("fleet: nothing to tear down\n")
        return 0

    failures = 0
    for entry in fleet:
        if entry.get("key_id"):
            resp = requests.delete(
                API + "/keys/%s" % entry["key_id"], headers=bearer(token), timeout=TIMEOUT
            )
            if resp.status_code not in (204, 404):
                failures += 1
                sys.stderr.write(
                    "fleet: revoking key for %s -> %d\n" % (entry["slug"], resp.status_code)
                )

        resp = requests.delete(
            API + "/workspaces/%s" % entry["workspace_id"], headers=bearer(token), timeout=TIMEOUT
        )
        if resp.status_code not in (204, 404):
            failures += 1
            sys.stderr.write(
                "fleet: deleting workspace %s -> %d: %s\n"
                % (entry["slug"], resp.status_code, resp.text[:200])
            )

    sys.stderr.write(
        "fleet: tore down %d of %d entries\n" % (len(fleet) - failures, len(fleet))
    )
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    setup_parser = sub.add_parser("setup")
    setup_parser.add_argument("--count", type=int, required=True)
    setup_parser.add_argument("--prefix", default="bench-")
    setup_parser.set_defaults(func=setup)

    teardown_parser = sub.add_parser("teardown")
    teardown_parser.add_argument("--manifest", default="")
    teardown_parser.add_argument("--prefix", default="bench-")
    teardown_parser.add_argument("--discover", action="store_true")
    teardown_parser.set_defaults(func=teardown)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
