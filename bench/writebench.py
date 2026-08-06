#!/usr/bin/env python3
"""
Scenario 4 — N training scripts writing plots concurrently.

Drives the live stack with the visdom python client, which is what a user's training
script actually runs. Runs inside the bench container so its CPU stays off the visdom
container's docker stats line; cpu_sample.py measures the server from the host.

Two variants:

  4a (default)   every writer shares one workspace and one key. The auth caches stay warm
                 after the first request, which isolates plot serialization CPU.
  4b (BENCH_FLEET) every writer gets its own workspace and key from a fleet.py manifest,
                 so each pays a cold gateway resolve. 4a minus 4b is the auth path's cost.

Emits one CSV row on stdout and a human-readable summary on stderr, so sweep.sh can
append the row to a results file while you still watch the run.

Configuration is entirely environment-driven:

  VISDOM_API_KEY   required for 4a; ignored when BENCH_FLEET is set
  BENCH_FLEET      path to a fleet.py manifest; switches the run to 4b
  BENCH_WORKSPACE  workspace slug for 4a (default: loadtest)
  BENCH_CONC       concurrent writers (default: 10)
  BENCH_OPS        writes per writer (default: 50)
  BENCH_KIND       line | image (default: line)
  BENCH_MODE       proc | thread (default: proc)
  BENCH_TAG        env name prefix (default: load)
  BENCH_SMOKE      1 to run a 1x2 plumbing check and exit
"""

import json
import os
import sys
import time

import numpy as np
import requests
import visdom

SERVER = os.environ.get("BENCH_SERVER", "http://proxy")
PORT = int(os.environ.get("BENCH_PORT", "80"))
BASE_URL = os.environ.get("BENCH_BASE_URL", "/vis")

CSV_HEADER = (
    "ts,scenario,kind,mode,conc,n_ops,elapsed_s,throughput,"
    "p50_ms,p95_ms,p99_ms,max_ms,errors"
)


def base():
    return "%s:%d%s" % (SERVER, PORT, BASE_URL)


def config():
    smoke = os.environ.get("BENCH_SMOKE", "") == "1"
    conc = 1 if smoke else int(os.environ.get("BENCH_CONC", "10"))
    fleet_path = os.environ.get("BENCH_FLEET", "")

    if fleet_path:
        with open(fleet_path) as fh:
            fleet = json.load(fh)
        if len(fleet) < conc:
            sys.exit(
                "writebench: fleet manifest has %d entries but BENCH_CONC is %d. Create the "
                "fleet with --count at least as large as the highest sweep level."
                % (len(fleet), conc)
            )
        targets = [(entry["key"], entry["slug"]) for entry in fleet[:conc]]
        scenario = "4b"
    else:
        key = os.environ.get("VISDOM_API_KEY", "")
        if not key:
            sys.exit("writebench: VISDOM_API_KEY is not set")
        workspace = os.environ.get("BENCH_WORKSPACE", "loadtest")
        targets = [(key, workspace)] * conc
        scenario = "4a"

    return {
        "targets": targets,
        "scenario": scenario,
        "conc": conc,
        "ops": 2 if smoke else int(os.environ.get("BENCH_OPS", "50")),
        "kind": os.environ.get("BENCH_KIND", "line"),
        "mode": os.environ.get("BENCH_MODE", "proc"),
        "tag": os.environ.get("BENCH_TAG", "load"),
        "smoke": smoke,
    }


def headers(target):
    return {"X-API-KEY": target[0], "X-Visdom-Workspace": target[1]}


class CheckedVisdom(visdom.Visdom):
    """The stock client's _handle_post returns r.text without looking at the status, and
    raise_exceptions only covers transport errors, so an HTTP 401/403/500 is indexed as a
    successful write. That would let a run of denials report throughput — the failure
    BENCHMARKING.md trap 1 describes. Raise on any non-200 instead."""

    def _handle_post(self, url, data=None):
        response = self.session.post(url, data=data or {}, timeout=(20, None))
        if response.status_code != 200:
            raise RuntimeError(
                "POST %s -> %d: %s" % (url, response.status_code, response.text[:300])
            )
        return response.text


def client_for(target):
    key, workspace = target
    return CheckedVisdom(
        server=SERVER,
        port=PORT,
        base_url=BASE_URL,
        api_key=key,
        workspace=workspace,
        use_incoming_socket=False,
        raise_exceptions=True,
    )


def probe(target, path):
    url = base() + path
    try:
        return requests.get(url, headers=headers(target), timeout=10), url
    except requests.RequestException as exc:
        sys.exit("writebench: request to %s failed: %s" % (url, exc))


def checkpoints(cfg):
    if len(cfg["targets"]) == 1:
        return [0]
    return sorted({0, len(cfg["targets"]) - 1})


def preflight(cfg):
    for index in checkpoints(cfg):
        target = cfg["targets"][index]
        resp, url = probe(target, "/")
        if resp.status_code != 200:
            sys.exit(
                "writebench: preflight to %s as workspace %r returned %d, not 200. A run of "
                "denials measures nothing — check the key and slug before measuring."
                % (url, target[1], resp.status_code)
            )


def verify_landed(cfg):
    for index in checkpoints(cfg):
        expected = "%s%d" % (cfg["tag"], index)
        try:
            envs = client_for(cfg["targets"][index]).get_env_list()
        except Exception as exc:
            sys.exit(
                "writebench: post-run env listing failed (%s: %s)" % (type(exc).__name__, exc)
            )
        if expected not in envs:
            target = cfg["targets"][index]
            sys.exit(
                "writebench: env %r is absent after the run; the server lists %r for "
                "workspace %r. A run that wrote nothing is not a data point."
                % (expected, sorted(envs)[:8], target[1])
            )


_worker_cfg = None


def _init(cfg):
    global _worker_cfg
    _worker_cfg = cfg


def _work(n):
    cfg = _worker_cfg
    client = client_for(cfg["targets"][n])
    env = "%s%d" % (cfg["tag"], n)
    win = "w%d" % n
    latencies = []
    for _ in range(cfg["ops"]):
        started = time.perf_counter()
        if cfg["kind"] == "image":
            client.image(np.random.rand(3, 256, 256), win=win, env=env)
        else:
            client.line(Y=np.random.rand(200), win=win, env=env)
        latencies.append(time.perf_counter() - started)
    return latencies


def run(cfg):
    if cfg["mode"] == "thread":
        from multiprocessing.pool import ThreadPool as Pool
    else:
        from multiprocessing import Pool

    started = time.perf_counter()
    with Pool(cfg["conc"], initializer=_init, initargs=(cfg,)) as pool:
        results = pool.map(_work, range(cfg["conc"]), chunksize=1)
    return time.perf_counter() - started, [x for r in results for x in r]


def percentile(sorted_values, fraction):
    if not sorted_values:
        return 0.0
    index = min(int(len(sorted_values) * fraction), len(sorted_values) - 1)
    return sorted_values[index] * 1000


def main():
    cfg = config()
    preflight(cfg)

    try:
        elapsed, latencies = run(cfg)
    except Exception as exc:
        sys.exit("writebench: aborted, a write failed (%s: %s)" % (type(exc).__name__, exc))

    verify_landed(cfg)

    if cfg["smoke"]:
        sys.stderr.write(
            "SMOKE OK (%s) — preflight, %d writes, and /env verification all passed\n"
            % (cfg["scenario"], len(latencies))
        )
        return

    latencies.sort()
    stats = (
        percentile(latencies, 0.50),
        percentile(latencies, 0.95),
        percentile(latencies, 0.99),
        percentile(latencies, 1.0),
    )

    row = "%d,%s,%s,%s,%d,%d,%.2f,%.1f,%.0f,%.0f,%.0f,%.0f,%d" % (
        time.time(),
        cfg["scenario"],
        cfg["kind"],
        cfg["mode"],
        cfg["conc"],
        len(latencies),
        elapsed,
        len(latencies) / elapsed,
        stats[0],
        stats[1],
        stats[2],
        stats[3],
        0,
    )

    if os.environ.get("BENCH_HEADER", "") == "1":
        sys.stdout.write(CSV_HEADER + "\n")
    sys.stdout.write(row + "\n")

    sys.stderr.write(
        "%s kind=%s mode=%s conc=%-3d writes=%-5d elapsed=%6.2fs  thr=%7.1f/s  "
        "p50=%5.0fms p95=%5.0fms p99=%5.0fms max=%5.0fms\n"
        % (
            cfg["scenario"],
            cfg["kind"],
            cfg["mode"],
            cfg["conc"],
            len(latencies),
            elapsed,
            len(latencies) / elapsed,
            stats[0],
            stats[1],
            stats[2],
            stats[3],
        )
    )


if __name__ == "__main__":
    main()
