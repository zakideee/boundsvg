# @boundsvg/core

Core layout engine for boundsvg — JSX to SVG/PNG/WebP/GIF rendering pipeline.

All text shaping, measurement, layout, and rasterization run inside WASM. No browser DOM or OS fonts required.

## Installation

```bash
npm install @boundsvg/core
```

## Usage

```tsx
import { Box, Canvas, Text, createEngineAsync } from "@boundsvg/core";

const engine = await createEngineAsync({
  fonts: [{ alias: "Inter", weight: 400, style: "normal", data: fontBuffer }],
});

const svg = engine.renderToSvg(
  <Canvas width={600} height={400} background="#fff">
    <Box padding={20}>
      <Text font="Inter" fontSizePx={24} color="#333">
        Hello, boundsvg!
      </Text>
    </Box>
  </Canvas>,
);
```

Compile once when several outputs share one layout:

```ts
const compiled = engine.compile(vnode);
const svg = engine.renderCompiledToSvg(compiled);
const png = engine.renderCompiledToPng(compiled, { scale: 2 });
const inspectionIr = engine.snapshotCompiledIR(compiled);
```

`CompiledScene` is an opaque, immutable runtime artifact owned by the exact
`Engine` that created it. It exposes readonly `width`, `height`, and
`textPathMode` metadata; it has no public `.ir`. Do not clone, persist,
transport, or construct it as a plain object. Use `snapshotCompiledIR` for a
detached editable inspection copy, which is not accepted by compiled render
methods. Forged values fail with `COMPILED_SCENE_INVALID`, and authentic
artifacts passed to another Engine fail with `COMPILED_SCENE_WRONG_ENGINE`.

## When to use the utility entry points

```ts
import { inspectScene } from "@boundsvg/core";
import { collectInspectionBBoxes } from "@boundsvg/core/inspect";
import { replaceTextById, withNodeIdPrefix } from "@boundsvg/core/vnode";

const inspection = inspectScene(engine, vnode);
const bboxes = collectInspectionBBoxes(inspection.ir);
console.table(
  inspection.bboxes.map(({ nodeId, drawIndex, w, h }) => ({
    nodeId,
    drawIndex,
    w,
    h,
  })),
);
const localized = replaceTextById(vnode, "headline", "Hello");
const embedded = withNodeIdPrefix(localized, "preview:");
```

- `inspectScene` is the high-level read API for build tools, CI checks, and editors that need layout, sampled IR, positioned bboxes, warnings, lookup maps, and node ID validation in one call.
- `@boundsvg/core/inspect` contains the lower-level bbox collector and the complete inspection type surface.
- `@boundsvg/core/vnode` is for template transforms such as localization, composing multiple generated scenes, and prefixing explicit node IDs before embedding.

See [Choosing an API](../../apps/docs/reference/api-selection.md) for the coordinate space, animation sampling, and cost of each read API.

## JSX Runtime

This package exposes a `@boundsvg/core/jsx-runtime` entry for use with `jsxImportSource`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@boundsvg/core"
  }
}
```

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
