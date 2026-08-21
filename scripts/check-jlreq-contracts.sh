#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULT_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$RESULT_DIR"
}
trap cleanup EXIT

run_spec() {
  local name="$1"
  local spec="$ROOT/crates/boundtext/tests/fixtures/spec_cases/${name}.json"
  local result="$RESULT_DIR/${name}.json"

  cargo run -q -p boundtext-cli -- \
    --fonts fixtures/fonts \
    --input "$spec" \
    --pretty >"$result"

  pnpm exec tsx crates/boundtext/tools/diff-runner/src/check.ts "$result" "$spec"
}

cd "$ROOT"
run_spec ruby
run_spec kinsoku
run_spec vertical
