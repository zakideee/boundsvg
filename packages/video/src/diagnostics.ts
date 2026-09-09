/** Closed diagnostics and the single decoder for the MP4 failure boundary. */
import { type DiagnosticContext, FatalError } from "@boundsvg/core";

const videoDiagnostics = [
  {
    code: "VIDEO_ENCODER_UNSUPPORTED",
    category: "encoderUnsupported",
    stage: "emit",
    message: "Video encoding is unavailable for this configuration",
  },
  {
    code: "VIDEO_ENCODER_FAILED",
    category: "encoderFailure",
    stage: "emit",
    message: "Video encoding failed",
  },
  {
    code: "VIDEO_MUXER_LOAD_FAILED",
    category: "load",
    stage: "wasm",
    message: "MP4 muxer could not be initialized",
  },
  {
    code: "VIDEO_MUXER_ABI_MISMATCH",
    category: "protocol",
    stage: "wasm",
    message: "MP4 muxer schema does not match this package",
  },
  {
    code: "VIDEO_MUXER_INVALID_INPUT",
    category: "invalidInput",
    stage: "validate",
    message: "MP4 muxer input is invalid",
  },
  {
    code: "VIDEO_MUXER_MISSING_INPUT",
    category: "missingInput",
    stage: "emit",
    message: "MP4 muxer requires an input that was not supplied",
  },
  {
    code: "VIDEO_MUXER_INVALID_STATE",
    category: "invalidState",
    stage: "emit",
    message: "MP4 muxer operation is invalid in its current state",
  },
  {
    code: "VIDEO_MUXER_RESOURCE_LIMIT",
    category: "resource",
    stage: "emit",
    message: "MP4 output exceeds the supported resource limit",
  },
  {
    code: "VIDEO_MUXER_ALLOCATION_FAILED",
    category: "resource",
    stage: "emit",
    message: "MP4 muxer could not allocate output storage",
  },
  {
    code: "VIDEO_MUXER_WRITE_FAILED",
    category: "container",
    stage: "emit",
    message: "MP4 container assembly failed",
  },
  {
    code: "VIDEO_MUXER_PROTOCOL_ERROR",
    category: "protocol",
    stage: "wasm",
    message: "MP4 muxer returned an invalid failure",
  },
  {
    code: "VIDEO_SAMPLE_ORDER_INVALID",
    category: "sampleOrder",
    stage: "emit",
    message: "Encoded samples are not in presentation order",
  },
  {
    code: "VIDEO_SAMPLE_COUNT_MISMATCH",
    category: "sampleCount",
    stage: "emit",
    message: "Encoded sample count does not match submitted frames",
  },
  {
    code: "VIDEO_FRAME_PREPARATION_FAILED",
    category: "framePreparation",
    stage: "emit",
    message: "Video frame could not be prepared",
  },
] as const;

function diagnosticPolicy(code: VideoDiagnosticCode) {
  const policy = videoDiagnostics.find((entry) => entry.code === code);
  if (!policy) {
    throw new TypeError("Unknown Video diagnostic code");
  }
  return policy;
}

/** Codes owned by encoder, frame preparation and MP4 boundary producers. */
export type VideoDiagnosticCode = (typeof videoDiagnostics)[number]["code"];
/** Closed operations reported by Video producers. */
export type VideoOperation =
  | "load"
  | "createMuxer"
  | "setDescription"
  | "appendSample"
  | "finishMuxer"
  | "writeSample"
  | "probeEncoder"
  | "createEncoder"
  | "configureEncoder"
  | "encodeFrame"
  | "flushEncoder"
  | "receiveSample"
  | "createCanvas"
  | "decodeFrame"
  | "drawFrame"
  | "createFrame"
  | "closeEncoder"
  | "closeFrame"
  | "disposeMuxer";
/** Bounded scalar context authored by the TypeScript adapter. */
type VideoDiagnosticDetails = {
  field?:
    | "width"
    | "height"
    | "fpsNumerator"
    | "fpsDenominator"
    | "frameCountHint"
    | "generatorName"
    | "generatorVersion"
    | "codecDescription";
  width?: number;
  height?: number;
  sampleCount?: number;
  frameCount?: number;
  limitBytes?: number;
  requestedBytes?: number;
  previousTimestampMicros?: number;
  timestampMicros?: number;
};

/** Construct a fixed diagnostic without copying an external exception. */
export function createVideoError(
  code: VideoDiagnosticCode,
  operation: VideoOperation,
  details: VideoDiagnosticDetails = {},
): FatalError {
  const policy = diagnosticPolicy(code);
  const context: DiagnosticContext = { domain: "video", category: policy.category, operation };
  for (const [key, scalar] of Object.entries(details)) {
    if (
      typeof scalar === "string" ||
      (typeof scalar === "number" &&
        Number.isFinite(scalar) &&
        (key.endsWith("TimestampMicros") ||
          key === "timestampMicros" ||
          (Number.isSafeInteger(scalar) && scalar >= 0)))
    ) {
      context[key] = scalar;
    }
  }
  return new FatalError(code, policy.message, { stage: policy.stage, context });
}

/** Attempt cleanup after a primary failure without replacing that failure. */
export function cleanupAfterFailure(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    // Cleanup is best-effort only when a primary failure already exists.
  }
}

type NativeRule = {
  code: VideoDiagnosticCode;
  operations: readonly VideoOperation[];
  fields?: readonly string[];
  numbers?: readonly string[];
};
const nativeRules: Record<string, NativeRule> = {
  invalidDimension: {
    code: "VIDEO_MUXER_INVALID_INPUT",
    operations: ["createMuxer"],
    fields: ["width", "height"],
    numbers: ["width", "height"],
  },
  invalidFrameRate: {
    code: "VIDEO_MUXER_INVALID_INPUT",
    operations: ["createMuxer"],
    fields: ["fpsNumerator", "fpsDenominator"],
  },
  invalidFrameCountHint: {
    code: "VIDEO_MUXER_INVALID_INPUT",
    operations: ["createMuxer"],
    fields: ["frameCountHint"],
  },
  invalidGeneratorName: {
    code: "VIDEO_MUXER_INVALID_INPUT",
    operations: ["createMuxer"],
    fields: ["generatorName"],
  },
  invalidGeneratorVersion: {
    code: "VIDEO_MUXER_INVALID_INPUT",
    operations: ["createMuxer"],
    fields: ["generatorVersion"],
  },
  incompleteGenerator: {
    code: "VIDEO_MUXER_INVALID_INPUT",
    operations: ["createMuxer"],
    fields: ["generatorName", "generatorVersion"],
  },
  invalidCodecDescription: {
    code: "VIDEO_MUXER_INVALID_INPUT",
    operations: ["setDescription"],
    fields: ["codecDescription"],
  },
  missingCodecDescription: {
    code: "VIDEO_MUXER_MISSING_INPUT",
    operations: ["appendSample"],
    fields: ["codecDescription"],
    numbers: ["sampleCount"],
  },
  emptySamples: {
    code: "VIDEO_MUXER_MISSING_INPUT",
    operations: ["finishMuxer"],
    numbers: ["sampleCount"],
  },
  alreadyFinished: {
    code: "VIDEO_MUXER_INVALID_STATE",
    operations: ["setDescription", "appendSample", "finishMuxer"],
    numbers: ["sampleCount"],
  },
  descriptionAfterSamples: {
    code: "VIDEO_MUXER_INVALID_STATE",
    operations: ["setDescription"],
    numbers: ["sampleCount"],
  },
  outputByteLimit: {
    code: "VIDEO_MUXER_RESOURCE_LIMIT",
    operations: ["appendSample"],
    numbers: ["limitBytes", "requestedBytes"],
  },
  outputAllocation: {
    code: "VIDEO_MUXER_ALLOCATION_FAILED",
    operations: ["appendSample"],
    numbers: ["requestedBytes"],
  },
  metadataReservationLimit: { code: "VIDEO_MUXER_RESOURCE_LIMIT", operations: ["createMuxer"] },
  writerRejected: {
    code: "VIDEO_MUXER_WRITE_FAILED",
    operations: ["createMuxer", "setDescription", "appendSample", "finishMuxer"],
    numbers: ["sampleCount"],
  },
  insufficientIndexSpace: {
    code: "VIDEO_MUXER_WRITE_FAILED",
    operations: ["finishMuxer"],
    numbers: ["sampleCount"],
  },
  invalidContainerStructure: {
    code: "VIDEO_MUXER_WRITE_FAILED",
    operations: ["finishMuxer"],
    numbers: ["sampleCount"],
  },
};

function readRecord(input: unknown): Record<string, unknown> | undefined {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    return undefined;
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > 16) {
    return undefined;
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return undefined;
    }
    record[key] = descriptor.value;
  }
  return record;
}

/** Decode an exact native envelope, rejecting malformed or unstructured throws. */
export function decodeMp4Failure(input: unknown, operation: VideoOperation): FatalError {
  const protocolError = (): FatalError => createVideoError("VIDEO_MUXER_PROTOCOL_ERROR", operation);
  try {
    const envelope = readRecord(input);
    if (
      !envelope ||
      Object.keys(envelope).length !== 5 ||
      !["severity", "code", "message", "stage", "context"].every((key) =>
        Object.hasOwn(envelope, key),
      )
    ) {
      return protocolError();
    }
    const context = readRecord(envelope.context);
    if (
      !context ||
      typeof context.reason !== "string" ||
      !Object.hasOwn(nativeRules, context.reason)
    ) {
      return protocolError();
    }
    const rule = nativeRules[context.reason];
    if (!rule) {
      return protocolError();
    }
    const policy = diagnosticPolicy(rule.code);
    if (
      envelope.severity !== "fatal" ||
      envelope.code !== rule.code ||
      envelope.message !== policy.message ||
      envelope.stage !== policy.stage ||
      context.domain !== "video" ||
      context.category !== policy.category ||
      context.operation !== operation ||
      !rule.operations.includes(operation)
    ) {
      return protocolError();
    }
    if (!hasValidNativeDetails(context, rule, operation)) {
      return protocolError();
    }
    return new FatalError(rule.code, policy.message, {
      stage: policy.stage,
      context: context as DiagnosticContext,
    });
  } catch {
    return protocolError();
  }
}

function hasValidNativeDetails(
  context: Record<string, unknown>,
  rule: NativeRule,
  operation: VideoOperation,
): boolean {
  if (
    rule.fields
      ? typeof context.field !== "string" || !rule.fields.includes(context.field)
      : Object.hasOwn(context, "field")
  ) {
    return false;
  }
  const allowedKeys = [
    "domain",
    "category",
    "operation",
    "reason",
    ...(rule.fields ? ["field"] : []),
    ...(rule.numbers ?? []),
  ];
  for (const [key, scalar] of Object.entries(context)) {
    if (!allowedKeys.includes(key)) {
      return false;
    }
    if (
      rule.numbers?.includes(key) &&
      (typeof scalar !== "number" || !Number.isSafeInteger(scalar) || scalar < 0)
    ) {
      return false;
    }
  }
  if (context.reason === "emptySamples" && context.sampleCount !== 0) {
    return false;
  }
  if (
    context.reason === "invalidDimension" &&
    ["width", "height"].some((key) => Object.hasOwn(context, key) && key !== context.field)
  ) {
    return false;
  }
  if (
    context.reason === "writerRejected" &&
    operation === "createMuxer" &&
    Object.hasOwn(context, "sampleCount")
  ) {
    return false;
  }
  return true;
}
