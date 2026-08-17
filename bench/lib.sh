# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

BENCH_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_ROOT="$(dirname "$BENCH_HERE")"
BENCH_TOOL="${BENCH_TOOL:-bench}"

bench_compose_run() {
  docker compose --profile bench run --rm --no-deps -T "$@"
}

bench_sampler_header() {
  python3 "$BENCH_HERE/cpu_sample.py" "$@" --print-header
}

BENCH_SAMPLER=""

bench_sampler_start() {
  local raw="$1" summary="$2"
  shift 2
  python3 "$BENCH_HERE/cpu_sample.py" "$@" --raw "$raw" --summary "$summary" &
  BENCH_SAMPLER=$!
  sleep 2
}

bench_sampler_stop() {
  if [[ -n "$BENCH_SAMPLER" ]] && kill -0 "$BENCH_SAMPLER" 2>/dev/null; then
    kill -TERM "$BENCH_SAMPLER" 2>/dev/null || true
    wait "$BENCH_SAMPLER" 2>/dev/null || true
  fi
  BENCH_SAMPLER=""
}

bench_record_row() {
  local stdout="$1" summary="$2" results="$3" pattern="$4" label="$5"
  local row
  row="$(grep -E "$pattern" "$stdout" | tail -n 1)"
  if [[ -z "$row" ]]; then
    echo "$BENCH_TOOL: no result row from $label; driver output was:" >&2
    cat "$stdout" >&2
    return 1
  fi
  paste -d, <(printf '%s\n' "$row") "$summary" >> "$results"
}

bench_report() {
  local results="$1"
  echo
  echo "$BENCH_TOOL: done -> $results"
  column -s, -t < "$results"
}
