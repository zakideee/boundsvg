---
title: "@boundsvg/react"
---

# @boundsvg/react

React integration layer for boundsvg. Provides Provider, hooks, and components for using boundsvg in React applications.

## Provider

### `<BoundSvgProvider>`

Context provider that initializes WASM, loads fonts, and manages Engine lifecycle.

```tsx
import { BoundSvgProvider } from "@boundsvg/react/provider";

<BoundSvgProvider
  config={{
    fonts: [
      {
        alias: "NotoSansJP",
        weight: 400,
        style: "normal",
        source: "/fonts/NotoSansJP.ttf",
      },
    ],
    defaultCommonOptions: { debug: false },
  }}
  fallback={<div>Loading...</div>}
>
  <App />
</BoundSvgProvider>;
```

### BoundSvgConfig

| Property               | Type                           | Required | Description                                                                                     |
| ---------------------- | ------------------------------ | -------- | ----------------------------------------------------------------------------------------------- |
| `fonts`                | `FontDefinition[]`             | Yes      | Font definitions. `source` accepts URL string, `URL`, or `Uint8Array`                           |
| `wasm`                 | `WasmModule`                   | No       | Pre-loaded WASM module. Auto-loaded from `@boundsvg/browser` if omitted                         |
| `worker`               | `WorkerConfig`                 | No       | Enable Worker rendering: `{ mode: "prefer" \| "required"; url?: URL; timeoutMs?; onFallback? }` |
| `fontLoader`           | `FontLoader`                   | No       | Override how font bytes are fetched                                                             |
| `fontFetchOptions`     | `RequestInit`                  | No       | Passed to the default font fetch                                                                |
| `geometries`           | `Array<{ id, doc }>`           | No       | Geometry registry entries loaded at engine creation                                             |
| `symbols`              | `Array<{ id, def }>`           | No       | Symbol registry entries loaded at engine creation                                               |
| `defaultCommonOptions` | `BoundSvgDefaultCommonOptions` | No       | Compile/output-common defaults only; artifact-specific options stay on each component or hook   |

`defaultCommonOptions` accepts only `CompileOptions & OutputCommonOptions`.
SVG namespace/metadata, `timeMs`, playback/reduced-motion, and raster-only
fields must be passed to the individual component or hook. Configuration keys
are checked synchronously before font fetching, Engine creation, Worker
creation, or effects begin. The removed `defaultRenderOptions` and legacy
default fields throw `UNSUPPORTED_LEGACY_RENDER_OPTION`; unknown or
artifact-specific default fields throw `UNSUPPORTED_RENDER_OPTION`.

### FontDefinition

| Property | Type                          | Default    | Description                                    |
| -------- | ----------------------------- | ---------- | ---------------------------------------------- |
| `alias`  | `string`                      | —          | Font alias (referenced by `<Text font="...">`) |
| `weight` | `number`                      | `400`      | Font weight                                    |
| `style`  | `"normal" \| "italic"`        | `"normal"` | Font style                                     |
| `source` | `string \| URL \| Uint8Array` | —          | Font data or URL to fetch                      |

### Initialization Flow

**Main-thread mode** (default):

1. Validate config own keys and `defaultCommonOptions` synchronously
2. Fetch each font (if URL) → resolve to `Uint8Array`
3. Use `config.wasm` if provided, otherwise dynamic import `@boundsvg/browser` → `loadWasmModule()`
4. `initWasm(wasmModule)` to initialize core
5. `createEngineAsync({ fonts })` — creates a `BoundSvgEngine` instance and registers all fonts at creation time
6. Set `engine` + `status` in Context

Fonts are resolved before either branch is taken, so a font-fetch failure aborts
before any WASM is loaded.

**Worker mode** (`worker: { mode, url? }`):

1. Validate config own keys and `defaultCommonOptions` synchronously
2. Fetch each font (if URL) on the main thread, as above
3. Create a `WorkerEngine` via `@boundsvg/worker`, transferring the font bytes into it
4. Initialize the Worker (WASM loading + font registration happen inside the Worker)
5. Set `workerEngine` + `status` in Context (`engine` stays `null` on this path)
6. On Worker init failure, `mode: "prefer"` falls back to a main-thread Engine and invokes `onFallback`; `mode: "required"` reports the failure without falling back

**Status transitions:** `idle` → `loading` → `ready` | `error`

**StrictMode safety:** The mount → unmount → mount cycle is handled via a `disposed` flag. Each Engine instance owns its own font registry, so StrictMode re-mount creates a fresh instance without side-effects.

## Hooks

The main-thread static and animated SVG hooks are on the package root. PNG,
Worker, interactive, asset, and inspection hooks live on the subpath named by
each heading. The complete inventory is under [Public Exports](#public-exports).

### `useBoundSvg()`

<sub>`@boundsvg/react/provider`</sub>

Access the Engine instance and status from context. Exactly one of `engine` /
`workerEngine` is non-null once `status === "ready"` — `workerEngine` when the
Worker initialized, `engine` otherwise — including after a `mode: "prefer"`
fallback.

```ts
const { engine, workerEngine, status, error, defaultCommonOptions } =
  useBoundSvg();
```

Throws if called outside `<BoundSvgProvider>`.

### `useRenderToSvg(vnode, options?)`

<sub>`@boundsvg/react`</sub>

Render a VNode tree to SVG reactively.

```ts
const { svg, error, isReady } = useRenderToSvg(vnode, options?);
```

| Return    | Type             | Description              |
| --------- | ---------------- | ------------------------ |
| `svg`     | `string \| null` | Rendered SVG string      |
| `error`   | `Error \| null`  | Rendering error          |
| `isReady` | `boolean`        | Whether SVG is available |

`useMemo`-based — recomputes when the VNode or the resolved render-option **values** change. The VNode passes through a structural comparison first, so a fresh object with identical structure is treated as unchanged and does not re-render. Re-rendering on every React render is typically practical; for very large trees, memoizing the VNode with `useMemo` skips that comparison. Options are merged with `defaultCommonOptions`.

This is a static hook. Animated input requires an explicit `timeMs`.

### `useRenderToAnimatedSvg(vnode, options)`

<sub>`@boundsvg/react`</sub>

Render an independently playing animated SVG on the main thread. Options are
required and must include `playback: { mode: "independent" }`.

```ts
const { svg, error, isReady } = useRenderToAnimatedSvg(vnode, {
  playback: { mode: "independent" },
  reducedMotion: "pause",
});
```

### `useRenderToPng(vnode, options?)`

<sub>`@boundsvg/react/png`</sub>

Render a VNode tree to PNG reactively.

```ts
const { png, dataUrl, error, isReady } = useRenderToPng(vnode, options?);
```

| Return    | Type                 | Description                 |
| --------- | -------------------- | --------------------------- |
| `png`     | `Uint8Array \| null` | PNG binary                  |
| `dataUrl` | `string \| null`     | `data:image/png;base64,...` |
| `error`   | `Error \| null`      | Rendering error             |
| `isReady` | `boolean`            | Whether PNG is available    |

### Synchronous render notifications

Synchronous React render paths collect `onWarning` and
`onPngResolutionAdjusted` notifications while rendering, then deliver them
only after that render generation commits. A generation that React abandons
does not notify the callbacks. Notifications retain their original emission
order; for example, PNG auto-adjustment calls `onPngResolutionAdjusted` before
the corresponding `PNG_RESOLUTION_ADJUSTED` warning reaches `onWarning`, just
as the direct Engine and WorkerEngine paths do.

This commit-phase rule applies to the synchronous hooks and helpers that render
during React evaluation, including `useRenderToSvg`, `useRenderToPng`,
`useRenderAsset`, `useInteractiveSvg`, and `useBoundSvgInspection`.

### `useRenderToSvgAsync(vnode, options?)`

<sub>`@boundsvg/react/worker`</sub>

Render a VNode tree to SVG via the WorkerEngine (off-main-thread). Must be used within `<BoundSvgProvider>` with `worker` enabled.

```ts
const { svg, error, isRendering, isReady } = useRenderToSvgAsync(vnode, options?);
```

| Return        | Type             | Description                          |
| ------------- | ---------------- | ------------------------------------ |
| `svg`         | `string \| null` | Rendered SVG string                  |
| `error`       | `Error \| null`  | Rendering error                      |
| `isRendering` | `boolean`        | Whether a Worker render is in-flight |
| `isReady`     | `boolean`        | Whether SVG is available             |

### `useRenderToAnimatedSvgAsync(vnode, options)`

<sub>`@boundsvg/react/worker`</sub>

The Worker equivalent of `useRenderToAnimatedSvg`. Its required options carry
the same independent playback, base-pose, namespace, metadata, and reduced
motion contract.

```ts
const result = useRenderToAnimatedSvgAsync(vnode, {
  playback: { mode: "independent" },
  nodeIdMetadata: "omit",
});
```

`useRenderToAnimatedSvgAndIrAsync` returns the matching `{ svg, ir }` artifacts
for Worker-backed inspection flows.

### `useRenderToPngAsync(vnode, options?)`

<sub>`@boundsvg/react/worker`</sub>

Render a VNode tree to PNG via the WorkerEngine (off-main-thread). PNG data is transferred (zero-copy) from the Worker. Must be used within `<BoundSvgProvider>` with `worker` enabled.

```ts
const { png, dataUrl, error, isRendering, isReady } = useRenderToPngAsync(vnode, options?);
```

| Return        | Type                 | Description                          |
| ------------- | -------------------- | ------------------------------------ |
| `png`         | `Uint8Array \| null` | PNG binary                           |
| `dataUrl`     | `string \| null`     | `data:image/png;base64,...`          |
| `error`       | `Error \| null`      | Rendering error                      |
| `isRendering` | `boolean`            | Whether a Worker render is in-flight |
| `isReady`     | `boolean`            | Whether PNG is available             |

### `useRenderToLayeredSvgAsync(vnode, options?)` {#userendertolayeredsvgasync}

<sub>`@boundsvg/react/worker`</sub>

Render a VNode tree to a set of SVG layers via the WorkerEngine. Must be used within `<BoundSvgProvider>` with `worker` enabled. See [Layered Export](/guides/layered-export).

```ts
const { result, error, isRendering, isReady } = useRenderToLayeredSvgAsync(
  vnode,
  options?,
);
// result?.layers, result?.manifest, result?.compositionValidation
```

| Return        | Type                       | Description                           |
| ------------- | -------------------------- | ------------------------------------- |
| `result`      | `LayeredSvgResult \| null` | Whole result; `null` until ready      |
| `error`       | `Error \| null`            | Rendering error                       |
| `isRendering` | `boolean`                  | Whether a Worker render is in-flight  |
| `isReady`     | `boolean`                  | Whether a current result is available |

`layers`, `manifest` and `compositionValidation` are fields of `result`, not of
the hook. Options accept [`LayeredSvgOptions`](/api/core#layeredsvgoptions) in
full, `onWarning` included — it is invoked as a callback. Recoverable render
warnings reach `onWarning` only; the per-layer resolver `warnings` stay on each
layer entry inside `result`.

### `useRenderToLayeredPngAsync(vnode, options?)` {#userendertolayeredpngasync}

<sub>`@boundsvg/react/worker`</sub>

Render a VNode tree to a set of PNG layers via the WorkerEngine. PNG bytes are transferred (zero-copy) from the Worker. Must be used within `<BoundSvgProvider>` with `worker` enabled.

```ts
const { result, layerDataUrls, error, isRendering, isReady } =
  useRenderToLayeredPngAsync(vnode, options?);
// result?.layers, result?.manifest, result?.compositionValidation
```

| Return          | Type                       | Description                                              |
| --------------- | -------------------------- | -------------------------------------------------------- |
| `result`        | `LayeredPngResult \| null` | Whole result; `null` until ready                         |
| `layerDataUrls` | `string[] \| null`         | Memoized `data:image/png;base64,...` URLs, one per layer |
| `error`         | `Error \| null`            | Rendering error                                          |
| `isRendering`   | `boolean`                  | Whether a Worker render is in-flight                     |
| `isReady`       | `boolean`                  | Whether a current result is available                    |

`layers`, `manifest` and `compositionValidation` are fields of `result`. Options
accept [`LayeredPngOptions`](/api/core#layeredpngoptions) in full, `onWarning`
included — it is invoked as a callback. Recoverable render warnings reach
`onWarning` only; the per-layer resolver `warnings` stay on each layer entry
inside `result`.

### `useInteractiveSvg(vnode, handlers, options?)`

<sub>`@boundsvg/react/interactive`</sub>

Render a VNode tree with interactive event handling (hitTest, hover, click).

```ts
const { svg, ir, error, isReady, hoverNodeId, containerRef } =
  useInteractiveSvg(vnode, handlers, options?);
```

| Return         | Type                                     | Description                                       |
| -------------- | ---------------------------------------- | ------------------------------------------------- |
| `svg`          | `string \| null`                         | Rendered SVG string                               |
| `ir`           | `IR \| null`                             | Full IR for advanced consumers                    |
| `error`        | `Error \| null`                          | Rendering error                                   |
| `isReady`      | `boolean`                                | Whether rendering succeeded                       |
| `hoverNodeId`  | `string \| null`                         | Currently hovered node ID                         |
| `containerRef` | `(node: HTMLDivElement \| null) => void` | Ref callback for container div                    |
| `textMap`      | `TextMap \| null`                        | Text structure map used by the text-copy features |

## Components

### `<BoundSvg>`

Renders a VNode tree inline using `dangerouslySetInnerHTML`. The SVG generated by the Engine is trusted (no XSS risk).

```tsx
<BoundSvg
  vnode={vnode}
  renderOptions={{ debug: true }}
  className="my-output"
  fallback={<Skeleton />}
/>
```

| Prop            | Type                                       | Description                                          |
| --------------- | ------------------------------------------ | ---------------------------------------------------- |
| `vnode`         | `VNode \| null`                            | VNode tree to render (legacy mode)                   |
| `width`         | `number`                                   | Canvas width (declarative mode)                      |
| `height`        | `number`                                   | Canvas height (declarative mode)                     |
| `background`    | `string`                                   | Canvas background (declarative mode)                 |
| `children`      | `ReactNode`                                | Declarative children (boundsvg phantom components)   |
| `renderOptions` | `RenderSvgOptions`                         | Static SVG options; animated input requires `timeMs` |
| `className`     | `string`                                   | Wrapper div class                                    |
| `fallback`      | `ReactNode`                                | Fallback UI while engine is loading                  |
| `errorFallback` | `ReactNode \| (error: Error) => ReactNode` | Fallback UI when rendering fails                     |

### `<AnimatedBoundSvg>`

Uses the same VNode/declarative-child and fallback props as `<BoundSvg>`, but
calls the animated SVG family on either the main thread or Worker. Its
`renderOptions: RenderAnimatedSvgOptions` prop is required.

```tsx
<AnimatedBoundSvg
  vnode={vnode}
  renderOptions={{
    playback: { mode: "independent" },
    resourceIdPrefix: "preview-0042-",
    reducedMotion: "pause",
  }}
/>
```

### `<InteractiveBoundSvg>`

Renders a VNode tree with pointer event handling (click, hover, context menu). Supports both explicit VNode mode and declarative children mode.

```tsx
<InteractiveBoundSvg
  vnode={vnode}
  handlers={handlerMap}
  renderMode="static"
  renderOptions={{ debug: true }}
  className="interactive-output"
  showPointerCursor={true}
  onHoverChange={(nodeId) => console.log(nodeId)}
  fallback={<Skeleton />}
/>
```

| Prop                | Type                                           | Description                                              |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `vnode`             | `VNode \| null`                                | VNode tree to render (explicit mode)                     |
| `handlers`          | `Map<string, EventCallback>`                   | Handler map for explicit VNode mode                      |
| `width`             | `number`                                       | Canvas width (declarative mode)                          |
| `height`            | `number`                                       | Canvas height (declarative mode)                         |
| `background`        | `string`                                       | Canvas background (declarative mode)                     |
| `children`          | `ReactNode`                                    | Declarative children with function handlers              |
| `renderMode`        | `"static" \| "animated"`                       | Explicitly selects the static or animated SVG family     |
| `renderOptions`     | `RenderSvgOptions \| RenderAnimatedSvgOptions` | Must match `renderMode`; animated mode requires playback |
| `className`         | `string`                                       | Wrapper div class                                        |
| `showPointerCursor` | `boolean`                                      | Show cursor:pointer on interactive elements              |
| `onHoverChange`     | `(nodeId: string \| null) => void`             | Callback when hover state changes                        |
| `fallback`          | `ReactNode`                                    | Fallback UI while engine is loading                      |
| `errorFallback`     | `ReactNode \| (error: Error) => ReactNode`     | Fallback UI when rendering fails                         |
| `onRender`          | `(ir: IR) => void`                             | Called with the IR after each render                     |
| `enableTextCopy`    | `boolean`                                      | Enable the text-copy selection behaviour                 |
| `onTextCopyMenu`    | `(info: TextCopyMenuInfo) => void`             | Called when the text-copy context menu opens             |

Interactive rendering always emits `data-boundsvg-node-id` for hit testing,
even if the supplied SVG options request `nodeIdMetadata: "omit"`. Use a
noninteractive static or animated component for final metadata-free export.

### JSX Phantom Components

Phantom JSX components for building VNode trees in React:

```tsx
import {
  BoundSvg,
  Canvas,
  Inline,
  InlineRect,
  Text,
  TextOnPath,
} from "@boundsvg/react";
```

These create boundsvg VNodes (not DOM elements). See [Components](/components/canvas) for props.

The React `Text` phantom component accepts the complete core `TextProps`
contract, including direct flow layout props:

```tsx
<Text
  font="NotoSansJP"
  fontSizePx={20}
  width={480}
  height={240}
  whiteSpace="pre-wrap"
  tabSize={4}
  flowMinRegionWidthPx={16}
  flowExclusions={[
    { kind: "rect", x: 40, y: 32, width: 112, height: 88, marginPx: 8 },
  ]}
>
  {"見出し\t本文を、障害物の周囲へ直接 flow します。"}
</Text>
```

Exclusion coordinates are relative to the Text frame, and a non-empty
`flowExclusions` array requires explicit positive `width` and `height`.
`flowMinRegionWidthPx` follows the current writing mode's inline axis. See the
[Text flow reference](/components/text#flow-around-exclusions) for all shape
variants and defaults.

The React adapter re-exports the core text composition and path APIs without
adding React-specific layout semantics:

```tsx
<BoundSvg width={480} height={240} background="#071827">
  <Text
    position="absolute"
    left={16}
    top={12}
    font="NotoSansJP"
    fontSizePx={24}
  >
    入力:
    <Inline
      textDecoration={{ line: "underline", color: "#facc15", thicknessPx: 2 }}
    >
      きょう
    </Inline>
    <InlineRect inlineSizePx={2} blockSizePx="line" color="#67e8f9" />
  </Text>
  <TextOnPath
    d="M20 160C120 60 360 60 460 160"
    width={480}
    height={200}
    position="absolute"
    left={0}
    top={32}
    font="NotoSansJP"
    fontSizePx={26}
    startOffsetPx={240}
    textAnchor="middle"
    pathDirection="forward"
    pathNormal="left"
    pathOffsetPx={4}
    pathFit="shrink"
    pathOverflow="ellipsis"
    textDecoration={{ line: "underline", style: "dashed", skipInk: "all" }}
  >
    曲線上の
    <Inline font="JetBrainsMono" color="#facc15" textDecoration="none">
      PATH
    </Inline>
  </TextOnPath>
</BoundSvg>
```

`InlineRect` is childless. `TextOnPath` accepts strings and nested `Inline`
nodes as React children; other elements, newlines, and tabs are errors. Inline
font/shaping props, color, stroke/shadow categories, and decoration use the
same inheritance and replacement rules as core. It supports one open or
authored-closed path with explicit direction/normal, path fitting, ellipsis,
mixed paint, and curved filled decoration. `InlineBox`, `InlineRect`, `Ruby`,
`Rt`, vertical writing, bidi, and effective decoration combined with
`animateUnits` remain unsupported.

The `renderOptions.textPathMode` prop only selects merged or per-glyph outline
grouping—it is not the `TextOnPath` layout component.

React does not add an IME API. Keep composition and candidate state in the
application, build the corresponding `Text`/`Inline`/`InlineRect`/`Box` tree,
and re-render the full scene when that state changes. See
[Typing and IME composition](/guides/animation#typing-and-ime-composition) and
[Text on an SVG path](/guides/text-and-fonts#text-on-an-svg-path).

## Dual JSX Resolution

boundsvg uses two JSX runtimes simultaneously:

| Purpose                             | JSX Runtime      | Resolution                                                  |
| ----------------------------------- | ---------------- | ----------------------------------------------------------- |
| VNode building (Canvas, Text, etc.) | `@boundsvg/core` | `/** @jsxImportSource @boundsvg/core */` pragma or tsconfig |
| React UI components                 | `react`          | tsconfig `jsxImportSource: "react"`                         |

- React adapter tsconfig: `"jsxImportSource": "react"` (overrides base `@boundsvg/core`)
- VNode builder files: use `/** @jsxImportSource @boundsvg/core */` pragma at file top, or call `createElement("Canvas", {...})` directly
- `@boundsvg/react` exports phantom React components, but the resulting boundsvg nodes are still typed by string literal `type` values internally (`"Canvas"` | `"Flex"` | `"Text"` | ...)

## `@boundsvg/react/inspect`

Use this subpath to read structured scene facts through the Provider engine.

```tsx
import { useBoundSvgInspection } from "@boundsvg/react/inspect";

const { inspection, error, isReady } = useBoundSvgInspection(vnode);
```

`useBoundSvgInspection` renders layout and sampled IR through the Provider engine and returns a `SceneInspection`.

## `@boundsvg/react/debug`

Use this subpath for human-facing visual diagnostics.

```tsx
import {
  BoundSvgDebugOverlay,
  NodeInspectorPanel,
} from "@boundsvg/react/debug";
```

| API                    | Description                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `BoundSvgDebugOverlay` | Draws rich SVG bbox overlays with labels and controlled highlight targets             |
| `NodeInspectorPanel`   | Renders a minimal definition-list panel for bbox, type, handler, and text information |

`BoundSvgDebugOverlay` accepts `labelMode: "none" | "node-id" | "summary" | "metrics"`. The default summary label includes `nodeId`, node type, size, position, depth, and draw order index. Use `selectedNodeId`, `highlightedNodeIds`, or `highlightedBBoxes` to highlight a node or an arbitrary render-tree bbox without making the overlay intercept pointer events.

```tsx
<BoundSvgDebugOverlay
  inspection={inspection}
  labelMode="metrics"
  selectedNodeId={selectedNodeId}
  highlightedBBoxes={[
    { id: "crop", label: "export crop", x: 24, y: 32, w: 240, h: 120 },
  ]}
/>
```

The inspect and debug subpaths are intentionally separate from the root import so production UI bundles can tree-shake editor tooling away when not used.

## `@boundsvg/react/assets`

Use this subpath when React UI needs an asset lifecycle around generated output.

```tsx
import { usePngObjectUrl, useRenderAsset } from "@boundsvg/react/assets";

const { svg, png, dataUrl, compiled } = useRenderAsset(vnode, {
  pngOptions: { scale: 2 },
});
const objectUrl = usePngObjectUrl(png);
```

| API                | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `usePngObjectUrl`  | Creates and revokes a PNG object URL for `<img>` previews or download buttons |
| `useCompiledScene` | Compiles a VNode once so callers can render multiple assets from the same IR  |
| `useRenderAsset`   | Returns compiled scene, SVG string, PNG bytes, and PNG data URL in one hook   |

## Public Exports

Every export of every entry point. Types re-exported from `@boundsvg/core`
(`VNode`, format-specific render options, the `*Props`/`*VNode` families, geometry and animation
types) are listed under the package root because that is where they are re-exported.

```ts
// Package root — components, the sync SVG hook, and VNode conversion
export {
  AnimatedBoundSvg,
  BoundSvg,
  Box,
  Canvas,
  Flex,
  Grid,
  Image,
  Inline,
  InlineBox,
  InlineRect,
  Path,
  Rt,
  Ruby,
  Shape,
  Svg,
  Symbol,
  Text,
  TextOnPath,
  toVNode,
  toVNodeFromChildren,
  useRenderToAnimatedSvg,
  useRenderToSvg,
};
export type {
  AnimatedBoundSvgProps,
  AnimatedSvgPlayback,
  AnimationEasing,
  AnimationKeyframe,
  AnimationSpec,
  AnimationSpring,
  AnimationStepPosition,
  AnimationTransform2D,
  AnyVNode,
  BooleanOp,
  BoundSvgNodeComponent,
  BoundSvgProps,
  BoxProps,
  BoxVNode,
  CanvasProps,
  CanvasVNode,
  ChildFor,
  ChildrenFor,
  DebugOverlayConfig,
  DebugOverlayPart,
  ElasticSegment,
  Engine,
  EngineOptions,
  FlexProps,
  FlexVNode,
  Frame,
  GeometryDoc,
  GeometryNode,
  GeometryViewBox,
  GridProps,
  GridVNode,
  ImageProps,
  ImageVNode,
  InlineBoxProps,
  InlineBoxVNode,
  InlineProps,
  InlineRectProps,
  InlineRectVNode,
  InlineVNode,
  PathProps,
  PathVNode,
  RenderAnimatedSvgOptions,
  RenderFramesOptions,
  RenderPngOptions,
  RenderSvgOptions,
  RenderWebpOptions,
  RtProps,
  RtVNode,
  RubyProps,
  RubyVNode,
  ShapeProps,
  SvgProps,
  SvgVNode,
  SymbolDefinition,
  SymbolProps,
  TextDecoration,
  TextDecorationLine,
  TextOnPathProps,
  TextOnPathVNode,
  TextProps,
  TextUnitAnimation,
  TextVNode,
  Transform2D,
  UseRenderToSvgResult,
  VNode,
  VNodeChild,
  VNodeChildrenArgs,
  VNodeFor,
  VNodeInputChildFor,
  VNodeType,
  WasmModule,
};

// "@boundsvg/react/provider" — engine setup and context
export { BoundSvgProvider, useBoundSvg };
export type {
  BoundSvgConfig,
  BoundSvgContextValue,
  BoundSvgDefaultCommonOptions,
  BoundSvgProviderProps,
  BoundSvgStatus,
  FontDefinition,
  WorkerConfig,
};

// "@boundsvg/react/png" — main-thread PNG
export { useRenderToPng };
export type { UseRenderToPngResult };

// "@boundsvg/react/worker" — Worker-based async rendering
export {
  useRenderToAnimatedSvgAndIrAsync,
  useRenderToAnimatedSvgAsync,
  useRenderToLayeredPngAsync,
  useRenderToLayeredSvgAsync,
  useRenderToPngAsync,
  useRenderToSvgAndIrAsync,
  useRenderToSvgAsync,
};
export type {
  UseRenderToLayeredPngAsyncResult,
  UseRenderToLayeredSvgAsyncResult,
  UseRenderToPngAsyncResult,
  UseRenderToSvgAndIrAsyncResult,
  UseRenderToSvgAsyncResult,
  UseWorkerRenderResult,
};

// "@boundsvg/react/interactive" — hit-testing, events, text copy
export {
  InteractiveBoundSvg,
  toInteractiveVNode,
  toInteractiveVNodeFromChildren,
  useInteractiveSvg,
  useTextCopy,
};
export type {
  BuildMenuInfoParams,
  CopyStatus,
  EventCallback,
  InteractiveBoundSvgProps,
  InteractiveHandlerProps,
  PointerEventInfo,
  SvgPoint,
  TextContextMenuHit,
  TextCopyMenuInfo,
  ToInteractiveVNodeResult,
  UseInteractiveSvgOptions,
  UseInteractiveSvgResult,
  UseTextCopyResult,
};

// "@boundsvg/react/inspect" — structured inspection
export { useBoundSvgInspection };
export type {
  InspectionBBox,
  InspectionRect,
  InspectionStats,
  InspectionTransformBox,
  SceneInspection,
  UseBoundSvgInspectionResult,
};

// "@boundsvg/react/debug" — visual diagnostics
export { BoundSvgDebugOverlay, NodeInspectorPanel };
export type {
  BoundSvgDebugOverlayProps,
  DebugOverlayHighlight,
  DebugOverlayLabelMode,
  NodeInspectorPanelProps,
};

// "@boundsvg/react/assets" — compiled-scene reuse and object URLs
export { useCompiledScene, usePngObjectUrl, useRenderAsset };
export type {
  UseCompiledSceneResult,
  UseRenderAssetOptions,
  UseRenderAssetResult,
};
```
