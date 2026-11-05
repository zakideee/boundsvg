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

| Prop              | Type                                         | Description                                                                                                                                     |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`      | `string`                                     | Background color                                                                                                                                |
| `boxShadow`       | `string`                                     | Box shadow (e.g. `"0 4 8 0 rgba(0,0,0,0.2)"`)                                                                                                   |
| `borderWidth`     | `number \| [T, R, B, L]`                     | Layout-reserving border widths (px)                                                                                                             |
| `outline`         | `BoxOutlineStyle`                            | Line decoration following the resolved outer contour; reserves no layout space                                                                  |
| `borderColor`     | `string`                                     | Border color                                                                                                                                    |
| `borderRadius`    | `number \| [number, number, number, number]` | Border radius                                                                                                                                   |
| `overflow`        | `"visible" \| "clip"`                        | Child paint: "clip" uses the layout box and resolved borderRadius; "visible" leaves children unclipped                                          |
| `opacity`         | `number`                                     | Opacity (0–1)                                                                                                                                   |
| `zIndex`          | `number`                                     | Sibling-local paint order (integer; higher paints later)                                                                                        |
| `meta`            | `Record<string, string>`                     | Metadata emitted as `data-boundsvg-meta-*` attributes and into the layered manifest (max 16 keys, `[a-z][a-z0-9-]{0,31}` keys, 256-char values) |
| `transform`       | `Transform2D`                                | Static post-layout paint transform                                                                                                              |
| `transformOrigin` | `BoxPosition`                                | Origin in the outer layout box; see [static transform origins](/api/core#static-transform-origins).                                             |
| `animate`         | `AnimationSpec`                              | Declarative opacity/transform track; see [Animation](/guides/animation)                                                                         |

With `overflow="clip"`, the clipping boundary also cuts the Box's own border
and shadow at its rounded corners.

The same explicit rectangular or rounded clip excludes pointer hits on the
Box and its descendants outside that boundary. `overflow="visible"` does not
exclude child hits merely because the background has rounded corners.

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

### Border surfaces and outlines

`width` and `height` describe the outer border box. `borderWidth` reserves
space before padding, including when `borderColor` is absent or transparent.
For example, border 12 and padding 8 place content 20 px from the outer edge.
Automatic dimensions include content, padding, and borders. Small fixed sizes
are floored by the combined border and padding. Absolute child insets also use
the inset layout origin.

The border paints the outer contour minus the inset contour. At each corner,
the inset horizontal radius is `max(0, outerRadius - horizontalBorder)` and
the vertical radius is `max(0, outerRadius - verticalBorder)`, each capped at
half the corresponding inset dimension. If either inset dimension disappears,
`overflow="clip"` hides content completely. This is the library's geometry
normalization rule. With visible overflow, content may extend outside the box;
the border surface still stays inside the outer contour.

Use `outline` for a dashed or canvas-stable frame that follows automatic size:

```tsx
<Flex
  flexGrow={1}
  padding={20}
  borderRadius={16}
  borderWidth={[12, 4, 8, 16]}
  borderColor="#30384f"
  outline={{ stroke: "#a8b7ff", strokeWidth: 2, strokeDasharray: "8,4" }}
>
  <Text font="Inter" fontSizePx={28}>
    A frame that fits its content
  </Text>
</Flex>
```

```ts
type BoxOutlineStyle = {
  stroke: string;
  strokeWidth?: number; // default 1
  strokeScaling?: "transform" | "canvas";
  strokeDasharray?: string;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  strokeMiterlimit?: number; // default 4
};
```

The outline uses the same stroke vocabulary as Path. It paints after content,
on the outer contour's centerline, independently of border widths. It follows
the owner's transform, opacity, filter, and outer clip. With `overflow="clip"`,
the outer half of its stroke is clipped. The content's inner clip does not
clip the outline. Its ID, layer, and handlers belong to the owning container.

Widths are finite, nonnegative, and at most 1,048,576 px; outline miterlimit
is between 1 and 1,048,576. Containers using border or outline require
nonnegative radii. Border-bearing nodes also bound authored layout lengths to
absolute values at most 1,048,576 px. The four widths are normalized to f32 once
for layout and paint; tiny positive values may become zero.

For solid canvas-stable frames, set `outline.strokeScaling="canvas"`.
Dash patterns, non-uniform scale, skew, and axis reflection are rejected in
that mode; see [Known Limitations](/reference/known-limitations).

The former container-level `strokeScaling`, `strokeDasharray`, `strokeLinecap`,
`strokeLinejoin`, and `strokeMiterlimit` fields are removed. Move line decoration
to `outline`, placing its color in `stroke` and its width in `strokeWidth`.
Remove `borderWidth` when the frame should reserve no layout space. Keep
`borderWidth` and `borderColor` only for a border surface. Unknown and removed
fields fail validation rather than being silently ignored.

## Example

<!--@include: ../_generated/box-styled.md-->
