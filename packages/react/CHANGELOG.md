# @boundsvg/react

## 0.4.0

### Minor Changes

- [#22](https://github.com/zakideee/boundsvg/pull/22) [`e04f34d`](https://github.com/zakideee/boundsvg/commit/e04f34d293d3653436589c651394ae8d79a5beef) Thanks [@zakideee](https://github.com/zakideee)! - Add document-synchronized animated SVG playback with
  `playback: { mode: "timeline", durationMs, iterations }`. Timeline mode compiles every authored
  track onto one deterministic document clock; existing static rendering and
  `playback: { mode: "independent" }` behavior are unchanged.

  This widens the `AnimatedSvgPlayback` union and therefore has source impact for exhaustive switches.
  Add a `"timeline"` case, or continue passing `{ mode: "independent" }` to preserve authored clocks.

  Timeline playback accepts a finite document `durationMs` in `[1, 2^32]` and document `iterations`
  as `"infinite"` or a positive finite value at most `2^20`. In timeline mode, authored track
  `durationMs` must be in `[1, 2^32]`, authored and effective-unit `delayMs` in
  `[-2^32, 2^32]`, and finite authored track `iterations` in `[2^-32, 2^20]` (or
  `"infinite"`). Values outside that authored domain fail with
  `ANIMATED_SVG_TIMELINE_UNREPRESENTABLE` and reason `authored-value-out-of-domain`.

  When adopting timeline mode, bring the reported authored field into the supported range. If the
  authored clock or a wider numeric range must be retained, use independent playback instead.

### Patch Changes

- Updated dependencies [[`e04f34d`](https://github.com/zakideee/boundsvg/commit/e04f34d293d3653436589c651394ae8d79a5beef)]:
  - @boundsvg/browser@0.4.0
  - @boundsvg/core@0.4.0
  - @boundsvg/worker@0.4.0

## 0.3.0

### Minor Changes

- [#20](https://github.com/zakideee/boundsvg/pull/20) [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917) Thanks [@zakideee](https://github.com/zakideee)! - Split static SVG, animated SVG, and raster rendering into format-specific 0.3 APIs and option types. `RenderOptions` and `EmitOptions` are removed. Static SVG methods now reject animated scenes unless `timeMs` is explicit; use `renderToAnimatedSvg` / `renderCompiledToAnimatedSvg` and their SVG+IR or Worker equivalents with `playback: { mode: "independent" }` to preserve authored tracks. Caller-defined document timelines are not part of this release.

  SVG emission now supports `nodeIdMetadata: "include" | "omit"`. Keep the default `"include"` for inspection and hit testing, and pass `"omit"` for final output. `scale` continues to multiply SVG root dimensions and canvas-stroke restoration CSS without changing the `viewBox` or child geometry.

  React adds `AnimatedBoundSvg` and main-thread/Worker animated SVG hooks. Rename Provider `defaultRenderOptions` to `defaultCommonOptions`; it accepts compile and output-common fields only. Pass namespace, metadata, sampling, playback, reduced-motion, and raster options at each component or hook call. Legacy, unknown, or artifact-incompatible own keys now fail instead of being ignored.

  Layered SVG and PNG remain static-only. Remove the old `animation` option, supply `timeMs` for animated input, and do not pass SVG-only namespace or metadata options to layered PNG.

### Patch Changes

- Updated dependencies [[`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917)]:
  - @boundsvg/core@0.3.0
  - @boundsvg/browser@0.3.0
  - @boundsvg/worker@0.3.0

## 0.2.0

### Minor Changes

- [#18](https://github.com/zakideee/boundsvg/pull/18) [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b) Thanks [@zakideee](https://github.com/zakideee)! - **Output-affecting:** Use one authoritative text-layout contract for horizontal and vertical
  plain/rich text, exclusion flow, shrink/grow fit, and `maxLines` ellipsis. Ellipsis now selects the
  longest exact legal prefix without splitting grapheme clusters or atomic rich items, re-shapes
  contextual text at the retained end, preserves source/style/decoration identity, and excludes output
  and warnings owned only by the omitted suffix.

  `kinsoku_unresolved` now remains a diagnostic for a forced but physically
  contained break and does not by itself trigger ellipsis. When the same plan
  also violates width, height, or `maxLines`, the physical `overflow` or
  `cannot_fit` status takes precedence.

  Ordinary spans now use the canonical rich planner. Paint-only boundaries keep
  one shaping run (an indivisible cross-boundary cluster uses its source-start
  paint), and nested decorated spans remain fragmentable with all owner keys in
  normal and exclusion-flow output. Fit scales font size and letter spacing
  together; explicit pixel line height remains absolute. Positioned glyph
  `clusterStart` / `clusterEnd` values for ordinary spans are now document-global
  UTF-8 byte offsets instead of run-local offsets. Ruby annotations continue to
  use annotation-level local offsets because they are shaped from a separate
  source string; use `sourceRole` or UnitMap identity across source namespaces.
  Nested atomic children and multiple styled ruby segments now keep continuous
  source/cluster coordinates, while equal annotation text on different ruby
  levels remains distinct UnitMap identity.
  Unregistered aliases are now rejected before authoritative WASM text layout
  on every render and layout-transition route, preserving
  `FONT_ALIAS_NOT_REGISTERED`; when an input has multiple fatal defects, this
  structured font diagnosis may now precede a shaping failure.

  Add the positive-integer `fitMaxProbes` Text prop for deterministic exact-grid
  fit when content (including negative tracking) or flow geometry is not
  monotone-certified. Exact ellipsis, fit, and geometry work now fail with
  structured resource-limit errors instead of returning approximate or partial
  output. The bundled WASM DTO schema advances to 26 and must be rebuilt with the
  matching `@boundsvg/core` package.

  **Breaking (Rust):** `boundtext::layout_text` and `layout_text_with_unit_metadata` now return
  `Result<_, TextLayoutError>`, and the physical `FlowRegionSource` trait is replaced by the fallible
  logical-axis `RegionProvider` contract. Rust callers must migrate `Option` handling and provider
  implementations as documented in `crates/boundtext/README.md`.
  `FlowLayoutResult` also adds `inline_box_decorations`; direct struct constructors must initialize
  or forward that field. Flow shrinkwrap geometry/resource failures now keep their structured text
  error codes through the WASM bridge; the older direct Rust preformatted-text shrinkwrap helpers
  continue to return `Option` pending a separate SemVer decision.
  The `boundtext` default feature set now includes `unicode-full`, changing direct
  default-feature Rust builds from per-code-point fallback boundaries to UAX #29
  extended grapheme clusters. Custom no-default builds must enable
  `unicode-full` explicitly to receive the same boundary guarantee.

### Patch Changes

- Updated dependencies [[`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b)]:
  - @boundsvg/core@0.2.0
  - @boundsvg/browser@0.2.0
  - @boundsvg/worker@0.2.0

## 0.1.0

Initial public release.
