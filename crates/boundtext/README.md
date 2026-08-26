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
- **Fit (shrink/grow)** — Certified binary refinement or bounded exact-grid search
- **Ellipsis** — Exact longest-legal-prefix projection with synthetic `…`
- **Rich text** — Mixed-style inline spans, ruby annotations (furigana)
- **Glyph outline extraction** — SVG path data from font glyph outlines
- **Variable fonts** — Variation axis support (e.g. `wght`)

## Installation

```bash
cargo add boundtext
```

The default feature set includes `unicode-full`, which provides UAX #29
extended-grapheme-cluster boundaries for wrapping and ellipsis. A
`--no-default-features` build still compiles, but uses the documented
per-code-point fallback in `grapheme_split`; enable `unicode-full` explicitly
when a custom feature set must preserve combining marks and multi-codepoint
emoji sequences.

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

`layout_text` and `layout_text_with_unit_metadata` return
`Result<TextLayoutResult, TextLayoutError>`. Preparation failure and
deterministic rich-depth, inline-rectangle, and ellipsis-budget exhaustion are
fatal; no partial result is returned. Rich resource validation happens before
recursive preparation.

### Shaping & Measurement

- Shaping produces **glyph ID + advance + offsets** via rustybuzz (HarfBuzz-compatible)
- Line width = sum of glyph advances + letter spacing
- Line height = `line_height_px` or `font_size_px × line_height`
- Vertical text uses `y_advance` for column height (falls back to `x_advance`)

### Line Breaking

**Wrap modes:**

| Mode   | Behavior                                        |
| ------ | ----------------------------------------------- |
| `Char` | Break at any extended grapheme-cluster boundary |
| `Word` | Break at whitespace, CJK boundaries, hyphens    |
| `None` | No wrapping (explicit newlines only)            |

`Word` mode consumes UAX #14 opportunities computed for the normalized source
or explicitly supplied by the caller. Japanese kinsoku can reject an otherwise
available UAX boundary. With the default `unicode-full` feature, `Char` and
`None` preserve extended grapheme clusters. The no-default fallback is
per-code-point as described under [Installation](#installation).

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

Fit always evaluates the complete authored document with ellipsis disabled.
A fit predicate uses endpoint checks and binary refinement only when both its
content metrics and (for flow) its provider are certified monotone. Negative
tracking or negative proportional line/ruby metrics invalidate the content
certificate even in ordinary rectangular layout. The conservative path uses
a descending exact grid and returns the largest fitting grid size:

| Mode   | Search range                                     | Default step / refinement |
| ------ | ------------------------------------------------ | ------------------------- |
| Shrink | `min_font_size_px` (default 8) → `font_size_px`  | 0.25 px / 12 iterations   |
| Grow   | `font_size_px` → `max_font_size_px` (default 4×) | 0.25 px / 12 iterations   |

`TextLayoutRequest::fit_max_probes` and
`FlowLayoutRequest::fit_max_probes` limit uncertified exact-grid work. The
default is 4,096 and the hard maximum is 65,536. A grid that exceeds the limit
returns `TextLayoutError::FitProbeLimit` or `BoundtextError::FitProbeLimit`
instead of an approximate size. Vertical text uses the same policy and checks
both column count and column height.

Candidate scaling applies uniformly to `font_size_px` and
`letter_spacing_px`. An explicit `line_height_px` remains absolute, while a
proportional `line_height` follows the candidate font size.

### Ellipsis

When `ellipsis=true` and the complete text exceeds `max_lines`, plain, span,
recursive rich, horizontal, vertical, and region-flow inputs are projected by
one policy:

1. Enumerate authored prefixes that respect extended grapheme clusters,
   atomic rich items, whitespace, UAX #14, and kinsoku.
2. Evaluate prefixes from longest to shortest without assuming shaped width is
   monotone in source length.
3. Re-shape the retained prefix at end-of-text and shape U+2026 as a separate
   synthetic run.
4. Commit only the first exact layout that satisfies all active constraints.

The marker has no authored source range. Omitted output and warnings are
discarded; marker warnings are retained. If the marker cannot fit, display ink
is empty while source metadata remains complete. At most 1,024 exact candidate
layouts are admitted after overflow is established; a larger maximum set
returns `TextLayoutError::EllipsisCandidateLimit` or
`BoundtextError::EllipsisCandidateLimit` before candidate materialization.

### Exclusion regions

Flow consumers implement one logical-axis `RegionProvider::regions` method.
The engine memoizes identical `RegionQuery` values and validates that returned
`FlowRegion` intervals are finite, non-negative, clipped, ordered, and
non-overlapping. One operation permits at most 65,536 distinct queries and
262,144 cumulative returned intervals. Provider invalidity or budget
exhaustion is a typed `BoundtextError`; it is never interpreted as an empty
region or a rejected fit/ellipsis candidate.

### Vertical Writing (vertical-rl)

- CJK characters render upright; Latin/ASCII rotate 90° clockwise
- Character orientation follows UTR#50 (`vertical_orientation` module)
- OpenType features: `vert` + `vkna` + `vkrn`
- Column width = line height; columns progress right-to-left
- Per-glyph vertical origin from VORG table or tsb+bbox fallback

### Rich Text

- **Inline spans** (`TextSpanInput`): Per-span font family, weight, style, size, color, letter spacing
- **Ruby annotations** (`RichTextNodeInput::Ruby`): Base text with `<rt>` annotation, configurable position and alignment

Ordinary spans adapt to the same rich planner as recursive rich text. Adjacent
paint-only changes (color, strokes, shadows, or decoration) do not reset
shaping; an indivisible cluster crossing such a boundary uses the paint of its
source-start grapheme. Nested `DecoratedSpan` nodes remain fragmentable in
normal and exclusion-flow layout, and every emitted fragment retains each
outer/inner `span_key` owner.

## Relationship to boundsvg

boundtext is extracted from [boundsvg](https://github.com/zakideee/boundsvg) and currently lives in the same monorepo as a Cargo workspace member. boundsvg depends on boundtext for all text layout.

boundtext is published on [crates.io](https://crates.io/crates/boundtext) and may eventually move to its own repository as external consumers emerge.

### Migration from the previous Rust contract

- Replace `Option` handling around `layout_text` and
  `layout_text_with_unit_metadata` with `Result` handling. Existing
  `.expect(...)` call sites continue to work; pattern matches change from
  `Some`/`None` to `Ok`/`Err`.
- Exhaustive matches over `TextLayoutError` / `BoundtextError` must handle
  `InvalidFitStep`, `FitProbeLimit`, `RichTextDepthLimit`, and
  `InlineRectLimit`. Direct layout and flow callers receive resource failures
  before shaping or querying exclusion geometry.
- Initialize `TextLayoutRequest::fit_max_probes` and
  `FlowLayoutRequest::fit_max_probes` in direct Rust struct literals. Use
  `None` for the 4,096-probe default or `Some(limit)` for a smaller explicit
  work budget; the hard maximum is 65,536.
- Replace the physical two-method `FlowRegionSource` implementation with
  `RegionProvider`. Return `Result<Vec<FlowRegion>, BoundtextError>` from the
  logical `RegionQuery`; implement `fit_search_kind` only when monotonicity is
  actually proven.
- Add `inline_box_decorations: Vec<InlineBoxDecoration>` when constructing a
  `FlowLayoutResult`. Plain flow uses an empty vector; rich flow forwards the
  materialized normal/region fragments.
- If you relied on a `TextSpanInput` boundary resetting kerning or contextual
  shaping, add an actual shaping-style difference. Paint-only boundaries now
  preserve one shaping run by contract.

These are breaking changes for the `0.x` Rust crate contract.

This release also adds `unicode-full` to the default feature set. Direct Rust
consumers that disable default features retain the smaller per-code-point
fallback and must opt into `unicode-full` for the extended-grapheme guarantees
used by the authoritative default and WASM builds.

## Known Limitations

### CLI Limitations (boundtext-cli)

1. **Ruby text**: The CLI only accepts plain text input (`text` field). Rich text with ruby annotations (`rich_text` field) is not yet supported. Ruby spec cases use plain text placeholders.

2. **Font fallback**: The CLI accepts a single `font_family` string. Multi-font fallback chains (`font_families` array) are not yet supported. Fallback spec cases use single-font configurations.

## License

Licensed under either of

- [Apache License, Version 2.0](../../LICENSE-APACHE)
- [MIT License](../../LICENSE-MIT)

at your option.
