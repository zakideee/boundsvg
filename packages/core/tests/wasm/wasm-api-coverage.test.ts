import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initNodeWasm } from "../../src/node.js";
import {
  createWasmEngineInstance,
  type WasmEngineHandle,
  wasmCompileShapeSvg,
  wasmComputeShapeIntersections,
  wasmDivideShapeRegions,
  wasmEvaluateShapeRegion,
  wasmRenderShapeRegionSvg,
  wasmResolveSymbolGeometry,
  wasmUax14LineBreaks,
} from "../../src/wasm/index.js";
import {
  assertWasmPkgAvailable,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

const COVERAGE_FONT_ALIAS = "NotoCoverage";
const COVERAGE_FALLBACK_PRIMARY_ALIAS = "JetBrainsCoverage";

describe("WASM public API coverage", () => {
  let handle: WasmEngineHandle;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();

    handle = createWasmEngineInstance();
    const fontData = loadSubsetFont();
    const jetBrainsMono = loadJetBrainsMonoFont();
    handle.registerFont(fontData, { alias: COVERAGE_FONT_ALIAS, weight: 400, style: "normal" });
    handle.registerFont(jetBrainsMono, {
      alias: COVERAGE_FALLBACK_PRIMARY_ALIAS,
      weight: 400,
      style: "normal",
    });
  });

  afterAll(() => {
    handle.dispose();
  });

  it("returns UAX14 line break opportunities", () => {
    const breaks = wasmUax14LineBreaks("Hello World");
    expect(breaks.length).toBeGreaterThan(0);
    expect(breaks).toContain(6);
  });

  it("compiles shape geometry to SVG through the WASM shape API", () => {
    const svg = wasmCompileShapeSvg(
      {
        viewBox: { width: 200, height: 120 },
        root: {
          kind: "path",
          d: "M16 0H184V80H16Z",
        },
      },
      {
        paint: {
          fill: "#0f172a",
          stroke: "#334155",
          strokeWidth: 2,
        },
        viewport: {
          width: 400,
          height: 240,
        },
      },
    );

    expect(svg).toContain('viewBox="0 0 400 240"');
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('stroke="#334155"');
  });

  it("adjusts viewport inset when stroke width changes through the WASM shape API", () => {
    const cases = [
      { strokeWidth: 1, expectedPath: "M0.5,0.5L399.5,0.5L399.5,239.5L0.5,239.5Z" },
      { strokeWidth: 2, expectedPath: "M1,1L399,1L399,239L1,239Z" },
      { strokeWidth: 4, expectedPath: "M2,2L398,2L398,238L2,238Z" },
      { strokeWidth: 8, expectedPath: "M4,4L396,4L396,236L4,236Z" },
    ] as const;

    for (const testCase of cases) {
      const svg = wasmCompileShapeSvg(
        {
          viewBox: { width: 200, height: 120 },
          root: {
            kind: "path",
            d: "M0 0H200V120H0Z",
          },
        },
        {
          paint: {
            fill: "#0f172a",
            stroke: "#334155",
            strokeWidth: testCase.strokeWidth,
          },
          viewport: {
            width: 400,
            height: 240,
          },
        },
      );

      expect(svg).toContain(`stroke-width="${testCase.strokeWidth}"`);
      expect(svg).toContain(testCase.expectedPath);
    }
  });

  it("resolves elastic symbols through the WASM shape API", () => {
    const geometry = wasmResolveSymbolGeometry(
      {
        geometry: {
          viewBox: { width: 100, height: 20 },
          root: {
            kind: "group",
            children: [
              { kind: "path", nodeId: "shaft", d: "M10 8H70V12H10Z" },
              { kind: "path", nodeId: "head", d: "M70 4L100 10L70 16Z" },
            ],
          },
        },
        elasticSegments: [
          {
            nodeId: "shaft",
            axis: "x",
            role: "stretch",
            frame: { x: 10, y: 0, width: 60, height: 20 },
          },
          {
            nodeId: "head",
            axis: "x",
            role: "fixed-end",
            frame: { x: 70, y: 0, width: 30, height: 20 },
          },
        ],
      },
      {
        width: 160,
        height: 20,
      },
    );

    const svg = wasmCompileShapeSvg(geometry);
    expect(svg).toContain("M10,8L130,8L130,12L10,12Z");
    expect(svg).toContain("M130,4L160,10L130,16Z");
  });

  it("evaluates geometry into a normalized region through the WASM shape API", () => {
    const region = wasmEvaluateShapeRegion({
      viewBox: { width: 300, height: 200 },
      root: {
        kind: "boolean",
        op: "subtract",
        children: [
          {
            kind: "path",
            d: "M16 0H284V200H16Z",
          },
          {
            kind: "path",
            d: "M150 0Q150 30 125 30Q100 30 100 0Z",
          },
        ],
      },
    });

    expect(region.contours.length).toBeGreaterThan(0);
    expect(region.contours[0]!.segments.length).toBeGreaterThan(0);
  });

  it("renders normalized regions back to SVG through the WASM shape API", () => {
    const region = wasmEvaluateShapeRegion({
      viewBox: { width: 300, height: 200 },
      root: {
        kind: "boolean",
        op: "subtract",
        children: [
          {
            kind: "path",
            d: "M16 0H284V200H16Z",
          },
          {
            kind: "path",
            d: "M150 0Q150 30 125 30Q100 30 100 0Z",
          },
        ],
      },
    });

    const svg = wasmRenderShapeRegionSvg(region, {
      paint: {
        fill: "#0f172a",
        stroke: "#475569",
        strokeWidth: 2,
      },
      viewport: {
        width: 300,
        height: 200,
      },
    });

    expect(svg).toContain("<svg");
    expect(svg).not.toContain("clip-path=");
    expect(svg).toContain('stroke="#475569"');
  });

  it("divides regions through the WASM shape API", () => {
    const result = wasmDivideShapeRegions(
      {
        viewBox: { width: 100, height: 100 },
        root: { kind: "path", d: "M0 0H100V100H0Z" },
      },
      {
        viewBox: { width: 100, height: 100 },
        root: { kind: "path", d: "M25 25H75V75H25Z" },
      },
    );

    expect(result.subtract.contours.length).toBeGreaterThan(0);
    expect(result.intersect.contours.length).toBeGreaterThan(0);
  });

  it("queries shape intersections through the WASM shape API", () => {
    const intersections = wasmComputeShapeIntersections(
      {
        viewBox: { width: 120, height: 120 },
        root: { kind: "path", d: "M10 60L60 10L110 60L60 110Z" },
      },
      {
        viewBox: { width: 120, height: 120 },
        root: { kind: "path", d: "M45 15H105V75H45Z" },
      },
    );

    expect(intersections.length).toBeGreaterThan(0);
    expect(intersections[0]?.contourIndexA).toBe(0);
    expect(intersections[0]?.contourIndexB).toBe(0);
  });

  it("extracts glyph paths from registered font", () => {
    const glyphPathFn = handle.createGlyphPathFn(COVERAGE_FONT_ALIAS, 400, "normal");
    const paths = glyphPathFn("A", {
      fontSizePx: 42,
      letterSpacingPx: 0,
      baselineY: 64,
      startX: 16,
    });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]!.d.length).toBeGreaterThan(0);
    expect(Number.isFinite(paths[0]!.x)).toBe(true);
    expect(Number.isFinite(paths[0]!.y)).toBe(true);
  });

  it("supports writing-mode option in glyph path extraction", () => {
    const glyphPathFn = handle.createGlyphPathFn(COVERAGE_FONT_ALIAS, 400, "normal");
    const paths = glyphPathFn("テ", {
      fontSizePx: 42,
      letterSpacingPx: 0,
      baselineY: 64,
      startX: 16,
      pathOptions: { writingMode: "vertical-rl" },
    });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]!.d.length).toBeGreaterThan(0);
  });

  it("shapes mixed text with fallback chain API", () => {
    const shapeFn = handle.createShapeFnRegisteredWithFallback(
      [COVERAGE_FALLBACK_PRIMARY_ALIAS, COVERAGE_FONT_ALIAS],
      400,
      "normal",
    );
    const glyphs = shapeFn("A日", { fontSizePx: 24, letterSpacingPx: 0 });
    expect(glyphs.length).toBeGreaterThan(1);
    const cjkGlyph = glyphs.find((g) => g.cluster === 1);
    expect(cjkGlyph).toBeDefined();
    expect(cjkGlyph!.glyphId).toBeGreaterThan(0);
  });

  it("extracts glyph paths from fallback chain API", () => {
    const glyphPathFn = handle.createGlyphPathFnWithFallback(
      [COVERAGE_FALLBACK_PRIMARY_ALIAS, COVERAGE_FONT_ALIAS],
      400,
      "normal",
    );
    const paths = glyphPathFn("A日", {
      fontSizePx: 24,
      letterSpacingPx: 0,
      baselineY: 48,
      startX: 0,
    });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.d.length > 0)).toBe(true);
  });

  it("layouts text with variable-width flow API", () => {
    const result = handle.layoutTextFlow({
      text: "あいうえおかきくけこ",
      fontFamily: COVERAGE_FONT_ALIAS,
      fontSizePx: 20,
      language: "ja",
      wrap: "char",
      lineWidths: [60, 100, 200],
    });
    expect(result.exhausted).toBe(true);
    expect(result.lines.length).toBeGreaterThan(1);
    // First line should be narrower (60px max)
    expect(result.lines[0]!.inlineAdvancePx).toBeLessThanOrEqual(61);
    // All text should be covered
    const combined = result.lines.map((l) => l.text).join("");
    expect(combined).toBe("あいうえおかきくけこ");
  });

  it("shapes text with variation settings via registered font API", () => {
    const shapeWithVariationsFn = handle.createShapeWithVariationsFn(
      COVERAGE_FONT_ALIAS,
      400,
      "normal",
    );
    expect(shapeWithVariationsFn).not.toBeNull();

    const glyphs = shapeWithVariationsFn!("Variable", {
      fontSizePx: 24,
      letterSpacingPx: 0,
      variationsJson: '[{"tag":"wght","value":700}]',
    });
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs[0]!.glyphId).toBeGreaterThan(0);
  });
});
