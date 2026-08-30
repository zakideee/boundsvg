---
title: Determinism Contract
---

# Determinism Contract

boundsvg's version-scoped promise: **for accepted inputs on the declared
surfaces below, identical contract inputs produce byte-identical covered
artifacts across supported runtimes.** Byte identity describes the artifact;
it does not mean that every number is accepted or preserved unchanged.

## The contract

Given the same

- boundsvg version (TS packages + bundled WASM, always shipped together),
- VNode tree (JSX input),
- font bytes (fonts are injected as data, never discovered from the OS),
- render options,

`renderToSvg` and `renderToAnimatedSvg` return the same SVG string, and
`renderToPng`, `renderToWebp`, `renderToAnimatedWebp`, and
`renderToAnimatedGif` return the same bytes on Node.js, in the browser, and in
a Web Worker, subject to the mode boundaries and exceptions on this page.
Structured fatal failures and ordered recoverable warnings are deterministic
contract artifacts too.

This holds because the entire text pipeline — shaping (rustybuzz), line
breaking, kinsoku, vertical layout, font metrics — and the rasterizer (resvg)
and every bundled image encoder run in version-pinned WASM built from the same
release source. There is no browser text engine, no `canvas.measureText`, and
no OS font lookup in owned text measurement.

## Numeric surface modes

Numeric guarantees are declared per surface. The four modes describe where
the oracle lives and what happens at its boundary; they are not quality tiers.

| Mode                   | Contract boundary                                                                                                                        | Major surfaces                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Strict-owned**       | The accepted domain is documented and validated. Out-of-domain input fails with a deterministic structured fatal error before output.    | Document-timeline playback, duration, iteration, keyframe, and sampling fields; layout fields with published ranges  |
| **Normalized-owned**   | A documented canonical transform, default, clamp, quantization, or fallback defines the accepted result and any recoverable warning.     | Font/default resolution, raster oversize adjustment, and GIF schedule quantization                                   |
| **Delegated / opaque** | boundsvg owns the container and security boundary, while numeric or rendering semantics are explicitly delegated to another interpreter. | Raw `<Svg content>` markup                                                                                           |
| **Derived / internal** | Values arise only after accepted input and are checked by the owning algorithm; they are not a separate public numeric-input promise.    | Shaping, layout, geometry, bounding-box, rasterization, and encoder intermediates used to build the covered artifact |

The byte contract covers accepted strict-owned inputs and the documented
result of normalized-owned surfaces. A normalized result can intentionally
differ from the authored number: for example, raster oversize adjustment and
GIF delay quantization report a recoverable warning and produce the declared
fallback. Delegated semantics stop at their stated boundary. Derived values
are covered only through the final artifact they help produce, not as a claim
that every internal floating-point intermediate is mathematically exact.

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
outline paths**, never as SVG `<text>` elements. Its SVG geometry therefore
does not depend on viewer-side font resolution or re-shaping. The same glyph
paths feed the bundled rasterizer, so covered SVG and raster outputs use the
same resolved glyph geometry. Pixel rendering performed later by an arbitrary
SVG viewer is not itself a boundsvg byte artifact.

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
- **Cache-safe generation** — content-addressed caching is sound when the cache
  key includes the boundsvg version and every contract input listed above.
- **Cross-environment static preview** — a browser, Node.js batch job, and Worker
  produce the same sampled still at the same `timeMs`. Timeline animated SVG
  bytes also match across runtimes; live browser scheduling remains
  viewer-dependent as described above.
