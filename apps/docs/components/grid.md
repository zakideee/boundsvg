---
title: Grid
---

# Grid

CSS Grid layout container.

## Props

### Container

| Prop              | Type                                        | Description                                 |
| ----------------- | ------------------------------------------- | ------------------------------------------- |
| `templateColumns` | `string`                                    | Column definition (e.g., `"100px 1fr 2fr"`) |
| `templateRows`    | `string`                                    | Row definition (e.g., `"auto 100px"`)       |
| `gap`             | `number`                                    | Gap between items (px)                      |
| `rowGap`          | `number`                                    | Row gap (px)                                |
| `columnGap`       | `number`                                    | Column gap (px)                             |
| `alignItems`      | `"start" \| "center" \| "end" \| "stretch"` | Cross-axis alignment                        |
| `justifyItems`    | `"start" \| "center" \| "end" \| "stretch"` | Main-axis alignment                         |

### Grid Item (when Grid is a child)

| Prop         | Type                                                  | Default  | Description                        |
| ------------ | ----------------------------------------------------- | -------- | ---------------------------------- |
| `gridColumn` | `string`                                              | —        | Column placement (e.g., `"1 / 3"`) |
| `gridRow`    | `string`                                              | —        | Row placement (e.g., `"1 / 2"`)    |
| `alignSelf`  | `"auto" \| "start" \| "center" \| "end" \| "stretch"` | `"auto"` | Self alignment override            |

### Positioning

| Prop       | Type                       | Default      | Description         |
| ---------- | -------------------------- | ------------ | ------------------- |
| `position` | `"relative" \| "absolute"` | `"relative"` | Positioning mode    |
| `top`      | `number`                   | —            | Top offset in px    |
| `right`    | `number`                   | —            | Right offset in px  |
| `bottom`   | `number`                   | —            | Bottom offset in px |
| `left`     | `number`                   | —            | Left offset in px   |

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

<!--@include: ../_generated/grid-3col.md-->
