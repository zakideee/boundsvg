---
title: Text
---

# Text

Text rendering with WASM-based font shaping and precise layout.

Children may be strings, `Inline`, `InlineBox`, `InlineRect`, or `Ruby`.
Layout nodes such as `Box`, `Flex`, and `Image` are not allowed in text flow.

## Props

### Font

| Prop                    | Type                   | Required | Default     | Description                                              |
| ----------------------- | ---------------------- | -------- | ----------- | -------------------------------------------------------- |
| `font`                  | `string`               | Yes      | —           | Font alias (registered via Engine)                       |
| `fontSizePx`            | `number`               | Yes      | —           | Font size in px                                          |
| `fontWeight`            | `number`               |          | `400`       | Font weight                                              |
| `fontStyle`             | `"normal" \| "italic"` |          | `"normal"`  | Font style                                               |
| `fontVariationSettings` | `string`               |          | —           | Variable font settings (e.g. `"'wght' 700, 'wdth' 125"`) |
| `fontFeatureSettings`   | `string`               |          | —           | OpenType feature settings (e.g. `"'liga' 0, 'smcp' 1"`)  |
| `fallback`              | `string[]`             |          | —           | Fallback font alias chain                                |
| `color`                 | `string`               |          | `"#000000"` | Text color (CSS color string)                            |

### Line

| Prop              | Type                           | Default   | Description                                          |
| ----------------- | ------------------------------ | --------- | ---------------------------------------------------- |
| `lineHeight`      | `number`                       | `1.2`     | Unitless line-height multiplier (1.0–3.0)            |
| `lineHeightPx`    | `number`                       | —         | Line height in px (takes priority over `lineHeight`) |
| `letterSpacingPx` | `number`                       | `0`       | Letter spacing in px                                 |
| `textAlign`       | `"start" \| "center" \| "end"` | `"start"` | Text alignment                                       |

### Decoration

| Prop             | Type             | Default  | Description                                                                                    |
| ---------------- | ---------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `textDecoration` | `TextDecoration` | `"none"` | Resolved underline, overline, or line-through geometry with pattern, px, and ink-skip controls |

```tsx
<Text
  font="NotoSansJP"
  fontSizePx={28}
  textDecoration={{
    line: ["underline", "line-through"],
    style: "wavy",
    color: "#38bdf8",
    thicknessPx: 2,
    offsetPx: 1,
    skipInk: "all",
  }}
>
  inherited <Inline textDecoration="none">not decorated</Inline>
</Text>
```

An inner `"none"` stops inheritance; an inner decoration object replaces the
outer value. Decoration follows resolved font metrics and logical writing
axes, splits at wrapped lines/columns and font runs, and keeps spaces
continuous. `style` accepts `"solid"`, `"double"`, `"dotted"`, `"dashed"`, or
`"wavy"`; it defaults to `"solid"`. `skipInk` defaults to `"none"`. With
`skipInk: "all"`, underline and overline geometry is cut around resolved glyph
fill outlines, while line-through stays continuous. Decoration remains
paint-only: it does not change shaping, layout, source ranges, or UnitMap
identity. A decorated `Text` cannot also use `animateUnits`.

`TextOnPath` uses the same decoration value and Inline inheritance/stop rules,
but materializes the filled pattern along fitted path distance instead of a
straight line/column. Inherited ranges keep one owner phase across font and
paint runs; an explicit replacement starts a new owner. See
[Text on an SVG path](/guides/text-and-fonts#text-on-an-svg-path) for curved
geometry, skip-ink, animation conflicts, errors, and budgets.

### Wrapping

| Prop         | Type                                 | Default    | Description                                              |
| ------------ | ------------------------------------ | ---------- | -------------------------------------------------------- |
| `wrap`       | `"none" \| "word" \| "char"`         | `"char"`   | Line wrapping mode                                       |
| `whiteSpace` | `"normal" \| "nowrap" \| "pre-wrap"` | `"normal"` | Space, newline, and wrapping policy                      |
| `tabSize`    | `number`                             | `4`        | Spaces per tab in `pre-wrap`; must be a positive integer |
| `maxLines`   | `number`                             | —          | Maximum lines or vertical columns (unlimited if omitted) |
| `ellipsis`   | `boolean`                            | `false`    | Show U+2026 on overflow (requires `maxLines`)            |

> `wrap` defaults to `"char"` because the primary use case (telops — broadcast-style caption overlays) wraps CJK text per character. For English text, set `wrap="word"` explicitly.

`whiteSpace="nowrap"` overrides `wrap` and keeps the paragraph on one
line/column. `tabSize` is used only when `whiteSpace="pre-wrap"`; other
white-space modes collapse tabs with the surrounding whitespace.

Ellipsis uses one contract for plain text, spans, recursive rich text, flow
exclusions, and both writing modes. It evaluates legal authored prefixes from
longest to shortest and re-shapes each candidate at end-of-text. A cut never
splits an extended grapheme cluster, `Ruby`, `InlineBox`, `InlineRect`, or a
text-combine unit, and it respects the active UAX #14 and Japanese kinsoku
boundaries. U+2026 is synthetic: `sourceText` and source units retain the full
authored input, while `displayText` contains only the selected prefix and
marker. The marker inherits the first omitted text style and fragmentable
decoration, but never an omitted atomic background or ruby annotation style.
Nested fragmentable decorations retain every outer/inner owner when they wrap
or cross exclusion regions. Paint-only `Inline` boundaries keep contextual
shaping; if one indivisible cluster crosses the boundary, its source-start
style paints that cluster.

### Flow around exclusions

| Prop                   | Type                           | Default            | Description                                                  |
| ---------------------- | ------------------------------ | ------------------ | ------------------------------------------------------------ |
| `flowExclusions`       | `readonly TextFlowExclusion[]` | `[]`               | Rect, circle, or path geometry excluded from the Text layout |
| `flowMinRegionWidthPx` | `number`                       | Resolved font size | Minimum usable inline extent between exclusions              |

`flowExclusions` uses coordinates local to this Text node: `(0, 0)`
is the top-left corner of its layout frame, not the Canvas. A non-empty array
requires positive finite `width` and `height` on the Text. Empty arrays use the
normal non-exclusion layout path.

```ts
type TextFlowExclusionMarginPx =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

type TextFlowExclusion =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      marginPx?: TextFlowExclusionMarginPx;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      marginPx?: TextFlowExclusionMarginPx;
    }
  | {
      kind: "path";
      d: string;
      x?: number;
      y?: number;
      fillRule?: "nonzero" | "evenodd";
      marginPx?: TextFlowExclusionMarginPx;
    };
```

`marginPx` adds non-negative clearance around a shape. A number applies to all
edges; an object can set edges independently. Path exclusions use filled,
closed SVG path geometry; `x` and `y` default to `0`, and `fillRule` defaults to
`"nonzero"`.

```tsx
<Text
  font="NotoSansJP"
  fontSizePx={20}
  width={480}
  height={240}
  wrap="char"
  flowMinRegionWidthPx={16}
  flowExclusions={[
    { kind: "rect", x: 40, y: 32, width: 112, height: 88, marginPx: 8 },
    { kind: "circle", cx: 360, cy: 156, r: 44, marginPx: 6 },
  ]}
>
  障害物を避けながら、一つの Text として文章を組みます。
</Text>
```

The minimum region setting follows the inline axis: it filters narrow widths
in horizontal text and narrow heights in vertical text. Moving an exclusion is
a layout change, so materialize its current geometry into a new static scene
before rendering the frame; a post-layout `transform` moves paint only and does
not reflow the Text.

### Inline Rectangles

`InlineRect` is a childless atomic paint primitive for a caret or other inline
rectangle:

```tsx
<Text font="JetBrainsMono" fontSizePx={22}>
  $ pnpm test
  <InlineRect
    inlineSizePx={2}
    blockSizePx="line"
    advancePx={0}
    color="#67e8f9"
    paintOrder="front"
    animate={caretBlink}
  />
</Text>
```

| `InlineRect` prop | Type                           | Default    | Description                                                   |
| ----------------- | ------------------------------ | ---------- | ------------------------------------------------------------- |
| `inlineSizePx`    | `number`                       | required   | Positive painted inline extent                                |
| `blockSizePx`     | `number \| "line"`             | `"line"`   | Positive cross extent or the resolved line extent             |
| `advancePx`       | `number`                       | `0`        | Non-negative inline advance consumed by wrapping/content      |
| `blockAlign`      | `"start" \| "center" \| "end"` | `"center"` | Cross-axis alignment for a numeric block size                 |
| `color`           | `string`                       | required   | Rectangle color                                               |
| `borderRadiusPx`  | `number`                       | `0`        | Non-negative corner radius, clamped to the physical rectangle |
| `opacity`         | `number`                       | `1`        | Finite opacity in `0..1`                                      |
| `paintOrder`      | `"behind" \| "front"`          | `"front"`  | Paint before or after the text stack                          |
| `animate`         | `AnimationSpec`                | —          | Post-layout opacity/transform animation                       |

It is allowed only inside `Text`, `Inline`, or `InlineBox` and does not add
text, accessibility content, a source range, or a UnitMap unit. A single
`Text` may contain at most 4,096 inline rectangles.

### Fit (Auto Font Size)

| Prop                  | Type                           | Default          | Description                               |
| --------------------- | ------------------------------ | ---------------- | ----------------------------------------- |
| `fit`                 | `"none" \| "shrink" \| "grow"` | `"none"`         | Auto font-size adjustment mode            |
| `minFontSizePx`       | `number`                       | `8`              | Minimum font size for shrink              |
| `shrinkEpsilonPx`     | `number`                       | `0.25`           | Shrink convergence or exact-grid step     |
| `shrinkMaxIterations` | `number`                       | `12`             | Max certified shrink refinements          |
| `maxFontSizePx`       | `number`                       | `fontSizePx * 4` | Maximum font size for grow                |
| `growEpsilonPx`       | `number`                       | `0.25`           | Grow convergence or exact-grid step       |
| `growMaxIterations`   | `number`                       | `12`             | Max certified grow refinements            |
| `fitMaxProbes`        | `number`                       | `4096`           | Exact-grid work limit for uncertified fit |

Fit selects a size against the complete authored document with ellipsis off;
`fontSizePx` and `letterSpacingPx` scale by the same candidate ratio. An
explicit `lineHeightPx` stays absolute, while proportional `lineHeight`
follows the selected size. Only then can ellipsis project the display at that
size. Binary refinement is used only when both content and geometry are
monotone-certified. Negative tracking/proportional metrics or flow geometry
that can change topology use a descending exact grid and return the largest
fitting grid size. `fitMaxProbes` must be a positive integer and is capped at
65,536; it does not replace the existing `*MaxIterations` fields.

An overflowing ellipsis projection is limited to 1,024 exact candidate
layouts. Resource exhaustion throws a structured `FatalError` instead of
returning approximate or partial output: `TEXT_ELLIPSIS_CANDIDATE_LIMIT`,
`TEXT_FIT_PROBE_LIMIT`, `TEXT_REGION_QUERY_LIMIT`, or
`TEXT_REGION_INTERVAL_LIMIT`. A document that fits without ellipsis does not
spend the ellipsis candidate budget.

### Stroke

| Prop                   | Type                            | Default   | Description                                                                    |
| ---------------------- | ------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `textStroke`           | `string`                        | —         | Stroke color (CSS color string)                                                |
| `textStrokeWidth`      | `number`                        | `0`       | Stroke width in px                                                             |
| `textStrokeLinecap`    | `"butt" \| "round" \| "square"` | —         | Stroke line cap                                                                |
| `textStrokeLinejoin`   | `"miter" \| "round" \| "bevel"` | `"round"` | Stroke line join                                                               |
| `textStrokeDasharray`  | `string`                        | —         | Stroke dash pattern (e.g. `"5,5"`)                                             |
| `textStrokeMiterlimit` | `number`                        | —         | Stroke miter limit                                                             |
| `textStrokes`          | `TextStrokeLayer[]`             | —         | Multi-layer outline; index 0 = outermost. Mutually exclusive with `textStroke` |
| `textShadows`          | `TextShadowLayer[]`             | —         | Drop shadows painted below all stroke layers                                   |

### Direction

| Prop                 | Type                               | Default           | Description                                        |
| -------------------- | ---------------------------------- | ----------------- | -------------------------------------------------- |
| `writingMode`        | `"horizontal-tb" \| "vertical-rl"` | `"horizontal-tb"` | Writing direction                                  |
| `textOrientation`    | `"mixed" \| "upright"`             | `"mixed"`         | Character orientation in vertical text             |
| `language`           | `"ja" \| "en" \| "auto"`           | `"auto"`          | Language hint for kinsoku processing               |
| `hangingPunctuation` | `boolean`                          | `false`           | Allow line-end punctuation to extend past maxWidth |
| `textIndent`         | `number`                           | —                 | Indent applied to the first line/column in px      |

### Constraint

| Prop                      | Type                         | Description                                                                                |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `width`                   | `number`                     | Fixed layout width in px (enables e.g. single-line `fit: "shrink"` without a sized parent) |
| `height`                  | `number`                     | Fixed layout height in px                                                                  |
| `minWidth` / `maxWidth`   | `number`                     | Layout width bounds in px                                                                  |
| `minHeight` / `maxHeight` | `number`                     | Layout height bounds in px                                                                 |
| `aspectRatio`             | `number`                     | Layout aspect ratio                                                                        |
| `preferredFrame`          | `{ w?: number; h?: number }` | Soft constraint for text layout (px)                                                       |

### Flex Item

| Prop         | Type                                                  | Default  | Description        |
| ------------ | ----------------------------------------------------- | -------- | ------------------ |
| `flexGrow`   | `number`                                              | `0`      | Flex grow factor   |
| `flexShrink` | `number`                                              | `1`      | Flex shrink factor |
| `flexBasis`  | `number \| "auto"`                                    | `"auto"` | Flex basis         |
| `alignSelf`  | `"auto" \| "start" \| "center" \| "end" \| "stretch"` | `"auto"` | Self alignment     |

### Grid Item

| Prop         | Type     | Description                            |
| ------------ | -------- | -------------------------------------- |
| `gridColumn` | `string` | Grid column placement (e.g. `"1 / 3"`) |
| `gridRow`    | `string` | Grid row placement (e.g. `"1 / 2"`)    |

### Positioning

| Prop       | Type                       | Default      | Description         |
| ---------- | -------------------------- | ------------ | ------------------- |
| `position` | `"relative" \| "absolute"` | `"relative"` | Positioning mode    |
| `top`      | `number`                   | —            | Top offset in px    |
| `right`    | `number`                   | —            | Right offset in px  |
| `bottom`   | `number`                   | —            | Bottom offset in px |
| `left`     | `number`                   | —            | Left offset in px   |

### Box Model

| Prop           | Type                                         | Description                                                                                                                                     |
| -------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `padding`      | `number \| [number, number, number, number]` | Padding (uniform or [top, right, bottom, left])                                                                                                 |
| `margin`       | `number \| [number, number, number, number]` | Margin (uniform or [top, right, bottom, left])                                                                                                  |
| `opacity`      | `number`                                     | Opacity (0–1)                                                                                                                                   |
| `zIndex`       | `number`                                     | Sibling-local paint order (integer; higher paints later)                                                                                        |
| `meta`         | `Record<string, string>`                     | Metadata emitted as `data-boundsvg-meta-*` attributes and into the layered manifest (max 16 keys, `[a-z][a-z0-9-]{0,31}` keys, 256-char values) |
| `transform`    | `Transform2D`                                | Static post-layout paint transform                                                                                                              |
| `animate`      | `AnimationSpec`                              | Declarative opacity/transform track; see [Animation](/guides/animation)                                                                         |
| `animateUnits` | `TextUnitAnimation`                          | Apply an opacity/transform track per resolved cluster or line; see [Text unit animation](/guides/animation#text-unit-animation)                 |

### Event / Identity

| Prop             | Type     | Description                                           |
| ---------------- | -------- | ----------------------------------------------------- |
| `onClick`        | `string` | Click handler reference                               |
| `onDoubleClick`  | `string` | Double-click handler reference                        |
| `onContextMenu`  | `string` | Context menu handler reference                        |
| `onPointerMove`  | `string` | Pointer move handler reference                        |
| `onPointerEnter` | `string` | Pointer enter handler reference                       |
| `onPointerLeave` | `string` | Pointer leave handler reference                       |
| `id`             | `string` | Stable NodeId for hit-testing                         |
| `layer`          | `string` | Layer id for [Layered Export](/guides/layered-export) |

All 21 event handler props are supported. See [Event Handlers](/api/core#event-handlers) for the full list.

::: info
`transform` is applied after shaping, wrapping, and fit resolution. It changes
paint only, not text measurement.
:::

`animateUnits` is also post-layout. Cluster targeting follows shaping clusters,
so ligatures, combining sequences, CJK characters, and emoji are never split
into independently moving partial outlines. Line targeting follows the lines
or vertical columns resolved for the current layout. Ruby can move with its
base (`ruby: "with-base"`, the default) or as separate units.

## Examples

### Basic Text

<!--@include: ../_generated/text-basic.md-->

### Word Wrapping

<!--@include: ../_generated/text-wrap.md-->

### Auto-Shrink to Fit

<!--@include: ../_generated/text-shrink.md-->

### Ellipsis

<!--@include: ../_generated/text-ellipsis.md-->

### Vertical Japanese text

<!--@include: ../_generated/text-vertical.md-->

### Text Stroke

<!--@include: ../_generated/text-stroke.md-->
