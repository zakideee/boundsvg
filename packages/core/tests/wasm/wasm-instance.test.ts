import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initNodeWasm } from "../../src/node.js";
import {
  dispose as disposeDefaultEngine,
  initAsync as initDefaultEngineAsync,
  isInitialized as isDefaultEngineInitialized,
  renderToSvg as renderWithDefaultEngine,
} from "../../src/render.js";
import { createElement } from "../../src/vnode/create-element.js";
import { createWasmEngineInstance, getWasm, type WasmEngineHandle } from "../../src/wasm/index.js";
import {
  assertWasmPkgAvailable,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

describe("WASM instance-based engine", () => {
  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
  });

  it("BoundSvgEngine constructor is available on WasmModule", () => {
    const wasm = getWasm();
    expect(wasm.BoundSvgEngine).toBeDefined();
    expect(typeof wasm.BoundSvgEngine).toBe("function");
  });

  it("exposes one production transition compiler and no provisional probe", () => {
    const wasm = getWasm();
    const instance = new wasm.BoundSvgEngine();
    try {
      expect(instance.compile_layout_transition).toBeTypeOf("function");
      expect(instance).not.toHaveProperty("probe_layout_transition");
    } finally {
      instance.free();
    }
  });

  it("wraps the semantic Group and rejects every emit-handled canvas Path width", () => {
    const wasm = getWasm();
    const instance = new wasm.BoundSvgEngine();
    const planJson = JSON.stringify({
      checkpoints: [
        { timeMs: 0, stateIndex: 0 },
        { timeMs: 100, stateIndex: 1 },
        { timeMs: 200, stateIndex: 1 },
        { timeMs: 300, stateIndex: 0 },
      ],
    });
    const stateJson = (
      width: number,
      marginLeft: number,
      canvasStroke = false,
      strokeWidth?: number,
    ): string =>
      JSON.stringify({
        root: {
          nodeId: "scene",
          nodeType: "canvas",
          authoredId: true,
          style: { width: 200, height: 100 },
          children: [
            {
              nodeId: "path",
              nodeType: "path",
              authoredId: true,
              style: { width, height: 20, margin: [0, 0, 0, marginLeft] },
              children: [],
              visual: {
                d: "M0 10 L40 10",
                fill: "none",
                transform: { rotateDeg: 90 },
                ...(canvasStroke && {
                  stroke: "#000000",
                  strokeScaling: "canvas",
                  ...(strokeWidth !== undefined && { strokeWidth }),
                }),
              },
            },
          ],
        },
        fonts: [],
      });

    try {
      const transitionJson = instance.compile_layout_transition?.(
        stateJson(40, 0),
        stateJson(40, 20),
        planJson,
        "{}",
      );
      expect(transitionJson).toBeTypeOf("string");
      const transition = JSON.parse(transitionJson ?? "") as {
        ir: {
          root: {
            children: Array<{
              nodeId: string;
              type: string;
              children: Array<{ nodeId: string; type: string; children?: unknown[] }>;
            }>;
          };
        };
      };
      const wrapper = transition.ir.root.children[0];
      expect(wrapper).toMatchObject({
        nodeId: "__boundsvg:layout-transition-wrapper:1:path",
        type: "group",
      });
      expect(wrapper?.children[0]).toMatchObject({ nodeId: "path", type: "group" });
      expect(wrapper?.children[0]?.children?.[0]).toMatchObject({ nodeId: "path", type: "path" });

      for (const strokeWidth of [undefined, 0]) {
        expect(() =>
          instance.compile_layout_transition?.(
            stateJson(40, 0, true, strokeWidth),
            stateJson(80, 0, true, strokeWidth),
            planJson,
            "{}",
          ),
        ).toThrow(/"category":"stroke"/u);
      }
    } finally {
      instance.free();
    }
  });

  it("createWasmEngineInstance returns a handle", () => {
    const handle = createWasmEngineInstance();
    expect(handle).toBeDefined();
    expect(handle.isDisposed).toBe(false);
    handle.dispose();
  });

  it("omits resolved text fields when Taffy does not measure a hidden text node", () => {
    const handle = createWasmEngineInstance();
    try {
      handle.registerFont(loadSubsetFont(), { alias: "NotoSansJP" });
      const output = JSON.parse(
        handle.createComputeLayoutFn()(
          JSON.stringify({
            root: {
              nodeId: "root",
              nodeType: "Canvas",
              authoredId: true,
              style: { width: 100, height: 100 },
              children: [
                {
                  nodeId: "hidden-text",
                  nodeType: "Text",
                  authoredId: true,
                  style: { display: "none" },
                  children: [],
                  text: {
                    content: "A",
                    fontSizePx: 16,
                    fontFamily: ["NotoSansJP"],
                  },
                },
              ],
            },
          }),
        ),
      ) as {
        measureCallCount: number;
        nodes: Array<{ nodeId: string; textLayout?: Record<string, unknown> }>;
      };

      const textLayout = output.nodes.find((node) => node.nodeId === "hidden-text")?.textLayout;
      expect(output.measureCallCount).toBe(0);
      expect(textLayout).toMatchObject({
        glyphs: expect.any(Array),
        measuredWidth: expect.any(Number),
        measuredHeight: expect.any(Number),
      });
      expect(textLayout).not.toHaveProperty("lines");
      expect(textLayout).not.toHaveProperty("bbox");
      expect(textLayout).not.toHaveProperty("chosenFontSizePx");
    } finally {
      handle.dispose();
    }
  });

  describe("font isolation between instances", () => {
    let fontData: Uint8Array;

    beforeAll(() => {
      fontData = loadSubsetFont();
    });

    it("two instances have independent registries", () => {
      const handle1 = createWasmEngineInstance();
      const handle2 = createWasmEngineInstance();

      // Register font only in handle1
      handle1.registerFont(fontData, { alias: "IsolatedFont", weight: 400, style: "normal" });

      // handle1 should shape text
      const shapeFn1 = handle1.createShapeFnRegistered("IsolatedFont", 400, "normal");
      const glyphs1 = shapeFn1("A", { fontSizePx: 24, letterSpacingPx: 0 });
      expect(glyphs1.length).toBeGreaterThan(0);

      // handle2 should fail to shape (font not registered)
      const shapeFn2 = handle2.createShapeFnRegistered("IsolatedFont", 400, "normal");
      expect(() => shapeFn2("A", { fontSizePx: 24, letterSpacingPx: 0 })).toThrow();

      handle1.dispose();
      handle2.dispose();
    });

    it("same alias can be registered in separate instances", () => {
      const handle1 = createWasmEngineInstance();
      const handle2 = createWasmEngineInstance();

      // Both register "SharedAlias" without conflict
      handle1.registerFont(fontData, { alias: "SharedAlias", weight: 400, style: "normal" });
      handle2.registerFont(fontData, { alias: "SharedAlias", weight: 400, style: "normal" });

      const shapeFn1 = handle1.createShapeFnRegistered("SharedAlias", 400, "normal");
      const shapeFn2 = handle2.createShapeFnRegistered("SharedAlias", 400, "normal");

      expect(shapeFn1("テスト", { fontSizePx: 24, letterSpacingPx: 0 }).length).toBe(3);
      expect(shapeFn2("テスト", { fontSizePx: 24, letterSpacingPx: 0 }).length).toBe(3);

      handle1.dispose();
      handle2.dispose();
    });

    it("disposing one instance does not affect another", () => {
      const handle1 = createWasmEngineInstance();
      const handle2 = createWasmEngineInstance();

      handle1.registerFont(fontData, { alias: "DisposeTestFont", weight: 400, style: "normal" });
      handle2.registerFont(fontData, { alias: "DisposeTestFont", weight: 400, style: "normal" });

      // Dispose handle1
      handle1.dispose();
      expect(handle1.isDisposed).toBe(true);

      // handle2 should still work
      const shapeFn2 = handle2.createShapeFnRegistered("DisposeTestFont", 400, "normal");
      const glyphs = shapeFn2("Hello", { fontSizePx: 16, letterSpacingPx: 0 });
      expect(glyphs.length).toBeGreaterThan(0);

      handle2.dispose();
    });
  });

  describe("instance methods", () => {
    let handle: WasmEngineHandle;
    let fontData: Uint8Array;

    beforeAll(() => {
      fontData = loadSubsetFont();
      handle = createWasmEngineInstance();
      handle.registerFont(fontData, { alias: "TestFont", weight: 400, style: "normal" });
    });

    it("createShapeFnRegistered shapes text", () => {
      const shapeFn = handle.createShapeFnRegistered("TestFont", 400, "normal");
      const glyphs = shapeFn("テスト", { fontSizePx: 24, letterSpacingPx: 0 });
      expect(glyphs.length).toBe(3);
      for (const g of glyphs) {
        expect(g.xAdvance).toBeGreaterThan(0);
      }
    });

    it("createComputeLayoutFn computes layout", () => {
      const computeLayout = handle.createComputeLayoutFn();
      const inputJson = JSON.stringify({
        root: {
          nodeId: "root",
          nodeType: "Canvas",
          authoredId: true,
          style: { width: 200, height: 100 },
          children: [
            {
              nodeId: "text1",
              nodeType: "Text",
              authoredId: true,
              style: {},
              text: {
                content: "Hello",
                fontSizePx: 16,
                fontFamily: ["TestFont"],
                fontWeight: 400,
                fontStyle: "normal",
                wrap: "char",
              },
              children: [],
            },
          ],
        },
        fonts: [],
      });

      const result = computeLayout(inputJson);
      const parsed = JSON.parse(result);
      expect(parsed).toBeDefined();
      expect(parsed.nodes).toBeDefined();
    });

    it("createSvgToPngFn rasterizes SVG", () => {
      const svgToPng = handle.createSvgToPngFn();
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="white"/></svg>';
      const png = svgToPng(svg);
      expect(png).toBeInstanceOf(Uint8Array);
      expect(png.length).toBeGreaterThan(0);
      // PNG magic bytes
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50);
    });

    it("createGlyphPathFn extracts paths", () => {
      const glyphPathFn = handle.createGlyphPathFn("TestFont", 400, "normal");
      const paths = glyphPathFn("A", {
        fontSizePx: 24,
        letterSpacingPx: 0,
        baselineY: 20,
        startX: 0,
      });
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]!.d).toBeDefined();
    });

    it("extractPositionedGlyphPaths extracts paths from glyph-first input", () => {
      const shapeFn = handle.createShapeFnRegistered("TestFont", 400, "normal");
      const glyphs = shapeFn("A", { fontSizePx: 24, letterSpacingPx: 0 });
      const paths = handle.extractPositionedGlyphPaths([
        {
          glyphId: glyphs[0]!.glyphId,
          text: "A",
          fontSizePx: 24,
          originX: 16,
          originY: 32,
          rotationDeg: glyphs[0]!.rotationDeg ?? 0,
          writingMode: "horizontal-tb",
          fontAlias: "TestFont",
          fontWeight: 400,
          fontStyle: "normal",
        },
      ]);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]!.d).toBeDefined();
      expect(paths[0]!.glyphId).toBe(glyphs[0]!.glyphId);
      expect(paths[0]!.requestIndex).toBe(0);
    });
  });

  describe("fallback chain on instance", () => {
    let handle: WasmEngineHandle;

    beforeAll(() => {
      handle = createWasmEngineInstance();
      handle.registerFont(loadJetBrainsMonoFont(), {
        alias: "JetBrains",
        weight: 400,
        style: "normal",
      });
      handle.registerFont(loadSubsetFont(), { alias: "Noto", weight: 400, style: "normal" });
    });

    it("createShapeFnRegisteredWithFallback uses secondary font", () => {
      const shapeFn = handle.createShapeFnRegisteredWithFallback(
        ["JetBrains", "Noto"],
        400,
        "normal",
      );
      // "A日" — 'A' from JetBrains, '日' from Noto fallback
      const glyphs = shapeFn("A日", { fontSizePx: 24, letterSpacingPx: 0 });
      expect(glyphs.length).toBeGreaterThanOrEqual(2);
    });

    it("createGlyphPathFnWithFallback extracts mixed paths", () => {
      const glyphPathFn = handle.createGlyphPathFnWithFallback(
        ["JetBrains", "Noto"],
        400,
        "normal",
      );
      const paths = glyphPathFn("A日", {
        fontSizePx: 24,
        letterSpacingPx: 0,
        baselineY: 32,
        startX: 0,
      });
      expect(paths.length).toBeGreaterThan(0);
    });
  });

  describe("dispose", () => {
    it("registerFont throws after dispose", () => {
      const handle = createWasmEngineInstance();
      handle.dispose();
      expect(() =>
        handle.registerFont(loadSubsetFont(), { alias: "Dead", weight: 400, style: "normal" }),
      ).toThrow(/disposed/i);
    });

    it("dispose is idempotent", () => {
      const handle = createWasmEngineInstance();
      handle.dispose();
      // Second dispose should not throw
      expect(() => handle.dispose()).not.toThrow();
    });

    it("closures returned by create* throw after dispose", () => {
      const handle = createWasmEngineInstance();
      handle.registerFont(loadSubsetFont(), { alias: "ClosureFont", weight: 400, style: "normal" });

      // Capture closures before dispose
      const computeLayout = handle.createComputeLayoutFn();
      const shapeFn = handle.createShapeFnRegistered("ClosureFont", 400, "normal");
      const svgToPng = handle.createSvgToPngFn();
      const glyphPathFn = handle.createGlyphPathFn("ClosureFont", 400, "normal");

      handle.dispose();

      expect(() => computeLayout("{}")).toThrow(/disposed/i);
      expect(() => shapeFn("A", { fontSizePx: 24, letterSpacingPx: 0 })).toThrow(/disposed/i);
      expect(() =>
        svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
      ).toThrow(/disposed/i);
      expect(() =>
        glyphPathFn("A", { fontSizePx: 24, letterSpacingPx: 0, baselineY: 20, startX: 0 }),
      ).toThrow(/disposed/i);
    });

    it("fallback and variation closures throw after dispose", () => {
      const handle = createWasmEngineInstance();
      handle.registerFont(loadJetBrainsMonoFont(), {
        alias: "FbJet",
        weight: 400,
        style: "normal",
      });
      handle.registerFont(loadSubsetFont(), { alias: "FbNoto", weight: 400, style: "normal" });

      const shapeFallback = handle.createShapeFnRegisteredWithFallback(
        ["FbJet", "FbNoto"],
        400,
        "normal",
      );
      const glyphPathFallback = handle.createGlyphPathFnWithFallback(
        ["FbJet", "FbNoto"],
        400,
        "normal",
      );
      const variationFn = handle.createShapeWithVariationsFn("FbNoto", 400, "normal");

      handle.dispose();

      expect(() => shapeFallback("A日", { fontSizePx: 24, letterSpacingPx: 0 })).toThrow(
        /disposed/i,
      );
      expect(() =>
        glyphPathFallback("A日", { fontSizePx: 24, letterSpacingPx: 0, baselineY: 32, startX: 0 }),
      ).toThrow(/disposed/i);
      if (variationFn) {
        expect(() =>
          variationFn("A", { fontSizePx: 24, letterSpacingPx: 0, variationsJson: "[]" }),
        ).toThrow(/disposed/i);
      }
    });
  });

  describe("default engine initialization lifecycle", () => {
    afterEach(() => {
      disposeDefaultEngine();
    });

    function textScene(font: string) {
      return createElement(
        "Canvas",
        { width: 180, height: 80 },
        createElement("Text", { font, fontSizePx: 20 }, "監査"),
      );
    }

    it("coalesces concurrent initAsync calls using the first options", async () => {
      const fontData = loadSubsetFont();
      const firstInitialization = initDefaultEngineAsync({
        fonts: [{ alias: "FirstDefault", weight: 400, style: "normal", data: fontData.slice() }],
      });
      const secondInitialization = initDefaultEngineAsync({
        fonts: [{ alias: "SecondDefault", weight: 400, style: "normal", data: fontData.slice() }],
      });

      await Promise.all([firstInitialization, secondInitialization]);

      expect(renderWithDefaultEngine(textScene("FirstDefault"))).toContain("<svg");
      try {
        renderWithDefaultEngine(textScene("SecondDefault"));
        expect.unreachable("second concurrent initAsync options must be ignored");
      } catch (error) {
        expect(error).toMatchObject({
          name: "FatalError",
          code: "FONT_ALIAS_NOT_REGISTERED",
          stage: "text",
        });
      }
    });

    it("does not resurrect an initialization disposed while pending", async () => {
      const initialization = initDefaultEngineAsync({
        fonts: [
          {
            alias: "CanceledDefault",
            weight: 400,
            style: "normal",
            data: loadSubsetFont(),
          },
        ],
      });

      disposeDefaultEngine();
      await initialization;

      expect(isDefaultEngineInitialized()).toBe(false);
      try {
        renderWithDefaultEngine(textScene("CanceledDefault"));
        expect.unreachable("disposed pending initialization must stay unavailable");
      } catch (error) {
        expect(error).toMatchObject({
          name: "FatalError",
          code: "ENGINE_NOT_INIT",
          stage: "engine",
        });
      }
    });

    it("publishes a new initialization after canceling a stale pending one", async () => {
      const fontData = loadSubsetFont();
      const staleInitialization = initDefaultEngineAsync({
        fonts: [{ alias: "StaleDefault", weight: 400, style: "normal", data: fontData.slice() }],
      });

      disposeDefaultEngine();
      const replacementInitialization = initDefaultEngineAsync({
        fonts: [
          {
            alias: "ReplacementDefault",
            weight: 400,
            style: "normal",
            data: fontData.slice(),
          },
        ],
      });
      await Promise.all([staleInitialization, replacementInitialization]);

      expect(renderWithDefaultEngine(textScene("ReplacementDefault"))).toContain("<svg");
      try {
        renderWithDefaultEngine(textScene("StaleDefault"));
        expect.unreachable("stale initialization must not replace the new default engine");
      } catch (error) {
        expect(error).toMatchObject({
          name: "FatalError",
          code: "FONT_ALIAS_NOT_REGISTERED",
          stage: "text",
        });
      }
    });

    it("clears a rejected initialization so a later retry can succeed", async () => {
      const invalidFont = new Uint8Array([0]);
      const firstInitialization = initDefaultEngineAsync({
        fonts: [{ alias: "InvalidDefault", data: invalidFont }],
      });
      const coalescedInitialization = initDefaultEngineAsync({
        fonts: [{ alias: "IgnoredWhilePending", data: loadSubsetFont() }],
      });

      const settlements = await Promise.allSettled([firstInitialization, coalescedInitialization]);
      expect(settlements.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
      expect(isDefaultEngineInitialized()).toBe(false);

      await initDefaultEngineAsync({
        fonts: [{ alias: "RetryDefault", data: loadSubsetFont() }],
      });
      expect(renderWithDefaultEngine(textScene("RetryDefault"))).toContain("<svg");
    });
  });
});
