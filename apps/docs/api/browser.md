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

## Animated raster storage

The root entry exports `createAnimatedRasterFileSink(fileHandle)` and
`createAnimatedRasterSpool(directoryHandle)`. Callers supply handles and obtain
permissions; these helpers do not open a picker. Supported file handles expose
`createWritable`. Missing capabilities or denied permissions produce structured
`ANIMATED_RASTER_SINK_UNAVAILABLE`; storage failures use
`ANIMATED_RASTER_SINK_FAILED`.

```ts
import { createAnimatedRasterFileSink } from "@boundsvg/browser";

const sink = await createAnimatedRasterFileSink(fileHandle);
try {
  await engine.renderToAnimatedWebp(
    scene,
    {
      durationMs: 2000,
      fps: 20,
      iterations: 1,
    },
    sink,
  );
} catch (error) {
  await sink.abort(error);
  throw error;
}
```

The writable starts with empty replacement content and applies the WebP patch
before close. Finish commits through close; abort waits for pending IO and
cancels only uncommitted writes. It never deletes the caller's file or removes
output after successful close. A fresh sink rejected before Engine adoption is
still the caller's cleanup responsibility.

For a sequential destination, obtain a directory handle, such as an OPFS root,
and pass `await createAnimatedRasterSpool(directory)` together with the
sequential sink to `createAnimatedWebpSpoolSink` from Core. The spool owns one
temporary file, reads at most 64 KiB per transfer, and removes only that file
on disposal. Browser storage support and quota depend on the host; a spool is
not a complete-file memory collector. Await an already invoked finish transfer
rather than assuming immediate cancellation.

## Related entry points

| Entry point                | Use case                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `@boundsvg/browser/wasm`   | Load the web-target WASM module                                                         |
| `@boundsvg/browser/fonts`  | Fetch and cache font definitions in browser applications                                |
| `@boundsvg/browser/png`    | Convert PNG bytes to Blob, data URL, or object URL                                      |
| `@boundsvg/browser/assets` | Inspect PNG dimensions and trigger user-initiated download                              |
| `@boundsvg/browser/events` | Query current native paint/semantic Frames and attach the shared interaction controller |

## DOM hit testing and source ownership

Render with `nodeIdMetadata: "include"`, build one source index for the exact IR,
and bind the actual outer SVG. Labels can repeat; use snapshot-local refs and
physical ordinals rather than node-ID DOM lookups.

React's `useInteractiveSvg` discovers exactly one outer SVG in its container
(`ownerSVGElement === null`). A single SVG inside HTML wrappers is supported;
multiple outer SVGs or no outer SVG produce `invalid`/`bindingMismatch` and no
input callbacks from that binding. Nested SVG paint is not an additional outer root. Manual Browser
callers pass the intended root explicitly to `bindIRToSvg`.

```ts
import {
  buildIRSourceIndex,
  resolveInteractionTarget,
} from "@boundsvg/core/scene";
import { bindIRToSvg, queryCurrentSvgHit } from "@boundsvg/browser/events";

const index = buildIRSourceIndex(ir);
const binding = bindIRToSvg(svgElement, index);
const query = queryCurrentSvgHit(binding, clientX, clientY);
if (query.status === "ready") {
  const target = query.hit ? resolveInteractionTarget(index, query.hit) : null;
}
```

`queryCurrentSvgHit` reads current native paint and semantic Frames. A Frame is
a handler-bearing source Group without primary paint. Its local area is a
closed rectangle, including corners, restricted by its own and ancestor
library BoxClips at their current endpoint poses. Zero-area Frames and
zero-column Frame poses are empty. Positive-size empty Text Frames can receive
events if their source has no primary occurrence. Ordinary empty Text can retain
an empty content Text primary; its positive layout box alone does not make it a
Frame. Painted Text, parts, Image and embedded Svg use native hit behavior.
Native hit testing is not a pixel-alpha test.

Frame rectangles include their own boundary, but canonical BoxClips and the IR
viewport use strict interiors. Their straight and elliptical outer boundaries
exclude Frame candidates, including Frames that only touch a clip. Fractional
points immediately inside remain eligible: this does not disable an entire
one-pixel strip. At identity integer placement and DPR 1, an integer query on the
left/top outer boundary can coincide with the first painted pixel column/row
while still excluding the Frame.

Only Frame candidates pass through the IR viewport gate. Native paint keeps the
browser's boundary behavior and can still target a valid handler-bearing
ancestor, even outside that Frame domain. Snapshot queries instead apply the
strict viewport and clip gates to every candidate, including paint candidates.
Native paint and Core snapshot results need not agree on an outer boundary.

Native hit testing can select paint that only touches a clip boundary.
Observations at fixed query coordinates include a background Box receiving its
handler callback while the neighboring Box's color is the visible raster pixel.
This can occur even with strict Frame gates; which paint the browser selects is
not a fixed cross-browser guarantee. The gates remove semantic Frame
supplementation at those boundaries without reapplying Core clips to native
paint. They do not guarantee removal of every visually hidden callback or full
restoration of earlier Browser hit behavior. SVG/PNG emission and valid native
paint callbacks to ancestor handlers are preserved.

Strict comparisons use the supplied floating coefficients without tolerance.
Different rounded transforms can leave a tiny overlap even when authored shapes
touch in ideal real arithmetic (for example, composed 90°/−90° rotations).
Comparisons against the same computed straight edge are complementary; this is
not an exact-contact guarantee for rounded corners or differently rounded poses.

An empty semantic Frame does not suppress native paint in its subtree. Some
browsers, including WebKit, can still report zero-scale paint as a native hit;
that paint can dispatch to its outermost handler-bearing ancestor. A zero-area
Frame therefore does not guarantee that its descendants cannot receive events.

Paint enter-order and Frame leave-order share one IR ranking. Handlerless paint
still occludes lower sources. The event target is the outermost handler-bearing
Frame ancestor, or the selected source itself. Paint overflowing a parent Frame
can still target that ancestor. HTML or another SVG in front blocks the query;
owned shadow hosts are checked from the Document inward, with actual SVG-root
reachability required in the innermost scope. Closed shadows and slots do not
borrow another SVG's metadata.

Frame geometry supports library-owned bbox/BoxClip shapes and library-generated
2D static transforms and animation states. Current screen prefixes and native CSS
local linear values provide evidence alongside the endpoint's current screen CTM.
Typed OM values and their native matrices must both be 2D; where that capability
is absent, native CSSOM matrix parsing is used. Native `none` supplies no local
witness; it does not reactivate an authored attribute. Failed native acquisition
is unavailable, with no weaker representation or old IR fallback.

External individual `scale`/`rotate`/`translate`, arbitrary 3D/perspective and
relative values that cannot be resolved natively are outside the semantic Frame
guarantee. Even planar `translateZ(0)` or `matrix3d` representations can become
unavailable when their native value is not 2D. External zero-scale may retain a
browser's identity CTM behavior. Native paint continues to use browser hit testing.
Changing external clip/mask geometry, SMIL clip shapes,
`pointer-events`, `visibility` or `display` is not promised to make a semantic
Frame match native paint. Arbitrary 3D/perspective transforms are outside this
Frame contract. Native paint retains browser behavior for those paint features.
A rounded outer frame without a BoxClip still has rectangular semantic corners;
no missing producer/radius information is inferred.

Only `{ status: "ready", point, hit: null }` is a normal miss. `point` is the
finite Core `SvgPoint` pair `{svgX, svgY}`. Invalid client coordinates or an
incomplete binding return `invalid` (`nonFiniteClientPoint`/`bindingMismatch`).
Missing, nonfinite, degenerate or unresolved root coordinates return
`unavailable` (`detached`/`coordinatesUnavailable`); unavailable native scope
APIs return `hitTestUnavailable`. Failed Frame/clip arithmetic also remains
unavailable. There is no proportional CTM fallback or old bbox rescue.
`translateSvgCoords(root, clientX, clientY)` returns the same coordinate states
without performing hit testing. It projects the coefficients returned by the
browser; it does not independently diagnose every CSS zero-scale pose.

### Coordinate-result migration

`translateSvgCoords` previously returned `{ x, y } | null`. It now returns the
`SvgCoordinateResult` discriminated union, exported from `@boundsvg/browser` and
`@boundsvg/browser/events`:

```ts
type SvgCoordinateResult =
  | Readonly<{
      status: "ready";
      point: Readonly<{ svgX: number; svgY: number }>;
    }>
  | Readonly<{ status: "invalid"; reason: "nonFiniteClientPoint" }>
  | Readonly<{
      status: "unavailable";
      reason: "detached" | "coordinatesUnavailable";
    }>;
```

A truthiness or null check no longer narrows the result. Replace old `point.x`
and `point.y` reads with `result.point.svgX` and `result.point.svgY` after checking
`status`. For example:

```ts
import { translateSvgCoords } from "@boundsvg/browser/events";

function logSvgCoordinates(
  root: SVGSVGElement,
  event: PointerEvent | MouseEvent,
) {
  const coordinates = translateSvgCoords(root, event.clientX, event.clientY);
  if (coordinates.status === "ready") {
    console.log(coordinates.point.svgX, coordinates.point.svgY);
  } else if (coordinates.status === "invalid") {
    // nonFiniteClientPoint
    console.warn(coordinates.reason);
  } else {
    // detached or coordinatesUnavailable
    console.warn(coordinates.reason);
  }
}
```

`bindingMismatch` and `hitTestUnavailable` belong to current hit queries, not to
this coordinate-only result. None of its failure states is a successful hit miss.

### Binding lifetime and current reads

`binding.isComplete` reports endpoint admission. `sourceForElement` resolves
semantic ownership, `occurrenceForElement` the physical occurrence, and
`elementForNode` the actual endpoint. Embedded Svg markup is opaque. A text-unit
carrier may resolve to Text without being its source animation endpoint.
Rebind after replacing the IR/root/topology; current pose changes do not require
rebinding. Snapshot refs are not persistent application identities.

Frame ranks are prepared in descending order. A known higher native paint or
Frame winner prevents lower candidates from being read. A Frame's endpoint,
pose and clips are required only when its rank can win and the point is inside
the IR viewport. Outside that viewport, those Frame reads are skipped: even a
throwing Frame getter remains unobserved and the native hit or miss remains
`ready`. The same getter at an interior point is `unavailable` when that Frame's
rank is eligible.

Noncanonical IR dimensions are checked when the shared Core viewport function
is actually called, after native scope and rank admission; this is not eager
validation of every Frame. Binding, root projection and native scope checks
retain their precedence. Eligible Frame constraints still validate required
inputs before preferring established emptiness over derived failures. Current
matrices and local native values are shared only within each query. For the
necessary unique SVG ancestry U, screen reads, style reads and native matrix
conversions are each at most U; no permanent pose cache or observer is installed.

### Shared interaction controller

`createSvgInteractionController(container)` owns listeners, hover, gestures,
callback groups, cursor, pointermove coalescing and stationary reevaluation.
Connect one committed scene with `setScene`, and call its idempotent `dispose`
when the container lifetime ends. React and vanilla consumers use the same
controller.

```ts
import { buildTextMap } from "@boundsvg/core/scene";
import {
  createSvgInteractionController,
  type SvgHoverState,
} from "@boundsvg/browser/events";
const controller = createSvgInteractionController(container);
function handleHoverState(hover: SvgHoverState): void {
  console.log(hover);
}
controller.setScene({
  binding,
  renderMode: "animated",
  handlers,
  textMap: buildTextMap(index),
  onHoverState: handleHoverState,
  onHoverChange(source) {
    console.log(source);
  },
});
// On actual container disposal:
controller.dispose();
```

`onHoverState` is seeded for a new receiver or IR source index, even if the hover
value is unchanged. With the same receiver, IR and state, it is not notified
again. Vanilla callers should reuse the receiver across handler-only `setScene`
updates, as with `handleHoverState` above; do not create a fresh receiver on each
synchronous recommit from that callback. This rule does not guarantee convergence
of arbitrary application feedback loops.

Static scenes have no idle RAF. Animated scenes keep at most one RAF while an
observed primary position is known, visible and connected, including native
miss/pause/finish. External pointer locations do not wake an unknown attachment.
Stationary reevaluation emits boundary groups, never synthetic move/down/up/click.
Blur/hidden freeze logical hover and lose physical position; a fresh eligible
container input resumes. Lost pointer capture is not gesture termination.
Primary touch termination clears hover and its known position. Compatibility
mouse events and clicks still query and dispatch their real callbacks, but do
not establish a new hover pointer after touch. A subsequent primary non-touch
pointer lifecycle input, such as enter, move or down, restores hover tracking.
A click being a PointerEvent does not by itself establish that authority.
Fresh attachments continue to accept MouseEvent-only input.
External owned up/cancel reaching Document bubble cancels the down owner once.
Terminals not observed by either container or Document may leave ownership until
new evidence, incompatible scene or dispose. Dispose/context teardown is silent.

Started callback groups and actual discrete inputs retain their original
snapshot through scene updates. Unstarted hover/move is discarded when its
scene expires. Handler-only updates retain DOM/clock and use the latest committed
callbacks; whole-topology correspondence governs canonical ref migration.
`SvgHoverState` is inactive/pending/ready/invalid/unavailable; only ready has a
source field. `onHoverChange` reports logical target changes, not every canonical
ref replacement.

Automatic text-copy menus require a native Text witness from the selected paint
or an ancestor Frame, plus its matching TextMap. A separate foreground Frame
blocks the lower Text menu even when both resolve to the same outer target.
The target's explicit `onContextMenu` takes priority. Static labels keep line
copy in animated documents when their own units and physical ancestors have no
IR-authored tracks; animated Text/ancestor tracks have a null sampled line point.
External CSS motion does not resample the snapshot TextMap or guarantee current
line selection, even when native paint and the interactive target move correctly.

The obsolete `nativePathCandidates`, `resolveHitTarget`, `verifyPathGeometry`
and live Path-candidate API are removed. For snapshot inspection, use Core
`buildInspectHitTestIndex`/`buildHitTestIndex` directly and keep coordinate failure
separate from a successful snapshot miss. Snapshot bounds are not current paint.

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
