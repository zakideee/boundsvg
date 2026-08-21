import type { StructuredError } from "../errors.js";
import { FatalError } from "../errors.js";
import { serializedIRValidationFailure, validateSerializedIR } from "../ir/output-validator.js";
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
  TextFlowRubyAnnotation,
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

const isString: Guard<string> = (value): value is string => typeof value === "string";
const isNumber: Guard<number> = (value): value is number => typeof value === "number";
const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";
let lastFailurePath: string | undefined;
let lastFailureDescription: string | undefined;

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

function recordFailure(path: string | undefined, value?: unknown): false {
  lastFailurePath ??= path ?? "$";
  lastFailureDescription ??= describeRejectedValue(value);
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
        return false;
      }
    }
    return true;
  };
}

function recordOf<Value>(guard: Guard<Value>): Guard<Record<string, Value>> {
  return (value: unknown, path = "$record"): value is Record<string, Value> => {
    if (!isRecord(value)) {
      return recordFailure(path, value);
    }
    for (const [key, property] of Object.entries(value)) {
      if (!guard(property, `${path}.${key}`)) {
        lastFailurePath ??= `${path}.${key}`;
        lastFailureDescription ??= describeRejectedValue(property);
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
        return false;
      }
    }
    return true;
  };
}

function decodeJson<Value>(
  json: string,
  guard: Guard<Value>,
  error: { code: string; description: string },
): Value {
  let parsed: unknown;
  lastFailurePath = undefined;
  lastFailureDescription = undefined;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new FatalError(error.code, `${error.description} returned malformed JSON.`, {
      stage: "wasm",
    });
  }
  if (!guard(parsed, "$")) {
    const failurePath = lastFailurePath ?? "$";
    const failureDescription = lastFailureDescription ?? "unknown";
    throw new FatalError(
      error.code,
      `${error.description} returned an invalid response shape at ${failurePath} (received ${failureDescription}).`,
      {
        stage: "wasm",
        protocolPath: failurePath,
        received: failureDescription,
      },
    );
  }
  return parsed;
}

const pipelineStage = literal(
  "validate",
  "layout",
  "text",
  "ir",
  "emit",
  "wasm",
  "font",
  "engine",
  "analyzer",
);

const isStructuredError = objectGuard<StructuredError>({
  severity: required(literal("fatal", "recoverable")),
  code: required(isString),
  message: required(isString),
  stage: optional(pipelineStage),
  nodeId: optional(isString),
  fallback: optional(isString),
  context: optional(recordOf((_value): _value is unknown => true)),
} satisfies ObjectShape<StructuredError>);

const isWasmIrOutput: Guard<WasmIrOutput> = (value, path = "$ir"): value is WasmIrOutput => {
  if (validateSerializedIR(value)) {
    return true;
  }
  const failure = serializedIRValidationFailure(path);
  lastFailurePath ??= failure.path;
  lastFailureDescription ??= failure.description;
  return false;
};

const isRenderToIrEnvelope = objectGuard<RenderToIrEnvelope>({
  ir: required(isWasmIrOutput),
  warnings: required(arrayOf(isStructuredError)),
} satisfies ObjectShape<RenderToIrEnvelope>);

const isRenderToSvgEnvelope = objectGuard<RenderToSvgEnvelope>({
  svg: required(isString),
  ir: optional(isWasmIrOutput),
  warnings: required(arrayOf(isStructuredError)),
  textNodeIds: required(arrayOf(isString)),
} satisfies ObjectShape<RenderToSvgEnvelope>);

type DecodedAnimationStateSample = {
  nodeId: string;
  opacity?: number;
  transform?: { a: number; b: number; c: number; d: number; e: number; f: number };
};

const isAnimationAffineMatrix = objectGuard<NonNullable<DecodedAnimationStateSample["transform"]>>({
  a: required(isNumber),
  b: required(isNumber),
  c: required(isNumber),
  d: required(isNumber),
  e: required(isNumber),
  f: required(isNumber),
} satisfies ObjectShape<NonNullable<DecodedAnimationStateSample["transform"]>>);

const isAnimationStateSample = objectGuard<DecodedAnimationStateSample>({
  nodeId: required(isString),
  opacity: optional(isNumber),
  transform: optional(isAnimationAffineMatrix),
} satisfies ObjectShape<DecodedAnimationStateSample>);

const isTextFlowLine = objectGuard<TextFlowLine>({
  text: required(isString),
  charStart: required(isNumber),
  charEnd: required(isNumber),
  inlineAdvancePx: required(isNumber),
  availableInlineSizePx: required(isNumber),
} satisfies ObjectShape<TextFlowLine>);

const isTextFlowResult = objectGuard<TextFlowResult>({
  lines: required(arrayOf(isTextFlowLine)),
  exhausted: required(isBoolean),
  warnings: optional(arrayOf(isStructuredError)),
} satisfies ObjectShape<TextFlowResult>);

const isTextFlowFragmentStyle = objectGuard<TextFlowFragmentStyle>({
  fontFamily: required(isString),
  fontWeight: required(isNumber),
  fontStyle: required(isString),
  fontSizePx: required(isNumber),
  letterSpacingPx: optional(isNumber),
  color: optional(isString),
} satisfies ObjectShape<TextFlowFragmentStyle>);

type RubyLevel = TextFlowRubyAnnotation["levels"][number];
type RubyRun = RubyLevel["runs"][number];
const isRubyRun = objectGuard<RubyRun>({
  text: required(isString),
  style: required(isTextFlowFragmentStyle),
} satisfies ObjectShape<RubyRun>);
const isRubyLevel = objectGuard<RubyLevel>({
  text: required(isString),
  position: required(literal("over", "under")),
  runs: required(arrayOf(isRubyRun)),
} satisfies ObjectShape<RubyLevel>);
const isRubyAnnotation = objectGuard<TextFlowRubyAnnotation>({
  text: required(isString),
  position: required(isString),
  align: required(isString),
  style: required(isTextFlowFragmentStyle),
  gapPx: required(isNumber),
  offsetPx: required(isNumber),
  lineSizing: required(literal("stable", "css")),
  levels: required(arrayOf(isRubyLevel)),
} satisfies ObjectShape<TextFlowRubyAnnotation>);

const isTextFlowFragment = objectGuard<TextFlowFragment>({
  text: required(isString),
  charStart: required(isNumber),
  charEnd: required(isNumber),
  x: required(isNumber),
  y: required(isNumber),
  inlineAdvancePx: required(isNumber),
  availableInlineSizePx: required(isNumber),
  regionIndex: required(isNumber),
  baselineOffset: required(isNumber),
  overflowReason: optional(literal("kinsokuAbsorb", "hangingPunctuation", "ellipsis")),
  style: optional(isTextFlowFragmentStyle),
  ruby: optional(isRubyAnnotation),
} satisfies ObjectShape<TextFlowFragment>);

const isTextFlowExclusionLine = objectGuard<TextFlowExclusionLine>({
  fragments: required(arrayOf(isTextFlowFragment)),
  lineIndex: required(isNumber),
  crossSize: required(isNumber),
} satisfies ObjectShape<TextFlowExclusionLine>);

const isTextFlowWithExclusionsResult = objectGuard<TextFlowWithExclusionsResult>({
  lines: required(arrayOf(isTextFlowExclusionLine)),
  exhausted: required(isBoolean),
  usedLineCount: required(isNumber),
  overflowReason: optional(literal("maxLinesTruncated", "flowBoxExhausted", "cannotFit")),
  chosenFontSizePx: optional(isNumber),
  warnings: optional(arrayOf(isStructuredError)),
  topRubyOverflowPx: required(isNumber),
  bottomRubyOverflowPx: required(isNumber),
} satisfies ObjectShape<TextFlowWithExclusionsResult>);

const isMeasureTextBlockLine = objectGuard<MeasureTextBlockLine>({
  charStart: required(isNumber),
  charEnd: required(isNumber),
  text: required(isString),
  inlineAdvancePx: required(isNumber),
  kinsokuUnresolved: required(isBoolean),
} satisfies ObjectShape<MeasureTextBlockLine>);

const isMeasureTextBlockResult = objectGuard<MeasureTextBlockResult>({
  lineCount: required(isNumber),
  usedWidth: required(isNumber),
  usedHeight: required(isNumber),
  lines: optional(arrayOf(isMeasureTextBlockLine)),
} satisfies ObjectShape<MeasureTextBlockResult>);

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

const isShrinkwrapFlowResult = objectGuard<ShrinkwrapFlowResult>({
  status: required(literal("satisfied", "infeasible")),
  chosenWidthPx: optional(isNumber),
  chosenHeightPx: optional(isNumber),
  usedLineCount: required(isNumber),
  usedHeight: required(isNumber),
  layout: required(isTextFlowWithExclusionsResult),
} satisfies ObjectShape<ShrinkwrapFlowResult>);

const isIntrinsicInlineSizeResult = objectGuard<IntrinsicInlineSizeResult>({
  minContentInlineSize: required(isNumber),
  maxContentInlineSize: required(isNumber),
  warnings: optional(arrayOf(isStructuredError)),
} satisfies ObjectShape<IntrinsicInlineSizeResult>);

export function decodeRenderToIrEnvelope(json: string): RenderToIrEnvelope {
  return decodeJson(json, isRenderToIrEnvelope, {
    code: "WASM_INVALID_IR_OUTPUT",
    description: "render_to_ir",
  });
}

export function decodeRenderToSvgEnvelope(json: string): RenderToSvgEnvelope {
  return decodeJson(json, isRenderToSvgEnvelope, {
    code: "WASM_INVALID_SVG_OUTPUT",
    description: "render_to_svg",
  });
}

export function decodeAnimationStateSamples(json: string): DecodedAnimationStateSample[] {
  return decodeJson(json, arrayOf(isAnimationStateSample), {
    code: "WASM_INVALID_ANIMATION_STATE_OUTPUT",
    description: "sample_animation_state",
  });
}

export function decodeTextFlowResult(json: string): TextFlowResult {
  return decodeJson(json, isTextFlowResult, {
    code: "WASM_INVALID_FLOW_OUTPUT",
    description: "layout_text_flow",
  });
}

export function decodeTextFlowWithExclusionsResult(json: string): TextFlowWithExclusionsResult {
  return decodeJson(json, isTextFlowWithExclusionsResult, {
    code: "WASM_INVALID_EXCLUSION_FLOW_OUTPUT",
    description: "layout_text_flow_with_exclusions",
  });
}

export function decodeMeasureTextBlockResult(json: string): MeasureTextBlockResult {
  return decodeJson(json, isMeasureTextBlockResult, {
    code: "WASM_INVALID_MEASURE_OUTPUT",
    description: "measure_text_block",
  });
}

export function decodeShrinkwrapTextResult(json: string): ShrinkwrapTextResult {
  return decodeJson(json, isShrinkwrapTextResult, {
    code: "WASM_INVALID_SHRINKWRAP_OUTPUT",
    description: "shrinkwrap_text",
  });
}

export function decodeShrinkwrapFlowResult(json: string): ShrinkwrapFlowResult {
  return decodeJson(json, isShrinkwrapFlowResult, {
    code: "WASM_INVALID_SHRINKWRAP_FLOW_OUTPUT",
    description: "shrinkwrap_flow",
  });
}

export function decodeIntrinsicInlineSizeResult(json: string): IntrinsicInlineSizeResult {
  return decodeJson(json, isIntrinsicInlineSizeResult, {
    code: "WASM_INVALID_INTRINSIC_INLINE_SIZE_OUTPUT",
    description: "measure_intrinsic_inline_size",
  });
}
