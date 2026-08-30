---
title: Known Limitations
---

# Known Limitations

Documented gaps and sharp edges, so you can evaluate boundsvg honestly.
Items here are known and triaged — please do not file bugs for them; see the
[feature matrix](/reference/feature-matrix) for the full support table.

## Text

- **Bidi / RTL is not supported.** Arabic, Hebrew, and other RTL scripts
  shape contextually in logical source order but are not visually reordered.
  This remains an explicit current non-goal.
- **Color emoji is not yet supported.** Emoji render as monochrome outlines
  or missing-glyph markers depending on the font. An asset-injection
  mechanism is planned.
- **Kinsoku (line-break prohibition) is Japanese-only** (`language: "ja"`).
  There are no Chinese/Korean line-break profiles yet.
- **Japanese typesetting is JLREQ-informed, not JLREQ-conformant.** The
  default `JaTypesettingV1` profile fixes a deterministic subset for release:
  greedy line breaking, Japanese kinsoku, vertical orientation, manual TCY, and
  ruby side/gap contracts with tunable gap/offset. It does not implement full line adjustment,
  full inter-character ruby layout, inter-character compression/expansion, warichu, complex jukugo ruby, or
  paragraph-level optimal breaking.
- `textOrientation: "sideways"` is not implemented; tate-chu-yoko
  (`textCombineUpright: "all"`) is experimental and manual-only.
- Line breaking is greedy (first-fit). There is no paragraph-level optimal
  breaking (Knuth–Plass).
- **Exact ellipsis and uncertified fit have deterministic work limits.** Once a
  complete document is known to overflow, ellipsis accepts at most 1,024
  possible exact candidate layouts. Fit with uncertified content or geometry
  defaults to 4,096 grid probes and is capped at 65,536; flow is also capped at
  65,536 distinct region queries and 262,144 returned intervals. Exceeding a
  limit is a typed fatal error with no approximate or partial output. A
  non-overflowing document bypasses the ellipsis candidate limit.

### Text on a path

- `TextOnPath` accepts one non-empty source made from strings and nested
  `Inline` nodes on exactly one drawable open or authored-closed subpath.
  Inline shaping, paint, and curved decoration are supported. `InlineBox`,
  `InlineRect`, `Ruby`/`Rt`, newlines/tabs, vertical writing, and bidi
  reordering are rejected.
- Path text has no wrapping, paragraph `textAlign`, indentation, or flow
  exclusions. Its `pathFit` is limited to inter-cluster spacing or glyph-local
  inline scale; it does not re-shape at a new font size or warp outlines along
  the curve normal. The explicit `width`/`height` frame does not scale path
  coordinates.
- Multiple drawable subpaths are rejected. Only an authored `Z` is closed;
  coincident open endpoints are not inferred as closed. Closed placement is a
  single lap with a half-open seam, not repeated text around the contour.
  Path measurement and fit/ellipsis work are deterministic and bounded;
  source, point, cluster, spacing, or scale limits fail instead of truncating
  silently.
- `pathOverflow="hidden"` omits glyphs with off-path midpoints while retaining
  logical/accessibility text. `pathOverflow="error"` fails the entire render;
  `"ellipsis"` uses a fixed U+2026 and preserves original source metadata.
- `d`, path placement, fit, overflow, content, and font/layout props are not
  native animation channels. Materialize a new scene per frame when any path
  layout or Inline style input changes. Post-layout opacity/transform tracks
  remain available, but `animateUnits` cannot be combined with any effective
  decorated text range. Node-level `animate` remains available for decorated
  path text.

See [Text on an SVG path](/guides/text-and-fonts#text-on-an-svg-path) for the
supported props and error codes.

## Fonts

- **Fonts with exactly 65,535 glyphs** (e.g. unsubsetted Noto Sans CJK) hit an
  offset-arithmetic limitation in released `ttf-parser`: the `loca`/`gvar`
  tables fail to parse and every glyph outline is lost. The published npm
  packages are unaffected — their WASM is built against the patched copy in
  `vendor/ttf-parser` (see `vendor/ttf-parser/README-PATCH.md`). A build of
  the Rust crates against released `ttf-parser` rejects such a font at
  registration with an explicit error instead of rendering nothing; the
  workarounds are subsetting the font below 65,535 glyphs or applying the
  vendored patch to your build.

## Layout & visuals

- **No CSS stacking contexts.** `zIndex` reorders siblings within the same parent only; a child can never paint outside its parent's position in the paint order.
- `position` supports `relative` and `absolute` only; `overflow` supports
  `visible` and `clip` only.
- `boxShadow` accepts a single shadow with unitless px numbers
  (`"0 4 8 rgba(0,0,0,0.3)"`) — no `inset`, no comma-separated multiple
  shadows, no `px` suffixes.
- Borders are uniform (single `borderWidth`/`borderColor`); no per-side
  borders.
- Canvas-stable stroke scaling is limited to solid `Flex`, `Grid`, and `Box`
  borders and solid `Path` strokes. It does not apply to `Shape`, `Symbol`, text
  outlines, `Inline`, `InlineBox`, embedded SVG, or arbitrary SVG attributes.
- A `strokeScaling: "canvas"` stroke supports ancestor translation, rotation,
  and uniform scale only. A non-uniform scale or axis reflection fails with
  `CANVAS_STROKE_UNSUPPORTED_TRANSFORM`; combining it with
  `strokeDasharray` fails with `CANVAS_STROKE_DASH_UNSUPPORTED`. The renderer
  does not silently approximate either case.
- The transform restriction applies to every static ancestor transform and
  every keyframe in an ancestor `animate` track, even when the sampled
  `timeMs` pose is uniform. Non-uniform scales that cancel only after ancestor
  composition are still rejected.
- In a browser, the non-scaling width is pinned to the authored `borderWidth`
  or `strokeWidth` multiplied by the format-specific render option `scale` in CSS pixels. SVG and raster widths agree
  at the emitted SVG's intrinsic `width` and `height`; resizing that SVG with
  CSS does not scale its canvas-stable strokes.
- Canvas-stable width reduces scale-driven stroke pulsing, but a translated
  subpixel edge can still redistribute antialiasing coverage between adjacent
  pixels.
- Gradients: `linear` and `radial` only, and only on `background` — no
  `conic`.
- Layout is flexbox + CSS Grid via Taffy. There is no block/inline flow
  layout; `Box` is a flex column internally.

## Shape geometry

- Authored `GeometryNode` trees accept nodes through depth 48 (root depth 0).
  Deeper inline, registered, symbol, hit-test, compile, or flow-exclusion
  inputs fail with `SHAPE_GEOMETRY_MAX_DEPTH` before bridge serialization.
  This is a process-safety boundary, not a rendering approximation.
- Elastic symbol resolution applies the same limit to the resolved tree.
  Matching `fixed-end` segments and positive-frame `stretch` segments can add
  a transform wrapper when the target size changes, so authored elastic
  symbols must leave one depth level of headroom for each such wrapper.

## Embedded content

- **`<text>` inside `<Svg>`-embedded markup is re-shaped by the viewer /
  rasterizer**, outside the [determinism contract](/reference/determinism).
- Embedded raster images: PNG, JPEG, WebP, and GIF decode for PNG export;
  **AVIF is not supported**.
- The SVG import analyzer (CLI `convert`) is pattern-based, not a full XML
  parser: `<style>` blocks and class-based styling are ignored, per-`tspan`
  styles collapse into the parent text style, and text position within the
  inferred rect (`<text x=… y=…>`) is not reconstructed — text lands at the box
  top-left, though `text-anchor` still maps to `textAlign`.

## Animation

- Core has no IME event, selection, candidate, or composition-state API.
  Applications own those states and materialize `Text`, decorated `Inline`,
  `InlineRect`, and candidate UI for each frame.
- Animation targets only `opacity` and center-pivot translate, rotate, and
  scale. `Text.animateUnits` and `TextOnPath.animateUnits` can apply those
  channels per shaping cluster or resolved line, but do not provide arbitrary
  grapheme, word, fragment, reveal, stroke-dash, rich-text span, or shape-part
  tracks.
- Core has no declarative layout-property tracks. Layout-reactive output uses
  complete static scenes materialized by the application at each `timeMs`;
  each scene receives a normal full-scene layout.
- Custom animation `originX`/`originY` values and full Unicode bidi reordering
  for `animateUnits.order: "visual"` are not supported.
- CSS playback scheduling depends on the SVG viewer. Document timeline mode
  contracts computed values outside/around bounded discontinuity windows, but
  does not control the wall-clock instant at which a viewer paints a frame. A
  viewer without CSS animation support shows the deterministic `timeMs`
  base-pose still image.
- Document timeline mode does not emit synthetic opacity clamp plateaus. A
  cubic whose raw opacity leaves `[0, 1]` fails with
  `clamped-overshoot-cubic`; independent animated SVG and static sampling keep
  the authored clamping behavior.
- The `prefers-reduced-motion` opt-out is opt-in and coarse. Passing
  `reducedMotion: "pause"` appends one media block that stops every animation the render
  started; the default `"keep"` emits nothing, so output stays byte identical to
  a render that never passed the option. There is no per-node or per-channel
  reduced-motion control, and PNG/raster output is unaffected because it is
  already static.
- Sampled frames can be packaged as animated WebP or GIF, or encoded as MP4 by
  an encoder boundsvg does not ship; there is no APNG output. See the
  [Animation guide](/guides/animation) and [Video Export](/guides/video-export).

## Video

- No codec ships with boundsvg. MP4 export uses the browser's WebCodecs encoder
  or an ffmpeg you installed; neither is bundled or downloaded. Cloudflare
  Workers has no WebCodecs, so browser MP4 export does not run there.
- H.264 only — no VP9, AV1, or WebM — and video only: there is no audio track.
- H.264 in yuv420 needs even dimensions and carries no alpha, so frames are
  padded on the right and bottom and composited over an opaque background. The
  browser exporter takes a `background` option and rejects a translucent one
  rather than compositing it against black; the CLI always pads with white.
- 3600 frames per export. No variable frame rate and no fragmented MP4.
- Encoded bytes are outside the determinism contract; the sampled PNG frames
  that feed the encoder are not. See [Video Export](/guides/video-export).

## Platform

- The WASM binary is ~5.6 MB uncompressed (~2.1 MB gzipped) including the
  rasterizer and the PNG, WebP, and GIF encoders. Size-wise that makes edge runtimes (e.g. Cloudflare
  Workers) a candidate. The engine has been exercised under local
  workerd — WASM import, font registration, and SVG/PNG responses all work,
  with the SVG hashing identically to Node — so this is not unknown territory.
  What is missing is anything continuous: **boundsvg ships no workerd entry
  point and no integration test**, nothing in this repository exercises that
  runtime, and PNG rasterization is CPU-intensive relative to free-tier CPU
  budgets. Treat edge deployment as demonstrated once by hand, not as a
  supported and maintained target.
- Raster output (PNG, WebP, animated WebP, animated GIF, and the frames MP4
  export samples) is capped at
  3840×2160 px (long edge 3840); oversized renders auto-adjust or error
  depending on `rasterOversizeBehavior`.
- WebP encoding is lossless (VP8L) only. There is no lossy VP8 encoder in the
  pipeline, so WebP has no quality knob — which is also why its bytes are
  deterministic. Lossless WebP is usually smaller than the equivalent PNG.
- Animated WebP stores every frame as a full-canvas lossless replacement. There
  is no inter-frame delta or sub-rectangle optimization, so a long animation of
  a mostly-static scene is larger than a tuned encoder would produce.
- Animated GIF is lossy: each frame is quantized to its own 256-color palette
  and alpha collapses to 1 bit. The output is still byte-deterministic. Prefer
  animated WebP when the frames must survive intact.
- GIF frame timing is quantized to 10 ms, and each delay is clamped to at least
  20 ms because browsers substitute their own default below that. A schedule
  with shorter frames — typically above 50 fps, or a very short `durationMs` —
  therefore plays back longer than requested. boundsvg reports it as an
  `ANIMATED_GIF_TIMING_ADJUSTED` warning once the animation runs more than 5%
  long; a smaller overshoot is unavoidable for most durations and is not
  reported, so one short frame inside a long animation can be stretched
  quietly.
- Animated output is capped at 300 frames and per-frame durations at 1–60000
  ms. Total plays are explicit: animated WebP accepts 1–65535, GIF accepts
  1–65536, and both accept `"infinite"`. GIF stores finite total plays as one
  fewer repeat and omits the repeat extension when the total is one.
- Animated output is additionally capped at 256 MiB for the assembled file and
  64 MiB of characters for the sampled SVG frames.
- Reading animated WebP or GIF is not supported. `<Image>` decodes still WebP
  and GIF, but only the first frame of an animated file. The typed `mediaType`
  prop covers PNG, JPEG, and SVG; WebP and GIF arrive through the `src` itself.
