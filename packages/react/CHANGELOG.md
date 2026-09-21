# @boundsvg/react

## 0.5.0

### Minor Changes

- [#26](https://github.com/zakideee/boundsvg/pull/26) [`836b0bd`](https://github.com/zakideee/boundsvg/commit/836b0bde282617138c09892c612f80ba7e710ff8) Thanks [@zakideee](https://github.com/zakideee)! - Replace the shared diagnostic shape with strict severity-specific fatal and
  recoverable contracts. Diagnostic constructors now take explicit options,
  recoverable warnings require `fallback` and `stage`, and malformed boundary
  values are rejected instead of being normalized through legacy adapters.

  Make operation envelopes the single warning authority across WASM, Core, and
  Worker routes. Structural IR no longer carries nested warnings, public IR
  retains detached `RecoverableError` values, Worker responses use one top-level
  warning list, and the WASM schema advances to version 29.

- [#28](https://github.com/zakideee/boundsvg/pull/28) [`0e86217`](https://github.com/zakideee/boundsvg/commit/0e86217d6785232554c2d60fe4da45d751ffac4a) Thanks [@zakideee](https://github.com/zakideee)! - Make shape failures stable structured diagnostics across native rendering,
  standalone WASM operations, Browser, Worker, React, CLI, and Video observers.
  The low-level `@boundsvg/core/wasm` entry now exports all nine shape operations,
  and Browser requires the same complete capability set. The bundled WASM schema
  advances to version 31.

  Change the public Rust `ShapeError` contract to a closed 15-variant enum and
  make `region_to_path`, `region_to_svg`, and `transform_to_svg` return
  `Result<String, ShapeError>`. Generated non-finite path, SVG, transform, JSON,
  or compiled-bound output now fails explicitly instead of emitting invalid
  numeric text or `null`.

  Validate all shape success payloads at the Core boundary. Malformed JSON,
  wrong field types, and explicit `null` values in optional compiled-path fields
  now fail with `SHAPE_OUTPUT_INVALID`; omitted optional fields stay omitted.
  Evaluated `GeometryPart` values now expose required `strokeRegion` geometry.

- [#25](https://github.com/zakideee/boundsvg/pull/25) [`a7a8815`](https://github.com/zakideee/boundsvg/commit/a7a8815e18484c99d2fa72f93c8f09480dc4a892) Thanks [@zakideee](https://github.com/zakideee)! - Make `CompiledScene` an opaque, immutable runtime artifact that can only be
  used with the exact `Engine` that created it. Remove the public `.ir` field and
  structural construction; use `snapshotCompiledIR` for a detached, editable
  inspection copy that is not renderable.

  Cloned or hand-built values now fail with `COMPILED_SCENE_INVALID`, while an
  authentic artifact passed to another Engine fails with
  `COMPILED_SCENE_WRONG_ENGINE`. React asset hooks retain their Provider Engine
  ownership, and `renderCompiledToMp4` requires the same supplied Engine.

- [#37](https://github.com/zakideee/boundsvg/pull/37) [`c33bc4d`](https://github.com/zakideee/boundsvg/commit/c33bc4dfafee20bc7d56218455f9a413dae13041) Thanks [@zakideee](https://github.com/zakideee)! - Unify React async rendering across main and Worker execution. Import the seven existing async hooks from `@boundsvg/react/async`; the former `/worker` entry and `UseWorkerRenderResult` type are removed. Results expose status, execution, and staleness, retain the same owner's previous success by default, and accept explicit revision, retention, and error-notification controls. `BoundSvg` and `AnimatedBoundSvg` now use this async path on main as well. Synchronous hooks keep their responsibilities and gain revision and Engine resource invalidation. PNG buffers are isolated per consumer.

  Add Core resource version observation and Provider resource revisions. Worker preference falls back only during initialization; runtime failures remain errors. Main and Worker execution admit one job plus 32 queued requests. Worker render and measurement calls accept an AbortSignal, and terminal drain waits for physical completion. Timeout values must be integers from 1 through 2,147,483,647ms, including queue wait. A raw Worker cannot be attached again after its first Engine lifetime. Pools retain default concurrency two and maximum eight, allow only one active operation, and wait for stream cleanup before reuse.

  Async inputs now follow immutable VNode identity, shallow non-callback option values and nested identities. Stabilize VNodes and nested options with state or `useMemo`; creating them inline on every hook render can repeatedly schedule work. Changes in place require a new `revision`. Callback-only changes do not schedule rendering. Synchronous render and derived hooks accept `RenderInputOptions` (`revision`) in their third argument; `usePngObjectUrl` accepts it in the second argument, and `useInteractiveSvg` includes it in its existing third options argument.

- [#27](https://github.com/zakideee/boundsvg/pull/27) [`0571ebb`](https://github.com/zakideee/boundsvg/commit/0571ebb906091bc4e95fde8893368f151e918107) Thanks [@zakideee](https://github.com/zakideee)! - Make text layout failures structured fatal diagnostics across render, Core,
  Browser, Worker, React, CLI, and Video routes. Font resolution now uses the
  actual registered fallback chain, so a missing primary or unused missing
  fallback is accepted when another requested alias resolves, while an entirely
  unresolved chain reports `TEXT_FONT_UNAVAILABLE`.

  Replace the ambiguous `TEXT_NO_LAYOUT` family and the six measurement
  `WASM_INVALID_*_OUTPUT` codes with operation-aware text layout diagnostics.
  Malformed output retains a bounded operation, protocol path, and received-type
  descriptor; true render intrinsic failures now abort instead of silently using
  a bounding-box fallback.

  Move the public Rust layout and flow APIs to `Result` and closed error/reason
  types, including fallible region providers, rich-depth validation, fit and
  ellipsis budgets, and checked invariants. The bundled WASM schema advances to
  version 30.

### Patch Changes

- Updated dependencies [[`836b0bd`](https://github.com/zakideee/boundsvg/commit/836b0bde282617138c09892c612f80ba7e710ff8), [`0e86217`](https://github.com/zakideee/boundsvg/commit/0e86217d6785232554c2d60fe4da45d751ffac4a), [`fee590a`](https://github.com/zakideee/boundsvg/commit/fee590ac43f2233e5732936d72982f21d7a45a81), [`671b9af`](https://github.com/zakideee/boundsvg/commit/671b9af0e53cdc7d210802b16607487f3334bbcd), [`75001ab`](https://github.com/zakideee/boundsvg/commit/75001ab74f4f0b383df4e2c1d9603636b0f4f297), [`a7a8815`](https://github.com/zakideee/boundsvg/commit/a7a8815e18484c99d2fa72f93c8f09480dc4a892), [`c33bc4d`](https://github.com/zakideee/boundsvg/commit/c33bc4dfafee20bc7d56218455f9a413dae13041), [`0571ebb`](https://github.com/zakideee/boundsvg/commit/0571ebb906091bc4e95fde8893368f151e918107), [`ba68136`](https://github.com/zakideee/boundsvg/commit/ba68136d824014abcf316dfedd8c44228a1d47ab)]:
  - @boundsvg/browser@0.5.0
  - @boundsvg/core@0.5.0
  - @boundsvg/worker@0.5.0

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
