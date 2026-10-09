import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { cloneIRForLayeredTransform } from "../../src/ir/clone.js";
import {
  buildHitTestIndex,
  hitTest,
  hitTestCandidates,
  hitTestWithIndex,
} from "../../src/ir/hit-test.js";
import type { IR, IRGroupNode, IRNode, IRPathNode } from "../../src/ir/types.js";
import { applyAffineMatrixToPoint, createResolvedTransformMatrix } from "../../src/transform.js";

/** A narrow placement frame deliberately excludes the authored painted rectangle. */
function overflowPath(negative = false): IRPathNode {
  return {
    type: "path",
    nodeId: "path",
    bbox: { x: negative ? 150 : 10, y: 10, w: 20, h: 20 },
    pathData: negative ? "M-100 0h80v40h-80Z" : "M150 0h80v40h-80Z",
    fill: "red",
    pathGeometry: {
      bounds: { minX: negative ? -100 : 150, minY: 0, maxX: negative ? -20 : 230, maxY: 40 },
      strokeOutset: { radius: 0, multiplier: 1 },
      isComplete: true,
    },
    on: { onClick: "path-click" },
  };
}

/** Attach one scene without conflating semantic order with layout-tree order. */
function makeHitScene(nodes: IRNode[], drawOrder: string[]): IR {
  return {
    root: { type: "group", nodeId: "root", bbox: { x: 0, y: 0, w: 300, h: 120 }, children: nodes },
    width: 300,
    height: 120,
    drawOrder,
    warnings: [],
  };
}

/** Compare every public hit query against the same expected candidate order. */
function expectHitQueries(ir: IR, point: { x: number; y: number }, candidates: string[]): void {
  const index = buildHitTestIndex(ir);
  expect(hitTest(ir, point.x, point.y)).toBe(candidates[0] ?? null);
  expect(hitTestWithIndex(index, point.x, point.y)).toBe(candidates[0] ?? null);
  expect(hitTestCandidates(index, point.x, point.y)).toEqual(candidates);
}

/** An interactive underlay precedes the Path; its presence exposes lost candidates. */
const underlay: IRNode = { type: "rect", nodeId: "underlay", bbox: { x: 0, y: 0, w: 300, h: 120 } };

describe("Path paint candidates and exact clip gates", () => {
  it.each([15, 16, 17])("keeps signed overflow geometry across the %i-entry threshold", (count) => {
    for (const negative of [false, true]) {
      const path = overflowPath(negative);
      const fillers: IRNode[] = Array.from({ length: count - 2 }, (_, entryIndex) => ({
        type: "rect",
        nodeId: `filler-${entryIndex}`,
        bbox: { x: 280, y: 100, w: 1, h: 1 },
      }));
      const scene = makeHitScene(
        [
          underlay,
          ...fillers,
          { type: "group", nodeId: "path", bbox: path.bbox, children: [path] },
        ],
        ["underlay", ...fillers.map((node) => node.nodeId), "path"],
      );
      expectHitQueries(scene, { x: negative ? 100 : 200, y: 30 }, ["path", "underlay"]);
      expect(path.bbox.w).toBe(20);
      expectHitQueries(scene, { x: -1, y: 30 }, []);
      expectHitQueries(scene, { x: 301, y: 30 }, []);
    }
  });

  it("replaces the semantic placement frame, including deletion for empty geometry", () => {
    const path = overflowPath();
    expectHitQueries(makeHitScene([path], ["path"]), { x: 20, y: 20 }, []);
    path.pathGeometry.bounds = null;
    expectHitQueries(
      makeHitScene(
        [{ type: "group", nodeId: "path", bbox: path.bbox, children: [path] }],
        ["path"],
      ),
      { x: 20, y: 20 },
      [],
    );
  });

  it.each([
    undefined,
    0,
    50,
    { tl: 50, tr: 0, br: 20, bl: 5 },
    -4,
  ])("clips the owner and descendant with resolved radius %j", (radius) => {
    const card: IRGroupNode = {
      type: "group",
      nodeId: "card",
      bbox: { x: 10, y: 10, w: 100, h: 100 },
      clipPath: { x: 10, y: 10, w: 100, h: 100 },
      clipBorderRadius: radius,
      on: { onClick: "card-click" },
      children: [{ type: "rect", nodeId: "content", bbox: { x: 0, y: 0, w: 200, h: 120 } }],
    };
    const scene = makeHitScene([card], ["content", "card"]);
    expectHitQueries(scene, { x: 60, y: 60 }, ["card", "content"]);
    expectHitQueries(
      scene,
      { x: 12, y: 12 },
      radius === 50 || typeof radius === "object" ? [] : ["card", "content"],
    );
    expectHitQueries(scene, { x: 150, y: 30 }, []);
    const index = buildHitTestIndex(scene);
    index.insert("card", { x: 0, y: 0, w: 20, h: 20 }, 100);
    expect(index.queryCandidates(12, 12)).toEqual(
      radius === 50 || typeof radius === "object" ? ["card"] : ["card", "card", "content"],
    );
  });

  it("tests rotated nested clips in their original coordinates", () => {
    const outer: IRGroupNode = {
      type: "group",
      nodeId: "outer",
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      transform: { translateX: 100, rotateDeg: 45 },
      clipPath: { x: 0, y: 0, w: 100, h: 100 },
      clipBorderRadius: 50,
      children: [
        {
          type: "group",
          nodeId: "inner",
          bbox: { x: 20, y: 20, w: 60, h: 60 },
          clipPath: { x: 20, y: 20, w: 60, h: 60 },
          clipBorderRadius: 30,
          children: [{ type: "rect", nodeId: "content", bbox: { x: 0, y: 0, w: 100, h: 100 } }],
        },
      ],
    };
    const scene = makeHitScene([outer], ["content"]);
    const matrix = createResolvedTransformMatrix(outer.transform, outer.bbox);
    expectHitQueries(scene, applyAffineMatrixToPoint(matrix, { x: 50, y: 50 }), ["content"]);
    expectHitQueries(scene, applyAffineMatrixToPoint(matrix, { x: 21, y: 21 }), []);
  });

  it("preserves interactive parent precedence only inside its actual rotated frame", () => {
    const path = overflowPath();
    path.bbox = { x: 0, y: 0, w: 20, h: 20 };
    path.pathGeometry.bounds = { minX: -40, minY: -40, maxX: 100, maxY: 100 };
    const parent: IRGroupNode = {
      type: "group",
      nodeId: "parent",
      bbox: { x: 0, y: 0, w: 40, h: 40 },
      transform: { translateX: 80, translateY: 20, rotateDeg: 45 },
      on: { onClick: "parent-click" },
      children: [path],
    };
    const matrix = createResolvedTransformMatrix(parent.transform, parent.bbox);
    const scene = makeHitScene([parent], ["path", "parent"]);
    expectHitQueries(scene, applyAffineMatrixToPoint(matrix, { x: 20, y: 20 }), ["parent", "path"]);
    expectHitQueries(scene, applyAffineMatrixToPoint(matrix, { x: -5, y: 20 }), ["path"]);
  });

  it("expands ordinary stroke before scale and canvas-stable stroke afterward", () => {
    const path = overflowPath();
    path.bbox = { x: 0, y: 0, w: 1, h: 1 };
    path.pathGeometry = {
      bounds: { minX: 20, minY: 20, maxX: 40, maxY: 20 },
      strokeOutset: { radius: 5, multiplier: 1 },
      isComplete: true,
    };
    const parent: IRGroupNode = {
      type: "group",
      nodeId: "scale",
      bbox: path.bbox,
      transform: { scaleX: 2, scaleY: 2 },
      children: [path],
    };
    const scene = makeHitScene([parent], ["path"]);
    expectHitQueries(scene, { x: 60, y: 49 }, ["path"]);
    path.strokeScaling = "canvas";
    expectHitQueries(scene, { x: 60, y: 49 }, []);
    expectHitQueries(scene, { x: 60, y: 44 }, ["path"]);
    parent.transform = { scaleX: 0, scaleY: 2 };
    expectHitQueries(scene, { x: 0, y: 40 }, []);
  });

  it("keeps extreme finite geometry and stroke factors separate until canvas intersection", () => {
    const path = overflowPath();
    path.pathGeometry.bounds = { minX: -1e308, minY: -1e308, maxX: 1e308, maxY: 1e308 };
    path.pathGeometry.strokeOutset = { radius: 1e308, multiplier: 1e308 };
    expectHitQueries(makeHitScene([path], ["path"]), { x: 10, y: 10 }, ["path"]);
  });

  it.each([
    undefined,
    null,
    {},
    { bounds: null, isComplete: true, strokeOutset: { radius: -1, multiplier: 1 } },
  ])("rejects invalid output geometry %j instead of using layout", (metadata) => {
    const path = { ...overflowPath(), pathGeometry: metadata } as unknown as IRPathNode;
    expect(() => buildHitTestIndex(makeHitScene([path], ["path"]))).toThrow(FatalError);
    expect(() => hitTest(makeHitScene([path], ["path"]), 20, 20)).toThrow(/schema-34/);
  });

  it("detaches derived bounds and stroke factors during layered cloning", () => {
    const original = overflowPath();
    const cloned = cloneIRForLayeredTransform(original) as IRPathNode;
    if (cloned.pathGeometry.bounds) {
      cloned.pathGeometry.bounds.minX = -999;
    }
    cloned.pathGeometry.strokeOutset.radius = 999;
    expect(original.pathGeometry.bounds?.minX).toBe(150);
    expect(original.pathGeometry.strokeOutset.radius).toBe(0);
  });
});
