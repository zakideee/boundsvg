import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatSvgCode } from "../../../../apps/playground-shared/html-utils.ts";
import { buildNodeLineMap } from "../../../../apps/playground-shared/svg-line-map.ts";
import { buildIRSourceIndex } from "../../src/ir/source-index.js";
import type { IR } from "../../src/ir/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { circularClip } from "../helpers/box-clip.js";
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
        ownership: { role: "source" },
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            ownership: { role: "source" },
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 240, h: 140 },
            children: [
              {
                ownership: { role: "source" },
                type: "text",
                nodeId: "title",
                bbox: { x: 32, y: 36, w: 120, h: 24 },
                layoutBox: { x: 32, y: 36, w: 120, h: 24 },
                font: "NotoSansJP",
                fontSizePx: 16,
                color: "#111111",
                textAlign: "start",
                lineHeightPx: 19.2,
                lines: [{ text: "Hello\nworld", glyphs: [], width: 60, baselineY: 18 }],
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
                ownership: { role: "source" },
                type: "image",
                nodeId: "thumb",
                bbox: { x: 32, y: 72, w: 80, h: 48 },
                src: "data:image/png;base64,AAAA",
                preserveAspectRatio: "xMidYMid meet",
              },
              {
                ownership: { role: "source" },
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

      width: 300,
      height: 200,
      warnings: [],
    };

    const formatted = formatSvgCode(emitSvgFromIrViaHandle(handle, ir));
    const lineMap = buildNodeLineMap(formatted, buildIRSourceIndex(ir));

    expect(lineMap.get(0)).toBeDefined();
    expect(lineMap.get(1)).toBeDefined();
    expect(lineMap.get(2)).toBeDefined();
    expect(lineMap.get(3)).toBeDefined();
    expect(lineMap.get(4)).toBeDefined();

    const rootRange = lineMap.get(0);
    const panelRange = lineMap.get(1);
    if (!rootRange || !panelRange) {
      throw new Error("expected root and panel ranges");
    }
    expect(rootRange.start).toBeLessThan(panelRange.start);
    expect(rootRange.end).toBeGreaterThan(panelRange.end);
  });
});

describe("anonymous and opaque SVG scopes", () => {
  it("maps duplicate source labels by occurrence through defs and inner clips", () => {
    const bbox = { x: 0, y: 0, w: 40, h: 30 };
    const ir: IR = {
      width: 40,
      height: 30,
      warnings: [],
      root: {
        type: "group",
        nodeId: "root",
        bbox,
        ownership: { role: "source" },
        children: [
          {
            type: "group",
            nodeId: "card",
            bbox,
            ownership: { role: "source" },
            children: [
              {
                type: "group",
                nodeId: "card:content",
                bbox,
                ownership: { role: "wrapper", placement: "inner", ownerNodeId: "card" },
                clip: circularClip(bbox, 0),
                children: [
                  {
                    type: "svg",
                    nodeId: "card",
                    bbox,
                    ownership: { role: "source" },
                    svgViewBox: "0 0 40 30",
                    preserveAspectRatio: "xMidYMid meet",
                    svgContent:
                      '<g data-boundsvg-role="source" data-boundsvg-node-index="4" data-boundsvg-source-index="4" data-boundsvg-node-id="card"><rect width="4" height="4"/></g>',
                  },
                ],
              },
              { type: "rect", nodeId: "card", bbox, ownership: { role: "source" }, fill: "blue" },
            ],
          },
        ],
      },
    };
    const formatted = formatSvgCode(emitSvgFromIrViaHandle(handle, ir));
    const lines = formatted.split("\n");
    const ranges = buildNodeLineMap(formatted, buildIRSourceIndex(ir));
    expect([...ranges.keys()].sort((left, right) => left - right)).toEqual([0, 1, 3, 4]);
    expect(ranges.get(0)?.start).toBeGreaterThan(0);
    expect(ranges.get(1)?.end).toBeGreaterThan(ranges.get(3)?.end ?? Infinity);
    expect(lines[ranges.get(4)?.start ?? -1]).toContain('data-boundsvg-node-index="4"');
    expect(lines[ranges.get(4)?.start ?? -1]).toContain('fill="blue"');
  });
});
