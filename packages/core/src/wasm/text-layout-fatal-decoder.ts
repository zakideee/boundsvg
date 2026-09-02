import { FatalError } from "../errors.js";
import type { MeasurementTextLayoutOperation } from "../text/layout-operation.js";

const MAX_TEXT_LAYOUT_CONTEXT_BYTES = 4_096;
const MAX_TEXT_LAYOUT_ENVELOPE_BYTES = 8_192;
const MAX_REQUESTED_ALIASES = 16;
const MAX_ALIAS_BYTES = 256;

type JsonObject = Record<string, unknown>;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function fitsUtf8ByteLimit(value: string, maximumBytes: number): boolean {
  if (value.length > maximumBytes) {
    return false;
  }
  return utf8ByteLength(value) <= maximumBytes;
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
    return fitsUtf8ByteLimit(serialized, MAX_TEXT_LAYOUT_CONTEXT_BYTES);
  } catch {
    return false;
  }
}

function hasOperation(
  context: unknown,
  operation: MeasurementTextLayoutOperation,
  fields: readonly string[] = ["operation"],
): context is JsonObject {
  return hasExactFields(context, fields) && context.operation === operation;
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeCount(value: unknown): value is number {
  return isSafeCount(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isExceededLimit(required: unknown, limit: unknown): boolean {
  return isSafeCount(required) && isSafeCount(limit) && required > limit;
}

const REQUEST_REASONS_WITHOUT_FIELD = new Set([
  "malformedJson",
  "missingLineWidths",
  "conflictingTextSources",
  "invalidRequestShape",
]);
const TEXT_CONSTRAINT_FIELDS = new Set(["maxWidth", "lineWidths", "flowBounds"]);
const PREPARATION_PHASES = new Set([
  "fontResolution",
  "plainShaping",
  "spanShaping",
  "richPreparation",
  "verticalLayout",
  "flowPreparation",
  "resultProjection",
]);
const REGION_QUERY_FIELDS = new Set([
  "flowX",
  "flowY",
  "flowWidth",
  "flowHeight",
  "crossStart",
  "crossEnd",
  "minimumInlineSize",
]);
const NEGATIVE_FLOW_EXTENT_FIELDS = new Set(["flowWidth", "flowHeight"]);
const REGION_PROVIDER_REASONS = new Set([
  "unavailable",
  "unsupportedQuery",
  "resourceExhausted",
  "internalFailure",
]);
const FLOW_REGION_FIELDS = new Set(["inlineStart", "inlineSize", "inlineEnd"]);
const TEXT_LAYOUT_INVARIANTS = new Set([
  "lineRangeMissing",
  "lineRangeReversed",
  "lineRangeOutOfBounds",
  "lineRangeNotUtf8Boundary",
  "flowMadeNoProgress",
]);

function isInputContext(context: unknown, operation: MeasurementTextLayoutOperation): boolean {
  if (!isPlainObject(context) || context.operation !== operation) {
    return false;
  }
  if (context.reason === "missingInlineConstraint") {
    return (
      hasExactFields(context, ["operation", "reason", "field"]) &&
      typeof context.field === "string" &&
      TEXT_CONSTRAINT_FIELDS.has(context.field)
    );
  }
  return (
    hasExactFields(context, ["operation", "reason"]) &&
    typeof context.reason === "string" &&
    REQUEST_REASONS_WITHOUT_FIELD.has(context.reason)
  );
}

function isFontContext(context: unknown, operation: MeasurementTextLayoutOperation): boolean {
  if (
    !hasOperation(context, operation, [
      "operation",
      "runIndex",
      "requestedAliases",
      "omittedAliasCount",
      "fontWeight",
      "fontStyle",
    ]) ||
    !isSafeCount(context.runIndex) ||
    !Array.isArray(context.requestedAliases) ||
    context.requestedAliases.length > MAX_REQUESTED_ALIASES ||
    !context.requestedAliases.every(
      (alias) => typeof alias === "string" && fitsUtf8ByteLimit(alias, MAX_ALIAS_BYTES),
    ) ||
    !isSafeCount(context.omittedAliasCount) ||
    !isSafeCount(context.fontWeight) ||
    context.fontWeight > 65_535
  ) {
    return false;
  }
  return context.fontStyle === "normal" || context.fontStyle === "italic";
}

function isPreparationContext(
  context: unknown,
  operation: MeasurementTextLayoutOperation,
): boolean {
  return (
    hasOperation(context, operation, ["operation", "phase"]) &&
    typeof context.phase === "string" &&
    PREPARATION_PHASES.has(context.phase)
  );
}

function isRequiredLimitContext(
  context: unknown,
  operation: MeasurementTextLayoutOperation,
): boolean {
  return (
    hasOperation(context, operation, ["operation", "required", "limit"]) &&
    isExceededLimit(context.required, context.limit)
  );
}

function isRichDepthContext(context: unknown, operation: MeasurementTextLayoutOperation): boolean {
  return (
    hasOperation(context, operation, ["operation", "actual", "limit"]) &&
    isSafeCount(context.actual) &&
    context.limit === 48 &&
    context.actual > context.limit
  );
}

function isRegionQueryContext(
  context: unknown,
  operation: MeasurementTextLayoutOperation,
): boolean {
  if (!isPlainObject(context) || context.operation !== operation) {
    return false;
  }
  if (context.reason === "nonFiniteBounds") {
    return (
      hasExactFields(context, ["operation", "reason", "field"]) &&
      typeof context.field === "string" &&
      REGION_QUERY_FIELDS.has(context.field)
    );
  }
  if (context.reason === "negativeFlowExtent") {
    return (
      hasExactFields(context, ["operation", "reason", "field"]) &&
      typeof context.field === "string" &&
      NEGATIVE_FLOW_EXTENT_FIELDS.has(context.field)
    );
  }
  return (
    hasExactFields(context, ["operation", "reason"]) &&
    (context.reason === "reversedCrossRange" || context.reason === "negativeMinimumInlineSize")
  );
}

function isProviderContext(context: unknown, operation: MeasurementTextLayoutOperation): boolean {
  return (
    hasOperation(context, operation, ["operation", "reason"]) &&
    typeof context.reason === "string" &&
    REGION_PROVIDER_REASONS.has(context.reason)
  );
}

function isFlowRegionContext(context: unknown, operation: MeasurementTextLayoutOperation): boolean {
  if (!isPlainObject(context) || context.operation !== operation || !isSafeCount(context.index)) {
    return false;
  }
  switch (context.reason) {
    case "nonFiniteInterval":
      return (
        hasExactFields(context, ["operation", "index", "reason", "field"]) &&
        typeof context.field === "string" &&
        FLOW_REGION_FIELDS.has(context.field)
      );
    case "intervalBelowMinimum":
      return (
        hasExactFields(context, ["operation", "index", "reason", "actual", "minimum"]) &&
        isFiniteNumber(context.actual) &&
        isFiniteNumber(context.minimum) &&
        context.actual < context.minimum
      );
    case "intervalOutsideFrame":
      return (
        hasExactFields(context, [
          "operation",
          "index",
          "reason",
          "start",
          "end",
          "frameStart",
          "frameEnd",
        ]) &&
        isFiniteNumber(context.start) &&
        isFiniteNumber(context.end) &&
        isFiniteNumber(context.frameStart) &&
        isFiniteNumber(context.frameEnd)
      );
    case "overlappingIntervals":
      return (
        hasExactFields(context, ["operation", "index", "reason", "previousEnd", "currentStart"]) &&
        isFiniteNumber(context.previousEnd) &&
        isFiniteNumber(context.currentStart) &&
        context.previousEnd > context.currentStart
      );
    default:
      return false;
  }
}

function isSingleLimitContext(
  context: unknown,
  operation: MeasurementTextLayoutOperation,
): boolean {
  return (
    hasOperation(context, operation, ["operation", "limit"]) && isPositiveSafeCount(context.limit)
  );
}

function isInvariantContext(context: unknown, operation: MeasurementTextLayoutOperation): boolean {
  return (
    hasOperation(context, operation, ["operation", "invariant"]) &&
    typeof context.invariant === "string" &&
    TEXT_LAYOUT_INVARIANTS.has(context.invariant)
  );
}

type TextLayoutFatalCandidate = {
  code: string;
  message: string;
  stage: string;
  context: unknown;
  operation: MeasurementTextLayoutOperation;
};

function matchesCatalogTuple(candidate: TextLayoutFatalCandidate): boolean {
  const { code, message, stage, context, operation } = candidate;
  switch (code) {
    case "TEXT_LAYOUT_INPUT_INVALID":
      return (
        message === "Text layout request is invalid." &&
        stage === "validate" &&
        isInputContext(context, operation)
      );
    case "TEXT_FONT_UNAVAILABLE":
      return (
        message === "No requested font is available for text layout." &&
        stage === "text" &&
        isFontContext(context, operation)
      );
    case "TEXT_LAYOUT_PREPARATION_FAILED":
      return (
        message === "Text layout preparation failed." &&
        stage === "text" &&
        isPreparationContext(context, operation)
      );
    case "TEXT_FIT_INVALID_STEP":
      return (
        message === "Text fit step is invalid." &&
        stage === "text" &&
        hasOperation(context, operation)
      );
    case "TEXT_FIT_PROBE_LIMIT":
      return (
        message === "Text fit probe limit was exceeded." &&
        stage === "text" &&
        isRequiredLimitContext(context, operation)
      );
    case "TEXT_ELLIPSIS_CANDIDATE_LIMIT":
      return (
        message === "Text ellipsis candidate limit was exceeded." &&
        stage === "text" &&
        isRequiredLimitContext(context, operation)
      );
    case "RICH_TEXT_MAX_DEPTH":
      return (
        message === "Rich text depth limit was exceeded." &&
        stage === "validate" &&
        isRichDepthContext(context, operation)
      );
    case "INLINE_RECT_COMPLEXITY_LIMIT":
      return (
        message === "Inline rectangle limit was exceeded." &&
        stage === "text" &&
        isRequiredLimitContext(context, operation)
      );
    case "TEXT_REGION_QUERY_INVALID":
      return (
        message === "Text region query is invalid." &&
        stage === "text" &&
        isRegionQueryContext(context, operation)
      );
    case "TEXT_REGION_PROVIDER_FAILED":
      return (
        message === "Text region provider failed." &&
        stage === "text" &&
        isProviderContext(context, operation)
      );
    case "TEXT_FLOW_REGION_INVALID":
      return (
        message === "Text flow region is invalid." &&
        stage === "text" &&
        isFlowRegionContext(context, operation)
      );
    case "TEXT_REGION_QUERY_LIMIT":
      return (
        message === "Text region query limit was exceeded." &&
        stage === "text" &&
        isSingleLimitContext(context, operation)
      );
    case "TEXT_REGION_INTERVAL_LIMIT":
      return (
        message === "Text region interval limit was exceeded." &&
        stage === "text" &&
        isRequiredLimitContext(context, operation)
      );
    case "TEXT_LAYOUT_INVARIANT":
      return (
        message === "Text layout invariant failed." &&
        stage === "text" &&
        isInvariantContext(context, operation)
      );
    case "TEXT_LAYOUT_OUTPUT_INVALID":
      return (
        message === "Text layout transport returned an invalid result." &&
        stage === "wasm" &&
        hasOperation(context, operation, ["operation", "phase"]) &&
        context.phase === "serialize"
      );
    case "TEXT_LAYOUT_PANIC":
      return (
        message === "Text layout failed unexpectedly." &&
        stage === "wasm" &&
        hasOperation(context, operation)
      );
    case "TEXT_LAYOUT_WASM_FAILED":
      return (
        message === "Text layout WASM transport failed." &&
        stage === "wasm" &&
        hasOperation(context, operation)
      );
    default:
      return false;
  }
}

/**
 * Rehydrate only the closed fatal catalog emitted by the six text-layout WASM
 * routes. Oversized and malformed values are rejected before generic
 * diagnostic cloning so the caller can replace them with the fixed boundary
 * failure.
 */
export function decodeWasmTextLayoutFatal(
  error: unknown,
  operation: MeasurementTextLayoutOperation,
): FatalError | undefined {
  if (typeof error !== "string" || !fitsUtf8ByteLimit(error, MAX_TEXT_LAYOUT_ENVELOPE_BYTES)) {
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

export function textLayoutWasmBoundaryFailure(
  operation: MeasurementTextLayoutOperation,
): FatalError {
  return new FatalError("TEXT_LAYOUT_WASM_FAILED", "Text layout WASM transport failed.", {
    stage: "wasm",
    context: { operation },
  });
}
