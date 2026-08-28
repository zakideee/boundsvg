---
title: Layered Export
---

# Layered Export

Layered export splits a single scene into independently painted SVG or PNG
layers. Each layer is an isolated, self-contained file that composes back into
the original when stacked in paint order. Use it when you need to hand off a
rendered scene to another tool — a motion design pipeline, a compositor, a CMS
that treats the background and the text as separate assets — without rebuilding
the layout downstream.

Layered export is a **packaging** operation. Layout, text shaping, and glyph
positioning all happen exactly once inside the engine, identically to
`renderToSvg`. The resolver then walks the intermediate representation and
groups paint operations by their logical layer identity.

Static `transform` props are preserved during layered export. They are applied
after layout, so per-layer `bbox` metadata remains the pre-transform layout box
rather than the transformed visual bounds.

Layered SVG and layered PNG are static-only. If the source contains animation,
pass an explicit `timeMs`; every layer is sampled at that shared time. The
manifest records `animated: true` to describe the source and records the
sampled `timeMs`, but that field does not mean the layer SVGs animate. There is
no animated layered method in 0.3. Layered export does not concatenate frames
or create video; sample multiple times and use an external encoder when needed. See
[Animation](/guides/animation) for the output-mode contract.

## The `layer` prop

`Flex`, `Grid`, `Box`, `Text`, `TextOnPath`, `Image`, `Path`, `Svg`, `Shape` and
`Symbol` accept an optional `layer?: string` prop. `Canvas` and the inline-level
components (`Inline`, `InlineBox`, `InlineRect`, `Ruby`, `Rt`) do not.

```tsx
<Canvas width={320} height={180}>
  <Box
    id="bg"
    layer="background"
    width={320}
    height={180}
    background="#e5e7eb"
  />
  <Box
    id="panel"
    layer="textBox"
    width={240}
    height={84}
    background="#111827"
  />
  <Text
    id="title"
    layer="text"
    font="NotoSansJP"
    fontSizePx={26}
    color="#f9fafb"
  >
    Layered
  </Text>
</Canvas>
```

### Resolution rules

1. **Explicit layer id** — the value on the node itself wins.
2. **Inherited** — a node without `layer` inherits the nearest ancestor's
   layer id. Children can override the inherited id by declaring their own.
3. **Default** — nodes with no explicit or inherited id are placed on a single
   layer named `"default"`. `default` is reserved: passing it explicitly
   normalizes to the same bucket. Empty strings and whitespace-only values are
   ignored and treated as "inherit".

Nodes that request the **same layer id adjacent to each other in paint order**
are merged into one output layer. The same id appearing around a different id
produces distinct segments; it never "wraps around" to join layers that would
otherwise interleave with other content.

```tsx
// Three separate layers — text-a1, box-b1, text-a2 — because the ids alternate
// in paint order even though two of them share the "text" identity.
<Canvas width={280} height={140}>
  <Box id="text-a1" layer="text" width={180} height={52} background="#111827" />
  <Box
    id="box-b1"
    layer="textBox"
    width={220}
    height={52}
    background="#f97316"
  />
  <Box id="text-a2" layer="text" width={140} height={52} background="#2563eb" />
</Canvas>
```

## `renderToLayeredSvg`

```ts
const result = engine.renderToLayeredSvg(vnode, {
  debug: false,
  textPathMode: "merged",
  timeMs: 400,
  nodeIdMetadata: "omit",
  validateComposition: { enabled: true },
});
```

| Field                   | Type                                                                  | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `width`                 | `number`                                                              | Canvas width in px                                                          |
| `height`                | `number`                                                              | Canvas height in px                                                         |
| `layers`                | `LayerEntry[]`                                                        | One `{ id, svg, bbox, nodeIds, mode, paintOrder, warnings, ... }` per layer |
| `compositionValidation` | `LayeredCompositionValidationResult?`                                 | Present only when `validateComposition.enabled === true`                    |
| `manifest`              | `{ width, height, animated?, timeMs?, layers: LayerManifestEntry[] }` | Same layer metadata without the `svg` payload                               |

Each layer is a full SVG document sized to the canvas. Stacking the layers in
ascending `paintOrder` reproduces the static `renderToSvg` result at the same
`timeMs` pixel-for-pixel.

In 0.3, remove the old `animation` option from layered calls. The manifest's
legacy-named `animated` flag remains read-only source information; do not use it
as evidence that a layer contains CSS playback. `LayeredPngOptions` also rejects
SVG-only `resourceIdPrefix` and `nodeIdMetadata`.

### `LayerEntry` fields

| Field                 | Type                                      | Description                                                                                                                    |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`                  | `string`                                  | Resolved layer id (never empty; `"default"` when unspecified)                                                                  |
| `svg`                 | `string`                                  | Full SVG document for this layer                                                                                               |
| `bbox`                | `{ x, y, width, height }`                 | Union bbox of the nodes painted into this layer (px, scene-space)                                                              |
| `nodeIds`             | `string[]`                                | Source `NodeId`s assigned to the layer (sorted)                                                                                |
| `nodeMeta`            | `Record<string, Record<string, string>>?` | Per-node `meta` for the nodes in this layer                                                                                    |
| `parts`               | `LayerManifestPart[]?`                    | Addressable shape parts, when `emitPartIds` is on                                                                              |
| `mode`                | `"independent" \| "atomic"`               | `atomic` when any [Compositing islands](#compositing-islands) trigger applies to this layer's content; `independent` otherwise |
| `paintOrder`          | `number`                                  | Lowest `ir.drawOrder` index inside the layer, or `0` if it draws nothing. Ascending = back-to-front                            |
| `collapsedFromLayers` | `string[]?`                               | Other logical layer ids that were absorbed when `mode === "atomic"`                                                            |
| `warnings`            | `LayerWarning[]`                          | Resolver diagnostics (see below)                                                                                               |

## `renderToLayeredPng`

Produces the same structure, but each layer carries `png: Uint8Array` plus
`pixelWidth` / `pixelHeight` at the top level. The PNG pipeline runs once per
layer through resvg; scaling is capped by the same 3 840 px long-edge /
8.3 M-pixel limits as `renderToPng`.

```ts
const result = engine.renderToLayeredPng(vnode, { scale: 2 });
// result.layers[0].png is a zero-copy Uint8Array
```

boundsvg never composites a raster background into a layer: `rasterBackground`
is intentionally not supported, because a background color belongs on an explicit
background layer so it round-trips through the manifest. A `Canvas background`
still paints edge-to-edge into the `default` layer, so that layer's PNG carries
the background, alpha included. Put it on its own layer if you want it
separable.

## Compositing islands

Some visual effects cannot be split between layers without changing pixels.
When the resolver detects one, it collapses the affected subtree into a single
**atomic** layer.

| Trigger                                                                        | Warning code                     | Behavior                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------ |
| `<Svg>` subtree (always)                                                       | `SVG_SUBTREE_FORCED_ATOMIC`      | Entire `<Svg>` becomes one layer                                                     |
| `Shape` or `Symbol` node (always)                                              | _(none)_                         | The layer becomes atomic; adjacent same-layer siblings merge into it                 |
| `overflow="clip"` on a group, or an `Image` with `borderRadius`                | `CLIP_FORCED_ATOMIC`             | Subtree becomes one layer                                                            |
| `opacity !== 1` on any node, or an `animate` track with any `opacity` keyframe | `PARENT_OPACITY_PREVENTED_SPLIT` | The layer becomes atomic; children and adjacent same-layer siblings collapse into it |
| `boxShadow`                                                                    | `BOX_SHADOW_FORCED_ATOMIC`       | Subtree becomes one layer                                                            |
| Descendants with a different `layer` id inside any atomic group                | `CROSSES_COMPOSITING_ISLAND`     | Their ids appear in `collapsedFromLayers`                                            |

**`mode` is the reliable signal; `warnings` is not.** A layer is atomic whenever
any row above applies, but a warning is only recorded for some of them:

- `Shape` and `Symbol` never warn; they match none of the warned conditions.
- `PARENT_OPACITY_PREVENTED_SPLIT` is recorded only when a descendant asked for a
  _different_ layer id. A translucent group whose children stay on its own layer
  is still `atomic`, with an empty `warnings` array.
- A leaf node carrying `opacity` (`Path`, `Text`, `Image`, `TextOnPath`, or a
  childless `Box` / `Flex` / `Grid`) is emitted as an IR group, so it is atomic too, again with an
  empty `warnings` array.

These are resolver-time facts, not user errors; the composition is still
pixel-accurate, you just don't get the per-layer separation you asked for.
Branch on `layer.mode === "atomic"` to decide whether to restructure the scene
(e.g. hoist `boxShadow` onto a sibling, or move the offending child out of a
clipped parent), and read `warnings` for the explanation when there is one.

## Composition validation

Opt in by passing `validateComposition: { enabled: true }`. The engine
re-rasterizes the single-SVG reference and the layered composite, then reports
a pixel diff:

```ts
const result = engine.renderToLayeredSvg(vnode, {
  validateComposition: {
    enabled: true,
    maxDifferentPixels: 16,
    maxDifferenceRatio: 0.0001,
  },
  onWarning: (warning) => console.warn(warning.code, warning.message),
});

if (result.compositionValidation?.status === "mismatched") {
  console.warn("Layers do not recompose to the single-SVG reference");
}
```

| Option               | Default | Description                                                         |
| -------------------- | ------- | ------------------------------------------------------------------- |
| `enabled`            | `false` | Required to run validation                                          |
| `maxDifferentPixels` | `0`     | Pixel count at or below which `status === "passed"`                 |
| `maxDifferenceRatio` | `0`     | Ratio (differing pixels / total pixels) at or below which it passes |

The result is one of:

| Status         | Meaning                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| `"passed"`     | Layers recompose within thresholds                                                        |
| `"mismatched"` | Exceeds thresholds — emits `LAYERED_COMPOSITION_MISMATCH` via `onWarning`                 |
| `"skipped"`    | Validator unavailable in this engine — emits `LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE` |

Validation requires a WASM engine built with the rasterization feature
(`createEngineAsync` in Node.js or via `@boundsvg/browser/wasm`). Engines
without `svgToPngFn` silently skip validation and surface the
`LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE` warning.

## React hooks

Off-main-thread rendering is available through
[`useRenderToLayeredSvgAsync`](/api/react#userendertolayeredsvgasync) and
[`useRenderToLayeredPngAsync`](/api/react#userendertolayeredpngasync). Both
require a `<BoundSvgProvider>` with `worker` enabled in its `config`. The PNG hook also returns a memoized
`layerDataUrls: string[] | null` for direct `<img src>` use: null whenever no
current result is available: before the first render, while new input is in
flight, and on error.

```tsx
const { result, isRendering } = useRenderToLayeredSvgAsync(vnode, {
  validateComposition: { enabled: true },
});
// result?.layers, result?.manifest, result?.compositionValidation
```

## CLI

`boundsvg export --format layered-svg` and `--format layered-png` emit a
directory instead of a single file:

```bash
boundsvg export \
  --format layered-svg \
  --input card.scene.json \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf \
  --output out/card.layers
```

```
out/card.layers/
├── manifest.json
├── 000-background.svg
├── 001-textBox.svg
└── 002-text.svg
```

File names follow `NNN-<sanitized-id>.<ext>`, where `NNN` is the layer's
zero-padded position in the back-to-front `layers` array: its index, not its
`paintOrder` value. `paintOrder` is the layer's lowest index into `ir.drawOrder`,
which is a sequence of _draw operations_, not of layers: one node can emit several
(a `Box` with a background and a border), and some entries belong to no layer at
all (a split container that carries event handlers). So the index and `paintOrder`
can diverge; do not derive one from the other; join on each layer's `fileName`. The id is reduced to `[A-Za-z0-9_-]` with `-` replacing anything else and runs of `-` collapsed to one;
case is preserved, as `001-textBox.svg` above shows. An id with no allowed
characters becomes `-`, not empty (`日本語` → `001--.svg`); the `layer` fallback in
`formatLayerFileName` is unreachable from a rendered result, because a resolved
layer id is never empty.

`manifest.json` carries each layer's in-memory metadata plus a `fileName`: join
on that rather than rebuilding the name. Its top level is `width` / `height` /
`layers`, and `layered-png` adds `pixelWidth` / `pixelHeight`; the in-memory
manifest's `animated` / `timeMs` are not written. stdout output is not supported
for layered formats.

See [CLI Diagnostics — Export Reports](/api/cli#export-reports) for the
shared export flags.

## Related APIs

- [`@boundsvg/core` Engine](/api/core#engine-methods) — `renderToLayeredSvg`,
  `renderToLayeredPng`, `LayeredSvgOptions`, `LayeredPngOptions`,
  `LayeredCompositionValidationOptions`
- [`@boundsvg/react/worker`](/api/react#hooks) — `useRenderToLayeredSvgAsync`,
  `useRenderToLayeredPngAsync`
- [`@boundsvg/browser`](/api/browser) — `layeredPngToDataUrls`,
  `layeredPngToBlobs`, `layeredSvgToDataUrls`, `composeLayeredSvgInline`
- [CLI](/api/cli) — `--format layered-svg`, `--format layered-png`
