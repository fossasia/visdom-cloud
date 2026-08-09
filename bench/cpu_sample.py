#!/usr/bin/env python3
"""
Samples CPU on the VM host at three levels while a benchmark runs: the visdom server
processes summed across every shard, the load generator processes, and the host as a
whole.

Runs on the host rather than in a container. A container has its own PID namespace and
cannot see the visdom server process; the host's namespace is the parent of every
container's, so all three levels are reachable from here. Standard library only.

  python3 cpu_sample.py --raw raw.csv --summary summary.csv --duration 60

With --duration 0 it samples until SIGTERM, which is how sweep.sh drives it.
"""

import argparse
import glob
import os
import signal
import sys
import time

CLK_TCK = os.sysconf("SC_CLK_TCK")
PAGE_SIZE = os.sysconf("SC_PAGE_SIZE")
NCPU = os.cpu_count() or 1

SERVER_MARKER = "visdom.server"
GENERATOR_MARKERS = ("writebench.py", "viewbench.py")

RAW_HEADER = "ts,elapsed_s,visdom_cores,bench_cores,host_cores,visdom_rss_mb"
SUMMARY_HEADER = (
    "visdom_cores_mean,visdom_cores_max,bench_cores_max,host_cores_max,"
    "visdom_rss_mb_max,samples"
)

_stop = False


def _handle_stop(signum, frame):
    global _stop
    _stop = True


def read_cmdline(pid):
    try:
        with open("/proc/%s/cmdline" % pid, "rb") as fh:
            return fh.read().decode("utf-8", "replace").split("\x00")
    except (OSError, ValueError):
        return []


def find_server_pids():
    """Every visdom process, not the first one.

    Sharding runs several instances, and sampling only the one that happened to be
    found first understates the pool by however many shards exist."""
    pids = []
    for path in glob.glob("/proc/[0-9]*/cmdline"):
        pid = int(path.split("/")[2])
        if SERVER_MARKER in read_cmdline(pid):
            pids.append(pid)
    return pids


def find_generator_pids():
    pids = []
    for path in glob.glob("/proc/[0-9]*/cmdline"):
        pid = int(path.split("/")[2])
        argv = read_cmdline(pid)
        if any(marker in arg for arg in argv for marker in GENERATOR_MARKERS):
            pids.append(pid)
    return pids


def proc_ticks(pid):
    try:
        with open("/proc/%s/stat" % pid) as fh:
            fields = fh.read().rsplit(")", 1)[1].split()
        return int(fields[11]) + int(fields[12])
    except (OSError, IndexError, ValueError):
        return None


def proc_rss_mb(pid):
    try:
        with open("/proc/%s/statm" % pid) as fh:
            resident = int(fh.read().split()[1])
        return resident * PAGE_SIZE / (1024 * 1024)
    except (OSError, IndexError, ValueError):
        return 0.0


def host_ticks():
    with open("/proc/stat") as fh:
        fields = [int(v) for v in fh.readline().split()[1:]]
    total = sum(fields)
    idle = fields[3] + fields[4]
    return total, total - idle


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default="")
    parser.add_argument("--summary", default="")
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--duration", type=float, default=0.0)
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    server_pids = find_server_pids()
    if not server_pids:
        sys.stderr.write(
            "cpu_sample: no process matching %r found. Is the visdom container up, and "
            "is this running on the VM host rather than inside a container?\n"
            % SERVER_MARKER
        )
        return 2
    sys.stderr.write("cpu_sample: sampling %d visdom instance(s)\n" % len(server_pids))

    raw = open(args.raw, "w") if args.raw else None
    if raw:
        raw.write(RAW_HEADER + "\n")

    started = time.time()
    prev_wall = started
    prev_server = {pid: proc_ticks(pid) for pid in server_pids}
    prev_gen = {pid: proc_ticks(pid) for pid in find_generator_pids()}
    prev_host_total, prev_host_busy = host_ticks()

    server_samples = []
    gen_max = 0.0
    host_max = 0.0
    rss_max = 0.0

    while not _stop:
        time.sleep(args.interval)

        now = time.time()
        wall = now - prev_wall
        if wall <= 0:
            continue

        cur_server = {}
        server_delta = 0
        for pid in server_pids:
            ticks = proc_ticks(pid)
            if ticks is None:
                sys.stderr.write("cpu_sample: visdom server process %d vanished\n" % pid)
                continue
            cur_server[pid] = ticks
            if pid in prev_server:
                server_delta += ticks - prev_server[pid]
        if not cur_server:
            break
        prev_server = cur_server
        server_cores = server_delta / CLK_TCK / wall

        cur_gen = {}
        gen_delta = 0
        for pid in find_generator_pids():
            ticks = proc_ticks(pid)
            if ticks is None:
                continue
            cur_gen[pid] = ticks
            if pid in prev_gen:
                gen_delta += ticks - prev_gen[pid]
        prev_gen = cur_gen
        gen_cores = gen_delta / CLK_TCK / wall

        host_total, host_busy = host_ticks()
        total_delta = host_total - prev_host_total
        host_cores = (host_busy - prev_host_busy) / total_delta * NCPU if total_delta else 0.0
        prev_host_total, prev_host_busy = host_total, host_busy

        rss = sum(proc_rss_mb(pid) for pid in cur_server)
        prev_wall = now
        elapsed = now - started

        server_samples.append(server_cores)
        gen_max = max(gen_max, gen_cores)
        host_max = max(host_max, host_cores)
        rss_max = max(rss_max, rss)

        if raw:
            raw.write(
                "%.0f,%.1f,%.3f,%.3f,%.3f,%.1f\n"
                % (now, elapsed, server_cores, gen_cores, host_cores, rss)
            )
            raw.flush()

        if args.duration and elapsed >= args.duration:
            break

    if raw:
        raw.close()

    mean = sum(server_samples) / len(server_samples) if server_samples else 0.0
    line = "%.3f,%.3f,%.3f,%.3f,%.1f,%d" % (
        mean,
        max(server_samples) if server_samples else 0.0,
        gen_max,
        host_max,
        rss_max,
        len(server_samples),
    )

    if args.summary:
        with open(args.summary, "w") as fh:
            fh.write(line + "\n")
    else:
        sys.stdout.write(SUMMARY_HEADER + "\n" + line + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
