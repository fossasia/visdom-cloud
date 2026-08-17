#!/usr/bin/env bash

# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.
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

BENCH_TOOL=sweep
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

HERE="$BENCH_HERE"
ROOT="$BENCH_ROOT"

KIND="${BENCH_KIND:-line}"
MODE="${BENCH_MODE:-proc}"
OPS="${BENCH_OPS:-50}"
WORKSPACE="${BENCH_WORKSPACE:-loadtest}"
LEVELS="${BENCH_LEVELS:-1 5 10 25 50}"
SETTLE="${BENCH_SETTLE:-10}"
PREFIX="${BENCH_PREFIX:-bench-}"

FLEET=0
SMOKE=0
VIEWERS=0
case "${1:-}" in
  --fleet) FLEET=1 ;;
  --smoke) SMOKE=1 ;;
  --viewers) VIEWERS=1 ;;
  "") ;;
  *) echo "sweep: unknown argument $1" >&2; exit 2 ;;
esac

SAMPLER_HEADER="$(bench_sampler_header)"

if [[ "$VIEWERS" -eq 1 ]]; then
  LEVELS="${BENCH_VIEWER_LEVELS:-1 10 25 50 100 200}"
  DRIVER_SCRIPT="viewbench.py"
  LEVEL_VAR="BENCH_VIEWERS"
  ROW_RE='^[0-9]{10},5,'
  RESULT_HEADER="ts,scenario,viewers,writes,rate,elapsed_s,expected,delivered,drop_pct,p50_ms,p95_ms,p99_ms,max_ms,$SAMPLER_HEADER"
else
  DRIVER_SCRIPT="writebench.py"
  LEVEL_VAR="BENCH_CONC"
  ROW_RE='^[0-9]{10},4[ab],'
  RESULT_HEADER="ts,scenario,kind,mode,conc,n_ops,elapsed_s,throughput,p50_ms,p95_ms,p99_ms,max_ms,errors,$SAMPLER_HEADER"
fi

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

driver() {
  bench_compose_run -e BENCH_WORKSPACE="$WORKSPACE" "$@" bench python "$DRIVER_SCRIPT"
}

if [[ "$SMOKE" -eq 1 ]]; then
  echo "sweep: smoke check (writes)"
  driver -e BENCH_SMOKE=1 >/dev/null
  echo "sweep: smoke check (fan-out)"
  DRIVER_SCRIPT="viewbench.py"
  driver -e BENCH_SMOKE=1 >/dev/null

  SHARD_COUNT=0
  if [[ -f .env ]]; then
    SHARD_COUNT="$(set +o pipefail
      sed -n 's/^VISDOM_SERVERS=//p' .env | grep -o 'server[[:space:]]' | wc -l | tr -d ' ')"
  fi
  echo "sweep: smoke check (sharding, expecting $SHARD_COUNT instances)"
  DRIVER_SCRIPT="shardcheck.py"
  driver -e BENCH_SHARDS="$SHARD_COUNT"

  echo "sweep: smoke passed"
  exit 0
fi

mkdir -p "$HERE/results"
STAMP="$(date +%F-%H%M)"
if [[ "$VIEWERS" -eq 1 ]]; then
  SCENARIO=5
  LABEL="${SCENARIO}-fanout"
else
  SCENARIO=$([[ "$FLEET" -eq 1 ]] && echo 4b || echo 4a)
  LABEL="${SCENARIO}-${KIND}"
fi
RESULTS="$HERE/results/${STAMP}-${LABEL}.csv"
RAWDIR="$HERE/results/${STAMP}-${LABEL}-raw"
MANIFEST="$HERE/results/${STAMP}-${SCENARIO}-fleet.json"
mkdir -p "$RAWDIR"

echo "$RESULT_HEADER" > "$RESULTS"

FLEET_UP=0
cleanup() {
  bench_sampler_stop
  if [[ "$FLEET_UP" -eq 1 ]]; then
    echo
    echo "sweep: tearing down the fleet"
    bench_compose_run -v "$MANIFEST:/bench/fleet.json:ro" bench \
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
  if ! bench_compose_run bench python fleet.py setup --count "$MAX" --prefix "$PREFIX" > "$MANIFEST"; then
    FLEET_UP=1
    echo "sweep: fleet setup failed; the partial manifest is at $MANIFEST" >&2
    exit 1
  fi
  FLEET_UP=1
  DRIVER_ARGS=(-v "$MANIFEST:/bench/fleet.json:ro" -e BENCH_FLEET=/bench/fleet.json)
fi

for level in $LEVELS; do
  echo
  if [[ "$VIEWERS" -eq 1 ]]; then
    echo "sweep: scenario 5 viewers=$level writes=${BENCH_WRITES:-50} rate=${BENCH_RATE:-10}/s"
  else
    echo "sweep: $SCENARIO kind=$KIND conc=$level ops=$OPS"
  fi

  summary="$(mktemp)"
  stdout="$(mktemp)"

  bench_sampler_start "$RAWDIR/level-${level}.csv" "$summary"

  driver "${DRIVER_ARGS[@]}" \
    -e "$LEVEL_VAR=$level" \
    -e BENCH_OPS="$OPS" \
    -e BENCH_KIND="$KIND" \
    -e BENCH_MODE="$MODE" \
    -e BENCH_WRITES="${BENCH_WRITES:-50}" \
    -e BENCH_RATE="${BENCH_RATE:-10}" \
    -e BENCH_TAG="sw${level}_" \
    > "$stdout"

  bench_sampler_stop
  bench_record_row "$stdout" "$summary" "$RESULTS" "$ROW_RE" "level=$level"
  rm -f "$summary" "$stdout"

  sleep "$SETTLE"
done

bench_report "$RESULTS"
