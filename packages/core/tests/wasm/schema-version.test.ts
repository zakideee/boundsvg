import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import {
  EXPECTED_WASM_SCHEMA_VERSION,
  getWasm,
  initWasm,
  isShapeWasmAvailable,
  isWasmInitialized,
  wasmComputeShapeIntersections,
} from "../../src/wasm/index.js";
import type { WasmModule } from "../../src/wasm/types.js";

// This file must NOT initialize the real WASM module before the mock cases:
// initWasm() is a module-level singleton and vitest isolates module state per
// test file, so the rejection paths are only observable here.

function mockModule(overrides: Partial<Record<string, unknown>>): WasmModule {
  return overrides as unknown as WasmModule;
}

describe("WASM schema version handshake", () => {
  it("rejects a module without wasm_schema_version", () => {
    expect(isWasmInitialized()).toBe(false);
    expect(isShapeWasmAvailable()).toBe(false);
    let caught: unknown;
    try {
      initWasm(mockModule({}));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FatalError);
    expect((caught as FatalError).code).toBe("WASM_SCHEMA_MISMATCH");
    expect((caught as FatalError).message).toContain("none");
    expect(isWasmInitialized()).toBe(false);
  });

  it("rejects a module with a mismatched version", () => {
    let caught: unknown;
    try {
      initWasm(mockModule({ wasm_schema_version: () => EXPECTED_WASM_SCHEMA_VERSION + 1 }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FatalError);
    expect((caught as FatalError).code).toBe("WASM_SCHEMA_MISMATCH");
    expect((caught as FatalError).stage).toBe("wasm");
    expect(isWasmInitialized()).toBe(false);
  });

  it("accepts one module idempotently and rejects a different module", () => {
    const accepted = mockModule({
      wasm_schema_version: () => EXPECTED_WASM_SCHEMA_VERSION,
      compile_shape_svg: () => "<svg/>",
      hit_test_shape_parts: () => "[]",
      compile_shape_paths: () => "[]",
      resolve_symbol_geometry: () =>
        '{"viewBox":{"x":0,"y":0,"width":1,"height":1},"root":{"kind":"path","d":"M0 0Z"}}',
      evaluate_shape_parts: () => "[]",
      evaluate_shape_region: () => '{"contours":[]}',
      render_shape_region_svg: () => "<svg/>",
      divide_shape_regions: () => '{"subtract":{"contours":[]},"intersect":{"contours":[]}}',
    });
    initWasm(accepted);
    expect(() => initWasm(accepted)).not.toThrow();
    expect(isWasmInitialized()).toBe(true);
    expect(isShapeWasmAvailable()).toBe(false);
    expect(getWasm()).toBe(accepted);
    expect(() =>
      wasmComputeShapeIntersections(
        { viewBox: { width: 1, height: 1 }, root: { kind: "path", d: "M0 0Z" } },
        { viewBox: { width: 1, height: 1 }, root: { kind: "path", d: "M0 0Z" } },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "SHAPE_WASM_CAPABILITY_MISSING",
        message: "Required shape WASM capability is unavailable.",
        stage: "wasm",
        context: { operation: "computeShapeIntersections" },
      }),
    );
    const unserializableGeometry = {
      viewBox: { width: 1, height: 1 },
      root: { kind: "path", d: "M0 0Z" },
      extra: 1n,
    } as unknown as Parameters<typeof wasmComputeShapeIntersections>[0];
    expect(() =>
      wasmComputeShapeIntersections(unserializableGeometry, unserializableGeometry),
    ).toThrowError(
      expect.objectContaining({
        code: "SHAPE_WASM_CAPABILITY_MISSING",
        message: "Required shape WASM capability is unavailable.",
        stage: "wasm",
        context: { operation: "computeShapeIntersections" },
      }),
    );

    const different = mockModule({
      wasm_schema_version: () => EXPECTED_WASM_SCHEMA_VERSION,
    });
    expect(() => initWasm(different)).toThrowError(
      expect.objectContaining({
        name: "FatalError",
        code: "WASM_ALREADY_INITIALIZED",
        stage: "wasm",
      }),
    );
    expect(getWasm()).toBe(accepted);
  });
});
