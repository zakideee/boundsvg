import type { GeometryDoc } from "@boundsvg/shape";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import {
  getWasm,
  wasmCompileShapePaths,
  wasmCompileShapeSvg,
  wasmComputeShapeIntersections,
  wasmDivideShapeRegions,
  wasmEvaluateShapeParts,
  wasmEvaluateShapeRegion,
  wasmHitTestShapeParts,
  wasmRenderShapeRegionSvg,
} from "../../src/wasm/index.js";
import { assertWasmPkgAvailable } from "./test-prerequisites.js";

function pathGeometry(pathData: string): GeometryDoc {
  return {
    viewBox: { width: 200, height: 200 },
    root: { kind: "path", d: pathData },
  };
}

function overDepthGeometry(leaf: GeometryDoc["root"]): GeometryDoc {
  let root = leaf;
  for (let depth = 0; depth <= 48; depth += 1) {
    root = { kind: "group", children: [root] };
  }
  return { viewBox: { width: 200, height: 200 }, root };
}

function captureFatal(callback: () => unknown): FatalError {
  let capturedError: unknown;
  try {
    callback();
  } catch (error) {
    capturedError = error;
  }
  expect(capturedError).toBeInstanceOf(FatalError);
  return capturedError as FatalError;
}

function captureRawDiagnostic(callback: () => unknown): unknown {
  let capturedError: unknown;
  try {
    callback();
  } catch (error) {
    capturedError = error;
  }
  expect(typeof capturedError).toBe("string");
  return JSON.parse(capturedError as string) as unknown;
}

describe("standalone shape failure contract", () => {
  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
  });

  it("classifies malformed JSON separately from an invalid request shape", () => {
    const rawCompile = getWasm().compile_shape_svg;
    expect(rawCompile).toBeTypeOf("function");

    expect(captureRawDiagnostic(() => rawCompile?.("{"))).toEqual({
      severity: "fatal",
      code: "SHAPE_INPUT_INVALID",
      message: "Shape operation input is invalid.",
      stage: "validate",
      context: { operation: "compileShapeSvg", reason: "malformedJson" },
    });
    expect(captureRawDiagnostic(() => rawCompile?.('{"geometry":{}}'))).toEqual({
      severity: "fatal",
      code: "SHAPE_INPUT_INVALID",
      message: "Shape operation input is invalid.",
      stage: "validate",
      context: { operation: "compileShapeSvg", reason: "invalidRequestShape" },
    });
  });

  it("preserves missing, null, and value input presence on the three optional routes", () => {
    const wasm = getWasm();
    const rawCompile = wasm.compile_shape_svg;
    const rawHitTest = wasm.hit_test_shape_parts;
    const rawRegionRender = wasm.render_shape_region_svg;
    expect(rawCompile).toBeTypeOf("function");
    expect(rawHitTest).toBeTypeOf("function");
    expect(rawRegionRender).toBeTypeOf("function");

    const geometry = pathGeometry("M0 0H10V10H0Z");
    const compileMissing = rawCompile?.(JSON.stringify({ geometry }));
    const compileNull = rawCompile?.(JSON.stringify({ geometry, paint: null, viewport: null }));
    const compileValue = rawCompile?.(
      JSON.stringify({
        geometry,
        paint: { fill: "#ff0000" },
        viewport: { width: 20, height: 30 },
      }),
    );
    expect(compileNull).toBe(compileMissing);
    expect(compileValue).toContain('viewBox="0 0 20 30"');
    expect(compileValue).toContain('fill="#ff0000"');

    const hitInput = { geometry, point: { x: 5, y: 5 } };
    const hitMissing = rawHitTest?.(JSON.stringify(hitInput));
    const hitNull = rawHitTest?.(JSON.stringify({ ...hitInput, options: null }));
    const hitValue = rawHitTest?.(
      JSON.stringify({
        ...hitInput,
        options: { strokeWidth: 1, tolerance: 0, fillRule: "nonzero" },
      }),
    );
    expect(hitNull).toBe(hitMissing);
    expect(JSON.parse(hitValue ?? "null")).toBeInstanceOf(Array);

    const region = {
      contours: [
        {
          segments: [
            { kind: "line", p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } },
            { kind: "line", p0: { x: 10, y: 0 }, p1: { x: 10, y: 10 } },
            { kind: "line", p0: { x: 10, y: 10 }, p1: { x: 0, y: 10 } },
            { kind: "line", p0: { x: 0, y: 10 }, p1: { x: 0, y: 0 } },
          ],
          closed: true,
        },
      ],
    };
    const regionMissing = rawRegionRender?.(JSON.stringify({ region }));
    const regionNull = rawRegionRender?.(JSON.stringify({ region, paint: null, viewport: null }));
    const regionValue = rawRegionRender?.(
      JSON.stringify({
        region,
        paint: { fill: "#ff0000" },
        viewport: { width: 20, height: 30 },
      }),
    );
    expect(regionNull).toBe(regionMissing);
    expect(regionValue).toContain('viewBox="0 0 20 30"');
    expect(regionValue).toContain('fill="#ff0000"');
  });

  it("projects representative kernel failures with exact public tuples", () => {
    const cases: Array<{
      invoke: () => unknown;
      expected: {
        code: string;
        message: string;
        stage: string;
        context: Record<string, unknown>;
      };
    }> = [
      {
        invoke: () => wasmCompileShapeSvg(pathGeometry("M0 0L")),
        expected: {
          code: "SHAPE_PATH_DATA_INVALID",
          message: "Shape path data is invalid.",
          stage: "validate",
          context: { operation: "compileShapeSvg" },
        },
      },
      {
        invoke: () => wasmHitTestShapeParts(pathGeometry("M0 0X10 10"), { x: 0, y: 0 }),
        expected: {
          code: "SHAPE_PATH_COMMAND_UNSUPPORTED",
          message: "Shape path data uses an unsupported command.",
          stage: "validate",
          context: { operation: "hitTestShapeParts", command: "X" },
        },
      },
      {
        invoke: () =>
          wasmEvaluateShapeRegion({
            viewBox: { width: 10, height: 10 },
            root: {
              kind: "boolean",
              op: "union",
              children: [{ kind: "path", d: "M0 0H10V10H0Z" }],
            },
          }),
        expected: {
          code: "SHAPE_BOOLEAN_CHILD_COUNT",
          message: "Shape boolean nodes require at least two children.",
          stage: "validate",
          context: { operation: "evaluateShapeRegion" },
        },
      },
      {
        invoke: () =>
          wasmEvaluateShapeRegion(
            pathGeometry("M22 145L10 100L178 145L145 178L100 10L55 178L178 55Z"),
          ),
        expected: {
          code: "SHAPE_BOOLEAN_TOPOLOGY_FAILED",
          message: "Shape boolean evaluation could not reconstruct a closed boundary.",
          stage: "ir",
          context: { operation: "evaluateShapeRegion" },
        },
      },
    ];

    for (const testCase of cases) {
      expect(captureFatal(testCase.invoke)).toMatchObject(testCase.expected);
    }
  });

  it("bounds duplicate identifiers without exposing the complete value", () => {
    const duplicateId = "界".repeat(100);
    const duplicateGeometry: GeometryDoc = {
      viewBox: { width: 30, height: 10 },
      root: {
        kind: "group",
        children: [
          { kind: "path", nodeId: duplicateId, d: "M0 0H10V10H0Z" },
          { kind: "path", nodeId: duplicateId, d: "M20 0H30V10H20Z" },
        ],
      },
    };

    const fatalError = captureFatal(() => wasmEvaluateShapeParts(duplicateGeometry));
    expect(fatalError).toMatchObject({
      code: "SHAPE_DUPLICATE_PART_ID",
      message: "Shape contains a duplicate addressable part id.",
      stage: "validate",
    });
    expect(fatalError.context).toEqual({
      operation: "evaluateShapeParts",
      partIdPrefix: "界".repeat(85),
      omittedPartIdByteCount: 45,
    });
    expect(new TextEncoder().encode(fatalError.context?.partIdPrefix as string)).toHaveLength(255);
  });

  it("attributes only divide operand evaluation failures", () => {
    const valid = pathGeometry("M0 0H20V20H0Z");
    const invalid = pathGeometry("M0 0L");

    expect(captureFatal(() => wasmDivideShapeRegions(valid, invalid)).context).toEqual({
      operation: "divideShapeRegions",
      operand: "rhs",
    });
    expect(captureFatal(() => wasmComputeShapeIntersections(valid, invalid)).context).toEqual({
      operation: "computeShapeIntersections",
    });
  });

  it("rejects derived non-finite path, JSON, and SVG output before return", () => {
    const extremeGeometry = pathGeometry("M-1e308 0L1e308 0");
    const extremeRegion = {
      contours: [
        {
          segments: [
            {
              kind: "line" as const,
              p0: { x: -1e308, y: 0 },
              p1: { x: 1e308, y: 0 },
            },
          ],
          closed: false,
        },
      ],
    };
    const cases = [
      {
        operation: "compileShapePaths",
        invoke: () => wasmCompileShapePaths(extremeGeometry),
      },
      { operation: "compileShapeSvg", invoke: () => wasmCompileShapeSvg(extremeGeometry) },
      {
        operation: "renderShapeRegionSvg",
        invoke: () => wasmRenderShapeRegionSvg(extremeRegion),
      },
    ] as const;

    for (const testCase of cases) {
      expect(captureFatal(testCase.invoke).toJSON()).toEqual({
        severity: "fatal",
        code: "SHAPE_OUTPUT_INVALID",
        message: "Shape operation returned invalid output.",
        stage: "wasm",
        context: { operation: testCase.operation, phase: "serialize" },
      });
    }
  });

  it("projects the same compiled-result failure for rendered Shape and Symbol nodes", async () => {
    const extremeGeometry = pathGeometry("M-1e308 0L1e308 0");
    const engine = await createEngineAsync({
      geometries: [{ id: "extreme", doc: extremeGeometry }],
      symbols: [
        {
          id: "extreme",
          def: { geometry: extremeGeometry, elasticSegments: [] },
        },
      ],
    });

    try {
      const cases = [
        {
          node: {
            type: "Shape",
            id: "extreme-shape",
            geometryId: "extreme",
            width: 200,
            height: 200,
          },
          operation: "renderShape",
          nodeId: "extreme-shape",
        },
        {
          node: {
            type: "Symbol",
            id: "extreme-symbol",
            symbolId: "extreme",
            width: 200,
            height: 200,
          },
          operation: "renderSymbol",
          nodeId: "extreme-symbol",
        },
      ] as const;

      for (const testCase of cases) {
        const fatalError = captureFatal(() =>
          engine.renderToIR({
            type: "Canvas",
            width: 200,
            height: 200,
            children: [testCase.node],
          } as never),
        );
        expect(fatalError.toJSON()).toEqual({
          severity: "fatal",
          code: "SHAPE_OUTPUT_INVALID",
          message: "Shape operation returned invalid output.",
          stage: "wasm",
          nodeId: testCase.nodeId,
          context: { operation: testCase.operation, phase: "serialize" },
        });
      }
    } finally {
      engine.dispose();
    }
  });

  it("keeps registry, depth, duplicate, and kernel render precedence", async () => {
    const duplicateInvalidRoot: GeometryDoc["root"] = {
      kind: "group",
      children: [
        { kind: "path", nodeId: "same", d: "M0 0L" },
        { kind: "path", nodeId: "same", d: "M0 0H10V10H0Z" },
      ],
    };
    const deepDuplicateGeometry = overDepthGeometry(duplicateInvalidRoot);
    const duplicateInvalidGeometry: GeometryDoc = {
      viewBox: { width: 20, height: 20 },
      root: duplicateInvalidRoot,
    };
    const engine = await createEngineAsync({});

    try {
      const registryFatal = captureFatal(() =>
        engine.renderToIR({
          type: "Canvas",
          width: 20,
          height: 20,
          children: [
            {
              type: "Shape",
              id: "missing-first",
              geometryId: "missing",
              width: 10,
              height: 10,
            },
            {
              type: "Shape",
              id: "deep-second",
              geometry: deepDuplicateGeometry,
              width: 10,
              height: 10,
            },
          ],
        } as never),
      );
      expect(registryFatal.toJSON()).toEqual({
        severity: "fatal",
        code: "SHAPE_GEOMETRY_NOT_FOUND",
        message: 'Shape references unknown geometryId "missing".',
        stage: "validate",
        nodeId: "missing-first",
      });

      const depthFatal = captureFatal(() =>
        engine.renderToIR({
          type: "Canvas",
          width: 20,
          height: 20,
          children: [
            {
              type: "Shape",
              id: "deep-duplicate",
              geometry: deepDuplicateGeometry,
              width: 10,
              height: 10,
            },
          ],
        } as never),
      );
      expect(depthFatal.toJSON()).toEqual({
        severity: "fatal",
        code: "SHAPE_GEOMETRY_MAX_DEPTH",
        message: "Shape geometry exceeds the maximum tree depth.",
        stage: "validate",
        nodeId: "deep-duplicate",
        context: {
          operation: "renderShape",
          actual: 49,
          limit: 48,
        },
      });

      const duplicateFatal = captureFatal(() =>
        engine.renderToIR({
          type: "Canvas",
          width: 20,
          height: 20,
          children: [
            {
              type: "Shape",
              id: "duplicate-invalid",
              geometry: duplicateInvalidGeometry,
              width: 10,
              height: 10,
            },
          ],
        } as never),
      );
      expect(duplicateFatal.toJSON()).toEqual({
        severity: "fatal",
        code: "SHAPE_DUPLICATE_PART_ID",
        message: "Shape contains a duplicate addressable part id.",
        stage: "validate",
        nodeId: "duplicate-invalid",
        context: {
          operation: "renderShape",
          partIdPrefix: "same",
          omittedPartIdByteCount: 0,
        },
      });
    } finally {
      engine.dispose();
    }
  });
});
