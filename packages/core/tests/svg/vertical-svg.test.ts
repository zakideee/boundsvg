import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IR, IRNode } from "../../src/ir/types.js";
import type { Line, TextOutlinePath } from "../../src/text/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createFontedWasmHandle, emitSvgFromIrViaHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function makeGlyphPath(fill = "#000000"): TextOutlinePath {
  return {
    nodeId: "text-1",
    d: "M10,10L20,10L20,20L10,20Z",
    fill,
    glyphIds: [1],
    text: "あ",
    bbox: { x: 10, y: 10, w: 10, h: 10 },
  };
}

function makeTextIR(options: {
  writingMode?: "vertical-rl";
  lines: Line[];
  glyphPaths?: TextOutlinePath[];
}): IR {
  const textNode: IRNode = {
    type: "text",
    nodeId: "text-1",
    bbox: { x: 10, y: 10, w: 100, h: 100 },
    layoutBox: { x: 10, y: 10, w: 100, h: 100 },
    lineHeightPx: 19.2,
    lines: options.lines,
    glyphPaths: options.glyphPaths,
    font: "NotoSansJP",
    fontSizePx: 16,
    color: "#000000",
    textAlign: "start",
    writingMode: options.writingMode,
  };

  return {
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 200, h: 200 },
      children: [textNode],
    },
    drawOrder: ["text-1"],
    width: 200,
    height: 200,
    warnings: [],
  };
}

describe("SVG emitter text outlines", () => {
  it("emits text nodes as glyph path groups", () => {
    const ir = makeTextIR({
      writingMode: "vertical-rl",
      lines: [{ text: "あ", glyphs: [], width: 16, baselineY: 0 }],
      glyphPaths: [makeGlyphPath()],
    });

    const svg = emitSvgFromIrViaHandle(handle, ir);

    expect(svg).toContain('<g data-boundsvg-node-id="text-1"');
    expect(svg).toContain('data-boundsvg-text="あ"');
    expect(svg).toContain('aria-label="あ"');
    expect(svg).toContain('<path d="M10,10L20,10L20,20L10,20Z" fill="#000000"/>');
  });

  it("does not emit <text> or <tspan> for text nodes", () => {
    const ir = makeTextIR({
      lines: [{ text: "Hello", glyphs: [], width: 40, baselineY: 12 }],
      glyphPaths: [makeGlyphPath("#111111")],
    });

    const svg = emitSvgFromIrViaHandle(handle, ir);

    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("<tspan");
    expect(svg).toContain('fill="#111111"');
  });

  it("keeps stroke attributes on the wrapper group", () => {
    const ir = makeTextIR({
      lines: [{ text: "A", glyphs: [], width: 16, baselineY: 12 }],
      glyphPaths: [makeGlyphPath()],
    });
    const textNode = ir.root.children?.[0];
    if (!textNode) {
      throw new Error("missing text node");
    }
    textNode.stroke = "#ff0000";
    textNode.strokeWidth = 2;

    const svg = emitSvgFromIrViaHandle(handle, ir);

    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('paint-order="stroke"');
  });
});
