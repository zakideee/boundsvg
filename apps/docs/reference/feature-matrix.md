---
title: Feature Matrix
---

# Feature Matrix

Support tiers are defined in [Versioning & Stability](/getting-started/versioning):
**Supported** (tested, determinism contract applies), **Experimental** (works,
may change in any minor release), **Not supported** (documented gap).

## Text & typography

| Capability                                              | Status        | Notes                                                                                                                                |
| ------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Shaping (kerning, ligatures, OpenType features)         | Supported     | rustybuzz (HarfBuzz-compatible), `fontFeatureSettings`                                                                               |
| Line breaking (UAX #14)                                 | Supported     | Greedy first-fit; no Knuth–Plass                                                                                                     |
| Japanese kinsoku (JLREQ-informed) + hanging punctuation | Supported     | `language: "ja"` only; fixed `JaTypesettingV1` profile; no zh/ko profiles                                                            |
| Vertical writing (`vertical-rl`, UTR #50, vert/vkna)    | Supported     | `textOrientation: "sideways"` not implemented                                                                                        |
| Ruby annotations (`Ruby`/`Rt`)                          | Supported     | Multiple `Rt` levels, tunable `rubyGapPx`/`rubyOffsetPx`; `inter-character` falls back with warning; long-ruby overhang is warned    |
| Tate-chu-yoko (`textCombineUpright: "all"`)             | Experimental  | Manual only; no automatic TCY grouping                                                                                               |
| Auto-fit (`fit: shrink/grow`), ellipsis, max lines      | Supported     | Shared horizontal/vertical and normal/flow contract; exact rich-prefix projection; deterministic work limits                         |
| Variable fonts (`fontVariationSettings`)                | Supported     |                                                                                                                                      |
| Font fallback chains                                    | Supported     | Alias-driven, per-character glyph availability                                                                                       |
| WOFF2 / TTF / OTF input                                 | Supported     | WOFF2 decoded at registration                                                                                                        |
| Rich inline (`Inline` styling + decoration)             | Supported     | Fragmentable background/border/padding across line breaks                                                                            |
| Inline boxes (`InlineBox`)                              | Supported     | Atomic (non-fragmenting)                                                                                                             |
| Text decoration                                         | Supported     | Solid/double/dotted/dashed/wavy filled geometry on `Text`/rich ranges; horizontal/vertical and outline-aware `skipInk`               |
| Inline rectangles (`InlineRect`)                        | Supported     | Atomic caret/paint primitive with zero or non-zero advance and optional opacity/transform animation                                  |
| Text on a path (`TextOnPath`)                           | Supported     | Strings/nested `Inline`; mixed paint, curved decoration/skipInk, open/closed path, fit/ellipsis, decoration-free unit animation      |
| Text flow around exclusions                             | Experimental  | Logical-axis region provider; content/geometry-aware exact-grid fit; deterministic query/interval budgets                            |
| Letter spacing                                          | Supported     |                                                                                                                                      |
| Color emoji (COLR/CBDT/sbix)                            | Not supported | Font-level color emoji not rendered                                                                                                  |
| Emoji cluster detection                                 | Experimental  | `splitEmojiClusters`/`isEmojiCluster` — foundation for opt-in asset packs; no bundled artwork, render-time compositing not yet wired |
| Bidi / RTL                                              | Not supported | Explicit current non-goal                                                                                                            |

## Layout

| Capability                              | Status        | Notes                                        |
| --------------------------------------- | ------------- | -------------------------------------------- |
| Flexbox (Taffy)                         | Supported     | Full flex model                              |
| CSS Grid (Taffy)                        | Supported     | `templateColumns/Rows`, placement, span, gap |
| `position: relative / absolute` + inset | Supported     | No `fixed`/`sticky`                          |
| `aspectRatio`, min/max sizing           | Supported     |                                              |
| `overflow: visible / clip`              | Supported     | No `scroll`/`auto`                           |
| Block / inline flow layout              | Not supported | `Box` is a flex column internally            |
| `zIndex` (sibling-local paint order)    | Supported     | Integers; no CSS stacking contexts           |
| Multi-layer text stroke / text shadow   | Supported     | `textStrokes` / `textShadows` (max 8 layers) |
| Node metadata (`meta`)                  | Supported     | `data-boundsvg-meta-*` + layered manifest    |

## Visuals

| Capability                                | Status        | Notes                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Solid fills, opacity, stroke styles       | Supported     |                                                                                                                                                                                                                                                        |
| Linear / radial gradients (`background`)  | Supported     | No `conic`; background only                                                                                                                                                                                                                            |
| `borderRadius` (uniform + per-corner)     | Supported     |                                                                                                                                                                                                                                                        |
| Uniform borders                           | Supported     | No per-side borders                                                                                                                                                                                                                                    |
| Canvas-stable strokes                     | Supported     | Opt-in `strokeScaling: "canvas"` on solid `Flex` / `Grid` / `Box` borders and `Path` strokes under similarity transforms                                                                                                                               |
| `boxShadow` (single, unitless)            | Supported     | No `inset`, no multiple shadows, no `px` units                                                                                                                                                                                                         |
| Static transform (translate/rotate/scale) | Experimental  | Post-layout paint transform; not a layout input                                                                                                                                                                                                        |
| Declarative animation (`animate`)         | Supported     | Opacity and center-pivot transform with cubic, step, and spring easing. Independent animated SVG preserves authored clocks; static APIs sample `timeMs`.                                                                                               |
| Document-synchronized SVG timeline        | Supported     | `playback: { mode: "timeline", durationMs, iterations }` compiles representable tracks onto one document clock. Spring and clamped opacity overshoot cubics fail rather than approximate; live discontinuities use the documented two-sided carve-out. |
| Text unit animation (`animateUnits`)      | Experimental  | Shaping-cluster or resolved-line opacity/transform with deterministic linear staggering and ruby association.                                                                                                                                          |
| Prepared batch frames (`renderFrames`)    | Experimental  | One fixed layout sampled to ordered static SVG/PNG frames; duplicate and non-monotonic times are preserved.                                                                                                                                            |
| Layout-reactive materialization           | Experimental  | Application-generated static scenes receive full-scene layout per time; no declarative layout tracks are added to core.                                                                                                                                |
| Images (`objectFit: fill/contain/cover`)  | Supported     | PNG/JPEG/WebP/GIF raster decode; no AVIF                                                                                                                                                                                                               |
| Embedded SVG (`<Svg>`)                    | Experimental  | Sanitized; inner `<text>` outside determinism contract                                                                                                                                                                                                 |
| Shape / Symbol geometry (boolean ops)     | Experimental  | via `@boundsvg/shape` registry                                                                                                                                                                                                                         |
| CSS filters (blur, etc.)                  | Not supported | Only box-shadow                                                                                                                                                                                                                                        |

## Output & integration

| Capability                                        | Status       | Notes                                                                                                                 |
| ------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Static SVG output (text as glyph paths)           | Supported    | Animated input requires explicit `timeMs`; `nodeIdMetadata` can include preview identity or omit it for final export. |
| Independent animated SVG output                   | Supported    | Explicit `renderToAnimatedSvg(..., { playback: { mode: "independent" } })` preserves authored clocks.                 |
| Document-timeline animated SVG output             | Supported    | Explicit duration and finite/fractional or infinite document iterations; deterministic base pose and budgeted CSS.    |
| PNG output (scale, background, caps)              | Supported    | Max 3840×2160                                                                                                         |
| WebP output (`renderToWebp`)                      | Supported    | Lossless (VP8L) only; byte-deterministic; often smaller than PNG                                                      |
| Animated WebP (`renderToAnimatedWebp`)            | Experimental | Sampled from declarative animations; full-frame lossless; max 300 frames                                              |
| Animated GIF (`renderToAnimatedGif`)              | Experimental | 256-color quantized; 10 ms timing quantum; byte-deterministic                                                         |
| MP4 export, browser (`@boundsvg/video`)           | Experimental | H.264 via the browser's WebCodecs encoder; outside the determinism contract; no Cloudflare Workers                    |
| MP4 export, CLI (`--format mp4`)                  | Experimental | H.264 via an external ffmpeg you install; outside the determinism contract                                            |
| Layered SVG/PNG export                            | Experimental | For motion-tool handoff                                                                                               |
| Scene Document round-trip (`.scene.json`)         | Experimental |                                                                                                                       |
| React bindings (`@boundsvg/react`)                | Supported    | Provider, hooks, worker offload                                                                                       |
| Web Worker rendering (`@boundsvg/worker`)         | Supported    | ESM-only worker entry                                                                                                 |
| Worker frame pool                                 | Experimental | Ordered, bounded prepared sampling and full-scene materialized streams                                                |
| Interactive events / hit-testing                  | Experimental |                                                                                                                       |
| CLI (`convert` / `export` / `inspect` / `doctor`) | Experimental | SVG import analyzer has documented limits                                                                             |
| Node.js / browser / worker runtimes               | Supported    | Same output everywhere (see contract)                                                                                 |
