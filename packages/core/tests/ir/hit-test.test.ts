import { describe, expect, it } from "vitest";
import { buildHitTestIndex, hitTest } from "../../src/ir/hit-test.js";
import { buildInspectHitTestIndex } from "../../src/ir/inspect-hit-test.js";
import type { IR, IRNode } from "../../src/ir/types.js";

function makeIR(nodes: IRNode[], width = 800, height = 600): IR {
  return {
    root: {
      ownership: { role: "source" },
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: width, h: height },
      children: nodes,
    },

    width,
    height,
    warnings: [],
  };
}

describe("hitTest", () => {
  it("returns nodeId when point is inside a node bbox", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 100, h: 50 },
        fill: "#ff0000",
      },
    ]);

    expect(hitTest(ir, 50, 30)?.nodeId ?? null).toBe("box1");
  });

  it("returns null when point is outside all nodes", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 100, h: 50 },
      },
    ]);

    expect(hitTest(ir, 500, 500)?.nodeId ?? null).toBeNull();
  });

  it("returns topmost node (last paint in tree order) for overlapping nodes", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "bottom",
        bbox: { x: 0, y: 0, w: 200, h: 200 },
      },
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "top",
        bbox: { x: 50, y: 50, w: 100, h: 100 },
      },
    ]);

    // Point at (75, 75) is inside both — should return "top"
    expect(hitTest(ir, 75, 75)?.nodeId ?? null).toBe("top");
  });

  it("returns deeper node when only partially overlapping", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "bottom",
        bbox: { x: 0, y: 0, w: 200, h: 200 },
      },
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "top",
        bbox: { x: 100, y: 100, w: 100, h: 100 },
      },
    ]);

    // Point at (50, 50) is only inside "bottom"
    expect(hitTest(ir, 50, 50)?.nodeId ?? null).toBe("bottom");
  });

  it("hits text nodes", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "text",
        nodeId: "txt1",
        bbox: { x: 10, y: 10, w: 100, h: 20 },
        lines: [],
      },
    ]);

    expect(hitTest(ir, 50, 15)?.nodeId ?? null).toBe("txt1");
  });

  it("hits image nodes", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "image",
        nodeId: "img1",
        bbox: { x: 0, y: 0, w: 200, h: 150 },
      },
    ]);

    expect(hitTest(ir, 100, 75)?.nodeId ?? null).toBe("img1");
  });

  it("skips background and border sub-nodes", () => {
    const ir: IR = {
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            ownership: { role: "decoration", ownerNodeId: "root" },
            type: "rect",
            nodeId: "box1:bg",
            bbox: { x: 0, y: 0, w: 200, h: 100 },
            fill: "#ff0000",
          },
          {
            ownership: { role: "decoration", ownerNodeId: "root" },
            type: "rect",
            nodeId: "box1:border",
            bbox: { x: 0, y: 0, w: 200, h: 100 },
            stroke: "#000000",
          },
          {
            ownership: { role: "source" },
            type: "text",
            nodeId: "txt1",
            bbox: { x: 10, y: 10, w: 100, h: 20 },
          },
        ],
      },

      width: 800,
      height: 600,
      warnings: [],
    };

    // Point inside both bg and text — should return text, not bg/border
    expect(hitTest(ir, 50, 15)?.nodeId ?? null).toBe("txt1");
    // Point inside bg but not text — should return null (bg/border are skipped)
    expect(hitTest(ir, 150, 50)?.nodeId ?? null).toBeNull();
  });

  it("handles edge coordinates (on border)", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 100, h: 50 },
      },
    ]);

    // Exactly on the edge
    expect(hitTest(ir, 10, 10)?.nodeId ?? null).toBe("box1");
    expect(hitTest(ir, 110, 60)?.nodeId ?? null).toBe("box1");
    // Just outside
    expect(hitTest(ir, 9, 10)?.nodeId ?? null).toBeNull();
  });
});

describe("prepared hit candidates", () => {
  it("returns all candidates in z-order descending", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "bottom",
        bbox: { x: 0, y: 0, w: 200, h: 200 },
      },
      {
        ownership: { role: "source" },
        type: "path",
        nodeId: "top",
        pathData: "M0 0H100V100H0Z",
        pathGeometry: {
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          strokeOutset: { radius: 0, multiplier: 1 },
          isComplete: true,
        },
        bbox: { x: 50, y: 50, w: 100, h: 100 },
      },
    ]);
    const index = buildHitTestIndex(ir);
    const candidates = index.queryCandidates(75, 75).map((candidate) => candidate.source.nodeId);
    expect(candidates).toEqual(["top", "bottom"]);
  });

  it("returns empty array when no hits", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 50, h: 50 },
      },
    ]);
    const index = buildHitTestIndex(ir);
    expect(index.queryCandidates(500, 500).map((candidate) => candidate.source.nodeId)).toEqual([]);
  });

  it("returns single candidate when only one node hit", () => {
    const ir = makeIR([
      {
        ownership: { role: "source" },
        type: "rect",
        nodeId: "box1",
        bbox: { x: 10, y: 10, w: 50, h: 50 },
      },
    ]);
    const index = buildHitTestIndex(ir);
    expect(index.queryCandidates(25, 25).map((candidate) => candidate.source.nodeId)).toEqual([
      "box1",
    ]);
  });

  it("filters :bg and :border nodes", () => {
    const ir: IR = {
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            ownership: { role: "decoration", ownerNodeId: "root" },
            type: "rect",
            nodeId: "box1:bg",
            bbox: { x: 0, y: 0, w: 200, h: 200 },
            fill: "#fff",
          },
          {
            ownership: { role: "decoration", ownerNodeId: "root" },
            type: "rect",
            nodeId: "box1:border",
            bbox: { x: 0, y: 0, w: 200, h: 200 },
          },
          {
            ownership: { role: "source" },
            type: "text",
            nodeId: "text1",
            bbox: { x: 10, y: 10, w: 100, h: 20 },
          },
        ],
      },

      width: 800,
      height: 600,
      warnings: [],
    };
    const index = buildHitTestIndex(ir);
    const candidates = index.queryCandidates(50, 15).map((candidate) => candidate.source.nodeId);
    expect(candidates).toEqual(["text1"]);
  });
});

describe("snapshot viewport membership", () => {
  it("shares strict viewport edges for paint, interaction and inspection candidates", () => {
    const tree = makeIR(
      [
        {
          type: "rect",
          nodeId: "paint",
          ownership: { role: "source" },
          bbox: { x: -10, y: -10, w: 120, h: 100 },
          fill: "red",
        },
      ],
      100,
      80,
    );
    for (const index of [buildHitTestIndex(tree), buildInspectHitTestIndex(tree)]) {
      for (const [x, y] of [
        [0, 40],
        [100, 40],
        [50, 0],
        [50, 80],
        [0, 0],
        [100, 80],
      ]) {
        expect(index.queryTopmost(x!, y!)).toBeNull();
        expect(index.queryCandidates(x!, y!)).toEqual([]);
      }
      expect(index.queryTopmost(0.25, 40)?.nodeId).toBe("paint");
      expect(index.queryCandidates(0.25, 40)[0]?.source.nodeId).toBe("paint");
    }
  });
});
