# @boundsvg/browser

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

- [#36](https://github.com/zakideee/boundsvg/pull/36) [`75001ab`](https://github.com/zakideee/boundsvg/commit/75001ab74f4f0b383df4e2c1d9603636b0f4f297) Thanks [@zakideee](https://github.com/zakideee)! - Optional non-null WASM input fields now reject explicit `null`. Omit an optional
  property to request its existing default or absence behavior. Nullable array
  elements used for automatic insets and missing decoration owners remain supported.

  The Core WASM schema is now 32. Update Core, Browser, Worker, and their matching
  WASM artifacts together; schema-31 modules are rejected. The independent MP4
  schema remains 1. Numeric output must be finite; invalid derived output fails
  instead of emitting JSON `null`.

  Layered SVG and PNG rendering obtain source metadata directly from the input and
  no longer call a custom backend's `computeLayout` after compilation. If compilation
  succeeds and `computeLayout` would throw, layered rendering can now succeed.
  That extra call's side effects are also removed. Warning callbacks cannot change
  the current request's captured options, backend functions, or layer metadata.

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
  - @boundsvg/core@0.5.0

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
  - @boundsvg/core@0.4.0

## 0.3.0

### Minor Changes

- [#20](https://github.com/zakideee/boundsvg/pull/20) [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917) Thanks [@zakideee](https://github.com/zakideee)! - Split static SVG, animated SVG, and raster rendering into format-specific 0.3 APIs and option types. `RenderOptions` and `EmitOptions` are removed. Static SVG methods now reject animated scenes unless `timeMs` is explicit; use `renderToAnimatedSvg` / `renderCompiledToAnimatedSvg` and their SVG+IR or Worker equivalents with `playback: { mode: "independent" }` to preserve authored tracks. Caller-defined document timelines are not part of this release.

  SVG emission now supports `nodeIdMetadata: "include" | "omit"`. Keep the default `"include"` for inspection and hit testing, and pass `"omit"` for final output. `scale` continues to multiply SVG root dimensions and canvas-stroke restoration CSS without changing the `viewBox` or child geometry.

  React adds `AnimatedBoundSvg` and main-thread/Worker animated SVG hooks. Rename Provider `defaultRenderOptions` to `defaultCommonOptions`; it accepts compile and output-common fields only. Pass namespace, metadata, sampling, playback, reduced-motion, and raster options at each component or hook call. Legacy, unknown, or artifact-incompatible own keys now fail instead of being ignored.

  Layered SVG and PNG remain static-only. Remove the old `animation` option, supply `timeMs` for animated input, and do not pass SVG-only namespace or metadata options to layered PNG.

### Patch Changes

- Updated dependencies [[`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917)]:
  - @boundsvg/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b)]:
  - @boundsvg/core@0.2.0

## 0.1.0

Initial public release.
