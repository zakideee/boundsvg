---
title: "@boundsvg/browser"
---

# @boundsvg/browser

Browser utilities for WASM loading, font fetching, SVG event coordinate helpers, and PNG asset handling. Most React users should start with `@boundsvg/react`; import this package directly when building browser-only tools.

## `@boundsvg/browser/assets`

```ts
import { downloadPng, readPngDimensions } from "@boundsvg/browser/assets";

const dimensions = readPngDimensions(png);

if (dimensions) {
  console.log(dimensions.width, dimensions.height);
}

downloadPng(png, "card.png");
```

| API                 | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `readPngDimensions` | Reads PNG width and height from the byte header without decoding pixels |
| `downloadPng`       | Creates a temporary object URL and triggers a browser download          |

`downloadPng` uses browser DOM APIs and should not be called from render functions, Node.js scripts, or SSR.

## `@boundsvg/browser` (layered helpers)

Convenience wrappers around `LayeredSvgResult` / `LayeredPngResult`. See [Layered Export](/guides/layered-export).

```ts
import {
  composeLayeredSvgInline,
  layeredPngToBlobs,
  layeredPngToDataUrls,
  layeredSvgToDataUrls,
} from "@boundsvg/browser";

const dataUrls = layeredPngToDataUrls(pngResult);
const blobs = layeredPngToBlobs(pngResult);
const svgUrls = layeredSvgToDataUrls(svgResult);
const html = composeLayeredSvgInline(svgResult, { order: "paint" });
```

| API                       | Description                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `layeredPngToDataUrls`    | Produce one `data:image/png;base64,...` URL per layer PNG                             |
| `layeredPngToBlobs`       | Produce one `Blob` per layer PNG (suitable for `URL.createObjectURL`)                 |
| `layeredSvgToDataUrls`    | Produce one UTF-8 `data:image/svg+xml;base64,...` URL per layer SVG                   |
| `composeLayeredSvgInline` | Build an HTML fragment that stacks every layer SVG absolutely in paint or array order |

`composeLayeredSvgInline` returns an HTML string and does not touch the DOM; the caller is responsible for injecting it. Use `order: "paint"` (default) to sort by ascending `paintOrder`, or `order: "array"` to preserve the input order.

## `@boundsvg/browser` (image loading)

`createBrowserImageLoader` builds a [`createImageLoader`](/api/core#createimageloader-fetchimage) instance backed by `globalThis.fetch`. The media type is taken from the response `Content-Type` header (parameters stripped). Responses without an `image/*` media type are rejected — this catches servers that answer a missing asset with a `200 text/html` fallback page.

```ts
import { createBrowserImageLoader } from "@boundsvg/browser";

const imageLoader = createBrowserImageLoader();
const { data, mediaType } = await imageLoader.load("/assets/logo.png");
```

Concurrent loads of the same URL share one request, successful results are cached until `clear()`, and failed loads are retried on the next call. Pass `fetchOptions` to forward `RequestInit` values (headers, credentials) to every fetch. Note that `fetchOptions` applies to every request the loader makes — an `AbortSignal` passed here aborts all current and future loads, so scope a signal-bound loader to the signal's lifetime.

## Related entry points

| Entry point                | Use case                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `@boundsvg/browser/wasm`   | Load the web-target WASM module                                                          |
| `@boundsvg/browser/fonts`  | Fetch and cache font definitions in browser applications                                 |
| `@boundsvg/browser/png`    | Convert PNG bytes to Blob, data URL, or object URL                                       |
| `@boundsvg/browser/assets` | Inspect PNG dimensions and trigger user-initiated download                               |
| `@boundsvg/browser/events` | Translate DOM client coordinates to SVG user space and resolve path-geometry hit targets |

## WASM shape capabilities

`loadWasmModule()` validates the generated browser adapter before returning
it. In addition to the engine and text exports, these shape exports are all
required:

```text
compile_shape_svg
hit_test_shape_parts
compile_shape_paths
resolve_symbol_geometry
evaluate_shape_parts
evaluate_shape_region
render_shape_region_svg
divide_shape_regions
compute_shape_intersections
```

If any export is missing, loading fails immediately with the missing export
name. Pass the returned module to `initWasm()` from `@boundsvg/core/wasm`; its
schema must match the Core package. Keep the browser package, Core package,
and copied WASM artifacts on the same release.
