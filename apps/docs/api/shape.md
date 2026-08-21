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
