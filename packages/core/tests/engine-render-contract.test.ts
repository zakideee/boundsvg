/**
 * Render-pipeline contract tests for the WASM-backed engine.
 *
 * The Rust pipeline is the only emit path, so these tests pin the public
 * contracts around it: the transport envelopes (`render_to_ir` /
 * `render_to_svg`), structured error and warning rehydration, PNG oversize
 * handling, layered composition, the transport-availability guard, and the
 * TS-side consumption of wasm-built IRs (hit-test, text selection).
 *
 * Prerequisite: `pnpm build:wasm`.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createEngine, createEngineAsync, type Engine } from "../src/engine.js";
import { FatalError, RecoverableError } from "../src/errors.js";
import { hitTest } from "../src/ir/hit-test.js";
import { buildTextSelectionMap, getTextRangeQuads } from "../src/ir/text-selection.js";
import type { IR } from "../src/ir/types.js";
import { buildLayoutTransportJson } from "../src/layout/taffy-layout-adapter.js";
import { initNodeWasm } from "../src/node.js";
import type { SceneNode } from "../src/scene/types.js";
import { toCssSafeResourceId } from "../src/svg/resource-id.js";
import { createElement } from "../src/vnode/create-element.js";
import { createWasmEngineInstance, type WasmEngineHandle } from "../src/wasm/index.js";
import {
  assertConformancePrerequisites,
  loadConformanceFonts,
} from "./conformance/conformance-engine.js";
import { CONFORMANCE_SCENES } from "./conformance/scenes/index.js";

const COVERAGE_GEOMETRY = {
  viewBox: { width: 10, height: 10 },
  root: { kind: "path" as const, nodeId: "solo", d: "M0 0 H10 V10 H0 Z" },
};

let engine: Engine;
let handle: WasmEngineHandle;

beforeAll(async () => {
  assertConformancePrerequisites();
  await initNodeWasm();
  engine = await createEngineAsync({
    fonts: loadConformanceFonts(),
    geometries: [{ id: "contract-geometry", doc: COVERAGE_GEOMETRY }],
  });
  handle = createWasmEngineInstance();
  for (const font of loadConformanceFonts()) {
    handle.registerFont(font.data, {
      alias: font.alias,
      weight: font.weight,
      style: font.style,
    });
  }
});

function captureFatal(run: () => unknown): FatalError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("expected the render to throw");
}

describe("wasm render envelopes", () => {
  it("rejects lossy SceneDocument values before a direct checkpoint render", () => {
    const scene = {
      type: "Canvas",
      width: 120,
      height: 80,
      children: [],
      onTick: () => undefined,
    } as unknown as SceneNode;

    const error = captureFatal(() => engine.renderToSvg(scene, { skipValidation: true }));
    expect(error).toMatchObject({
      code: "SCENE_NOT_SERIALIZABLE",
      stage: "engine",
      context: expect.objectContaining({ path: "scene.onTick" }),
    });
  });

  it("render_to_ir returns IR while string-only render_to_svg returns minimal metadata", () => {
    const scene = createElement(
      "Canvas",
      { width: 120, height: 80 },
      createElement("Image", { src: "https://example.com/ref.png", width: 60, height: 40 }),
    );
    const transportJson = buildLayoutTransportJson(scene, {
      shapeRegistry: { geometries: new Map(), symbols: new Map() },
    });

    const irEnvelope = JSON.parse(handle.renderToIr(transportJson, "{}")) as {
      ir: Omit<IR, "warnings">;
      warnings: unknown[];
    };
    expect(irEnvelope.ir.root).toBeDefined();
    expect(irEnvelope.ir.width).toBe(120);
    expect(Object.hasOwn(irEnvelope.ir, "warnings")).toBe(false);
    expect(irEnvelope.warnings.length).toBeGreaterThan(0);

    const svgEnvelope = JSON.parse(handle.renderToSvg(transportJson, JSON.stringify({}))) as {
      svg: string;
      ir: Omit<IR, "warnings"> | null;
      warnings: unknown[];
      textNodeIds: string[];
    };
    expect(svgEnvelope.svg).toContain("<svg");
    expect(svgEnvelope.ir).toBeUndefined();
    expect(svgEnvelope.textNodeIds).toEqual([]);
    expect(svgEnvelope.warnings).toEqual(irEnvelope.warnings);

    const resolvedSvgEnvelope = JSON.parse(
      handle.renderToSvg(transportJson, JSON.stringify({ returnResolvedIr: true })),
    ) as {
      svg: string;
      ir: Omit<IR, "warnings"> | null;
      warnings: unknown[];
      textNodeIds: string[];
    };
    expect(resolvedSvgEnvelope.ir?.root).toBeDefined();
    expect(Object.hasOwn(resolvedSvgEnvelope.ir ?? {}, "warnings")).toBe(false);
    expect(resolvedSvgEnvelope.warnings).toEqual(irEnvelope.warnings);
  });

  it("enforces structured TextOnPath spans at the Rust trust boundary", () => {
    const scene = createElement(
      "Canvas",
      { width: 240, height: 80 },
      createElement(
        "TextOnPath",
        { d: "M0 40L240 40", width: 240, height: 80, font: "NotoSansJP", fontSizePx: 20 },
        createElement("Inline", { fontWeight: 700 }, "path"),
      ),
    );
    const transport = JSON.parse(buildLayoutTransportJson(scene, {})) as {
      root: {
        children: Array<{
          textPath?: {
            spans: Array<Record<string, unknown>>;
            sourceItemCount: number;
            inlineCount: number;
          };
        }>;
      };
    };
    const textPath = transport.root.children[0]?.textPath;
    expect(textPath).toBeDefined();
    if (!textPath) {
      throw new Error("expected TextOnPath transport");
    }
    delete textPath.spans[0]?.textShadows;
    let structuredError: { code?: string } | null = null;
    try {
      handle.renderToIr(JSON.stringify(transport), "{}");
    } catch (error) {
      structuredError = JSON.parse(String(error)) as { code?: string };
    }
    expect(structuredError?.code).toBe("TEXT_PATH_INVALID");

    const invalidEmptySpanTransport = JSON.parse(buildLayoutTransportJson(scene, {})) as {
      root: {
        children: Array<{
          textPath?: {
            spans: Array<Record<string, unknown>>;
            sourceItemCount: number;
          };
        }>;
      };
    };
    const invalidEmptySpanTextPath = invalidEmptySpanTransport.root.children[0]?.textPath;
    if (!invalidEmptySpanTextPath) {
      throw new Error("expected TextOnPath transport");
    }
    invalidEmptySpanTextPath.spans.unshift({
      ...invalidEmptySpanTextPath.spans[0],
      text: "",
      fontSizePx: 0,
    });
    invalidEmptySpanTextPath.sourceItemCount += 1;
    let invalidEmptySpanError: { code?: string } | null = null;
    try {
      handle.renderToIr(JSON.stringify(invalidEmptySpanTransport), "{}");
    } catch (error) {
      invalidEmptySpanError = JSON.parse(String(error)) as { code?: string };
    }
    expect(invalidEmptySpanError?.code).toBe("TEXT_PATH_INVALID");

    const oldTransport = JSON.parse(buildLayoutTransportJson(scene, {})) as {
      root: { children: Array<{ textPath?: Record<string, unknown> }> };
    };
    const oldTextPath = oldTransport.root.children[0]?.textPath;
    if (!oldTextPath) {
      throw new Error("expected TextOnPath transport");
    }
    delete oldTextPath.spans;
    delete oldTextPath.sourceItemCount;
    delete oldTextPath.inlineCount;
    oldTextPath.content = "path";
    expect(() => handle.renderToIr(JSON.stringify(oldTransport), "{}")).toThrow();
  });

  it("orders TextOnPath wire budgets and recovers after boundary-plus-one failures", () => {
    const scene = createElement(
      "Canvas",
      { width: 240, height: 80 },
      createElement(
        "TextOnPath",
        {
          d: "M0 40L240 40",
          width: 240,
          height: 80,
          font: "NotoSansJP",
          fontSizePx: 20,
        },
        createElement("Inline", { color: "#0ea5e9" }, "path"),
      ),
    );
    const transportJson = buildLayoutTransportJson(scene, {});
    const healthyBytes = handle.renderToIr(transportJson, "{}");
    const withWireCounts = (
      sourceItemCount: number,
      inlineCount: number,
      textDecorationRangeCount: number,
    ): string => {
      const transport = JSON.parse(transportJson) as {
        root: {
          children: Array<{
            textPath?: {
              sourceItemCount: number;
              inlineCount: number;
              textDecorationRangeCount?: number;
            };
          }>;
        };
      };
      const textPath = transport.root.children[0]?.textPath;
      if (!textPath) {
        throw new Error("expected TextOnPath transport");
      }
      textPath.sourceItemCount = sourceItemCount;
      textPath.inlineCount = inlineCount;
      textPath.textDecorationRangeCount = textDecorationRangeCount;
      return JSON.stringify(transport);
    };
    const captureStructuredCode = (wireTransport: string): string => {
      try {
        handle.renderToIr(wireTransport, "{}");
      } catch (error) {
        return String((JSON.parse(String(error)) as { code?: string }).code ?? "");
      }
      return "";
    };

    expect(() => handle.renderToIr(withWireCounts(65_535, 4_095, 4_095), "{}")).not.toThrow();
    expect(() => handle.renderToIr(withWireCounts(65_536, 4_096, 4_096), "{}")).not.toThrow();
    expect(captureStructuredCode(withWireCounts(65_537, 4_097, 4_097))).toBe(
      "TEXT_PATH_SOURCE_LIMIT",
    );
    expect(captureStructuredCode(withWireCounts(65_536, 4_096, 4_097))).toBe(
      "TEXT_DECORATION_RANGE_LIMIT",
    );
    expect(handle.renderToIr(transportJson, "{}")).toBe(healthyBytes);
  });

  it("throws a structured JSON error envelope for unresolvable registry references", () => {
    const scene = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Shape", { geometryId: "missing-geometry", width: 40, height: 40 }),
    );
    // The serializer omits the doc but carries the id, so the WASM side sees
    // the unresolvable reference.
    const transportJson = buildLayoutTransportJson(scene, {
      shapeRegistry: { geometries: new Map(), symbols: new Map() },
    });
    let structuredError: { code?: string; message?: string; stage?: string } | null = null;
    try {
      handle.renderToIr(transportJson, "{}");
    } catch (error) {
      structuredError = JSON.parse(String(error)) as typeof structuredError;
    }
    expect(structuredError?.code).toBe("SHAPE_GEOMETRY_NOT_FOUND");
    expect(structuredError?.message).toBe(
      'Shape references unknown geometryId "missing-geometry".',
    );
    expect(structuredError?.stage).toBe("validate");
  });
});

describe("engine render contract", () => {
  it("rehydrates wasm-path warnings as RecoverableError instances", () => {
    const scene = createElement(
      "Canvas",
      { width: 120, height: 80 },
      createElement("Image", { src: "https://example.com/ref.png", width: 60, height: 40 }),
    );
    const delivered: RecoverableError[] = [];
    engine.renderToSvg(scene, { onWarning: (warning) => delivered.push(warning) });
    expect(delivered.length).toBeGreaterThan(0);
    for (const warning of delivered) {
      expect(warning).toBeInstanceOf(RecoverableError);
    }
    expect(delivered[0]?.code).toBe("IMAGE_SRC_NOT_EMBEDDED");
    expect(delivered[0]?.stage).toBe("ir");

    const ir = engine.renderToIR(scene);
    for (const warning of ir.warnings) {
      expect(warning).toBeInstanceOf(RecoverableError);
    }
  });

  it("throws FatalError with the engine diagnosis for unresolvable registry references", () => {
    const scene = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Shape", { geometryId: "missing-geometry", width: 40, height: 40 }),
    );
    const fatal = captureFatal(() => engine.renderToSvg(scene));
    expect(fatal.code).toBe("SHAPE_GEOMETRY_NOT_FOUND");
    expect(fatal.message).toBe('Shape references unknown geometryId "missing-geometry".');
  });

  it("rejects non-finite scales and reports unavailable fonts from Rust", () => {
    const scene = createElement(
      "Canvas",
      { width: 100, height: 50 },
      createElement("Text", { font: "NotoSansJP", fontSizePx: 16 }, "x"),
    );
    // Non-finite scale must not survive the JSON transport as null/scale=1.
    for (const scale of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const fatal = captureFatal(() => engine.renderToSvg(scene, { scale }));
      expect(fatal.code).toBe("SVG_INVALID_SCALE");
    }

    const unknownAlias = createElement(
      "Canvas",
      { width: 100, height: 50 },
      createElement("Text", { font: "UnknownAlias", fontSizePx: 16 }, "abc"),
    );
    const aliasError = captureFatal(() => engine.renderToSvg(unknownAlias));
    expect(aliasError).toMatchObject({
      code: "TEXT_FONT_UNAVAILABLE",
      message: "No requested font is available for text layout.",
      stage: "text",
      context: {
        operation: "renderTextLayout",
        runIndex: 0,
        requestedAliases: ["UnknownAlias"],
        omittedAliasCount: 0,
        fontWeight: 400,
        fontStyle: "normal",
      },
    });
  });

  it("handles PNG oversize per rasterOversizeBehavior", () => {
    const scene = createElement(
      "Canvas",
      { width: 5000, height: 1000, background: "#eef" },
      createElement("Box", { width: 400, height: 400, background: "#345" }),
    );

    const adjustments: Array<{ appliedScale: number; outputWidth: number; outputHeight: number }> =
      [];
    const callbackOrder: string[] = [];
    const png = engine.renderToPng(scene, {
      scale: 2,
      onPngResolutionAdjusted: (warning) => {
        callbackOrder.push("adjusted");
        adjustments.push(warning);
      },
      onWarning: (warning) => {
        if (warning.code === "PNG_RESOLUTION_ADJUSTED") {
          callbackOrder.push("warning");
        }
      },
    });
    expect(png.length).toBeGreaterThan(0);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]?.appliedScale).toBeCloseTo(3840 / 5000, 6);
    expect(adjustments[0]?.outputWidth).toBe(3840);
    expect(adjustments[0]?.outputHeight).toBe(768);
    expect(callbackOrder).toEqual(["adjusted", "warning"]);

    const limitError = captureFatal(() =>
      engine.renderToPng(scene, { scale: 2, rasterOversizeBehavior: "error" }),
    );
    expect(limitError.code).toBe("PNG_PIXEL_LIMIT");
  });

  it("sanitizes lone-surrogate resource id prefixes before the JSON transport", () => {
    const scene = createElement(
      "Canvas",
      { width: 120, height: 80 },
      createElement("Box", {
        width: 60,
        height: 40,
        background: "linear-gradient(to right, #f00, #00f)",
      }),
    );
    const prefix = "x\uD800-";
    const svg = engine.renderToSvg(scene, { resourceIdPrefix: prefix });
    expect(svg).toContain("<svg");
    expect(svg).toContain(`id="${toCssSafeResourceId(prefix)}`);
  });
});

describe("layered render contract", () => {
  const layeredScene = () =>
    createElement(
      "Canvas",
      { width: 100, height: 50 },
      createElement("Box", { width: 40, height: 20, background: "#f00", layer: "a" }),
    );

  it("validates a composition-safe layer split against the single render", () => {
    const simpleLayers = createElement(
      "Canvas",
      { width: 160, height: 90, background: "#ffffff" },
      createElement("Box", { width: 160, height: 90, background: "#dbeafe", layer: "backdrop" }),
      createElement("Box", { width: 60, height: 40, background: "#1d4ed8", layer: "content" }),
    );
    const layered = engine.renderToLayeredSvg(simpleLayers, {
      validateComposition: { enabled: true },
    });
    // The canvas background paints in the implicit "default" layer.
    expect(layered.layers.map((layer) => layer.id)).toEqual(["default", "backdrop", "content"]);
    expect(layered.compositionValidation?.status).toBe("passed");
    expect(layered.manifest.layers).toHaveLength(3);
  });

  it("rejects non-finite and overflowing layered scales as INVALID_NUMBER", () => {
    // Non-finite scale must not silently fall back to 1 through the JSON
    // transport; overflowing finite scales must fail identically too.
    for (const scale of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
      const fatal = captureFatal(() => engine.renderToLayeredSvg(layeredScene(), { scale }));
      expect(fatal.code).toBe("INVALID_NUMBER");
    }
  });

  it("rasterizes layer SVGs from the same wasm emitter used by both layered passes", () => {
    const layeredPng = engine.renderToLayeredPng(layeredScene());
    expect(layeredPng.layers).toHaveLength(1);
    expect(layeredPng.layers[0]?.png.length).toBeGreaterThan(0);

    // A sentinel emitter must be what reaches the rasterizer.
    const sentinelHandle = createWasmEngineInstance();
    try {
      const sentinelSvg = '<svg xmlns="http://www.w3.org/2000/svg" data-emitter="wasm"/>';
      const rasterizerInputs: string[] = [];
      const sentinelEngine = createEngine({
        computeLayoutFn: sentinelHandle.createComputeLayoutFn(),
        renderToIrFn: (inputJson, optionsJson) => sentinelHandle.renderToIr(inputJson, optionsJson),
        renderToSvgFn: (inputJson, optionsJson) =>
          sentinelHandle.renderToSvg(inputJson, optionsJson),
        emitSvgFromIrFn: () => sentinelSvg,
        resolveIrFn: (irJson, optionsJson) => sentinelHandle.resolveIr(irJson, optionsJson),
        preflightIrFn: (irJson) => sentinelHandle.preflightIr(irJson),
        preflightRasterSceneFn: (irJson, optionsJson) =>
          sentinelHandle.preflightRasterScene(irJson, optionsJson),
        resolveAndEmitSvgFromIrFn: () => sentinelSvg,
        prepareSceneFn: (irJson, optionsJson) => sentinelHandle.prepareScene(irJson, optionsJson),
        svgToPngFn: (svg) => {
          rasterizerInputs.push(svg);
          return new Uint8Array([1]);
        },
      });
      sentinelEngine.renderToLayeredPng(layeredScene());
      expect(rasterizerInputs.length).toBeGreaterThan(0);
      expect(rasterizerInputs.every((svg) => svg === sentinelSvg)).toBe(true);
    } finally {
      sentinelHandle.dispose();
    }
  });
});

describe("transport availability guard", () => {
  it("throws WASM_BACKEND_UNAVAILABLE on render without the transports", () => {
    const layoutOnlyEngine = createEngine({
      computeLayoutFn: () => {
        throw new Error("unused");
      },
    });
    const scene = createElement("Canvas", { width: 10, height: 10 });
    for (const render of [
      () => layoutOnlyEngine.renderToSvg(scene),
      () => layoutOnlyEngine.compile(scene),
      () => layoutOnlyEngine.renderToPng(scene),
      () => layoutOnlyEngine.renderToWebp(scene),
      () => layoutOnlyEngine.renderToLayeredSvg(scene),
    ]) {
      const fatal = captureFatal(render);
      expect(fatal.code).toBe("WASM_BACKEND_UNAVAILABLE");
    }
  });

  it("keeps layout-only engines working for renderToLayoutTree", () => {
    const layoutOnlyEngine = createEngine({
      computeLayoutFn: (inputJson: string) => {
        const input = JSON.parse(inputJson) as { root: { nodeId: string } };
        return JSON.stringify({
          nodes: [{ nodeId: input.root.nodeId, x: 0, y: 0, width: 10, height: 10 }],
          measureCallCount: 0,
        });
      },
    });
    const layout = layoutOnlyEngine.renderToLayoutTree(
      createElement("Canvas", { width: 10, height: 10 }),
    );
    expect(layout.root.bbox).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("rejects inline EngineOptions.fonts on the render path but not for layout", () => {
    const fonts = loadConformanceFonts().map((font) => ({
      alias: font.alias,
      weight: font.weight,
      style: font.style,
      data: font.data,
    }));
    const inlineFontHandle = createWasmEngineInstance();
    try {
      const inlineFontEngine = createEngine({
        computeLayoutFn: inlineFontHandle.createComputeLayoutFn(),
        renderToIrFn: (inputJson, optionsJson) =>
          inlineFontHandle.renderToIr(inputJson, optionsJson),
        renderToSvgFn: (inputJson, optionsJson) =>
          inlineFontHandle.renderToSvg(inputJson, optionsJson),
        emitSvgFromIrFn: (irJson, optionsJson) =>
          inlineFontHandle.emitSvgFromIr(irJson, optionsJson),
        fonts,
      });
      const scene = createElement(
        "Canvas",
        { width: 120, height: 60 },
        createElement("Text", { font: "NotoSansJP", fontSizePx: 16 }, "inline"),
      );
      const fatal = captureFatal(() => inlineFontEngine.renderToSvg(scene));
      expect(fatal.code).toBe("WASM_BACKEND_UNAVAILABLE");
      expect(fatal.message).toContain("inline per-render fonts");

      // The layout/measurement path keeps supporting inline fonts.
      const layout = inlineFontEngine.renderToLayoutTree(scene);
      expect(layout.root.children).toHaveLength(1);
    } finally {
      inlineFontHandle.dispose();
    }
  });
});

describe("wasm IR consumption by the TS IR contract", () => {
  it("hit-test and text selection consume wasm-built IRs", () => {
    const glyphScene = CONFORMANCE_SCENES.find(
      (scene) => scene.renderOptions?.textPathMode === "glyphs",
    );
    expect(glyphScene, "glyph-mode conformance scene present").toBeDefined();
    if (!glyphScene) {
      return;
    }

    const { ir } = engine.renderToSvgAndIR(glyphScene.build(), glyphScene.renderOptions);

    // Text selection: glyph source metadata must map back to quads.
    const selection = buildTextSelectionMap(ir);
    expect(selection.nodes.size).toBeGreaterThan(0);
    for (const [nodeId, selectionNode] of selection.nodes) {
      expect(selectionNode.glyphs.length, `${nodeId}: selection glyphs`).toBeGreaterThan(0);
      const sourceEnd = selectionNode.glyphs.reduce(
        (max, glyph) => Math.max(max, glyph.sourceEnd),
        0,
      );
      expect(sourceEnd).toBeGreaterThan(0);
      const quads = getTextRangeQuads(selection, nodeId, { start: 0, end: sourceEnd });
      expect(quads.length, `${nodeId}: selection quads`).toBeGreaterThan(0);
    }

    // Hit-test: every sampled hit must resolve to a node the IR knows.
    const knownNodeIds = new Set(ir.drawOrder);
    let hitCount = 0;
    const step = Math.max(4, Math.floor(Math.min(ir.width, ir.height) / 12));
    for (let sampleY = 0; sampleY < ir.height; sampleY += step) {
      for (let sampleX = 0; sampleX < ir.width; sampleX += step) {
        const hit = hitTest(ir, sampleX + 0.5, sampleY + 0.5);
        if (hit !== null) {
          hitCount += 1;
          expect(knownNodeIds.has(hit), `hit ${hit} is a drawn node`).toBe(true);
        }
      }
    }
    expect(hitCount).toBeGreaterThan(0);
  });
});
