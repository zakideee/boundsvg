import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock("../src/generated-wasm.js");
});

describe("browser wasm loader", () => {
  it("maps shape exports onto the browser WasmModule adapter", async () => {
    const wasmInit = vi.fn(async () => undefined);
    const getFontMetrics = vi.fn(() => '{"unitsPerEm":1000,"ascender":800,"descender":-200}');
    const shapeText = vi.fn(() => "[]");
    const graphemeSplit = vi.fn(() => "[]");
    const compileShapeSvg = vi.fn((json: string) => json);
    const compileShapePaths = vi.fn((json: string) => json);
    const hitTestShapeParts = vi.fn((json: string) => json);
    const resolveSymbolGeometry = vi.fn((json: string) => json);
    const evaluateShapeRegion = vi.fn((json: string) => json);
    const renderShapeRegionSvg = vi.fn((json: string) => json);
    const divideShapeRegions = vi.fn((json: string) => json);
    const computeShapeIntersections = vi.fn((json: string) => json);
    const scalarWasmInit = vi.fn(async () => undefined);
    const generatedWasm = {
      get_font_metrics: getFontMetrics,
      shape_text: shapeText,
      grapheme_split: graphemeSplit,
      uax14_line_breaks: vi.fn(() => "[]"),
      extract_image_hrefs: vi.fn(() => "[]"),
      compile_shape_svg: compileShapeSvg,
      compile_shape_paths: compileShapePaths,
      hit_test_shape_parts: hitTestShapeParts,
      resolve_symbol_geometry: resolveSymbolGeometry,
      evaluate_shape_region: evaluateShapeRegion,
      render_shape_region_svg: renderShapeRegionSvg,
      divide_shape_regions: divideShapeRegions,
      compute_shape_intersections: computeShapeIntersections,
      BoundSvgEngine: class MockBoundSvgEngine {},
    };

    vi.doMock("../src/generated-wasm.js", () => ({
      scalarWasm: generatedWasm,
      scalarWasmInit,
      simdWasm: generatedWasm,
      simdWasmInit: wasmInit,
    }));

    const { loadWasmModule } = await import("../src/wasm.js");
    const module = await loadWasmModule();

    expect(wasmInit).toHaveBeenCalledTimes(1);
    expect(scalarWasmInit).not.toHaveBeenCalled();
    expect(typeof module.compile_shape_svg).toBe("function");
    expect(typeof module.compile_shape_paths).toBe("function");
    expect(typeof module.hit_test_shape_parts).toBe("function");
    expect(typeof module.resolve_symbol_geometry).toBe("function");
    expect(typeof module.evaluate_shape_region).toBe("function");
    expect(typeof module.render_shape_region_svg).toBe("function");
    expect(typeof module.divide_shape_regions).toBe("function");
    expect(typeof module.compute_shape_intersections).toBe("function");

    expect(module.compile_shape_svg?.('{"shape":true}')).toBe('{"shape":true}');
    expect(module.resolve_symbol_geometry?.('{"symbol":true}')).toBe('{"symbol":true}');
    expect(module.evaluate_shape_region?.('{"region":true}')).toBe('{"region":true}');
    expect(module.render_shape_region_svg?.('{"svg":true}')).toBe('{"svg":true}');
    expect(module.divide_shape_regions?.('{"divide":true}')).toBe('{"divide":true}');
    expect(module.compute_shape_intersections?.('{"query":true}')).toBe('{"query":true}');
  });

  it("fails fast when a required shape export is missing", async () => {
    const invalidWasm = {
      get_font_metrics: vi.fn(() => '{"unitsPerEm":1000,"ascender":800,"descender":-200}'),
      shape_text: vi.fn(() => "[]"),
      grapheme_split: vi.fn(() => "[]"),
      uax14_line_breaks: vi.fn(() => "[]"),
      extract_image_hrefs: vi.fn(() => "[]"),
      compile_shape_svg: vi.fn((json: string) => json),
      compile_shape_paths: vi.fn((json: string) => json),
      hit_test_shape_parts: vi.fn((json: string) => json),
      resolve_symbol_geometry: undefined,
      evaluate_shape_region: vi.fn((json: string) => json),
      render_shape_region_svg: vi.fn((json: string) => json),
      divide_shape_regions: vi.fn((json: string) => json),
      compute_shape_intersections: vi.fn((json: string) => json),
      BoundSvgEngine: class MockBoundSvgEngine {},
    };

    vi.doMock("../src/generated-wasm.js", () => ({
      scalarWasm: invalidWasm,
      scalarWasmInit: vi.fn(async () => undefined),
      simdWasm: invalidWasm,
      simdWasmInit: vi.fn(async () => undefined),
    }));

    const { loadWasmModule } = await import("../src/wasm.js");

    await expect(loadWasmModule()).rejects.toThrow(
      'Browser WASM module is missing required export "resolve_symbol_geometry".',
    );
  });

  it("falls back to the scalar variant when SIMD initialization fails", async () => {
    const scalarWasmInit = vi.fn(async () => undefined);
    const scalarWasm = {
      get_font_metrics: vi.fn(() => '{"unitsPerEm":1000,"ascender":800,"descender":-200}'),
      shape_text: vi.fn(() => "[]"),
      grapheme_split: vi.fn(() => "[]"),
      uax14_line_breaks: vi.fn(() => "[]"),
      extract_image_hrefs: vi.fn(() => "[]"),
      compile_shape_svg: vi.fn((json: string) => json),
      compile_shape_paths: vi.fn((json: string) => json),
      hit_test_shape_parts: vi.fn((json: string) => json),
      resolve_symbol_geometry: vi.fn((json: string) => json),
      evaluate_shape_region: vi.fn((json: string) => json),
      render_shape_region_svg: vi.fn((json: string) => json),
      divide_shape_regions: vi.fn((json: string) => json),
      compute_shape_intersections: vi.fn((json: string) => json),
      BoundSvgEngine: class MockBoundSvgEngine {},
    };

    const simdWasmInit = vi.fn(async () => {
      throw new WebAssembly.CompileError("SIMD is unavailable");
    });

    vi.doMock("../src/generated-wasm.js", () => ({
      scalarWasm,
      scalarWasmInit,
      simdWasm: {},
      simdWasmInit,
    }));

    const { loadWasmModule } = await import("../src/wasm.js");
    const module = await loadWasmModule();

    expect(simdWasmInit).toHaveBeenCalledTimes(1);
    expect(scalarWasmInit).toHaveBeenCalledTimes(1);
    expect(module.compile_shape_svg?.('{"scalar":true}')).toBe('{"scalar":true}');
  });
});
