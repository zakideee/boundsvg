import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Engine, type EngineOptions, type LayeredPngOptions } from "../../src/engine.js";
import { formatLayerFileName, sortLayersByPaintOrder } from "../../src/layered-svg.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createEngineFromHandle,
  createFontedWasmHandle,
  engineOptionsFromHandle,
} from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function createTestEngine() {
  return createEngineFromHandle(handle);
}

function createPngTestEngine(overrides: Partial<EngineOptions> = {}) {
  return createEngineFromHandle(handle, {
    svgToPngFn: vi.fn((_svg: string, _options) => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    ...overrides,
  });
}

function createTestScene() {
  return createElement(
    "Canvas",
    { width: 320, height: 200 },
    createElement("Box", {
      id: "bg",
      layer: "background",
      width: 320,
      height: 80,
      background: "#eeeeee",
    }),
    createElement(
      "Text",
      {
        id: "title",
        layer: "text",
        font: "NotoSansJP",
        fontSizePx: 20,
        color: "#111111",
      },
      "Hello",
    ),
  );
}

function createInlineRectScene() {
  return createElement(
    "Canvas",
    { width: 160, height: 60 },
    createElement(
      "Text",
      {
        id: "caret-text",
        layer: "text",
        font: "NotoSansJP",
        fontSizePx: 20,
        color: "#111111",
      },
      "A",
      createElement("InlineRect", {
        inlineSizePx: 4,
        blockSizePx: "line",
        color: "#2563eb",
      }),
    ),
  );
}

function createInlineDecorationScene(opacity?: number) {
  return createElement(
    "Canvas",
    { width: 160, height: 60 },
    createElement(
      "Text",
      {
        id: "decorated-text",
        layer: "text",
        font: "NotoSansJP",
        fontSizePx: 20,
        color: "#111111",
        ...(opacity === undefined ? {} : { opacity }),
      },
      createElement("Inline", { background: "#dc2626", paddingInline: [2, 2] }, "Alert"),
    ),
  );
}

describe("Engine.renderToLayeredSvg()", () => {
  it("splits explicit layers and preserves paint order", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement("Box", {
        id: "bg",
        layer: "background",
        width: 320,
        height: 80,
        background: "#eeeeee",
      }),
      createElement("Box", {
        id: "panel",
        layer: "textBox",
        width: 320,
        height: 60,
        background: "#111111",
      }),
      createElement(
        "Text",
        {
          id: "title",
          layer: "text",
          font: "NotoSansJP",
          fontSizePx: 20,
          color: "#ffffff",
        },
        "Hello",
      ),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.width).toBe(320);
    expect(result.height).toBe(200);
    expect(result.layers.map((layer) => layer.id)).toEqual(["background", "textBox", "text"]);
    expect(result.layers.map((layer) => layer.paintOrder)).toEqual([0, 1, 2]);
    expect(result.layers.map((layer) => layer.mode)).toEqual([
      "independent",
      "independent",
      "independent",
    ]);
    expect(result.layers[0]?.nodeIds).toEqual(["bg"]);
    expect(result.layers[1]?.nodeIds).toEqual(["panel"]);
    expect(result.layers[2]?.nodeIds).toEqual(["title"]);
    expect(result.layers[2]?.svg).toContain('data-boundsvg-node-id="title"');
    expect(result.manifest.layers).toHaveLength(3);
  });

  it("ignores non-drawing fragments when merging a layer's paint order", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 20, height: 20 },
      createElement("Box", {
        id: "x",
        layer: "x",
        position: "absolute",
        top: 0,
        left: 0,
        width: 20,
        height: 20,
        background: "#0000ff",
      }),
      createElement("Box", {
        id: "back",
        layer: "back",
        position: "absolute",
        top: 0,
        left: 0,
        width: 20,
        height: 20,
        background: "#00ff00",
      }),
      createElement("Box", {
        id: "empty",
        layer: "front",
        position: "absolute",
        top: 0,
        left: 0,
        width: 20,
        height: 20,
        overflow: "clip",
        borderRadius: 4,
      }),
      createElement("Box", {
        id: "front",
        layer: "front",
        position: "absolute",
        top: 0,
        left: 0,
        width: 20,
        height: 20,
        background: "#ff0000",
      }),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers.map((layer) => layer.id)).toEqual(["x", "back", "front"]);
    expect(result.layers.map((layer) => layer.paintOrder)).toEqual([0, 1, 2]);
    expect(sortLayersByPaintOrder(result.layers).map((layer) => layer.id)).toEqual([
      "x",
      "back",
      "front",
    ]);
  });

  it("reports paintOrder 0 for a layer that draws nothing, wherever it sits", () => {
    const engine = createTestEngine();
    // `overflow: "clip"` alone makes the box atomic without painting anything, so
    // it owns a layer yet contributes no `ir.drawOrder` entry. `findPaintOrder`
    // returns undefined for it and `buildManifestEntry` resolves that with `?? 0`.
    const ghost = () =>
      createElement("Box", {
        id: "ghost",
        layer: "ghost",
        width: 20,
        height: 20,
        overflow: "clip",
      });
    const drawA = () =>
      createElement("Box", {
        id: "a",
        layer: "a",
        width: 20,
        height: 20,
        background: "#0000ff",
      });
    const drawB = () =>
      createElement("Box", {
        id: "b",
        layer: "b",
        width: 20,
        height: 20,
        background: "#00ff00",
      });

    const first = engine.renderToLayeredSvg(
      createElement("Canvas", { width: 20, height: 20 }, ghost(), drawA(), drawB()),
    );
    const middle = engine.renderToLayeredSvg(
      createElement("Canvas", { width: 20, height: 20 }, drawA(), ghost(), drawB()),
    );
    const last = engine.renderToLayeredSvg(
      createElement("Canvas", { width: 20, height: 20 }, drawA(), drawB(), ghost()),
    );

    // The ghost layer reports 0 in every position, so the drawing layers keep
    // their real draw indices and never inherit it.
    expect(first.layers.map((layer) => layer.id)).toEqual(["ghost", "a", "b"]);
    expect(first.layers.map((layer) => layer.paintOrder)).toEqual([0, 0, 1]);
    expect(middle.layers.map((layer) => layer.id)).toEqual(["a", "ghost", "b"]);
    expect(middle.layers.map((layer) => layer.paintOrder)).toEqual([0, 0, 1]);
    expect(last.layers.map((layer) => layer.id)).toEqual(["a", "b", "ghost"]);

    // Only a trailing ghost makes the array non-monotonic, which is why sorting
    // by paintOrder moves it between the two drawing layers.
    expect(last.layers.map((layer) => layer.paintOrder)).toEqual([0, 1, 0]);
    expect(sortLayersByPaintOrder(last.layers).map((layer) => layer.id)).toEqual([
      "a",
      "ghost",
      "b",
    ]);

    // Harmless only because the ghost paints nothing: it emits a clip group while
    // both drawing layers emit a filled rect.
    expect(last.layers[0]?.svg).toContain("fill=");
    expect(last.layers[1]?.svg).toContain("fill=");
    expect(last.layers[2]?.svg).not.toContain("fill=");
  });

  it("keeps InlineRect fragments in the owning text layer", () => {
    const engine = createTestEngine();

    const result = engine.renderToLayeredSvg(createInlineRectScene());

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe("text");
    expect(result.layers[0]?.nodeIds).toEqual(["caret-text"]);
    expect(result.layers[0]?.svg).toContain(
      'data-boundsvg-node-id="caret-text:inline-rect:0:rect"',
    );
    expect(result.layers[0]?.svg).toContain('fill="#2563eb"');
  });

  it("keeps inline decorations in the owning text layer", () => {
    const engine = createTestEngine();

    const result = engine.renderToLayeredSvg(createInlineDecorationScene());

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe("text");
    expect(result.layers[0]?.nodeIds).toEqual(["decorated-text"]);
    expect(result.layers[0]?.svg).toContain('data-boundsvg-node-id="decorated-text:ibox0"');
    expect(result.layers[0]?.svg).toContain('fill="#dc2626"');
  });

  it("keeps inline decorations attributed to an atomic text owner", () => {
    const engine = createTestEngine();

    const result = engine.renderToLayeredSvg(createInlineDecorationScene(0.5));

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe("text");
    expect(result.layers[0]?.mode).toBe("atomic");
    expect(result.layers[0]?.nodeIds).toEqual(["decorated-text"]);
    expect(result.layers[0]?.collapsedFromLayers).toBeUndefined();
    expect(result.layers[0]?.warnings).toEqual([]);
    expect(result.layers[0]?.svg).toContain('data-boundsvg-node-id="decorated-text:ibox0"');
    expect(result.layers[0]?.svg).toContain('fill="#dc2626"');
  });

  it("preserves resolved off-center radial-gradient geometry in a layer", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 192, height: 108 },
      createElement("Box", {
        id: "radial-corner",
        layer: "background",
        width: 192,
        height: 108,
        background: "radial-gradient(circle at 100% 100%, red, blue)",
      }),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.svg).toContain(
      'gradientTransform="matrix(220.2907 0 0 220.2907 192 108)"',
    );
  });

  it("inherits layer from containers and keeps untagged nodes in default", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement(
        "Flex",
        { id: "panel", layer: "textBox" },
        createElement("Box", {
          id: "panel-bg",
          width: 320,
          height: 40,
          background: "#222222",
        }),
        createElement(
          "Text",
          {
            id: "title",
            layer: "text",
            font: "NotoSansJP",
            fontSizePx: 18,
            color: "#ffffff",
          },
          "Title",
        ),
      ),
      createElement("Box", {
        id: "fallback",
        width: 320,
        height: 40,
        background: "#cccccc",
      }),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers.map((layer) => layer.id)).toEqual(["textBox", "text", "default"]);
    expect(result.layers[0]?.nodeIds).toEqual(["panel-bg"]);
    expect(result.layers[1]?.nodeIds).toEqual(["title"]);
    expect(result.layers[2]?.nodeIds).toEqual(["fallback"]);
  });

  it("collapses cross-layer content under parent opacity into an atomic segment", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement(
        "Box",
        {
          id: "panel",
          layer: "textBox",
          width: 320,
          height: 80,
          background: "#111111",
          opacity: 0.5,
        },
        createElement(
          "Text",
          {
            id: "title",
            layer: "text",
            font: "NotoSansJP",
            fontSizePx: 18,
            color: "#ffffff",
          },
          "Title",
        ),
      ),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe("textBox");
    expect(result.layers[0]?.mode).toBe("atomic");
    expect(result.layers[0]?.collapsedFromLayers).toEqual(["text"]);
    expect(result.layers[0]?.nodeIds).toEqual(["panel", "title"]);
    expect(result.layers[0]?.warnings).toEqual(
      expect.arrayContaining([
        {
          code: "CROSSES_COMPOSITING_ISLAND",
          nodeId: "title",
          islandRootNodeId: "panel",
        },
        {
          code: "PARENT_OPACITY_PREVENTED_SPLIT",
          nodeId: "title",
          parentNodeId: "panel",
        },
      ]),
    );
  });

  it("forces clip and box-shadow islands to atomic", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement(
        "Box",
        {
          id: "clip-panel",
          layer: "textBox",
          width: 320,
          height: 60,
          background: "#111111",
          overflow: "clip",
        },
        createElement(
          "Text",
          {
            id: "clip-title",
            layer: "text",
            font: "NotoSansJP",
            fontSizePx: 18,
            color: "#ffffff",
          },
          "Clip",
        ),
      ),
      createElement(
        "Box",
        {
          id: "shadow-panel",
          layer: "textBox",
          width: 320,
          height: 60,
          background: "#222222",
          boxShadow: "0 4 8 0 rgba(0,0,0,0.2)",
        },
        createElement(
          "Text",
          {
            id: "shadow-title",
            layer: "text",
            font: "NotoSansJP",
            fontSizePx: 18,
            color: "#ffffff",
          },
          "Shadow",
        ),
      ),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.mode).toBe("atomic");
    expect(result.layers[0]?.warnings).toContainEqual({
      code: "CLIP_FORCED_ATOMIC",
      nodeId: "clip-panel",
    });
    expect(result.layers[0]?.warnings).toContainEqual({
      code: "BOX_SHADOW_FORCED_ATOMIC",
      nodeId: "shadow-panel",
    });
  });

  it("always treats Svg nodes as atomic", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 120, height: 120 },
      createElement("Svg", {
        id: "logo",
        layer: "vector",
        content: '<rect width="10" height="10" fill="#f00"/>',
        width: 10,
        height: 10,
      }),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe("vector");
    expect(result.layers[0]?.mode).toBe("atomic");
    expect(result.layers[0]?.warnings).toContainEqual({
      code: "SVG_SUBTREE_FORCED_ATOMIC",
      nodeId: "logo",
    });
  });

  it("transcribes data-boundsvg-part-id from svg content into manifest parts", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 120, height: 120 },
      createElement("Box", {
        id: "bg",
        layer: "background",
        width: 120,
        height: 40,
        background: "#eeeeee",
      }),
      createElement("Svg", {
        id: "badge",
        layer: "vector",
        content:
          '<svg viewBox="0 0 10 10">' +
          '<path d="M0 0H10V10H0Z" data-boundsvg-part-id="bg"/>' +
          '<path d="M2 2H8V8H2Z" data-boundsvg-part-id="a&amp;b"/>' +
          "</svg>",
        width: 10,
        height: 10,
      }),
    );

    const result = engine.renderToLayeredSvg(vnode);

    const vectorLayer = result.manifest.layers.find((layer) => layer.id === "vector");
    expect(vectorLayer?.parts).toEqual([
      { partId: "bg", nodeId: "badge" },
      { partId: "a&b", nodeId: "badge" },
    ]);
    // nodeIds contract is untouched and part-free layers omit the key
    expect(vectorLayer?.nodeIds).toEqual(["badge"]);
    const backgroundLayer = result.manifest.layers.find((layer) => layer.id === "background");
    expect(backgroundLayer?.parts).toBeUndefined();
  });

  it("preserves ancestor transforms across independent layered fragments", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement(
        "Box",
        {
          id: "panel",
          width: 200,
          height: 120,
          transform: { translateX: 14, rotateDeg: 10, originX: 100, originY: 60 },
        },
        createElement("Box", {
          id: "panel-bg",
          layer: "background",
          width: 200,
          height: 120,
          background: "#111111",
        }),
        createElement(
          "Text",
          {
            id: "title",
            layer: "text",
            font: "NotoSansJP",
            fontSizePx: 18,
            color: "#ffffff",
          },
          "Title",
        ),
      ),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers.map((layer) => layer.id)).toEqual(["background", "text"]);
    // Real layout: the 120-tall panel-bg flex-shrinks to make room for the
    // title line below it (21.6px), leaving 98px; the title's width/height come
    // from real "Title" NotoSansJP-18px metrics.
    expect(result.layers[0]?.bbox).toEqual({ x: 0, y: 0, width: 200, height: 98 });
    expect(result.layers[1]?.bbox?.x).toBe(0);
    expect(result.layers[1]?.bbox?.y).toBe(98);
    expect(result.layers[1]?.bbox?.width).toBeCloseTo(37.602, 3);
    expect(result.layers[1]?.bbox?.height).toBeCloseTo(21.6, 6);
    expect(result.layers[0]?.svg).toContain('transform="translate(14 0) rotate(10 100 60)"');
    expect(result.layers[1]?.svg).toContain('transform="translate(14 0) rotate(10 100 60)"');
    expect(result.layers[0]?.mode).toBe("independent");
    expect(result.layers[1]?.mode).toBe("independent");
  });

  it("keeps interleaved logical layers as separate paint-order segments", () => {
    const engine = createTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement("Box", {
        id: "a1",
        layer: "text",
        width: 320,
        height: 40,
        background: "#111111",
      }),
      createElement("Box", {
        id: "b1",
        layer: "textBox",
        width: 320,
        height: 40,
        background: "#222222",
      }),
      createElement("Box", {
        id: "a2",
        layer: "text",
        width: 320,
        height: 40,
        background: "#333333",
      }),
    );

    const result = engine.renderToLayeredSvg(vnode);

    expect(result.layers.map((layer) => layer.id)).toEqual(["text", "textBox", "text"]);
    expect(result.layers.map((layer) => layer.paintOrder)).toEqual([0, 1, 2]);
  });

  it("does not validate composition unless explicitly enabled", () => {
    const validateLayeredSvgCompositionFn = vi.fn(() => ({
      differentPixels: 0,
      differenceRatio: 0,
      width: 320,
      height: 200,
    }));
    const engine = createEngineFromHandle(handle, {
      validateLayeredSvgCompositionFn,
    });

    const result = engine.renderToLayeredSvg(createTestScene());

    expect(validateLayeredSvgCompositionFn).not.toHaveBeenCalled();
    expect(result.compositionValidation).toBeUndefined();
  });

  it("stores passed composition validation results when enabled", () => {
    const validateLayeredSvgCompositionFn = vi.fn(() => ({
      differentPixels: 0,
      differenceRatio: 0,
      width: 320,
      height: 200,
    }));
    const engine = createEngineFromHandle(handle, {
      validateLayeredSvgCompositionFn,
    });

    const result = engine.renderToLayeredSvg(createTestScene(), {
      validateComposition: { enabled: true },
    });

    expect(validateLayeredSvgCompositionFn).toHaveBeenCalledTimes(1);
    expect(result.compositionValidation).toEqual({
      status: "passed",
      differentPixels: 0,
      differenceRatio: 0,
      thresholdPixels: 0,
      thresholdRatio: 0,
      width: 320,
      height: 200,
    });
  });

  it("warns when composition validation detects a mismatch", () => {
    const warnings: string[] = [];
    const engine = createEngineFromHandle(handle, {
      validateLayeredSvgCompositionFn: () => ({
        differentPixels: 12,
        differenceRatio: 0.01,
        width: 320,
        height: 200,
      }),
    });

    const result = engine.renderToLayeredSvg(createTestScene(), {
      validateComposition: { enabled: true },
      onWarning: (warning) => warnings.push(warning.code),
    });

    expect(result.compositionValidation?.status).toBe("mismatched");
    expect(warnings).toEqual(["LAYERED_COMPOSITION_MISMATCH"]);
  });

  it("returns skipped validation and warns when validator is unavailable", () => {
    const warnings: string[] = [];
    const engine = createTestEngine();

    const result = engine.renderToLayeredSvg(createTestScene(), {
      validateComposition: { enabled: true },
      onWarning: (warning) => warnings.push(warning.code),
    });

    expect(result.compositionValidation).toEqual({
      status: "skipped",
      differentPixels: 0,
      differenceRatio: 0,
      thresholdPixels: 0,
      thresholdRatio: 0,
      width: 320,
      height: 200,
    });
    expect(warnings).toEqual(["LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE"]);
  });

  it("returns skipped validation and warns when validator throws", () => {
    const warnings: string[] = [];
    const engine = createEngineFromHandle(handle, {
      validateLayeredSvgCompositionFn: () => {
        throw new Error("validation failed");
      },
    });

    const result = engine.renderToLayeredSvg(createTestScene(), {
      validateComposition: { enabled: true },
      onWarning: (warning) => warnings.push(warning.code),
    });

    expect(result.compositionValidation?.status).toBe("skipped");
    expect(warnings).toEqual(["LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE"]);
  });
});

describe("Engine.renderToLayeredPng()", () => {
  it("returns full-canvas PNG layers with manifest entries", () => {
    const engine = createPngTestEngine();

    const result = engine.renderToLayeredPng(createTestScene(), { scale: 2 });

    expect(result.width).toBe(320);
    expect(result.height).toBe(200);
    expect(result.pixelWidth).toBe(640);
    expect(result.pixelHeight).toBe(400);
    expect(result.layers.map((layer) => layer.id)).toEqual(["background", "text"]);
    expect(result.layers.every((layer) => layer.png instanceof Uint8Array)).toBe(true);
    expect(result.manifest.layers.map((layer) => layer.id)).toEqual(["background", "text"]);
  });

  it.each([
    "onWarning",
    "onPngResolutionAdjusted",
  ] as const)("snapshots layer metadata, render options, and EngineOptions before %s mutation", (callbackName) => {
    const originalPng = new Uint8Array([1, 2, 3]);
    const originalEncoder = vi.fn(() => originalPng);
    const replacementEmitter = vi.fn(() => "<svg/>");
    const replacementValidator = vi.fn(() => ({
      differentPixels: 1,
      differenceRatio: 1,
      width: 1,
      height: 1,
    }));
    const originalEmitTransport = vi.fn((irJson: string, optionsJson: string) =>
      handle.emitSvgFromIr(irJson, optionsJson),
    );
    const originalValidator = vi.fn(() => ({
      differentPixels: 0,
      differenceRatio: 0,
      width: 5_000,
      height: 1_000,
    }));
    const engineOptions = engineOptionsFromHandle(handle, {
      emitSvgFromIrFn: originalEmitTransport,
      svgToPngFn: originalEncoder,
      validateLayeredSvgCompositionFn: originalValidator,
      fontFamilies: { sansSerif: "before-family" },
    });
    const engine = new Engine(engineOptions);
    const textNode = createElement(
      "Text",
      {
        id: "subject",
        layer: "before",
        font: "JetBrainsMono",
        fontSizePx: 16,
      },
      "A日本語",
    );
    const vnode = createElement("Canvas", { width: 5_000, height: 1_000 }, textNode);
    let callbackCalls = 0;
    const renderOptions: LayeredPngOptions = {
      scale: 1,
      resourceIdPrefix: "before-prefix",
      generator: { name: "before-generator", version: "1.0.0" },
      validateComposition: { enabled: true },
    };
    const mutateCallerOwnedState = (): void => {
      callbackCalls += 1;
      textNode.props.layer = "after";
      renderOptions.scale = Number.MAX_VALUE;
      renderOptions.resourceIdPrefix = "after-prefix";
      renderOptions.generator = { name: "after-generator", version: "9.9.9" };
      renderOptions.validateComposition = { enabled: false };
      engineOptions.emitSvgFromIrFn = replacementEmitter;
      engineOptions.svgToPngFn = undefined;
      engineOptions.validateLayeredSvgCompositionFn = replacementValidator;
      if (engineOptions.fontFamilies) {
        engineOptions.fontFamilies.sansSerif = "after-family";
      }
    };
    if (callbackName === "onWarning") {
      renderOptions.onWarning = mutateCallerOwnedState;
    } else {
      renderOptions.onPngResolutionAdjusted = mutateCallerOwnedState;
    }

    const result = engine.renderToLayeredPng(vnode, renderOptions);

    expect(callbackCalls).toBeGreaterThan(0);
    expect(result.pixelWidth).toBe(3_840);
    expect(result.pixelHeight).toBe(768);
    expect(result.layers.map((layer) => layer.id)).toEqual(["before"]);
    expect(result.layers.map((layer) => layer.png)).toEqual([originalPng]);
    expect(result.compositionValidation?.status).toBe("passed");
    expect(originalEncoder).toHaveBeenCalledOnce();
    expect(originalEncoder.mock.calls[0]?.[1]?.generator).toEqual({
      name: "before-generator",
      version: "1.0.0",
    });
    expect(originalEmitTransport).toHaveBeenCalled();
    expect(replacementEmitter).not.toHaveBeenCalled();
    expect(originalValidator).toHaveBeenCalledOnce();
    expect(replacementValidator).not.toHaveBeenCalled();
    expect(originalValidator.mock.calls[0]?.[0]?.options?.fontFamilies).toEqual({
      sansSerif: "before-family",
    });
    for (const emitCall of originalEmitTransport.mock.calls) {
      const emitOptions = JSON.parse(emitCall[1]) as {
        resourceIdPrefix?: string;
        scale?: number;
      };
      expect(emitOptions.resourceIdPrefix).toBe("before-prefix");
      expect(emitOptions.scale).toBe(0.768);
    }
  }, 30_000);

  it("does not pass png background to layer rasterization", () => {
    const svgToPngFn = vi.fn((_svg: string, options) => {
      expect(options?.background).toBeUndefined();
      return new Uint8Array([1, 2, 3]);
    });
    const engine = createPngTestEngine({ svgToPngFn });

    engine.renderToLayeredPng(createTestScene());

    expect(svgToPngFn).toHaveBeenCalledTimes(2);
  });

  it("rasterizes InlineRect fragments from the owning text layer", () => {
    const svgToPngFn = vi.fn((_svg: string, _options) => new Uint8Array([1, 2, 3]));
    const engine = createPngTestEngine({ svgToPngFn });

    const result = engine.renderToLayeredPng(createInlineRectScene());

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe("text");
    expect(result.layers[0]?.nodeIds).toEqual(["caret-text"]);
    expect(svgToPngFn).toHaveBeenCalledOnce();
    expect(svgToPngFn.mock.calls[0]?.[0]).toContain(
      'data-boundsvg-node-id="caret-text:inline-rect:0:rect"',
    );
    expect(svgToPngFn.mock.calls[0]?.[0]).toContain('fill="#2563eb"');
  });

  it("rasterizes inline decorations from the owning text layer", () => {
    const svgToPngFn = vi.fn((_svg: string, _options) => new Uint8Array([1, 2, 3]));
    const engine = createPngTestEngine({ svgToPngFn });

    const result = engine.renderToLayeredPng(createInlineDecorationScene());

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe("text");
    expect(result.layers[0]?.nodeIds).toEqual(["decorated-text"]);
    expect(svgToPngFn).toHaveBeenCalledOnce();
    expect(svgToPngFn.mock.calls[0]?.[0]).toContain('data-boundsvg-node-id="decorated-text:ibox0"');
    expect(svgToPngFn.mock.calls[0]?.[0]).toContain('fill="#dc2626"');
  });

  it("auto-adjusts oversize resolution once for all layers", () => {
    const onAdjusted = vi.fn();
    const svgToPngFn = vi.fn((_svg: string, _options) => new Uint8Array([1, 2, 3]));
    const engine = createPngTestEngine({ svgToPngFn });
    const vnode = createElement(
      "Canvas",
      { width: 5000, height: 1000 },
      createElement("Box", {
        id: "bg",
        layer: "background",
        width: 5000,
        height: 1000,
        background: "#eeeeee",
      }),
    );

    const result = engine.renderToLayeredPng(vnode, {
      scale: 1,
      onPngResolutionAdjusted: onAdjusted,
    });

    expect(result.pixelWidth).toBe(3840);
    expect(result.pixelHeight).toBe(768);
    expect(onAdjusted).toHaveBeenCalledTimes(1);
    expect(svgToPngFn).toHaveBeenCalledTimes(1);
    expect(svgToPngFn.mock.calls[0]?.[1]?.oversizeBehavior).toBe("autoAdjust");
  });

  it("throws when layered PNG resolution exceeds cap with error behavior", () => {
    const engine = createPngTestEngine();

    expect(() =>
      engine.renderToLayeredPng(createElement("Canvas", { width: 5000, height: 1000 }), {
        scale: 1,
        rasterOversizeBehavior: "error",
      }),
    ).toThrow("PNG resolution exceeded 4K-equivalent cap");
  });

  it("returns composition validation results for layered PNG", () => {
    const engine = createPngTestEngine({
      validateLayeredSvgCompositionFn: () => ({
        differentPixels: 0,
        differenceRatio: 0,
        width: 320,
        height: 200,
      }),
    });

    const result = engine.renderToLayeredPng(createTestScene(), {
      validateComposition: { enabled: true },
    });

    expect(result.compositionValidation?.status).toBe("passed");
  });

  it("keeps interleaved logical layers as separate PNG segments", () => {
    const engine = createPngTestEngine();
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 200 },
      createElement("Box", {
        id: "a1",
        layer: "text",
        width: 320,
        height: 40,
        background: "#111111",
      }),
      createElement("Box", {
        id: "b1",
        layer: "textBox",
        width: 320,
        height: 40,
        background: "#222222",
      }),
      createElement("Box", {
        id: "a2",
        layer: "text",
        width: 320,
        height: 40,
        background: "#333333",
      }),
    );

    const result = engine.renderToLayeredPng(vnode);

    expect(result.layers.map((layer) => layer.id)).toEqual(["text", "textBox", "text"]);
    expect(result.layers.map((layer) => layer.paintOrder)).toEqual([0, 1, 2]);
  });
});

describe("sortLayersByPaintOrder()", () => {
  it("sorts layers by paint order ascending (back-to-front)", () => {
    const layers = [
      { id: "a", paintOrder: 2 },
      { id: "b", paintOrder: 0 },
      { id: "c", paintOrder: 1 },
    ];
    expect(sortLayersByPaintOrder(layers).map((layer) => layer.id)).toEqual(["b", "c", "a"]);
  });

  it("preserves original order for layers with the same paint order", () => {
    const layers = [
      { id: "a", paintOrder: 1 },
      { id: "b", paintOrder: 1 },
      { id: "c", paintOrder: 0 },
    ];
    expect(sortLayersByPaintOrder(layers).map((layer) => layer.id)).toEqual(["c", "a", "b"]);
  });

  it("returns a new array without mutating the input", () => {
    const layers = [
      { id: "a", paintOrder: 1 },
      { id: "b", paintOrder: 0 },
    ];
    const sorted = sortLayersByPaintOrder(layers);
    expect(sorted).not.toBe(layers);
    expect(layers.map((layer) => layer.id)).toEqual(["a", "b"]);
  });
});

describe("formatLayerFileName()", () => {
  it("zero-pads the index to 3 digits", () => {
    expect(formatLayerFileName(0, "foo", "svg")).toBe("000-foo.svg");
    expect(formatLayerFileName(7, "foo", "png")).toBe("007-foo.png");
    expect(formatLayerFileName(42, "foo", "svg")).toBe("042-foo.svg");
  });

  it("keeps alphanumerics, underscores, and hyphens", () => {
    expect(formatLayerFileName(1, "my_Layer-1", "svg")).toBe("001-my_Layer-1.svg");
  });

  it("replaces disallowed characters with hyphens and collapses runs", () => {
    expect(formatLayerFileName(1, "foo / bar", "svg")).toBe("001-foo-bar.svg");
    expect(formatLayerFileName(1, "日本語", "png")).toBe("001--.png");
  });

  it("falls back to 'layer' when the sanitized id is empty", () => {
    expect(formatLayerFileName(3, "", "svg")).toBe("003-layer.svg");
    expect(formatLayerFileName(3, "   ", "png")).toBe("003-layer.png");
  });
});
