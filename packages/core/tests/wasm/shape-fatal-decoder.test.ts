import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import {
  decodeWasmShapeFatal,
  type StandaloneShapeOperation,
} from "../../src/wasm/shape-fatal-decoder.js";

function serializeFatal(input: {
  code: string;
  message: string;
  stage: string;
  context: Record<string, unknown>;
}): string {
  return JSON.stringify({ severity: "fatal", ...input });
}

const FALLBACK_ENVELOPES: ReadonlyArray<readonly [StandaloneShapeOperation, string]> = [
  [
    "compileShapeSvg",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"compileShapeSvg"}}',
  ],
  [
    "hitTestShapeParts",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"hitTestShapeParts"}}',
  ],
  [
    "compileShapePaths",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"compileShapePaths"}}',
  ],
  [
    "resolveSymbolGeometry",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"resolveSymbolGeometry"}}',
  ],
  [
    "evaluateShapeParts",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"evaluateShapeParts"}}',
  ],
  [
    "evaluateShapeRegion",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"evaluateShapeRegion"}}',
  ],
  [
    "renderShapeRegionSvg",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"renderShapeRegionSvg"}}',
  ],
  [
    "divideShapeRegions",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"divideShapeRegions"}}',
  ],
  [
    "computeShapeIntersections",
    '{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"computeShapeIntersections"}}',
  ],
];

describe("standalone shape Fatal decoder", () => {
  it("accepts every fixed transport fallback envelope", () => {
    for (const [operation, envelope] of FALLBACK_ENVELOPES) {
      const fatalError = decodeWasmShapeFatal(envelope, operation);
      expect(fatalError).toBeInstanceOf(FatalError);
      expect(fatalError?.toJSON()).toEqual(JSON.parse(envelope));
      expect(new TextEncoder().encode(envelope).length).toBeLessThanOrEqual(8_192);
    }
  });

  it("accepts exact domain and boundary tuples", () => {
    const invalidPath = serializeFatal({
      code: "SHAPE_PATH_DATA_INVALID",
      message: "Shape path data is invalid.",
      stage: "validate",
      context: { operation: "compileShapeSvg" },
    });
    expect(decodeWasmShapeFatal(invalidPath, "compileShapeSvg")?.code).toBe(
      "SHAPE_PATH_DATA_INVALID",
    );

    const divideDepth = serializeFatal({
      code: "SHAPE_GEOMETRY_MAX_DEPTH",
      message: "Shape geometry exceeds the maximum tree depth.",
      stage: "validate",
      context: { operation: "divideShapeRegions", operand: "rhs", actual: 49, limit: 48 },
    });
    expect(decodeWasmShapeFatal(divideDepth, "divideShapeRegions")?.context).toEqual({
      operation: "divideShapeRegions",
      operand: "rhs",
      actual: 49,
      limit: 48,
    });

    const nonFiniteOutput = serializeFatal({
      code: "SHAPE_OUTPUT_INVALID",
      message: "Shape operation returned invalid output.",
      stage: "wasm",
      context: { operation: "evaluateShapeRegion", phase: "serialize" },
    });
    expect(decodeWasmShapeFatal(nonFiniteOutput, "evaluateShapeRegion")?.code).toBe(
      "SHAPE_OUTPUT_INVALID",
    );
  });

  it("enforces the operation and divide-operand domain reachability matrix", () => {
    const operations = [
      "compileShapeSvg",
      "hitTestShapeParts",
      "compileShapePaths",
      "resolveSymbolGeometry",
      "evaluateShapeParts",
      "evaluateShapeRegion",
      "renderShapeRegionSvg",
      "divideShapeRegions",
      "computeShapeIntersections",
    ] as const;
    const compileOperations = [
      "compileShapeSvg",
      "hitTestShapeParts",
      "compileShapePaths",
      "evaluateShapeParts",
    ] as const;
    const regionOperations = [
      "evaluateShapeRegion",
      "divideShapeRegions",
      "computeShapeIntersections",
    ] as const;
    const domainCases = [
      {
        code: "SHAPE_BOOLEAN_CHILD_COUNT",
        message: "Shape boolean nodes require at least two children.",
        stage: "validate",
        additionalContext: {},
        reachableOperations: [...compileOperations, ...regionOperations],
        divideOperand: true,
      },
      {
        code: "SHAPE_PATH_DATA_INVALID",
        message: "Shape path data is invalid.",
        stage: "validate",
        additionalContext: {},
        reachableOperations: [...compileOperations, ...regionOperations],
        divideOperand: true,
      },
      {
        code: "SHAPE_PATH_COMMAND_UNSUPPORTED",
        message: "Shape path data uses an unsupported command.",
        stage: "validate",
        additionalContext: { command: "X" },
        reachableOperations: [...compileOperations, ...regionOperations],
        divideOperand: true,
      },
      {
        code: "SHAPE_BOOLEAN_TOPOLOGY_FAILED",
        message: "Shape boolean evaluation could not reconstruct a closed boundary.",
        stage: "ir",
        additionalContext: {},
        reachableOperations: [...compileOperations, ...regionOperations],
        divideOperand: false,
      },
      {
        code: "SHAPE_DUPLICATE_PART_ID",
        message: "Shape contains a duplicate addressable part id.",
        stage: "validate",
        additionalContext: { partIdPrefix: "same", omittedPartIdByteCount: 0 },
        reachableOperations: compileOperations,
        divideOperand: false,
      },
      {
        code: "SHAPE_GEOMETRY_MAX_DEPTH",
        message: "Shape geometry exceeds the maximum tree depth.",
        stage: "validate",
        additionalContext: { actual: 49, limit: 48 },
        reachableOperations: [...compileOperations, "resolveSymbolGeometry", ...regionOperations],
        divideOperand: true,
      },
      {
        code: "SHAPE_PATH_MULTIPLE_SUBPATHS",
        message: "Shape path measurement requires exactly one drawable subpath.",
        stage: "validate",
        additionalContext: {},
        reachableOperations: [],
        divideOperand: false,
      },
      {
        code: "SHAPE_PATH_ZERO_LENGTH",
        message: "Shape path measurement requires a non-zero path length.",
        stage: "validate",
        additionalContext: {},
        reachableOperations: [],
        divideOperand: false,
      },
      {
        code: "SHAPE_PATH_COMPLEXITY_LIMIT",
        message: "Shape path measurement exceeded its complexity limit.",
        stage: "ir",
        additionalContext: {},
        reachableOperations: [],
        divideOperand: false,
      },
      {
        code: "SHAPE_PATH_OFFSET_GEOMETRY_INVALID",
        message: "Shape path offset geometry could not be materialized.",
        stage: "ir",
        additionalContext: {},
        reachableOperations: [],
        divideOperand: false,
      },
      {
        code: "SHAPE_PATH_OFFSET_SAMPLE_LIMIT",
        message: "Shape path offset sampling exceeded its complexity limit.",
        stage: "ir",
        additionalContext: {},
        reachableOperations: [],
        divideOperand: false,
      },
      {
        code: "SHAPE_BOOLEAN_PAIR_LIMIT",
        message: "Shape boolean evaluation exceeded its pair limit.",
        stage: "ir",
        additionalContext: {},
        reachableOperations: [...compileOperations, ...regionOperations],
        divideOperand: false,
      },
      {
        code: "SHAPE_REGION_CLIP_INTERVAL_INVALID",
        message: "Shape region clipping requires a finite increasing interval.",
        stage: "validate",
        additionalContext: {},
        reachableOperations: [],
        divideOperand: false,
      },
      {
        code: "SHAPE_REGION_CLIP_NON_MONOTONIC",
        message: "Shape region clipping requires axis-monotonic contour segments.",
        stage: "validate",
        additionalContext: {},
        reachableOperations: [],
        divideOperand: false,
      },
    ] as const;

    expect(domainCases).toHaveLength(14);
    for (const testCase of domainCases) {
      for (const operation of operations) {
        const context = {
          operation,
          ...(operation === "divideShapeRegions" && testCase.divideOperand
            ? { operand: "rhs" }
            : {}),
          ...testCase.additionalContext,
        };
        const decoded = decodeWasmShapeFatal(
          serializeFatal({
            code: testCase.code,
            message: testCase.message,
            stage: testCase.stage,
            context,
          }),
          operation,
        );
        const isReachable = testCase.reachableOperations.includes(
          operation as (typeof testCase.reachableOperations)[number],
        );
        expect(decoded?.code, `${operation} / ${testCase.code}`).toBe(
          isReachable ? testCase.code : undefined,
        );
      }
    }

    for (const testCase of domainCases.filter((entry) => entry.divideOperand)) {
      const missingOperand = serializeFatal({
        code: testCase.code,
        message: testCase.message,
        stage: testCase.stage,
        context: { operation: "divideShapeRegions", ...testCase.additionalContext },
      });
      expect(decodeWasmShapeFatal(missingOperand, "divideShapeRegions")).toBeUndefined();
    }

    const divideOperandCases = [
      [
        "SHAPE_BOOLEAN_TOPOLOGY_FAILED",
        "Shape boolean evaluation could not reconstruct a closed boundary.",
      ],
      ["SHAPE_BOOLEAN_PAIR_LIMIT", "Shape boolean evaluation exceeded its pair limit."],
    ] as const;
    for (const [code, message] of divideOperandCases) {
      expect(
        decodeWasmShapeFatal(
          serializeFatal({
            code,
            message,
            stage: "ir",
            context: { operation: "divideShapeRegions", operand: "lhs" },
          }),
          "divideShapeRegions",
        )?.code,
      ).toBe(code);
    }
  });

  it("rejects malformed, oversized, hostile, and cross-operation values", () => {
    expect(decodeWasmShapeFatal(new TypeError("transport"), "compileShapeSvg")).toBeUndefined();
    expect(decodeWasmShapeFatal("{", "compileShapeSvg")).toBeUndefined();
    expect(decodeWasmShapeFatal("x".repeat(8_193), "compileShapeSvg")).toBeUndefined();

    const wrongOperation = serializeFatal({
      code: "SHAPE_PANIC",
      message: "Shape operation failed unexpectedly.",
      stage: "wasm",
      context: { operation: "evaluateShapeRegion" },
    });
    expect(decodeWasmShapeFatal(wrongOperation, "compileShapeSvg")).toBeUndefined();

    const impossibleRoute = serializeFatal({
      code: "SHAPE_PATH_DATA_INVALID",
      message: "Shape path data is invalid.",
      stage: "validate",
      context: { operation: "resolveSymbolGeometry" },
    });
    expect(decodeWasmShapeFatal(impossibleRoute, "resolveSymbolGeometry")).toBeUndefined();
  });

  it("rejects unknown or reserved fields and invalid bounded values", () => {
    const withNodeId = JSON.stringify({
      severity: "fatal",
      code: "SHAPE_PANIC",
      message: "Shape operation failed unexpectedly.",
      stage: "wasm",
      nodeId: "shape-1",
      context: { operation: "compileShapeSvg" },
    });
    expect(decodeWasmShapeFatal(withNodeId, "compileShapeSvg")).toBeUndefined();

    const invalidCommand = serializeFatal({
      code: "SHAPE_PATH_COMMAND_UNSUPPORTED",
      message: "Shape path data uses an unsupported command.",
      stage: "validate",
      context: { operation: "compileShapeSvg", command: "XY" },
    });
    expect(decodeWasmShapeFatal(invalidCommand, "compileShapeSvg")).toBeUndefined();
    const invalidSurrogateCommand = serializeFatal({
      code: "SHAPE_PATH_COMMAND_UNSUPPORTED",
      message: "Shape path data uses an unsupported command.",
      stage: "validate",
      context: { operation: "compileShapeSvg", command: "\ud800" },
    });
    expect(decodeWasmShapeFatal(invalidSurrogateCommand, "compileShapeSvg")).toBeUndefined();

    const invalidDepth = serializeFatal({
      code: "SHAPE_GEOMETRY_MAX_DEPTH",
      message: "Shape geometry exceeds the maximum tree depth.",
      stage: "validate",
      context: { operation: "compileShapeSvg", actual: 48, limit: 48 },
    });
    expect(decodeWasmShapeFatal(invalidDepth, "compileShapeSvg")).toBeUndefined();

    const invalidDuplicate = serializeFatal({
      code: "SHAPE_DUPLICATE_PART_ID",
      message: "Shape contains a duplicate addressable part id.",
      stage: "validate",
      context: {
        operation: "compileShapePaths",
        partIdPrefix: "界".repeat(86),
        omittedPartIdByteCount: 0,
      },
    });
    expect(decodeWasmShapeFatal(invalidDuplicate, "compileShapePaths")).toBeUndefined();
    const invalidSurrogateDuplicate = serializeFatal({
      code: "SHAPE_DUPLICATE_PART_ID",
      message: "Shape contains a duplicate addressable part id.",
      stage: "validate",
      context: {
        operation: "compileShapePaths",
        partIdPrefix: "\ud800",
        omittedPartIdByteCount: 0,
      },
    });
    expect(decodeWasmShapeFatal(invalidSurrogateDuplicate, "compileShapePaths")).toBeUndefined();
  });
});
