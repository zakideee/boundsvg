import { describe, expect, it } from "vitest";
import { evaluateHitClips } from "../../src/ir/hit-geometry.js";
import { buildHitTestIndex, hitTest } from "../../src/ir/hit-test.js";
import type { IR, IRNode } from "../../src/ir/types.js";
import { circularClip } from "../helpers/box-clip.js";

/**
 * Regressions: hitTest ignored transforms (a translated node hit at
 * its pre-transform position and missed at its rendered one) and clips (an
 * invisible clipped-away region stole hits).
 */
function ir(root: IRNode): IR {
  return { root, width: 300, height: 100, warnings: [] };
}

describe("hitTest with transforms", () => {
  it("hits a translated node at its rendered position, not its layout position", () => {
    const root: IRNode = {
      ownership: { role: "source" },
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          ownership: { role: "source" },
          type: "group",
          nodeId: "moved-group",
          bbox: { x: 0, y: 0, w: 40, h: 24 },
          transform: { translateX: 120 },
          children: [
            {
              ownership: { role: "source" },
              type: "text",
              nodeId: "moved",
              bbox: { x: 0, y: 0, w: 40, h: 24 },
            },
          ],
        },
      ],
    };
    const tree = ir(root);

    expect(hitTest(tree, 125, 5)?.nodeId ?? null).toBe("moved");
    expect(hitTest(tree, 5, 5)?.nodeId ?? null).toBeNull();
  });

  it("applies nested ancestor transforms cumulatively", () => {
    const root: IRNode = {
      ownership: { role: "source" },
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          ownership: { role: "source" },
          type: "group",
          nodeId: "outer",
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          transform: { translateX: 50 },
          children: [
            {
              ownership: { role: "source" },
              type: "group",
              nodeId: "inner",
              bbox: { x: 0, y: 0, w: 40, h: 40 },
              transform: { translateX: 30 },
              children: [
                {
                  ownership: { role: "source" },
                  type: "rect",
                  nodeId: "leaf",
                  bbox: { x: 0, y: 0, w: 40, h: 40 },
                },
              ],
            },
          ],
        },
      ],
    };
    const tree = ir(root);

    expect(hitTest(tree, 85, 20)?.nodeId ?? null).toBe("leaf"); // 50 + 30 + within 40
    expect(hitTest(tree, 20, 20)?.nodeId ?? null).toBeNull();
  });

  it("does not hit a node collapsed to zero area by scale", () => {
    const root: IRNode = {
      ownership: { role: "source" },
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          ownership: { role: "source" },
          type: "group",
          nodeId: "collapsed-group",
          bbox: { x: 20, y: 20, w: 40, h: 40 },
          transform: { scaleX: 0 },
          children: [
            {
              ownership: { role: "source" },
              type: "rect",
              nodeId: "collapsed",
              bbox: { x: 20, y: 20, w: 40, h: 40 },
            },
          ],
        },
      ],
    };

    expect(hitTest(ir(root), 20, 30)?.nodeId ?? null).toBeNull();
  });
});

describe("hitTest with clipping", () => {
  for (const entryCount of [15, 16, 17]) {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      it(`ranks a boundary-only closed Frame at the ${edge} edge with ${entryCount} entries`, () => {
        const clip = { x: 20, y: 10, w: 100, h: 80 };
        const tree = ir({
          ownership: { role: "source" },
          type: "group",
          nodeId: "root",
          bbox: { x: 0, y: 0, w: 300, h: 100 },
          children: [
            ...Array.from(
              { length: entryCount - 2 },
              (_, index): IRNode => ({
                ownership: { role: "source" },
                type: "rect",
                nodeId: `filler-${index}`,
                bbox: { x: 200 + index, y: 80, w: 1, h: 1 },
              }),
            ),
            {
              ownership: { role: "source" },
              type: "group",
              nodeId: "clipper",
              bbox: clip,
              clip: circularClip(clip, 0),
              children: [
                { ownership: { role: "source" }, type: "rect", nodeId: "paint", bbox: clip },
                {
                  ownership: { role: "source", on: { onClick: "select" } },
                  type: "group",
                  nodeId: "frame",
                  bbox: {
                    ...clip,
                    x: edge === "left" ? -80 : edge === "right" ? 120 : 20,
                    y: edge === "top" ? -70 : edge === "bottom" ? 90 : 10,
                  },
                  children: [],
                },
              ],
            },
          ],
        });
        const point = {
          x: edge === "left" ? 20 : edge === "right" ? 120 : 70,
          y: edge === "top" ? 10 : edge === "bottom" ? 90 : 50,
        };
        const direction = {
          x: edge === "left" ? 1 : edge === "right" ? -1 : 0,
          y: edge === "top" ? 1 : edge === "bottom" ? -1 : 0,
        };
        const index = buildHitTestIndex(tree);
        expect(index.queryTopmost(point.x, point.y)?.nodeId).toBe("frame");
        expect(index.queryCandidates(point.x, point.y).map((hit) => hit.source.nodeId)).toEqual([
          "frame",
          "paint",
        ]);
        expect(
          index.queryTopmost(point.x + 2 * direction.x, point.y + 2 * direction.y)?.nodeId,
        ).toBe("paint");
        expect(index.queryTopmost(point.x - 2 * direction.x, point.y - 2 * direction.y)).toBeNull();
      });
    }
  }

  for (const entryCount of [15, 16, 17]) {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      it(`rejects a fully clipped adjacent node at the ${edge} edge with ${entryCount} entries`, () => {
        const filler: IRNode[] = Array.from({ length: entryCount - 2 }, (_, index) => ({
          ownership: { role: "source" },
          type: "rect",
          nodeId: `filler-${index}`,
          bbox: { x: 200 + index, y: 80, w: 1, h: 1 },
        }));
        const clip = { x: 20, y: 10, w: 100, h: 80 };
        const adjacent = {
          ...clip,
          x: edge === "left" ? -80 : edge === "right" ? 120 : 20,
          y: edge === "top" ? -70 : edge === "bottom" ? 90 : 10,
        };
        const tree = ir({
          ownership: { role: "source" },
          type: "group",
          nodeId: "root",
          bbox: { x: 0, y: 0, w: 300, h: 100 },
          children: [
            ...filler,
            {
              ownership: { role: "source" },
              type: "group",
              nodeId: "clipper",
              bbox: clip,
              children: [
                { ownership: { role: "source" }, type: "rect", nodeId: "visible", bbox: clip },
                { ownership: { role: "source" }, type: "rect", nodeId: "clipped", bbox: adjacent },
              ],
              clip: circularClip(clip, 0),
            },
          ],
        });
        const point = {
          x: edge === "left" ? 20 : edge === "right" ? 120 : 70,
          y: edge === "top" ? 10 : edge === "bottom" ? 90 : 50,
        };
        const index = buildHitTestIndex(tree);
        expect(hitTest(tree, point.x, point.y)?.nodeId ?? null).toBe("visible");
        expect(index.queryTopmost(point.x, point.y)?.nodeId ?? null).toBe("visible");
        expect(
          index.queryCandidates(point.x, point.y).map((candidate) => candidate.source.nodeId),
        ).toEqual(["visible"]);
      });
    }
  }

  it("does not hit content outside an ancestor clip", () => {
    const root: IRNode = {
      ownership: { role: "source" },
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          ownership: { role: "source" },
          type: "group",
          nodeId: "clipper",
          bbox: { x: 0, y: 0, w: 50, h: 30 },
          children: [
            {
              ownership: { role: "source" },
              type: "path",
              pathData: "M0 0H120V30H0Z",
              pathGeometry: {
                bounds: { minX: 0, minY: 0, maxX: 120, maxY: 30 },
                strokeOutset: { radius: 0, multiplier: 1 },
                isComplete: true,
              },
              nodeId: "wide-path",
              bbox: { x: 0, y: 0, w: 120, h: 30 },
            },
          ],
          clip: circularClip({ x: 0, y: 0, w: 50, h: 30 }, 0),
        },
      ],
    };
    const tree = ir(root);

    expect(hitTest(tree, 25, 15)?.nodeId ?? null).toBe("wide-path");
    // Outside the clip the path is invisible — it must not steal the hit.
    expect(hitTest(tree, 80, 15)?.nodeId ?? null).toBeNull();
  });

  it("combines clip and transform: the clip window moves with the node", () => {
    const root: IRNode = {
      ownership: { role: "source" },
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          ownership: { role: "source" },
          type: "group",
          nodeId: "clipper",
          bbox: { x: 0, y: 0, w: 50, h: 30 },
          transform: { translateX: 100 },
          children: [
            {
              ownership: { role: "source" },
              type: "path",
              pathData: "M0 0H120V30H0Z",
              pathGeometry: {
                bounds: { minX: 0, minY: 0, maxX: 120, maxY: 30 },
                strokeOutset: { radius: 0, multiplier: 1 },
                isComplete: true,
              },
              nodeId: "clipped",
              bbox: { x: 0, y: 0, w: 120, h: 30 },
            },
          ],
          clip: circularClip({ x: 0, y: 0, w: 50, h: 30 }, 0),
        },
      ],
    };
    const tree = ir(root);

    expect(hitTest(tree, 125, 15)?.nodeId ?? null).toBe("clipped"); // inside moved clip window
    expect(hitTest(tree, 25, 15)?.nodeId ?? null).toBeNull(); // old position
    expect(hitTest(tree, 180, 15)?.nodeId ?? null).toBeNull(); // moved but outside clip
  });

  it("keeps transform and clip semantics on the spatial-index path", () => {
    const filler: IRNode[] = Array.from({ length: 16 }, (_, index) => ({
      ownership: { role: "source" },
      type: "rect",
      nodeId: `filler-${index}`,
      bbox: { x: 200 + index, y: 80, w: 1, h: 1 },
    }));
    const root: IRNode = {
      ownership: { role: "source" },
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        ...filler,
        {
          ownership: { role: "source" },
          type: "group",
          nodeId: "indexed-clipper",
          bbox: { x: 0, y: 0, w: 50, h: 30 },
          transform: { translateX: 100 },
          children: [
            {
              ownership: { role: "source" },
              type: "path",
              pathData: "M0 0H120V30H0Z",
              pathGeometry: {
                bounds: { minX: 0, minY: 0, maxX: 120, maxY: 30 },
                strokeOutset: { radius: 0, multiplier: 1 },
                isComplete: true,
              },
              nodeId: "indexed-path",
              bbox: { x: 0, y: 0, w: 120, h: 30 },
            },
          ],
          clip: circularClip({ x: 0, y: 0, w: 50, h: 30 }, 0),
        },
      ],
    };
    const tree = ir(root);

    expect(filler.length + 1).toBeGreaterThanOrEqual(16);
    expect(hitTest(tree, 125, 15)?.nodeId ?? null).toBe("indexed-path");
    expect(hitTest(tree, 25, 15)?.nodeId ?? null).toBeNull();
    expect(hitTest(tree, 180, 15)?.nodeId ?? null).toBeNull();
  });
});

describe("resolved clip corner admission", () => {
  it.each([
    { w: 0, h: 100 },
    { w: 100, h: 0 },
  ])("treats a zero-area contour %j as empty", ({ w, h }) => {
    expect(
      evaluateHitClips(
        {
          parent: null,
          pose: { matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, linearWitnesses: [] },
          geometry: {
            kind: "boxContour",
            bbox: { x: 0, y: 0, w, h },
            corners: [
              { rx: 0, ry: 0 },
              { rx: 0, ry: 0 },
              { rx: 0, ry: 0 },
              { rx: 0, ry: 0 },
            ],
          },
        },
        { x: 0, y: 0 },
      ),
    ).toEqual({ status: "ready", contains: false });
  });

  it.each([
    -1, 50.00000000000001, 80,
  ])("rejects unresolved radius %s through hit geometry", (radius) => {
    expect(() =>
      evaluateHitClips(
        {
          parent: null,
          pose: { matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, linearWitnesses: [] },
          geometry: {
            kind: "boxContour",
            bbox: { x: 0, y: 0, w: 100, h: 100 },
            corners: [
              { rx: radius, ry: radius },
              { rx: radius, ry: radius },
              { rx: radius, ry: radius },
              { rx: radius, ry: radius },
            ],
          },
        },
        { x: 50, y: 50 },
      ),
    ).toThrow(/resolved box clip/);
  });
});
