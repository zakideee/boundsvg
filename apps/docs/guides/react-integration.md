---
title: React Integration
---

# React Integration

The `@boundsvg/react` package provides a Provider, hooks, and components for using boundsvg in React applications.

## Setup

### 1. Install Dependencies

```bash
pnpm add @boundsvg/core @boundsvg/react @boundsvg/browser
```

### 2. Configure BoundSvgProvider

Wrap your app with `BoundSvgProvider` to initialize WASM and register fonts:

```tsx
import {
  BoundSvgProvider,
  type BoundSvgConfig,
} from "@boundsvg/react/provider";

const config: BoundSvgConfig = {
  fonts: [
    {
      alias: "NotoSansJP",
      source: "/fonts/NotoSansJP-Regular.ttf",
      weight: 400,
      style: "normal",
    },
    {
      alias: "NotoSansJP",
      source: "/fonts/NotoSansJP-Bold.ttf",
      weight: 700,
      style: "normal",
    },
  ],
  defaultCommonOptions: { debug: false },
};

function App() {
  return (
    <BoundSvgProvider config={config} fallback={<div>Loading fonts...</div>}>
      <MyComponent />
    </BoundSvgProvider>
  );
}
```

The provider handles:

- WASM module loading (auto-imported from `@boundsvg/browser` if not provided)
- Font fetching and registration
- Engine lifecycle management

`defaultCommonOptions` accepts compile and output-common defaults only.
Namespace/metadata, sampling time, animated playback/reduced-motion, and
raster-only options belong on each component or hook call. Removed, unknown,
or artifact-specific Provider defaults fail synchronously before fonts, an
Engine, or a Worker are initialized.

Status transitions: `idle` → `loading` → `ready` | `error`

## Rendering SVG

Use the `useRenderToSvg` hook for reactive SVG rendering:

One file compiles with one JSX runtime. In a component file that already uses
React JSX, build the scene with the function API (or author the scene JSX in a
separate file with the `@boundsvg/core` `jsxImportSource` pragma and import it):

```tsx
import { useRenderToSvg } from "@boundsvg/react";
import { Canvas, Flex, Text } from "@boundsvg/core";

function MyComponent() {
  const vnode = Canvas(
    { width: 400, height: 200 },
    Flex(
      { direction: "column", alignItems: "center", justifyContent: "center" },
      Text(
        { font: "NotoSansJP", fontSizePx: 24, color: "#333333" },
        "Hello, boundsvg!",
      ),
    ),
  );

  const { svg, error, isReady } = useRenderToSvg(vnode);

  if (!isReady) return <div>Rendering...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div dangerouslySetInnerHTML={{ __html: svg! }} />;
}
```

::: tip
Re-rendering on every React render is typically practical. For heavy trees, memoize the VNode with `useMemo`.
:::

## Rendering PNG

Use the `useRenderToPng` hook for PNG output:

```tsx
import { useRenderToPng } from "@boundsvg/react/png";

function PngPreview({ vnode }) {
  const { dataUrl, error, isReady } = useRenderToPng(vnode, { scale: 2 });

  if (!isReady) return <div>Rendering...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <img src={dataUrl!} alt="Rendered output" />;
}
```

## Using the BoundSvg Component

The `<BoundSvg>` component renders through the shared async path on both main and Worker, then injects the SVG via `dangerouslySetInnerHTML`. Main rendering starts in a later task and still blocks while synchronous WASM runs. The previous same-owner SVG stays visible during updates by default:

```tsx
import { BoundSvg } from "@boundsvg/react";

function Preview({ vnode }) {
  return (
    <BoundSvg
      vnode={vnode}
      renderOptions={{ debug: true }}
      className="svg-preview"
      fallback={<div>Loading...</div>}
    />
  );
}
```

`BoundSvg` is static. If `vnode` contains animation, pass an explicit
`timeMs`. Use `AnimatedBoundSvg` for self-animating SVG:

```tsx
import { AnimatedBoundSvg } from "@boundsvg/react";

function AnimatedPreview({ vnode }) {
  return (
    <AnimatedBoundSvg
      vnode={vnode}
      renderOptions={{
        playback: { mode: "independent" },
        nodeIdMetadata: "include",
        reducedMotion: "pause",
      }}
    />
  );
}
```

Keep `nodeIdMetadata: "include"` for an inspection or hit-testing preview and
use `"omit"` on a separate final-export call. Interactive React APIs force it
to `"include"` because their event routing depends on those attributes.

## Async hooks and migration

The seven async render hooks live at `@boundsvg/react/async`; the former
`@boundsvg/react/worker` entry has been removed. The same hooks run with a main
Provider or with `worker: { mode: "prefer" }`. Worker preference falls back only
if initialization fails. Runtime render errors, timeouts, and crashes propagate.

```tsx
import { useRenderToSvgAsync } from "@boundsvg/react/async";

function AsyncPreview({ vnode, revision = 0 }) {
  const result = useRenderToSvgAsync(vnode, { scale: 1 }, { revision });
  if (result.svg !== null) {
    return (
      <div
        aria-busy={result.isRendering}
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    );
  }
  if (result.error) return <p>{result.error.message}</p>;
  return <p>Rendering...</p>;
}
```

`status` describes the latest input: `idle`, `rendering`, `success`, or `error`.
`isReady` is true only for the latest success. A retained previous result has
`isStale: true` while rendering or after failure. To clear output during updates,
pass `{ retainPreviousResult: false }` as the third hook argument or in a
component's `executionOptions` prop. The same control object accepts `onError`,
which runs once after a failed generation commits.

Keep VNodes and nested options stable using state or correctly dependent
`useMemo` values. Async inputs use immutable identity and shallow option values;
in-place mutations require a revision change. Callback-only updates do not
request another render. Core resource registration invalidates dependent React
hooks, while Provider `resourcesRevision` explicitly replaces resources changed
in place. See the [complete execution contract](/api/react#shared-async-execution).

For SSR and static output, initialize a Core Engine and call its synchronous
render methods. Provider initialization is effect-based, and async hooks remain
idle during SSR; the Provider does not automatically become ready on the server.

## Using phantom components

`@boundsvg/react` re-exports all boundsvg components for convenience:

```tsx
import { Canvas, Flex, Text, Box, Image, Path } from "@boundsvg/react";
```

These create boundsvg VNodes (not DOM elements). Use the `/** @jsxImportSource @boundsvg/core */` pragma in files that build VNode trees, or call `createElement()` directly:

```ts
import { createElement } from "@boundsvg/core";

const vnode = createElement(
  "Canvas",
  { width: 400, height: 200 },
  createElement("Text", { font: "NotoSansJP", fontSizePx: 24 }, "Hello"),
);
```

## Dual JSX

When using boundsvg in a React app, you work with two JSX runtimes:

| Purpose                          | JSX Runtime      | Configuration                                        |
| -------------------------------- | ---------------- | ---------------------------------------------------- |
| VNode trees (Canvas, Text, etc.) | `@boundsvg/core` | `/** @jsxImportSource @boundsvg/core */` file pragma |
| React UI (div, button, etc.)     | `react`          | tsconfig `jsxImportSource: "react"`                  |

Your tsconfig should use `"jsxImportSource": "react"` as the base. Add the `@boundsvg/core` pragma at the top of files that construct VNode trees.
