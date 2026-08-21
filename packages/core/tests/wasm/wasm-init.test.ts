import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initNodeWasm } from "../../src/node.js";
import {
  createWasmEngineInstance,
  createWasmShapeFn,
  getWasm,
  getWasmFontMetrics,
  isShapeWasmAvailable,
  isWasmInitialized,
  type WasmEngineHandle,
  wasmGraphemeSplit,
} from "../../src/wasm/index.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

describe("WASM integration", () => {
  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
  });

  it("initializes successfully", () => {
    expect(isWasmInitialized()).toBe(true);
    expect(isShapeWasmAvailable()).toBe(true);
  });

  it("getWasm returns module after init", () => {
    const wasm = getWasm();
    expect(wasm).toBeDefined();
    expect(typeof wasm.BoundSvgEngine).toBe("function");
    expect(typeof wasm.get_font_metrics).toBe("function");
    expect(typeof wasm.shape_text).toBe("function");
    expect(typeof wasm.grapheme_split).toBe("function");
  });

  it("initNodeWasm is idempotent", async () => {
    // Should not throw on second call
    await initNodeWasm();
    expect(isWasmInitialized()).toBe(true);
  });

  it("shipped WASM reports the expected schema version", async () => {
    const { EXPECTED_WASM_SCHEMA_VERSION, getWasm } = await import("../../src/wasm/index.js");
    expect(getWasm().wasm_schema_version?.()).toBe(EXPECTED_WASM_SCHEMA_VERSION);
  });

  it("grapheme_split works", () => {
    const result = wasmGraphemeSplit("Hello");
    expect(result).toEqual(["H", "e", "l", "l", "o"]);
  });

  it("grapheme_split handles CJK", () => {
    const result = wasmGraphemeSplit("日本語");
    expect(result).toEqual(["日", "本", "語"]);
  });

  it("grapheme_split keeps ZWJ emoji sequences as one cluster", () => {
    const result = wasmGraphemeSplit(
      "a\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}b",
    );
    expect(result).toEqual([
      "a",
      "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}",
      "b",
    ]);
  });

  it("grapheme_split keeps regional-indicator flags as one cluster", () => {
    const result = wasmGraphemeSplit("\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}");
    expect(result).toEqual(["\u{1F1EF}\u{1F1F5}", "\u{1F1FA}\u{1F1F8}"]);
  });

  it("grapheme_split keeps combining marks attached to their base", () => {
    const result = wasmGraphemeSplit("か\u{3099}な");
    expect(result).toEqual(["か\u{3099}", "な"]);
  });

  describe("with font", () => {
    let fontData: Uint8Array;

    beforeAll(() => {
      fontData = loadSubsetFont();
    });

    it("shapes text with real font", () => {
      const shapeFn = createWasmShapeFn(fontData);
      const glyphs = shapeFn("Hello", { fontSizePx: 16, letterSpacingPx: 0 });

      expect(glyphs.length).toBeGreaterThan(0);
      expect(glyphs[0]!.glyphId).toBeGreaterThan(0);
      expect(glyphs[0]!.xAdvance).toBeGreaterThan(0);
    });

    it("shapes Japanese text", () => {
      const shapeFn = createWasmShapeFn(fontData);
      const glyphs = shapeFn("テスト", { fontSizePx: 24, letterSpacingPx: 0 });

      expect(glyphs.length).toBe(3);
      for (const g of glyphs) {
        expect(g.xAdvance).toBeGreaterThan(0);
      }
    });

    it("applies letter spacing", () => {
      const shapeFn = createWasmShapeFn(fontData);
      const glyphsNoSpacing = shapeFn("AB", { fontSizePx: 16, letterSpacingPx: 0 });
      const glyphsWithSpacing = shapeFn("AB", { fontSizePx: 16, letterSpacingPx: 5 });

      // First glyph should have larger advance with spacing
      expect(glyphsWithSpacing[0]!.xAdvance).toBeGreaterThan(glyphsNoSpacing[0]!.xAdvance);
      // Last glyph should NOT have spacing
      expect(glyphsWithSpacing[1]!.xAdvance).toBe(glyphsNoSpacing[1]!.xAdvance);
    });
  });

  describe("font registration (instance-based)", () => {
    let fontData: Uint8Array;
    let handle: WasmEngineHandle;

    beforeAll(() => {
      fontData = loadSubsetFont();
      handle = createWasmEngineInstance();
      handle.registerFont(fontData, { alias: "NotoTest", weight: 400, style: "normal" });
    });

    afterAll(() => {
      handle.dispose();
    });

    it("shapes text using registered font", () => {
      const shapeFn = handle.createShapeFnRegistered("NotoTest", 400, "normal");
      const glyphs = shapeFn("テスト", { fontSizePx: 24, letterSpacingPx: 0 });

      expect(glyphs.length).toBe(3);
      for (const g of glyphs) {
        expect(g.xAdvance).toBeGreaterThan(0);
      }
    });

    it("gets font metrics", () => {
      const metrics = getWasmFontMetrics(fontData);
      expect(metrics.unitsPerEm).toBeGreaterThan(0);
      expect(metrics.ascender).toBeGreaterThan(0);
      expect(metrics.descender).toBeLessThan(0);
    });
  });

  describe("SVG to PNG (instance-based)", () => {
    let handle: WasmEngineHandle;

    beforeAll(() => {
      handle = createWasmEngineInstance();
    });

    afterAll(() => {
      handle.dispose();
    });

    it("rasterizes simple SVG", () => {
      const svgToPng = handle.createSvgToPngFn();
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff0000"/></svg>';
      const png = svgToPng(svg);

      expect(png).toBeInstanceOf(Uint8Array);
      expect(png.length).toBeGreaterThan(0);
      // Check PNG magic bytes
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50); // P
      expect(png[2]).toBe(0x4e); // N
      expect(png[3]).toBe(0x47); // G
    });
  });
});
