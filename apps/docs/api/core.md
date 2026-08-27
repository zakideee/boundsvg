---
title: "@boundsvg/core"
---

# @boundsvg/core

Main library for rendering SVG and raster output from VNode trees.

## VNode Types

```ts
type VNodeType =
  | "Canvas"
  | "Flex"
  | "Grid"
  | "Box"
  | "Text"
  | "TextOnPath"
  | "Inline"
  | "InlineBox"
  | "InlineRect"
  | "Ruby"
  | "Rt"
  | "Image"
  | "Path"
  | "Svg"
  | "Shape"
  | "Symbol";

interface VNode {
  // Actual export is a discriminated union keyed by `type`
  type: VNodeType;
  props: PropsFor<VNodeType>;
  children: ChildrenFor<VNodeType>;
  key?: string | number; // hint for stable ID generation
}
```

In the actual API, `VNode` is exported as a discriminated union (`CanvasVNode | FlexVNode | TextVNode | ...`).
That means `type`, `props`, and `children` stay aligned, and invalid prop/child combinations are caught at compile time.

### Canvas-stable stroke type

`StrokeScaling` is exported from `@boundsvg/core` and applies to the border
paint of `Flex`, `Grid`, and `Box`, plus `Path` strokes:

```ts
type StrokeScaling = "transform" | "canvas";
```

The optional `strokeScaling` prop defaults to `"transform"`, preserving the
normal behavior where post-layout transforms scale a stroke. `"canvas"` keeps
a solid stroke's width in canvas space under translation, rotation, and
uniform scale. It does not change layout or `inspectScene().visualBBox`, and
`RenderOptions.scale` still scales the output resolution. Dashed strokes,
non-uniform scale, and axis reflection are rejected for this mode.

### Text flow types

`TextProps` includes `tabSize`, `flowExclusions`, and
`flowMinRegionWidthPx`. The exclusion types are exported from
`@boundsvg/core`:

```ts
type TextFlowExclusionMarginPx =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

type TextFlowExclusion =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      marginPx?: TextFlowExclusionMarginPx;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      marginPx?: TextFlowExclusionMarginPx;
    }
  | {
      kind: "path";
      d: string;
      x?: number;
      y?: number;
      fillRule?: "nonzero" | "evenodd";
      marginPx?: TextFlowExclusionMarginPx;
    };
```

Exclusion coordinates are local to the Text layout frame. A non-empty
`flowExclusions` array requires positive finite Text `width` and `height`.
`flowMinRegionWidthPx` is a positive finite minimum inline extent and defaults
to the resolved font size. `tabSize` is a positive integer, defaults to `4`, and
controls tab expansion when `whiteSpace` is `"pre-wrap"`.

See the [Text component reference](/components/text#flow-around-exclusions)
for shape defaults, validation rules, and an example.

### Text composition types

`Text`, `TextOnPath`, `Inline`, `InlineBox`, and `Rt` accept deterministic text
decoration. An inner `"none"` stops inherited decoration; an inner object
replaces it.

```ts
type TextDecorationLine = "underline" | "overline" | "line-through";

type TextDecoration =
  | "none"
  | {
      line: TextDecorationLine | readonly TextDecorationLine[];
      color?: string;
      style?: "solid" | "double" | "dotted" | "dashed" | "wavy";
      thicknessPx?: number;
      offsetPx?: number;
      skipInk?: "none" | "all";
    };

type InlineRectProps = {
  inlineSizePx: number;
  blockSizePx?: number | "line";
  advancePx?: number;
  blockAlign?: "start" | "center" | "end";
  color: string;
  borderRadiusPx?: number;
  opacity?: number;
  paintOrder?: "behind" | "front";
  animate?: AnimationSpec;
};
```

`InlineRect` is a childless atomic rectangle allowed inside `Text`, `Inline`,
or `InlineBox`. Its painted inline size is always positive; `advancePx`
defaults to `0`, so a caret can paint at the pen position without changing
line breaking. `blockSizePx` defaults to `"line"`, `blockAlign` to `"center"`,
and `paintOrder` to `"front"`. A `Text` may contain at most 4,096 inline
rectangles.

Decoration uses font metrics with deterministic fallbacks, follows horizontal
or vertical logical axes on `Text` and fitted curve distance on `TextOnPath`,
and does not change shaping, line breaks, glyph placement, or UnitMap identity.
The default style is `"solid"`; default color is the resolved run color;
`skipInk` defaults to `"none"`. All five styles are materialized as
deterministic filled geometry. `skipInk: "all"` cuts underline and overline
around resolved glyph fill outlines but keeps line-through continuous. One
`Text` or `TextOnPath` may author at most 4,096 decoration ranges and resolve at
most 16,384 paint paths. An effective decorated range cannot also use
`animateUnits`; validation throws
`TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED`.

See [Text & Fonts](/guides/text-and-fonts#text-decoration-and-inline-rectangles)
for composition examples.

### `TextOnPath`

`TextOnPath` shapes one non-empty, horizontal LTR source made from strings and
nested `Inline` nodes, then positions its glyph outlines along one open or
authored-closed SVG path. The path uses node-local px and is not scaled to the
required layout frame.

```ts
type TextOnPathProps = {
  d: string;
  width: number;
  height: number;
  font: string;
  fontSizePx: number;
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  color?: string;
  startOffsetPx?: number;
  textAnchor?: "start" | "middle" | "end";
  pathDirection?: "forward" | "reverse";
  pathNormal?: "left" | "right";
  pathOffsetPx?: number;
  pathFit?: "none" | "spacing" | "scale" | "shrink";
  pathOverflow?: "hidden" | "error" | "ellipsis";
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];
  textDecoration?: TextDecoration;
  animate?: AnimationSpec;
  animateUnits?: TextUnitAnimation;
  // Scalar text stroke, positioning, layer, metadata, and event props also apply.
};
```

```tsx
<TextOnPath
  d="M20 120C100 20 300 20 380 120"
  width={400}
  height={150}
  font="NotoSansJP"
  fontSizePx={28}
  startOffsetPx={200}
  textAnchor="middle"
  pathDirection="reverse"
  pathNormal="right"
  pathOffsetPx={6}
  pathFit="shrink"
  pathOverflow="ellipsis"
  textDecoration={{ line: "underline", style: "dashed", skipInk: "all" }}
>
  曲線上の
  <Inline font="JetBrainsMono" color="#facc15" textDecoration="none">
    PATH
  </Inline>
</TextOnPath>
```

`startOffsetPx` and `pathOffsetPx` default to `0`; `textAnchor` defaults to
`"start"`; `pathDirection` to `"forward"`; `pathNormal` to `"left"`; `pathFit`
to `"none"`; and `pathOverflow` to `"hidden"`. `pathDirection` changes path
traversal without reversing logical source order. `pathNormal` selects a side
of that effective traversal, and `pathOffsetPx` is non-negative. The guide path
is not painted automatically — add a separate `Path` node when it should be
visible. See [Text on an SVG path](/guides/text-and-fonts#text-on-an-svg-path)
for closed-path, fit, overflow, resource, and fatal-error behavior.

Children may be strings or nested `Inline` nodes only. An `Inline` can override
font/fallback, weight/style, variation/features, size/spacing/language, color,
`textStrokes`, `textShadows`, and `textDecoration`; `InlineBox`, `InlineRect`,
`Ruby`, `Rt`, newlines/tabs, vertical writing, and bidi reordering remain
unsupported. Undefined Inline values inherit. Stroke/shadow arrays replace the
whole category (`[]` clears it), while a decoration object replaces its owner
range and `"none"` stops inherited decoration. Original logical source and ARIA
text remain separate from fitted/ellipsized display text, and UnitMap IDs stay
in source order across direction and fitting.

## Animation Types

```ts
type AnimationTransform2D = {
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotateDeg?: number;
};

type AnimationKeyframe = {
  at: number;
  opacity?: number;
  transform?: AnimationTransform2D;
};

type AnimationStepPosition =
  | "jump-start"
  | "jump-end"
  | "jump-none"
  | "jump-both";

type AnimationEasing =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step-start"
  | "step-end"
  | readonly [number, number, number, number]
  | AnimationSpring
  | {
      type: "steps";
      count: number;
      position?: AnimationStepPosition;
    };

type AnimationSpring = {
  type: "spring";
  /** 1..1000, default 100. */
  stiffness?: number;
  /** 1..100, default 10. */
  damping?: number;
  /** 0.1..10, default 1. */
  mass?: number;
};

type AnimationSpec = {
  keyframes: readonly AnimationKeyframe[];
  durationMs: number;
  delayMs?: number;
  easing?: AnimationEasing;
  iterations?: number | "infinite";
  fill?: "none" | "both";
};

type TextUnitAnimation = {
  by: "cluster" | "line";
  animation: AnimationSpec;
  delayStepMs?: number;
  order?: "logical" | "visual";
  ruby?: "with-base" | "separate";
};
```

`AnimationTransform2D` intentionally excludes `originX` and `originY`.
A node's animated transform uses the center of its layout bbox;
`TextUnitAnimation` uses the center of each unit's resolved outline ink bbox.
That unit bbox is the union of glyph fill outlines; stroke width and shadow
offset/blur expansion do not enlarge it.
Keyframe offsets are normalized to `0..1`, strictly increasing, and each
targeted channel must be present in every keyframe. See the
[Animation guide](/guides/animation) for output modes, defaults, and
determinism boundaries.

`TextUnitAnimation` is available on `Text` and `TextOnPath`. It applies the
same post-layout opacity/transform channels to resolved shaping clusters or
lines/vertical columns. `delayStepMs` defaults to `0`, `order` to `"logical"`,
and `ruby` to `"with-base"`. Unit targeting changes paint grouping only: it
does not split shaping clusters or alter line/path placement, advances, chosen
font size, or glyph paint order.

`TextOnPath.animateUnits` requires every effective text range to be decoration
free. A root decoration stopped by `Inline textDecoration="none"` for all
non-empty content is allowed; any effective decorated range throws
`TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED`. Node-level `animate` remains
available for decorated path text.

## JSX Runtime

Configure your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@boundsvg/core",
  },
}
```

The library exports `jsx`, `jsxs`, and `Fragment`, returning `VNode` from JSX calls. No dependency on React itself.

## Engine

### `createEngineAsync(options)`

Creates an Engine instance with WASM auto-initialization and font registration. Async because it includes WASM loading.

```ts
const engine = await createEngineAsync({
  fonts: [
    { alias: "NotoSansJP", data: fontData, weight: 400, style: "normal" },
  ],
  geometries: [{ id: "pill", doc: pillGeometry }],
  symbols: [{ id: "arrow", def: arrowSymbol }],
});
```

Fonts are registered inside the WASM engine instance. Pass the ones you know up front in the `fonts` array; `engine.registerFonts()` adds more to a live engine afterwards, so a face loaded on demand does not require rebuilding the engine. Re-registering an alias/weight/style combination that already exists throws.

| Option       | Type                                           | Default | Description                               |
| ------------ | ---------------------------------------------- | ------- | ----------------------------------------- |
| `fonts`      | `FontFaceInput[]`                              | `[]`    | Fonts to register at initialization       |
| `geometries` | `Array<{ id: string; doc: GeometryDoc }>`      | `[]`    | Geometry registry entries loaded on start |
| `symbols`    | `Array<{ id: string; def: SymbolDefinition }>` | `[]`    | Symbol registry entries loaded on start   |

### Engine Methods

All render methods are **synchronous**: layout, text shaping, and rasterization run in WASM without async I/O.

Direct `SceneNode` inputs are inspected recursively before rendering and must
be lossless JSON transport objects. Functions, promises, accessors, sparse
arrays, cycles, explicit `undefined`, non-finite numbers, and non-plain class
instances fail with `SCENE_NOT_SERIALIZABLE`, even when `skipValidation` is
enabled. `assertSerializableSceneTransport(scene)` exposes the same admission
check for downstream materialized-scene generators.

```ts
interface Engine {
  renderToSvg(input: EngineInput, options?: RenderOptions): string;
  renderToPng(input: EngineInput, options?: RenderOptions): Uint8Array;
  renderToWebp(input: EngineInput, options?: RenderOptions): Uint8Array;
  renderToAnimatedWebp(
    input: EngineInput,
    options: RenderAnimatedWebpOptions,
  ): Uint8Array;
  renderToAnimatedGif(
    input: EngineInput,
    options: RenderAnimatedGifOptions,
  ): Uint8Array;
  renderToSvgAndIR(
    input: EngineInput,
    options?: RenderOptions,
  ): { svg: string; ir: IR };
  renderToLayeredSvg(
    input: EngineInput,
    options?: LayeredSvgOptions,
  ): LayeredSvgResult;
  renderToLayeredPng(
    input: EngineInput,
    options?: LayeredPngOptions,
  ): LayeredPngResult;
  renderToLayoutTree(
    input: EngineInput,
    options?: LayoutRenderOptions,
  ): LayoutResult;
  renderToIR(input: EngineInput, options?: RenderOptions): IR;
  renderToTextOutlines(
    input: EngineInput,
    options?: RenderOptions,
  ): TextOutlineNode[];
  compile(input: EngineInput, options?: CompileOptions): CompiledScene;
  renderCompiledToSvg(compiled: CompiledScene, options?: EmitOptions): string;
  renderCompiledToPng(
    compiled: CompiledScene,
    options?: EmitOptions,
  ): Uint8Array;
  renderCompiledToTextOutlines(
    compiled: CompiledScene,
    options?: {
      showMissingGlyphs?: boolean;
      onWarning?: (warning: RecoverableError) => void;
    },
  ): TextOutlineNode[];
  sampleAnimationState(
    input: EngineInput,
    timeMs: number,
  ): AnimationStateSample[];
  renderFrames(
    input: EngineInput,
    options: RenderFramesOptions,
  ): Iterable<Frame>;
  layoutTextFlow(input: TextFlowInput): TextFlowResult;
  layoutTextFlowWithExclusions(
    input: TextFlowWithExclusionsInput,
  ): TextFlowWithExclusionsResult;
  measureTextBlock(input: MeasureTextBlockInput): MeasureTextBlockResult;
  measureIntrinsicInlineSize(
    input: IntrinsicInlineSizeInput,
  ): IntrinsicInlineSizeResult;
  shrinkwrapText(input: ShrinkwrapTextInput): ShrinkwrapTextResult;
  shrinkwrapFlow(input: ShrinkwrapFlowInput): ShrinkwrapFlowResult;
  registerFonts(fonts: FontFaceInput[]): void;
  registerGeometry(id: string, doc: GeometryDoc): void;
  registerSymbol(id: string, def: SymbolDefinition): void;
  unregisterGeometry(id: string): void;
  unregisterSymbol(id: string): void;
  hitTest(ir: IR, x: number, y: number): string | null;
  dispose(): void;
}
```

### `engine.renderToSvg(input, options?)`

Renders a VNode tree to an SVG string.

```ts
const svg: string = engine.renderToSvg(node);
```

### `engine.renderToPng(input, options?)`

Renders a VNode tree to a PNG `Uint8Array`.

```ts
const png: Uint8Array = engine.renderToPng(node, { scale: 2 });
```

### `engine.renderToWebp(input, options?)`

Renders a VNode tree to a lossless (VP8L) WebP `Uint8Array`. Same pipeline,
options, and resolution caps as `renderToPng`; only the container differs.
There is no lossy mode and therefore no quality option.

```ts
const webp: Uint8Array = engine.renderToWebp(node, { scale: 2 });
```

Throws `WEBP_NO_ENCODER` when the loaded WASM build predates the encoder.

### `engine.renderToAnimatedWebp(input, options)`

Samples a declarative animation into static frames and muxes them into an
animated lossless WebP. Every frame is a full-canvas replacement.

```ts
const webp = engine.renderToAnimatedWebp(node, {
  durationMs: 2000,
  fps: 20,
  iterations: "infinite",
});
```

### `engine.renderToAnimatedGif(input, options)`

The same sampling, written as an animated GIF. Lossy — 256 colors per frame and
1-bit alpha — but still byte-deterministic.

```ts
const gif = engine.renderToAnimatedGif(node, {
  durationMs: 2000,
  fps: 20,
  iterations: 3,
});
```

### `RenderAnimatedWebpOptions` / `RenderAnimatedGifOptions`

Everything in `RenderOptions` except `animation` and `timeMs`, plus the frame
schedule and a required total-play count. The two option types are structurally
identical, but their container limits differ.

| Option             | Type                   | Default | Description                                                                  |
| ------------------ | ---------------------- | ------- | ---------------------------------------------------------------------------- |
| `durationMs`       | `number` (> 0)         | —       | Total animation length. Required unless `timesMs` is given                   |
| `fps`              | `number` (1–60)        | `20`    | Sampling rate. Rejected when `timesMs` is given                              |
| `timesMs`          | `readonly number[]`    | —       | Explicit sample times. Mutually exclusive with `fps` / `durationMs`          |
| `frameDurationsMs` | `readonly number[]`    | —       | Per-frame display durations. Required with `timesMs`, and the same length    |
| `iterations`       | `number \| "infinite"` | —       | Required total plays. WebP: 1–65535; GIF: 1–65536; `"infinite"` is unbounded |

`iterations` counts total plays, not repeats after the first play. For GIF,
`iterations: 1` omits the repeat extension; finite `N >= 2` stores `N - 1` in
that extension. Animated WebP stores finite `N` directly.

Schedule derivation, fixed by tests:

- With `timesMs`, `frameDurationsMs` must have one whole-millisecond entry per
  frame, each in 1–60000.
- Otherwise `frameCount = max(2, ceil(durationMs * fps / 1000))` and
  `timesMs[i] = min(i * 1000 / fps, durationMs)`. Frame durations are the
  differences between rounded frame boundaries anchored to `durationMs`, so
  playback lasts exactly as long as requested rather than drifting off the
  sample grid.
- More than 300 frames is an error.

Errors: `ANIMATED_WEBP_INVALID_SCHEDULE` / `ANIMATED_GIF_INVALID_SCHEDULE` for a
malformed schedule, `ANIMATED_WEBP_TOO_MANY_FRAMES` / `ANIMATED_GIF_TOO_MANY_FRAMES`
past the cap, `ANIMATED_WEBP_PAYLOAD_LIMIT` / `ANIMATED_GIF_PAYLOAD_LIMIT` when the
sampled frames exceed the transport limit, and `WEBP_NO_ENCODER` / `GIF_NO_ENCODER`
when the loaded WASM build predates the encoder. The shared raster caps report
through the existing `PNG_*` codes and `onPngResolutionAdjusted`.

GIF additionally warns with `ANIMATED_GIF_TIMING_ADJUSTED` when the emitted
animation runs more than 5% longer than requested. GIF cannot express a frame
shorter than 20 ms, so a schedule with shorter frames — typically an `fps`
above 50, or a very short `durationMs` — stretches. A smaller overshoot is not
reported: GIF's 10 ms quantum makes one unavoidable for most durations.

The assembled animated file is capped at 256 MiB and the sampled SVG frames at
64 MiB of characters; exceeding the former surfaces as `WASM_RENDER_FAILED` and the
latter as `ANIMATED_WEBP_PAYLOAD_LIMIT` / `ANIMATED_GIF_PAYLOAD_LIMIT`.

### `engine.renderToLayeredSvg(input, options?)`

Renders a VNode tree to a set of SVG layers plus a manifest. See [Layered Export](/guides/layered-export) for the full guide.

```ts
const result: LayeredSvgResult = engine.renderToLayeredSvg(node, {
  validateComposition: { enabled: true },
});
for (const layer of result.layers) {
  console.log(layer.id, layer.paintOrder, layer.mode, layer.svg.length);
}
```

### `engine.renderToLayeredPng(input, options?)`

Renders a VNode tree to a set of PNG layers plus a manifest. `rasterBackground` is not supported: a `Canvas background` still paints edge-to-edge into the `default` layer, so that layer's PNG carries the background, alpha included; it is transparent only if the background color is. See [Layered Export](/guides/layered-export).

```ts
const result: LayeredPngResult = engine.renderToLayeredPng(node, { scale: 2 });
// result.pixelWidth / pixelHeight reflect the scaled output
```

### `engine.renderToLayoutTree(input, options?)`

Returns pre-animation layout geometry. Its `LayoutRenderOptions` accepts only
`skipValidation`; animation is sampled after this stage.

Use it when the allocated layout itself is the subject of inspection.

### `engine.renderToIR(input, options?)`

Returns the intermediate representation for hit-testing or cache validation.
For animated scenes it always samples opacity and transform at `timeMs` while
retaining the semantic animation track. The `animation` output mode does not
select a different IR representation.

In text IR, `IRTextNode.lines[].fragments[].style` is optional. It is present
only for a fragment with an explicit color-bearing style override; a fragment
without that override does not carry a concrete `TextRunStyle`. The effective
glyph fill is resolved in this exact order:

```ts
PositionedGlyph.fill ?? LineFragment.style?.color ?? IRTextNode.color;
```

Use the same fallback when consuming text IR instead of reading
`fragment.style.color` directly.

The structural fields behind `IR`, `IRNode`, and all seven public node aliases
are generated from Rust's serialize-direction contract. `IR.warnings` remains
the curated semantic projection: the Engine returns `RecoverableError`
instances rather than raw warning objects.

Use `validateSerializedIR(value)` at a JSON, cache, or Worker boundary. It
validates the JSON-safe Rust output shape, including every nested node; it does
not initialize WASM or compile a schema at runtime.

```ts
import { validateSerializedIR } from "@boundsvg/core";

const serialized = JSON.parse(JSON.stringify(engine.renderToIR(node)));
if (!validateSerializedIR(serialized)) {
  throw new TypeError("Invalid serialized boundsvg IR");
}
```

The deserialize contract used internally by IR emission is directional and is
not exposed as the public output type.

### `engine.renderToTextOutlines(input, options?)`

Returns an array of `TextOutlineNode` objects containing SVG path data for each text element. Use to convert text to outlined paths (e.g., for static SVG export without font embedding).

### `engine.hitTest(ir, x, y)`

Performs hit-testing on an IR. Returns the `NodeId` of the topmost element at `(x, y)`, or `null`.

### `engine.compile(input, options?)`

Compiles a VNode tree into a `CompiledScene` (holds the IR). The compiled result can be rendered multiple times with different emit options, avoiding repeated layout computation. Animated scenes keep their raw tracks in the compiled IR and are sampled independently by each `renderCompiled*` call.

```ts
const compiled: CompiledScene = engine.compile(node);
const svg = engine.renderCompiledToSvg(compiled);
const png = engine.renderCompiledToPng(compiled, { scale: 2 });
```

For batch rendering, compile once and render many times: validation, shaping, and
layout run once at compile time. Each `renderCompiled*` call resolves glyph
outlines and emits inside WASM without returning an intermediate resolved IR.
Rendering never mutates the compiled scene; repeated SVG output from the same
`CompiledScene` is byte-identical, including after PNG renders in between.
`CompiledScene.ir` is nevertheless a public mutable object. Compiled render
methods read its current value at call time. The outer `CompiledScene.width` and
`height` fields are convenience snapshots copied when compilation completes;
they are not synchronized after caller mutation of the IR.

```ts
const outputs: Uint8Array[] = [];
const compiled = engine.compile(node);
for (const scale of [1, 2, 3]) {
  outputs.push(engine.renderCompiledToPng(compiled, { scale }));
}
```

### Shape Registry

`Shape` and `Symbol` resolve through the engine registry before layout. You can preload entries at engine creation time or register them later:

```ts
engine.registerGeometry("pill", pillGeometry);
engine.registerSymbol("arrow", arrowSymbol);
```

Registered shapes are expanded into normal boundsvg nodes during compile, so existing layout, IR, and hit-testing behavior stays unchanged.

### `engine.renderCompiledToSvg(compiled, options?)`

Renders a `CompiledScene` to an SVG string.

### `engine.renderCompiledToPng(compiled, options?)`

Renders a `CompiledScene` to a PNG `Uint8Array`.

### `engine.renderCompiledToTextOutlines(compiled, options?)`

Extracts outlined text from a pre-compiled scene, avoiding repeated layout computation.

### `engine.renderFrames(input, options)`

Compiles and prepares one scene, then samples it synchronously at every
requested time. Every SVG frame is static; PNG frames rasterize the same static
pose through a rasterizer-compatible SVG. Input order, duplicate times, and
non-monotonic times are preserved.

```ts
for (const frame of engine.renderFrames(scene, {
  timesMs: [600, 0, 1_400, 600],
  format: "svg",
})) {
  console.log(frame.index, frame.timeMs, frame.data);
}
```

```ts
type Frame =
  | { index: number; timeMs: number; format: "svg"; data: string }
  | { index: number; timeMs: number; format: "png"; data: Uint8Array };

type RenderFramesOptions = Omit<RenderOptions, "animation" | "timeMs"> & {
  timesMs: readonly number[];
  format: "svg" | "png";
};
```

The returned iterable is single-use and owns an instance-local prepared scene.
Normal exhaustion, iterator `return()`/`throw()`, a render error, or
`engine.dispose()` releases that native state. If a loop may exit early, use a
construct that closes the iterator (such as `for...of` with `break`) or call
`return()` explicitly. An empty schedule still validates and prepares the
scene, so recoverable warnings remain observable. Iterating the same object a
second time yields no frames and does not throw; call `renderFrames` again for a
new pass.

`renderFrames` samples one fixed layout. To distribute frames across
Workers, or to render independently materialized layout-reactive scenes, use
[`WorkerPool`](/api/worker#workerpool).

### `engine.dispose()`

Releases WASM resources. Use in Node.js batch processing to explicitly free memory.

## Render Options

| Option                    | Type                                  | Default              | Description                                                                                                                                  |
| ------------------------- | ------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `scale`                   | positive finite `number`              | `1`                  | Raster scale factor (no effect on SVG). Output is capped at 3 840 px (long edge) / 8.3 M pixels; exceeding triggers `rasterOversizeBehavior` |
| `debug`                   | `boolean \| DebugOverlayConfig`       | `false`              | Draw bbox/guide overlays. `true` draws all of them; `{ parts: [...] }` selects from `"specified"`, `"layout"`, `"actual"`, `"baseline"`      |
| `resourceIdPrefix`        | `string`                              | —                    | Literal prefix for all boundsvg-generated document-global SVG identifiers and their references                                               |
| `textPathMode`            | `"merged" \| "glyphs"`                | `"merged"`           | Glyph-outline grouping for `Text` and `TextOnPath`; this does not enable or configure path layout                                            |
| `rasterBackground`        | `string`                              | —                    | Raster background color (PNG / WebP / GIF)                                                                                                   |
| `skipValidation`          | `boolean`                             | `false`              | Skip VNode tree validation                                                                                                                   |
| `rasterOversizeBehavior`  | `"auto-adjust" \| "error"`            | `"auto-adjust"`      | Behavior when raster resolution exceeds limits                                                                                               |
| `onPngResolutionAdjusted` | `(warning) => void`                   | —                    | Callback when the raster scale is auto-adjusted                                                                                              |
| `onWarning`               | `(warning: RecoverableError) => void` | —                    | Callback for recoverable warnings during render                                                                                              |
| `animation`               | `"declarative" \| "static"`           | SVG: `"declarative"` | SVG output mode. Raster output is always sampled statically                                                                                  |
| `timeMs`                  | `number`                              | `0`                  | Non-negative finite animation sampling time                                                                                                  |
| `reducedMotion`           | `"keep" \| "pause"`                   | `"keep"`             | `"pause"` appends one `prefers-reduced-motion` block that stops every animation this render started. `"keep"` leaves output byte identical   |
| `showMissingGlyphs`       | `boolean`                             | `false`              | Render tofu rectangles for missing glyphs (`glyph_id=0`)                                                                                     |

`resourceIdPrefix` covers generated `<defs>` IDs and fragment references,
animation keyframes and names, generated classes and selectors, shared Shape
paths, canvas-stroke classes, and the debug-overlay class. It does not rewrite
authored embedded SVG content or metadata. For multiple outputs embedded in one
document, use prefixes that remain non-empty and pairwise prefix-free after
boundsvg's CSS-safe normalization: no normalized value may be the string prefix
of another. Merely different values are insufficient; for example, `doc-` and
`doc-clip-` are outside the guarantee. Fixed-width scope tokens passed through
`createResourceIdPrefix()` are a simple way to satisfy the condition.

## Render capability contract

`@boundsvg/core` exports the immutable hard limits needed by preflight and UI
consumers without requiring WASM initialization:

| Export                            |         Value | Unit                               |
| --------------------------------- | ------------: | ---------------------------------- |
| `RASTER_MAX_LONG_EDGE`            |         3,840 | pixels on either output axis       |
| `RASTER_MAX_PIXELS`               |     8,294,400 | total output pixels                |
| `RASTER_DIMENSION_SATURATION`     | 4,294,967,295 | reported requested pixels per axis |
| `MAX_ANIMATION_FRAMES`            |           300 | frames per animated raster         |
| `MAX_ANIMATION_SVG_PAYLOAD_CHARS` |    67,108,864 | transported SVG characters         |

`resolveRasterScale({ width, height, requestedScale })` computes the raster
plan for the base dimensions supplied to it. Raster entry points supply the
root dimensions produced by layout. To predict a compiled render, use the
current `compiled.ir.width` / `height`; these are the dimensions the render
method reads. The outer `CompiledScene.width` / `height` fields match only the
unchanged IR returned by `compile()`. Passing authored Canvas props directly to
the resolver is not guaranteed to predict the rendered dimensions. The returned `ResolvedRasterScale` contains
`appliedScale`, the requested and output dimensions, and `adjusted`.
`adjusted` is `true` only when a legal request is scaled downward to satisfy a
raster cap; a request exactly on either cap remains unchanged. Requested
dimensions above the `u32` range are reported as
`RASTER_DIMENSION_SATURATION`.

Root Canvas dimensions are integer-quantized during layout before raster
planning. All raster formats use those effective dimensions. For example,
`10.25 × 20.5` renders as `10 × 21` at scale 1, while authored widths `1.01`
and `1.49` render as 1 px at scale 1. Positive fractional widths below 0.5 can
quantize to zero and fail with `INVALID_CANVAS_SIZE`; positive finite values
that are too large to remain finite through layout fail with the same code.
Integer inputs are not exempt from this boundary: 16,777,216 remains exact, but
the layout representation does not distinguish every adjacent integer above
that boundary. For example, authored width 16,777,217 becomes 16,777,216. Use
the current compiled IR dimensions for exact output prediction rather than
relying on authored values or integer-ness alone.

The resolver validates its supplied scale and base dimensions. Scale must be
positive and finite (`PNG_INVALID_SCALE`), and supplied base dimensions must be
positive, finite, and remain above zero after the SVG root's two-decimal
formatting (`INVALID_CANVAS_SIZE`). If the requested scale or cap-preserving
uniform scale would format either output axis as zero, rendering fails with
`PNG_OUTPUT_DIMENSION_TOO_SMALL`. boundsvg deliberately does not clamp that
axis to 1 px because doing so would change the aspect ratio and make
`appliedScale`, the emitted viewport, and the raster dimensions disagree.

All raster entry points use the same observable order: native IR parse and
outline-glyph-limit preflight, recoverable warning delivery, resolution
outcome (including strict `PNG_PIXEL_LIMIT`), then outline resolution/SVG emit
and encoding. Thus an outline request above the glyph limit wins over a
simultaneous pixel-limit error; a `MISSING_GLYPH` warning is delivered before a
pixel-limit error. Input guard failures occur before IR creation and deliver no
scene warning. Rust independently rechecks the same dimensions at the raster
boundary; the SVG character cap protects the TS-to-WASM animation payload
before that boundary.

```ts
import { resolveRasterScale } from "@boundsvg/core";

const resolution = resolveRasterScale({
  width: 2_560,
  height: 2_560,
  requestedScale: 2,
});
// resolution.outputWidth === 2_880
// resolution.outputHeight === 2_880
// resolution.adjusted === true
```

## Text unit animation limits

Text unit animation is opt-in and can expand one merged Text into many paint
fragments. Limits are scene-wide totals across every animated Text:

| Export                                      | Value | Behavior                             |
| ------------------------------------------- | ----: | ------------------------------------ |
| `TEXT_ANIMATION_UNIT_WARNING_THRESHOLD`     | 1,024 | Recoverable warning above this value |
| `TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD` | 2,048 | Recoverable warning above this value |
| `MAX_TEXT_ANIMATION_UNITS`                  | 4,096 | Fatal error above this value         |
| `MAX_TEXT_ANIMATION_FRAGMENTS`              | 8,192 | Fatal error above this value         |

The fragment estimate is `unit count × (shadow layers + stroke layers + 1
fill)` and is summed across the scene. Limits are validated rather than
silently truncating units. Text without `animateUnits` keeps the existing
merged output path.

## Layered export types

See the [Layered Export guide](/guides/layered-export) for concepts, layer resolution rules, and compositing-island behavior.

### `LayeredSvgOptions`

Subset of `RenderOptions` plus `validateComposition`.

| Option                | Type                                  | Default         | Description                                                                     |
| --------------------- | ------------------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `skipValidation`      | `boolean`                             | `false`         | Skip VNode tree validation                                                      |
| `debug`               | `boolean \| DebugOverlayConfig`       | `false`         | Draw bbox/guide overlays per layer; same shape as the Render Options entry      |
| `resourceIdPrefix`    | `string`                              | —               | Base prefix for all generated document-global identifiers in each layer         |
| `scale`               | `number`                              | `1`             | Scale factor forwarded to each layer SVG (no effect on SVG output geometry)     |
| `textPathMode`        | `"merged" \| "glyphs"`                | `"merged"`      | Glyph-outline grouping for `Text` and `TextOnPath`; unrelated to path placement |
| `showMissingGlyphs`   | `boolean`                             | `false`         | Render tofu rectangles for missing glyphs                                       |
| `onWarning`           | `(warning: RecoverableError) => void` | —               | Callback for recoverable warnings                                               |
| `animation`           | `"declarative" \| "static"`           | `"declarative"` | Per-layer SVG animation output mode                                             |
| `timeMs`              | `number`                              | `0`             | Sampling time shared by every layer                                             |
| `validateComposition` | `LayeredCompositionValidationOptions` | —               | Enable pixel-diff composition validation                                        |

With a non-empty prefix, layered SVG export derives the deterministic sub-prefix
`<normalized-prefix>layer-<zero-based-index>-` for each emitted layer. Those
sub-prefixes are pairwise prefix-free even for indices such as `1` and `10`.
Across separate layered results, the caller still supplies normalized,
non-empty, pairwise prefix-free base prefixes. Omitting the prefix preserves the
legacy bytes and does not add a cross-layer namespace guarantee.

### `LayeredPngOptions`

`LayeredSvgOptions` plus PNG-specific options.

Layered PNG is always sampled statically. Its manifest still records
`animated: true` and the shared `timeMs` when the source scene is animated.

| Option                    | Type                       | Default         | Description                                  |
| ------------------------- | -------------------------- | --------------- | -------------------------------------------- |
| `rasterOversizeBehavior`  | `"auto-adjust" \| "error"` | `"auto-adjust"` | Behavior when PNG resolution exceeds limits  |
| `onPngResolutionAdjusted` | `(warning) => void`        | —               | Callback when the PNG scale is auto-adjusted |

### `LayeredCompositionValidationOptions`

| Option               | Type      | Default | Description                                                                  |
| -------------------- | --------- | ------- | ---------------------------------------------------------------------------- |
| `enabled`            | `boolean` | `false` | Must be `true` to run validation                                             |
| `maxDifferentPixels` | `number`  | `0`     | Passing threshold on absolute differing pixel count                          |
| `maxDifferenceRatio` | `number`  | `0`     | Passing threshold on differing-pixel ratio (`differentPixels / totalPixels`) |

### `LayeredSvgResult`

```ts
type LayeredSvgResult = {
  width: number;
  height: number;
  layers: LayerEntry[];
  compositionValidation?: LayeredCompositionValidationResult;
  manifest: {
    width: number;
    height: number;
    animated?: true;
    timeMs?: number;
    layers: LayerManifestEntry[];
  };
};
```

### `LayeredPngResult`

```ts
type LayeredPngResult = {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  layers: LayerPngEntry[];
  compositionValidation?: LayeredCompositionValidationResult;
  manifest: {
    width: number;
    height: number;
    pixelWidth: number;
    pixelHeight: number;
    animated?: true;
    timeMs?: number;
    layers: LayerPngManifestEntry[];
  };
};
```

### `LayerEntry` / `LayerPngEntry`

| Field                 | Type                                      | Description                                                                                                                                         |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `string`                                  | Resolved layer id (`"default"` when unspecified)                                                                                                    |
| `svg` or `png`        | `string` / `Uint8Array`                   | Layer payload                                                                                                                                       |
| `bbox`                | `{ x, y, width, height }`                 | Union bbox of source nodes assigned to this layer                                                                                                   |
| `nodeIds`             | `string[]`                                | Source `NodeId`s painted into this layer (sorted)                                                                                                   |
| `nodeMeta`            | `Record<string, Record<string, string>>?` | Per-node `meta` for the nodes in this layer                                                                                                         |
| `parts`               | `LayerManifestPart[]?`                    | Addressable shape parts, when `emitPartIds` is on                                                                                                   |
| `mode`                | `"independent" \| "atomic"`               | `atomic` when any [compositing-island trigger](/guides/layered-export#compositing-islands) applies to this layer's content; `independent` otherwise |
| `paintOrder`          | `number`                                  | Lowest `ir.drawOrder` index inside the layer, or `0` if it draws nothing. Ascending = back-to-front                                                 |
| `collapsedFromLayers` | `string[]?`                               | Other layer ids absorbed into this atomic layer                                                                                                     |
| `warnings`            | `LayerWarning[]`                          | Resolver warnings (see below)                                                                                                                       |

### `LayerWarning`

```ts
type LayerWarning =
  | {
      code: "CROSSES_COMPOSITING_ISLAND";
      nodeId: string;
      islandRootNodeId: string;
    }
  | {
      code: "PARENT_OPACITY_PREVENTED_SPLIT";
      nodeId: string;
      parentNodeId: string;
    }
  | { code: "CLIP_FORCED_ATOMIC"; nodeId: string }
  | { code: "BOX_SHADOW_FORCED_ATOMIC"; nodeId: string }
  | { code: "SVG_SUBTREE_FORCED_ATOMIC"; nodeId: string };
```

Recoverable warnings delivered via `onWarning`:

- `LAYERED_COMPOSITION_MISMATCH` — validation ran and exceeded thresholds
- `LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE` — validator skipped (missing rasterizer or validator threw)

### `LayeredCompositionValidationResult`

| Field             | Type                                    | Description                                            |
| ----------------- | --------------------------------------- | ------------------------------------------------------ |
| `status`          | `"passed" \| "mismatched" \| "skipped"` | Outcome of the comparison                              |
| `differentPixels` | `number`                                | Pixel count that differs between single and composited |
| `differenceRatio` | `number`                                | `differentPixels / totalPixels`                        |
| `thresholdPixels` | `number`                                | Configured pixel threshold                             |
| `thresholdRatio`  | `number`                                | Configured ratio threshold                             |
| `width`           | `number`                                | Rasterized comparison width                            |
| `height`          | `number`                                | Rasterized comparison height                           |

### Layered Helpers

Re-exported from `@boundsvg/core`:

| API                      | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `sortLayersByPaintOrder` | Stable sort of any `{ paintOrder }[]` into back-to-front order           |
| `formatLayerFileName`    | Build the canonical `NNN-<sanitized-id>.<ext>` file name used by the CLI |

## Event Handlers {#event-handlers}

`Canvas`, the layout containers (`Flex`, `Grid`, `Box`), `Text`, `TextOnPath`, `Image`, `Path`, `Svg`, `Shape` and `Symbol` accept string-valued event handler props. The inline-level components — `Inline`, `InlineBox`, `InlineRect`, `Ruby`, `Rt` — do not. The string value is a handler reference ID used for hit-testing with `useInteractiveSvg` or `InteractiveBoundSvg`.

| Prop              | Description                      |
| ----------------- | -------------------------------- |
| `onClick`         | Click handler reference          |
| `onDoubleClick`   | Double-click handler reference   |
| `onContextMenu`   | Context menu handler reference   |
| `onPointerDown`   | Pointer down handler reference   |
| `onPointerUp`     | Pointer up handler reference     |
| `onPointerCancel` | Pointer cancel handler reference |
| `onPointerMove`   | Pointer move handler reference   |
| `onPointerEnter`  | Pointer enter handler reference  |
| `onPointerLeave`  | Pointer leave handler reference  |
| `onPointerOver`   | Pointer over handler reference   |
| `onPointerOut`    | Pointer out handler reference    |
| `onMouseDown`     | Mouse down handler reference     |
| `onMouseUp`       | Mouse up handler reference       |
| `onMouseMove`     | Mouse move handler reference     |
| `onMouseEnter`    | Mouse enter handler reference    |
| `onMouseLeave`    | Mouse leave handler reference    |
| `onMouseOver`     | Mouse over handler reference     |
| `onMouseOut`      | Mouse out handler reference      |
| `onTouchStart`    | Touch start handler reference    |
| `onTouchEnd`      | Touch end handler reference      |
| `onTouchMove`     | Touch move handler reference     |

All handler props are `string` type.

`useInteractiveSvg` and `InteractiveBoundSvg` associate each pointer ID with
the node hit by its original pointer-down event. A cancellation is dispatched
to that original node exactly once. If the browser emits both `pointercancel`
and `lostpointercapture` for the same pointer, the second event does not
dispatch another `onPointerCancel` callback.

## Standalone Functions

Top-level functions that use a shared default Engine instance. The default engine must be initialized before calling render functions.

### `initAsync(options?)`

Initialize the default engine with real WASM (async). Loads WASM, registers fonts, and configures the engine.

```ts
await initAsync({ fonts: [...] });
```

### `init(options)`

Initialize the default engine synchronously with pre-configured `EngineOptions` (for mock/test usage).

### `renderToSvg(input, options?)`

Render using the default engine (sync). Throws if the default engine is not initialized.

```ts
const svg = renderToSvg(node);
```

### `renderToPng(input, options?)`

Render to PNG using the default engine (sync).

```ts
const png = renderToPng(node, { scale: 2 });
```

### `renderToWebp(input, options?)`

Render to a lossless WebP using the default engine (sync).

```ts
const webp = renderToWebp(node, { scale: 2 });
```

### `renderToAnimatedWebp(input, options)`

Render a declarative animation to an animated WebP using the default engine.

```ts
const webp = renderToAnimatedWebp(node, {
  durationMs: 2000,
  fps: 20,
  iterations: "infinite",
});
```

### `renderToAnimatedGif(input, options)`

Render a declarative animation to an animated GIF using the default engine.

```ts
const gif = renderToAnimatedGif(node, {
  durationMs: 2000,
  fps: 20,
  iterations: 1,
});
```

### `renderToIR(input, options?)`

Render to intermediate representation for inspection or hit-testing.

### `renderToLayoutTree(input, options?)`

Render to the pre-animation layout tree. Its options do not include `timeMs`.

### `renderToTextOutlines(input, options?)`

Render text elements as outlined SVG paths using the default engine.

### `renderFrames(input, options)`

Use the default engine's prepared batch sampler. It returns the same
single-use `Iterable<Frame>` as `engine.renderFrames`.

### `createImageLoader(fetchImage)`

Creates an image loader that coalesces concurrent loads of the same URL into a single fetch (single-flight) and retains successful results. The fetch implementation is injected: core itself never performs network I/O, so how bytes are obtained (HTTP, file system, bundler asset) stays a caller decision. `@boundsvg/browser` ships `createBrowserImageLoader`, a `globalThis.fetch` based implementation.

```ts
import { createImageLoader } from "@boundsvg/core";
import { readFile } from "node:fs/promises";

const imageLoader = createImageLoader(async (url) => ({
  data: new Uint8Array(await readFile(new URL(url))),
  mediaType: "image/png",
}));

const { data, mediaType } = await imageLoader.load("file:///assets/logo.png");
```

| Method         | Description                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(url)`    | Resolves image bytes and media type. Concurrent calls for the same URL share one fetch; failures are not cached, so the next call retries                                             |
| `asResolver()` | Returns a resolver compatible with `inlineExternalImages` (`@boundsvg/core/svg`). Load failures resolve to `null` and appear in the inliner's `failed` list; `FatalError` is rethrown |
| `clear()`      | Forgets cached and in-flight entries so subsequent loads fetch again. Fetches already in flight still settle for their original callers                                               |

## Scene inspection

`inspectScene` is available from the package root. Import the lower-level bbox
collector and complete inspection types from `@boundsvg/core/inspect`.

```ts
import { inspectScene } from "@boundsvg/core";
import { collectInspectionBBoxes } from "@boundsvg/core/inspect";

const inspection = inspectScene(engine, vnode);
const bboxes = collectInspectionBBoxes(inspection.ir);
```

`inspectScene(engine, input, options?)` returns the layout tree, sampled IR, text map, handler map, node type map, bbox list, recoverable warnings, node ID validation result, and summary stats. Each bbox includes pre-transform `layoutBBox`, transformed corner points in `transformBox`, and their world-space axis-aligned `visualBBox`. Use it for CI checks, internal asset validation tools, or editor panels that need positioned geometry rather than rendered bytes.

See [Choosing an API](/reference/api-selection) for bbox semantics, animation sampling, and cost.

## `@boundsvg/core/vnode`

Import this subpath for immutable VNode traversal and template transforms.

```ts
import {
  replaceTextById,
  walkVNode,
  withNodeIdPrefix,
} from "@boundsvg/core/vnode";

walkVNode(vnode, ({ node, path }) => {
  console.log(path.join("."), node.type);
});

const localized = replaceTextById(vnode, "title", "Updated title");
const embedded = withNodeIdPrefix(localized, "invoice-preview:");
```

| Utility            | Use case                                                       |
| ------------------ | -------------------------------------------------------------- |
| `walkVNode`        | Visit every non-string VNode with its path and parent          |
| `mapVNode`         | Build immutable transforms over a VNode tree                   |
| `cloneVNode`       | Copy a VNode tree before applying app-local changes            |
| `findVNodeById`    | Find an explicit `id` in a template                            |
| `collectTextNodes` | List text nodes for localization or content editing            |
| `replaceTextById`  | Swap the children of a `Text` node with a stable explicit `id` |
| `withNodeIdPrefix` | Prefix explicit IDs before composing multiple generated scenes |

## Error Handling

### Fatal Errors (throw)

- WASM initialization failure
- SVG/PNG generator fatal errors
- Unsupported property values (e.g., `lineHeight="normal"`)
- Structural constraint violations (non-Canvas root, nested Canvas, non-string Text children)
- Duplicate `id` in the same tree

### Recoverable Errors (warning + fallback)

- Font not found → try fallback chain → substitute with replacement glyph (□)
- Image load failure → render placeholder rectangle
- `fit="shrink"` cannot fit → `overflow.type="cannot_fit"`, render at minimum font size

## WASM Initialization

### `initWasm(wasmModule)`

Initialize the WASM module. Called automatically by `createEngineAsync()`.

Calling `initWasm()` again with the same module instance is idempotent. Once a
module has been installed, passing a different module instance throws a
`FatalError` with code `WASM_ALREADY_INITIALIZED`; the installed singleton is
not replaced.

Fonts are registered on the engine, not on the WASM module. Pass them to `createEngineAsync({ fonts: [...] })`, or add them later with [`engine.registerFonts()`](#createengineasync-options).
