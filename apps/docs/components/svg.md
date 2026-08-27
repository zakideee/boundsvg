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
| `contentIdPrefix`     | `string`                      |          | —        | Prefix exact embedded IDs and supported same-document references; see [ID rewriting](#id-rewriting)                                             |
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

## ID rewriting

Use a non-empty `contentIdPrefix` when embedding multiple SVG sources whose internal IDs could collide. The rewriter preserves the original attribute order, quotes, whitespace, comments, CDATA, text, and entity spelling. It changes only exact `id` attribute values and supported references to IDs defined in the same embedded SVG.

Supported references are:

- fragment-only `href` and `xlink:href` values;
- `url(#id)` in `clip-path`, `color-profile`, `cursor`, `fill`, `filter`, `marker`, `marker-start`, `marker-mid`, `marker-end`, `mask`, `stroke`, and `style` attributes;
- `url(#id)` and flat ID selectors in a `<style>` block;
- WAI-ARIA single-ID attributes (`aria-activedescendant`, `aria-details`, `aria-errormessage`) and ID-list attributes (`aria-controls`, `aria-describedby`, `aria-flowto`, `aria-labelledby`, `aria-owns`);
- SMIL `begin` and `end` timing lists using syncbase, eventbase, `repeat()`, `marker()`, deprecated `id(...)`, offsets, or escaped ID values.

External references and references to unknown IDs remain unchanged. Attribute names are matched exactly, so values in `data-id`, `data-href`, comments, CDATA, metadata text, and similarly named attributes are not rewritten. Class names, custom properties, and authored keyframe names are outside this namespace.

With a non-empty prefix, malformed start-tag/declaration syntax and ambiguous supported syntax that points to a known local ID fail before output with `CONTENT_ID_PREFIX_MALFORMED_XML` or `CONTENT_ID_PREFIX_UNSUPPORTED_REFERENCE`. CSS block at-rules and nested CSS blocks are unsupported. Omitting the prefix, or passing an empty string, keeps the existing pass-through behavior.

Use `analyzeEmbeddedSvgIds()` from `@boundsvg/core/svg` to inspect exact definitions, duplicates, supported reference kinds, their source attributes and syntax, and unresolved IDs before rendering. The analyzer applies the same structural safety boundary and reports failures at the `analyzer` stage.
