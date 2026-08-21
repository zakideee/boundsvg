---
title: Shape
---

# Shape

Low-level geometry primitive resolved into an internal SVG fragment before layout.

No children allowed.

## Props

| Prop                  | Type                                         | Required | Description                                                                                                                                                                  |
| --------------------- | -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry`            | `GeometryDoc`                                | Either   | Inline geometry document                                                                                                                                                     |
| `geometryId`          | `string`                                     | Either   | Engine registry key for a preloaded geometry                                                                                                                                 |
| `width`               | `number`                                     | Yes      | Display width in px                                                                                                                                                          |
| `height`              | `number`                                     | Yes      | Display height in px                                                                                                                                                         |
| `fill`                | `string`                                     |          | Default fill applied to emitted geometry                                                                                                                                     |
| `stroke`              | `string`                                     |          | Default stroke applied to emitted geometry                                                                                                                                   |
| `strokeWidth`         | `number`                                     |          | Stroke width                                                                                                                                                                 |
| `fillRule`            | `"nonzero" \| "evenodd"`                     |          | Default fill rule                                                                                                                                                            |
| `strokeLinecap`       | `"butt" \| "round" \| "square"`              |          | Stroke line cap                                                                                                                                                              |
| `strokeLinejoin`      | `"miter" \| "round" \| "bevel"`              |          | Stroke line join                                                                                                                                                             |
| `strokeDasharray`     | `string`                                     |          | Stroke dash pattern                                                                                                                                                          |
| `strokeMiterlimit`    | `number`                                     |          | Stroke miter limit                                                                                                                                                           |
| `preserveAspectRatio` | `"none" \| "meet" \| "slice"`                |          | How to fit the geometry into the display box                                                                                                                                 |
| `opacity`             | `number`                                     |          | Opacity (0–1)                                                                                                                                                                |
| `zIndex`              | `number`                                     |          | Sibling-local paint order (integer; higher paints later)                                                                                                                     |
| `meta`                | `Record<string, string>`                     |          | Metadata emitted as `data-boundsvg-meta-*` attributes and into the layered manifest (max 16 keys, `[a-z][a-z0-9-]{0,31}` keys, 256-char values)                              |
| `emitPartIds`         | `boolean`                                    |          | Emit one path per addressable geometry part tagged with `data-boundsvg-part-id` (opt-in; overlapping parts paint separately)                                                 |
| `transform`           | `Transform2D`                                |          | Static post-layout paint transform                                                                                                                                           |
| `animate`             | `AnimationSpec`                              |          | Declarative opacity/transform track; see [Animation](/guides/animation)                                                                                                      |
| `margin`              | `number \| [number, number, number, number]` |          | Margin                                                                                                                                                                       |
| `partPaint`           | `Record<string, PartPaintOverride>`          |          | Per-part fill/stroke overrides keyed by part id. Splits the geometry into parts on its own; `emitPartIds` is only needed to also emit the `data-boundsvg-part-id` attributes |
| `layer`               | `string`                                     |          | Layer id for [Layered Export](/guides/layered-export). Always rendered as an atomic island                                                                                   |

Also accepts the same positioning, flex item, grid item, event, and `id` props as [`Svg`](/components/svg).

## Example

<!--@include: ../_generated/shape-basic.md-->
