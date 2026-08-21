import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IR, IRNode } from "../../src/index.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createFontedWasmHandle, emitSvgFromIrViaHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

describe("Japanese typesetting integration", () => {
  it("renders vertical text as path-only output without vert CSS hacks", () => {
    const textNode: IRNode = {
      type: "text",
      nodeId: "t1",
      bbox: { x: 0, y: 0, w: 100, h: 200 },
      layoutBox: { x: 0, y: 0, w: 100, h: 200 },
      lineHeightPx: 19.2,
      lines: [{ text: "縦書きテスト", glyphs: [], width: 96, baselineY: 0 }],
      glyphPaths: [
        {
          nodeId: "t1",
          d: "M0,0L10,0L10,10L0,10Z",
          fill: "#000",
          glyphIds: [1],
          text: "縦",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
        },
      ],
      font: "NotoSansJP",
      fontSizePx: 16,
      color: "#000",
      textAlign: "start",
      writingMode: "vertical-rl",
    };

    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 100, h: 200 },
        children: [textNode],
      },
      drawOrder: ["t1"],
      width: 100,
      height: 200,
      warnings: [],
    };

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('<path d="M0,0L10,0L10,10L0,10Z" fill="#000"/>');
    expect(svg).not.toContain("font-feature-settings:'vert' 1;");
    expect(svg).not.toContain("<text");
  });
});
