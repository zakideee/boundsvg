---
title: Ruby
---

# Ruby

Inline ruby annotation container for displaying reading hints, translations, or semantic annotations around base text.

Must appear inside Text. Each Ruby node must contain base content and at least one Rt child. Multiple Rt children are treated as annotation levels.

Ruby layout is covered by the JLREQ-informed Japanese text contracts, but it is not a full JLREQ conformance claim. The stable v0.1 contract fixes the physical side of `rubyPosition`:

- Horizontal text: `over` is above the base, `under` is below the base
- `vertical-rl`: `over` is on the right side of the base, `under` is on the left side
- `alternate` places annotation levels on alternating sides, starting with `over`
- `inter-character` is accepted but currently renders as `over` with a recoverable warning
- The default ruby frame gap is `0px`; this is a frame contract, not a glyph outline collision rule
- The engine keeps a `1px` minimum ink clearance for non-negative gap/offset values so frame contact does not render as visible glyph overlap
- `rubyLineSizing="css"` is the default: annotations stay out of the base line-size calculation when they fit in the existing line pitch
- `rubyLineSizing="stable"` reserves annotation space in the text line for collision-safe image generation
- Long annotations that exceed the base advance emit a `LONG_RUBY_ANNOTATION` warning

## Props

| Prop             | Type                                                       | Default          | Description                          |
| ---------------- | ---------------------------------------------------------- | ---------------- | ------------------------------------ |
| `rubyPosition`   | `"over" \| "under" \| "alternate" \| "inter-character"`    | `"alternate"`    | Position of annotation text          |
| `rubyAlign`      | `"start" \| "center" \| "space-between" \| "space-around"` | `"space-around"` | Alignment of annotation text         |
| `rubyGapPx`      | `number`                                                   | `0`              | Frame gap between base and ruby      |
| `rubyOffsetPx`   | `number`                                                   | `0`              | Outward annotation offset after side |
| `rubyLineSizing` | `"stable" \| "css"`                                        | `"css"`          | Annotation contribution to line size |

## Example

```tsx
<Text font="NotoSansJP" fontSizePx={24} color="#333333" language="ja">
  <Ruby
    rubyPosition="alternate"
    rubyAlign="center"
    rubyGapPx={0}
    rubyOffsetPx={0}
  >
    漢字<Rt fontSizePx={12}>かんじ</Rt>
    <Rt fontSizePx={12} color="#2563eb">
      Chinese characters
    </Rt>
  </Ruby>
  のテスト
</Text>
```

::: info
Base content can be plain text or Inline nodes for per-token styling. The first Rt is the primary reading level; later Rt children can be used for translations or semantic annotations. Use `rubyAlign="center"` for Latin translation levels when glyph-by-glyph distribution is not desired.
:::

::: warning
Full inter-character ruby layout, ruby overhang adjustment across neighboring runs, mono/group ruby switching, and complex jukugo ruby rules are intentionally limited in v0.1. Treat visible changes to ruby position, advance, or warning codes as output-affecting changes.
:::
