# @boundsvg/video

## 0.6.0

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

- [#34](https://github.com/zakideee/boundsvg/pull/34) [`06add68`](https://github.com/zakideee/boundsvg/commit/06add680f43d1043fbf27c0e6365bf62f151dc42) Thanks [@zakideee](https://github.com/zakideee)! - Report encoder, frame preparation, MP4 initialization, input, state, resource, container and sample-order failures through stable FatalError codes and bounded Video context. VIDEO_ENCODER_UNSUPPORTED now describes missing capabilities or rejected configurations; execution and muxing failures have separate codes.

  Direct initVideoWasm failures now use VIDEO_MUXER_LOAD_FAILED or VIDEO_MUXER_ABI_MISMATCH. Match codes instead of raw messages. Failed initialization can be retried, but an incompatible instance retained by generated glue requires a fresh module realm with matching MP4 glue and binary. Successful output for identical encoded samples is unchanged.

## 0.4.0

## 0.3.0

## 0.2.0

### Patch Changes

- [#18](https://github.com/zakideee/boundsvg/pull/18) [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b) Thanks [@zakideee](https://github.com/zakideee)! - **Breaking (Rust):** Prevent unbounded recursive Shape processing by rejecting authored and resolved geometry trees deeper than 48 levels with a stable validation error before recursion or WASM serialization. `boundshape::resolve_symbol_geometry` now returns `Result<GeometryDoc, ShapeError>`, and `ShapeError` is non-exhaustive. Rust callers must handle the resolution result and include a wildcard arm when matching shape errors. Programmatically generated trees at depth 49 or greater must be flattened; associative boolean chains can use one n-ary boolean node instead. The synchronized 0.2 video package requires the 0.2 core line.

## 0.1.0

Initial public release.
