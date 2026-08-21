---
title: Rt
---

# Rt

Ruby annotation text. Must appear as the sole Rt child inside a Ruby node.

## Props

| Prop                    | Type                     | Default | Description                                             |
| ----------------------- | ------------------------ | ------- | ------------------------------------------------------- |
| `font`                  | `string`                 | —       | Override font alias                                     |
| `fallback`              | `string[]`               | —       | Override fallback font alias chain                      |
| `fontWeight`            | `number`                 | —       | Override font weight                                    |
| `fontStyle`             | `"normal" \| "italic"`   | —       | Override font style                                     |
| `fontVariationSettings` | `string`                 | —       | Variable font settings                                  |
| `fontFeatureSettings`   | `string`                 | —       | OpenType feature settings (e.g. `"'liga' 0, 'smcp' 1"`) |
| `fontSizePx`            | `number`                 | —       | Annotation font size in px                              |
| `lineHeight`            | `number`                 | —       | Unitless line-height multiplier                         |
| `lineHeightPx`          | `number`                 | —       | Line height in px (priority over lineHeight)            |
| `letterSpacingPx`       | `number`                 | —       | Letter spacing in px                                    |
| `color`                 | `string`                 | —       | Annotation text color                                   |
| `language`              | `"ja" \| "en" \| "auto"` | —       | Language hint                                           |
| `textOrientation`       | `"mixed" \| "upright"`   | —       | Character orientation in vertical text                  |

## Example

```tsx
<Ruby>
  漢字
  <Rt fontSizePx={12} color="#6366f1">
    かんじ
  </Rt>
</Ruby>
```
