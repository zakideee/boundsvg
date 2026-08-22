# boundtext

Standalone left-to-right text layout engine in Rust — font shaping, line breaking, Japanese kinsoku, vertical text, and fit-to-bounds.

**bound** + **text** — Lay out text within specified bounds (max width/height), with automatic line wrapping, font size fitting, and Japanese typographic rules.

Scope: LTR only. Bidi and RTL reordering are not implemented, and the only line-break-prohibition profile is Japanese — there are no Chinese or Korean profiles.

## Features

- **Font shaping** via rustybuzz (HarfBuzz-compatible) — glyph IDs, advances, offsets
- **Font management** — registry with alias/weight/style resolution and multi-font fallback chains
- **Line breaking** — UAX#14 break opportunities, word/char/none wrap modes
- **Japanese kinsoku (禁則処理)** — JLREQ/JIS X 4051-informed line-break prohibition (head-prohibit, tail-prohibit, non-breaking pairs), enabled by `language: Ja`. A fixed `JaTypesettingV1` profile, not a conformance claim
- **Vertical writing** — `vertical-rl` with UTR#50 character orientation, OpenType `vert`/`vkna`/`vkrn` features, column-based layout
- **Fit (shrink/grow)** — Binary search to find the largest font size that fits within bounds
- **Ellipsis** — Grapheme-cluster-based truncation with `…`
- **Rich text** — Mixed-style inline spans, ruby annotations (furigana)
- **Glyph outline extraction** — SVG path data from font glyph outlines
- **Variable fonts** — Variation axis support (e.g. `wght`)

## Installation

```bash
cargo add boundtext
```

## Usage

```rust
use boundtext::font::{FontEntry, FontRegistry, FontStyle};
use boundtext::font::shaping;

let font_data = std::fs::read("path/to/font.ttf").unwrap();
let mut registry = FontRegistry::new();
registry.register(font_data, "MyFont".into(), 400, FontStyle::Normal).unwrap();

// Shape text
let entry = registry.resolve("MyFont", 400, &FontStyle::Normal).unwrap();
let glyphs = shaping::shape_text(entry, "Hello, 世界！", 24.0, 0.0);

// Use glyph info for rendering
for glyph in &glyphs {
    println!("glyph_id={}, x_advance={:.2}", glyph.glyph_id, glyph.x_advance);
}
```

## Text engine specification

### Input / Output

**Input (TextLayoutRequest):**

| Field                 | Description                                       |
| --------------------- | ------------------------------------------------- |
| `text`                | Input string                                      |
| `font_size_px`        | Font size in px                                   |
| `max_width`           | Maximum width constraint (px)                     |
| `max_height`          | Maximum height constraint (px, optional)          |
| `wrap`                | `None` / `Word` / `Char`                          |
| `fit`                 | `None` / `Shrink` / `Grow`                        |
| `max_lines`           | Maximum number of lines (optional)                |
| `ellipsis`            | Enable `…` truncation                             |
| `language`            | `Ja` / `En` / `Auto`                              |
| `writing_mode`        | `HorizontalTb` / `VerticalRl`                     |
| `line_height`         | Unitless multiplier (default 1.2)                 |
| `line_height_px`      | Absolute line height in px (overrides multiplier) |
| `letter_spacing_px`   | Letter spacing in px                              |
| `hanging_punctuation` | Enable hanging punctuation for vertical text      |

**Output (TextLayoutResult):**

| Field                 | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `lines`               | Array of lines, each with glyphs, width, baseline position |
| `chosen_font_size_px` | Final font size after fit adjustment                       |
| `bbox`                | Bounding box `{ x, y, w, h }`                              |
| `overflow`            | `none` / `overflow` / `kinsoku_unresolved` / `cannot_fit`  |

### Shaping & Measurement

- Shaping produces **glyph ID + advance + offsets** via rustybuzz (HarfBuzz-compatible)
- Line width = sum of glyph advances + letter spacing
- Line height = `line_height_px` or `font_size_px × line_height`
- Vertical text uses `y_advance` for column height (falls back to `x_advance`)

### Line Breaking

**Wrap modes:**

| Mode   | Behavior                                     |
| ------ | -------------------------------------------- |
| `Char` | Break at any character boundary              |
| `Word` | Break at whitespace, CJK boundaries, hyphens |
| `None` | No wrapping (explicit newlines only)         |

**Word boundary rules (wrap=Word):**

1. After ASCII whitespace (U+0020, U+0009)
2. Before/after CJK characters (Unified Ideographs, Hiragana, Katakana) — subject to kinsoku rules
3. After hyphens (U+002D, U+2010)

> `Word` mode still breaks CJK text at character boundaries, matching CSS `word-break: normal`.

### Japanese Kinsoku (禁則処理)

Line-break prohibition, enabled by `language: Ja` only. The character sets below
are the fixed `JaTypesettingV1` profile — informed by JLREQ and JIS X 4051, but
not a claim of conformance to either.

**Head-prohibit (行頭禁止):** Characters that must not appear at the start of a line:

```
、。，．・：；？！…‥
）］｝〕〉》」』】
〗〙゛゜‼⁇⁈⁉゠–—‐’”
｡､｣ﾞﾟ
```

Small kana, prolonged sound marks, wave dashes, and iteration marks are treated
as JLREQ level-3 choice characters and are **allowed** at line start in this
profile. They live in a stricter table that is not yet selectable:

```
ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ
ー〜～々〻ゝゞヽヾ
```

**Tail-prohibit (行末禁止):** Characters that must not appear at the end of a line:

```
（［｛〔〈《「『【
〖〘‘“｢
```

**Non-breaking pairs (分離禁止):**

- `——` (consecutive em dashes)
- `……` (consecutive ellipsis leaders)
- `‥‥` (consecutive two-dot leaders)

**Continuous kinsoku:** Consecutive head-prohibit characters (e.g. `」）。`) are treated as a single group and moved together.

### Fit (Shrink / Grow)

Binary search to find the optimal font size within bounds:

| Mode   | Search range                                     | Convergence                 |
| ------ | ------------------------------------------------ | --------------------------- |
| Shrink | `min_font_size_px` (default 8) → `font_size_px`  | ε=0.25px, max 12 iterations |
| Grow   | `font_size_px` → `max_font_size_px` (default 4×) | Same convergence criteria   |

Vertical text uses dedicated fit functions that check both column count and column height.

### Ellipsis

When `ellipsis=true` and text overflows:

1. Binary-search the largest grapheme count whose text plus `…` (U+2026) fits
2. Refine the boundary with a small linear scan
3. If even a single cluster with `…` overflows → `overflow = cannot_fit`

### Vertical Writing (vertical-rl)

- CJK characters render upright; Latin/ASCII rotate 90° clockwise
- Character orientation follows UTR#50 (`vertical_orientation` module)
- OpenType features: `vert` + `vkna` + `vkrn`
- Column width = line height; columns progress right-to-left
- Per-glyph vertical origin from VORG table or tsb+bbox fallback

### Rich Text

- **Inline spans** (`TextSpanInput`): Per-span font family, weight, style, size, color, letter spacing
- **Ruby annotations** (`RichTextNodeInput::Ruby`): Base text with `<rt>` annotation, configurable position and alignment

## Relationship to boundsvg

boundtext is extracted from [boundsvg](https://github.com/zakideee/boundsvg) and currently lives in the same monorepo as a Cargo workspace member. boundsvg depends on boundtext for all text layout.

boundtext is published on [crates.io](https://crates.io/crates/boundtext) and may eventually move to its own repository as external consumers emerge.

## Known Limitations

### CLI Limitations (boundtext-cli)

1. **Ruby text**: The CLI only accepts plain text input (`text` field). Rich text with ruby annotations (`rich_text` field) is not yet supported. Ruby spec cases use plain text placeholders.

2. **Font fallback**: The CLI accepts a single `font_family` string. Multi-font fallback chains (`font_families` array) are not yet supported. Fallback spec cases use single-font configurations.

## License

Licensed under either of

- [Apache License, Version 2.0](../../LICENSE-APACHE)
- [MIT License](../../LICENSE-MIT)

at your option.
