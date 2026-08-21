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
  defaultRenderOptions: { debug: false },
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

The `<BoundSvg>` component is a convenience wrapper that automatically selects sync (`useRenderToSvg`) or async (`useRenderToSvgAsync`) rendering based on the Provider configuration, and injects the SVG via `dangerouslySetInnerHTML`:

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
