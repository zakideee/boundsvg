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
import type { ShapeOperand, ShapeOperation } from "../../src/wasm/shape-fatal-decoder.js";

function nestedGeometry(depth: number, leafId?: string): GeometryDoc {
  let root: GeometryNode = pathGeometry("M0 0H10V10H0Z", { nodeId: leafId });
  for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
    root = transformGeometry({}, root);
  }
  return geometryDoc({ width: 10, height: 10 }, root);
}

function expectDepthError(
  callback: () => unknown,
  expected: { operation: ShapeOperation; operand?: ShapeOperand; nodeId?: string },
): void {
  let capturedError: unknown;
  try {
    callback();
  } catch (error) {
    capturedError = error;
  }
  expect(capturedError).toBeInstanceOf(FatalError);
  const fatalError = capturedError as FatalError;
  expect(fatalError).toMatchObject({
    code: "SHAPE_GEOMETRY_MAX_DEPTH",
    message: "Shape geometry exceeds the maximum tree depth.",
    stage: "validate",
    nodeId: expected.nodeId,
  });
  expect(fatalError.context).toEqual({
    operation: expected.operation,
    ...(expected.operand === undefined ? {} : { operand: expected.operand }),
    actual: MAX_GEOMETRY_TREE_DEPTH + 1,
    limit: MAX_GEOMETRY_TREE_DEPTH,
  });
}

describe("geometry tree depth", () => {
  it("accepts the boundary and rejects the next recursive node", () => {
    const context = { operation: "compileShapeSvg" as const };
    expect(() =>
      assertGeometryTreeDepth(nestedGeometry(MAX_GEOMETRY_TREE_DEPTH - 1), context),
    ).not.toThrow();
    expect(() =>
      assertGeometryTreeDepth(nestedGeometry(MAX_GEOMETRY_TREE_DEPTH), context),
    ).not.toThrow();
    expectDepthError(
      () => assertGeometryTreeDepth(nestedGeometry(MAX_GEOMETRY_TREE_DEPTH + 1), context),
      context,
    );
  });

  it("stops cyclic geometry at the same depth boundary", () => {
    const cyclicNode: { kind: "group"; children: unknown[] } = {
      kind: "group",
      children: [],
    };
    cyclicNode.children.push(cyclicNode);
    expectDepthError(
      () =>
        assertGeometryTreeDepth(
          { viewBox: { width: 10, height: 10 }, root: cyclicNode },
          { operation: "evaluateShapeRegion" },
        ),
      { operation: "evaluateShapeRegion" },
    );
  });

  it("classifies malformed trees separately from unreadable properties", () => {
    expect(() =>
      assertGeometryTreeDepth({ root: { kind: "unknown" } }, { operation: "compileShapePaths" }),
    ).toThrowError(
      expect.objectContaining({
        code: "SHAPE_INPUT_INVALID",
        context: { operation: "compileShapePaths", reason: "invalidRequestShape" },
      }),
    );

    expect(() =>
      assertGeometryTreeDepth(
        { root: { kind: "group", children: {} } },
        { operation: "compileShapePaths" },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "SHAPE_INPUT_INVALID",
        context: { operation: "compileShapePaths", reason: "invalidRequestShape" },
      }),
    );

    const unreadableGeometry = Object.defineProperty({}, "root", {
      get(): never {
        throw new TypeError("unreadable root");
      },
    });
    expect(() =>
      assertGeometryTreeDepth(unreadableGeometry, { operation: "compileShapePaths" }),
    ).toThrowError(
      expect.objectContaining({
        code: "SHAPE_INPUT_INVALID",
        context: { operation: "compileShapePaths", reason: "serializationFailed" },
      }),
    );

    const unreadableNode = new Proxy(
      { kind: "path" },
      {
        get(): never {
          throw new TypeError("unreadable proxy node");
        },
      },
    );
    expect(() =>
      assertGeometryTreeDepth({ root: unreadableNode }, { operation: "evaluateShapeRegion" }),
    ).toThrowError(
      expect.objectContaining({
        code: "SHAPE_INPUT_INVALID",
        context: { operation: "evaluateShapeRegion", reason: "serializationFailed" },
      }),
    );
  });

  it("rejects direct geometry operations before WASM initialization", () => {
    const overDepth = nestedGeometry(MAX_GEOMETRY_TREE_DEPTH + 1);
    const shallow = nestedGeometry(0);
    const placement = { x: 0, y: 0, width: 10, height: 10 };
    const symbol = { geometry: overDepth };
    const calls: Array<{
      invoke: () => unknown;
      operation: ShapeOperation;
      operand?: ShapeOperand;
    }> = [
      { invoke: () => compileGeometryToSvgDocument(overDepth), operation: "compileShapeSvg" },
      { invoke: () => evaluateGeometryParts(overDepth), operation: "evaluateShapeParts" },
      {
        invoke: () => hitTestGeometryParts(overDepth, { x: 5, y: 5 }),
        operation: "hitTestShapeParts",
      },
      {
        invoke: () => hitTestShapeAt(overDepth, { x: 5, y: 5 }, placement),
        operation: "hitTestShapeParts",
      },
      {
        invoke: () => geometryToFlowExclusion(overDepth, placement),
        operation: "evaluateShapeRegion",
      },
      {
        invoke: () => divideGeometryRegions(shallow, overDepth),
        operation: "divideShapeRegions",
        operand: "rhs",
      },
      {
        invoke: () => computeGeometryIntersections(shallow, overDepth),
        operation: "computeShapeIntersections",
      },
    ];

    for (const shapeCall of calls) {
      expectDepthError(shapeCall.invoke, {
        operation: shapeCall.operation,
        operand: shapeCall.operand,
      });
    }
    expectDepthError(() => resolveSymbolGeometry(symbol, { width: 10, height: 10 }), {
      operation: "resolveSymbolGeometry",
    });
    expectDepthError(() => symbolToFlowExclusion(symbol, placement), {
      operation: "resolveSymbolGeometry",
    });
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
      { operation: "renderShape", nodeId: "inline-shape" },
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
      { operation: "renderShape", nodeId: "registered-shape" },
    );
    expect(computeLayoutFn).not.toHaveBeenCalled();
  });
});
