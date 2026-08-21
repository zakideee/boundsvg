---
title: Path
---

# Path

SVG path rendering.

## Props

| Prop               | Type                            | Required | Default       | Description                                                                                                                                     |
| ------------------ | ------------------------------- | -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `d`                | `string`                        | Yes      | —             | SVG path data                                                                                                                                   |
| `width`            | `number`                        | Yes      | —             | Bounding box width (px)                                                                                                                         |
| `height`           | `number`                        | Yes      | —             | Bounding box height (px)                                                                                                                        |
| `fill`             | `string`                        |          | —             | Fill color                                                                                                                                      |
| `stroke`           | `string`                        |          | —             | Stroke color                                                                                                                                    |
| `strokeWidth`      | `number`                        |          | —             | Stroke width                                                                                                                                    |
| `strokeScaling`    | `"transform" \| "canvas"`       |          | `"transform"` | Stroke width space. `"canvas"` keeps a solid stroke stable in canvas space under supported transforms                                           |
| `fillRule`         | `"nonzero" \| "evenodd"`        |          | —             | Fill rule for complex paths                                                                                                                     |
| `strokeLinecap`    | `"butt" \| "round" \| "square"` |          | —             | Stroke line cap                                                                                                                                 |
| `strokeLinejoin`   | `"miter" \| "round" \| "bevel"` |          | —             | Stroke line join                                                                                                                                |
| `strokeDasharray`  | `string`                        |          | —             | Stroke dash pattern (e.g. `"5,5"`)                                                                                                              |
| `strokeMiterlimit` | `number`                        |          | —             | Stroke miter limit                                                                                                                              |
| `opacity`          | `number`                        |          | —             | Opacity (0–1)                                                                                                                                   |
| `zIndex`           | `number`                        |          | —             | Sibling-local paint order (integer; higher paints later)                                                                                        |
| `meta`             | `Record<string, string>`        |          | —             | Metadata emitted as `data-boundsvg-meta-*` attributes and into the layered manifest (max 16 keys, `[a-z][a-z0-9-]{0,31}` keys, 256-char values) |
| `transform`        | `Transform2D`                   |          | —             | Static post-layout paint transform                                                                                                              |
| `animate`          | `AnimationSpec`                 |          | —             | Declarative opacity/transform track; see [Animation](/guides/animation)                                                                         |

::: warning
Path coordinates in `d` are interpreted as **local coordinates** and translated to the bounding box origin at render time. They are **not** auto-scaled or auto-clipped to fit the bounding box — paths may visually overflow if coordinates exceed the width/height dimensions.

To clip overflow, wrap the Path in a container with `overflow="clip"`.
:::

::: info
`transform` is applied after the local path coordinates are positioned into the
node's layout box.
:::

::: info
Set `strokeScaling="canvas"` to keep a solid Path stroke at its authored
canvas-space width under ancestor translation, rotation, and uniform scale.
Declarative SVG uses `vector-effect: non-scaling-stroke`; static SVG and raster
formats use a deterministic fallback sampled at `timeMs`. `RenderOptions.scale`
remains an output-resolution multiplier. Dashed strokes, non-uniform scale, and
axis reflection fail explicitly rather than being approximated.

The Path viewport clips paint at its `width` / `height` edges in both
declarative SVG and static/raster output. A canvas-stable stroke can therefore
meet the clip under a uniform scale below `1`; inset the path geometry or
enlarge the viewport when edge strokes need additional clearance.
:::

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

| Prop     | Type                                         | Description                                    |
| -------- | -------------------------------------------- | ---------------------------------------------- |
| `margin` | `number \| [number, number, number, number]` | Margin (uniform or [top, right, bottom, left]) |

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

## Example

<!--@include: ../_generated/path-bezier.md-->
