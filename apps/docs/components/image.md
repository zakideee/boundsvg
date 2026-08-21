---
title: Image
---

# Image

Embed raster images.

## Props

| Prop             | Type                                             | Required | Default    | Description                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------ | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src`            | `Uint8Array \| string`                           | Yes      | —          | Image bytes, or a `data:` URI. A URL/path string is passed through to the SVG `href` but is **not fetched** — raster output omits it and a `IMAGE_SRC_NOT_EMBEDDED` warning is emitted. Read the file yourself and pass the bytes. |
| `mediaType`      | `"image/png" \| "image/jpeg" \| "image/svg+xml"` |          | —          | Required when `src` is `Uint8Array`                                                                                                                                                                                                |
| `width`          | `number`                                         | Yes      | —          | Width in px                                                                                                                                                                                                                        |
| `height`         | `number`                                         | Yes      | —          | Height in px                                                                                                                                                                                                                       |
| `objectFit`      | `"fill" \| "contain" \| "cover"`                 |          | `"fill"`   | Image fitting mode                                                                                                                                                                                                                 |
| `objectPosition` | `string`                                         |          | `"center"` | Image position within the box (e.g. `"top"`, `"center"`)                                                                                                                                                                           |
| `borderRadius`   | `number \| [number, number, number, number]`     |          | —          | Border radius for rounded image clipping                                                                                                                                                                                           |
| `opacity`        | `number`                                         |          | —          | Opacity (0–1)                                                                                                                                                                                                                      |
| `zIndex`         | `number`                                         |          | —          | Sibling-local paint order (integer; higher paints later)                                                                                                                                                                           |
| `meta`           | `Record<string, string>`                         |          | —          | Metadata emitted as `data-boundsvg-meta-*` attributes and into the layered manifest (max 16 keys, `[a-z][a-z0-9-]{0,31}` keys, 256-char values)                                                                                    |
| `transform`      | `Transform2D`                                    |          | —          | Static post-layout paint transform                                                                                                                                                                                                 |
| `animate`        | `AnimationSpec`                                  |          | —          | Declarative opacity/transform track; see [Animation](/guides/animation)                                                                                                                                                            |

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

## objectFit Mapping

| Value       | SVG `preserveAspectRatio` | Description                            |
| ----------- | ------------------------- | -------------------------------------- |
| `"fill"`    | `"none"`                  | Stretch to fill the box                |
| `"contain"` | `"xMidYMid meet"`         | Scale to fit, maintaining aspect ratio |
| `"cover"`   | `"xMidYMid slice"`        | Scale to cover, cropping as needed     |

## Example

```tsx
import fs from "node:fs";

const logo = fs.readFileSync("logo.png");

<Image
  src={logo}
  mediaType="image/png"
  width={200}
  height={100}
  objectFit="contain"
/>;
```

### Fetching remote images

The render pipeline never fetches URLs. To embed a remote image, load the bytes first — `createBrowserImageLoader` (`@boundsvg/browser`) caches results and merges concurrent requests for the same URL:

```tsx
import { createBrowserImageLoader } from "@boundsvg/browser";

const imageLoader = createBrowserImageLoader();
const loaded = await imageLoader.load("https://example.com/logo.png");
// The loaded mediaType is a plain string — narrow it to the union
// Image accepts before passing it through.
if (loaded.mediaType !== "image/png") {
  throw new Error(`unexpected media type: ${loaded.mediaType}`);
}

<Image src={loaded.data} mediaType="image/png" width={200} height={100} />;
```

In Node.js or custom runtimes, use `createImageLoader` (`@boundsvg/core`) with your own fetch implementation. See the [core API reference](/api/core#createimageloader-fetchimage).

### Data URL

<!--@include: ../_generated/image-dataurl.md-->

::: info
If the image fails to load, a placeholder rectangle is rendered (recoverable error).
:::
