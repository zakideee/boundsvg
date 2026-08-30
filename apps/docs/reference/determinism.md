---
title: Determinism Contract
---

# Determinism Contract

boundsvg's core promise: **identical inputs produce byte-identical output,
independent of the machine, OS, installed fonts, or JavaScript runtime.**

## The contract

Given the same

- boundsvg version (TS packages + bundled WASM, always shipped together),
- VNode tree (JSX input),
- font bytes (fonts are injected as data, never discovered from the OS),
- render options,

`renderToSvg` and `renderToAnimatedSvg` return the same SVG string, and
`renderToPng`, `renderToWebp`, `renderToAnimatedWebp`, and
`renderToAnimatedGif` return the same bytes on Node.js, in the browser, and in
a Web Worker.

This holds because the entire text pipeline — shaping (rustybuzz), line
breaking, kinsoku, vertical layout, font metrics — and the rasterizer (resvg)
and every image encoder run inside a single WASM module compiled once per
release. There is
no browser text engine, no `canvas.measureText`, and no OS font lookup
anywhere in the pipeline.

## WASM runtime variants

When a release includes multiple WASM variants, such as a scalar build and a
WebAssembly SIMD (`simd128`) build, the package loader selects a compatible
implementation automatically. It uses the SIMD variant when the runtime
supports it and falls back to the scalar variant otherwise. Consumers do not
need to replace bundled WASM files manually. Always keep the JavaScript
packages and their bundled WASM artifacts on the same boundsvg version; mixing
or replacing artifacts is unsupported.

## Text is always geometry

Declarative text (`<Text>`, `<Inline>`, `<Ruby>`) is emitted as **glyph
outline paths**, never as SVG `<text>` elements. The SVG you get renders
identically in every viewer because no viewer-side font resolution or
re-shaping happens. The same glyph paths feed the PNG rasterizer, so SVG and
PNG output show the same glyphs at the same positions by construction.

Accessibility is preserved via `aria-label` and `data-boundsvg-text`
attributes on each text group.

## Canvas-stable stroke fallback

For `strokeScaling: "canvas"` on a `Flex`, `Grid`, or `Box` border or a `Path`,
animated SVG contains both a sampled fallback width and an `@supports`
rule for the standard `vector-effect: non-scaling-stroke` behavior. Supporting
browsers use the authored canvas-space width during playback. Static renderers
such as the bundled resvg ignore the conditional rule and draw the fallback
computed from the sampled `timeMs` pose.

This split preserves the same base-pose meaning for SVG, PNG, WebP, GIF, and
the PNG frames supplied to MP4 encoders. The fallback is derived only from
post-layout node transforms. The format-specific render option `scale` is part
of output resolution and still multiplies the final device-pixel width. For
SVG it changes root `width` / `height` and this restoration CSS width, but not
the `viewBox`, child geometry, or ordinary stroke attributes.

## Exceptions — read this

1. **`<text>` inside embedded SVG content.** The `<Svg>` component passes
   external SVG markup through. If that markup contains `<text>` elements,
   they are re-shaped by the _viewer_ when displaying the SVG and by resvg's
   font database when rasterizing to PNG — these can differ from each other
   and between environments. Convert embedded text to paths upstream if you
   need the guarantee to cover it.
2. **Animation playback timing.** Animated SVG uses CSS `@keyframes`, and
   animated GIF stores delays in 10 ms units that browsers override below
   2 centiseconds. Animated SVG bytes are covered in both `independent` and
   `timeline` modes, as are the static SVG baked at `timeMs`, PNG output, IR,
   and the animated SVG's attribute base pose. A non-CSS viewer or resvg shows
   that deterministic base-pose still.

   Timeline live playback has a separate computed-value contract in supported
   browsers. Away from discontinuities it follows the document sampler within
   the published numeric tolerance. Inside the bounded discontinuity window it
   may use either one-sided continuation; at the exact instant it may show the
   left or right limit. Browser scheduling still decides when a wall-clock
   frame is painted, so wall-clock timing and independent-mode live evaluation
   are not byte-determinism claims. Use static rendering with the document-time
   mapping in the [Animation guide](/guides/animation#document-timeline-playback)
   for exact checkpoint verification.

   boundsvg emits a `prefers-reduced-motion` opt-out only when
   `reducedMotion: "pause"` is passed; the default `"keep"` emits nothing. The
   choice is part of the input, and timeline validation and budgets apply in
   either case.

3. **Encoded video is not covered at all.** MP4 export — `renderToMp4` in the
   browser, `--format mp4` in the CLI — hands the sampled frames to an encoder
   boundsvg does not ship: the browser's WebCodecs implementation, or an ffmpeg
   you installed. Those bytes depend on the encoder version, its build options,
   and whether it ran on hardware, so two machines will not agree. The contract
   covers the input to that step and stops there: the PNG frames the sampler
   produces are byte-identical, each one a `renderToPng` of the scene at that
   `timeMs` under the options the exporter passes — both force an opaque
   background, and the CLI applies its own `--scale` default. The browser exporter's container timing is also exact — timescale =
   frame-rate numerator, one denominator-length tick per sample — because it
   writes that container itself. The CLI's container is ffmpeg's, timebase
   included. See [Video Export](/guides/video-export).
4. **Cross-version stability is not promised.** Output may change between
   boundsvg versions (improved line breaking, metric fixes), so pin exact
   versions for snapshot tests. Raster bytes are also tied to the encoder
   crates bundled in the WASM module — `png` for PNG, `image-webp` for WebP,
   `gif` for GIF — so an encoder update moves output even when nothing about
   the scene changed. How such changes are declared, and what that declaration
   does and does not guarantee, is described once in
   [Output stability](/getting-started/versioning#output-stability).
5. **`Math`/time/randomness in your own code** obviously breaks reproducibility
   before boundsvg is even involved. Document-global identifiers generated by
   boundsvg are deterministic (`resourceIdPrefix` controls their literal
   namespace; nothing is random). To guarantee non-intersection between SVGs
   embedded in one document, their normalized prefixes must be non-empty and
   pairwise prefix-free; merely different prefixes are insufficient.

## Why this matters

- **Visual regression testing** — snapshot the SVG string or PNG hash in CI:
  no headless browser, no font-installation drift, no flaky pixels.
- **Cache-safe generation** — content-addressed caching of rendered assets is
  sound because the mapping input → bytes is a pure function.
- **Cross-environment static preview** — a browser, Node.js batch job, and Worker
  produce the same sampled still at the same `timeMs`. Timeline animated SVG
  bytes also match across runtimes; live browser scheduling remains
  viewer-dependent as described above.
