#!/usr/bin/env bash
#
# Runs a k6 scenario on the VM host with cpu_sample.py watching the gateway and
# Postgres, and appends one merged row to bench/results/.
#
#   ./bench/k6run.sh login          # scenario 1, login storm
#   BENCH_RATES=2,5 BENCH_STAGE=10 ./bench/k6run.sh login --smoke
#
# These scenarios stress the gateway, which visdom's own benchmarks never touch and
# which does not shard: every visdom instance calls it. If it saturates first, adding
# visdom instances buys nothing, so this is measured separately rather than folded
# into sweep.sh.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

SCENARIO="${1:-}"
if [[ -z "$SCENARIO" || ! -f "$HERE/k6/${SCENARIO}.js" ]]; then
  echo "k6run: pass a scenario name; available:" >&2
  ls "$HERE/k6" 2>/dev/null | sed 's/\.js$//' | sed 's/^/  /' >&2
  exit 2
fi

SMOKE=0
[[ "${2:-}" == "--smoke" ]] && SMOKE=1

cd "$ROOT"

# The gateway is uvicorn; Postgres forks a backend per connection, so both are matched
# by substring and summed rather than tracked as single pids.
WATCH=(--watch "gateway=uvicorn" --watch "db=postgres:")

if [[ "$SMOKE" -eq 1 ]]; then
  echo "k6run: smoke check ($SCENARIO)"
  probe="$(mktemp)"
  # k6 exits 0 even when handleSummary throws, so checking the exit code alone would
  # call a run that produced nothing a pass. Insist on the CSV row.
  BENCH_RATES=1 BENCH_STAGE=5 BENCH_USERS=2 \
    docker compose --profile bench run --rm --no-deps -T k6 \
      run --quiet "/scripts/${SCENARIO}.js" > "$probe" 2>&1 || true
  if ! grep -qE '^[0-9]{10},' "$probe"; then
    echo "k6run: smoke produced no result row; output was:" >&2
    cat "$probe" >&2
    rm -f "$probe"
    exit 1
  fi
  rm -f "$probe"
  echo "k6run: smoke passed"
  exit 0
fi

mkdir -p "$HERE/results"
STAMP="$(date +%F-%H%M)"
RESULTS="$HERE/results/${STAMP}-k6-${SCENARIO}.csv"
RAW="$HERE/results/${STAMP}-k6-${SCENARIO}-raw.csv"

DRIVER_HEADER="$(sed -n "s/^export const CSV_HEADER =$//p;s/^ *'\(.*\)';$/\1/p" \
  "$HERE/k6/${SCENARIO}.js" | tail -n 1)"
if [[ -z "$DRIVER_HEADER" ]]; then
  echo "k6run: ${SCENARIO}.js does not export CSV_HEADER" >&2
  exit 1
fi
SAMPLER_HEADER="$(python3 "$HERE/cpu_sample.py" "${WATCH[@]}" --print-header)"
echo "${DRIVER_HEADER},${SAMPLER_HEADER}" > "$RESULTS"

SUMMARY="$(mktemp)"
STDOUT="$(mktemp)"
ROW="$(mktemp)"

SAMPLER=""
cleanup() {
  if [[ -n "$SAMPLER" ]] && kill -0 "$SAMPLER" 2>/dev/null; then
    kill -TERM "$SAMPLER" 2>/dev/null || true
    wait "$SAMPLER" 2>/dev/null || true
  fi
  rm -f "$SUMMARY" "$STDOUT" "$ROW"
}
trap cleanup EXIT

echo "k6run: $SCENARIO rates=${BENCH_RATES:-default} stage=${BENCH_STAGE:-30}s"

python3 "$HERE/cpu_sample.py" "${WATCH[@]}" --raw "$RAW" --summary "$SUMMARY" &
SAMPLER=$!
sleep 2

docker compose --profile bench run --rm --no-deps -T k6 \
  run --quiet "/scripts/${SCENARIO}.js" > "$STDOUT" || {
    echo "k6run: k6 exited non-zero; its thresholds failed or the run errored." >&2
    echo "k6run: output was:" >&2
    cat "$STDOUT" >&2
    exit 1
  }

kill -TERM "$SAMPLER" 2>/dev/null || true
wait "$SAMPLER" 2>/dev/null || true
SAMPLER=""

grep -E '^[0-9]{10},' "$STDOUT" | tail -n 1 > "$ROW"
if [[ ! -s "$ROW" ]]; then
  echo "k6run: no result row from $SCENARIO; k6 output was:" >&2
  cat "$STDOUT" >&2
  exit 1
fi

paste -d, "$ROW" "$SUMMARY" >> "$RESULTS"

echo
echo "k6run: done -> $RESULTS"
column -s, -t < "$RESULTS"
