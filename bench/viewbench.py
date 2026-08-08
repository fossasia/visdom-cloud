#!/usr/bin/env python3
"""
Scenario 5 — N viewers watching one workspace while a script writes to it.

Every write to a workspace has to be serialized and pushed to each subscribed
socket, so one write with N viewers is one store plus N sends. This is the
serialize-per-subscriber path CONCERNS.md 3a suspects binds before write
throughput does, and it is the one limit sharding cannot help with: sticky
routing puts every viewer of a workspace on the same instance by design.

The writer stamps each send and every subscriber stamps each arrival, both in
this process, so the difference is real delivery latency rather than a clock
comparison across hosts.

Writes go to `main` because `broadcast()` only reaches subscribers whose `eid`
matches the env being written, and a freshly opened socket defaults to `main`.
Plot broadcasts are told apart from the register/layout/env messages a socket
receives on connect by the absence of a `command` field.

  VISDOM_API_KEY    required
  BENCH_WORKSPACE   workspace slug (default: loadtest)
  BENCH_VIEWERS     subscribers to attach (default: 10)
  BENCH_WRITES      writes the single writer sends (default: 50)
  BENCH_RATE        writes per second (default: 10)
  BENCH_SMOKE       1 to run a 1-viewer, 2-write plumbing check and exit
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
SETTLE_SECONDS = 3.0

CSV_HEADER = (
    "ts,scenario,viewers,writes,rate,elapsed_s,expected,delivered,drop_pct,"
    "p50_ms,p95_ms,p99_ms,max_ms"
)


def config():
    key = os.environ.get("VISDOM_API_KEY", "")
    if not key:
        sys.exit("viewbench: VISDOM_API_KEY is not set")
    smoke = os.environ.get("BENCH_SMOKE", "") == "1"
    return {
        "key": key,
        "workspace": os.environ.get("BENCH_WORKSPACE", "loadtest"),
        "viewers": 1 if smoke else int(os.environ.get("BENCH_VIEWERS", "10")),
        "writes": 2 if smoke else int(os.environ.get("BENCH_WRITES", "50")),
        "rate": float(os.environ.get("BENCH_RATE", "10")),
        "smoke": smoke,
    }


def headers(cfg):
    return {"X-API-KEY": cfg["key"], "X-Visdom-Workspace": cfg["workspace"]}


def header_list(cfg):
    return ["%s: %s" % (k, v) for k, v in headers(cfg).items()]


def http_base():
    return "http://%s:%d%s" % (SERVER_HOST, PORT, BASE_URL)


def socket_url():
    return "ws://%s:%d%s/socket" % (SERVER_HOST, PORT, BASE_URL)


def preflight(cfg):
    url = http_base() + "/"
    try:
        resp = requests.get(url, headers=headers(cfg), timeout=10)
    except requests.RequestException as exc:
        sys.exit("viewbench: preflight to %s failed: %s" % (url, exc))
    if resp.status_code != 200:
        sys.exit(
            "viewbench: preflight to %s returned %d, not 200. A run of denials "
            "measures nothing." % (url, resp.status_code)
        )


class Viewer(threading.Thread):
    """One subscribed socket, recording the arrival time of each plot broadcast."""

    def __init__(self, cfg, ready, stop):
        super().__init__(daemon=True)
        self.cfg = cfg
        self.ready = ready
        self.stop = stop
        self.arrivals = []
        self.error = None
        self.socket = None

    def connect(self):
        self.socket = websocket.create_connection(
            socket_url(), header=header_list(self.cfg), timeout=15
        )
        self.socket.settimeout(1.0)

    def run(self):
        self.ready.set()
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
            if "command" not in msg and msg.get("eid") == ENV:
                self.arrivals.append(time.perf_counter())


def write_once(session, cfg, payload):
    resp = session.post(
        http_base() + "/events", headers=headers(cfg), data=payload, timeout=15
    )
    if resp.status_code != 200:
        raise RuntimeError(
            "POST /events -> %d: %s" % (resp.status_code, resp.text[:200])
        )


def percentile(sorted_values, fraction):
    if not sorted_values:
        return 0.0
    index = min(int(len(sorted_values) * fraction), len(sorted_values) - 1)
    return sorted_values[index] * 1000


def main():
    cfg = config()
    preflight(cfg)

    stop = threading.Event()
    viewers = []
    for _ in range(cfg["viewers"]):
        ready = threading.Event()
        viewer = Viewer(cfg, ready, stop)
        try:
            viewer.connect()
        except Exception as exc:
            stop.set()
            sys.exit(
                "viewbench: viewer %d failed to connect (%s: %s)"
                % (len(viewers), type(exc).__name__, exc)
            )
        viewer.start()
        ready.wait(timeout=10)
        viewers.append(viewer)

    time.sleep(1.0)

    payload = json.dumps(
        {
            "eid": ENV,
            "win": "fanout",
            "data": [{"y": list(range(200)), "x": list(range(200)), "type": "scatter"}],
            "layout": {},
            "opts": {},
        }
    )

    session = requests.Session()
    sent = []
    interval = 1.0 / cfg["rate"] if cfg["rate"] > 0 else 0.0
    started = time.perf_counter()
    try:
        for i in range(cfg["writes"]):
            target = started + i * interval
            now = time.perf_counter()
            if target > now:
                time.sleep(target - now)
            sent.append(time.perf_counter())
            write_once(session, cfg, payload)
    except Exception as exc:
        stop.set()
        sys.exit("viewbench: aborted, a write failed (%s: %s)" % (type(exc).__name__, exc))
    elapsed = time.perf_counter() - started

    time.sleep(SETTLE_SECONDS)
    stop.set()
    for viewer in viewers:
        try:
            viewer.socket.close()
        except Exception:
            pass

    failed = [v for v in viewers if v.error is not None]
    if failed:
        sys.exit(
            "viewbench: %d of %d viewers errored, first was %s"
            % (len(failed), len(viewers), failed[0].error)
        )

    latencies = []
    delivered = 0
    for viewer in viewers:
        delivered += len(viewer.arrivals)
        for index, arrival in enumerate(viewer.arrivals[: len(sent)]):
            latencies.append(arrival - sent[index])

    expected = cfg["viewers"] * cfg["writes"]
    drop_pct = 100.0 * (expected - delivered) / expected if expected else 0.0

    if cfg["smoke"]:
        if delivered == 0:
            sys.exit(
                "viewbench: no broadcasts reached the viewer. Writes are landing but "
                "fan-out is not, so the run would measure nothing."
            )
        sys.stderr.write(
            "SMOKE OK — %d viewer, %d writes, %d broadcasts delivered\n"
            % (cfg["viewers"], cfg["writes"], delivered)
        )
        return

    latencies.sort()
    stats = (
        percentile(latencies, 0.50),
        percentile(latencies, 0.95),
        percentile(latencies, 0.99),
        percentile(latencies, 1.0),
    )

    row = "%d,5,%d,%d,%.1f,%.2f,%d,%d,%.2f,%.1f,%.1f,%.1f,%.1f" % (
        time.time(),
        cfg["viewers"],
        cfg["writes"],
        cfg["rate"],
        elapsed,
        expected,
        delivered,
        drop_pct,
        stats[0],
        stats[1],
        stats[2],
        stats[3],
    )

    if os.environ.get("BENCH_HEADER", "") == "1":
        sys.stdout.write(CSV_HEADER + "\n")
    sys.stdout.write(row + "\n")

    sys.stderr.write(
        "fanout viewers=%-4d writes=%-4d rate=%-5.1f/s elapsed=%6.2fs  "
        "delivered=%-7d drop=%5.2f%%  p50=%6.1fms p95=%6.1fms p99=%6.1fms max=%6.1fms\n"
        % (
            cfg["viewers"],
            cfg["writes"],
            cfg["rate"],
            elapsed,
            delivered,
            drop_pct,
            stats[0],
            stats[1],
            stats[2],
            stats[3],
        )
    )


if __name__ == "__main__":
    main()
