# @boundsvg/worker

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
