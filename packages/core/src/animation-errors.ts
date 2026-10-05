/** Closed animation diagnostics preserve operation identity and local callback causes. */
import { FatalError } from "./errors.js";

/** Container identity carried by animation diagnostics and output. */
export type AnimatedRasterFormat = "webp" | "gif";

/** Operations accepted in an animated raster diagnostic. */
export type AnimatedRasterOperation =
  | "open"
  | "push"
  | "drain"
  | "write"
  | "patch"
  | "finish"
  | "abort"
  | "takeBytes";

/** Closed diagnostic reasons grouped by their public error code. */
const animationErrorReasons = new Map<AnimatedRasterErrorFamily, readonly string[]>([
  [
    "SESSION_INVALID_INPUT",
    [
      "wrongType",
      "malformedJson",
      "missingField",
      "nullField",
      "unknownField",
      "outOfDomain",
      "invalidUnicode",
    ],
  ],
  [
    "SESSION_INVALID_STATE",
    [
      "pendingOutput",
      "noFrames",
      "incompleteFrames",
      "excessFrames",
      "alreadyFinished",
      "wrongEngine",
      "aborted",
      "freed",
      "collectorNotFinished",
      "collectorConsumed",
    ],
  ],
  [
    "NUMERIC_UNREPRESENTABLE",
    ["unsafeFrameCount", "unsafeTotalMs", "counterOverflow", "unsafeOutputPosition"],
  ],
  ["CONTAINER_UNREPRESENTABLE", ["riffSize", "chunkSize", "canvasSize"]],
  ["SINK_FAILED", ["write", "patch", "finish", "storage", "collectorLimit"]],
  ["SINK_UNAVAILABLE", ["unsupported", "permission"]],
  ["ABORTED", ["signal", "engineDisposed", "deadline", "workerDisposed"]],
  ["JOB_BUSY", ["activeAnimation"]],
]);

/** Closed public animation diagnostic family. */
type AnimatedRasterErrorFamily =
  | "SESSION_INVALID_INPUT"
  | "SESSION_INVALID_STATE"
  | "NUMERIC_UNREPRESENTABLE"
  | "CONTAINER_UNREPRESENTABLE"
  | "SINK_FAILED"
  | "SINK_UNAVAILABLE"
  | "ABORTED"
  | "JOB_BUSY";

/** Optional field identity accepted by animation diagnostics. */
type AnimatedRasterErrorField =
  | "format"
  | "frameCount"
  | "iterations"
  | "options"
  | "renderOptions"
  | "timeMs"
  | "durationMs"
  | "bytesWritten"
  | "patch"
  | "sink";

/** Create a structured animation failure without including user source or paths. */
export function animatedRasterFailure(
  format: AnimatedRasterFormat,
  operation: AnimatedRasterOperation,
  detail: { family: AnimatedRasterErrorFamily; reason: string; field?: AnimatedRasterErrorField },
): FatalError {
  const { family, reason, field } = detail;
  return new FatalError(
    `ANIMATED_RASTER_${family}`,
    `Animated ${format} ${operation} failed: ${reason}`,
    {
      stage: family === "JOB_BUSY" ? "engine" : "emit",
      context: { format, operation, reason, ...(field === undefined ? {} : { field }) },
    },
  );
}

/** Authenticate a serialized or local animation fatal, including its closed context. */
export function decodeAnimatedRasterFatal(value: unknown): FatalError | undefined {
  try {
    // Caller overrides must not replace the local diagnostic's authenticated envelope.
    const fatal =
      value instanceof FatalError
        ? FatalError.fromSerialized(FatalError.prototype.toJSON.call(value))
        : FatalError.fromSerialized(
            typeof value === "string" ? (JSON.parse(value) as unknown) : value,
          );
    const prefix = "ANIMATED_RASTER_";
    if (!fatal.code.startsWith(prefix) || fatal.nodeId !== undefined) {
      return undefined;
    }
    const family = fatal.code.slice(prefix.length);
    if (!animationErrorReasons.has(family as AnimatedRasterErrorFamily)) {
      return undefined;
    }
    const reasons = animationErrorReasons.get(family as AnimatedRasterErrorFamily);
    const context = fatal.context;
    if (
      !context ||
      (context.format !== "webp" && context.format !== "gif") ||
      typeof context.operation !== "string" ||
      !["open", "push", "drain", "write", "patch", "finish", "abort", "takeBytes"].includes(
        context.operation,
      ) ||
      typeof context.reason !== "string" ||
      !reasons?.includes(context.reason) ||
      fatal.stage !== (family === "JOB_BUSY" ? "engine" : "emit") ||
      Reflect.ownKeys(context).some(
        (key) =>
          typeof key !== "string" ||
          !["format", "operation", "reason", "field", "frameIndex"].includes(key),
      )
    ) {
      return undefined;
    }
    if (
      Object.hasOwn(context, "field") &&
      (typeof context.field !== "string" ||
        ![
          "format",
          "frameCount",
          "iterations",
          "options",
          "renderOptions",
          "timeMs",
          "durationMs",
          "bytesWritten",
          "patch",
          "sink",
        ].includes(context.field))
    ) {
      return undefined;
    }
    if (
      Object.hasOwn(context, "frameIndex") &&
      (typeof context.frameIndex !== "number" ||
        !Number.isSafeInteger(context.frameIndex) ||
        context.frameIndex < 0)
    ) {
      return undefined;
    }
    return fatal;
  } catch {
    return undefined;
  }
}

/** Preserve only authenticated sink diagnostics; keep any other callback exception as cause. */
export function animatedRasterSinkFailure(
  format: AnimatedRasterFormat,
  operation: "write" | "patch" | "finish" | "abort",
  cause: unknown,
): FatalError {
  const diagnostic = decodeAnimatedRasterFatal(cause);
  if (
    diagnostic &&
    (diagnostic.code === "ANIMATED_RASTER_SINK_FAILED" ||
      diagnostic.code === "ANIMATED_RASTER_SINK_UNAVAILABLE")
  ) {
    return cause instanceof FatalError ? cause : diagnostic;
  }
  const fatal = animatedRasterFailure(format, operation, {
    family: "SINK_FAILED",
    reason: operation === "abort" ? "storage" : operation,
    field: "sink",
  });
  Object.defineProperty(fatal, "cause", { value: cause, configurable: true });
  return fatal;
}
