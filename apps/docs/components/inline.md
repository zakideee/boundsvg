---
title: Inline and InlineBox
---

# Inline and InlineBox

Both components style rich content inside a `Text` node. Use `Inline` for a
span that may fragment across line or column boundaries. Use `InlineBox` when
the styled content, logical padding, background, and border must stay together
as one atomic inline item.

## Inline

`Inline` is a span-like text run override. Children may be strings, nested
`Inline`, `InlineRect`, or `Ruby` nodes. `Inline` can appear inside `Text`,
`TextOnPath`, `Inline`, `InlineBox`, `Ruby`, or `Rt`.

Decorated `Inline` spans may fragment when the surrounding text wraps. The
background and border are emitted for each fragment, with the outer corner
radii retained at the start and end of the span.

### Props

| Prop                    | Type                                     | Default     | Description                                                       |
| ----------------------- | ---------------------------------------- | ----------- | ----------------------------------------------------------------- |
| `font`                  | `string`                                 | inherited   | Override font alias                                               |
| `fallback`              | `string[]`                               | inherited   | Override fallback font alias chain                                |
| `fontWeight`            | `number`                                 | inherited   | Override font weight                                              |
| `fontStyle`             | `"normal" \| "italic"`                   | inherited   | Override font style                                               |
| `fontVariationSettings` | `string`                                 | inherited   | Variable font settings (for example, `"'wght' 700"`)              |
| `fontFeatureSettings`   | `string`                                 | inherited   | OpenType feature settings (for example, `"'liga' 0, 'smcp' 1"`)   |
| `textOrientation`       | `"mixed" \| "upright"`                   | inherited   | Character orientation in vertical text                            |
| `textCombineUpright`    | `"none" \| "all"`                        | `"none"`    | Tate-chu-yoko                                                     |
| `fontSizePx`            | `number`                                 | inherited   | Override font size in px                                          |
| `letterSpacingPx`       | `number`                                 | inherited   | Override letter spacing in px                                     |
| `color`                 | `string`                                 | inherited   | Override text color                                               |
| `textStrokes`           | `readonly TextStrokeLayer[]`             | inherited   | Replace inherited stroke layers; `[]` clears them                 |
| `textShadows`           | `readonly TextShadowLayer[]`             | inherited   | Replace inherited shadow layers; `[]` clears them                 |
| `textDecoration`        | `TextDecoration`                         | inherited   | Replace inherited decoration, or use `"none"` to stop it          |
| `language`              | `"ja" \| "en" \| "auto"`                 | inherited   | Override language hint for kinsoku processing                     |
| `paddingInline`         | `[number, number]`                       | `[0, 0]`    | Logical inline-start and inline-end padding in px                 |
| `background`            | `string`                                 | —           | Fragment background color                                         |
| `borderColor`           | `string`                                 | —           | Fragment border color                                             |
| `borderWidth`           | `number`                                 | `0`         | Fragment border width in px                                       |
| `borderRadius`          | `[number, number, number, number]`       | `[0,0,0,0]` | Corner radii `[topLeft, topRight, bottomRight, bottomLeft]` in px |
| `children`              | `string \| Inline \| InlineRect \| Ruby` | —           | Rich inline content; arrays and nested child arrays are accepted  |

### Example

```tsx
<Text font="NotoSansJP" fontSizePx={16} color="#333333">
  This is <Inline color="#ef4444">red</Inline> and{" "}
  <Inline color="#3b82f6" fontWeight={700}>
    bold blue
  </Inline>{" "}
  text.
</Text>
```

Composition ranges can use decoration without changing shaping:

```tsx
<Text font="NotoSansJP" fontSizePx={28}>
  入力:
  <Inline
    textDecoration={{ line: "underline", color: "#facc15", thicknessPx: 2 }}
  >
    きょう
  </Inline>
  <InlineRect inlineSizePx={2} color="#67e8f9" />
</Text>
```

::: info
`InlineRect` is allowed inside `Inline`, but `InlineBox` is not. Ruby base
content may use `Inline`; `Rt` controls annotation decoration separately.
:::

## InlineBox

`InlineBox` is a decorated, atomic inline item. It can appear inside `Text` or
another `InlineBox`, and its children may be strings, `Inline`, nested
`InlineBox`, `InlineRect`, or `Ruby` nodes. Unlike `Inline`, an `InlineBox` does
not split when the surrounding text wraps; the whole item moves to the next
line or column.

### Props

| Prop              | Type                                                  | Default   | Description                                                      |
| ----------------- | ----------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| `font`            | `string`                                              | inherited | Override font alias                                              |
| `fallback`        | `string[]`                                            | inherited | Override fallback font alias chain                               |
| `fontWeight`      | `number`                                              | inherited | Override font weight                                             |
| `fontStyle`       | `"normal" \| "italic"`                                | inherited | Override font style                                              |
| `fontSizePx`      | `number`                                              | inherited | Override font size in px                                         |
| `letterSpacingPx` | `number`                                              | inherited | Override letter spacing in px                                    |
| `color`           | `string`                                              | inherited | Override text color                                              |
| `textDecoration`  | `TextDecoration`                                      | inherited | Replace inherited decoration, or use `"none"` to stop it         |
| `language`        | `"ja" \| "en" \| "auto"`                              | inherited | Override language hint for kinsoku processing                    |
| `paddingInline`   | `[number, number]`                                    | `[0, 0]`  | Logical inline-start and inline-end padding in px                |
| `background`      | `string`                                              | —         | Background color painted behind the atomic item                  |
| `borderColor`     | `string`                                              | —         | Border color                                                     |
| `borderWidth`     | `number`                                              | `0`       | Border width in px                                               |
| `borderRadius`    | `number`                                              | `0`       | Radius applied to all four corners in px                         |
| `children`        | `string \| Inline \| InlineBox \| InlineRect \| Ruby` | —         | Rich inline content; arrays and nested child arrays are accepted |

### Example

```tsx
<Text font="NotoSansJP" fontSizePx={22} color="#e2e8f0" width={360}>
  Status:{" "}
  <InlineBox
    paddingInline={[8, 8]}
    background="#0f766e"
    borderColor="#5eead4"
    borderWidth={1}
    borderRadius={6}
    color="#f0fdfa"
    fontWeight={700}
  >
    READY
  </InlineBox>
</Text>
```

::: info
`InlineBox` intentionally has a smaller typography surface than `Inline`.
Properties such as `fontVariationSettings`, `fontFeatureSettings`,
`textOrientation`, `textCombineUpright`, `textStrokes`, and `textShadows` are
inherited from the surrounding text and cannot be overridden directly on an
`InlineBox`.
:::
