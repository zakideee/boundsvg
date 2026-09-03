---
title: Debugging & Diagnostics
---

# Debugging & Diagnostics

Use the debugging utilities when an SVG looks different from the layout you expected, when multiple generated scenes are composed into one document, or when CI needs to reject unstable node IDs before assets are released.

## Visual Bounds

The fastest first check is the render-time debug overlay:

<!--@include: ../_generated/debug-bbox.md-->

This uses the same WASM layout and IR path as normal rendering. It is useful for checking element bounds, nesting depth, overflow, and whether generated IDs are stable enough to target later.

## Programmatic Inspection

Use `inspectScene` in Node.js tools, build scripts, or CI.

```ts
import { inspectScene } from "@boundsvg/core";

const inspection = inspectScene(engine, vnode, { textPathMode: "merged" });

if (!inspection.nodeIds.valid) {
  throw new Error("Duplicate boundsvg node IDs found");
}

console.table(
  inspection.bboxes.map(({ nodeId, type, x, y, w, h, depth, drawIndex }) => ({
    nodeId,
    type,
    x,
    y,
    w,
    h,
    depth,
    drawIndex,
  })),
);
```

`inspectScene()` returns the layout tree, IR, `textMap`, `handlerMap`, `nodeTypeMap`, bbox list, recoverable warnings, and summary stats. It does not run a TypeScript-side text engine; it reads the result produced by the normal WASM render pipeline.

## Diagnostic fields and ownership

`FatalError` and `RecoverableError` use severity-specific contracts. Fatal
diagnostics require `code` and `message`; recoverable diagnostics additionally
require a non-empty `fallback` and a closed `stage`. Optional `nodeId` and
`context` fields are preserved across Node, browser, and Worker routes.

Construct diagnostics with an explicit options object:

```ts
new FatalError("ASSET_INVALID", "Asset data is invalid", {
  stage: "validate",
  nodeId: "hero",
  context: { assetKind: "image" },
});

new RecoverableError("ASSET_PLACEHOLDER", "Asset could not be decoded", {
  fallback: "rendered a placeholder",
  stage: "ir",
  nodeId: "hero",
  context: { assetKind: "image" },
});
```

Do not place `severity`, `code`, `message`, `fallback`, `stage`, or `nodeId` at
the root of `context`. They are reserved diagnostic fields. The old positional
constructor form and severity-less serialized objects are not accepted.

Warnings are mutable inspection values, but independently owned consumers do
not share an object or context identity. A warning callback may annotate its
value without changing `IR.warnings`, a compiled scene, or another callback.
Warning order follows production order: native WASM warnings first, followed
by warnings from later TypeScript-owned phases. Duplicate events are retained.

## Scene document structural failures

`decodeSceneDocument()`, `fromSceneDocument()`, direct Engine Scene inputs,
CLI Scene input, and Worker Scene transport share one structural error family.
Every failure is a `FatalError` at stage `validate`, has no node ID, and keeps
the same code, message, and bounded context across those routes.

| Code                                | Message                                                             |
| ----------------------------------- | ------------------------------------------------------------------- |
| `SCENE_DECODE_INVALID_VALUE`        | Scene document contains a value with an invalid structural type.    |
| `SCENE_DECODE_MISSING_FIELD`        | Scene document is missing a required field.                         |
| `SCENE_DECODE_UNKNOWN_DISCRIMINANT` | Scene document contains an unknown discriminant.                    |
| `SCENE_DECODE_UNKNOWN_KEY`          | Scene document contains an unsupported key.                         |
| `SCENE_DECODE_UNSAFE_VALUE`         | Scene document contains a value that is not a safe JSON data value. |
| `SCENE_DECODE_CYCLE`                | Scene document contains a cycle.                                    |
| `SCENE_DECODE_RESOURCE_LIMIT`       | Scene document exceeds a decode resource limit.                     |

`context.path` is an RFC 6901 pointer (the root is an empty string). Other
fields identify only the closed expected/actual category, missing field,
discriminant, key, safety reason, first cycle path, or resource count. Paths
are limited to 512 UTF-8 bytes and copied key or discriminant snippets to 96
UTF-8 bytes; truncation is reported explicitly. Rejected values, Proxy trap
messages, stacks, and full requests are never copied into diagnostics.

## Text layout fatal contract

Text layout failures use one structured contract across render and the six
measurement methods: `layoutTextFlow`, `layoutTextFlowWithExclusions`,
`measureTextBlock`, `shrinkwrapText`, `shrinkwrapFlow`, and
`measureIntrinsicInlineSize`. Every diagnostic carries a closed operation name
in `context.operation`; render uses `renderTextLayout`. Direct Engine calls,
browser WASM, and Worker calls preserve the same code, message, stage, node ID,
and context.

| Code                             | Fixed message                                     | Stage      |
| -------------------------------- | ------------------------------------------------- | ---------- |
| `TEXT_LAYOUT_INPUT_INVALID`      | Text layout request is invalid.                   | `validate` |
| `TEXT_FONT_UNAVAILABLE`          | No requested font is available for text layout.   | `text`     |
| `TEXT_LAYOUT_PREPARATION_FAILED` | Text layout preparation failed.                   | `text`     |
| `TEXT_FIT_INVALID_STEP`          | Text fit step is invalid.                         | `text`     |
| `TEXT_FIT_PROBE_LIMIT`           | Text fit probe limit was exceeded.                | `text`     |
| `TEXT_ELLIPSIS_CANDIDATE_LIMIT`  | Text ellipsis candidate limit was exceeded.       | `text`     |
| `RICH_TEXT_MAX_DEPTH`            | Rich text depth limit was exceeded.               | `validate` |
| `INLINE_RECT_COMPLEXITY_LIMIT`   | Inline rectangle limit was exceeded.              | `text`     |
| `TEXT_REGION_QUERY_INVALID`      | Text region query is invalid.                     | `text`     |
| `TEXT_REGION_PROVIDER_FAILED`    | Text region provider failed.                      | `text`     |
| `TEXT_FLOW_REGION_INVALID`       | Text flow region is invalid.                      | `text`     |
| `TEXT_REGION_QUERY_LIMIT`        | Text region query limit was exceeded.             | `text`     |
| `TEXT_REGION_INTERVAL_LIMIT`     | Text region interval limit was exceeded.          | `text`     |
| `TEXT_LAYOUT_INVARIANT`          | Text layout invariant failed.                     | `text`     |
| `TEXT_LAYOUT_OUTPUT_INVALID`     | Text layout transport returned an invalid result. | `wasm`     |
| `TEXT_LAYOUT_PANIC`              | Text layout failed unexpectedly.                  | `wasm`     |
| `TEXT_LAYOUT_WASM_FAILED`        | Text layout WASM transport failed.                | `wasm`     |
| `TEXT_LAYOUT_TRANSPORT_FAILED`   | Text layout transport failed.                     | `engine`   |
| `TEXT_LAYOUT_RESULT_MISSING`     | Text layout result is missing required text data. | `text`     |
| `TEXT_PATH_LAYOUT_UNAVAILABLE`   | Text-on-path layout is unavailable.               | `text`     |

Font availability is decided by the registered Rust font registry, not by a
JavaScript alias precheck. The resolver keeps the authored family order,
ignores empty and generic CSS family names as non-resolving candidates, and
uses the first registered alias with the closest matching face. A missing
primary or unused missing fallback does not fail when another requested alias
resolves. If no requested alias resolves, `TEXT_FONT_UNAVAILABLE` identifies
the first failing effective run with a bounded alias list in `context`.

Recursive rich text accepts a container depth of 48 and rejects depth 49 before
calling a custom producer or WASM. Measurement errors have no node ID; render
errors include an authored node ID when one exists. Both use
`RICH_TEXT_MAX_DEPTH`, stage `validate`, and `context` containing `operation`,
`actual`, and `limit`.

Malformed output context reports a bounded `protocolPath` and a type descriptor
such as `object` or `string(length=N)`, never the rejected value. Raw input,
font bytes, thrown values, panic payloads, and registry contents are not copied
into messages or context.

### Migration from earlier text-layout errors

| Earlier behavior or code                                                            | Current behavior or code                                                                     |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Built-in render or measurement precheck returned `FONT_ALIAS_NOT_REGISTERED`        | Rust registry resolution returns `TEXT_FONT_UNAVAILABLE` only if every requested alias fails |
| Missing-font strings, `TEXT_LAYOUT_FAILED`, or `TEXT_LAYOUT_INVALID`                | `TEXT_FONT_UNAVAILABLE` with run and bounded alias context                                   |
| `TEXT_REGION_PROVIDER_INVALID`                                                      | `TEXT_REGION_QUERY_INVALID`, `TEXT_REGION_PROVIDER_FAILED`, or `TEXT_FLOW_REGION_INVALID`    |
| Six measurement `WASM_INVALID_*_OUTPUT` codes                                       | `TEXT_LAYOUT_OUTPUT_INVALID` with `phase: "decode"` and a safe descriptor                    |
| Render preparation returned `TEXT_NO_LAYOUT`                                        | The exact domain code, usually `TEXT_LAYOUT_PREPARATION_FAILED` or `TEXT_FONT_UNAVAILABLE`   |
| A custom render producer omitted required text layout and returned `TEXT_NO_LAYOUT` | `TEXT_LAYOUT_RESULT_MISSING`                                                                 |
| Text-on-path layout returned `TEXT_NO_LAYOUT`                                       | `TEXT_PATH_LAYOUT_UNAVAILABLE`                                                               |
| A malformed WASM throw was exposed as a generic layout failure                      | `TEXT_LAYOUT_WASM_FAILED`                                                                    |
| An unknown custom producer throw was exposed as a generic layout failure            | `TEXT_LAYOUT_TRANSPORT_FAILED`                                                               |

## Shape operation fatal contract

Shape rendering and the nine low-level operations use one fixed diagnostic
catalog. Every error carries `context.operation`. Standalone operations do not
invent a node ID; rendered `Shape` and `Symbol` nodes preserve their real
`nodeId` and use the operation names `renderShape` and `renderSymbol`.

Boundary failures are distinct from geometry-domain failures:

| Code                            | Fixed message                                  | Stage      | Context detail                       |
| ------------------------------- | ---------------------------------------------- | ---------- | ------------------------------------ |
| `SHAPE_INPUT_INVALID`           | Shape operation input is invalid.              | `validate` | `reason`                             |
| `SHAPE_OUTPUT_INVALID`          | Shape operation returned invalid output.       | `wasm`     | `phase`, and safe decode descriptors |
| `SHAPE_PANIC`                   | Shape operation failed unexpectedly.           | `wasm`     | operation only                       |
| `SHAPE_WASM_FAILED`             | Shape operation WASM transport failed.         | `wasm`     | operation only                       |
| `SHAPE_WASM_CAPABILITY_MISSING` | Required shape WASM capability is unavailable. | `wasm`     | operation only                       |

`SHAPE_INPUT_INVALID` uses only `serializationFailed`, `malformedJson`, or
`invalidRequestShape` as its reason. `SHAPE_OUTPUT_INVALID` uses `serialize`
when Rust cannot safely materialize output and `decode` when Core rejects an
untrusted successful value. Decode context may contain bounded
`protocolPath` and `received` descriptors; it never includes the rejected raw
value. Generated non-finite numbers are serialize failures, not invalid input,
and are not clamped.

The closed geometry-domain codes are:

| Code                                 | Condition                                      |
| ------------------------------------ | ---------------------------------------------- |
| `SHAPE_BOOLEAN_CHILD_COUNT`          | A boolean node has fewer than two children     |
| `SHAPE_PATH_DATA_INVALID`            | SVG path data cannot be parsed                 |
| `SHAPE_PATH_COMMAND_UNSUPPORTED`     | Path data uses an unsupported command          |
| `SHAPE_BOOLEAN_TOPOLOGY_FAILED`      | A closed boolean boundary cannot be rebuilt    |
| `SHAPE_DUPLICATE_PART_ID`            | Two addressable parts use the same ID          |
| `SHAPE_GEOMETRY_MAX_DEPTH`           | Authored or resolved geometry exceeds depth 48 |
| `SHAPE_PATH_MULTIPLE_SUBPATHS`       | Path measurement receives multiple subpaths    |
| `SHAPE_PATH_ZERO_LENGTH`             | Path measurement receives a zero-length path   |
| `SHAPE_PATH_COMPLEXITY_LIMIT`        | Path measurement exhausts its work limit       |
| `SHAPE_PATH_OFFSET_GEOMETRY_INVALID` | Offset geometry cannot be materialized         |
| `SHAPE_PATH_OFFSET_SAMPLE_LIMIT`     | Offset sampling exhausts its work limit        |
| `SHAPE_BOOLEAN_PAIR_LIMIT`           | Boolean evaluation exhausts its pair limit     |
| `SHAPE_REGION_CLIP_INTERVAL_INVALID` | A clip interval is not finite and increasing   |
| `SHAPE_REGION_CLIP_NON_MONOTONIC`    | A clipped contour is not axis-monotonic        |

Not every domain code is reachable from every operation. For example,
`renderShapeRegionSvg` receives an evaluated region and does not evaluate a
geometry tree. A strict custom-WASM boundary rejects a valid-looking error
whose operation and code combination cannot occur.

Long duplicate IDs are represented only by a UTF-8-safe prefix and an omitted
byte count. Panic payloads, stacks, input JSON, complete duplicate IDs, and
serde details are not copied into the diagnostic. Worker, React, CLI, and
Video routes preserve known Shape/Symbol diagnostics rather than replacing
them with a generic observer error.

### Migration from earlier shape errors

| Earlier behavior                                               | Current behavior                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A generic render-compilation failure                           | The exact geometry-domain code, with `renderShape` or `renderSymbol`          |
| Route-specific missing-capability codes                        | `SHAPE_WASM_CAPABILITY_MISSING` with the low-level operation                  |
| Route-specific invalid-result codes                            | `SHAPE_OUTPUT_INVALID` with `phase: "decode"`                                 |
| A malformed thrown value exposed transport details             | `SHAPE_WASM_FAILED`                                                           |
| A non-finite derived number appeared as `null`, `inf`, or text | `SHAPE_OUTPUT_INVALID` with `phase: "serialize"`                              |
| A duplicate part ID was rejected by a TypeScript tree walk     | Rust reports `SHAPE_DUPLICATE_PART_ID` while compiling the addressed geometry |

## React Overlay

Use `@boundsvg/react/inspect` for structured state and
`@boundsvg/react/debug` for its human-facing presentation.

```tsx
import { BoundSvg } from "@boundsvg/react";
import {
  BoundSvgDebugOverlay,
  NodeInspectorPanel,
} from "@boundsvg/react/debug";
import { useBoundSvgInspection } from "@boundsvg/react/inspect";

function PreviewInspector({ vnode, selectedNodeId }) {
  const { inspection, error, isReady } = useBoundSvgInspection(vnode);

  if (error) {
    return <p>{error.message}</p>;
  }

  return (
    <div style={{ position: "relative", width: 420 }}>
      <BoundSvg vnode={vnode} />
      {isReady && (
        <BoundSvgDebugOverlay
          inspection={inspection}
          labelMode="summary"
          selectedNodeId={selectedNodeId}
          highlightedBBoxes={[
            {
              id: "export",
              label: "export area",
              x: 20,
              y: 24,
              w: 240,
              h: 160,
            },
          ]}
        />
      )}
      <NodeInspectorPanel
        inspection={inspection}
        selectedNodeId={selectedNodeId}
      />
    </div>
  );
}
```

The overlay is intentionally presentation-light. Style the wrapper and panel in your application, use `filter` to show only text nodes, interactive nodes, or a selected branch, and pass `highlightedBBoxes` when an editor needs to mark a crop box, hovered render-tree node, or custom validation region. The overlay keeps `pointer-events: none`, so selection and hover state should be controlled by your surrounding UI.

## Diagnosing remaining `WASM_INVALID_*` errors

A remaining `WASM_INVALID_*` `FatalError` means the JavaScript package could
not accept data returned by a WASM operation outside the text-layout and shape
families. Malformed JSON can fail before a path or value is available.

Treat this as a bridge compatibility or implementation problem, not as a
recoverable scene warning:

1. Confirm that `@boundsvg/core` and the loaded boundsvg WASM artifact come
   from matching package versions. This includes copied or bundled
   `wasm-pkg` files.
2. Rebuild the WASM artifact and the package or application that embeds it so
   an older generated module is not retained in the output or cache.
3. If the matching, freshly built pair still fails, report a boundsvg bug with
   the error code, message, `stage`, `protocolPath`, and `received` context.
   Include the render method and the smallest scene that reproduces it.

The six text measurement routes no longer use route-specific
`WASM_INVALID_*_OUTPUT` codes. Use `TEXT_LAYOUT_OUTPUT_INVALID` and its
`operation`, `phase`, `protocolPath`, and `received` context instead.
Shape operations likewise use `SHAPE_OUTPUT_INVALID` rather than
route-specific invalid-output codes.

## CLI Reports

Use CLI diagnostics when assets come from SVG files or `.scene.json` files.

```bash
boundsvg inspect \
  --input card.svg \
  --default-font NotoSansJP \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf

boundsvg export \
  --input card.scene.json \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf \
  --report card.report.json

boundsvg doctor \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf
```

- `inspect` prints render stats, node ID status, warnings, missing glyph counts, overflow counts, bboxes, and draw order.
- `export --inspect` prints the same JSON report to stderr while still writing the rendered output.
- `export --report <file>` writes the JSON report for CI artifacts.
- `doctor` checks Node WASM initialization, the font registrations passed on the command line, and whether an ffmpeg is available for MP4 export.
