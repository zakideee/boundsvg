import { describe, expect, it } from "vitest";
import {
  buildTextSelectionMap,
  findTextCaretAtPoint,
  getTextRangeQuads,
} from "../../src/ir/text-selection.js";
import type { IR, IRNode } from "../../src/ir/types.js";
import type { TextOutlinePath } from "../../src/text/types.js";

function glyph(
  sourceStart: number,
  sourceEnd: number,
  bbox: TextOutlinePath["bbox"],
  sourceRole: TextOutlinePath["sourceRole"] = "content",
): TextOutlinePath {
  return {
    nodeId: "text",
    d: "M0 0Z",
    fill: "#000000",
    glyphIds: [sourceStart + 1],
    text: "字",
    bbox,
    sourceStart,
    sourceEnd,
    sourceRole,
  };
}

function makeIR(textNode: IRNode, rootTransform?: IRNode["transform"]): IR {
  return {
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 400, h: 300 },
      transform: rootTransform,
      children: [textNode],
    },
    drawOrder: [textNode.nodeId],
    width: 400,
    height: 300,
    warnings: [],
  };
}

describe("text selection map", () => {
  it("resolves horizontal carets and reverse ranges across lines", () => {
    const map = buildTextSelectionMap(
      makeIR({
        type: "text",
        nodeId: "text",
        bbox: { x: 10, y: 10, w: 40, h: 40 },
        writingMode: "horizontal-tb",
        glyphPaths: [
          glyph(0, 1, { x: 10, y: 10, w: 10, h: 16 }),
          glyph(1, 2, { x: 20, y: 10, w: 10, h: 16 }),
          glyph(2, 3, { x: 10, y: 30, w: 10, h: 16 }),
        ],
      }),
    );

    expect(findTextCaretAtPoint(map, "text", { svgX: 11, svgY: 12 })?.offset).toBe(0);
    expect(findTextCaretAtPoint(map, "text", { svgX: 29, svgY: 12 })?.offset).toBe(2);
    expect(getTextRangeQuads(map, "text", { start: 3, end: 1 })).toHaveLength(2);
  });

  it("uses the block axis correctly for vertical text and preserves ligature ranges", () => {
    const map = buildTextSelectionMap(
      makeIR({
        type: "text",
        nodeId: "text",
        bbox: { x: 40, y: 20, w: 24, h: 48 },
        writingMode: "vertical-rl",
        glyphPaths: [glyph(0, 2, { x: 40, y: 20, w: 18, h: 24 })],
      }),
    );

    expect(findTextCaretAtPoint(map, "text", { svgX: 45, svgY: 22 })?.offset).toBe(0);
    expect(findTextCaretAtPoint(map, "text", { svgX: 45, svgY: 42 })?.offset).toBe(2);
  });

  it("keeps ruby roles and base ranges in range queries", () => {
    const map = buildTextSelectionMap(
      makeIR({
        type: "text",
        nodeId: "text",
        bbox: { x: 10, y: 10, w: 40, h: 30 },
        glyphPaths: [
          glyph(0, 2, { x: 10, y: 20, w: 24, h: 16 }, "rubyBase"),
          glyph(0, 2, { x: 10, y: 10, w: 12, h: 8 }, "rubyAnnotation"),
          glyph(0, 2, { x: 22, y: 10, w: 12, h: 8 }, "rubyAnnotation"),
        ],
      }),
    );

    expect(
      getTextRangeQuads(map, "text", { start: 0, end: 2 }).map((quad) => quad.sourceRole),
    ).toEqual(["rubyBase", "rubyAnnotation", "rubyAnnotation"]);
  });

  it("returns canvas-space quads after ancestor scale and translation", () => {
    const map = buildTextSelectionMap(
      makeIR(
        {
          type: "text",
          nodeId: "text",
          bbox: { x: 10, y: 5, w: 10, h: 10 },
          glyphPaths: [glyph(0, 1, { x: 10, y: 5, w: 10, h: 10 })],
        },
        { translateX: 100, translateY: 20, scaleX: 2, scaleY: 2 },
      ),
    );

    const quad = getTextRangeQuads(map, "text", { start: 0, end: 1 })[0];
    expect(quad?.points).toEqual([
      { x: 120, y: 30 },
      { x: 140, y: 30 },
      { x: 140, y: 50 },
      { x: 120, y: 50 },
    ]);
  });
});
