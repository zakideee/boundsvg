/** Authenticate animation diagnostics and local cancellation at the Worker transport boundary. */
import { FatalError } from "@boundsvg/core";
import { decodeAnimatedRasterFatal } from "@boundsvg/core/wasm";

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

/** Preserve only authenticated sink diagnostics; keep any other callback exception as cause. */
export function animatedRasterSinkFailure(
  format: AnimatedRasterFormat,
  operation: "write" | "patch" | "finish" | "abort",
  cause: unknown,
): FatalError {
  try {
    // Package entries can hold distinct constructors for the same fatal envelope.
    const diagnostic = decodeAnimatedRasterFatal(
      cause instanceof FatalError ? FatalError.prototype.toJSON.call(cause) : cause,
    );
    if (
      diagnostic &&
      (diagnostic.code === "ANIMATED_RASTER_SINK_FAILED" ||
        diagnostic.code === "ANIMATED_RASTER_SINK_UNAVAILABLE")
    ) {
      return cause instanceof FatalError
        ? cause
        : FatalError.fromSerialized(FatalError.prototype.toJSON.call(diagnostic));
    }
  } catch {
    // Unreadable callback failures retain their original cause.
  }
  const fatal = animatedRasterFailure(format, operation, {
    family: "SINK_FAILED",
    reason: operation === "abort" ? "storage" : operation,
    field: "sink",
  });
  Object.defineProperty(fatal, "cause", { value: cause, configurable: true });
  return fatal;
}

/** Native brand getter ignores caller-created properties on an authentic signal. */
const signalAbortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

/** Authenticate request cancellation without reading or trusting a duck-typed property. */
export function assertAnimationSignal(
  signal: unknown,
  format: AnimatedRasterFormat,
): asserts signal is AbortSignal | undefined {
  if (signal === undefined) {
    return;
  }
  try {
    if (!signalAbortedGetter) {
      throw new TypeError("AbortSignal is unavailable");
    }
    Reflect.apply(signalAbortedGetter, signal, []);
  } catch {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: signal === null ? "nullField" : "wrongType",
      field: "options",
    });
  }
}

/** Read native cancellation state after the request signal has been authenticated. */
export function isAnimationSignalAborted(signal: AbortSignal | undefined): boolean {
  return (
    signal !== undefined &&
    signalAbortedGetter !== undefined &&
    Reflect.apply(signalAbortedGetter, signal, []) === true
  );
}

/** Authenticate required local sink capabilities before adopting any callback ownership. */
export function assertAnimatedRasterSink(
  sink: unknown,
  requirements: { format: AnimatedRasterFormat; shouldRequirePatch: boolean },
): asserts sink is import("@boundsvg/core").AnimatedRasterSink {
  const { format, shouldRequirePatch } = requirements;
  const reason = sink === undefined ? "missingField" : sink === null ? "nullField" : "wrongType";
  if (
    typeof sink !== "object" ||
    sink === null ||
    ["write", "finish", "abort", ...(shouldRequirePatch ? ["patch"] : [])].some(
      (key) => typeof Reflect.get(sink, key) !== "function",
    )
  ) {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: reason,
      field: "sink",
    });
  }
}
