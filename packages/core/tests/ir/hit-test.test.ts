import { describe, expect, it } from "vitest";
import { buildHitTestIndex, hitTest, hitTestCandidates } from "../../src/ir/hit-test.js";
import type { IR, IRNode } from "../../src/ir/types.js";

function makeIR(nodes: IRNode[], width = 800, height = 600): IR {
  const drawOrder: string[] = [];
  for (const n of nodes) {
    drawOrder.push(n.nodeId);
  }

  return {
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: width, h: height },
      children: nodes,
    },
    drawOrder,
    width,
    height,
    warnings: [],
  };
}

describe("hitTest", () => {
  it("returns nodeId when point is inside a node bbox", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 100, h: 50 },
        fill: "#ff0000",
      },
    ]);

    expect(hitTest(ir, 50, 30)).toBe("box1");
  });

  it("returns null when point is outside all nodes", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 100, h: 50 },
      },
    ]);

    expect(hitTest(ir, 500, 500)).toBeNull();
  });

  it("returns topmost node (last in drawOrder) for overlapping nodes", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "bottom",
        bbox: { x: 0, y: 0, w: 200, h: 200 },
      },
      {
        type: "rect",
        nodeId: "top",
        bbox: { x: 50, y: 50, w: 100, h: 100 },
      },
    ]);

    // Point at (75, 75) is inside both — should return "top"
    expect(hitTest(ir, 75, 75)).toBe("top");
  });

  it("returns deeper node when only partially overlapping", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "bottom",
        bbox: { x: 0, y: 0, w: 200, h: 200 },
      },
      {
        type: "rect",
        nodeId: "top",
        bbox: { x: 100, y: 100, w: 100, h: 100 },
      },
    ]);

    // Point at (50, 50) is only inside "bottom"
    expect(hitTest(ir, 50, 50)).toBe("bottom");
  });

  it("hits text nodes", () => {
    const ir = makeIR([
      {
        type: "text",
        nodeId: "txt1",
        bbox: { x: 10, y: 10, w: 100, h: 20 },
        lines: [],
      },
    ]);

    expect(hitTest(ir, 50, 15)).toBe("txt1");
  });

  it("hits image nodes", () => {
    const ir = makeIR([
      {
        type: "image",
        nodeId: "img1",
        bbox: { x: 0, y: 0, w: 200, h: 150 },
      },
    ]);

    expect(hitTest(ir, 100, 75)).toBe("img1");
  });

  it("skips background and border sub-nodes", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "rect",
            nodeId: "box1:bg",
            bbox: { x: 0, y: 0, w: 200, h: 100 },
            fill: "#ff0000",
          },
          {
            type: "rect",
            nodeId: "box1:border",
            bbox: { x: 0, y: 0, w: 200, h: 100 },
            stroke: "#000000",
          },
          {
            type: "text",
            nodeId: "txt1",
            bbox: { x: 10, y: 10, w: 100, h: 20 },
          },
        ],
      },
      drawOrder: ["box1:bg", "box1:border", "txt1"],
      width: 800,
      height: 600,
      warnings: [],
    };

    // Point inside both bg and text — should return text, not bg/border
    expect(hitTest(ir, 50, 15)).toBe("txt1");
    // Point inside bg but not text — should return null (bg/border are skipped)
    expect(hitTest(ir, 150, 50)).toBeNull();
  });

  it("handles edge coordinates (on border)", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 100, h: 50 },
      },
    ]);

    // Exactly on the edge
    expect(hitTest(ir, 10, 10)).toBe("box1");
    expect(hitTest(ir, 110, 60)).toBe("box1");
    // Just outside
    expect(hitTest(ir, 9, 10)).toBeNull();
  });
});

describe("hitTestCandidates", () => {
  it("returns all candidates in z-order descending", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "bottom",
        bbox: { x: 0, y: 0, w: 200, h: 200 },
      },
      {
        type: "path",
        nodeId: "top",
        bbox: { x: 50, y: 50, w: 100, h: 100 },
      },
    ]);
    const index = buildHitTestIndex(ir);
    const candidates = hitTestCandidates(index, 75, 75);
    expect(candidates).toEqual(["top", "bottom"]);
  });

  it("returns empty array when no hits", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 50, h: 50 },
      },
    ]);
    const index = buildHitTestIndex(ir);
    expect(hitTestCandidates(index, 500, 500)).toEqual([]);
  });

  it("returns single candidate when only one node hit", () => {
    const ir = makeIR([
      {
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 50, h: 50 },
      },
    ]);
    const index = buildHitTestIndex(ir);
    expect(hitTestCandidates(index, 25, 25)).toEqual(["box1"]);
  });

  it("filters :bg and :border nodes", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          { type: "rect", nodeId: "box1:bg", bbox: { x: 0, y: 0, w: 200, h: 200 }, fill: "#fff" },
          { type: "rect", nodeId: "box1:border", bbox: { x: 0, y: 0, w: 200, h: 200 } },
          { type: "text", nodeId: "text1", bbox: { x: 10, y: 10, w: 100, h: 20 } },
        ],
      },
      drawOrder: ["box1:bg", "box1:border", "text1"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const index = buildHitTestIndex(ir);
    const candidates = hitTestCandidates(index, 50, 15);
    expect(candidates).toEqual(["text1"]);
  });
});
