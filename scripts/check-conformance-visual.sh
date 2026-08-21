#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$ROOT/fixtures/conformance/visual-hashes.sha256"
LEDGER="$ROOT/fixtures/conformance/known-diffs.json"
RENDER_DIR="$(mktemp -d)"
CURRENT="$RENDER_DIR/hashes.sha256"
UPDATE_MODE=0
if [[ "${1:-}" == "--update" ]]; then
  UPDATE_MODE=1
fi

cleanup() {
  rm -rf "$RENDER_DIR"
}
# In update mode the rendered PNGs are the review artifact — keep them.
if [[ "$UPDATE_MODE" -eq 0 ]]; then
  trap cleanup EXIT
fi

cd "$ROOT"

if [[ ! -f "$ROOT/packages/core/wasm-pkg/boundsvg_bg.wasm" ]]; then
  echo "Missing WASM package. Run: pnpm build:wasm" >&2
  exit 1
fi

npx tsx scripts/render-conformance-visual.mts --out "$RENDER_DIR" --hashes "$CURRENT"

if [[ "$UPDATE_MODE" -eq 1 ]]; then
  cp "$CURRENT" "$BASELINE"
  echo "Baseline updated: $BASELINE"
  echo "Rendered PNGs kept for review at: $RENDER_DIR"
  echo "Review them before committing (no silent updates), then delete the directory."
  exit 0
fi

node scripts/conformance-visual-compare.mjs \
  --baseline "$BASELINE" \
  --current "$CURRENT" \
  --ledger "$LEDGER"
