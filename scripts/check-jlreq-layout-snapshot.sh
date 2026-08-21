#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="$ROOT/crates/boundtext/tests/fixtures/jlreq_regression/public/cases.json"
BASELINE="$ROOT/crates/boundtext/tests/fixtures/jlreq_regression/public/baseline.json"
RESULTS="$(mktemp)"
CURRENT="$(mktemp)"

cleanup() {
  rm -f "$RESULTS" "$CURRENT"
}
trap cleanup EXIT

cd "$ROOT"
cargo run -q -p boundtext-cli -- \
  --fonts fixtures/fonts \
  --input "$SPEC" \
  --pretty >"$RESULTS"

pnpm exec tsx crates/boundtext/tools/jlreq-regression/src/run.ts snapshot \
  --spec "$SPEC" \
  --results "$RESULTS" \
  --out "$CURRENT"

pnpm exec tsx crates/boundtext/tools/jlreq-regression/src/run.ts compare \
  --baseline "$BASELINE" \
  --current "$CURRENT"
