# @boundsvg/cli

## 0.6.0

### Patch Changes

- Updated dependencies [[`8195190`](https://github.com/zakideee/boundsvg/commit/8195190ede076a641932a6d052b9f292413c56d7), [`9009113`](https://github.com/zakideee/boundsvg/commit/90091133e92c25f497878e07da7b68dd98e549d4)]:
  - @boundsvg/core@0.6.0

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`e04f34d`](https://github.com/zakideee/boundsvg/commit/e04f34d293d3653436589c651394ae8d79a5beef)]:
  - @boundsvg/core@0.4.0

## 0.3.0

### Minor Changes

- [#20](https://github.com/zakideee/boundsvg/pull/20) [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917) Thanks [@zakideee](https://github.com/zakideee)! - Replace animated-raster `loop` counts with a required `iterations` total-play count in the Core and Worker APIs. Animated WebP accepts 1–65535 or `"infinite"`; GIF accepts 1–65536 or `"infinite"`, omits its repeat extension for one play, and stores finite totals as one fewer repeat.

  The CLI now accepts `--iterations <positive-integer|infinite>` for animated WebP and GIF, defaulting an omitted flag to `infinite`. The removed `--loop` flag fails with format-specific migration guidance: WebP positive values stay unchanged, while GIF positive values increase by one.

### Patch Changes

- Updated dependencies [[`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917)]:
  - @boundsvg/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b)]:
  - @boundsvg/core@0.2.0

## 0.1.0

Initial public release.
