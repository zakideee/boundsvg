import { FatalError } from "../errors.js";

/** Maximum serialized font diagnostic accepted from the WASM transport. */
const MAX_FONT_ENVELOPE_BYTES = 8_192;
/** Parse failures that the font backend can report without exposing input bytes. */
const PARSE_REASONS = new Set([
  "invalidData",
  "missingTable",
  "invalidTable",
  "noOutlines",
  "invalidUnitsPerEm",
  "invalidGlyphCount",
  "nonFiniteMetric",
  "invalidVariationAxis",
  "allocationFailed",
]);
/** Outline failures include native positioned-glyph argument validation. */
const OUTLINE_REASONS = new Set([
  "invalidGlyphId",
  "nonFiniteMetric",
  "allocationFailed",
  "drawingFailed",
  "invalidBaselineRotation",
  "invalidInlineScale",
]);
/** Failures reported before or by the shaping operation itself. */
const SHAPING_REASONS = new Set([
  "nonFiniteVariation",
  "allocationFailed",
  "bufferPreparationFailed",
  "inputTooLong",
  "alreadyShaped",
  "directionUnset",
  "planMismatch",
  "shapingFailed",
]);
/** Rejected invariants of the complete shaped output. */
const OUTPUT_REASONS = new Set(["invalidGlyphId", "invalidCluster", "parallelArrayLengthMismatch"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFields(context: Record<string, unknown>, fields: readonly string[]): boolean {
  return (
    Object.keys(context).length === fields.length &&
    fields.every((field) => Object.hasOwn(context, field))
  );
}

function isUnsigned(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

/** Validate outline fields, including the two positioned-glyph argument failures. */
function matchesOutlineFailure(candidate: {
  message: string;
  stage: string;
  context: Record<string, unknown>;
}): boolean {
  const { message, stage, context } = candidate;
  const argumentFailure =
    context.reason === "invalidBaselineRotation" || context.reason === "invalidInlineScale";
  const expectedMessage =
    context.reason === "invalidBaselineRotation"
      ? "Baseline glyph rotation must be finite."
      : context.reason === "invalidInlineScale"
        ? "Glyph inline scale must be positive and finite."
        : "Font outline extraction failed.";
  return (
    message === expectedMessage &&
    stage === "font" &&
    typeof context.reason === "string" &&
    OUTLINE_REASONS.has(context.reason) &&
    hasFields(
      context,
      argumentFailure ? ["operation", "reason"] : ["operation", "reason", "glyphId"],
    ) &&
    (argumentFailure || isUnsigned(context.glyphId, 0xffff_ffff))
  );
}

/** Diagnostic fields and expected operation supplied by either font error transport. */
type FontFatalCandidate = {
  code: string;
  message: string;
  stage: string;
  context: unknown;
  operation: string;
};

/** Match the closed font diagnostic catalog, including its operation and typed context. */
export function matchesFontFailure(candidate: FontFatalCandidate): boolean {
  const { code, message, stage, context, operation } = candidate;
  if (!isRecord(context) || context.operation !== operation || typeof context.reason !== "string") {
    return false;
  }
  switch (code) {
    case "FONT_PARSE_FAILED": {
      const fields = ["operation", "reason", "faceIndex"];
      if (Object.hasOwn(context, "table")) {
        fields.push("table");
        if (typeof context.table !== "string" || !/^[\x20-\x7e]{4}$/.test(context.table)) {
          return false;
        }
      }
      return (
        message === "Font parsing or admission failed." &&
        stage === "font" &&
        hasFields(context, fields) &&
        PARSE_REASONS.has(context.reason) &&
        isUnsigned(context.faceIndex, 0xffff_ffff)
      );
    }
    case "FONT_OUTLINE_FAILED":
      return matchesOutlineFailure({ message, stage, context });
    case "TEXT_SHAPING_FAILED":
      return (
        message === "Text shaping failed." &&
        stage === "text" &&
        hasFields(context, ["operation", "reason"]) &&
        SHAPING_REASONS.has(context.reason)
      );
    case "TEXT_SHAPING_LIMIT_EXCEEDED":
      return (
        message === "The shaping buffer failed during processing." &&
        stage === "text" &&
        hasFields(context, ["operation", "reason"]) &&
        context.reason === "bufferFailedDuringShaping"
      );
    case "TEXT_SHAPING_INVALID_OUTPUT":
      return (
        message === "The shaper returned invalid glyph data." &&
        stage === "text" &&
        hasFields(context, ["operation", "reason", "glyphIndex"]) &&
        OUTPUT_REASONS.has(context.reason) &&
        isUnsigned(context.glyphIndex)
      );
    case "FONT_DUPLICATE":
      return (
        message === "The font is already registered." &&
        stage === "font" &&
        hasFields(context, ["operation", "reason"]) &&
        context.reason === "duplicateRegistration"
      );
    case "TEXT_FONT_UNAVAILABLE":
      return (
        message === "No requested font is available." &&
        stage === "font" &&
        hasFields(context, ["operation", "reason", "weight"]) &&
        context.reason === "unregisteredFont" &&
        isUnsigned(context.weight, 65535)
      );
    default:
      return false;
  }
}

/** Decode only bounded, typed font failures emitted by the requested WASM operation. */
export function decodeWasmFontFatal(error: unknown, operation: string): FatalError | undefined {
  if (
    typeof error !== "string" ||
    error.length > MAX_FONT_ENVELOPE_BYTES ||
    new TextEncoder().encode(error).length > MAX_FONT_ENVELOPE_BYTES
  ) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(error);
    if (
      !isRecord(parsed) ||
      !hasFields(parsed, ["severity", "code", "message", "stage", "context"]) ||
      parsed.severity !== "fatal" ||
      typeof parsed.code !== "string" ||
      typeof parsed.message !== "string" ||
      typeof parsed.stage !== "string" ||
      !matchesFontFailure({
        code: parsed.code,
        message: parsed.message,
        stage: parsed.stage,
        context: parsed.context,
        operation,
      })
    ) {
      return undefined;
    }
    return FatalError.fromSerialized(parsed);
  } catch {
    return undefined;
  }
}

/** Preserve a typed font failure, or report an unrecognized WASM transport failure. */
export function invokeWasmFont<Output>(operation: string, invoke: () => Output): Output {
  try {
    return invoke();
  } catch (error) {
    throw (
      decodeWasmFontFatal(error, operation) ??
      new FatalError("WASM_FONT_FAILED", "Font WASM transport failed.", {
        stage: "wasm",
        context: { operation },
      })
    );
  }
}
