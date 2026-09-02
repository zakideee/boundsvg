import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeometryDoc } from "../../src/shape/types.js";
import {
  EXPECTED_WASM_SCHEMA_VERSION,
  initWasm,
  isShapeWasmAvailable,
  wasmCompileShapeSvg,
  wasmDivideShapeRegions,
} from "../../src/wasm/index.js";
import type { WasmModule } from "../../src/wasm/types.js";

type Handler = (jsonInput: string) => unknown;

const VALID_GEOMETRY: GeometryDoc = {
  viewBox: { width: 10, height: 10 },
  root: { kind: "path", d: "M0 0H10V10H0Z" },
};

const handlers: Record<
  | "compile_shape_svg"
  | "hit_test_shape_parts"
  | "compile_shape_paths"
  | "resolve_symbol_geometry"
  | "evaluate_shape_parts"
  | "evaluate_shape_region"
  | "render_shape_region_svg"
  | "divide_shape_regions"
  | "compute_shape_intersections",
  Handler
> = {
  compile_shape_svg: () => "<svg/>",
  hit_test_shape_parts: () => "[]",
  compile_shape_paths: () => "[]",
  resolve_symbol_geometry: () =>
    '{"viewBox":{"x":0,"y":0,"width":10,"height":10},"root":{"kind":"path","d":"M0 0Z"}}',
  evaluate_shape_parts: () => "[]",
  evaluate_shape_region: () => '{"contours":[]}',
  render_shape_region_svg: () => "<svg/>",
  divide_shape_regions: () => '{"subtract":{"contours":[]},"intersect":{"contours":[]}}',
  compute_shape_intersections: () => "[]",
};

const mockModule = {
  wasm_schema_version: () => EXPECTED_WASM_SCHEMA_VERSION,
  compile_shape_svg: (jsonInput: string) => handlers.compile_shape_svg(jsonInput),
  hit_test_shape_parts: (jsonInput: string) => handlers.hit_test_shape_parts(jsonInput),
  compile_shape_paths: (jsonInput: string) => handlers.compile_shape_paths(jsonInput),
  resolve_symbol_geometry: (jsonInput: string) => handlers.resolve_symbol_geometry(jsonInput),
  evaluate_shape_parts: (jsonInput: string) => handlers.evaluate_shape_parts(jsonInput),
  evaluate_shape_region: (jsonInput: string) => handlers.evaluate_shape_region(jsonInput),
  render_shape_region_svg: (jsonInput: string) => handlers.render_shape_region_svg(jsonInput),
  divide_shape_regions: (jsonInput: string) => handlers.divide_shape_regions(jsonInput),
  compute_shape_intersections: (jsonInput: string) =>
    handlers.compute_shape_intersections(jsonInput),
} as unknown as WasmModule;

function resetHandlers(): void {
  handlers.compile_shape_svg = () => "<svg/>";
  handlers.hit_test_shape_parts = () => "[]";
  handlers.compile_shape_paths = () => "[]";
  handlers.resolve_symbol_geometry = () =>
    '{"viewBox":{"x":0,"y":0,"width":10,"height":10},"root":{"kind":"path","d":"M0 0Z"}}';
  handlers.evaluate_shape_parts = () => "[]";
  handlers.evaluate_shape_region = () => '{"contours":[]}';
  handlers.render_shape_region_svg = () => "<svg/>";
  handlers.divide_shape_regions = () => '{"subtract":{"contours":[]},"intersect":{"contours":[]}}';
  handlers.compute_shape_intersections = () => "[]";
}

describe("shape operation boundary", () => {
  beforeAll(() => {
    initWasm(mockModule);
  });

  beforeEach(() => {
    resetHandlers();
  });

  it("reports availability only when the full operation family is present", () => {
    expect(isShapeWasmAvailable()).toBe(true);
  });

  it("relays an exact Rust diagnostic and closes malformed throws", () => {
    handlers.compile_shape_svg = (): never => {
      throw JSON.stringify({
        severity: "fatal",
        code: "SHAPE_PATH_DATA_INVALID",
        message: "Shape path data is invalid.",
        stage: "validate",
        context: { operation: "compileShapeSvg" },
      });
    };
    expect(() => wasmCompileShapeSvg(VALID_GEOMETRY)).toThrowError(
      expect.objectContaining({
        code: "SHAPE_PATH_DATA_INVALID",
        message: "Shape path data is invalid.",
        stage: "validate",
        context: { operation: "compileShapeSvg" },
      }),
    );

    handlers.compile_shape_svg = (): never => {
      throw new TypeError("transport details");
    };
    expect(() => wasmCompileShapeSvg(VALID_GEOMETRY)).toThrowError(
      expect.objectContaining({
        code: "SHAPE_WASM_FAILED",
        message: "Shape operation WASM transport failed.",
        stage: "wasm",
        context: { operation: "compileShapeSvg" },
      }),
    );
  });

  it("maps malformed success values to the decode boundary", () => {
    handlers.compile_shape_svg = () => ({ unexpected: true });
    expect(() => wasmCompileShapeSvg(VALID_GEOMETRY)).toThrowError(
      expect.objectContaining({
        code: "SHAPE_OUTPUT_INVALID",
        message: "Shape operation returned invalid output.",
        stage: "wasm",
        context: {
          operation: "compileShapeSvg",
          phase: "decode",
          protocolPath: "$",
          received: "object(keys=1)",
        },
      }),
    );
  });

  it("classifies JSON serialization failure after the capability check", () => {
    const invoke = vi.fn(() => "<svg/>");
    handlers.compile_shape_svg = invoke;
    const unserializableGeometry = {
      ...VALID_GEOMETRY,
      extra: 1n,
    } as unknown as GeometryDoc;

    expect(() => wasmCompileShapeSvg(unserializableGeometry)).toThrowError(
      expect.objectContaining({
        code: "SHAPE_INPUT_INVALID",
        message: "Shape operation input is invalid.",
        stage: "validate",
        context: { operation: "compileShapeSvg", reason: "serializationFailed" },
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("checks binary authored depth from lhs to rhs", () => {
    let deepRoot = VALID_GEOMETRY.root;
    for (let depth = 0; depth <= 48; depth += 1) {
      deepRoot = { kind: "group", children: [deepRoot] };
    }
    const overDepth = { ...VALID_GEOMETRY, root: deepRoot };
    const invoke = vi.fn(() => '{"subtract":{"contours":[]},"intersect":{"contours":[]}}');
    handlers.divide_shape_regions = invoke;

    expect(() => wasmDivideShapeRegions(overDepth, overDepth)).toThrowError(
      expect.objectContaining({
        code: "SHAPE_GEOMETRY_MAX_DEPTH",
        context: {
          operation: "divideShapeRegions",
          operand: "lhs",
          actual: 49,
          limit: 48,
        },
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
