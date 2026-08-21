import { describe, expect, it } from "vitest";
import {
  buildTextMap,
  findLineAtPoint,
  getAllText,
  getAncestorText,
  getNodeText,
} from "../../src/ir/text-map.js";
import type { IR, IRNode } from "../../src/ir/types.js";

function makeIR(nodes: IRNode[], width = 800, height = 600): IR {
  const drawOrder: string[] = [];
  function collectLeaves(node: IRNode): void {
    if (node.type !== "group") {
      drawOrder.push(node.nodeId);
    }
    if (node.children) {
      for (const child of node.children) {
        collectLeaves(child);
      }
    }
  }
  for (const n of nodes) {
    collectLeaves(n);
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

function textNode(
  nodeId: string,
  bbox: { x: number; y: number; w: number; h: number },
  lines: Array<{ text: string; baselineY: number; width: number }>,
  extra?: {
    writingMode?: "horizontal-tb" | "vertical-rl";
    fontSizePx?: number;
    lineHeightPx?: number;
  },
): IRNode {
  return {
    type: "text",
    nodeId,
    bbox,
    lines: lines.map((l) => ({
      text: l.text,
      glyphs: [],
      width: l.width,
      baselineY: l.baselineY,
    })),
    writingMode: extra?.writingMode,
    fontSizePx: extra?.fontSizePx,
    lineHeightPx: extra?.lineHeightPx,
  };
}

// ---------------------------------------------------------------------------
// buildTextMap
// ---------------------------------------------------------------------------

describe("buildTextMap", () => {
  it("returns empty maps for IR with no text nodes", () => {
    const ir = makeIR([{ type: "rect", nodeId: "box1", bbox: { x: 0, y: 0, w: 100, h: 50 } }]);
    const map = buildTextMap(ir);
    expect(map.nodes.size).toBe(0);
    expect(map.childTextMap.size).toBe(0);
  });

  it("collects a single text node", () => {
    const ir = makeIR([
      textNode("txt1", { x: 10, y: 10, w: 200, h: 30 }, [
        { text: "Hello", baselineY: 20, width: 100 },
      ]),
    ]);
    const map = buildTextMap(ir);
    expect(map.nodes.size).toBe(1);
    const entry = map.nodes.get("txt1");
    expect(entry?.text).toBe("Hello");
    expect(entry?.lines).toHaveLength(1);
    expect(entry?.lines[0].lineIndex).toBe(0);
  });

  it("joins multi-line text with newlines", () => {
    const ir = makeIR([
      textNode("txt1", { x: 0, y: 0, w: 200, h: 60 }, [
        { text: "Line 1", baselineY: 15, width: 100 },
        { text: "Line 2", baselineY: 35, width: 120 },
      ]),
    ]);
    const map = buildTextMap(ir);
    expect(map.nodes.get("txt1")?.text).toBe("Line 1\nLine 2");
  });

  it("builds childTextMap for groups", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "group1",
            bbox: { x: 0, y: 0, w: 400, h: 300 },
            children: [
              textNode("txt1", { x: 10, y: 10, w: 100, h: 20 }, [
                { text: "A", baselineY: 15, width: 50 },
              ]),
              textNode("txt2", { x: 10, y: 40, w: 100, h: 20 }, [
                { text: "B", baselineY: 15, width: 60 },
              ]),
            ],
          },
        ],
      },
      drawOrder: ["txt1", "txt2"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    expect(map.childTextMap.get("group1")).toEqual(["txt1", "txt2"]);
    expect(map.childTextMap.get("root")).toEqual(["txt1", "txt2"]);
  });

  it("builds parentMap correctly", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "g1",
            bbox: { x: 0, y: 0, w: 400, h: 300 },
            children: [
              textNode("txt1", { x: 10, y: 10, w: 100, h: 20 }, [
                { text: "Hello", baselineY: 15, width: 50 },
              ]),
            ],
          },
        ],
      },
      drawOrder: ["txt1"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    expect(map.parentMap.get("txt1")).toBe("g1");
    expect(map.parentMap.get("g1")).toBe("root");
    expect(map.parentMap.get("root")).toBeUndefined();
  });

  it("skips wrapper ancestors that reuse the same nodeId", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "card",
            bbox: { x: 0, y: 0, w: 400, h: 300 },
            children: [
              {
                type: "group",
                nodeId: "title",
                bbox: { x: 0, y: 0, w: 200, h: 40 },
                children: [
                  textNode("title", { x: 10, y: 10, w: 100, h: 20 }, [
                    { text: "Hello", baselineY: 15, width: 50 },
                  ]),
                ],
              },
            ],
          },
        ],
      },
      drawOrder: ["title"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    expect(map.parentMap.get("title")).toBe("card");
  });

  it("preserves writingMode and font metadata", () => {
    const ir = makeIR([
      textNode(
        "vtxt",
        { x: 0, y: 0, w: 30, h: 200 },
        [{ text: "縦書き", baselineY: 15, width: 200 }],
        { writingMode: "vertical-rl", fontSizePx: 16, lineHeightPx: 24 },
      ),
    ]);
    const map = buildTextMap(ir);
    const entry = map.nodes.get("vtxt");
    expect(entry?.writingMode).toBe("vertical-rl");
    expect(entry?.fontSizePx).toBe(16);
    expect(entry?.lineHeightPx).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// getNodeText
// ---------------------------------------------------------------------------

describe("getNodeText", () => {
  it("returns text for existing node", () => {
    const ir = makeIR([
      textNode("txt1", { x: 0, y: 0, w: 100, h: 20 }, [
        { text: "Hello", baselineY: 15, width: 50 },
      ]),
    ]);
    const map = buildTextMap(ir);
    expect(getNodeText(map, "txt1")).toBe("Hello");
  });

  it("returns null for nonexistent node", () => {
    const ir = makeIR([]);
    const map = buildTextMap(ir);
    expect(getNodeText(map, "missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAncestorText
// ---------------------------------------------------------------------------

describe("getAncestorText", () => {
  it("returns concatenated text from ancestor with multiple text children", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "card",
            bbox: { x: 0, y: 0, w: 400, h: 200 },
            children: [
              textNode("title", { x: 10, y: 10, w: 200, h: 30 }, [
                { text: "Title", baselineY: 20, width: 100 },
              ]),
              textNode("body", { x: 10, y: 50, w: 200, h: 30 }, [
                { text: "Body text", baselineY: 20, width: 150 },
              ]),
            ],
          },
        ],
      },
      drawOrder: ["title", "body"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    expect(getAncestorText(map, "title")).toBe("Title\n\nBody text");
  });

  it("returns null when no ancestor has multiple text children", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          textNode("only", { x: 0, y: 0, w: 100, h: 20 }, [
            { text: "Alone", baselineY: 15, width: 50 },
          ]),
        ],
      },
      drawOrder: ["only"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    expect(getAncestorText(map, "only")).toBeNull();
  });

  it("returns null for nonexistent node", () => {
    const ir = makeIR([]);
    const map = buildTextMap(ir);
    expect(getAncestorText(map, "missing")).toBeNull();
  });

  it("skips single-child ancestors and finds the multi-child one", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "outer",
            bbox: { x: 0, y: 0, w: 400, h: 400 },
            children: [
              {
                type: "group",
                nodeId: "inner",
                bbox: { x: 0, y: 0, w: 200, h: 200 },
                children: [
                  textNode("deep", { x: 10, y: 10, w: 100, h: 20 }, [
                    { text: "Deep", baselineY: 15, width: 50 },
                  ]),
                ],
              },
              textNode("sibling", { x: 10, y: 50, w: 100, h: 20 }, [
                { text: "Sibling", baselineY: 15, width: 60 },
              ]),
            ],
          },
        ],
      },
      drawOrder: ["deep", "sibling"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    // "inner" has 1 text child, "outer" has 2 → should return outer's text
    expect(getAncestorText(map, "deep")).toBe("Deep\n\nSibling");
  });

  it("returns ancestor text when a wrapper group and text node share the same nodeId", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "card",
            bbox: { x: 0, y: 0, w: 400, h: 300 },
            children: [
              {
                type: "group",
                nodeId: "title",
                bbox: { x: 0, y: 0, w: 200, h: 40 },
                children: [
                  textNode("title", { x: 10, y: 10, w: 100, h: 20 }, [
                    { text: "Title", baselineY: 15, width: 50 },
                  ]),
                ],
              },
              {
                type: "group",
                nodeId: "body",
                bbox: { x: 0, y: 50, w: 200, h: 40 },
                children: [
                  textNode("body", { x: 10, y: 60, w: 100, h: 20 }, [
                    { text: "Body", baselineY: 15, width: 50 },
                  ]),
                ],
              },
            ],
          },
        ],
      },
      drawOrder: ["title", "body"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    expect(getAncestorText(map, "title")).toBe("Title\n\nBody");
  });
});

// ---------------------------------------------------------------------------
// getAllText
// ---------------------------------------------------------------------------

describe("getAllText", () => {
  it("returns all text in draw order", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          textNode("t1", { x: 0, y: 0, w: 100, h: 20 }, [
            { text: "First", baselineY: 15, width: 50 },
          ]),
          { type: "rect", nodeId: "bg", bbox: { x: 0, y: 0, w: 800, h: 600 } },
          textNode("t2", { x: 0, y: 30, w: 100, h: 20 }, [
            { text: "Second", baselineY: 15, width: 60 },
          ]),
        ],
      },
      drawOrder: ["t1", "bg", "t2"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildTextMap(ir);
    expect(getAllText(map, ir.drawOrder)).toBe("First\n\nSecond");
  });

  it("returns empty string when no text nodes", () => {
    const ir = makeIR([{ type: "rect", nodeId: "box", bbox: { x: 0, y: 0, w: 100, h: 50 } }]);
    const map = buildTextMap(ir);
    expect(getAllText(map, ir.drawOrder)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// findLineAtPoint
// ---------------------------------------------------------------------------

describe("findLineAtPoint", () => {
  it("returns the single line for a single-line node", () => {
    const ir = makeIR([
      textNode("txt", { x: 10, y: 20, w: 200, h: 30 }, [
        { text: "Only line", baselineY: 20, width: 100 },
      ]),
    ]);
    const map = buildTextMap(ir);
    const line = findLineAtPoint(map, "txt", { svgX: 50, svgY: 35 });
    expect(line?.text).toBe("Only line");
  });

  it("returns correct line in a multi-line node", () => {
    const ir = makeIR([
      textNode("txt", { x: 0, y: 0, w: 200, h: 80 }, [
        { text: "Line A", baselineY: 15, width: 100 },
        { text: "Line B", baselineY: 35, width: 120 },
        { text: "Line C", baselineY: 55, width: 110 },
      ]),
    ]);
    const map = buildTextMap(ir);

    // Top area → Line A
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 5 })?.text).toBe("Line A");
    // Between A and B midpoint (25) → Line A for y=20
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 20 })?.text).toBe("Line A");
    // Past midpoint of A/B → Line B
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 30 })?.text).toBe("Line B");
    // Middle of B-C → Line B for y=40
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 40 })?.text).toBe("Line B");
    // Past midpoint of B/C → Line C
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 50 })?.text).toBe("Line C");
    // Near bottom → Line C
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 75 })?.text).toBe("Line C");
  });

  it("returns null when point is outside bbox", () => {
    const ir = makeIR([
      textNode("txt", { x: 10, y: 20, w: 100, h: 40 }, [
        { text: "Text", baselineY: 15, width: 80 },
      ]),
    ]);
    const map = buildTextMap(ir);
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 5 })).toBeNull();
    expect(findLineAtPoint(map, "txt", { svgX: 50, svgY: 65 })).toBeNull();
  });

  it("returns null for nonexistent node", () => {
    const ir = makeIR([]);
    const map = buildTextMap(ir);
    expect(findLineAtPoint(map, "missing", { svgX: 0, svgY: 0 })).toBeNull();
  });

  it("returns null for text node with no lines", () => {
    const ir = makeIR([textNode("empty", { x: 0, y: 0, w: 100, h: 20 }, [])]);
    const map = buildTextMap(ir);
    expect(findLineAtPoint(map, "empty", { svgX: 50, svgY: 10 })).toBeNull();
  });

  it("handles vertical writing mode", () => {
    // Vertical: columns go right-to-left. baselineY represents X offset from right edge.
    const ir = makeIR([
      textNode(
        "vtxt",
        { x: 10, y: 0, w: 80, h: 200 },
        [
          { text: "Column 1", baselineY: 15, width: 200 },
          { text: "Column 2", baselineY: 45, width: 200 },
        ],
        { writingMode: "vertical-rl" },
      ),
    ]);
    const map = buildTextMap(ir);

    // Column 1 is rightmost: x = 10 + 80 - 15 = 75
    // Column 2 is leftmost:  x = 10 + 80 - 45 = 45
    // Midpoint between columns: (75 + 45) / 2 = 60
    // svgX=70 → Column 1 (rightmost)
    expect(findLineAtPoint(map, "vtxt", { svgX: 70, svgY: 100 })?.text).toBe("Column 1");
    // svgX=30 → Column 2 (leftmost)
    expect(findLineAtPoint(map, "vtxt", { svgX: 30, svgY: 100 })?.text).toBe("Column 2");
  });
});
