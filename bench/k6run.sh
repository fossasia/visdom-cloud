#!/usr/bin/env bash

# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.
#
# Runs a k6 scenario on the VM host with cpu_sample.py watching, and appends one merged
# row to bench/results/.
#
#   ./bench/k6run.sh login          # scenario 1, login storm
#   BENCH_RATES=2,5 BENCH_STAGE=10 ./bench/k6run.sh login --smoke
#
# These scenarios stress the gateway, which visdom's own benchmarks never touch and
# which does not shard: every visdom instance calls it. If it saturates first, adding
# visdom instances buys nothing, so this is measured separately rather than folded
# into sweep.sh.
set -euo pipefail

BENCH_TOOL=k6run
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

SCENARIO="${1:-}"
DRIVER="$BENCH_HERE/k6/${SCENARIO}.js"
if [[ -z "$SCENARIO" || "$SCENARIO" == "lib" || ! -f "$DRIVER" ]]; then
  echo "k6run: pass a scenario name; available:" >&2
  ls "$BENCH_HERE/k6" 2>/dev/null | sed 's/\.js$//' | grep -v '^lib$' | sed 's/^/  /' >&2
  exit 2
fi

SMOKE=0
[[ "${2:-}" == "--smoke" ]] && SMOKE=1

cd "$BENCH_ROOT"

js_const() {
  sed -n "s/^export const $1 = *'\(.*\)';\$/\1/p" "$DRIVER" | tail -n 1
}

require_const() {
  local value
  value="$(js_const "$1")"
  if [[ -z "$value" ]]; then
    echo "k6run: ${SCENARIO}.js does not export $1" >&2
    exit 1
  fi
  printf '%s' "$value"
}

WATCH=()
for spec in $(require_const WATCH); do
  WATCH+=(--watch "$spec")
done

run_k6() {
  bench_compose_run k6 run --quiet "/scripts/${SCENARIO}.js"
}

if [[ "$SMOKE" -eq 1 ]]; then
  echo "k6run: smoke check ($SCENARIO)"
  probe="$(mktemp)"
  trap 'rm -f "$probe"' EXIT
  BENCH_RATES=1 BENCH_STAGE=5 BENCH_USERS=2 run_k6 > "$probe" 2>&1 || true
  if ! grep -qE '^[0-9]{10},' "$probe"; then
    echo "k6run: smoke produced no result row; output was:" >&2
    cat "$probe" >&2
    exit 1
  fi
  echo "k6run: smoke passed"
  exit 0
fi

mkdir -p "$BENCH_HERE/results"
STAMP="$(date +%F-%H%M)"
RESULTS="$BENCH_HERE/results/${STAMP}-k6-${SCENARIO}.csv"
RAW="$BENCH_HERE/results/${STAMP}-k6-${SCENARIO}-raw.csv"

echo "$(require_const CSV_HEADER),$(bench_sampler_header "${WATCH[@]}")" > "$RESULTS"

SUMMARY="$(mktemp)"
STDOUT="$(mktemp)"
cleanup() {
  bench_sampler_stop
  rm -f "$SUMMARY" "$STDOUT"
}
trap cleanup EXIT

echo "k6run: $SCENARIO rates=${BENCH_RATES:-default} stage=${BENCH_STAGE:-30}s"

bench_sampler_start "$RAW" "$SUMMARY" "${WATCH[@]}"

run_k6 > "$STDOUT" || {
  echo "k6run: k6 exited non-zero; its thresholds failed or the run errored." >&2
  echo "k6run: output was:" >&2
  cat "$STDOUT" >&2
  exit 1
}

bench_sampler_stop
bench_record_row "$STDOUT" "$SUMMARY" "$RESULTS" '^[0-9]{10},' "$SCENARIO"
bench_report "$RESULTS"
