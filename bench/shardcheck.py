#!/usr/bin/env python3

# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Proves nginx's workspace sharding actually routes the way it must.

visdom keeps a workspace's envs and socket subscribers in one process's memory, so
every request touching a workspace has to reach the same instance. Two things can
go wrong, and neither raises an error anywhere — they present as a dashboard that
silently never updates:

  affinity      the websocket and the writes derive their shard key differently, so
                a viewer subscribes on one instance while writes land on another.
                Browser sockets carry the slug in the path (/vis/w/<slug>/socket);
                the python client sends it as the X-Visdom-Workspace header. Both
                must hash to the same key.

  distribution  the key resolves empty for everything, so every workspace lands on
                one instance. Sharding then "works" while buying nothing, and the
                affinity check alone would still pass.

The distribution check reads nginx's X-Visdom-Upstream header, so it measures
routing rather than access, and its slugs do not have to be workspaces that exist —
a denied request is still a routed request. The affinity check does need a real
workspace, since it has to observe a broadcast.

  VISDOM_API_KEY    required
  BENCH_WORKSPACE   real workspace for the affinity check (default: loadtest)
  BENCH_PROBES      synthetic slugs for the distribution check (default: 24)
  BENCH_SHARDS      instances expected to be in use; 0 to only report (default: 0)
"""

import json
import os
import sys
import threading
import time

import requests
import websocket

SERVER_HOST = os.environ.get("BENCH_SERVER", "http://proxy").split("//")[-1]
PORT = int(os.environ.get("BENCH_PORT", "80"))
BASE_URL = os.environ.get("BENCH_BASE_URL", "/vis")
ENV = "main"
PROBE_PREFIX = "shardprobe-"
ARRIVAL_TIMEOUT = 10.0


def config():
    key = os.environ.get("VISDOM_API_KEY", "")
    if not key:
        sys.exit("shardcheck: VISDOM_API_KEY is not set")
    return {
        "key": key,
        "workspace": os.environ.get("BENCH_WORKSPACE", "loadtest"),
        "probes": int(os.environ.get("BENCH_PROBES", "24")),
        "shards": int(os.environ.get("BENCH_SHARDS", "0")),
    }


def headers(cfg, workspace):
    return {"X-API-KEY": cfg["key"], "X-Visdom-Workspace": workspace}


def http_base():
    return "http://%s:%d%s" % (SERVER_HOST, PORT, BASE_URL)


def browser_socket_url(workspace):
    return "ws://%s:%d%s/w/%s/socket" % (SERVER_HOST, PORT, BASE_URL, workspace)


class Subscriber(threading.Thread):
    """A socket opened over the browser path, recording plot broadcasts.

    A plot broadcast arrives as command "window"; that is what distinguishes it
    from the register/layout_update/env_update messages a socket gets on connect.
    """

    def __init__(self, socket, stop):
        super().__init__(daemon=True)
        self.socket = socket
        self.stop = stop
        self.arrived = threading.Event()
        self.error = None

    def run(self):
        while not self.stop.is_set():
            try:
                raw = self.socket.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception as exc:
                if not self.stop.is_set():
                    self.error = exc
                return
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if msg.get("command") == "window" and msg.get("eid") == ENV:
                self.arrived.set()


def check_affinity(cfg):
    """Subscribe over the browser path, write over the header path, same workspace.

    If the two derive different shard keys the write lands on another instance and
    no broadcast ever arrives.
    """
    workspace = cfg["workspace"]
    header_list = ["%s: %s" % (k, v) for k, v in headers(cfg, workspace).items()]

    try:
        socket = websocket.create_connection(
            browser_socket_url(workspace), header=header_list, timeout=15
        )
    except Exception as exc:
        sys.exit(
            "shardcheck: could not open a socket on the browser path %s (%s: %s)"
            % (browser_socket_url(workspace), type(exc).__name__, exc)
        )
    socket.settimeout(1.0)

    stop = threading.Event()
    subscriber = Subscriber(socket, stop)
    subscriber.start()
    time.sleep(1.0)

    payload = json.dumps(
        {
            "eid": ENV,
            "win": "shardcheck",
            "data": [{"y": list(range(50)), "x": list(range(50)), "type": "scatter"}],
            "layout": {},
            "opts": {},
        }
    )
    resp = requests.post(
        http_base() + "/events",
        headers=headers(cfg, workspace),
        data=payload,
        timeout=15,
    )
    if resp.status_code != 200:
        stop.set()
        sys.exit(
            "shardcheck: the write itself failed (%d: %s). Fix that before reading "
            "anything into the routing." % (resp.status_code, resp.text[:200])
        )

    arrived = subscriber.arrived.wait(timeout=ARRIVAL_TIMEOUT)
    stop.set()
    try:
        socket.close()
    except Exception:
        pass

    if subscriber.error is not None:
        sys.exit("shardcheck: the subscriber socket errored: %s" % subscriber.error)

    if not arrived:
        sys.exit(
            "shardcheck: FAIL — the write to workspace %r succeeded but never reached a "
            "socket subscribed to the same workspace over /vis/w/%s/. The browser path "
            "and the header path are hashing to different instances, so viewers watch "
            "one shard while writes land on another. Check the $shard_key map."
            % (workspace, workspace)
        )

    upstream = resp.headers.get("X-Visdom-Upstream", "?")
    sys.stderr.write(
        "affinity     OK — socket on /vis/w/%s/ saw the write sent with the header "
        "(write served by %s)\n" % (workspace, upstream)
    )


def upstream_for(cfg, workspace):
    resp = requests.get(
        http_base() + "/", headers=headers(cfg, workspace), timeout=15
    )
    upstream = resp.headers.get("X-Visdom-Upstream", "")
    if not upstream:
        sys.exit(
            "shardcheck: no X-Visdom-Upstream header on a request to workspace %r "
            "(status %d). Either the proxy predates the sharding config or the request "
            "never reached an upstream." % (workspace, resp.status_code)
        )
    return upstream


def check_distribution(cfg):
    """Each slug must pin to one instance, and slugs must not all pin to the same one.

    Routing is observable even when the workspace does not exist, because nginx sets
    the upstream header before visdom decides whether to allow the request.
    """
    placement = {}
    for index in range(cfg["probes"]):
        slug = "%s%d" % (PROBE_PREFIX, index)
        seen = {upstream_for(cfg, slug) for _ in range(3)}
        if len(seen) != 1:
            sys.exit(
                "shardcheck: FAIL — workspace %r was served by %s across identical "
                "requests. Routing is not sticky, so a workspace's state is split "
                "across instances." % (slug, sorted(seen))
            )
        placement[slug] = seen.pop()

    instances = sorted(set(placement.values()))
    per_instance = {name: 0 for name in instances}
    for upstream in placement.values():
        per_instance[upstream] += 1

    sys.stderr.write(
        "distribution OK — %d slugs each pinned to one instance, spread over %d: %s\n"
        % (
            len(placement),
            len(instances),
            ", ".join("%s=%d" % (name, per_instance[name]) for name in instances),
        )
    )

    if cfg["shards"] > 1 and len(instances) != cfg["shards"]:
        sys.exit(
            "shardcheck: FAIL — %d slugs spread over %d instances, expected %d. With "
            "this many distinct workspaces that is not chance: either an instance is "
            "down, or the shard key resolves empty for every request and every "
            "workspace is landing on one shard. Check the $shard_key map."
            % (cfg["probes"], len(instances), cfg["shards"])
        )

    if cfg["shards"] <= 1 and len(instances) == 1:
        sys.stderr.write(
            "             (one instance in the pool, so this proves stickiness but not "
            "spreading — set BENCH_SHARDS to assert the instance count)\n"
        )


def main():
    cfg = config()
    check_affinity(cfg)
    check_distribution(cfg)
    sys.stderr.write("shardcheck: PASS\n")


if __name__ == "__main__":
    main()
