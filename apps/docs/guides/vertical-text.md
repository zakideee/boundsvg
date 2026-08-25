---
title: Vertical Text
---

# Vertical Text

## Writing Mode

Set `writingMode="vertical-rl"` on the `<Text>` component for vertical text. Characters flow top-to-bottom, columns progress right-to-left.

```tsx
<Text font="NotoSansJP" fontSizePx={24} writingMode="vertical-rl">
  縦書きテキスト
</Text>
```

### Character Orientation

- **CJK characters** — rendered upright (as-is)
- **ASCII/Latin characters** — rotated 90° clockwise (sideways)
- `direction: ltr` is fixed (RTL is not currently supported)

### Vertical Layout

- Column width = `lineHeightPx`
- Column height = cumulative glyph advances; columns split when `maxHeight` is exceeded
- Columns are laid out right-to-left with `lineHeightPx` spacing
- OpenType vertical features (`vert`) are used for proper glyph substitution (e.g., punctuation positioning)

### Fit in Vertical Mode

Vertical `fit="shrink"` and `fit="grow"` use the same fit contract as
horizontal text:

- Fit condition: `columns × lineHeightPx ≤ maxWidth` AND `max column height ≤ maxHeight`
- Content and geometry that are both monotone-certified use binary refinement
- Negative tracking/proportional metrics and topology-changing flow exclusions
  use a descending exact grid bounded by `fitMaxProbes`
- The complete source is fitted before any ellipsis is applied
- `fontSizePx` and `letterSpacingPx` scale together; explicit `lineHeightPx`
  remains absolute

### Rich Ellipsis in Vertical Mode

`maxLines` counts columns in `vertical-rl`. With `ellipsis`, plain text,
`Inline`, `Ruby`, atomic `InlineBox`/`InlineRect`, and nested decoration use the
same longest-legal-prefix planner as horizontal and exclusion-flow layout.

```tsx
<Text
  font="NotoSansJP"
  fontSizePx={24}
  writingMode="vertical-rl"
  language="ja"
  wrap="char"
  maxLines={3}
  ellipsis
>
  縦組みの<Inline color="#0ea5e9">リッチ</Inline>文章は
  <Ruby>
    境界<Rt fontSizePx={10}>きょうかい</Rt>
  </Ruby>
  を保って最長の合法な接頭辞を表示します。
</Text>
```

The marker is synthetic and source-less. It inherits the first omitted
effective text style and fragmentable decoration but is never placed inside
an omitted ruby or atomic inline background.

## Japanese Kinsoku (Line Breaking Rules)

Kinsoku (禁則) processing prevents typographically incorrect line breaks in Japanese text. Set `language="ja"` to enable it.

boundsvg uses a fixed `JaTypesettingV1` profile informed by JLREQ and JIS X 4051. This is a deterministic release contract, not a claim of full JLREQ conformance.

### Head-Prohibit Characters

Characters that must not appear at the start of a line:

```
、。，．・：；？！…‥
）］｝〕〉》」』】
〗〙゛゜‼⁇⁈⁉゠–—‐’”
｡､｣ﾞﾟ
```

Small kana, prolonged sound marks, wave dashes, and iteration marks are treated as JLREQ level-3 choice characters in `JaTypesettingV1`; they are allowed at line start by default.

```
ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ
ー〜～々〻ゝゞヽヾ
```

### Tail-Prohibit Characters

Characters that must not appear at the end of a line:

```
（［｛〔〈《「『【
〖〘‘“｢
```

### Non-Breaking Pairs

- `——` (consecutive em dashes) — never split
- `……` (consecutive ellipsis leaders) — never split
- `‥‥` (consecutive two-dot leaders) — never split
- Consecutive ASCII digits are not split

### Consecutive Kinsoku

When multiple head-prohibit characters appear consecutively (e.g., `」）。`), they form a group that is moved together:

1. If a head-prohibit group would start a new line, pull the entire group back to the previous line
2. If it doesn't fit, backtrack up to 8 clusters to find a valid break point
3. If no valid break is found: `overflow.type = "clip"` with `reason = "kinsoku_unresolved"`

## Hanging Punctuation

Use `hangingPunctuation` to allow punctuation to extend beyond the text box boundary, producing flush text edges.

```tsx
<Text
  font="NotoSansJP"
  fontSizePx={24}
  writingMode="vertical-rl"
  hangingPunctuation
>
  「日本語のテキスト」
</Text>
```

## Known Limitations

- **Mixed CJK + ASCII glyph positioning** — In `vertical-rl` mode, when full-width Japanese and half-width ASCII/Latin characters are mixed, glyph visual positions may shift from the bounding box axis depending on font and renderer combinations. OpenType vertical features (`vrt2`/`vert`) and shaping offset normalization mitigate this, but the issue is not fully resolved.

- **textOrientation** — `"mixed"` and `"upright"` are supported. `"sideways"` is not yet implemented.

- **TCY (tate-chu-yoko)** — `text-combine-upright` is experimental and manual-only. The `"all"` value is accepted on `<Inline>` in `vertical-rl` mode; plain text digit runs are not grouped automatically.
