import { describe, expect, it } from "vitest";
import { buildHitTestIndex, hitTest, hitTestWithIndex } from "../../src/ir/hit-test.js";
import { buildSpatialIndex, createSpatialIndex } from "../../src/ir/spatial-index.js";
import type { IR, IRNode } from "../../src/ir/types.js";

describe("SpatialIndex", () => {
  it("inserts and queries a single node", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("node1", { x: 10, y: 10, w: 20, h: 20 }, 0);

    expect(index.queryTopmost(15, 15)).toBe("node1");
    expect(index.queryTopmost(0, 0)).toBeNull();
  });

  it("returns topmost (highest drawIndex) on overlap", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("bottom", { x: 10, y: 10, w: 50, h: 50 }, 0);
    index.insert("top", { x: 20, y: 20, w: 30, h: 30 }, 1);

    // Point at (25, 25) is in both — should return "top" (drawIndex=1)
    expect(index.queryTopmost(25, 25)).toBe("top");
    // Point at (12, 12) is only in bottom
    expect(index.queryTopmost(12, 12)).toBe("bottom");
  });

  it("skips :bg and :border nodes", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("node1:bg", { x: 0, y: 0, w: 100, h: 100 }, 0);
    index.insert("node1:border", { x: 0, y: 0, w: 100, h: 100 }, 1);
    index.insert("node1", { x: 10, y: 10, w: 80, h: 80 }, 2);

    expect(index.queryTopmost(50, 50)).toBe("node1");
    // Point at (2, 2) — only bg and border, should return null
    expect(index.queryTopmost(2, 2)).toBeNull();
  });

  it("handles many nodes across quadrants", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 400, h: 400 });

    // Insert 100 nodes in a 10x10 grid
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const id = `node_${row}_${col}`;
        index.insert(
          id,
          {
            x: col * 40,
            y: row * 40,
            w: 38,
            h: 38,
          },
          row * 10 + col,
        );
      }
    }

    // Query center of node at (3, 5) → x=5*40+19=219, y=3*40+19=139
    expect(index.queryTopmost(219, 139)).toBe("node_3_5");

    // Query center of node at (9, 9) → x=9*40+19=379, y=9*40+19=379
    expect(index.queryTopmost(379, 379)).toBe("node_9_9");

    // Query center of node at (0, 0) → x=19, y=19
    expect(index.queryTopmost(19, 19)).toBe("node_0_0");

    // Query in gap between nodes
    expect(index.queryTopmost(39, 39)).toBeNull();
  });

  it("handles nodes at boundaries", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("node1", { x: 0, y: 0, w: 50, h: 50 }, 0);

    // On the boundary (inclusive)
    expect(index.queryTopmost(0, 0)).toBe("node1");
    expect(index.queryTopmost(50, 50)).toBe("node1");
    // Just outside
    expect(index.queryTopmost(51, 51)).toBeNull();
  });
});

describe("buildSpatialIndex", () => {
  it("builds from drawOrder and bboxMap", () => {
    const drawOrder = ["a:bg", "a", "b:bg", "b"];
    const bboxMap = new Map([
      ["a:bg", { x: 0, y: 0, w: 50, h: 50 }],
      ["a", { x: 0, y: 0, w: 50, h: 50 }],
      ["b:bg", { x: 50, y: 0, w: 50, h: 50 }],
      ["b", { x: 50, y: 0, w: 50, h: 50 }],
    ]);

    const index = buildSpatialIndex({ width: 100, height: 50 }, drawOrder, bboxMap);
    expect(index.queryTopmost(25, 25)).toBe("a");
    expect(index.queryTopmost(75, 25)).toBe("b");
  });
});

describe("hitTest with spatial index", () => {
  function makeIR(nodeCount: number): IR {
    const children: IRNode[] = [];
    const drawOrder: string[] = [];

    for (let i = 0; i < nodeCount; i++) {
      const bgId = `node${i}:bg`;
      const nodeId = `node${i}`;
      children.push({
        type: "rect",
        nodeId: bgId,
        bbox: { x: i * 10, y: 0, w: 8, h: 8 },
        fill: "#fff",
      });
      children.push({
        type: "rect",
        nodeId,
        bbox: { x: i * 10, y: 0, w: 8, h: 8 },
      });
      drawOrder.push(bgId);
      drawOrder.push(nodeId);
    }

    return {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: nodeCount * 10, h: 10 },
        children,
      },
      drawOrder,
      width: nodeCount * 10,
      height: 10,
      warnings: [],
    };
  }

  it("uses spatial index for trees with >= 16 draw entries", () => {
    const ir = makeIR(10); // 20 draw entries (bg + node for each)
    expect(ir.drawOrder.length).toBe(20);

    // hitTest should still work correctly with spatial index
    expect(hitTest(ir, 4, 4)).toBe("node0");
    expect(hitTest(ir, 14, 4)).toBe("node1");
    expect(hitTest(ir, 94, 4)).toBe("node9");
    expect(hitTest(ir, 9, 4)).toBeNull(); // in the gap
  });

  it("uses linear scan for small trees", () => {
    const ir = makeIR(4); // 8 draw entries
    expect(ir.drawOrder.length).toBe(8);

    expect(hitTest(ir, 4, 4)).toBe("node0");
    expect(hitTest(ir, 34, 4)).toBe("node3");
  });

  it("buildHitTestIndex + hitTestWithIndex for repeated queries", () => {
    const ir = makeIR(20);
    const index = buildHitTestIndex(ir);

    expect(hitTestWithIndex(index, 4, 4)).toBe("node0");
    expect(hitTestWithIndex(index, 194, 4)).toBe("node19");
    expect(hitTestWithIndex(index, 9, 4)).toBeNull();
  });
});

describe("SpatialIndex.queryCandidates", () => {
  it("returns empty array when no nodes hit", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("node1", { x: 10, y: 10, w: 20, h: 20 }, 0);

    expect(index.queryCandidates(0, 0)).toEqual([]);
  });

  it("returns single candidate", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("node1", { x: 10, y: 10, w: 20, h: 20 }, 0);

    expect(index.queryCandidates(15, 15)).toEqual(["node1"]);
  });

  it("returns candidates in z-order descending (front-to-back)", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("bottom", { x: 10, y: 10, w: 50, h: 50 }, 0);
    index.insert("middle", { x: 10, y: 10, w: 50, h: 50 }, 1);
    index.insert("top", { x: 10, y: 10, w: 50, h: 50 }, 2);

    const result = index.queryCandidates(25, 25);
    expect(result).toEqual(["top", "middle", "bottom"]);
  });

  it("filters :bg and :border nodes", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 100, h: 100 });
    index.insert("node1:bg", { x: 0, y: 0, w: 100, h: 100 }, 0);
    index.insert("node1:border", { x: 0, y: 0, w: 100, h: 100 }, 1);
    index.insert("node1", { x: 10, y: 10, w: 80, h: 80 }, 2);

    const result = index.queryCandidates(50, 50);
    expect(result).toEqual(["node1"]);
    // bg-only area returns empty
    expect(index.queryCandidates(2, 2)).toEqual([]);
  });

  it("returns only nodes that contain the point", () => {
    const index = createSpatialIndex({ x: 0, y: 0, w: 200, h: 200 });
    index.insert("bottom", { x: 0, y: 0, w: 200, h: 200 }, 0);
    index.insert("top", { x: 100, y: 100, w: 100, h: 100 }, 1);

    // Point in both
    expect(index.queryCandidates(150, 150)).toEqual(["top", "bottom"]);
    // Point only in bottom
    expect(index.queryCandidates(50, 50)).toEqual(["bottom"]);
  });
});
