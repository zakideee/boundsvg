#!/usr/bin/env bash
# generate-report.sh — Deterministic layout validation report generation
#
# Usage:  ./scripts/generate-report.sh [--skip-build] [--skip-browser] [--skip-boundsvg] [--ids id1,id2]
#
# This script runs the full pipeline with fixed paths and options so that
# the output (reports/layout-report.html, reports/data/, reports/screenshots/)
# is reproducible regardless of who runs it.
#
# Prerequisites:
#   - Rust toolchain (cargo)
#   - Node.js ≥ 22
#   - Playwright browsers: npx playwright install chromium firefox
#   - (Optional) @boundsvg/core built: pnpm build:wasm && pnpm --filter @boundsvg/shape build && pnpm --filter @boundsvg/core build
#
# Must be run from: crates/boundtext/

set -euo pipefail

# ---------------------------------------------------------------------------
# Fixed paths (relative to crates/boundtext/)
# ---------------------------------------------------------------------------
CRATE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$CRATE_ROOT/../.." && pwd)"
FONTS_DIR="$REPO_ROOT/fixtures/fonts"
SPEC_DIR="$CRATE_ROOT/tests/fixtures/spec_cases"
DATA_DIR="$CRATE_ROOT/reports/data"
SCREENSHOTS_DIR="$CRATE_ROOT/reports/screenshots"
REPORT_OUTPUT="$CRATE_ROOT/reports/layout-report.html"
CLI_BIN="$REPO_ROOT/target/release/boundtext-cli"

# Tool directories
BROWSER_RUNNER="$CRATE_ROOT/tools/browser-runner"
BOUNDSVG_RUNNER="$REPO_ROOT/packages/boundtext-visual-validator"
REPORT_GENERATOR="$CRATE_ROOT/tools/report-generator"

# Browser engines for comparison
BROWSER_TYPE="both"  # chromium + firefox

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
SKIP_BUILD=false
SKIP_BROWSER=false
SKIP_BOUNDSVG=false
FILTER_IDS=""

for arg in "$@"; do
  case "$arg" in
    --skip-build)    SKIP_BUILD=true ;;
    --skip-browser)  SKIP_BROWSER=true ;;
    --skip-boundsvg) SKIP_BOUNDSVG=true ;;
    --ids=*)         FILTER_IDS="${arg#--ids=}" ;;
    --ids)           shift; FILTER_IDS="$1" ;;  # handled below
    --help|-h)
      echo "Usage: $0 [--skip-build] [--skip-browser] [--skip-boundsvg] [--ids id1,id2]"
      echo ""
      echo "Options:"
      echo "  --skip-build      Skip cargo build (use existing boundtext-cli binary)"
      echo "  --skip-browser    Skip browser comparison (only run boundtext layout)"
      echo "  --skip-boundsvg   Skip boundsvg WASM rendering"
      echo "  --ids id1,id2     Run only specified case IDs"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

cd "$CRATE_ROOT"

# ---------------------------------------------------------------------------
# Step 1: Build boundtext-cli
# ---------------------------------------------------------------------------
if [ "$SKIP_BUILD" = false ]; then
  echo "=== Step 1: Building boundtext-cli (release) ==="
  cargo build --release -p boundtext-cli --manifest-path "$REPO_ROOT/Cargo.toml"
else
  echo "=== Step 1: Skipped (--skip-build) ==="
fi

if [ ! -f "$CLI_BIN" ]; then
  echo "ERROR: boundtext-cli not found at $CLI_BIN"
  echo "Run without --skip-build or build manually: cargo build --release -p boundtext-cli"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Run boundtext layout on all spec cases
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 2: Running boundtext layout ==="
mkdir -p "$DATA_DIR"

for spec in "$SPEC_DIR"/*.json; do
  name=$(basename "$spec" .json)
  outfile="$DATA_DIR/boundtext-${name}.json"

  if [ -n "$FILTER_IDS" ]; then
    echo "  $name (filtered: $FILTER_IDS)"
    "$CLI_BIN" --fonts "$FONTS_DIR" --input "$spec" --id "$FILTER_IDS" > "$outfile" 2>/dev/null || true
  else
    echo "  $name"
    "$CLI_BIN" --fonts "$FONTS_DIR" --input "$spec" > "$outfile" 2>/dev/null || true
  fi
done

# ---------------------------------------------------------------------------
# Step 3: Browser comparison (Chromium + Firefox)
# ---------------------------------------------------------------------------
if [ "$SKIP_BROWSER" = false ]; then
  echo ""
  echo "=== Step 3: Browser comparison ==="
  cd "$BROWSER_RUNNER"
  npm install --silent 2>/dev/null

  for spec in "$SPEC_DIR"/*.json; do
    name=$(basename "$spec" .json)
    bt_results="$DATA_DIR/boundtext-${name}.json"
    browser_output="$DATA_DIR/browser-${name}-${BROWSER_TYPE}.json"

    IDS_OPT=""
    if [ -n "$FILTER_IDS" ]; then
      IDS_OPT="--ids $FILTER_IDS"
    fi

    BT_OPT=""
    if [ -f "$bt_results" ]; then
      BT_OPT="--bt-results $bt_results"
    fi

    echo "  $name"
    # --ids filter may not match any case in this spec file; allow non-zero exit
    npx tsx src/run.ts \
      --spec "$spec" \
      --fonts "$FONTS_DIR" \
      --browser "$BROWSER_TYPE" \
      --output "$browser_output" \
      --screenshots "$SCREENSHOTS_DIR" \
      $BT_OPT \
      $IDS_OPT || true
  done

  cd "$CRATE_ROOT"
else
  echo ""
  echo "=== Step 3: Skipped (--skip-browser) ==="
fi

# ---------------------------------------------------------------------------
# Step 3.5: boundsvg WASM rendering
# ---------------------------------------------------------------------------
if [ "$SKIP_BOUNDSVG" = false ]; then
  echo ""
  echo "=== Step 3.5: boundsvg WASM rendering ==="

  # Check if @boundsvg/core is built
  if [ ! -f "$REPO_ROOT/packages/core/dist/index.js" ]; then
    echo "WARNING: @boundsvg/core not built. Skipping boundsvg rendering."
    echo "Build with: pnpm build:wasm && pnpm --filter @boundsvg/shape build && pnpm --filter @boundsvg/core build"
  else
    cd "$BOUNDSVG_RUNNER"
    pnpm install --silent 2>/dev/null

    for spec in "$SPEC_DIR"/*.json; do
      name=$(basename "$spec" .json)
      bt_results="$DATA_DIR/boundtext-${name}.json"

      IDS_OPT=""
      if [ -n "$FILTER_IDS" ]; then
        IDS_OPT="--ids $FILTER_IDS"
      fi

      BT_OPT=""
      if [ -f "$bt_results" ]; then
        BT_OPT="--bt-results $bt_results"
      fi

      echo "  $name"
      npx tsx src/run.ts \
        --spec "$spec" \
        --fonts "$FONTS_DIR" \
        --screenshots "$SCREENSHOTS_DIR" \
        $BT_OPT \
        $IDS_OPT || true
    done

    cd "$CRATE_ROOT"
  fi
else
  echo ""
  echo "=== Step 3.5: Skipped (--skip-boundsvg) ==="
fi

# ---------------------------------------------------------------------------
# Step 4: Generate HTML report
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 4: Generating HTML report ==="
cd "$REPORT_GENERATOR"
npm install --silent 2>/dev/null

npx tsx src/generate.ts \
  --spec-dir "$SPEC_DIR" \
  --bt-dir "$DATA_DIR" \
  --browser-dir "$DATA_DIR" \
  --screenshots "$SCREENSHOTS_DIR" \
  --output "$REPORT_OUTPUT"

cd "$CRATE_ROOT"

echo ""
echo "=== Done ==="
echo "Report: $REPORT_OUTPUT"
