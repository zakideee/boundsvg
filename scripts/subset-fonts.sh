#!/usr/bin/env bash
# subset-fonts.sh — Download and subset fonts for boundsvg tests and demos.
#
# Prerequisites:
#   pip install fonttools brotli
#
# Usage:
#   bash scripts/subset-fonts.sh
#
# This script downloads four Japanese faces, subsets them to Joyo kanji
# (常用漢字 2,136) + Hiragana + Katakana + Latin + CJK punctuation, and writes the
# results into fixtures/fonts/. Two are instanced to a static weight=400, one is
# already static upstream, and the fourth deliberately keeps its weight axis so
# the variable-font tests and demos have something to move.
#
# Fonts, where each is downloaded from, and how each is processed:
#   - Noto Sans JP (Variable TTF)     — google/fonts ofl/notosansjp
#       instanced to weight=400, then subset to TTF + WOFF2
#   - Noto Serif JP (Variable TTF)    — google/fonts ofl/notoserifjp
#       instanced to weight=400, then subset to TTF + WOFF2
#   - Zen Maru Gothic (Static TTF)    — google/fonts ofl/zenmarugothic
#       subset to TTF + WOFF2
#   - Noto Sans CJK JP (Variable TTF) — notofonts/noto-cjk Sans/Variable/TTF
#       subset with the wght axis kept; TTF only, no WOFF2
#
# The code fonts (JetBrains Mono, Monaspace Neon) and Inter-Variable.ttf are
# committed as distributed upstream and are not touched by this script.
#
# All fonts are licensed under the SIL Open Font License 1.1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/fixtures/fonts"
JOYO_FILE="$SCRIPT_DIR/joyo-kanji.txt"
TEMP_DIR="$(mktemp -d)"

trap 'rm -rf "$TEMP_DIR"' EXIT

# ─── Unicode ranges (non-kanji) ──────────────────────────────────────────────
# Kanji are specified via --text-file (Joyo kanji list) instead of ranges,
# because the full CJK Unified Ideographs block (U+4E00-9FFF) contains ~21,000
# codepoints while we only need the 2,136 Joyo kanji.
#
# These ranges cover everything else needed for tests and the playground:
UNICODES=$(cat <<'EOF'
U+0020-007E,
U+00A0-00FF,
U+2000-206F,
U+2190-21FF,
U+3000-303F,
U+3040-309F,
U+30A0-30FF,
U+F900-FAFF,
U+FE30-FE4F,
U+FF00-FF9F
EOF
)
# Remove newlines for pyftsubset
UNICODES="${UNICODES//$'\n'/}"

# ─── Source URLs ──────────────────────────────────────────────────────────────
NOTO_SANS_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
NOTO_SERIF_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf"
ZEN_MARU_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/zenmarugothic/ZenMaruGothic-Regular.ttf"
NOTO_SANS_CJK_URL="https://github.com/notofonts/noto-cjk/raw/main/Sans/Variable/TTF/NotoSansCJKjp-VF.ttf"

echo "=== Downloading fonts ==="

curl -fSL -o "$TEMP_DIR/NotoSansJP-Variable.ttf" "$NOTO_SANS_URL"
echo "  Downloaded Noto Sans JP (variable)"

curl -fSL -o "$TEMP_DIR/NotoSerifJP-Variable.ttf" "$NOTO_SERIF_URL"
echo "  Downloaded Noto Serif JP (variable)"

curl -fSL -o "$TEMP_DIR/ZenMaruGothic-Regular.ttf" "$ZEN_MARU_URL"
echo "  Downloaded Zen Maru Gothic (static)"

curl -fSL -o "$TEMP_DIR/NotoSansCJKjp-VF.ttf" "$NOTO_SANS_CJK_URL"
echo "  Downloaded Noto Sans CJK JP (variable)"

# ─── Instance variable fonts to weight=400 ────────────────────────────────────
# Noto Sans JP and Noto Serif JP are distributed as variable fonts (multiple
# weights in one file). We drop variable-font tables to produce a smaller
# static TTF at the default weight (400).
echo ""
echo "=== Instancing variable fonts to weight=400 ==="

instance_font() {
  local input="$1"
  local output="$2"
  python3 -c "
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
font = TTFont('$input')
instance = instantiateVariableFont(font, {'wght': 400}, updateFontNames=True)
instance.save('$output')
instance.close()
"
  echo "  Instanced $(basename "$input") → $(basename "$output")"
}

instance_font "$TEMP_DIR/NotoSansJP-Variable.ttf" "$TEMP_DIR/NotoSansJP-Regular.ttf"
instance_font "$TEMP_DIR/NotoSerifJP-Variable.ttf" "$TEMP_DIR/NotoSerifJP-Regular.ttf"

# ─── Subset fonts ─────────────────────────────────────────────────────────────
echo ""
echo "=== Subsetting fonts ==="

subset_font() {
  local input="$1"
  local output_base="$2"

  local common_opts=(
    --unicodes="$UNICODES"
    --text-file="$JOYO_FILE"
    --layout-features='*'
    --no-hinting
    --desubroutinize
  )

  # TTF output
  pyftsubset "$input" "${common_opts[@]}" \
    --output-file="$OUTPUT_DIR/${output_base}.subset.ttf"
  echo "  → ${output_base}.subset.ttf"

  # WOFF2 output
  pyftsubset "$input" "${common_opts[@]}" \
    --flavor=woff2 \
    --output-file="$OUTPUT_DIR/${output_base}.subset.woff2"
  echo "  → ${output_base}.subset.woff2"
}

subset_font "$TEMP_DIR/NotoSansJP-Regular.ttf" "NotoSansJP-Regular"
subset_font "$TEMP_DIR/NotoSerifJP-Regular.ttf" "NotoSerifJP-Regular"
subset_font "$TEMP_DIR/ZenMaruGothic-Regular.ttf" "ZenMaruGothic-Regular"

# ─── Subset NotoSansCJKjp variable font (keep wght axis) ────────────────────
# Unlike Noto Sans JP and Noto Serif JP, which are instanced to weight=400, this
# font remains variable to test variable font functionality. Subset matches the other
# Japanese fonts: Joyo kanji + hiragana + katakana + Latin + CJK punctuation.
echo ""
echo "=== Subsetting NotoSansCJKjp (variable, keep wght axis) ==="

pyftsubset "$TEMP_DIR/NotoSansCJKjp-VF.ttf" \
  --text-file="$SCRIPT_DIR/joyo-kanji.txt" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2000-206F,U+2190-21FF,U+3000-303F,U+3040-309F,U+30A0-30FF,U+F900-FAFF,U+FE30-FE4F,U+FF00-FF9F" \
  --layout-features='*' \
  --no-hinting \
  --desubroutinize \
  --output-file="$OUTPUT_DIR/NotoSansCJKjp-VF.subset.ttf"
echo "  → NotoSansCJKjp-VF.subset.ttf"

# ─── Report ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Done ==="
echo ""
ls -lh "$OUTPUT_DIR"/*.subset.{ttf,woff2} 2>/dev/null | awk '{print "  " $5 "  " $NF}'
echo ""
total=$(du -cb "$OUTPUT_DIR"/*.subset.{ttf,woff2} 2>/dev/null | tail -1 | awk '{print $1}')
echo "Total: $(echo "scale=1; $total / 1048576" | bc) MB"
