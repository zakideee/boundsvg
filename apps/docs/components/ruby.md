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
- Long annotations retain their naturally shaped spacing. The parent text block reserves the width that cannot safely hang over a neighboring character.

## Long readings and neighboring characters

A long `start` annotation keeps its leading edge fixed. Long `center`,
`space-between`, and `space-around` annotations keep their natural center;
they are not compressed into the base width. Short space-based annotations
still distribute positive free space. The base moves as one block, without
stretching its internal character spacing. These rules apply along the inline
axis in horizontal and vertical text, at every annotation level.

A reading may use space over the immediately adjacent, unannotated kana
character or one of `、。，．・` in the same line, column, and exclusion region.
Each side can use at most half of that character's natural glyph-frame advance
and at most the annotation edge cluster's font size. Extra tracking and padding
provide no capacity. A kana shared by two readings lends its two halves separately.
The reading must lie entirely farther from the base than the neighbor's ink:
horizontal `over` and vertical `under` require the annotation's cross-axis maximum
to be at or before the neighbor's minimum; the other sides require the neighbor's
maximum to be at or before the annotation's minimum. Merely disjoint ink on the
inward side provides no loan. This rule applies to every level and font size,
including shrink and grow; existing fit resource limits remain unchanged.
Overlapping cross-axis ink, atomic boundaries, and incompatible decoration
boundaries prevent lending. With hanging punctuation enabled, existing hanging
candidates never lend additional space. Kanji, spaces, annotated neighbors, and characters beyond
the final line or region provide no capacity; remaining demand is reserved.

For example, with 80px full-width base/kana and a 120px reading, a centered
`行《おこな》う` consumes 180px: the base starts at 20px, the reading at 0px,
and `う` at 100px. The same Ruby alone consumes 120px. Actual advances depend
on the injected font. Line breaking, intrinsic measurement, exclusions, fit,
and ellipsis use these same cells. An atomic Ruby wider than the available
region can still overflow; clipping does not make it fit.

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
Full inter-character ruby layout, mono/group switching, per-character jukugo mapping, and breaks inside a Ruby base remain unsupported. Treat visible changes to ruby position, advance, or warning codes as output-affecting changes.
:::

## Measurement and migration

WASM schema 39 removes `TextFlowFragment.ruby`, `TextFlowRubyAnnotation` and
its level/run types, and `topRubyOverflowPx` / `bottomRubyOverflowPx` from
flow and nested shrinkwrap results. Measurement describes dimensions, reserved
cells, regions, and diagnostic ranges; it is not a paint instruction stream.
The fragment's `x`/`y` identifies the physical top-left of its reserved cell,
not the origin of the base or reading. A Ruby-bearing spans input uses the
canonical rich path regardless of fit or ellipsis and does not publish per-fragment
`style`, including its ordinary-text fragments. Diagnostic `charStart` /
`charEnd` count rich tokens on that path and graphemes on the plain path;
do not use them as authoring offsets or paint identities. Whitespace is normalized
once by the rich path.

Render the original `Text` / `Inline` / `Ruby` / `Rt` content with
[`flowExclusions`](./text#flow-exclusions) instead of reconstructing text from
measurement fragments. Coordinates of exclusions are local to the Text frame.
Use the renderer's IR, inspection, or outlines when you need settled geometry.
Custom producers must omit the removed keys entirely: own keys with
`undefined`, `null`, or a value are rejected with `TEXT_LAYOUT_OUTPUT_INVALID`.
The error includes the operation, decode phase, and protocol path. Direct WASM
errors use stage `wasm`; Core-injected and Worker result errors use `engine`.
Other unknown output fields keep their existing policy.

Long-reading widths, wrap/fit/ellipsis results, and animation line membership
or visual order can change. Recheck fixed frames and snapshots. Unit source and
Ruby-level identity remain stable for `with-base` and `separate`; ink-centered
transforms can move with the new geometry. Arbitrary transforms and intentional
negative tracking do not trigger collision-driven re-layout. Long annotations
no longer emit `LONG_RUBY_ANNOTATION`; other recoverable warnings still apply.
