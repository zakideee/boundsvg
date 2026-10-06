# @boundsvg/worker

## 0.7.0

### Minor Changes

- [#44](https://github.com/zakideee/boundsvg/pull/44) [`d00b967`](https://github.com/zakideee/boundsvg/commit/d00b967ae19f3017f8be057db9033fcdff8a17f1) Thanks [@zakideee](https://github.com/zakideee)! - Replace animated WebP/GIF byte-returning APIs with required sink writes returning `Promise<AnimatedRasterWriteResult>`. The existing Core normal/compiled and Worker normal/layout-transition method names now require a destination; old two-argument calls, overloads, bulk animation transport, and `ToSink` aliases are removed. WASM bridge schema advances from 32 to 33.

  Sample and encode each frame inside WASM without transporting frame SVGs through JS. Encode sequentially with lazy sampled schedules, bounded chunks, WebP length patching, and file or external spool destinations. Remove the fixed total-frame and aggregate-SVG limits. Existing raster, per-frame timing, iterations, and container representation limits remain. `createAnimatedRasterCollector()` explicitly retains O(output) memory and a 256 MiB limit.

  Authenticate optional inputs: only missing/undefined means absence. Null, wrong types, typed arrays, and custom iterables now reject with structured diagnostics rather than old runtime falsy acceptance or raw TypeErrors. Fractional FPS, positive subnormal sampled durations, and duplicate/non-monotonic explicit times remain accepted within the documented domains.

  Add browser file-handle/OPFS-compatible storage and a Node `@boundsvg/cli/animation` adapter. Animated CLI files use temp plus atomic pathname replacement, preserve captured regular-file permission bits, replace a final symlink itself, and leave other hardlinks on the old inode. Parent directory rename permissions are required; inode/owner/ACL/xattr and competing update exclusion are not guaranteed. Static output IO is unchanged.

  Keep Core cancellation cooperative through pending callbacks. Worker absolute deadlines include pending finish; an early rejection can leave commitment uncertain and retains ownership until cleanup. Successful output is preserved after late finish or close acknowledgement failure. Watch exports serialize per Engine and coalesce changes per path.

  Animation backend hooks receive required fixed `renderOptions` at session open. Managed pushes take `push(scene, timeMs, durationMs)` with primitive finite nonnegative times and integer durations; the generated native method takes scene/session capabilities plus these separate numbers. Fixed-setting errors are reported at open, and duplicate native open keys reject. Regenerate node and web WASM artifacts together with bridge types.

  Expose `decodeAnimatedRasterFatal(value: unknown): FatalError | undefined` from `@boundsvg/core/wasm` for transport adapters. Animated raster options reject `timeMs`, which is outside their public option types. Invalid WebP sequential spool destinations now retain the WebP diagnostic format without requiring patch support.

### Patch Changes

- Updated dependencies [[`d00b967`](https://github.com/zakideee/boundsvg/commit/d00b967ae19f3017f8be057db9033fcdff8a17f1)]:
  - @boundsvg/core@0.7.0
  - @boundsvg/browser@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`8195190`](https://github.com/zakideee/boundsvg/commit/8195190ede076a641932a6d052b9f292413c56d7), [`9009113`](https://github.com/zakideee/boundsvg/commit/90091133e92c25f497878e07da7b68dd98e549d4)]:
  - @boundsvg/core@0.6.0
  - @boundsvg/browser@0.6.0

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

- [#29](https://github.com/zakideee/boundsvg/pull/29) [`fee590a`](https://github.com/zakideee/boundsvg/commit/fee590ac43f2233e5732936d72982f21d7a45a81) Thanks [@zakideee](https://github.com/zakideee)! - Add a recursive `decodeSceneDocument` boundary that returns a detached Scene
  tree, make `fromSceneDocument` validate unknown input through that boundary,
  and expose the five Scene decode resource limits. Invalid structure now uses
  stable `SCENE_DECODE_*` fatal diagnostics.

  Worker Scene requests now preserve those diagnostics across main-thread,
  receive, pool, materialized-frame, and layout-transition paths while detaching
  queued input and avoiding duplicate decodes within each trust boundary.

  CLI Scene files now distinguish JSON syntax failures from structural Scene
  failures and reuse the single decoded VNode for conversion and export.

  The former Core root exports `isSceneNode` and
  `assertSerializableSceneTransport` are removed. Replace them with
  `decodeSceneDocument`, handle its `SCENE_DECODE_*` `FatalError` on failure, and
  use the returned detached snapshot after success. Rejecting malformed Scene
  structure that a shallow check previously admitted is an intentional clean
  break; valid Scene rendering semantics are unchanged.

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

## 0.3.0

### Minor Changes

- [#20](https://github.com/zakideee/boundsvg/pull/20) [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917) Thanks [@zakideee](https://github.com/zakideee)! - Split static SVG, animated SVG, and raster rendering into format-specific 0.3 APIs and option types. `RenderOptions` and `EmitOptions` are removed. Static SVG methods now reject animated scenes unless `timeMs` is explicit; use `renderToAnimatedSvg` / `renderCompiledToAnimatedSvg` and their SVG+IR or Worker equivalents with `playback: { mode: "independent" }` to preserve authored tracks. Caller-defined document timelines are not part of this release.

  SVG emission now supports `nodeIdMetadata: "include" | "omit"`. Keep the default `"include"` for inspection and hit testing, and pass `"omit"` for final output. `scale` continues to multiply SVG root dimensions and canvas-stroke restoration CSS without changing the `viewBox` or child geometry.

  React adds `AnimatedBoundSvg` and main-thread/Worker animated SVG hooks. Rename Provider `defaultRenderOptions` to `defaultCommonOptions`; it accepts compile and output-common fields only. Pass namespace, metadata, sampling, playback, reduced-motion, and raster options at each component or hook call. Legacy, unknown, or artifact-incompatible own keys now fail instead of being ignored.

  Layered SVG and PNG remain static-only. Remove the old `animation` option, supply `timeMs` for animated input, and do not pass SVG-only namespace or metadata options to layered PNG.

- [#20](https://github.com/zakideee/boundsvg/pull/20) [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917) Thanks [@zakideee](https://github.com/zakideee)! - Replace animated-raster `loop` counts with a required `iterations` total-play count in the Core and Worker APIs. Animated WebP accepts 1–65535 or `"infinite"`; GIF accepts 1–65536 or `"infinite"`, omits its repeat extension for one play, and stores finite totals as one fewer repeat.

  The CLI now accepts `--iterations <positive-integer|infinite>` for animated WebP and GIF, defaulting an omitted flag to `infinite`. The removed `--loop` flag fails with format-specific migration guidance: WebP positive values stay unchanged, while GIF positive values increase by one.

### Patch Changes

- Updated dependencies [[`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917)]:
  - @boundsvg/core@0.3.0
  - @boundsvg/browser@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b)]:
  - @boundsvg/core@0.2.0
  - @boundsvg/browser@0.2.0

## 0.1.0

Initial public release.
