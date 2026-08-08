# bench/ — capacity measurement for visdom-cloud

Answers one question: **does visdom pin one core under concurrent writes, and where does
throughput knee?**

Nothing here deploys a second visdom. The harness is a load *client* plus a measuring
probe; it drives the live stack — real nginx, real auth gate, real Tornado server, real
Postgres — using the visdom python client, which is what a user's training script runs.

**Answer, measured on 4 OCPU ARM:** yes. One visdom process saturates one core at
conc≈25 and throughput plateaus at **~575 line writes/s**, while the host still has
2.9 of 4 cores idle. Viewer fan-out is *not* the second ceiling — 2,000 broadcasts/s
costs 0.24 cores. The scaling axis is therefore more visdom processes sharded by
workspace, not a bigger VM and not a faster framework. Numbers in [Results](#results).

## Layout

| File | Runs where | Purpose |
|---|---|---|
| `sweep.sh` | VM host | orchestrates a concurrency sweep, writes `results/` |
| `cpu_sample.py` | VM host | samples visdom / generator / host CPU into CSV |
| `writebench.py` | `bench` container | scenario 4 — N writers |
| `viewbench.py` | `bench` container | scenario 5 — N viewers watching one workspace |
| `fleet.py` | `bench` container | creates and destroys 4b's throwaway workspaces and keys |
| `Dockerfile`, `requirements.txt` | — | the generator image |

`cpu_sample.py` runs on the **host**, not in a container: a container has its own PID
namespace and cannot see the visdom server process at all. Standard library only, so
nothing needs installing.

## Running it

On the VM, never from a laptop — otherwise you are measuring a home connection and the
round trip to Oracle.

Once, to build the generator image:

```bash
cd ~/app/visdom-cloud
git pull
docker compose --profile bench build bench
```

Then, for every run:

```bash
cd ~/app/visdom-cloud
read -rs VISDOM_API_KEY; export VISDOM_API_KEY
export BENCH_WORKSPACE=loadtest

./bench/sweep.sh --smoke                 # 1 writer + 1 viewer, 2 writes: proves the plumbing
```

`--smoke` exercises both drivers and takes a few seconds. **Run it first every time** —
it is what catches an expired key, a stale image or a broken fan-out filter before a
twenty-minute sweep produces a file full of zeros.

| Scenario | Command |
|---|---|
| **4a** — N writers, one shared workspace | `./bench/sweep.sh` |
| **4a**, image payloads | `BENCH_KIND=image ./bench/sweep.sh` |
| **4b** — N writers, one workspace + key each | `./bench/sweep.sh --fleet` |
| **5** — N viewers watching one writer | `./bench/sweep.sh --viewers` |

4b needs a user session to create its workspaces, so it takes credentials rather than a
key:

```bash
export BENCH_EMAIL=you@example.com
read -rs BENCH_PASSWORD; export BENCH_PASSWORD
./bench/sweep.sh --fleet
```

Any sweep can be narrowed with the level lists, which is how to iterate quickly:

```bash
BENCH_LEVELS="1 10" BENCH_OPS=20 ./bench/sweep.sh
BENCH_VIEWER_LEVELS="1 50 200" BENCH_RATE=20 ./bench/sweep.sh --viewers
```

**Never run two scenarios at the same time.** They load the same server, so each becomes
the other's noise and neither result means anything. Run them back to back.

Each sweep writes `results/<stamp>-<scenario>.csv`, one row per level, alongside a
directory of per-second CPU samples. `results/` is git-ignored.

## Results

Measured 2026-08-06 to 2026-08-08 on the test deployment: Oracle `VM.Standard.A1.Flex`,
**4 OCPU / 16 GB ARM**, Caddy → nginx → gateway + visdom + Postgres, generator on the
same box. `visdom_cores` is the server process alone, read from `/proc` on the host;
`host_cores` is all four.

### 4a — concurrent writes, one shared workspace

`line`, `np.random.rand(200)`, 50 writes per writer:

| conc | thr/s | p50 | p95 | p99 | visdom_cores | host_cores |
|---|---|---|---|---|---|---|
| 1 | 225.3 | 3 | 3 | 15 | 0.12 | 1.41 |
| 5 | 536.6 | 8 | 10 | 23 | 0.37 | 2.06 |
| 10 | 577.6 | 14 | 23 | 42 | 0.45 | 2.18 |
| 25 | 573.2 | 37 | 47 | 109 | **0.95** | 2.75 |
| 50 | 564.2 | 78 | 114 | 160 | **0.98** | 2.91 |

**Throughput knees at conc≈10 and plateaus at ~575 writes/s.** Past the knee p50 grows
linearly (14 → 37 → 78 ms) with no throughput gain, which is queueing behind a serialized
resource and nothing else. visdom reaches 0.98 cores while the host sits at 2.91 of 4, so
the ceiling is one process on one core and a bigger VM buys nothing.

`image`, `np.random.rand(3, 256, 256)`:

| conc | thr/s | p50 | p95 | p99 | visdom_cores | bench_cores | host_cores |
|---|---|---|---|---|---|---|---|
| 1 | 45.6 | 20 | 26 | 34 | 0.10 | 0.03 | 1.53 |
| 5 | 153.4 | 26 | 43 | 49 | 0.49 | 2.96 | 3.80 |
| 10 | 169.8 | 55 | 78 | 111 | 0.47 | 3.17 | 3.99 |
| 25 | 173.3 | 138 | 199 | 270 | 0.50 | 3.24 | **4.00** |
| 50 | 168.7 | 283 | 432 | 534 | 0.51 | 3.36 | **4.00** |

**This is not a server capacity number.** visdom never passes 0.51 cores while the
generator uses 3.36 and the host pins at 4.00 — the client saturated the box and starved
the server. The cost is the PNG encode and base64 inside `vis.image()`, which is
client-side and per-call. **Do not quote 169/s as an image ceiling**; measuring it needs
a second machine, or a pre-encoded payload POSTed as raw HTTP.

### 4b — one workspace and one key per writer

Same load, but every writer pays a cold gateway resolve instead of sharing a cached one:

| conc | 4a thr/s | 4b thr/s | Δ | 4a p99 | 4b p99 | 4b visdom_cores |
|---|---|---|---|---|---|---|
| 1 | 225.3 | 227.2 | +0.8% | 15 | 7 | 0.12 |
| 5 | 536.6 | 483.9 | −9.8% | 23 | 21 | 0.34 |
| 10 | 577.6 | 550.2 | −4.7% | 42 | 35 | 0.47 |
| 25 | 573.2 | 548.0 | −4.4% | 109 | 118 | 0.96 |
| 50 | 564.2 | 521.8 | −7.5% | 160 | **244** | 0.96 |

**At this resolve-to-write ratio the auth path is not the bottleneck** — 5–8% throughput,
and visdom still pins one core. It shows up in the tail instead: p99 at conc=50 goes
160 → 244 ms, +52%, which is the blocking resolve stalling the event loop.

That result is bounded by its own ratio: each writer resolves once and then writes 50
times, so only ~2% of requests pay it. Measured directly on raw HTTP, one write to a
brand-new workspace costs **17.19 ms against a warm 1.55 ms — 11×**. Two blocking costs,
both on the event loop: the gateway resolve (~7.2 ms) and `WorkspaceEnvManager`'s
first-touch disk I/O. Space creation is permanent, so only the resolve recurs after the
45 s cache expires. **The impact of `CONCERNS.md` §1c is set by how many writes follow
each resolve**, and a real workload that opens a client and trains for an hour looks like
4a, not like the cold case.

### 5 — viewer fan-out

N subscribers on `main` in one workspace, one writer at 10 writes/s, 50 writes:

| Viewers | Broadcasts/s | Delivered | Drops | p50 | p95 | visdom_cores | bench_cores |
|---|---|---|---|---|---|---|---|
| 1 | 10 | 50 | 0% | 3.0 ms | 3.2 ms | 0.04 | 0.04 |
| 10 | 100 | 500 | 0% | 6.6 ms | 9.7 ms | 0.05 | 0.09 |
| 25 | 250 | 1,250 | 0% | 13.5 ms | 23.8 ms | 0.07 | 0.20 |
| 50 | 500 | 2,500 | 0% | 21.2 ms | 35.9 ms | 0.10 | 0.39 |
| 100 | 1,000 | 5,000 | 0% | 38.9 ms | 68.6 ms | 0.16 | 0.76 |
| 200 | 2,000 | 10,000 | 0% | 185.1 ms | 363.0 ms | **0.24** | **1.19** |

**Fan-out is not the ceiling, and it is not serialize-per-subscriber.** visdom serves
2,000 broadcasts/s at 0.24 cores with zero drops — roughly 5,000–8,000 broadcasts per
core, about 10× cheaper than a write. `register_window` runs `json.dumps` **once per
write** and `broadcast()` writes that same string to every subscriber.

**The latency growth above ~100 viewers is our load generator, not the server.** At 200
viewers the bench container used 1.19 cores against visdom's 0.24: 200 Python receiver
threads contending on the GIL to timestamp arrivals. **Do not quote the 185 ms p50 as a
server figure** — confirming real fan-out latency needs viewers spread across processes
or machines.

### What this means for scaling

Sticky routing puts every viewer of a workspace on one instance by design, so fan-out
being cheap is what makes **sharding by workspace** viable: a single busy workspace is
not the constraint it was feared to be. The write path is the thing that pins a core, and
the only way past one core in one Python process is more processes. Swapping Tornado for
another framework does not change that — the multi-process story is the same, and the
state that would have to be split is the same.

### Caveats on all of the above

- Levels ran 0.2 s to 15.7 s, giving 3–19 CPU samples each. The high-concurrency line
  figures (0.95, 0.98) are trustworthy; the low-concurrency ones are diluted by the
  sampler's 2 s lead-in and should be read as "well under one core", not as exact.
- Except where stated, every run is warm-cache (nginx 30 s, `WorkspaceManager` 45 s).
- Specific to 4 OCPU ARM and to code that still has a synchronous gateway call on the
  event loop.
- Scenarios 1–3 (login storm, dashboard browse, cold page load) are not measured;
  anything said about them is reasoning, not data.

## What each scenario measures

**4a** — every writer shares one workspace and one key. After the first request the auth
caches are warm (nginx 30 s, `WorkspaceManager` 45 s), so the gateway is barely consulted.
That isolates plot serialization CPU, which is what "does visdom pin a core" asks.

**4b** — every writer gets its own workspace and its own key, so each pays a cold gateway
resolve: a synchronous `requests.post` on Tornado's event loop (`CONCERNS.md` §1c), plus a
first-touch `WorkspaceEnvManager._create_space` that does blocking disk I/O. **4a
throughput − 4b throughput at the same concurrency is the cost of the auth path**, and it
is the number that says whether §1c is worth fixing before anything else.

**5** — every write to a workspace is pushed to each subscribed socket, so one write with
N viewers is one store plus N sends. This is the path that decides whether sharding is the
right axis at all: sticky routing puts every viewer of a workspace on the same instance by
design, so if fan-out were expensive, a busy workspace would be capped by one core no
matter how many instances exist.

N subscribers attach to `main`, one writer sends at a fixed rate, and each subscriber
timestamps arrival. Writer and subscribers share a process, so the difference is real
delivery latency rather than a comparison across clocks. Writes go to `main` because
`broadcast()` only reaches subscribers whose `eid` matches the env being written, and a
freshly opened socket defaults to `main`. A plot broadcast arrives as `command: "window"`,
which is what distinguishes it from the `register`/`layout_update`/`env_update` messages a
socket gets on connect.

## Who creates the workspaces, and who removes them

`sweep.sh --fleet` does both, automatically:

1. **Before the sweep** — `fleet.py setup` logs in with `BENCH_EMAIL`/`BENCH_PASSWORD`,
   creates one workspace and one workspace-scoped key per writer (slugs `bench-0`,
   `bench-1`, …), and writes a manifest to `results/<stamp>-4b-fleet.json`.
2. **After the sweep** — an `EXIT` trap runs `fleet.py teardown`, which revokes every key
   and deletes every workspace. It fires on success, on failure, and on Ctrl-C.

Nothing is left behind in the normal case, and nothing touches your real workspaces —
only slugs starting with `$BENCH_PREFIX` (default `bench-`) are ever created or deleted.

If teardown is ever missed — the VM reboots mid-run, say — clean up by hand. This ignores
the manifest and finds everything by slug prefix:

```bash
cd ~/app/visdom-cloud
docker compose --profile bench run --rm -T bench \
  python fleet.py teardown --prefix bench- --discover
```

A partial `setup` still prints its manifest, so a run that dies halfway is recoverable
rather than orphaned.

The client is installed from the fork's `dev` branch, not PyPI, because `api_key=` and
`workspace=` are additions this project made and do not exist upstream. That also keeps
the client's auth protocol in step with the server it is measuring — **rebuild the bench
image whenever you rebuild visdom.** Pin a different commit with
`--build-arg VISDOM_REF=<sha>`.

It installs with `--no-deps`: `setup.py` declares the *server's* dependencies, and
openTSNE among them has no aarch64 wheel and needs a C++ toolchain the slim image lacks.
The client's hard imports are the four in `requirements.txt`; openTSNE sits behind a
`try/except ImportError` that only raises if `do_tsne()` is called, which the write path
never does. The build asserts the client imports and carries `api_key=`, so a wrong build
fails there rather than mid-benchmark.

Use a throwaway workspace (`loadtest`) so junk environments stay contained.

## Knobs

All environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `VISDOM_API_KEY` | — | required for 4a and 5; export it, never write it to a file |
| `BENCH_EMAIL`, `BENCH_PASSWORD` | — | required for `--fleet`; workspace creation needs a user session |
| `BENCH_WORKSPACE` | `loadtest` | workspace slug for 4a and 5 |
| `BENCH_PREFIX` | `bench-` | slug prefix for the 4b fleet |
| `BENCH_LEVELS` | `1 5 10 25 50` | writer concurrency levels (4a, 4b) |
| `BENCH_OPS` | `50` | writes per writer (4a, 4b) |
| `BENCH_KIND` | `line` | `line` or `image` (4a, 4b) |
| `BENCH_MODE` | `proc` | `proc` or `thread` (4a, 4b) |
| `BENCH_VIEWER_LEVELS` | `1 10 25 50 100 200` | subscriber counts to sweep (5) |
| `BENCH_WRITES` | `50` | writes the single writer sends (5) |
| `BENCH_RATE` | `10` | writes per second (5) |
| `BENCH_SETTLE` | `10` | seconds between levels |

## Reading the output

The columns that answer the question are `visdom_cores_max`, `bench_cores_max` and
`host_cores_max`, next to `throughput` and `p95_ms`. For scenario 5 the equivalents are
`visdom_cores_max` next to `delivered`, `drop_pct` and `p95_ms`; **`drop_pct` above zero
means the server shed broadcasts and that level's latency figures understate the damage.**

- **`visdom_cores_max` ≈ 1.00 at high concurrency** — serialization on one core is the
  ceiling. `CONCERNS.md` §3a holds, sharding is the answer, a bigger VM buys nothing.
- **`visdom_cores_max` plateaus well under 1.0 while `p95_ms` climbs** — something else
  binds first, most likely the synchronous gateway call still on Tornado's event loop
  (`CONCERNS.md` §1c). Fix that before adding instances.
- **`host_cores_max` approaching 4.0** — the *box* saturated, not visdom. The knee is an
  artefact of the generator competing with the server; rerun with fewer levels or accept
  the ceiling as a host limit, and say so in the report.

The knee is the level where `throughput` stops rising while `p95_ms`/`p99_ms` keep
climbing. Below it you are adding parallelism; above it, only queue depth.

## Traps

Carried from `BENCHMARKING.md` §3, because they have already cost one voided run:

1. **Any non-2xx voids the run.** `writebench.py` preflights for a 200 and aborts on the
   first failed write, so this should now be structurally impossible. A run of cached
   denials once reported 8671 req/s and measured nothing.
2. **Generate load on the VM, not a laptop.**
3. **A generator inside the visdom container inflates that container's `docker stats`.**
   This is why the `bench` container exists and why the sampler reads `/proc` directly.
4. **Caches flatten sustained runs** — nginx auth gate 30 s, `WorkspaceManager` 45 s. This
   measures steady-state serialization, not cold resolve.
5. **Payload type dominates plot count.** `line` is near best case; `image` is base64 and
   orders of magnitude heavier. The gap between the two is the most useful single number
   here.
6. **`docker compose` needs the project directory** — `sweep.sh` cds to the repo root
   itself, but a manual `docker compose` will not.

## Cleanup

**4a** leaves environments behind — one per writer per level (`sw1_0`, `sw5_0`…), 91 in
total for the default levels, all inside `loadtest`. Delete them from that workspace
afterwards and revoke the API key when done. They also accumulate *across* levels, so
conc=50 runs with 41 envs already resident; negligible for `line`, roughly 18 MB for
`image`, and worth a sentence in any report.

**4b** cleans up after itself — see "Who creates the workspaces" above.

## Not here yet

Scenarios 1–3 (login storm, dashboard browse, visdom cold page load) are k6 and land in
`k6/`. See the design doc for the phasing.
