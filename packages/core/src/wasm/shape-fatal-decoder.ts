import { FatalError } from "../errors.js";

const MAX_SHAPE_CONTEXT_BYTES = 4_096;
const MAX_SHAPE_ENVELOPE_BYTES = 8_192;
const MAX_SHAPE_DESCRIPTOR_BYTES = 256;
const MAX_PART_ID_PREFIX_BYTES = 256;
const MAX_GEOMETRY_TREE_DEPTH = 48;

export type StandaloneShapeOperation =
  | "compileShapeSvg"
  | "hitTestShapeParts"
  | "compileShapePaths"
  | "resolveSymbolGeometry"
  | "evaluateShapeParts"
  | "evaluateShapeRegion"
  | "renderShapeRegionSvg"
  | "divideShapeRegions"
  | "computeShapeIntersections";

export type ShapeOperation = StandaloneShapeOperation | "renderShape" | "renderSymbol";
export type ShapeOperand = "lhs" | "rhs";
type ShapeInputFailureReason = "serializationFailed" | "malformedJson" | "invalidRequestShape";

type JsonObject = Record<string, unknown>;

const GEOMETRY_COMPILE_CODES = new Set([
  "SHAPE_BOOLEAN_CHILD_COUNT",
  "SHAPE_PATH_DATA_INVALID",
  "SHAPE_PATH_COMMAND_UNSUPPORTED",
  "SHAPE_BOOLEAN_TOPOLOGY_FAILED",
  "SHAPE_DUPLICATE_PART_ID",
  "SHAPE_GEOMETRY_MAX_DEPTH",
  "SHAPE_BOOLEAN_PAIR_LIMIT",
]);
const GEOMETRY_REGION_CODES = new Set([
  "SHAPE_BOOLEAN_CHILD_COUNT",
  "SHAPE_PATH_DATA_INVALID",
  "SHAPE_PATH_COMMAND_UNSUPPORTED",
  "SHAPE_BOOLEAN_TOPOLOGY_FAILED",
  "SHAPE_GEOMETRY_MAX_DEPTH",
  "SHAPE_BOOLEAN_PAIR_LIMIT",
]);
const BOUNDARY_CODES = new Set([
  "SHAPE_INPUT_INVALID",
  "SHAPE_OUTPUT_INVALID",
  "SHAPE_PANIC",
  "SHAPE_WASM_FAILED",
  "SHAPE_WASM_CAPABILITY_MISSING",
]);

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function fitsUtf8ByteLimit(value: string, maximumBytes: number): boolean {
  return value.length <= maximumBytes && utf8ByteLength(value) <= maximumBytes;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (fitsUtf8ByteLimit(value, maximumBytes)) {
    return value;
  }
  let result = "";
  let byteCount = 0;
  for (const scalar of value) {
    const scalarBytes = utf8ByteLength(scalar);
    if (byteCount + scalarBytes > maximumBytes) {
      break;
    }
    result += scalar;
    byteCount += scalarBytes;
  }
  return result;
}

function isPlainObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function hasExactFields(value: unknown, fields: readonly string[]): value is JsonObject {
  if (!isPlainObject(value)) {
    return false;
  }
  const actualFields = Object.keys(value);
  return (
    actualFields.length === fields.length && fields.every((field) => Object.hasOwn(value, field))
  );
}

function contextFitsWireLimit(context: JsonObject): boolean {
  try {
    const serialized = JSON.stringify(context);
    return fitsUtf8ByteLimit(serialized, MAX_SHAPE_CONTEXT_BYTES);
  } catch {
    return false;
  }
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasOperation(
  context: unknown,
  operation: StandaloneShapeOperation,
  fields: readonly string[] = ["operation"],
): context is JsonObject {
  return hasExactFields(context, fields) && context.operation === operation;
}

function isSingleUnicodeScalar(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || !isWellFormedUnicode(value)) {
    return false;
  }
  const codePoint = value.codePointAt(0);
  return codePoint !== undefined && String.fromCodePoint(codePoint) === value;
}

function isBinaryOperandContext(
  context: unknown,
  operation: StandaloneShapeOperation,
): context is JsonObject {
  return (
    operation === "divideShapeRegions" &&
    hasOperation(context, operation, ["operation", "operand"]) &&
    (context.operand === "lhs" || context.operand === "rhs")
  );
}

function isOperationContext(
  context: unknown,
  operation: StandaloneShapeOperation,
  allowDivideOperand: boolean,
): boolean {
  return (
    hasOperation(context, operation) ||
    (allowDivideOperand && isBinaryOperandContext(context, operation))
  );
}

function isGeometryEvaluationContext(
  context: unknown,
  operation: StandaloneShapeOperation,
): boolean {
  return operation === "divideShapeRegions"
    ? isBinaryOperandContext(context, operation)
    : hasOperation(context, operation);
}

function isInputContext(context: unknown, operation: StandaloneShapeOperation): boolean {
  return (
    hasOperation(context, operation, ["operation", "reason"]) &&
    (context.reason === "serializationFailed" ||
      context.reason === "malformedJson" ||
      context.reason === "invalidRequestShape")
  );
}

function isSerializeOutputContext(context: unknown, operation: StandaloneShapeOperation): boolean {
  return hasOperation(context, operation, ["operation", "phase"]) && context.phase === "serialize";
}

function isUnsupportedCommandContext(
  context: unknown,
  operation: StandaloneShapeOperation,
): boolean {
  const hasCommandContext =
    operation === "divideShapeRegions"
      ? hasOperation(context, operation, ["operation", "operand", "command"]) &&
        (context.operand === "lhs" || context.operand === "rhs")
      : hasOperation(context, operation, ["operation", "command"]);
  return hasCommandContext && isPlainObject(context) && isSingleUnicodeScalar(context.command);
}

function isDuplicatePartContext(context: unknown, operation: StandaloneShapeOperation): boolean {
  return (
    hasOperation(context, operation, ["operation", "partIdPrefix", "omittedPartIdByteCount"]) &&
    typeof context.partIdPrefix === "string" &&
    isWellFormedUnicode(context.partIdPrefix) &&
    fitsUtf8ByteLimit(context.partIdPrefix, MAX_PART_ID_PREFIX_BYTES) &&
    isSafeCount(context.omittedPartIdByteCount)
  );
}

function isDepthContext(context: unknown, operation: StandaloneShapeOperation): boolean {
  const hasDepthFields =
    operation === "divideShapeRegions"
      ? hasOperation(context, operation, ["operation", "operand", "actual", "limit"]) &&
        (context.operand === "lhs" || context.operand === "rhs")
      : hasOperation(context, operation, ["operation", "actual", "limit"]);
  return (
    hasDepthFields &&
    isPlainObject(context) &&
    isSafeCount(context.actual) &&
    context.limit === MAX_GEOMETRY_TREE_DEPTH &&
    context.actual > context.limit
  );
}

function operationCanEmitCode(operation: StandaloneShapeOperation, code: string): boolean {
  if (BOUNDARY_CODES.has(code)) {
    return true;
  }
  switch (operation) {
    case "compileShapeSvg":
    case "hitTestShapeParts":
    case "compileShapePaths":
    case "evaluateShapeParts":
      return GEOMETRY_COMPILE_CODES.has(code);
    case "evaluateShapeRegion":
    case "divideShapeRegions":
    case "computeShapeIntersections":
      return GEOMETRY_REGION_CODES.has(code);
    case "resolveSymbolGeometry":
      return code === "SHAPE_GEOMETRY_MAX_DEPTH";
    case "renderShapeRegionSvg":
      return false;
  }
}

type ShapeFatalCandidate = {
  code: string;
  message: string;
  stage: string;
  context: unknown;
  operation: StandaloneShapeOperation;
};

function matchesBoundaryTuple(candidate: ShapeFatalCandidate): boolean | undefined {
  const { code, message, stage, context, operation } = candidate;
  switch (code) {
    case "SHAPE_INPUT_INVALID":
      return (
        message === "Shape operation input is invalid." &&
        stage === "validate" &&
        isInputContext(context, operation)
      );
    case "SHAPE_OUTPUT_INVALID":
      return (
        message === "Shape operation returned invalid output." &&
        stage === "wasm" &&
        isSerializeOutputContext(context, operation)
      );
    case "SHAPE_PANIC":
      return (
        message === "Shape operation failed unexpectedly." &&
        stage === "wasm" &&
        hasOperation(context, operation)
      );
    case "SHAPE_WASM_FAILED":
      return (
        message === "Shape operation WASM transport failed." &&
        stage === "wasm" &&
        hasOperation(context, operation)
      );
    case "SHAPE_WASM_CAPABILITY_MISSING":
      return (
        message === "Required shape WASM capability is unavailable." &&
        stage === "wasm" &&
        hasOperation(context, operation)
      );
    default:
      return undefined;
  }
}

function matchesCatalogTuple(candidate: ShapeFatalCandidate): boolean {
  const { code, message, stage, context, operation } = candidate;
  if (!operationCanEmitCode(operation, code)) {
    return false;
  }
  const boundaryMatch = matchesBoundaryTuple(candidate);
  if (boundaryMatch !== undefined) {
    return boundaryMatch;
  }
  switch (code) {
    case "SHAPE_PATH_COMMAND_UNSUPPORTED":
      return (
        message === "Shape path data uses an unsupported command." &&
        stage === "validate" &&
        isUnsupportedCommandContext(context, operation)
      );
    case "SHAPE_DUPLICATE_PART_ID":
      return (
        message === "Shape contains a duplicate addressable part id." &&
        stage === "validate" &&
        isDuplicatePartContext(context, operation)
      );
    case "SHAPE_GEOMETRY_MAX_DEPTH":
      return (
        message === "Shape geometry exceeds the maximum tree depth." &&
        stage === "validate" &&
        isDepthContext(context, operation)
      );
    case "SHAPE_BOOLEAN_CHILD_COUNT":
      return (
        message === "Shape boolean nodes require at least two children." &&
        stage === "validate" &&
        isGeometryEvaluationContext(context, operation)
      );
    case "SHAPE_PATH_DATA_INVALID":
      return (
        message === "Shape path data is invalid." &&
        stage === "validate" &&
        isGeometryEvaluationContext(context, operation)
      );
    case "SHAPE_BOOLEAN_TOPOLOGY_FAILED":
      return (
        message === "Shape boolean evaluation could not reconstruct a closed boundary." &&
        stage === "ir" &&
        isOperationContext(context, operation, true)
      );
    case "SHAPE_BOOLEAN_PAIR_LIMIT":
      return (
        message === "Shape boolean evaluation exceeded its pair limit." &&
        stage === "ir" &&
        isOperationContext(context, operation, true)
      );
    case "SHAPE_PATH_MULTIPLE_SUBPATHS":
      return (
        message === "Shape path measurement requires exactly one drawable subpath." &&
        stage === "validate" &&
        isOperationContext(context, operation, false)
      );
    case "SHAPE_PATH_ZERO_LENGTH":
      return (
        message === "Shape path measurement requires a non-zero path length." &&
        stage === "validate" &&
        isOperationContext(context, operation, false)
      );
    case "SHAPE_PATH_COMPLEXITY_LIMIT":
      return (
        message === "Shape path measurement exceeded its complexity limit." &&
        stage === "ir" &&
        isOperationContext(context, operation, false)
      );
    case "SHAPE_PATH_OFFSET_GEOMETRY_INVALID":
      return (
        message === "Shape path offset geometry could not be materialized." &&
        stage === "ir" &&
        isOperationContext(context, operation, false)
      );
    case "SHAPE_PATH_OFFSET_SAMPLE_LIMIT":
      return (
        message === "Shape path offset sampling exceeded its complexity limit." &&
        stage === "ir" &&
        isOperationContext(context, operation, false)
      );
    case "SHAPE_REGION_CLIP_INTERVAL_INVALID":
      return (
        message === "Shape region clipping requires a finite increasing interval." &&
        stage === "validate" &&
        isOperationContext(context, operation, false)
      );
    case "SHAPE_REGION_CLIP_NON_MONOTONIC":
      return (
        message === "Shape region clipping requires axis-monotonic contour segments." &&
        stage === "validate" &&
        isOperationContext(context, operation, false)
      );
    default:
      return false;
  }
}

export function decodeWasmShapeFatal(
  error: unknown,
  operation: StandaloneShapeOperation,
): FatalError | undefined {
  if (typeof error !== "string" || !fitsUtf8ByteLimit(error, MAX_SHAPE_ENVELOPE_BYTES)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(error) as unknown;
  } catch {
    return undefined;
  }
  if (
    !hasExactFields(parsed, ["severity", "code", "message", "stage", "context"]) ||
    parsed.severity !== "fatal" ||
    typeof parsed.code !== "string" ||
    typeof parsed.message !== "string" ||
    typeof parsed.stage !== "string" ||
    !isPlainObject(parsed.context) ||
    !contextFitsWireLimit(parsed.context) ||
    !matchesCatalogTuple({
      code: parsed.code,
      message: parsed.message,
      stage: parsed.stage,
      context: parsed.context,
      operation,
    })
  ) {
    return undefined;
  }

  try {
    return FatalError.fromSerialized(parsed);
  } catch {
    return undefined;
  }
}

export function shapeInputBoundaryFailure(
  operation: ShapeOperation,
  reason: ShapeInputFailureReason,
  nodeId?: string,
): FatalError {
  return new FatalError("SHAPE_INPUT_INVALID", "Shape operation input is invalid.", {
    stage: "validate",
    ...(nodeId === undefined ? {} : { nodeId }),
    context: { operation, reason },
  });
}

export function shapeDepthBoundaryFailure(options: {
  operation: ShapeOperation;
  actual: number;
  operand?: ShapeOperand;
  nodeId?: string;
}): FatalError {
  const { operation, actual, operand, nodeId } = options;
  return new FatalError(
    "SHAPE_GEOMETRY_MAX_DEPTH",
    "Shape geometry exceeds the maximum tree depth.",
    {
      stage: "validate",
      ...(nodeId === undefined ? {} : { nodeId }),
      context: {
        operation,
        ...(operand === undefined ? {} : { operand }),
        actual,
        limit: MAX_GEOMETRY_TREE_DEPTH,
      },
    },
  );
}

export function shapeWasmBoundaryFailure(operation: StandaloneShapeOperation): FatalError {
  return new FatalError("SHAPE_WASM_FAILED", "Shape operation WASM transport failed.", {
    stage: "wasm",
    context: { operation },
  });
}

export function shapeCapabilityFailure(operation: StandaloneShapeOperation): FatalError {
  return new FatalError(
    "SHAPE_WASM_CAPABILITY_MISSING",
    "Required shape WASM capability is unavailable.",
    {
      stage: "wasm",
      context: { operation },
    },
  );
}

export function shapeOutputDecodeFailure(
  operation: StandaloneShapeOperation,
  protocolPath: string,
  received: string,
): FatalError {
  return new FatalError("SHAPE_OUTPUT_INVALID", "Shape operation returned invalid output.", {
    stage: "wasm",
    context: {
      operation,
      phase: "decode",
      protocolPath: truncateUtf8(protocolPath, MAX_SHAPE_DESCRIPTOR_BYTES),
      received: truncateUtf8(received, MAX_SHAPE_DESCRIPTOR_BYTES),
    },
  });
}

export const SHAPE_GEOMETRY_DEPTH_LIMIT = MAX_GEOMETRY_TREE_DEPTH;
