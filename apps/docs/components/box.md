---
title: Box
---

# Box

Generic container element. Internally uses flex `direction=column`.

## Props {#props}

### Box Model

| Prop                      | Type                     | Description             |
| ------------------------- | ------------------------ | ----------------------- |
| `width`                   | `number`                 | Width (px)              |
| `height`                  | `number`                 | Height (px)             |
| `minWidth` / `maxWidth`   | `number`                 | Width constraints (px)  |
| `minHeight` / `maxHeight` | `number`                 | Height constraints (px) |
| `aspectRatio`             | `number`                 | Aspect ratio (w / h)    |
| `padding`                 | `number \| [T, R, B, L]` | Padding                 |
| `margin`                  | `number \| [T, R, B, L]` | Margin                  |

::: info
`padding` and `margin` accept either a single number (applied to all sides) or a 4-element array `[top, right, bottom, left]`. 2 or 3 element shorthand is **not** supported.
:::

### Visual

| Prop               | Type                                         | Description                                                                                                                                     |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`       | `string`                                     | Background color                                                                                                                                |
| `boxShadow`        | `string`                                     | Box shadow (e.g. `"0 4 8 0 rgba(0,0,0,0.2)"`)                                                                                                   |
| `borderWidth`      | `number`                                     | Border width                                                                                                                                    |
| `borderColor`      | `string`                                     | Border color                                                                                                                                    |
| `strokeScaling`    | `"transform" \| "canvas"`                    | Border width space. `"transform"` (default) scales with post-layout transforms; `"canvas"` keeps the width stable in canvas space               |
| `borderRadius`     | `number \| [number, number, number, number]` | Border radius                                                                                                                                   |
| `strokeLinecap`    | `"butt" \| "round" \| "square"`              | Border stroke line cap                                                                                                                          |
| `strokeLinejoin`   | `"miter" \| "round" \| "bevel"`              | Border stroke line join                                                                                                                         |
| `strokeDasharray`  | `string`                                     | Border stroke dash pattern (e.g. `"5,5"`)                                                                                                       |
| `strokeMiterlimit` | `number`                                     | Border stroke miter limit                                                                                                                       |
| `overflow`         | `"visible" \| "clip"`                        | Overflow behavior                                                                                                                               |
| `opacity`          | `number`                                     | Opacity (0–1)                                                                                                                                   |
| `zIndex`           | `number`                                     | Sibling-local paint order (integer; higher paints later)                                                                                        |
| `meta`             | `Record<string, string>`                     | Metadata emitted as `data-boundsvg-meta-*` attributes and into the layered manifest (max 16 keys, `[a-z][a-z0-9-]{0,31}` keys, 256-char values) |
| `transform`        | `Transform2D`                                | Static post-layout paint transform                                                                                                              |
| `animate`          | `AnimationSpec`                              | Declarative opacity/transform track; see [Animation](/guides/animation)                                                                         |

### Positioning

| Prop       | Type                       | Default      | Description         |
| ---------- | -------------------------- | ------------ | ------------------- |
| `position` | `"relative" \| "absolute"` | `"relative"` | Positioning mode    |
| `top`      | `number`                   | —            | Top offset in px    |
| `right`    | `number`                   | —            | Right offset in px  |
| `bottom`   | `number`                   | —            | Bottom offset in px |
| `left`     | `number`                   | —            | Left offset in px   |

### Grid Item

| Prop         | Type     | Description                            |
| ------------ | -------- | -------------------------------------- |
| `gridColumn` | `string` | Grid column placement (e.g. `"1 / 3"`) |
| `gridRow`    | `string` | Grid row placement (e.g. `"1 / 2"`)    |

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
`transform` is applied after layout and text fitting. It does not change the
node's layout box or its siblings' placement.
:::

::: info
Set `strokeScaling="canvas"` on a solid border used inside a similarity camera
transform to keep its canvas-space width stable while the camera zooms. The
default `"transform"` preserves the normal SVG behavior. Canvas-stable borders
do not support dash patterns, non-uniform scale, or axis reflection; see
[Known Limitations](/reference/known-limitations).
:::

## Example

<!--@include: ../_generated/box-styled.md-->
