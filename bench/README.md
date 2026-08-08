# bench/ — capacity measurement for visdom-cloud

Answers one question: **does visdom pin one core under concurrent writes, and where does
throughput knee?**

Nothing here deploys a second visdom. The harness is a load *client* plus a measuring
probe; it drives the live stack — real nginx, real auth gate, real Tornado server, real
Postgres — using the visdom python client, which is what a user's training script runs.

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

```bash
cd ~/app/visdom-cloud
git pull
docker compose --profile bench build bench

read -rs VISDOM_API_KEY; export VISDOM_API_KEY
export BENCH_WORKSPACE=loadtest

./bench/sweep.sh --smoke      # 1 writer, 2 writes: proves the plumbing
./bench/sweep.sh              # 4a: the real sweep, 1, 5, 10, 25, 50
BENCH_KIND=image ./bench/sweep.sh
```

## 4a and 4b

**4a** — every writer shares one workspace and one key. After the first request the auth
caches are warm (nginx 30 s, `WorkspaceManager` 45 s), so the gateway is barely consulted.
That isolates plot serialization CPU, which is what "does visdom pin a core" asks.

**4b** — every writer gets its own workspace and its own key, so each pays a cold gateway
resolve: a synchronous `requests.post` on Tornado's event loop (`CONCERNS.md` §1c), plus a
first-touch `WorkspaceEnvManager._create_space` that does blocking disk I/O. This is what
real users look like.

```bash
export BENCH_EMAIL=you@example.com
read -rs BENCH_PASSWORD; export BENCH_PASSWORD
./bench/sweep.sh --fleet
```

**4a throughput − 4b throughput at the same concurrency is the cost of the auth path**,
and it is the number that says whether §1c is worth fixing before anything else.

## Scenario 5 — viewer fan-out

Every write to a workspace is serialized and pushed to each subscribed socket, so one
write with N viewers is one store plus N sends. This is the path that decides whether
sharding is the right axis at all: sticky routing puts every viewer of a workspace on the
same instance by design, so a workspace with many viewers is capped by one core no matter
how many instances exist.

```bash
./bench/sweep.sh --viewers
BENCH_VIEWER_LEVELS="1 50 200" BENCH_RATE=20 ./bench/sweep.sh --viewers
```

N subscribers attach to `main` in the workspace, one writer sends at a fixed rate, and
each subscriber timestamps arrival. Writer and subscribers share a process, so the
difference is real delivery latency rather than a comparison across clocks.

Writes go to `main` because `broadcast()` only reaches subscribers whose `eid` matches
the env being written, and a freshly opened socket defaults to `main`. A plot broadcast
arrives as `command: "window"`, which is what distinguishes it from the
`register`/`layout_update`/`env_update` messages a socket gets on connect.

**The number to hunt: at what viewer count does visdom pin a core at a modest write
rate?** If CPU scales linearly with viewers, serialize-per-subscriber is confirmed and
the curve extrapolates. `drop_pct` above zero means the server shed broadcasts and the
latency figures for that level understate the damage.

| Knob | Default | Meaning |
|---|---|---|
| `BENCH_VIEWER_LEVELS` | `1 10 25 50 100 200` | subscriber counts to sweep |
| `BENCH_WRITES` | `50` | writes the single writer sends |
| `BENCH_RATE` | `10` | writes per second |

**Never run 4a and 4b at the same time.** They load the same server, so each becomes the
other's noise and neither result means anything. Run them back to back.

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

Results land in `results/<date>-write-<kind>.csv`, one row per concurrency level, plus a
per-second raw sample directory alongside. `results/` is git-ignored.

Use a throwaway workspace (`loadtest`) so junk environments stay contained.

## Knobs

All environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `VISDOM_API_KEY` | — | required for 4a; export it, never write it to a file |
| `BENCH_EMAIL`, `BENCH_PASSWORD` | — | required for `--fleet`; workspace creation needs a user session |
| `BENCH_WORKSPACE` | `loadtest` | workspace slug for 4a |
| `BENCH_PREFIX` | `bench-` | slug prefix for the 4b fleet |
| `BENCH_LEVELS` | `1 5 10 25 50` | concurrency levels to sweep |
| `BENCH_OPS` | `50` | writes per writer |
| `BENCH_KIND` | `line` | `line` or `image` |
| `BENCH_MODE` | `proc` | `proc` or `thread` |
| `BENCH_SETTLE` | `10` | seconds between levels |

## Reading the output

The columns that answer the question are `visdom_cores_max`, `bench_cores_max` and
`host_cores_max`, next to `throughput` and `p95_ms`.

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

## Caveats for any report

Numbers are specific to 4 OCPU ARM (Oracle `VM.Standard.A1.Flex`) and to the current code,
which still has a synchronous gateway call on Tornado's event loop. The generator shares
those 4 OCPU with the stack; `bench_cores_max` and `host_cores_max` are what make that
readable.

## Cleanup

**4a** leaves environments behind — one per writer per level (`sw1_0`, `sw5_0`…), 91 in
total for the default levels, all inside `loadtest`. Delete them from that workspace
afterwards and revoke the API key when done. They also accumulate *across* levels, so
conc=50 runs with 41 envs already resident; negligible for `line`, roughly 18 MB for
`image`, and worth a sentence in any report.

**4b** cleans up after itself — see "Who creates the workspaces" above.

## Not here yet

Scenarios 1–3 (login storm, dashboard browse, visdom cold page load) are k6 and land in
`k6/`. Scenario 5 (viewer fan-out) is `viewbench.py`. See the design doc for the phasing.
