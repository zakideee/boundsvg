---
title: Text & Fonts
---

# Text & Fonts

## Registering Fonts

Fonts must be explicitly provided as binary data. OS font discovery is not supported — this ensures reproducible output across environments.

```ts
const engine = await createEngineAsync({
  fonts: [
    { alias: "NotoSansJP", data: regularData, weight: 400, style: "normal" },
    { alias: "NotoSansJP", data: boldData, weight: 700, style: "normal" },
    { alias: "NotoSansJP", data: italicData, weight: 400, style: "italic" },
  ],
});
```

### FontFaceInput

| Property | Type                   | Default    | Description                      |
| -------- | ---------------------- | ---------- | -------------------------------- |
| `alias`  | `string`               | —          | Name used in `<Text font="...">` |
| `data`   | `Uint8Array`           | —          | Font binary data                 |
| `weight` | `number`               | `400`      | Font weight                      |
| `style`  | `"normal" \| "italic"` | `"normal"` | Font style                       |

### Adding Fonts

Register the fonts you need at Engine creation time:

```ts
const engine = await createEngineAsync({
  fonts: [
    { alias: "NotoSansJP", data: regularData, weight: 400, style: "normal" },
    { alias: "NotoSansSymbols", data: symbolsData },
  ],
});
```

To add a font after creation — e.g. an editor loading a face on demand, or a
theme/icon pack — call `registerFonts()` on the live engine instead of
recreating it:

```ts
engine.registerFonts([
  { alias: "JetBrainsMono", data: monoData, weight: 400, style: "normal" },
]);
```

Registering an alias/weight/style combination that already exists throws.

### Where to get fonts

Fonts are supplied by you as binary data — nothing is bundled, and OS fonts are
never used. These open-license families are known to work well and cover the
common cases:

| Use case              | Family                         | License |
| --------------------- | ------------------------------ | ------- |
| Japanese / CJK sans   | Noto Sans JP / Noto Sans CJK   | OFL 1.1 |
| Japanese / CJK serif  | Noto Serif JP / Noto Serif CJK | OFL 1.1 |
| Latin UI / variable   | Inter (variable)               | OFL 1.1 |
| Monospace / code      | JetBrains Mono                 | OFL 1.1 |
| Broad symbol coverage | Noto Sans Symbols / Symbols 2  | OFL 1.1 |

For CJK, prefer a **subset** built for your character set — a full Noto Sans JP
is several MB, which dominates payload and cold-start on edge runtimes.

#### Node.js

```ts
import { readFileSync } from "node:fs";

const engine = await createEngineAsync({
  fonts: [
    { alias: "NotoSansJP", data: readFileSync("fonts/NotoSansJP-Regular.ttf") },
  ],
});
```

#### Browser

`@boundsvg/browser` provides a caching fetch helper so you fetch each font
once by URL:

```ts
import { preloadFonts } from "@boundsvg/browser/fonts";

const engine = await createEngineAsync({
  fonts: await preloadFonts([
    {
      alias: "NotoSansJP",
      weight: 400,
      style: "normal",
      source: "/fonts/NotoSansJP-Regular.ttf",
    },
  ]),
});
```

WOFF2, TTF, and OTF are accepted (WOFF2 is decoded on registration).

### Font Selection

- `font` prop selects by registered alias (not PostScript or family name)
- `fontWeight` / `fontStyle` select the closest matching face within the alias
- Weight: closest weight wins (simple distance)
- Style: normal preferred; italic synthesis is not supported

### Fallback Chain

Fallback is resolved **per run** — fonts can switch within the same text string.

```tsx
<Text
  font="NotoSansJP"
  fallback={["NotoSansSymbols", "NotoEmoji"]}
  fontSizePx={24}
>
  テキスト 🎉 with symbols ★
</Text>
```

Resolution order: main font → fallback chain → replacement glyph (□)

## Text Decoration and Inline Rectangles

`textDecoration` is available on `Text`, `TextOnPath`, `Inline`, `InlineBox`,
and `Rt`. Use an `Inline` range when only part of a paragraph or path source is
decorated:

```tsx
<Text font="NotoSansJP" fontSizePx={28} color="#e2e8f0">
  committed
  <Inline
    textDecoration={{
      line: "underline",
      style: "wavy",
      color: "#facc15",
      thicknessPx: 2,
      skipInk: "all",
    }}
  >
    composing
  </Inline>
</Text>
```

`line` accepts `"underline"`, `"overline"`, `"line-through"`, or a
non-empty array without duplicates. `style` defaults to `"solid"` and also
accepts `"double"`, `"dotted"`, `"dashed"`, and `"wavy"`; the default color is
the resolved text color. A finite `offsetPx` moves the automatic font-metric
position along the logical block-end axis, and positive finite `thicknessPx`
replaces the font metric. Patterns are resolved to filled paths in WASM rather
than emitted as viewer-native SVG strokes or dashes.

`skipInk` defaults to `"none"`. `skipInk: "all"` cuts underline and overline
geometry around the final resolved glyph fill outlines, including fallback,
variation, and missing-glyph tofu. Line-through remains continuous even when
it shares the same decoration object. Glyph strokes, shadows, backgrounds,
inline borders, and whitespace without an outline do not enlarge the skipped
ink region. A line-through-only object with `skipInk: "all"` is rejected
because the field would have no effect.

Decoration is inherited through base text. `textDecoration="none"` stops the
inherited value, while an inner object replaces it. Ruby base text inherits
the base decoration, but annotations must opt in with `Rt.textDecoration`.
Wrapped ranges resolve one strip per line or vertical column. Spaces remain
continuous, pattern phase resets at each wrapped line/column, and
decoration-only boundaries do not change shaping, source ranges, or UnitMap
identity. An effective decorated range in `Text` or `TextOnPath` combined with
`animateUnits` fails with `TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED` rather
than moving glyphs away from static decoration geometry. A decoration authored
only on empty content, or stopped with `"none"` across every non-empty range,
does not trigger the conflict.

`InlineRect` is a childless atomic rectangle for cursors and other inline
paint. It is allowed inside `Text`, `Inline`, or `InlineBox`:

```tsx
<Text font="JetBrainsMono" fontSizePx={22} whiteSpace="pre-wrap">
  $ pnpm test
  <InlineRect
    inlineSizePx={2}
    blockSizePx="line"
    advancePx={0}
    color="#67e8f9"
    animate={caretBlink}
  />
</Text>
```

`inlineSizePx` is required and positive. `blockSizePx` defaults to the line
extent; a numeric value can align at `"start"`, `"center"` (default), or
`"end"`. `advancePx` is non-negative and defaults to `0`, so the rectangle can
paint without changing the following text position. `paintOrder` defaults to
`"front"` and can be `"behind"`. Logical axes map the same props to width and
height in horizontal text and to height and width in `vertical-rl` text.

Invalid input is rejected with stable fatal error codes:

| Error code                                   | Condition                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `TEXT_DECORATION_INVALID`                    | Invalid line/style/color/number/`skipInk`, duplicate line, or unknown key  |
| `TEXT_DECORATION_SKIP_INK_UNSUPPORTED`       | `skipInk: "all"` without underline or overline                             |
| `TEXT_DECORATION_RANGE_LIMIT`                | More than 4,096 authored decoration ranges                                 |
| `TEXT_DECORATION_COMPLEXITY_LIMIT`           | More than 16,384 resolved decoration paths                                 |
| `TEXT_DECORATION_PATTERN_LIMIT`              | More than 65,536 contours or 262,144 line/curve segments                   |
| `TEXT_DECORATION_SKIP_INK_LIMIT`             | More than 16,384 tested glyphs or 1,048,576 candidate segment pairs        |
| `TEXT_DECORATION_GEOMETRY`                   | Pattern, intersection, reconstruction, or subtraction geometry failed      |
| `TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED` | Effective decorated `Text`/`TextOnPath` range combined with `animateUnits` |
| `INLINE_RECT_INVALID`                        | Invalid size, advance, color, opacity, radius, or enum                     |
| `INLINE_RECT_INVALID_PARENT`                 | `InlineRect` outside `Text`/`Inline`/`InlineBox`                           |
| `INLINE_RECT_COMPLEXITY_LIMIT`               | More than 4,096 inline rectangles in one `Text`                            |

Decoration limits are fatal and checked before or during geometry expansion;
boundsvg does not silently truncate a pattern or fall back from failed
skip-ink geometry to a continuous line. The same resolved decoration paths are
used by Node, browser, Worker, SVG, IR, and PNG routes.

## Glyph outline grouping (`textPathMode`)

Text is always rendered as `<path>` elements (glyph outlines). The SVG is self-contained — no browser font or CSS `@font-face` registration is required.

The `textPathMode` compile option controls how glyph outlines are
grouped for both `Text` and `TextOnPath`. Despite its historical name, this
render option does not place text on a path. Use the `TextOnPath` VNode for
layout along path geometry.

| Mode       | SVG output                | Description                                |
| ---------- | ------------------------- | ------------------------------------------ |
| `"merged"` | One `<path>` per line/run | Default. Smaller file size, not selectable |
| `"glyphs"` | One `<path>` per glyph    | Larger file size, useful for hit-testing   |

```ts
// Default: merged paths (one path per line)
const svg = engine.renderToSvg(vnode);

// Per-glyph paths
const svgGlyphs = engine.renderToSvg(vnode, { textPathMode: "glyphs" });
```

### PNG rendering

Raster output always uses the WASM-registered font internally (via resvg). The `textPathMode` setting has no visible effect on rasterized output.

## Text on an SVG Path

`TextOnPath` lays out one horizontal LTR source made from strings and nested
`Inline` nodes along exactly one open or authored-closed SVG path. It produces
positioned glyph outlines—not an SVG `<textPath>` element—so Node, browser,
Worker, SVG, IR, and PNG routes use the same shaping and resolved geometry.

```tsx
const d = "M20 140C100 24 320 24 400 140";

<Canvas width={420} height={180} background="#071827">
  <Path d={d} width={420} height={180} fill="none" stroke="#64748b" />
  <TextOnPath
    d={d}
    width={420}
    height={180}
    font="NotoSansJP"
    fontSizePx={28}
    color="#f8fafc"
    startOffsetPx={210}
    textAnchor="middle"
    pathDirection="forward"
    pathNormal="left"
    pathOffsetPx={6}
    pathFit="shrink"
    pathOverflow="ellipsis"
    textStrokes={[{ color: "#0e7490", widthPx: 4 }]}
    textDecoration={{
      line: "underline",
      style: "dashed",
      skipInk: "all",
      color: "#38bdf8",
    }}
  >
    曲線
    <Inline font="JetBrainsMono" color="#facc15" textDecoration="none">
      PATH
    </Inline>
    <Inline color="#f0abfc"> 日本語</Inline>
  </TextOnPath>
</Canvas>;
```

The required `width` and `height` form the Taffy layout frame. Path coordinates
are node-local px and are not scaled when the frame changes. `TextOnPath` does
not paint its guide; the separate `Path` above is optional.

| Prop             | Type                                         | Default     | Meaning                                                                        |
| ---------------- | -------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `d`              | `string`                                     | required    | Exactly one non-empty drawable open or authored-closed SVG subpath             |
| `width`/`height` | `number`                                     | required    | Positive finite layout-frame dimensions                                        |
| `startOffsetPx`  | `number`                                     | `0`         | Logical distance before anchor adjustment; absolute value is limited to `1e12` |
| `textAnchor`     | `"start" \| "middle" \| "end"`               | `"start"`   | Align fitted display advance around `startOffsetPx`                            |
| `pathDirection`  | `"forward" \| "reverse"`                     | `"forward"` | Select traversal distance and tangent without reversing logical source order   |
| `pathNormal`     | `"left" \| "right"`                          | `"left"`    | Select the side of the effective traversal tangent                             |
| `pathOffsetPx`   | `number`                                     | `0`         | Non-negative distance along the selected normal                                |
| `pathFit`        | `"none" \| "spacing" \| "scale" \| "shrink"` | `"none"`    | Fit the complete cluster sequence to the full path length                      |
| `pathOverflow`   | `"hidden" \| "error" \| "ellipsis"`          | `"hidden"`  | Omit off-window glyphs, fail, or replace the logical trailing part with U+2026 |
| `textDecoration` | `TextDecoration`                             | `"none"`    | Curved filled underline, overline, or line-through geometry                    |

Children must contain at least one non-empty string and may otherwise be
strings or nested `Inline` nodes. `Inline` accepts only `font`, `fallback`,
`fontWeight`, `fontStyle`, `fontVariationSettings`,
`fontFeatureSettings`, `fontSizePx`, `letterSpacingPx`, `language`, `color`,
`textStrokes`, `textShadows`, and `textDecoration`. Undefined values inherit.
Stroke and shadow arrays replace their complete category (`[]` clears it); a
decoration object starts a replacement owner range, while `"none"` stops an
inherited decoration. Empty Inline nodes are allowed but do not make the total
source non-empty.

Shaping keys and paint keys are resolved independently: a color/effect-only
boundary does not split shaping, and equivalent inherited shaping values merge.
An Inline boundary that would split a final grapheme/shaping cluster fails with
`TEXT_PATH_INLINE_CLUSTER_SPLIT` instead of assigning one glyph to two logical
ranges. A plain string and a single style-neutral Inline therefore preserve the
same source text, UnitMap, and positioned glyph geometry.

`pathDirection` and `pathNormal` are independent: reversing traversal changes
the sampled tangent, then `pathNormal` chooses its left or right side. Logical
children, source ranges, accessibility text, and UnitMap IDs stay in source
order. UnitMap members point to final positioned glyph indices; direction,
normal side, closed seams, and fitting can change physical pose without
renumbering logical units. Hidden units retain empty members, while a synthetic
ellipsis has no source range or UnitMap unit. The removed signed
`normalOffsetPx` prop is not an alias; use
`pathNormal` plus non-negative `pathOffsetPx`.

Only an authored `Z` closes a path. A coincident final endpoint without `Z`
remains open. Closed paths reduce `startOffsetPx` modulo the measured length,
but place at most one lap of glyph midpoints. Anchor-specific half-open seam
windows prevent the same point from being painted twice. Glyph outlines are
not clipped merely because their midpoint is visible near the seam.

Fitting is deterministic and does not re-shape with a different font size:

| `pathFit` | Behavior                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| `none`    | Keep original shaping advances                                                                   |
| `spacing` | Distribute the path-length difference over inter-cluster gaps only; one cluster is a no-op       |
| `scale`   | Scale glyph-local inline geometry, offsets, advances, and pens uniformly to the full path length |
| `shrink`  | Apply the same inline scale only when text is longer than the path; shorter text keeps scale `1` |

Each non-final cluster step after spacing must remain at least `0.01px`.
Inline scale must stay within `1/16..16` (`shrink` within `1/16..1`). Fitting
targets the full path length before anchor and start-offset placement; it does
not mean "fit into the remaining distance." It never changes `fontSizePx`,
block metrics, the authored path, or source identity.

With `pathOverflow="hidden"`, off-window glyph ink is omitted while original
logical/accessibility text remains. `"error"` throws `TEXT_PATH_OVERFLOW` for
any off-window glyph midpoint, including whitespace. `"ellipsis"` re-shapes a
fixed U+2026 with the first omitted cluster's effective shaping and paint
style, preserves the longest fitting logical source prefix, and keeps original
source/accessibility text separate from displayed text. The synthetic ellipsis
has no invented source offset or UnitMap unit. If even the ellipsis does not
fit, no glyph ink is painted but the original text metadata remains.

Curved decoration uses the same three lines and five filled styles as `Text`.
The authored root or explicit Inline replacement owns font metrics and one
continuous path-distance phase; inherited font and paint runs do not reset it.
Geometry follows the fitted traversal, normal side, and closed seam. With
`skipInk: "all"`, only positive-area intersections with final glyph **fill**
outlines remove underline/overline intervals; strokes and shadows are not ink,
and line-through remains continuous. Subtraction stays owner-local in measured
path distance so nearby branches of a self-approaching curve are not removed
together. Paint order is node-global: all shadows, underline/overline, all
strokes, fills, then line-through.

`InlineBox`, `InlineRect`, `Ruby`, and `Rt` are rejected. Newlines/tabs,
vertical writing, bidi reordering, wrapping, paragraph layout, flow exclusions,
and multiple drawable subpaths are also unsupported. Invalid or unsupported
input is fatal:

| Error code                                                        | Condition                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `TEXT_PATH_CHILD_UNSUPPORTED`                                     | Child other than string or `Inline`                                                         |
| `TEXT_PATH_INLINE_PROP_UNSUPPORTED`                               | Inline prop outside the shaping/paint/decoration allowlist                                  |
| `TEXT_PATH_INLINE_CLUSTER_SPLIT`                                  | Inline boundary splits one final shaping cluster                                            |
| `TEXT_PATH_WRITING_MODE_UNSUPPORTED`                              | Vertical/writing-mode prop                                                                  |
| `TEXT_PATH_MULTILINE_UNSUPPORTED`                                 | Newline or tab                                                                              |
| `TEXT_PATH_EMPTY_TEXT`                                            | Flattened string source is empty                                                            |
| `TEXT_PATH_INVALID`                                               | Invalid numeric/enum/style, negative `pathOffsetPx`, or unsupported root prop               |
| `TEXT_PATH_INVALID_DATA`                                          | Empty, malformed, unsupported-command, or non-finite path data                              |
| `TEXT_PATH_MULTIPLE_SUBPATHS_UNSUPPORTED`                         | Multiple drawable subpaths                                                                  |
| `TEXT_PATH_ZERO_LENGTH`                                           | Measured length below the supported minimum                                                 |
| `TEXT_PATH_SOURCE_LIMIT` / `TEXT_PATH_INLINE_LIMIT`               | Source bytes/items or Inline-container count exceeds its boundary                           |
| `TEXT_PATH_RUN_LIMIT` / `TEXT_PATH_PAINT_LIMIT`                   | Resolved shaping-run, paint-range, or aggregate paint-layer budget exceeded                 |
| `TEXT_DECORATION_RANGE_LIMIT`                                     | Authored root/Inline decoration-owner budget exceeded                                       |
| `TEXT_PATH_COMPLEXITY_LIMIT`                                      | More than 65,536 measured points or path recursion budget exceeded                          |
| `TEXT_PATH_DECORATION_LIMIT` / `TEXT_DECORATION_COMPLEXITY_LIMIT` | Curved decoration fragment/sample or final resolved-path budget exceeded                    |
| `TEXT_DECORATION_PATTERN_LIMIT`                                   | Filled pattern contour/segment budget exceeded                                              |
| `TEXT_DECORATION_SKIP_INK_LIMIT`                                  | Glyph/decoration boolean candidate-pair budget exceeded                                     |
| `TEXT_DECORATION_GEOMETRY`                                        | Curved offset, pattern, seam, or skip-ink geometry cannot be materialized deterministically |
| `TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED`                      | At least one effective decorated range is combined with `animateUnits`                      |
| `TEXT_PATH_OFFSET_LIMIT`                                          | Absolute `startOffsetPx` exceeds `1e12px`                                                   |
| `TEXT_PATH_CLUSTER_LIMIT`                                         | Fit/ellipsis input exceeds 16,384 shaping clusters                                          |
| `TEXT_PATH_FIT_UNSATISFIABLE`                                     | Spacing/scale limits cannot be satisfied, including after selected ellipsis recovery        |
| `TEXT_PATH_INLINE_SCALE_INVALID`                                  | Non-positive or non-finite resolved scale reached the outline trust boundary                |
| `TEXT_PATH_OVERFLOW`                                              | Off-window midpoint with `pathOverflow="error"`                                             |

The deterministic resource boundaries are cumulative per `TextOnPath` unless
the row says otherwise:

| Resource                                          |                    Maximum |
| ------------------------------------------------- | -------------------------: |
| Path source and flattened text source             | 1,048,576 UTF-8 bytes each |
| Authored string/Inline source items               |                     65,536 |
| Authored Inline containers                        |                      4,096 |
| Resolved shaping clusters used by fit/ellipsis    |                     16,384 |
| Resolved shaping runs / logical paint ranges      |                16,384 each |
| Aggregate fill/stroke/shadow layers across ranges |                     65,536 |
| Stroke or shadow layers in one category           |                          8 |
| Authored decoration ranges                        |                      4,096 |
| Curved decoration fragments                       |                     16,384 |
| Curved offset/wave samples                        |                    262,144 |
| Filled decoration contours / segments             |           65,536 / 262,144 |
| Glyphs / boolean candidate pairs for `skipInk`    |         16,384 / 1,048,576 |
| Animated text units / estimated paint fragments   |              4,096 / 8,192 |

Authorable source, style, offset, and enum constraints are checked in
TypeScript and again at the Rust trust boundary. Measured geometry, shaping,
paint, decoration, and animation limits are enforced before unbounded output
materialization; input is never truncated to fit a budget.
`animate` and `animateUnits` are post-layout opacity/transform tracks for
already positioned outlines. `animateUnits` requires every effective text
range to be decoration-free; a root decoration stopped by `"none"` for all
non-empty content is allowed. Changes to `d`, content, Inline
shaping/paint/decoration, font/layout inputs,
`startOffsetPx`, `textAnchor`, `pathDirection`, `pathNormal`, `pathOffsetPx`,
`pathFit`, or `pathOverflow` require a newly materialized static scene and full
layout. There is no native path morph, `startOffsetPx` track, repeated
closed-path text, or curve-normal outline warping. See
[Layout-reactive animation](/guides/animation#layout-reactive-animation).

## Text Wrapping

Three wrapping modes are available via the `wrap` prop:

### `wrap="none"`

No wrapping. Text is rendered as a single line. Overflow is clipped or triggers ellipsis.

### `wrap="word"`

Wraps at word boundaries:

1. After ASCII whitespace (U+0020, U+0009)
2. Before/after CJK characters (CJK Ideographs, Hiragana, Katakana)
3. After hyphens (U+002D, U+2010)

CJK characters effectively wrap per-character even in word mode (consistent with CSS `word-break: normal`).

### `wrap="char"` (default)

Every character boundary is a break opportunity. This is the default because the primary use case (telops — broadcast-style caption overlays) wraps CJK text per character.

## White-Space Handling

`whiteSpace` is available on `Text` in both VNode/JSX and
[SceneDocument](/getting-started/versioning#scene-documents) inputs.

| Value        | Collapse spaces | Preserve newlines | Allow wrapping |
| ------------ | --------------- | ----------------- | -------------- |
| `"normal"`   | Yes             | No                | Yes            |
| `"nowrap"`   | Yes             | No                | No             |
| `"pre-wrap"` | No              | Yes               | Yes            |

With `whiteSpace="pre-wrap"`, `tabSize` controls how many spaces replace each
tab. It defaults to `4` and must be a positive integer. Tabs are part of the
collapsed whitespace in the other modes.

## Flow around shapes

`Text` can resolve one coherent paragraph around local rect, circle, and filled
path exclusions. Set positive finite `width` and `height`, then pass
`flowExclusions`. The coordinates start at the Text frame's top-left corner.

A magazine-style example — the heading shrink-fits its row while the body flows
around a chart's circular exclusion:

<!--@include: ../_generated/figure-flow.md-->

```tsx
<Text
  font="NotoSansJP"
  fontSizePx={20}
  width={480}
  height={240}
  flowExclusions={[
    { kind: "rect", x: 48, y: 32, width: 120, height: 88, marginPx: 8 },
  ]}
>
  One Text node is shaped and laid out around the exclusion.
</Text>
```

Use `flowMinRegionWidthPx` to discard gaps too narrow for useful text. It
defaults to the resolved font size and follows the inline axis, so the same
prop filters vertical extents in `writingMode="vertical-rl"`. See the
[Text component reference](/components/text#flow-around-exclusions) for the
complete shape and margin types.

## Font Size Adjustment (fit)

### `fit="shrink"`

Select the largest font size that fits within constraints.

- Range: `minFontSizePx` (default 8) → `fontSizePx`
- Content and geometry that are both monotone-certified use
  `shrinkEpsilonPx` (default 0.25px) and `shrinkMaxIterations` (default 12) for
  binary refinement
- Negative tracking/proportional metrics and topology-changing exclusion flow
  use `shrinkEpsilonPx` as an exact-grid step and `fitMaxProbes` (default
  4,096; hard maximum 65,536) as the work limit
- If minimum font size still overflows: `overflow.type = "cannot_fit"`

```tsx
<Text font="NotoSansJP" fontSizePx={48} fit="shrink" minFontSizePx={12}>
  Long text that auto-shrinks to fit
</Text>
```

### `fit="grow"`

Select the largest fitting size above the initial size.

- Range: `fontSizePx` → `maxFontSizePx` (default `fontSizePx * 4`)
- Certified layout uses `growEpsilonPx` and `growMaxIterations`; uncertified
  content or geometry uses `growEpsilonPx` as its exact-grid step and the same
  `fitMaxProbes` budget

```tsx
<Text font="NotoSansJP" fontSizePx={12} fit="grow" maxFontSizePx={72}>
  Text that grows to fill space
</Text>
```

Fit always measures the complete authored text with ellipsis disabled.
Ellipsis, when requested, is applied only after the font size is selected, so
truncation cannot make fit choose a larger size. If an exact grid would exceed
its configured limit, rendering fails with `TEXT_FIT_PROBE_LIMIT` instead of
returning an unproven smaller size. Candidate scaling applies equally to
`fontSizePx` and `letterSpacingPx`; explicit `lineHeightPx` remains absolute,
while proportional `lineHeight` follows the selected font size.

## Ellipsis

Ellipsis projects text with `…` (U+2026) when it exceeds `maxLines`. It uses
the same planner for horizontal and vertical text, normal rich text, and rich
flow around exclusions.

```tsx
<Text font="NotoSansJP" fontSizePx={16} maxLines={1} ellipsis>
  This text will be truncated with … if it overflows
</Text>
```

The planner evaluates legal authored prefixes from longest to shortest and
chooses the first exact re-layout that satisfies every width, height,
line/column, and region constraint. Prefix length is not assumed to be
monotone with shaped width: ligatures and contextual forms are re-shaped at
the new end of text. Boundaries preserve extended grapheme clusters, atomic
`Ruby`/`InlineBox`/`InlineRect`/text-combine items, UAX #14 opportunities, and
the active kinsoku profile. Negative tracking and mixed metrics are measured,
not estimated.

The marker is a synthetic run with no source range or UnitMap unit. It uses
the first omitted item's effective text style and fragmentable decoration;
output and recoverable warnings from the omitted suffix are discarded. If the
marker itself emits a warning, that warning belongs to the selected output.
If the marker cannot fit, display ink is empty while source/accessibility text
remains complete. Nested decorated spans stay fragmentable across normal
lines, vertical columns, and exclusion regions, with every outer and inner
owner preserved. Paint-only Inline boundaries share one shaping run; an
indivisible cluster crossing such a boundary uses its source-start paint.

After the complete document is proven to overflow, at most 1,024 exact
candidate layouts are allowed. A larger maximum candidate set fails with
`TEXT_ELLIPSIS_CANDIDATE_LIMIT` before candidate or output materialization.
Flow operations also fail deterministically at 65,536 distinct region queries
or 262,144 returned intervals (`TEXT_REGION_QUERY_LIMIT` and
`TEXT_REGION_INTERVAL_LIMIT`).

## Color Format

### Accepted

- `#RGB` (3-digit hex)
- `#RRGGBB` (6-digit hex)
- `#RRGGBBAA` (8-digit hex)
- `rgb(r, g, b)` (0–255 integers)
- `rgba(r, g, b, a)` (a is 0–1)
- `hsl(h, s%, l%)` / `hsla(h, s%, l%, a)`
- CSS named colors — all 148 keywords (`"red"`, `"steelblue"`, etc.)
- `"transparent"`

### Not Accepted

- `hwb()`
- `currentColor` / `inherit`

Invalid color strings cause a validation error (Fatal).
