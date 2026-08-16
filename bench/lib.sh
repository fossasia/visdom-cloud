# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

# Shared plumbing for the bench runners, sourced by sweep.sh and k6run.sh.
#
# Both do the same thing around a different driver: start the sampler, run a
# profile-gated container, then merge the driver's one result row with the sampler's
# one summary row into results/. Only the driver differs, so everything around it
# lives here rather than in both.
#
# Callers set BENCH_TOOL to their own name so messages stay attributable.

BENCH_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_ROOT="$(dirname "$BENCH_HERE")"
BENCH_TOOL="${BENCH_TOOL:-bench}"

bench_compose_run() {
  docker compose --profile bench run --rm --no-deps -T "$@"
}

# The sampler owns its column names, so ask rather than repeat them; the two drifting
# apart would silently mislabel every result file.
bench_sampler_header() {
  python3 "$BENCH_HERE/cpu_sample.py" "$@" --print-header
}

BENCH_SAMPLER=""

# The lead-in is deliberate: the sampler's first delta would otherwise cover only the
# gap since exec rather than a full interval.
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

# A driver that produced no row is a failed run rather than an empty one, and has to say
# so: k6 in particular exits 0 even when its summary handler throws, so an exit code
# alone would call a run that measured nothing a pass.
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
