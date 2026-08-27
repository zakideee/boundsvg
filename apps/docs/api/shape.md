---
title: "@boundsvg/shape"
---

# @boundsvg/shape

Low-level geometry and symbol builders for boundsvg.

This package does not render by itself. It defines serializable geometry documents that `Shape` and `Symbol` in `@boundsvg/core` can consume.

## Core Types

```ts
type BooleanOp = "union" | "subtract" | "intersect" | "xor";

type GeometryDoc = {
  viewBox: { x?: number; y?: number; width: number; height: number };
  root: GeometryNode;
};

type GeometryNode =
  | {
      kind: "path";
      d: string;
      nodeId?: string;
      fillRule?: "nonzero" | "evenodd";
    }
  | { kind: "group"; children: GeometryNode[]; nodeId?: string }
  | {
      kind: "transform";
      transform: Transform2D;
      child: GeometryNode;
      nodeId?: string;
    }
  | {
      kind: "boolean";
      op: BooleanOp;
      children: GeometryNode[];
      nodeId?: string;
    };

type SymbolDefinition = {
  geometry: GeometryDoc;
  elasticSegments?: ElasticSegment[];
};
```

## Builder Helpers

```ts
import {
  booleanGeometry,
  geometryDoc,
  groupGeometry,
  pathGeometry,
  symbolDefinition,
  transformGeometry,
} from "@boundsvg/shape";
```

Use the helpers when you want a typed AST instead of handwritten object literals.

## Intended Usage

1. Build or import a `GeometryDoc`
2. Register it on an engine with `registerGeometry()` or pass it inline to `Shape`
3. Build a `SymbolDefinition` when you need elastic segments

`@boundsvg/shape` intentionally stays below chart semantics. Axes, scales, and series belong in an external charting layer.

## Geometry Depth Limit

Authored geometry is limited to depth 48. The root is depth 0; entering a
`group`, `transform`, or `boolean` child adds one level. A path at depth 48 is
accepted, while the first node at depth 49 is rejected before recursive
validation or WASM serialization.

The same limit applies to inline and registered `Shape`/`Symbol` geometry,
direct compile/evaluate/hit-test APIs, flow exclusions, and elastic symbol
resolution. The builder helpers can construct arbitrary object graphs, so
programmatically generated geometry must stay within the limit.

Elastic resolution validates the resolved tree against the same limit. When
the target size changes, each matching `fixed-end` segment and each matching
`stretch` segment with a positive frame size can add a transform wrapper and
consume one additional depth level. Leave that headroom when authoring elastic
symbols; a tree whose deepest node is already at depth 48 can therefore be
rejected after resolution.

| Error code                 | Condition                                              |
| -------------------------- | ------------------------------------------------------ |
| `SHAPE_GEOMETRY_MAX_DEPTH` | An authored or resolved geometry node exceeds depth 48 |

### Rust API migration

`boundshape::resolve_symbol_geometry` returns
`Result<GeometryDoc, ShapeError>`. Propagate the error with `?` or handle it
explicitly:

```rust
let geometry = boundshape::resolve_symbol_geometry(&definition, &options)?;
```

`ShapeError` is non-exhaustive so new error cases can be added compatibly.
Downstream matches must include a wildcard arm:

```rust
match error {
    ShapeError::GeometryDepthLimit => handle_depth_limit(),
    other => handle_shape_error(other),
}
```
