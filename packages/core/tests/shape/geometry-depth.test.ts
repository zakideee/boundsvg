import {
  type GeometryDoc,
  type GeometryNode,
  geometryDoc,
  pathGeometry,
  transformGeometry,
} from "@boundsvg/shape";
import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import {
  compileGeometryToSvgDocument,
  computeGeometryIntersections,
  divideGeometryRegions,
  evaluateGeometryParts,
  hitTestGeometryParts,
  hitTestShapeAt,
  resolveSymbolGeometry,
} from "../../src/shape/compiler.js";
import { geometryToFlowExclusion, symbolToFlowExclusion } from "../../src/shape/flow-exclusion.js";
import {
  assertGeometryTreeDepth,
  MAX_GEOMETRY_TREE_DEPTH,
} from "../../src/shape/geometry-depth.js";
import { Canvas, Shape } from "../../src/vnode/components.js";

function nestedGeometry(depth: number, leafId?: string): GeometryDoc {
  let root: GeometryNode = pathGeometry("M0 0H10V10H0Z", { nodeId: leafId });
  for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
    root = transformGeometry({}, root);
  }
  return geometryDoc({ width: 10, height: 10 }, root);
}

function expectDepthError(callback: () => unknown, nodeId: string): void {
  let capturedError: unknown;
  try {
    callback();
  } catch (error) {
    capturedError = error;
  }
  expect(capturedError).toBeInstanceOf(FatalError);
  const fatalError = capturedError as FatalError;
  expect(fatalError.code).toBe("SHAPE_GEOMETRY_MAX_DEPTH");
  expect(fatalError.stage).toBe("validate");
  expect(fatalError.nodeId).toBe(nodeId);
  expect(fatalError.context?.maxDepth).toBe(MAX_GEOMETRY_TREE_DEPTH);
  expect(fatalError.context?.actualDepth).toBe(MAX_GEOMETRY_TREE_DEPTH + 1);
}

describe("geometry tree depth", () => {
  it("accepts limit - 1 and limit, then rejects limit + 1", () => {
    expect(() =>
      assertGeometryTreeDepth(nestedGeometry(MAX_GEOMETRY_TREE_DEPTH - 1)),
    ).not.toThrow();
    expect(() => assertGeometryTreeDepth(nestedGeometry(MAX_GEOMETRY_TREE_DEPTH))).not.toThrow();
    expectDepthError(
      () => assertGeometryTreeDepth(nestedGeometry(MAX_GEOMETRY_TREE_DEPTH + 1)),
      "<geometry>",
    );
  });

  it("rejects every direct geometry bridge before WASM initialization", () => {
    const overDepth = nestedGeometry(MAX_GEOMETRY_TREE_DEPTH + 1);
    const shallow = nestedGeometry(0);
    const placement = { x: 0, y: 0, width: 10, height: 10 };
    const symbol = { geometry: overDepth };
    const calls: Array<() => unknown> = [
      () => compileGeometryToSvgDocument(overDepth),
      () => evaluateGeometryParts(overDepth),
      () => hitTestGeometryParts(overDepth, { x: 5, y: 5 }),
      () => hitTestShapeAt(overDepth, { x: 5, y: 5 }, placement),
      () => geometryToFlowExclusion(overDepth, placement),
      () => divideGeometryRegions(shallow, overDepth),
      () => computeGeometryIntersections(shallow, overDepth),
    ];

    for (const call of calls) {
      expectDepthError(call, "<geometry>");
    }
    expectDepthError(() => resolveSymbolGeometry(symbol, { width: 10, height: 10 }), "<Symbol>");
    expectDepthError(() => symbolToFlowExclusion(symbol, placement), "<Symbol>");
  });

  it("rejects inline and registered Shape geometry before layout transport", () => {
    const computeLayoutFn = vi.fn((): never => {
      throw new TypeError("unexpected layout transport call");
    });
    const engine = new Engine({ computeLayoutFn });
    const overDepth = nestedGeometry(MAX_GEOMETRY_TREE_DEPTH + 1);

    expectDepthError(
      () =>
        engine.renderToLayoutTree(
          Canvas(
            { width: 100, height: 100 },
            Shape({ id: "inline-shape", geometry: overDepth, width: 10, height: 10 }),
          ),
          { skipValidation: true },
        ),
      "inline-shape",
    );

    engine.registerGeometry("deep", overDepth);
    expectDepthError(
      () =>
        engine.renderToLayoutTree(
          Canvas(
            { width: 100, height: 100 },
            Shape({ id: "registered-shape", geometryId: "deep", width: 10, height: 10 }),
          ),
        ),
      "registered-shape",
    );
    expect(computeLayoutFn).not.toHaveBeenCalled();
  });

  it("rejects depth added by elastic symbol transforms before the bridge", () => {
    const symbol = {
      geometry: nestedGeometry(MAX_GEOMETRY_TREE_DEPTH, "elastic"),
      elasticSegments: [
        {
          nodeId: "elastic",
          axis: "x" as const,
          role: "stretch" as const,
          frame: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
    };

    expectDepthError(() => resolveSymbolGeometry(symbol, { width: 20, height: 10 }), "<Symbol>");
  });
});
