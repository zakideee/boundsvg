import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatSvgCode } from "../../../../apps/playground-shared/html-utils.ts";
import { buildNodeLineMap } from "../../../../apps/playground-shared/svg-line-map.ts";
import type { IR } from "../../src/ir/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createFontedWasmHandle, emitSvgFromIrViaHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

describe("buildNodeLineMap", () => {
  it("maps root, container, and leaf representative elements", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 240, h: 140 },
            children: [
              {
                type: "text",
                nodeId: "title",
                bbox: { x: 32, y: 36, w: 120, h: 24 },
                layoutBox: { x: 32, y: 36, w: 120, h: 24 },
                font: "NotoSansJP",
                fontSizePx: 16,
                color: "#111111",
                textAlign: "start",
                lineHeightPx: 19.2,
                lines: [{ text: "Hello", glyphs: [], width: 60, baselineY: 18 }],
                glyphPaths: [
                  {
                    nodeId: "title",
                    d: "M0 0L10 0",
                    fill: "#111111",
                    glyphIds: [1],
                    text: "Hello",
                    bbox: { x: 32, y: 36, w: 60, h: 20 },
                  },
                ],
              },
              {
                type: "image",
                nodeId: "thumb",
                bbox: { x: 32, y: 72, w: 80, h: 48 },
                src: "data:image/png;base64,AAAA",
                preserveAspectRatio: "xMidYMid meet",
              },
              {
                type: "svg",
                nodeId: "badge",
                bbox: { x: 140, y: 72, w: 40, h: 40 },
                svgContent: '<circle cx="20" cy="20" r="18"/>',
                svgViewBox: "0 0 40 40",
                preserveAspectRatio: "xMidYMid meet",
              },
            ],
          },
        ],
      },
      drawOrder: ["title", "thumb", "badge"],
      width: 300,
      height: 200,
      warnings: [],
    };

    const formatted = formatSvgCode(emitSvgFromIrViaHandle(handle, ir));
    const lineMap = buildNodeLineMap(formatted);

    expect(lineMap.get("root")).toBeDefined();
    expect(lineMap.get("panel")).toBeDefined();
    expect(lineMap.get("title")).toBeDefined();
    expect(lineMap.get("thumb")).toBeDefined();
    expect(lineMap.get("badge")).toBeDefined();

    const rootRange = lineMap.get("root");
    const panelRange = lineMap.get("panel");
    if (!rootRange || !panelRange) {
      throw new Error("expected root and panel ranges");
    }
    expect(rootRange.start).toBeLessThan(panelRange.start);
    expect(rootRange.end).toBeGreaterThan(panelRange.end);
  });
});
