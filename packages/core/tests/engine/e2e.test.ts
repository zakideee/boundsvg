import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PngResolutionAdjustedWarning } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

// ---------------------------------------------------------------------------
// E2E Tests
//
// Rendering now runs entirely through the WASM backend: each engine is wired
// to a real fixture-fonted WASM handle.
// ---------------------------------------------------------------------------

let handle: WasmEngineHandle;

function findTextNode(node: IRNode, nodeId: string): IRTextNode | undefined {
  if (node.type === "text" && node.nodeId === nodeId) {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      const found = findTextNode(child, nodeId);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

describe("E2E integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("full pipeline: VNode → SVG", () => {
    const engine = createEngineFromHandle(handle);

    // Canvas(1280x720) > Flex(column) > Text + Text(fit=shrink) + Flex(row) > Box + Box
    const vnode = createElement(
      "Canvas",
      { width: 1280, height: 720, background: "#ffffff" },
      createElement(
        "Flex",
        { direction: "column", id: "main-flex" },
        createElement(
          "Text",
          { font: "NotoSansJP", fontSizePx: 32, color: "#000000", id: "title" },
          "テロップテスト",
        ),
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 24,
            color: "#333333",
            fit: "shrink",
            id: "subtitle",
          },
          "サブタイトルのテキストが長い場合は自動的に縮小されます",
        ),
        createElement(
          "Flex",
          { direction: "row", gap: 10, id: "bottom-row" },
          createElement("Box", {
            width: 200,
            height: 100,
            background: "#ff0000",
            id: "box-a",
          }),
          createElement("Box", {
            width: 200,
            height: 100,
            background: "#0000ff",
            id: "box-b",
          }),
        ),
      ),
    );

    const svg = engine.renderToSvg(vnode);

    // Verify SVG structure
    expect(svg).toContain("<svg");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 1280 720"');

    // Background colors should be present
    expect(svg).toContain("#ffffff");
    expect(svg).toContain("#ff0000");
    expect(svg).toContain("#0000ff");

    // Text content is embedded as glyph-path metadata (data-boundsvg-text)
    expect(svg).toContain("テロップテスト");
    expect(svg).toContain("サブタイトル");

    // Should be valid XML (basic check)
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it("emits post-layout transforms in scene-space with node-local origin", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement("Box", {
        id: "panel",
        width: 80,
        height: 40,
        background: "#ff0000",
        transform: {
          translateX: 12,
          rotateDeg: 15,
          scaleX: 1.5,
          originX: 40,
          originY: 20,
        },
      }),
    );

    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain(
      '<g data-boundsvg-node-id="panel" transform="translate(12 0) rotate(15 40 20) translate(40 20) scale(1.5 1) translate(-40 -20)">',
    );
    expect(svg).toContain('<rect x="0" y="0" width="80" height="40" fill="#ff0000"/>');
  });

  it("full pipeline: VNode → IR → hitTest", () => {
    const engine = createEngineFromHandle(handle);

    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          color: "#000000",
          id: "target-text",
        },
        "テスト",
      ),
    );

    const ir = engine.renderToIR(vnode);

    // IR should have structure
    expect(ir.root).toBeDefined();
    expect(ir.drawOrder.length).toBeGreaterThan(0);
    expect(ir.width).toBe(400);
    expect(ir.height).toBe(300);

    // Hit test on the text node
    const hit = engine.hitTest(ir, 10, 10);
    expect(hit).toBe("target-text");
  });

  it("textPathMode:merged resolves fallback faces inside Rust", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        "Text",
        {
          font: "JetBrainsMono",
          fallback: ["NotoSansJP"],
          fontSizePx: 24,
          id: "target-text",
        },
        "A日",
      ),
    );

    const { svg, ir } = engine.renderToSvgAndIR(vnode, { textPathMode: "merged" });
    const textNode = findTextNode(ir.root, "target-text");
    expect(svg).toContain("<path");
    expect(textNode?.type).toBe("text");
    if (textNode?.type !== "text") {
      throw new TypeError("Expected resolved text node");
    }
    expect(textNode.glyphPaths).toHaveLength(1);
    expect(textNode.lines[0]?.positionedGlyphs?.map((glyph) => glyph.fontAlias)).toEqual([
      "JetBrainsMono",
      "NotoSansJP",
    ]);
  });

  it("renderToTextOutlines returns merged paths by default", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 120 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24, color: "#000000", id: "outline-text" },
        "abc",
      ),
    );

    const outlines = engine.renderToTextOutlines(vnode);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]!.nodeId).toBe("outline-text");
    expect(outlines[0]!.paths).toHaveLength(1);
    expect(outlines[0]!.paths[0]!.text).toBe("abc");
  });

  it("renderToTextOutlines supports textPathMode=glyphs", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 120 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24, color: "#000000", id: "outline-glyphs" },
        "abc",
      ),
    );

    const outlines = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" });
    expect(outlines).toHaveLength(1);
    expect(outlines[0]!.paths).toHaveLength(3);
    expect(outlines[0]!.paths.map((path) => path.text).join("")).toBe("abc");
  });

  it("renderCompiledToTextOutlines resolves a compiled text scene", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 120 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24, color: "#000000", id: "compiled-outline" },
        "abc",
      ),
    );

    const compiled = engine.compile(vnode, { textPathMode: "glyphs" });
    const outlines = engine.renderCompiledToTextOutlines(compiled);

    expect(outlines).toHaveLength(1);
    expect(outlines[0]!.nodeId).toBe("compiled-outline");
    expect(outlines[0]!.paths).toHaveLength(3);
    expect(outlines[0]!.paths.map((path) => path.text).join("")).toBe("abc");
  });

  it("Engine.dispose prevents further rendering", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement("Canvas", { width: 400, height: 300 });

    engine.renderToSvg(vnode); // Should work
    engine.dispose();
    expect(() => engine.renderToSvg(vnode)).toThrow("disposed");
  });

  it("renderToPng requires svgToPngFn", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement("Canvas", { width: 400, height: 300 });

    expect(() => engine.renderToPng(vnode)).toThrow("svgToPngFn is required");
  });

  it("renderToPng works with mock svgToPngFn", () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (_svg: string) => mockPng,
    });
    const vnode = createElement("Canvas", { width: 400, height: 300 });

    const png = engine.renderToPng(vnode);
    expect(png).toEqual(mockPng);
  });

  it("renderToPng auto-adjusts oversize resolution and emits warning callback", () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let capturedSvg = "";
    let capturedOptions: { scale?: number; oversizeBehavior?: "autoAdjust" | "error" } | undefined;
    const onAdjusted = vi.fn((warning: PngResolutionAdjustedWarning): void => {
      void warning;
    });
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (svg: string, options) => {
        capturedSvg = svg;
        capturedOptions = options;
        return mockPng;
      },
    });
    const vnode = createElement("Canvas", { width: 5000, height: 1000 });

    const png = engine.renderToPng(vnode, { scale: 1, onPngResolutionAdjusted: onAdjusted });
    expect(png).toEqual(mockPng);
    expect(capturedSvg).toContain('width="3840"');
    expect(capturedSvg).toContain('height="768"');
    expect(capturedOptions?.oversizeBehavior).toBe("autoAdjust");
    expect(capturedOptions?.scale).toBeUndefined();
    expect(onAdjusted).toHaveBeenCalledTimes(1);
    const warning = onAdjusted.mock.calls[0]?.[0];
    expect(warning).toBeDefined();
    expect(warning?.requestedScale).toBe(1);
    expect(warning?.appliedScale).toBeCloseTo(3840 / 5000, 6);
    expect(warning?.requestedWidth).toBe(5000);
    expect(warning?.requestedHeight).toBe(1000);
    expect(warning?.outputWidth).toBe(3840);
    expect(warning?.outputHeight).toBe(768);
  });

  it("renderToPng throws FatalError when rasterOversizeBehavior=error", () => {
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (_svg: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const vnode = createElement("Canvas", { width: 5000, height: 1000 });

    expect(() => engine.renderToPng(vnode, { scale: 1, rasterOversizeBehavior: "error" })).toThrow(
      FatalError,
    );
  });

  it("renderToPng scale is applied once (not forwarded to WASM options)", () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let capturedSvg = "";
    let capturedOptions: { scale?: number; oversizeBehavior?: "autoAdjust" | "error" } | undefined;
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (svg: string, options) => {
        capturedSvg = svg;
        capturedOptions = options;
        return mockPng;
      },
    });
    const vnode = createElement("Canvas", { width: 400, height: 300 });

    engine.renderToPng(vnode, { scale: 2 });
    expect(capturedSvg).toContain('width="800"');
    expect(capturedSvg).toContain('height="600"');
    expect(capturedOptions?.scale).toBeUndefined();
  });

  it("renderToPng forwards rasterBackground to the rasterizer", () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const captured: Array<{ background?: string } | undefined> = [];
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (_svg: string, options) => {
        captured.push(options);
        return mockPng;
      },
    });
    const vnode = createElement("Canvas", { width: 100, height: 100 });

    engine.renderToPng(vnode, { rasterBackground: "#ff00ff" });
    engine.renderToPng(vnode);

    expect(captured[0]?.background).toBe("#ff00ff");
    expect(captured[1]?.background).toBeUndefined();
  });

  it("renderToPng emits vertical text as glyph path outlines", () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let capturedSvg = "";
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (svg: string) => {
        capturedSvg = svg;
        return mockPng;
      },
    });

    const vnode = createElement(
      "Canvas",
      { width: 320, height: 240 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          color: "#000000",
          writingMode: "vertical-rl",
        },
        "（）。、",
      ),
    );

    engine.renderToPng(vnode);
    expect(capturedSvg).toContain('<path d="M');
    expect(capturedSvg).not.toContain("font-feature-settings:'vert' 1;");
  });

  it("renderToPng emits horizontal text as glyph path outlines", () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let capturedSvg = "";
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (svg: string) => {
        capturedSvg = svg;
        return mockPng;
      },
    });

    const vnode = createElement(
      "Canvas",
      { width: 320, height: 240 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          color: "#000000",
        },
        "テスト",
      ),
    );

    engine.renderToPng(vnode);
    expect(capturedSvg).toContain('<path d="M');
    expect(capturedSvg).not.toContain("<text");
    expect(capturedSvg).not.toContain("<tspan");
  });

  it("validation catches invalid trees", () => {
    const engine = createEngineFromHandle(handle);

    // Root must be Canvas
    const invalidVnode = createElement("Box", { width: 400, height: 300 });
    expect(() => engine.renderToSvg(invalidVnode)).toThrow();
  });

  it("skipValidation bypasses validation", () => {
    const engine = createEngineFromHandle(handle);

    // Box as root is invalid, but with skipValidation it should proceed
    // (it may still fail at layout, but it should not throw a validation error)
    const boxVnode = createElement("Box", { width: 400, height: 300 });
    // With skipValidation, the WASM layout engine should still handle it
    expect(() => engine.renderToSvg(boxVnode, { skipValidation: true })).not.toThrow();
  });

  it("skipValidation does not bypass Svg content security checks", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 100 },
      createElement("Svg", {
        width: 100,
        height: 50,
        content: `<svg><script>alert(1)</script></svg>`,
      }),
    );

    expect(() => engine.renderToSvg(vnode, { skipValidation: true })).toThrow(
      "Svg content contains disallowed markup",
    );
  });

  it("text with shrink fit produces valid SVG", () => {
    const engine = createEngineFromHandle(handle);

    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 48,
          fit: "shrink",
          maxLines: 1,
          color: "#000000",
          id: "shrink-text",
        },
        "この文章は長いので自動的に縮小されるはずです",
      ),
    );

    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain('data-boundsvg-node-id="shrink-text"');
    expect(svg).toContain('data-boundsvg-text="この文章は長いので自動的に縮小されるはずです"');
    expect(svg).toContain("<path");
  });

  it("textPathMode=merged emits glyph outlines instead of <text>", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 120 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24, color: "#000000", id: "path-text" },
        "abc",
      ),
    );

    const svg = engine.renderToSvg(vnode, { textPathMode: "merged" });
    expect(svg).toContain('<path d="M');
    expect(svg).not.toContain("<text ");
  });

  it("textPathMode=merged also converts vertical text to glyph outlines", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 200 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          color: "#000000",
          writingMode: "vertical-rl",
          id: "path-text-vertical",
        },
        "Aあ",
      ),
    );

    const svg = engine.renderToSvg(vnode, { textPathMode: "merged" });
    expect(svg).toContain('<path d="M');
    expect(svg).not.toContain("<text ");
    expect(svg).not.toContain("font-feature-settings:'vert' 1;");
  });
});
