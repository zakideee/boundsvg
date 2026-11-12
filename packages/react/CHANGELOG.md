# @boundsvg/react

## 0.11.0

### Minor Changes

- [#62](https://github.com/zakideee/boundsvg/pull/62) [`e815fe6`](https://github.com/zakideee/boundsvg/commit/e815fe640e19746184cd073f0c3500216a6b924c) Thanks [@zakideee](https://github.com/zakideee)! - Native paint retains browser hit behavior: WebKit can report zero-scale ink,
  which can dispatch to an ancestor handler even when its semantic Frame is empty.

  Use current native SVG paint and live semantic Frame poses for interactive hits,
  including stationary hover during animation. Browser and React share one
  attachment-owned controller for input, gestures and notifications.

  After touch ends, compatibility mouse/click callbacks still dispatch, while
  hover waits for a new eligible pointer lifecycle input. Fresh MouseEvent-only
  input remains supported.

  Use `hover` instead of `hoverSource`, and `point` instead of top-level `svgX`/`svgY`.
  Narrow callback `cause`: scene notifications have `nativeEvent: null`.
  Replace Path-specific hit helpers with `queryCurrentSvgHit`; snapshot inspection
  continues through Core snapshot queries. Semantic Frames include rectangular
  corners and support library-owned BoxClips with
  finite affine poses. External clip/mask/visibility/pointer-event mutations are
  not promised to match native paint for those Frames.
  Canonical BoxClips and the IR viewport now use strict interiors. Frame rectangles
  remain closed, but a Frame meeting a clip only at its outer boundary is excluded.
  This changes `engine.hitTest`, `hitTest`, `buildHitTestIndex` and
  `buildInspectHitTestIndex`, including snapshot paint selections on clip/viewport
  boundaries. Native paint keeps browser behavior and may still reach ancestor
  handlers. Native hits may still select Box paint touching only a clip boundary
  and deliver its handler while a neighboring Box's color is visible. Frame gates do not
  reapply Core clips to native paint, eliminate every visually hidden callback, or
  fully restore earlier Browser hit behavior; SVG/PNG emission is unchanged.
  An integer left/top boundary query at identity/DPR 1 may coincide with
  the first painted pixel; fractional interior points remain eligible for direct
  queries. In recorded DPR 1 observations with integer placement, trusted clicks
  requested at (10.25, 60) arrived with integer CSS px coordinates (10, 60) and did
  not select the Frame; the interior control (12, 60) selected it. Different
  coordinate precision for pointerdown/up and click can yield different resolved
  targets within one operation. These finite examples do not establish uniform
  behavior throughout a pixel column or row, at other DPRs, for touch input, or
  across all browsers and versions. Floating transforms are not snapped: tiny
  computed overlaps can remain even at an authored ideal contact.
  `isPointInViewport` is available from `@boundsvg/core/scene` for the same pure IR
  viewport predicate; dimensions are checked and callers supply finite IR-root points.

  The React `useInteractiveSvg` container must contain exactly one outer SVG
  (`ownerSVGElement === null`). HTML wrappers around that SVG are supported;
  nested SVG paint does not count as another outer root. No outer SVG or multiple
  outer SVGs yield `hover: { status: "invalid", reason: "bindingMismatch" }` and no
  input callback delivery from that binding until a matching single root is available.

  `translateSvgCoords` now returns `SvgCoordinateResult` instead of `{x, y} | null`.
  Check `result.status === "ready"` before reading `result.point.svgX` and
  `result.point.svgY`; replace old `point.x`/`point.y` reads. The other states are
  `invalid` (`nonFiniteClientPoint`) and `unavailable` (`detached` or
  `coordinatesUnavailable`), rather than normal coordinate absence.

  New exports from `@boundsvg/core/scene` include `HitPose`, `HitClip`,
  `HitContainmentResult`, `queryFrameContainment` and `isSemanticFrame`. A `HitPose`
  contains a main matrix and linear witnesses; a `HitClip` contains `parent`,
  `pose` and canonical `geometry`. These interfaces were not previously public. The checked
  `applyInverseAffineMatrixToPoint` projection and shared `SvgPoint` are also new
  scene exports.
  Snapshot consumers of the new query supply their IR matrix with explicit empty
  `linearWitnesses`. Its point must be finite and in the same query coordinate
  system as the poses: client CSS px for Browser queries, IR root px for snapshots.
  The caller guarantees finiteness; the pure query does not recheck the point.
  Use `isSemanticFrame` for canonical eligibility. Valid empty evidence takes
  priority over unresolved calculations after all required inputs are validated.
  External individual scale/rotate/translate and arbitrary 3D are outside the Frame
  guarantee; even planar 3D syntax can become unavailable when native values are not
  2D. Native paint remains delegated to the browser.

  A positive bbox supplies a Frame only for a handler-bearing source with no
  primary occurrence; ordinary empty Text can retain a content primary.
  Automatic Text menus retain native Text through an ancestor Frame, while a
  foreground Frame in another branch blocks them. Line-copy eligibility reads
  IR-authored tracks; external CSS motion does not resample the TextMap or
  guarantee current line selection.

- [#61](https://github.com/zakideee/boundsvg/pull/61) [`1104db4`](https://github.com/zakideee/boundsvg/commit/1104db4ec067d3df6d7b71d1604136e2a0027b00) Thanks [@zakideee](https://github.com/zakideee)! - Place long Ruby readings at their naturally shaped spacing. Reserve remaining overflow after bounded lending from an adjacent unannotated kana or `、。，．・` in the same final line, column, or exclusion region. The parent text moves as a block. All alignments, annotation levels, and ordinary/flow measurement use the same placement. Long readings no longer emit `LONG_RUBY_ANNOTATION`; other recoverable warnings are preserved.

  **Output-affecting:** Long-reading width, position, wrapping, fit, ellipsis, unit line membership/visual order, and ink-centered animation pivots can change. Lending requires the reading to lie entirely farther from the base than the neighbor's cross-axis ink; inward disjoint readings reserve their full remaining demand. All sizes and layout paths use this rule, preserving existing fit certification and work limits. Recheck fixed frames and snapshots. Unit source and Ruby-level identity remain stable. Intentional negative tracking and arbitrary transforms do not cause dynamic collision re-layout.

  Short or equal-width readings can also reserve space when their control bounds extend beyond the base range.

  The WASM bridge schema is now 39. Update Core and matching Node/Web WASM together. Flow measurement removes `TextFlowFragment.ruby`, `TextFlowRubyAnnotation` and its level/run types, and `topRubyOverflowPx`/`bottomRubyOverflowPx`, including nested shrinkwrap results. Removed own keys are invalid even with `undefined` or `null`; custom producers must omit them.

  Flow fragments describe reserved cells, regions, and diagnostic ranges. Render original `Text`/`Inline`/`Ruby`/`Rt` content with `flowExclusions` instead of rebuilding paint from fragments. Ruby-bearing spans always use the canonical rich path, which omits fragment style for the whole document and normalizes whitespace once. Its ranges count rich tokens rather than plain-path graphemes. See the Ruby and boundtext migration documentation for the removed Rust fields/types and signature changes.

- [#60](https://github.com/zakideee/boundsvg/pull/60) [`a81b30e`](https://github.com/zakideee/boundsvg/commit/a81b30e8858daf09d9d281dab88c6e3eba424f06) Thanks [@zakideee](https://github.com/zakideee)! - Add box-relative `transformOrigin` keywords and two-axis ratios for static node transforms, including content-sized Text. Pixel origins remain supported separately; mixing origin forms is rejected. Node and text-unit animation keep their existing pivot and replacement behavior.

  This release uses WASM bridge schema 39. Update Core and its matching Node and Web WASM artifacts together.

  **Output-affecting:** Setting `transformOrigin` moves the pivot for static rotation and scale to the selected point of the completed layout box. Omitting it preserves existing output.

### Patch Changes

- Updated dependencies [[`e815fe6`](https://github.com/zakideee/boundsvg/commit/e815fe640e19746184cd073f0c3500216a6b924c), [`1104db4`](https://github.com/zakideee/boundsvg/commit/1104db4ec067d3df6d7b71d1604136e2a0027b00), [`a81b30e`](https://github.com/zakideee/boundsvg/commit/a81b30e8858daf09d9d281dab88c6e3eba424f06)]:
  - @boundsvg/core@0.11.0
  - @boundsvg/browser@0.11.0
  - @boundsvg/worker@0.11.0

## 0.10.0

### Minor Changes

- [#56](https://github.com/zakideee/boundsvg/pull/56) [`cf30f4b`](https://github.com/zakideee/boundsvg/commit/cf30f4becbd59ce7253c4270ddec540a3506a987) Thanks [@zakideee](https://github.com/zakideee)! - Add shared-frame Text/Inline gradients, sequential X/Y skew transforms, four-sided layout borders, and automatically sized container outlines.

  **Output-affecting:** Container borders now reserve space before padding and paint an inset surface. Absolute child placement and small fixed sizes follow the border box. Move the removed container stroke fields to `outline`, using `stroke` and `strokeWidth`; remove border widths when only a line frame is intended. Path stroke props remain available.

  **Output-affecting:** Overflow and rounded Image clips now emit SVG `<path>` elements instead of `<rect>`, changing their SVG bytes.

  Skew angles are bounded to [-60, 60] degrees with a finite geometry/animation chain envelope. Border and outline widths are finite and at most 1,048,576 px; border-bearing layout lengths are bounded to the same magnitude. Containers using border or outline require nonnegative radii.

  IR schema 37 uses explicit empty or elliptical box clips through `group.clip`. Regenerate IR using the matching engine. Text outline fills are solid strings or gradient indices into the parent Text's resolved resource table.

  Box and Text gradients now share resolved endpoint/ellipse geometry in IR. Raw IR angle forms and omitted radial geometry are removed; scene CSS gradient strings retain the same authoring syntax.

  Generated JSX preserves string and structured array props, including text stroke and shadow layers.

  IR nodes now require explicit source/content/decoration/wrapper ownership. Source ownership alone carries handlers and metadata; tree order replaces serialized `drawOrder`. Hit, text selection, inspection and layer manifests use snapshot-local source occurrences, allowing raw IR labels to repeat. Update direct IR consumers to the new ownership and SourceRef contracts; former handler/type maps and order-list query adapters are removed.

  **Output-affecting:** The SVG viewport contains the ordinary IR root element, so root transforms, clipping, opacity and animation apply. Source identity appears only on source anchors; endpoint metadata and generated resource identifiers use physical occurrences. Empty paint retains an empty endpoint. These changes alter SVG bytes and resource IDs. Layer extraction retains original ancestor structure and maps original source references to layer-local indices.

  When multiple SVG documents share one HTML document, supply distinct, normalized,
  pairwise prefix-free `resourceIdPrefix` scopes. This includes a single SVG shown
  alongside its extracted layers: occurrence-local resource IDs can otherwise
  refer to different clips, gradients or filters in another output.

  Inspection and text projections now take one prepared `IRSourceIndex` rather
  than an IR/index pair. Share that index across hit, copy and selection queries;
  text query methods reject source refs from a different prepared snapshot.

### Patch Changes

- Updated dependencies [[`cf30f4b`](https://github.com/zakideee/boundsvg/commit/cf30f4becbd59ce7253c4270ddec540a3506a987)]:
  - @boundsvg/core@0.10.0
  - @boundsvg/browser@0.10.0
  - @boundsvg/worker@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [[`1ecbc1d`](https://github.com/zakideee/boundsvg/commit/1ecbc1d7187e70587111888287e264281dd0c85e)]:
  - @boundsvg/core@0.9.0
  - @boundsvg/browser@0.9.0
  - @boundsvg/worker@0.9.0

## 0.8.0

### Minor Changes

- [#47](https://github.com/zakideee/boundsvg/pull/47) [`a51ba51`](https://github.com/zakideee/boundsvg/commit/a51ba5110becd6e6a87e3ad0e304ed4528fb2bce) Thanks [@zakideee](https://github.com/zakideee)! - Hit-test candidates include Path geometry and stroke outside its layout box. Explicit rectangular and rounded clips exclude invisible portions of their owner and descendants, including transformed and nested clips. Browser and React interaction verify painted Path fill/stroke, so empty space inside conservative bounds falls through to nodes underneath. Interactive container frames are tested in their own transformed coordinates, rather than the empty corners of a world-axis-aligned bounding box. React also uses the current native pointer hit stack for canvas-stable strokes under SVG viewport scaling.

  Path IR now includes required Rust-derived `pathGeometry`, and the WASM schema is 34. Regenerate saved or hand-built older IR with the matching engine's `renderToIR(scene)` before hit testing; missing geometry raises `VALIDATION` rather than using layout bounds. Path `width`/`height`, layout `bbox`, and inspection bounds keep their placement meaning. Static and explicit `timeMs` samples are covered; live SVG playback does not synchronize the hit index at every instant.

### Patch Changes

- [#48](https://github.com/zakideee/boundsvg/pull/48) [`ba96cd2`](https://github.com/zakideee/boundsvg/commit/ba96cd210cac218ef2cacbba39b8c87583d51aa8) Thanks [@zakideee](https://github.com/zakideee)! - Preserve displayed SVG DOM across unrelated parent updates in `BoundSvg`, `AnimatedBoundSvg`, and `InteractiveBoundSvg`. `InteractiveBoundSvg` also preserves the DOM through hover while using current event handlers. In animated displays, these updates preserve animation clocks. Changed SVG content still replaces the display.

- Updated dependencies [[`a51ba51`](https://github.com/zakideee/boundsvg/commit/a51ba5110becd6e6a87e3ad0e304ed4528fb2bce), [`a51ba51`](https://github.com/zakideee/boundsvg/commit/a51ba5110becd6e6a87e3ad0e304ed4528fb2bce)]:
  - @boundsvg/core@0.8.0
  - @boundsvg/browser@0.8.0
  - @boundsvg/worker@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`d00b967`](https://github.com/zakideee/boundsvg/commit/d00b967ae19f3017f8be057db9033fcdff8a17f1)]:
  - @boundsvg/core@0.7.0
  - @boundsvg/browser@0.7.0
  - @boundsvg/worker@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`8195190`](https://github.com/zakideee/boundsvg/commit/8195190ede076a641932a6d052b9f292413c56d7), [`9009113`](https://github.com/zakideee/boundsvg/commit/90091133e92c25f497878e07da7b68dd98e549d4)]:
  - @boundsvg/core@0.6.0
  - @boundsvg/browser@0.6.0
  - @boundsvg/worker@0.6.0

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
