---
title: PNG, WebP & GIF Export
---

# PNG, WebP & GIF Export

## Basic Usage

```ts
const png: Uint8Array = engine.renderToPng(node);
```

The PNG pipeline: IR → SVG → resvg → PNG.

## Scaling

Use the `scale` option for higher resolution output:

```ts
const png = engine.renderToPng(node, { scale: 2 });
// A 400×200 canvas produces an 800×400 PNG
```

SVG supports the same output-resolution option, but applies it differently: it
multiplies root `width` / `height` and canvas-stroke restoration CSS while
leaving `viewBox`, child geometry, and ordinary attributes unchanged. Raster
output uses it for pixel dimensions and applies the resolution caps below.

## Background Color

Neither SVG nor PNG paints a background unless you ask for one — set `Canvas background` for both, or `rasterBackground` for raster output only:

```ts
const png = engine.renderToPng(node, {
  rasterBackground: "#ffffff",
});
```

## Glyph outline grouping

Text is always converted to `<path>` elements (glyph outlines) in the
intermediate SVG before rasterization. The `textPathMode` option controls how
glyph paths from `Text` and `TextOnPath` are grouped in the SVG stage, but it
does not configure path layout and has no visible effect on PNG output—the
rasterized result is identical regardless of mode.

See [Text & Fonts — Glyph outline grouping](/guides/text-and-fonts#glyph-outline-grouping-textpathmode)
for details on `"merged"` vs `"glyphs"`.

## Layered PNG Export

Use [`engine.renderToLayeredPng`](/api/core#engine-rendertolayeredpng-input-options) when you need one PNG per logical layer instead of a single flattened image. Layered PNG uses the [`layer` prop](/guides/layered-export#the-layer-prop) to group paint operations.

```ts
const result = engine.renderToLayeredPng(vnode, { scale: 2 });
for (const layer of result.layers) {
  console.log(layer.id, layer.paintOrder, layer.png.length);
}
```

boundsvg never composites a raster background into a layer: `rasterBackground` is not supported. A `Canvas background` still paints edge-to-edge into the `default` layer, so that layer's PNG carries the background, alpha included — put it on its own layer if you want it separable and round-tripping through the manifest. The same 3 840 px long-edge and 8.3 M-pixel caps apply. See the [Layered Export guide](/guides/layered-export) for layer resolution rules, compositing islands, and composition validation.

## WebP

`renderToWebp` produces a lossless (VP8L) WebP from the same pipeline, with the
same `scale`, `rasterBackground`, and resolution caps as PNG:

```ts
const webp = engine.renderToWebp(node, { scale: 2 });
```

Lossless WebP is usually smaller than the equivalent PNG. There is no lossy
mode, so there is no quality knob — which is also what keeps the bytes
deterministic.

## Animated WebP and GIF

`renderToAnimatedWebp` samples a declarative animation into static frames and
muxes them into an animated file:

```ts
const webp = engine.renderToAnimatedWebp(node, {
  durationMs: 2000,
  fps: 20,
  iterations: "infinite",
});
```

`renderToAnimatedGif` writes the same sampling as a GIF. GIF quantizes each
frame to 256 colors with 1-bit alpha, so prefer animated WebP when the frames
must survive intact; reach for GIF when a consumer cannot display WebP.

Both APIs require `iterations`, which means total plays rather than extra
repeats. Animated WebP accepts 1–65535, GIF accepts 1–65536, and both accept
`"infinite"`. GIF omits its repeat extension for `iterations: 1`.

Both cap at 300 frames. See [Animation](/guides/animation) for how the frames
are sampled, and [Known Limitations](/reference/known-limitations) for the
format-specific constraints.
