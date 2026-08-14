#!/usr/bin/env python3
"""
Samples CPU on the VM host while a benchmark runs: one column group per watched set
of processes, plus the host as a whole.

Runs on the host rather than in a container. A container has its own PID namespace and
cannot see the processes under test; the host's namespace is the parent of every
container's, so everything is reachable from here. Standard library only.

  python3 cpu_sample.py --raw raw.csv --summary summary.csv --duration 60
  python3 cpu_sample.py --watch gateway=uvicorn --watch db=postgres:
  python3 cpu_sample.py --print-header

A watch is NAME=MARKER[,MARKER...]; a process matches when any marker appears in any
of its argv entries, and every match is summed. That is what makes a sharded service
add up correctly rather than reporting whichever instance was found first.

Which processes matter depends on the scenario: the visdom write and fan-out benchmarks
watch visdom, while the k6 gateway scenarios watch the gateway and Postgres instead.
Column names follow the watch names, so --print-header is the one source of truth for
the CSV shape and callers do not repeat it.

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

DEFAULT_WATCHES = ("visdom=visdom.server", "bench=writebench.py,viewbench.py")

_stop = False


def _handle_stop(signum, frame):
    global _stop
    _stop = True


def parse_watch(spec):
    """Turn NAME=MARKER[,MARKER...] into (name, markers)."""
    name, _, markers = spec.partition("=")
    if not name or not markers:
        raise argparse.ArgumentTypeError(
            "watch %r must look like NAME=MARKER[,MARKER...]" % spec
        )
    return name, tuple(m for m in markers.split(",") if m)


def raw_header(watches):
    columns = ["ts", "elapsed_s"]
    for name, _ in watches:
        columns += ["%s_cores" % name, "%s_rss_mb" % name]
    return ",".join(columns + ["host_cores"])


def summary_header(watches):
    columns = []
    for name, _ in watches:
        columns += [
            "%s_cores_mean" % name,
            "%s_cores_max" % name,
            "%s_rss_mb_max" % name,
        ]
    return ",".join(columns + ["host_cores_max", "samples"])


def read_cmdline(pid):
    try:
        with open("/proc/%s/cmdline" % pid, "rb") as fh:
            return fh.read().decode("utf-8", "replace").split("\x00")
    except (OSError, ValueError):
        return []


def find_pids(markers):
    """Every process whose argv contains any of ``markers``."""
    pids = []
    for path in glob.glob("/proc/[0-9]*/cmdline"):
        pid = int(path.split("/")[2])
        argv = read_cmdline(pid)
        if any(marker in arg for arg in argv for marker in markers):
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


class Watch:
    """One named group of processes, tracked across samples.

    Membership is re-resolved every tick so processes that start or stop mid-run are
    picked up, which matters for the per-request workers Postgres forks.
    """

    def __init__(self, name, markers):
        self.name = name
        self.markers = markers
        self.previous = {pid: proc_ticks(pid) for pid in find_pids(markers)}
        self.cores = []
        self.rss_max = 0.0

    def sample(self, wall):
        current = {}
        delta = 0
        rss = 0.0
        for pid in find_pids(self.markers):
            ticks = proc_ticks(pid)
            if ticks is None:
                continue
            current[pid] = ticks
            rss += proc_rss_mb(pid)
            if pid in self.previous:
                delta += ticks - self.previous[pid]
        self.previous = current
        cores = delta / CLK_TCK / wall
        self.cores.append(cores)
        self.rss_max = max(self.rss_max, rss)
        return cores, rss

    def summary(self):
        mean = sum(self.cores) / len(self.cores) if self.cores else 0.0
        peak = max(self.cores) if self.cores else 0.0
        return [mean, peak, self.rss_max]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default="")
    parser.add_argument("--summary", default="")
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--duration", type=float, default=0.0)
    parser.add_argument("--watch", type=parse_watch, action="append")
    parser.add_argument("--print-header", action="store_true")
    args = parser.parse_args()

    watches = args.watch or [parse_watch(spec) for spec in DEFAULT_WATCHES]

    if args.print_header:
        sys.stdout.write(summary_header(watches) + "\n")
        return 0

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    tracked = [Watch(name, markers) for name, markers in watches]
    for watch in tracked:
        if watch.previous:
            sys.stderr.write(
                "cpu_sample: watching %d process(es) as %r\n"
                % (len(watch.previous), watch.name)
            )
        else:
            # Not fatal on its own: the sampler starts before the driver container, so
            # its watch is legitimately empty here and membership is re-resolved every
            # tick. Only nothing matching anywhere means the caller is in the wrong PID
            # namespace, which is the mistake worth stopping for.
            sys.stderr.write(
                "cpu_sample: nothing matching %s yet for watch %r; will keep looking\n"
                % (list(watch.markers), watch.name)
            )

    if not any(watch.previous for watch in tracked):
        sys.stderr.write(
            "cpu_sample: no process matched any watch. Is the stack up, and is this "
            "running on the VM host rather than inside a container?\n"
        )
        return 2

    raw = open(args.raw, "w") if args.raw else None
    if raw:
        raw.write(raw_header(watches) + "\n")

    started = time.time()
    prev_wall = started
    prev_host_total, prev_host_busy = host_ticks()
    host_max = 0.0
    samples = 0

    while not _stop:
        time.sleep(args.interval)

        now = time.time()
        wall = now - prev_wall
        if wall <= 0:
            continue
        prev_wall = now

        readings = [watch.sample(wall) for watch in tracked]

        host_total, host_busy = host_ticks()
        total_delta = host_total - prev_host_total
        host_cores = (host_busy - prev_host_busy) / total_delta * NCPU if total_delta else 0.0
        prev_host_total, prev_host_busy = host_total, host_busy
        host_max = max(host_max, host_cores)
        samples += 1

        elapsed = now - started
        if raw:
            values = ["%.0f" % now, "%.1f" % elapsed]
            for cores, rss in readings:
                values += ["%.3f" % cores, "%.1f" % rss]
            raw.write(",".join(values + ["%.3f" % host_cores]) + "\n")
            raw.flush()

        if args.duration and elapsed >= args.duration:
            break

    if raw:
        raw.close()

    values = []
    for watch in tracked:
        values += ["%.3f" % v for v in watch.summary()]
    line = ",".join(values + ["%.3f" % host_max, "%d" % samples])

    if args.summary:
        with open(args.summary, "w") as fh:
            fh.write(line + "\n")
    else:
        sys.stdout.write(summary_header(watches) + "\n" + line + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
