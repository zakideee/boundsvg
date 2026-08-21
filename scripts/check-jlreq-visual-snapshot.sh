#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="$ROOT/crates/boundtext/tests/fixtures/jlreq_regression/public/cases.json"
BASELINE="$ROOT/crates/boundtext/tests/fixtures/jlreq_regression/public/visual-hashes.sha256"
RESULTS="$(mktemp)"
SCREENSHOTS="$(mktemp -d)"
CURRENT="$(mktemp)"

cleanup() {
  rm -f "$RESULTS" "$CURRENT"
  rm -rf "$SCREENSHOTS"
}
trap cleanup EXIT

cd "$ROOT"

if [[ ! -f "$ROOT/packages/core/dist/index.js" || ! -f "$ROOT/packages/core/wasm-pkg/boundsvg_bg.wasm" ]]; then
  echo "Missing @boundsvg/core build artifacts. Run: pnpm build:wasm && pnpm --filter @boundsvg/shape build && pnpm --filter @boundsvg/core build" >&2
  exit 1
fi

cargo run -q -p boundtext-cli -- \
  --fonts fixtures/fonts \
  --input "$SPEC" \
  --pretty >"$RESULTS"

pnpm --filter @boundsvg/boundtext-visual-validator render -- \
  --spec "$SPEC" \
  --fonts "$ROOT/fixtures/fonts" \
  --screenshots "$SCREENSHOTS" \
  --bt-results "$RESULTS"

while IFS= read -r -d "" file; do
  filename="$(basename "$file")"
  hash="$(sha256sum "$file" | awk '{ print $1 }')"
  printf "%s  %s\n" "$hash" "$filename"
done < <(find "$SCREENSHOTS" -type f -name "*.boundsvg.png" -print0 | sort -z) >"$CURRENT"

diff -u "$BASELINE" "$CURRENT"
