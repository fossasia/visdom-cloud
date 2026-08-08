#!/usr/bin/env bash
#
# Drives a concurrency sweep on the VM host: for each level it starts cpu_sample.py,
# runs the load generator in the bench container, stops the sampler, and appends one
# merged row to bench/results/.
#
#   VISDOM_API_KEY=... ./bench/sweep.sh                 # 4a, one workspace
#   VISDOM_API_KEY=... BENCH_KIND=image ./bench/sweep.sh
#   BENCH_EMAIL=... BENCH_PASSWORD=... ./bench/sweep.sh --fleet   # 4b, one per writer
#   VISDOM_API_KEY=... ./bench/sweep.sh --smoke
#
# --fleet creates a throwaway workspace and key per writer before the sweep and removes
# them afterwards, including on Ctrl-C or failure. If teardown is ever missed, clean up
# by hand with:
#
#   docker compose --profile bench run --rm -T bench \
#     python fleet.py teardown --prefix bench- --discover
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

KIND="${BENCH_KIND:-line}"
MODE="${BENCH_MODE:-proc}"
OPS="${BENCH_OPS:-50}"
WORKSPACE="${BENCH_WORKSPACE:-loadtest}"
LEVELS="${BENCH_LEVELS:-1 5 10 25 50}"
SETTLE="${BENCH_SETTLE:-10}"
PREFIX="${BENCH_PREFIX:-bench-}"

FLEET=0
SMOKE=0
case "${1:-}" in
  --fleet) FLEET=1 ;;
  --smoke) SMOKE=1 ;;
  "") ;;
  *) echo "sweep: unknown argument $1" >&2; exit 2 ;;
esac

if [[ "$FLEET" -eq 1 ]]; then
  if [[ -z "${BENCH_EMAIL:-}" || -z "${BENCH_PASSWORD:-}" ]]; then
    echo "sweep: --fleet needs BENCH_EMAIL and BENCH_PASSWORD to create workspaces." >&2
    exit 1
  fi
elif [[ -z "${VISDOM_API_KEY:-}" ]]; then
  echo "sweep: VISDOM_API_KEY is not set. Export it, do not paste it into a file." >&2
  exit 1
fi

cd "$ROOT"

compose_run() {
  docker compose --profile bench run --rm --no-deps -T "$@"
}

driver() {
  compose_run -e BENCH_WORKSPACE="$WORKSPACE" "$@" bench python writebench.py
}

if [[ "$SMOKE" -eq 1 ]]; then
  echo "sweep: smoke check (1 writer, 2 writes)"
  driver -e BENCH_SMOKE=1 >/dev/null
  echo "sweep: smoke passed"
  exit 0
fi

mkdir -p "$HERE/results"
STAMP="$(date +%F-%H%M)"
SCENARIO=$([[ "$FLEET" -eq 1 ]] && echo 4b || echo 4a)
RESULTS="$HERE/results/${STAMP}-${SCENARIO}-${KIND}.csv"
RAWDIR="$HERE/results/${STAMP}-${SCENARIO}-${KIND}-raw"
MANIFEST="$HERE/results/${STAMP}-${SCENARIO}-fleet.json"
mkdir -p "$RAWDIR"

echo "ts,scenario,kind,mode,conc,n_ops,elapsed_s,throughput,p50_ms,p95_ms,p99_ms,max_ms,errors,visdom_cores_mean,visdom_cores_max,bench_cores_max,host_cores_max,visdom_rss_mb_max,samples" > "$RESULTS"

SAMPLER=""
FLEET_UP=0
cleanup() {
  if [[ -n "$SAMPLER" ]] && kill -0 "$SAMPLER" 2>/dev/null; then
    kill -TERM "$SAMPLER" 2>/dev/null || true
    wait "$SAMPLER" 2>/dev/null || true
  fi
  if [[ "$FLEET_UP" -eq 1 ]]; then
    echo
    echo "sweep: tearing down the fleet"
    compose_run -v "$MANIFEST:/bench/fleet.json:ro" bench \
      python fleet.py teardown --manifest /bench/fleet.json || {
        echo "sweep: teardown failed. Clean up with:" >&2
        echo "  docker compose --profile bench run --rm -T bench \\" >&2
        echo "    python fleet.py teardown --prefix $PREFIX --discover" >&2
      }
    FLEET_UP=0
  fi
}
trap cleanup EXIT

DRIVER_ARGS=()
if [[ "$FLEET" -eq 1 ]]; then
  MAX=0
  for level in $LEVELS; do [[ "$level" -gt "$MAX" ]] && MAX="$level"; done
  echo "sweep: creating $MAX workspaces and keys (prefix $PREFIX)"
  if ! compose_run bench python fleet.py setup --count "$MAX" --prefix "$PREFIX" > "$MANIFEST"; then
    FLEET_UP=1
    echo "sweep: fleet setup failed; the partial manifest is at $MANIFEST" >&2
    exit 1
  fi
  FLEET_UP=1
  DRIVER_ARGS=(-v "$MANIFEST:/bench/fleet.json:ro" -e BENCH_FLEET=/bench/fleet.json)
fi

for level in $LEVELS; do
  echo
  echo "sweep: $SCENARIO kind=$KIND conc=$level ops=$OPS"

  raw="$RAWDIR/conc-${level}.csv"
  summary="$(mktemp)"
  stdout="$(mktemp)"
  row="$(mktemp)"

  python3 "$HERE/cpu_sample.py" --raw "$raw" --summary "$summary" &
  SAMPLER=$!
  sleep 2

  driver "${DRIVER_ARGS[@]}" \
    -e BENCH_CONC="$level" \
    -e BENCH_OPS="$OPS" \
    -e BENCH_KIND="$KIND" \
    -e BENCH_MODE="$MODE" \
    -e BENCH_TAG="sw${level}_" \
    > "$stdout"

  kill -TERM "$SAMPLER" 2>/dev/null || true
  wait "$SAMPLER" 2>/dev/null || true
  SAMPLER=""

  grep -E "^[0-9]{10},4[ab]," "$stdout" | tail -n 1 > "$row"
  if [[ ! -s "$row" ]]; then
    echo "sweep: no result row from conc=$level; driver output was:" >&2
    cat "$stdout" >&2
    exit 1
  fi

  paste -d, "$row" "$summary" >> "$RESULTS"
  rm -f "$summary" "$stdout" "$row"

  sleep "$SETTLE"
done

echo
echo "sweep: done -> $RESULTS"
column -s, -t < "$RESULTS"
