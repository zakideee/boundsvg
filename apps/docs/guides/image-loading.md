---
title: Image Loading
---

# Image Loading

The render pipeline performs no network I/O: `renderToSvg`, `renderToPng`, and `compile` never call `fetch`. An `Image` node renders embedded bytes (`Uint8Array` + `mediaType`) or a `data:` URI; any other URL string passes through to the SVG `href` unfetched, and raster output omits it with an `IMAGE_SRC_NOT_EMBEDDED` warning. Loading image bytes is therefore a separate, explicit step, and this guide covers the utilities for it.

## `createImageLoader` (`@boundsvg/core`)

`createImageLoader(fetchImage)` builds a loader around a fetch implementation you inject. Core ships no default implementation — how bytes are obtained (HTTP, file system, bundler asset, object storage) stays your decision.

```ts
import { createImageLoader } from "@boundsvg/core";
import { readFile } from "node:fs/promises";

const imageLoader = createImageLoader(async (url) => ({
  data: new Uint8Array(await readFile(new URL(url))),
  mediaType: "image/png",
}));

const { data, mediaType } = await imageLoader.load("file:///assets/logo.png");
```

The example hardcodes `mediaType` because it loads one known PNG; a general-purpose `fetchImage` must derive the media type per URL (extension mapping, magic bytes, or metadata) — the loader passes it through without checking.

Behavior, precisely:

- **Single-flight** — concurrent `load(url)` calls for the same URL share one `fetchImage` call and resolve with the same result.
- **Success retention** — a resolved result is kept until `clear()`. There is no size bound or TTL: the loader holds bytes for every distinct URL it has loaded, so scope a loader to a batch or session rather than treating it as a managed cache.
- **Failure retry** — a rejected load is not retained; the next `load(url)` fetches again.
- **Shared bytes** — every caller receives the same `LoadedImage` object and `data` buffer. Treat it as immutable; mutating the array corrupts what later callers receive.
- **`clear()`** forgets cached and in-flight entries so subsequent loads fetch again. Fetches already in flight still settle for their original callers — which means a `load(url)` issued after `clear()` while the old fetch is still running starts a second, concurrent fetch for the same URL.

## `createBrowserImageLoader` (`@boundsvg/browser`)

A `globalThis.fetch`-backed implementation returning the same `ImageLoader` interface (`load` / `asResolver` / `clear`), with the same single-flight and retention behavior:

```ts
import { createBrowserImageLoader } from "@boundsvg/browser";

const imageLoader = createBrowserImageLoader();
const loaded = await imageLoader.load("/assets/photo.png");
```

- The media type comes from the response `Content-Type` header, with parameters stripped (`image/svg+xml; charset=utf-8` → `image/svg+xml`).
- Responses with a missing or malformed `Content-Type` header are rejected (`Failed to determine image media type`), and so are responses whose media type is not `image/*` (`unexpected media type`). The latter catches servers that answer a missing asset with a `200 text/html` fallback page — bytes that would otherwise become a data URI that renders nothing.
- Non-OK responses reject, and are retried on the next `load` call.
- `fetchOptions` forwards `RequestInit` values (headers, credentials) to **every** request the loader makes. There is no per-`load` override, so an `AbortSignal` passed here aborts all current and future loads — scope a signal-bound loader to the signal's lifetime.

The loaded `mediaType` is a plain `string`, while `Image` accepts `"image/png" | "image/jpeg" | "image/svg+xml"` — check for the format you expect before passing it through:

```tsx
if (loaded.mediaType !== "image/png") {
  throw new Error(`unexpected media type: ${loaded.mediaType}`);
}

<Image src={loaded.data} mediaType="image/png" width={200} height={100} />;
```

## Inlining external `<image>` references

Raw SVG content passed to the `Svg` component can carry external `<image href="...">` references. `inlineExternalImages` (`@boundsvg/core/svg`) resolves them to data URIs — required before rasterization, since the PNG pipeline does not fetch either. The result is self-contained when `failed` and `skipped` are both empty; check them instead of assuming:

```ts
import { inlineExternalImages } from "@boundsvg/core/svg";

const result = await inlineExternalImages(svgString, imageLoader.asResolver());

result.svg; // hrefs replaced with data URIs
result.inlined; // hrefs that were resolved
result.failed; // hrefs the resolver returned null for
result.skipped; // hrefs the safety filter refused (path traversal, dangerous schemes)
```

`asResolver()` adapts an `ImageLoader` to the resolver contract:

- Resolutions go through the loader's cache, so repeated hrefs across documents fetch once.
- A failed load resolves to `null` and the href lands in `failed` — the document still renders, with that reference left external.
- A `FatalError` thrown by your `fetchImage` is rethrown instead of nulled — and a resolver that throws rejects the whole `inlineExternalImages` call, so a misconfigured loader surfaces as an error rather than a silently image-less document. Catch it at the call site if a partial result matters to you.

Hand-written resolvers (without `asResolver()`) are validated per href: a result that is not `{ data: Uint8Array, mime: string }` with a well-formed MIME type throws `FatalError` `IMAGE_RESOLVER_INVALID_RESULT`, again rejecting the whole call.

`skipped` entries are hrefs the WASM-side safety filter refused to resolve at all. They stay external in the output; an offline pipeline must decide what to do with them.

## Choosing an approach

| Situation                                                   | Approach                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Bytes available at build time (bundled assets, local files) | Read them yourself, pass `Uint8Array` + `mediaType` to `Image`    |
| Remote images in a browser app                              | `createBrowserImageLoader`, then pass the loaded bytes to `Image` |
| Remote images in Node.js or a custom runtime                | `createImageLoader` with your own `fetchImage`                    |
| Raw SVG content with external `<image>` references          | `inlineExternalImages` + `loader.asResolver()`                    |
