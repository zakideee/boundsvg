import type { SerializedRecoverableError } from "../errors.js";
import { FatalError, RecoverableError } from "../errors.js";
import { structuralIRValidationFailure, validateStructuralIR } from "../ir/output-validator.js";
import type { IRSourceRef } from "../ir/source-index.js";
import type { MeasurementTextLayoutOperation } from "../text/layout-operation.js";
import type {
  IntrinsicInlineSizeResult,
  MeasureTextBlockLine,
  MeasureTextBlockResult,
  ShrinkwrapFlowResult,
  ShrinkwrapTextResult,
  TextFlowExclusionLine,
  TextFlowFragment,
  TextFlowFragmentStyle,
  TextFlowLine,
  TextFlowResult,
  TextFlowWithExclusionsResult,
} from "./index.js";
import type { RenderToIrEnvelope, RenderToSvgEnvelope, WasmIrOutput } from "./types.js";

type Guard<Value> = (value: unknown, path?: string) => value is Value;

type FieldRule<Value> = undefined extends Value
  ? { optional: true; guard: Guard<Exclude<Value, undefined>> }
  : { optional: false; guard: Guard<Value> };

type ObjectShape<Value extends object> = {
  [Key in keyof Value]-?: FieldRule<Value[Key]>;
};

type RuntimeFieldRule = {
  optional: boolean;
  guard: (value: unknown, path?: string) => boolean;
};

type DecodeJsonError =
  | { code: string; description: string }
  | { operation: MeasurementTextLayoutOperation };

/** Shared text-leaf check for serialized producer results. */
const isString: Guard<string> = (value): value is string => typeof value === "string";
/** Shared numeric wire-type check; domain restrictions belong to result-specific guards. */
const isNumber: Guard<number> = (value): value is number => typeof value === "number";
/** Accept finite numeric facts from the changed flow output boundary. */
const isFiniteNumber: Guard<number> = (number): number is number =>
  typeof number === "number" && Number.isFinite(number);
/** Accept diagnostic indices and counts representable by the JavaScript boundary. */
const isFlowIndex: Guard<number> = (index): index is number =>
  typeof index === "number" && Number.isSafeInteger(index) && index >= 0;
/** Require boolean wire flags without truthiness coercion. */
const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";
let lastFailurePath: string | undefined;
let lastFailureDescription: string | undefined;
let lastFailureSafeDescription: string | undefined;

function describeRejectedValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? typeof value : serialized.slice(0, 120);
}

function describeRejectedValueSafely(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    return `string(length=${value.length})`;
  }
  if (typeof value === "object") {
    return "object";
  }
  return typeof value;
}

function recordFailure(path: string | undefined, value?: unknown): false {
  lastFailurePath ??= path ?? "$";
  lastFailureDescription ??= describeRejectedValue(value);
  lastFailureSafeDescription ??= describeRejectedValueSafely(value);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required<Value>(guard: Guard<Value>): { optional: false; guard: Guard<Value> } {
  return { optional: false, guard };
}

function optional<Value>(guard: Guard<Value>): { optional: true; guard: Guard<Value> } {
  return { optional: true, guard };
}

function literal<const Value extends string>(...values: Value[]): Guard<Value> {
  const allowedValues = new Set<string>(values);
  return (value: unknown): value is Value => typeof value === "string" && allowedValues.has(value);
}

function arrayOf<Value>(guard: Guard<Value>): Guard<Value[]> {
  return (value: unknown, path = "$array"): value is Value[] => {
    if (!Array.isArray(value)) {
      return recordFailure(path, value);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!guard(value[index], `${path}[${index}]`)) {
        lastFailurePath ??= `${path}[${index}]`;
        lastFailureDescription ??= describeRejectedValue(value[index]);
        lastFailureSafeDescription ??= describeRejectedValueSafely(value[index]);
        return false;
      }
    }
    return true;
  };
}

function objectGuard<Value extends object>(shape: ObjectShape<Value>): Guard<Value> {
  const entries = Object.entries(shape) as Array<[string, RuntimeFieldRule]>;
  return (value: unknown, path = "$object"): value is Value => {
    if (!isRecord(value)) {
      return recordFailure(path, value);
    }
    for (const [key, rule] of entries) {
      const property = value[key];
      if (property === undefined) {
        if (!rule.optional) {
          return recordFailure(`${path}.${key}`, property);
        }
        continue;
      }
      if (!rule.guard(property, `${path}.${key}`)) {
        lastFailurePath ??= `${path}.${key}`;
        lastFailureDescription ??= describeRejectedValue(property);
        lastFailureSafeDescription ??= describeRejectedValueSafely(property);
        return false;
      }
    }
    return true;
  };
}

function withoutRemovedFields<Value extends object>(
  guard: Guard<Value>,
  removedKeys: readonly string[],
): Guard<Value> {
  return (output: unknown, path = "$"): output is Value => {
    if (isRecord(output)) {
      for (const key of removedKeys) {
        // Own presence is invalid even when its value is undefined. Do not
        // invoke a removed field's getter merely to describe its rejection.
        if (Object.hasOwn(output, key)) {
          lastFailurePath ??= `${path}.${key}`;
          lastFailureDescription ??= "removed field";
          lastFailureSafeDescription ??= "removed field";
          return false;
        }
      }
    }
    return guard(output, path);
  };
}

function decodeJson<Value>(json: string, guard: Guard<Value>, error: DecodeJsonError): Value {
  let parsed: unknown;
  lastFailurePath = undefined;
  lastFailureDescription = undefined;
  lastFailureSafeDescription = undefined;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    if ("operation" in error) {
      throw new FatalError(
        "TEXT_LAYOUT_OUTPUT_INVALID",
        "Text layout transport returned an invalid result.",
        {
          stage: "wasm",
          context: {
            operation: error.operation,
            phase: "decode",
            protocolPath: "$",
            received: describeRejectedValueSafely(json),
          },
        },
      );
    }
    throw new FatalError(error.code, `${error.description} returned malformed JSON.`, {
      stage: "wasm",
    });
  }
  if (!guard(parsed, "$")) {
    const failurePath = lastFailurePath ?? "$";
    const failureDescription = lastFailureDescription ?? "unknown";
    if ("operation" in error) {
      const safeFailureDescription =
        lastFailureSafeDescription ?? describeRejectedValueSafely(parsed);
      const topLevelRequiredFieldMissing =
        safeFailureDescription === "undefined" && /^\$\.[^.[]+$/u.test(failurePath);
      throw new FatalError(
        "TEXT_LAYOUT_OUTPUT_INVALID",
        "Text layout transport returned an invalid result.",
        {
          stage: "wasm",
          context: {
            operation: error.operation,
            phase: "decode",
            protocolPath: topLevelRequiredFieldMissing ? "$" : failurePath,
            received: topLevelRequiredFieldMissing
              ? describeRejectedValueSafely(parsed)
              : safeFailureDescription,
          },
        },
      );
    }
    throw new FatalError(
      error.code,
      `${error.description} returned an invalid response shape at ${failurePath} (received ${failureDescription}).`,
      {
        stage: "wasm",
        context: {
          protocolPath: failurePath,
          received: failureDescription,
        },
      },
    );
  }
  return parsed;
}

/** Accept canonical recoverable envelopes before warning rehydration. */
const isSerializedRecoverableError: Guard<SerializedRecoverableError> = (
  value,
  path = "$warning",
): value is SerializedRecoverableError =>
  RecoverableError.isSerialized(value) || recordFailure(path, value);

/** Validate structural IR and retain the structural validator's precise failure location. */
const isWasmIrOutput: Guard<WasmIrOutput> = (value, path = "$ir"): value is WasmIrOutput => {
  if (validateStructuralIR(value)) {
    return true;
  }
  const failure = structuralIRValidationFailure(path);
  lastFailurePath ??= failure.path;
  lastFailureDescription ??= failure.description;
  return false;
};

/** Validate the IR result and its separate canonical warning delivery envelope. */
const isRenderToIrEnvelope = objectGuard<RenderToIrEnvelope>({
  ir: required(isWasmIrOutput),
  warnings: required(arrayOf(isSerializedRecoverableError)),
} satisfies ObjectShape<RenderToIrEnvelope>);

/** Validate SVG output, optional IR, text ownership IDs, and canonical warnings together. */
const isRenderToSvgEnvelope = objectGuard<RenderToSvgEnvelope>({
  svg: required(isString),
  ir: optional(isWasmIrOutput),
  warnings: required(arrayOf(isSerializedRecoverableError)),
  textNodeIds: required(arrayOf(isString)),
} satisfies ObjectShape<RenderToSvgEnvelope>);

type DecodedAnimationStateSample = {
  nodeIndex: number;
  source: IRSourceRef;
  nodeId: string;
  opacity?: number;
  transform?: { a: number; b: number; c: number; d: number; e: number; f: number };
};

/** Validate the six coefficients carried by sampled animation transforms. */
const isAnimationAffineMatrix = objectGuard<NonNullable<DecodedAnimationStateSample["transform"]>>({
  a: required(isNumber),
  b: required(isNumber),
  c: required(isNumber),
  d: required(isNumber),
  e: required(isNumber),
  f: required(isNumber),
} satisfies ObjectShape<NonNullable<DecodedAnimationStateSample["transform"]>>);

/** Snapshot ordinals must be exact finite nonnegative integers. */
const isSnapshotOrdinal: Guard<number> = (value): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Source association for a sampled physical animation target. */
const isSourceRef = objectGuard<IRSourceRef>({
  sourceIndex: required(isSnapshotOrdinal),
  nodeId: required(isString),
} satisfies ObjectShape<IRSourceRef>);

/** Validate sampled animation facts together with their source occurrence reference. */
const isAnimationStateSample = objectGuard<DecodedAnimationStateSample>({
  nodeIndex: required(isSnapshotOrdinal),
  source: required(isSourceRef),
  nodeId: required(isString),
  opacity: optional(isNumber),
  transform: optional(isAnimationAffineMatrix),
} satisfies ObjectShape<DecodedAnimationStateSample>);

/** Validate plain per-line flow facts in their existing grapheme index space. */
const isTextFlowLine = objectGuard<TextFlowLine>({
  text: required(isString),
  charStart: required(isNumber),
  charEnd: required(isNumber),
  inlineAdvancePx: required(isNumber),
  availableInlineSizePx: required(isNumber),
} satisfies ObjectShape<TextFlowLine>);

/** Validate plain flow lines, exhaustion, and optional recoverable diagnostics. */
const isTextFlowResult = objectGuard<TextFlowResult>({
  lines: required(arrayOf(isTextFlowLine)),
  exhausted: required(isBoolean),
  warnings: optional(arrayOf(isSerializedRecoverableError)),
} satisfies ObjectShape<TextFlowResult>);

/** Validate plain-span diagnostic styles without defining settled glyph paint. */
const isTextFlowFragmentStyle = objectGuard<TextFlowFragmentStyle>({
  fontFamily: required(isString),
  fontWeight: required(isFiniteNumber),
  fontStyle: required(isString),
  fontSizePx: required(isFiniteNumber),
  letterSpacingPx: optional(isFiniteNumber),
  color: optional(isString),
} satisfies ObjectShape<TextFlowFragmentStyle>);

/** Validate reserved-cell facts and reject retired Ruby rendering metadata. */
const isTextFlowFragment = withoutRemovedFields(
  objectGuard<TextFlowFragment>({
    text: required(isString),
    charStart: required(isFlowIndex),
    charEnd: required(isFlowIndex),
    x: required(isFiniteNumber),
    y: required(isFiniteNumber),
    inlineAdvancePx: required(isFiniteNumber),
    availableInlineSizePx: required(isFiniteNumber),
    regionIndex: required(isFlowIndex),
    baselineOffset: required(isFiniteNumber),
    overflowReason: optional(literal("kinsokuAbsorb", "hangingPunctuation", "ellipsis")),
    style: optional(isTextFlowFragmentStyle),
  } satisfies ObjectShape<TextFlowFragment>),
  ["ruby"],
);

/** Validate one measured line or column and its region fragments. */
const isTextFlowExclusionLine = objectGuard<TextFlowExclusionLine>({
  fragments: required(arrayOf(isTextFlowFragment)),
  lineIndex: required(isFlowIndex),
  crossSize: required(isFiniteNumber),
} satisfies ObjectShape<TextFlowExclusionLine>);

/** Validate measurement-only flow results shared by WASM, Core, and Worker producers. */
const isTextFlowWithExclusionsResult = withoutRemovedFields(
  objectGuard<TextFlowWithExclusionsResult>({
    lines: required(arrayOf(isTextFlowExclusionLine)),
    exhausted: required(isBoolean),
    usedLineCount: required(isFlowIndex),
    overflowReason: optional(literal("maxLinesTruncated", "flowBoxExhausted", "cannotFit")),
    chosenFontSizePx: optional(isFiniteNumber),
    warnings: optional(arrayOf(isSerializedRecoverableError)),
  } satisfies ObjectShape<TextFlowWithExclusionsResult>),
  ["topRubyOverflowPx", "bottomRubyOverflowPx"],
);

/** Validate optional per-line diagnostics within block measurements. */
const isMeasureTextBlockLine = objectGuard<MeasureTextBlockLine>({
  charStart: required(isNumber),
  charEnd: required(isNumber),
  text: required(isString),
  inlineAdvancePx: required(isNumber),
  kinsokuUnresolved: required(isBoolean),
} satisfies ObjectShape<MeasureTextBlockLine>);

/** Validate block dimensions and optional line diagnostics. */
const isMeasureTextBlockResult = objectGuard<MeasureTextBlockResult>({
  lineCount: required(isNumber),
  usedWidth: required(isNumber),
  usedHeight: required(isNumber),
  lines: optional(arrayOf(isMeasureTextBlockLine)),
} satisfies ObjectShape<MeasureTextBlockResult>);

/** Require exactly one axis-dependent set of text shrinkwrap dimensions. */
const isShrinkwrapTextResult: Guard<ShrinkwrapTextResult> = (
  value,
): value is ShrinkwrapTextResult => {
  if (
    !isRecord(value) ||
    !literal("satisfied", "infeasible")(value.status) ||
    !isNumber(value.lineCount) ||
    !isNumber(value.usedHeight)
  ) {
    return false;
  }
  const horizontal =
    isNumber(value.chosenWidthPx) &&
    isNumber(value.maxLineWidth) &&
    value.chosenHeightPx === undefined &&
    value.usedWidth === undefined;
  const vertical =
    isNumber(value.chosenHeightPx) &&
    isNumber(value.usedWidth) &&
    value.chosenWidthPx === undefined &&
    value.maxLineWidth === undefined;
  return horizontal || vertical;
};

/** Apply the flow contract to the layout nested inside a selected shrinkwrap frame. */
const isShrinkwrapFlowResult = objectGuard<ShrinkwrapFlowResult>({
  status: required(literal("satisfied", "infeasible")),
  chosenWidthPx: optional(isFiniteNumber),
  chosenHeightPx: optional(isFiniteNumber),
  usedLineCount: required(isFlowIndex),
  usedHeight: required(isFiniteNumber),
  layout: required(isTextFlowWithExclusionsResult),
} satisfies ObjectShape<ShrinkwrapFlowResult>);

/** Validate intrinsic inline dimensions and their optional recoverable diagnostics. */
const isIntrinsicInlineSizeResult = objectGuard<IntrinsicInlineSizeResult>({
  minContentInlineSize: required(isNumber),
  maxContentInlineSize: required(isNumber),
  warnings: optional(arrayOf(isSerializedRecoverableError)),
} satisfies ObjectShape<IntrinsicInlineSizeResult>);

function testDecodedValue<Value>(value: unknown, guard: Guard<Value>): value is Value {
  lastFailurePath = undefined;
  lastFailureDescription = undefined;
  lastFailureSafeDescription = undefined;
  try {
    return guard(value, "$");
  } catch {
    return false;
  }
}

/** Validate a flow producer result with the same contract used by WASM and Worker responses.
 * @throws {FatalError} TEXT_LAYOUT_OUTPUT_INVALID for removed fields or invalid measured facts.
 */
export function assertTextFlowMeasurementOutput(
  output: unknown,
  operation: "layoutTextFlowWithExclusions" | "shrinkwrapFlow",
  stage: "wasm" | "engine",
): void {
  const guard: Guard<ShrinkwrapFlowResult | TextFlowWithExclusionsResult> =
    operation === "shrinkwrapFlow" ? isShrinkwrapFlowResult : isTextFlowWithExclusionsResult;
  if (testDecodedValue(output, guard)) {
    return;
  }
  throw new FatalError(
    "TEXT_LAYOUT_OUTPUT_INVALID",
    "Text layout transport returned an invalid result.",
    {
      stage,
      context: {
        operation,
        phase: "decode",
        protocolPath: lastFailurePath ?? "$",
        received: lastFailureSafeDescription ?? typeof output,
      },
    },
  );
}

/** Strict value predicates shared by the WASM and Worker trust boundaries. */
export function isWasmTextFlowResult(value: unknown): value is TextFlowResult {
  return testDecodedValue(value, isTextFlowResult);
}

/** Check measured exclusion-flow facts, including absence of removed rendering fields. */
export function isWasmTextFlowWithExclusionsResult(
  value: unknown,
): value is TextFlowWithExclusionsResult {
  return testDecodedValue(value, isTextFlowWithExclusionsResult);
}

/** Check the existing block-measurement output contract. */
export function isWasmMeasureTextBlockResult(value: unknown): value is MeasureTextBlockResult {
  return testDecodedValue(value, isMeasureTextBlockResult);
}

/** Check the existing axis-dependent text shrinkwrap output contract. */
export function isWasmShrinkwrapTextResult(value: unknown): value is ShrinkwrapTextResult {
  return testDecodedValue(value, isShrinkwrapTextResult);
}

/** Check shrinkwrap facts and their nested measurement-only flow layout. */
export function isWasmShrinkwrapFlowResult(value: unknown): value is ShrinkwrapFlowResult {
  return testDecodedValue(value, isShrinkwrapFlowResult);
}

/** Check the existing intrinsic-size output contract. */
export function isWasmIntrinsicInlineSizeResult(
  value: unknown,
): value is IntrinsicInlineSizeResult {
  return testDecodedValue(value, isIntrinsicInlineSizeResult);
}

/** Decode warning-free structural IR and its canonical warning envelope.
 * @throws {FatalError} WASM_INVALID_IR_OUTPUT for invalid JSON, ownership or output fields.
 */
export function decodeRenderToIrEnvelope(json: string): RenderToIrEnvelope {
  return decodeJson(json, isRenderToIrEnvelope, {
    code: "WASM_INVALID_IR_OUTPUT",
    description: "render_to_ir",
  });
}

/** Decode matching emitted SVG, optional IR and recoverable diagnostics.
 * @throws {FatalError} WASM_INVALID_SVG_OUTPUT for invalid JSON or output fields.
 */
export function decodeRenderToSvgEnvelope(json: string): RenderToSvgEnvelope {
  return decodeJson(json, isRenderToSvgEnvelope, {
    code: "WASM_INVALID_SVG_OUTPUT",
    description: "render_to_svg",
  });
}

/** Decode sampled physical occurrences with their snapshot-local source references.
 * @throws {FatalError} WASM_INVALID_ANIMATION_STATE_OUTPUT for invalid JSON or sample fields.
 */
export function decodeAnimationStateSamples(json: string): DecodedAnimationStateSample[] {
  return decodeJson(json, arrayOf(isAnimationStateSample), {
    code: "WASM_INVALID_ANIMATION_STATE_OUTPUT",
    description: "sample_animation_state",
  });
}

/** Decode plain per-line flow facts and recoverable diagnostics.
 * @throws {FatalError} TEXT_LAYOUT_OUTPUT_INVALID for malformed or invalid producer output.
 */
export function decodeTextFlowResult(json: string): TextFlowResult {
  return decodeJson(json, isTextFlowResult, { operation: "layoutTextFlow" });
}

/** Decode measurement-only flow cells and reject removed paint metadata.
 * @throws {FatalError} TEXT_LAYOUT_OUTPUT_INVALID when JSON or measured facts violate the contract.
 */
export function decodeTextFlowWithExclusionsResult(json: string): TextFlowWithExclusionsResult {
  return decodeJson(json, isTextFlowWithExclusionsResult, {
    operation: "layoutTextFlowWithExclusions",
  });
}

/** Decode block dimensions and optional line diagnostics.
 * @throws {FatalError} TEXT_LAYOUT_OUTPUT_INVALID for malformed or invalid producer output.
 */
export function decodeMeasureTextBlockResult(json: string): MeasureTextBlockResult {
  return decodeJson(json, isMeasureTextBlockResult, { operation: "measureTextBlock" });
}

/** Decode the chosen inline size and measured block dimensions.
 * @throws {FatalError} TEXT_LAYOUT_OUTPUT_INVALID for malformed or invalid producer output.
 */
export function decodeShrinkwrapTextResult(json: string): ShrinkwrapTextResult {
  return decodeJson(json, isShrinkwrapTextResult, { operation: "shrinkwrapText" });
}

/** Decode a fitted frame and validate its nested measurement-only flow layout.
 * @throws {FatalError} TEXT_LAYOUT_OUTPUT_INVALID when JSON or measured facts violate the contract.
 */
export function decodeShrinkwrapFlowResult(json: string): ShrinkwrapFlowResult {
  return decodeJson(json, isShrinkwrapFlowResult, { operation: "shrinkwrapFlow" });
}

/** Decode intrinsic inline dimensions and recoverable diagnostics.
 * @throws {FatalError} TEXT_LAYOUT_OUTPUT_INVALID for malformed or invalid producer output.
 */
export function decodeIntrinsicInlineSizeResult(json: string): IntrinsicInlineSizeResult {
  return decodeJson(json, isIntrinsicInlineSizeResult, {
    operation: "measureIntrinsicInlineSize",
  });
}
