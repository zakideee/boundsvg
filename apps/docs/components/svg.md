---
title: Svg
---

# Svg

Embed raw SVG content as a nested element. Use to embed third-party SVGs or complex vector graphics that don't need boundsvg's text measurement.

No children allowed.

## Props

| Prop                  | Type                          | Required | Default  | Description                                                                                                                                     |
| --------------------- | ----------------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`             | `string`                      | Yes      | —        | Raw SVG string content                                                                                                                          |
| `width`               | `number`                      | Yes      | —        | Display width in px                                                                                                                             |
| `height`              | `number`                      | Yes      | —        | Display height in px                                                                                                                            |
| `preserveAspectRatio` | `"none" \| "meet" \| "slice"` |          | `"meet"` | How to fit the SVG content into the display box                                                                                                 |
| `contentIdPrefix`     | `string`                      |          | —        | Prefix for embedded SVG content IDs to avoid collisions                                                                                         |
| `opacity`             | `number`                      |          | —        | Opacity (0–1)                                                                                                                                   |
| `zIndex`              | `number`                      |          | —        | Sibling-local paint order (integer; higher paints later)                                                                                        |
| `meta`                | `Record<string, string>`      |          | —        | Metadata emitted as `data-boundsvg-meta-*` attributes and into the layered manifest (max 16 keys, `[a-z][a-z0-9-]{0,31}` keys, 256-char values) |
| `transform`           | `Transform2D`                 |          | —        | Static post-layout paint transform                                                                                                              |
| `animate`             | `AnimationSpec`               |          | —        | Declarative opacity/transform track; see [Animation](/guides/animation)                                                                         |

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

| Prop             | Type     | Description                                                                                |
| ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| `onClick`        | `string` | Click handler reference                                                                    |
| `onDoubleClick`  | `string` | Double-click handler reference                                                             |
| `onContextMenu`  | `string` | Context menu handler reference                                                             |
| `onPointerMove`  | `string` | Pointer move handler reference                                                             |
| `onPointerEnter` | `string` | Pointer enter handler reference                                                            |
| `onPointerLeave` | `string` | Pointer leave handler reference                                                            |
| `id`             | `string` | Stable NodeId for hit-testing                                                              |
| `layer`          | `string` | Layer id for [Layered Export](/guides/layered-export). Always rendered as an atomic island |

All 21 event handler props are supported. See [Event Handlers](/api/core#event-handlers) for the full list.

## Example

```tsx
const mapSvg = fs.readFileSync("world-map.svg", "utf-8");

<Canvas width={800} height={400}>
  <Svg
    content={mapSvg}
    width={800}
    height={400}
    preserveAspectRatio="meet"
    contentIdPrefix="map-"
  />
</Canvas>;
```

::: info
Use `contentIdPrefix` when embedding multiple SVG sources to prevent internal ID collisions (e.g. gradient/filter IDs).
:::
