/**
 * Locks XML-escaping of every user-controlled string that reaches the WASM
 * SVG emitter (`emit_svg_from_ir`). A regression here is an injection
 * vector: emitted SVG is often inlined into HTML, so an unescaped attribute
 * could break out into markup.
 *
 * Prerequisite: `pnpm build:wasm`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IR, IRNode } from "../../src/ir/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createFontedWasmHandle, emitSvgFromIrViaHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function makeIR(children: IRNode[], drawOrder: string[]): IR {
  return {
    root: { type: "group", nodeId: "root", bbox: { x: 0, y: 0, w: 100, h: 100 }, children },
    drawOrder,
    width: 100,
    height: 100,
    warnings: [],
  };
}

const BREAKOUT = '"><script>alert(1)</script>';

function expectNoRawBreakout(svg: string): void {
  expect(svg).not.toContain("<script>");
  expect(svg).not.toContain('"><');
}

describe("emitter XML escaping (injection surface)", () => {
  it("escapes a malicious Path d string", () => {
    const ir = makeIR(
      [
        {
          type: "path",
          nodeId: "p",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          pathData: `M0 0 L10 10${BREAKOUT}`,
          fill: "#000000",
        },
      ],
      ["p"],
    );
    const svg = emitSvgFromIrViaHandle(handle, ir);
    expectNoRawBreakout(svg);
    expect(svg).toContain("&lt;script&gt;");
  });

  it("escapes malicious fill and stroke colors", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: "r",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          fill: BREAKOUT,
          stroke: BREAKOUT,
          strokeWidth: 1,
        },
      ],
      ["r"],
    );
    expectNoRawBreakout(emitSvgFromIrViaHandle(handle, ir));
  });

  it("escapes a malicious node id", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: `evil${BREAKOUT}`,
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          fill: "#000000",
        },
      ],
      [`evil${BREAKOUT}`],
    );
    expectNoRawBreakout(emitSvgFromIrViaHandle(handle, ir));
  });

  it("escapes malicious text content and aria-label", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "t",
          bbox: { x: 0, y: 0, w: 100, h: 20 },
          font: "F",
          fontSizePx: 16,
          color: "#000000",
          textAlign: "start",
          layoutBox: { x: 0, y: 0, w: 100, h: 20 },
          lineHeightPx: 19.2,
          lines: [{ text: BREAKOUT, glyphs: [], width: 50, baselineY: 16 }],
          glyphPaths: [
            {
              nodeId: "t",
              d: `M0 0${BREAKOUT}`,
              fill: "#000000",
              glyphIds: [1],
              text: BREAKOUT,
              bbox: { x: 0, y: 0, w: 10, h: 10 },
            },
          ],
        },
      ],
      ["t"],
    );
    const svg = emitSvgFromIrViaHandle(handle, ir);
    expectNoRawBreakout(svg);
  });
});
