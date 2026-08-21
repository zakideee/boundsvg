---
title: Flex
---

# Flex

Flexbox layout container.

## Props

### Container

| Prop             | Type                                                                | Default     | Description                                                |
| ---------------- | ------------------------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| `direction`      | `"row" \| "column"`                                                 | `"column"`  | Main axis direction                                        |
| `wrap`           | `"nowrap" \| "wrap"`                                                | `"nowrap"`  | Line wrapping                                              |
| `alignItems`     | `"start" \| "center" \| "end" \| "stretch"`                         | `"stretch"` | Cross-axis alignment                                       |
| `justifyContent` | `"start" \| "center" \| "end" \| "space-between" \| "space-around"` | `"start"`   | Main-axis alignment                                        |
| `gap`            | `number`                                                            | —           | Gap between items in px (sets both row-gap and column-gap) |
| `rowGap`         | `number`                                                            | —           | Row gap in px (overrides `gap`)                            |
| `columnGap`      | `number`                                                            | —           | Column gap in px (overrides `gap`)                         |

### Flex Item (when Flex is a child of another Flex)

| Prop         | Type                                                  | Default  | Description                |
| ------------ | ----------------------------------------------------- | -------- | -------------------------- |
| `flexGrow`   | `number`                                              | `0`      | Flex grow factor           |
| `flexShrink` | `number`                                              | `1`      | Flex shrink factor         |
| `flexBasis`  | `number \| "auto"`                                    | `"auto"` | Flex basis in px or "auto" |
| `alignSelf`  | `"auto" \| "start" \| "center" \| "end" \| "stretch"` | `"auto"` | Self alignment override    |

### Grid Item (when Flex is a child of Grid)

| Prop         | Type     | Description                            |
| ------------ | -------- | -------------------------------------- |
| `gridColumn` | `string` | Grid column placement (e.g. `"1 / 3"`) |
| `gridRow`    | `string` | Grid row placement (e.g. `"1 / 2"`)    |

Also accepts [common box props](/components/box#props) (`width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `aspectRatio`, `padding`, `margin`, `background`, `boxShadow`, `border*`, `stroke*`, `strokeScaling`, `overflow`, `opacity`, `zIndex`, `meta`, `transform`, `animate`, `position`, `top`, `right`, `bottom`, `left`). `strokeScaling?: "transform" | "canvas"` controls whether a solid border scales with post-layout transforms or keeps its canvas-space width; the default is `"transform"`. `animate?: AnimationSpec` attaches a declarative opacity/transform track; see [Animation](/guides/animation).

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

### Row Layout

<!--@include: ../_generated/flex-row.md-->

### Space Between

<!--@include: ../_generated/flex-space-between.md-->
