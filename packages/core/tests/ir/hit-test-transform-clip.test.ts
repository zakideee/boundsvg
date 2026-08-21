import { describe, expect, it } from "vitest";
import { hitTest } from "../../src/ir/hit-test.js";
import type { IR, IRNode } from "../../src/ir/types.js";

/**
 * Regressions: hitTest ignored transforms (a translated node hit at
 * its pre-transform position and missed at its rendered one) and clips (an
 * invisible clipped-away region stole hits).
 */
function ir(root: IRNode, drawOrder: string[]): IR {
  return { root, drawOrder, width: 300, height: 100, warnings: [] };
}

describe("hitTest with transforms", () => {
  it("hits a translated node at its rendered position, not its layout position", () => {
    const root: IRNode = {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          type: "group",
          nodeId: "moved-group",
          bbox: { x: 0, y: 0, w: 40, h: 24 },
          transform: { translateX: 120 },
          children: [
            {
              type: "text",
              nodeId: "moved",
              bbox: { x: 0, y: 0, w: 40, h: 24 },
            },
          ],
        },
      ],
    };
    const tree = ir(root, ["moved"]);

    expect(hitTest(tree, 125, 5)).toBe("moved");
    expect(hitTest(tree, 5, 5)).toBeNull();
  });

  it("applies nested ancestor transforms cumulatively", () => {
    const root: IRNode = {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          type: "group",
          nodeId: "outer",
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          transform: { translateX: 50 },
          children: [
            {
              type: "group",
              nodeId: "inner",
              bbox: { x: 0, y: 0, w: 40, h: 40 },
              transform: { translateX: 30 },
              children: [{ type: "rect", nodeId: "leaf", bbox: { x: 0, y: 0, w: 40, h: 40 } }],
            },
          ],
        },
      ],
    };
    const tree = ir(root, ["leaf"]);

    expect(hitTest(tree, 85, 20)).toBe("leaf"); // 50 + 30 + within 40
    expect(hitTest(tree, 20, 20)).toBeNull();
  });

  it("does not hit a node collapsed to zero area by scale", () => {
    const root: IRNode = {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          type: "group",
          nodeId: "collapsed-group",
          bbox: { x: 20, y: 20, w: 40, h: 40 },
          transform: { scaleX: 0 },
          children: [
            {
              type: "rect",
              nodeId: "collapsed",
              bbox: { x: 20, y: 20, w: 40, h: 40 },
            },
          ],
        },
      ],
    };

    expect(hitTest(ir(root, ["collapsed"]), 20, 30)).toBeNull();
  });
});

describe("hitTest with clipping", () => {
  it("does not hit content outside an ancestor clip", () => {
    const root: IRNode = {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          type: "group",
          nodeId: "clipper",
          bbox: { x: 0, y: 0, w: 50, h: 30 },
          clipPath: { x: 0, y: 0, w: 50, h: 30 },
          children: [
            {
              type: "path",
              nodeId: "wide-path",
              bbox: { x: 0, y: 0, w: 120, h: 30 },
            },
          ],
        },
      ],
    };
    const tree = ir(root, ["wide-path"]);

    expect(hitTest(tree, 25, 15)).toBe("wide-path");
    // Outside the clip the path is invisible — it must not steal the hit.
    expect(hitTest(tree, 80, 15)).toBeNull();
  });

  it("combines clip and transform: the clip window moves with the node", () => {
    const root: IRNode = {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        {
          type: "group",
          nodeId: "clipper",
          bbox: { x: 0, y: 0, w: 50, h: 30 },
          clipPath: { x: 0, y: 0, w: 50, h: 30 },
          transform: { translateX: 100 },
          children: [{ type: "path", nodeId: "clipped", bbox: { x: 0, y: 0, w: 120, h: 30 } }],
        },
      ],
    };
    const tree = ir(root, ["clipped"]);

    expect(hitTest(tree, 125, 15)).toBe("clipped"); // inside moved clip window
    expect(hitTest(tree, 25, 15)).toBeNull(); // old position
    expect(hitTest(tree, 180, 15)).toBeNull(); // moved but outside clip
  });

  it("keeps transform and clip semantics on the spatial-index path", () => {
    const filler: IRNode[] = Array.from({ length: 16 }, (_, index) => ({
      type: "rect",
      nodeId: `filler-${index}`,
      bbox: { x: 200 + index, y: 80, w: 1, h: 1 },
    }));
    const root: IRNode = {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 300, h: 100 },
      children: [
        ...filler,
        {
          type: "group",
          nodeId: "indexed-clipper",
          bbox: { x: 0, y: 0, w: 50, h: 30 },
          clipPath: { x: 0, y: 0, w: 50, h: 30 },
          transform: { translateX: 100 },
          children: [{ type: "path", nodeId: "indexed-path", bbox: { x: 0, y: 0, w: 120, h: 30 } }],
        },
      ],
    };
    const drawOrder = [...filler.map((node) => node.nodeId), "indexed-path"];
    const tree = ir(root, drawOrder);

    expect(drawOrder.length).toBeGreaterThanOrEqual(16);
    expect(hitTest(tree, 125, 15)).toBe("indexed-path");
    expect(hitTest(tree, 25, 15)).toBeNull();
    expect(hitTest(tree, 180, 15)).toBeNull();
  });
});
