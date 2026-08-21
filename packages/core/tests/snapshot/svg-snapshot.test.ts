import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createEngineFromHandle,
  createFontedWasmHandle,
  emitSvgFromIrViaHandle,
} from "../helpers/wasm-render-engine.js";
import { normalizeSvg } from "./normalize-svg.js";

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

// ---------------------------------------------------------------------------
// SVG Snapshot tests
// ---------------------------------------------------------------------------

describe("SVG Snapshot Tests", () => {
  it("Canvas with background", () => {
    const vnode = createElement("Canvas", {
      width: 800,
      height: 600,
      background: "#ffffff",
    });
    const svg = engine.renderToSvg(vnode);
    const normalized = normalizeSvg(svg);

    expect(normalized).toContain('viewBox="0 0 800 600"');
    expect(normalized).toContain('fill="#ffffff"');
    expect(normalized).toMatchSnapshot();
  });

  it("Box with background and border", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", {
        id: "styled-box",
        width: 200,
        height: 100,
        background: "#ff0000",
        borderColor: "#000000",
        borderWidth: 2,
        borderRadius: 8,
      }),
    );
    const svg = engine.renderToSvg(vnode);
    const normalized = normalizeSvg(svg);

    expect(normalized).toContain('fill="#ff0000"');
    expect(normalized).toContain('stroke="#000000"');
    expect(normalized).toContain('rx="8"');
    expect(normalized).toMatchSnapshot();
  });

  it("Text single line", () => {
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          id: "txt",
          font: "NotoSansJP",
          fontSizePx: 24,
          color: "#333333",
        },
        "テストテキスト",
      ),
    );
    const svg = engine.renderToSvg(vnode);
    const normalized = normalizeSvg(svg);

    expect(normalized).toContain('data-boundsvg-text="テストテキスト"');
    expect(normalized).toContain('fill="#333333"');
    expect(normalized).toContain("<path");
    expect(normalized).toMatchSnapshot();
  });

  it("overflow=clip with clipPath", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", {
        id: "clipped",
        width: 200,
        height: 100,
        overflow: "clip",
        background: "#0000ff",
      }),
    );
    const svg = engine.renderToSvg(vnode);
    const normalized = normalizeSvg(svg);

    expect(normalized).toContain("<clipPath");
    expect(normalized).toContain("clip-path=");
    expect(normalized).toMatchSnapshot();
  });

  it("debug mode adds overlays", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", {
        id: "box1",
        width: 200,
        height: 100,
        background: "#ff0000",
      }),
    );
    const svg = engine.renderToSvg(vnode, { debug: true });
    const normalized = normalizeSvg(svg);

    expect(normalized).toContain("debug-overlay");
    // A box is a leaf rect: only its specified (allotted) layout bounds are drawn.
    expect(normalized).toContain('stroke="#38bdf8"');
    expect(normalized).toMatchSnapshot();
  });

  it("debug text overlay draws both specified and measured glyph bounds", () => {
    const svg = emitSvgFromIrViaHandle(
      handle,
      {
        root: {
          type: "group",
          nodeId: "root",
          bbox: { x: 0, y: 0, w: 200, h: 120 },
          children: [
            {
              type: "text",
              nodeId: "txt1",
              bbox: { x: 20, y: 10, w: 80, h: 40 },
              layoutBox: { x: 20, y: 10, w: 80, h: 40 },
              font: "NotoSansJP",
              fontSizePx: 32,
              color: "#000000",
              textAlign: "start",
              lineHeightPx: 40,
              lines: [
                {
                  text: "A",
                  glyphs: [],
                  width: 40,
                  baselineY: 20,
                },
              ],
              glyphPaths: [
                {
                  nodeId: "txt1",
                  d: "M50 30L60 30L60 42L50 42Z",
                  fill: "#000000",
                  glyphIds: [1],
                  text: "A",
                  bbox: { x: 50, y: 30, w: 10, h: 12 },
                },
              ],
            },
          ],
        },
        drawOrder: ["txt1"],
        width: 200,
        height: 120,
        warnings: [],
      },
      { debug: true },
    );

    const normalized = normalizeSvg(svg);

    // Measured glyph bounds (red) — the actual rendered ink extent.
    expect(normalized).toContain('stroke="#ff0000"');
    expect(normalized).toContain('x="50"');
    expect(normalized).toContain('width="10"');
    expect(normalized).toContain('height="12"');

    // Specified layout box (cyan) — the region the text was allotted to fit into.
    expect(normalized).toContain('stroke="#38bdf8"');
    expect(normalized).toContain('x="20"');
    expect(normalized).toContain('width="80"');
    expect(normalized).toContain('height="40"');

    // Computed line layout box (green) — the line placement inside the text node.
    expect(normalized).toContain('stroke="#22c55e"');
    expect(normalized).toContain('width="40"');

    // Baseline (amber) — high-contrast on dark preview backgrounds.
    expect(normalized).toContain('stroke="#fbbf24"');
  });

  it("scale adds width/height to SVG element", () => {
    let capturedSvg = "";
    const scaleEngine = createEngineFromHandle(handle, {
      svgToPngFn: (svg: string) => {
        capturedSvg = svg;
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      },
    });
    const vnode = createElement("Canvas", { width: 400, height: 300 });
    scaleEngine.renderToPng(vnode, { scale: 2 });
    expect(capturedSvg).toContain('width="800"');
    expect(capturedSvg).toContain('height="600"');
  });
});
