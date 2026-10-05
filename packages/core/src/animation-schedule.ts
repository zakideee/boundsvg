// ---------------------------------------------------------------------------
// Frame schedule derivation for animated raster output
// ---------------------------------------------------------------------------

import { FatalError, formatUnknownDiagnosticValue } from "./errors.js";

/** Inclusive bounds on a single frame's display duration, in whole milliseconds. */
const MIN_FRAME_DURATION_MS = 1;
/** Largest whole-millisecond duration accepted for one frame. */
const MAX_FRAME_DURATION_MS = 60_000;

/** Largest total play count representable by animated WebP's ANIM field. */
export const MAX_ANIMATED_WEBP_ITERATIONS = 65_535;

/** Largest total play count representable by GIF's repeat field plus one. */
export const MAX_ANIMATED_GIF_ITERATIONS = 65_536;

/** Sample rate used when the caller omits fps in sampled mode. */
const DEFAULT_FPS = 20;
/** Smallest accepted primitive finite sample rate, inclusive. */
const MIN_FPS = 1;
/** Largest accepted primitive finite sample rate, inclusive. */
const MAX_FPS = 60;

/** Caller-facing schedule inputs for an animated raster render. */
export type AnimationScheduleOptions = {
  /** Explicit sample times. Mutually exclusive with `fps` / `durationMs`. */
  timesMs?: readonly number[];
  /** Per-frame display durations. Required with `timesMs`, and the same length. */
  frameDurationsMs?: readonly number[];
  /** Frames per second, 1..=60. Default 20. Rejected when `timesMs` is given. */
  fps?: number;
  /** Total animation length. Required unless `timesMs` is given. */
  durationMs?: number;
};

/** Construct the format-specific schedule diagnostic before scene preparation. */
function scheduleError(code: string, message: string): FatalError {
  return new FatalError(code, message, { stage: "emit" });
}

/** Validate one display duration in the existing whole-millisecond domain. */
function assertFrameDuration(durationMs: number, index: number, code: string): void {
  if (
    !Number.isInteger(durationMs) ||
    durationMs < MIN_FRAME_DURATION_MS ||
    durationMs > MAX_FRAME_DURATION_MS
  ) {
    throw scheduleError(
      code,
      `Frame ${index} duration must be a whole number of milliseconds in ${MIN_FRAME_DURATION_MS}..${MAX_FRAME_DURATION_MS}, got ${formatUnknownDiagnosticValue(durationMs, "unprintable value")}`,
    );
  }
}

/** GIF stores frame delays in centiseconds. */
export const GIF_DELAY_UNIT_MS = 10;

/** Browser-compatible minimum frame delay in centiseconds. */
const GIF_DELAY_CS_MIN = 2;

/** Largest value representable by the GIF delay field. */
const GIF_DELAY_CS_MAX = 65_535;

/** Shortest display duration represented without the GIF browser floor. */
export const GIF_MIN_FRAME_MS = GIF_DELAY_CS_MIN * GIF_DELAY_UNIT_MS;

/** Schedule cursors for streaming animated containers, with no sampled arrays. */
export type AnimationScheduleDescriptor =
  | {
      kind: "sampled";
      fps: number;
      durationMs: number;
      frameCount: number;
      totalMs: number;
    }
  | {
      kind: "explicit";
      timesMs: readonly number[];
      frameDurationsMs: readonly number[];
      frameCount: number;
    };

/** A sample pose and its whole-millisecond display duration. */
export type AnimationScheduleEntry = {
  index: number;
  timeMs: number;
  durationMs: number;
};

/** A single-use cursor; returning it makes subsequent reads complete. */
export type AnimationScheduleCursor = {
  /** Validate and read one entry without retaining previously read entries. */
  next(): IteratorResult<AnimationScheduleEntry, undefined>;
  /** Release this cursor's descriptor reference; repeated calls are harmless. */
  return(): IteratorResult<AnimationScheduleEntry, undefined>;
};

/** Container identity and the existing schedule diagnostic to preserve. */
type AnimationScheduleContext = {
  format: "webp" | "gif";
  invalidSchedule: string;
};

/** Report a derived index or boundary that cannot be represented exactly. */
function unrepresentableSchedule(
  context: AnimationScheduleContext,
  reason: "unsafeFrameCount" | "unsafeTotalMs",
): FatalError {
  return new FatalError(
    "ANIMATED_RASTER_NUMERIC_UNREPRESENTABLE",
    "Animation schedule cannot be represented with exact integer indices and boundaries",
    {
      stage: "emit",
      context: {
        format: context.format,
        operation: "open",
        reason,
        field: reason === "unsafeFrameCount" ? "frameCount" : "options",
      },
    },
  );
}

/**
 * Resolve a descriptor from the caller's already detached option snapshot.
 * Explicit arrays are adopted; the animation entry makes their sole copy.
 * Entry validation is performed by the pre-render scan through a cursor.
 *
 * @throws FatalError for conflicting fields, invalid scalar domains, or unsafe
 * integer frame counts and total millisecond boundaries, before compilation.
 */
export function resolveAnimationScheduleDescriptor(
  options: AnimationScheduleOptions,
  context: AnimationScheduleContext,
): AnimationScheduleDescriptor {
  const code = context.invalidSchedule;
  if (options.timesMs !== undefined) {
    if (!Array.isArray(options.timesMs)) {
      throw scheduleError(code, "timesMs must be an array of sample times");
    }
    if (options.timesMs.length === 0) {
      throw scheduleError(code, "timesMs must contain at least one sample time");
    }
    if (options.fps !== undefined || options.durationMs !== undefined) {
      throw scheduleError(code, "timesMs cannot be combined with fps or durationMs");
    }
    if (options.frameDurationsMs === undefined) {
      throw scheduleError(code, "frameDurationsMs is required when timesMs is given");
    }
    if (!Array.isArray(options.frameDurationsMs)) {
      throw scheduleError(code, "frameDurationsMs must be an array of display durations");
    }
    if (options.frameDurationsMs.length !== options.timesMs.length) {
      throw scheduleError(
        code,
        `frameDurationsMs must have one entry per frame: got ${options.frameDurationsMs.length} for ${options.timesMs.length} times`,
      );
    }
    return {
      kind: "explicit",
      timesMs: options.timesMs,
      frameDurationsMs: options.frameDurationsMs,
      frameCount: options.timesMs.length,
    };
  }
  if (options.frameDurationsMs !== undefined) {
    throw scheduleError(code, "frameDurationsMs requires an explicit timesMs schedule");
  }
  const fps = options.fps === undefined ? DEFAULT_FPS : options.fps;
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps < MIN_FPS || fps > MAX_FPS) {
    throw scheduleError(
      code,
      `fps must be a finite number in ${MIN_FPS}..${MAX_FPS}, got ${formatUnknownDiagnosticValue(fps, "unprintable value")}`,
    );
  }
  const durationMs = options.durationMs;
  if (durationMs === undefined) {
    throw scheduleError(code, "durationMs is required unless timesMs is given");
  }
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw scheduleError(
      code,
      `durationMs must be a positive finite number, got ${formatUnknownDiagnosticValue(durationMs, "unprintable value")}`,
    );
  }
  // Multiplication, division, and rounding must keep the original binary64
  // evaluation order; algebraic reassociation changes boundary neighbors.
  const frameCount = Math.max(2, Math.ceil((durationMs * fps) / 1000));
  if (!Number.isSafeInteger(frameCount)) {
    throw unrepresentableSchedule(context, "unsafeFrameCount");
  }
  const totalMs = Math.max(frameCount, Math.round(durationMs));
  if (!Number.isSafeInteger(totalMs)) {
    throw unrepresentableSchedule(context, "unsafeTotalMs");
  }
  return { kind: "sampled", fps, durationMs, frameCount, totalMs };
}

/** Compute one boundary with the original binary64 evaluation order. */
function sampledBoundaryMs(
  descriptor: Extract<AnimationScheduleDescriptor, { kind: "sampled" }>,
  index: number,
): number {
  return index >= descriptor.frameCount
    ? descriptor.totalMs
    : Math.min(
        Math.round((index * 1000) / descriptor.fps),
        descriptor.totalMs - (descriptor.frameCount - index),
      );
}

/**
 * Read one indexed entry with the original sampled arithmetic.
 *
 * @throws FatalError when the index is invalid or an explicit snapshot entry
 * is outside the existing time or duration domain.
 */
export function getAnimationScheduleEntry(
  descriptor: AnimationScheduleDescriptor,
  index: number,
  context: AnimationScheduleContext,
): AnimationScheduleEntry {
  const code = context.invalidSchedule;
  if (!Number.isSafeInteger(index) || index < 0 || index >= descriptor.frameCount) {
    throw scheduleError(code, "Animation schedule index is outside the frame range");
  }
  const timeMs =
    descriptor.kind === "sampled"
      ? Math.min((index * 1000) / descriptor.fps, descriptor.durationMs)
      : descriptor.timesMs[index];
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0) {
    throw scheduleError(
      code,
      `Animation timeMs must be a non-negative finite number, got ${formatUnknownDiagnosticValue(timeMs, "unprintable value")}`,
    );
  }
  const durationMs =
    descriptor.kind === "sampled"
      ? sampledBoundaryMs(descriptor, index + 1) - sampledBoundaryMs(descriptor, index)
      : descriptor.frameDurationsMs[index];
  if (typeof durationMs !== "number") {
    throw scheduleError(
      code,
      `Frame ${index} duration must be a whole number of milliseconds in ${MIN_FRAME_DURATION_MS}..${MAX_FRAME_DURATION_MS}, got ${formatUnknownDiagnosticValue(durationMs, "unprintable value")}`,
    );
  }
  assertFrameDuration(durationMs, index, code);
  return { index, timeMs, durationMs };
}

/** An owned cursor releases its sole descriptor reference on completion or return. */
class OwnedAnimationScheduleCursor implements AnimationScheduleCursor {
  private nextIndex = 0;

  constructor(
    private descriptor: AnimationScheduleDescriptor | undefined,
    private readonly context: AnimationScheduleContext,
  ) {}

  /** Read one validated entry and release retained input on completion or failure. */
  next(): IteratorResult<AnimationScheduleEntry, undefined> {
    const descriptor = this.descriptor;
    if (descriptor === undefined || this.nextIndex === descriptor.frameCount) {
      this.descriptor = undefined;
      return { done: true, value: undefined };
    }
    try {
      const entry = getAnimationScheduleEntry(descriptor, this.nextIndex, this.context);
      this.nextIndex += 1;
      if (this.nextIndex === descriptor.frameCount) {
        this.descriptor = undefined;
      }
      return { done: false, value: entry };
    } catch (error) {
      this.descriptor = undefined;
      throw error;
    }
  }

  /** Close this pass without affecting another cursor over the same descriptor. */
  return(): IteratorResult<AnimationScheduleEntry, undefined> {
    this.descriptor = undefined;
    return { done: true, value: undefined };
  }
}

/** Create an independent constant-space pass over one detached descriptor. */
export function createAnimationScheduleCursor(
  descriptor: AnimationScheduleDescriptor,
  context: AnimationScheduleContext,
): AnimationScheduleCursor {
  return new OwnedAnimationScheduleCursor(descriptor, context);
}

/** GIF delay cursor retaining only elapsed milliseconds modulo ten. */
type GifDelayCursor = {
  /** Consume one previously validated integer-millisecond frame duration. */
  next(durationMs: number): number;
};

/**
 * Create a GIF delay cursor with cumulative round-half-up semantics.
 * The whole elapsed duration is intentionally absent, so long animations
 * cannot overflow a cumulative counter or retain a delay array.
 */
export function createGifDelayCursor(): GifDelayCursor {
  let residueMs = 0;
  return {
    next(durationMs) {
      const residueAndDuration = residueMs + durationMs;
      const nextResidueMs = residueAndDuration % GIF_DELAY_UNIT_MS;
      const rawDelayCs =
        Math.floor(residueAndDuration / GIF_DELAY_UNIT_MS) +
        Number(nextResidueMs >= GIF_DELAY_UNIT_MS / 2) -
        Number(residueMs >= GIF_DELAY_UNIT_MS / 2);
      residueMs = nextResidueMs;
      return Math.max(GIF_DELAY_CS_MIN, Math.min(GIF_DELAY_CS_MAX, rawDelayCs));
    },
  };
}

/**
 * Validate a total play count against one animated container's bounds.
 *
 * @throws FatalError with `code` when the value is omitted, is not
 *   `"infinite"`, or is not a whole number in `1..maxIterations`.
 */
export function assertAnimationIterations(
  iterations: unknown,
  { maxIterations, code, formatName }: { maxIterations: number; code: string; formatName: string },
): asserts iterations is number | "infinite" {
  if (iterations === "infinite") {
    return;
  }
  if (
    typeof iterations !== "number" ||
    !Number.isFinite(iterations) ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > maxIterations
  ) {
    throw scheduleError(
      code,
      `${formatName} iterations must be "infinite" or a whole number in 1..${maxIterations}, got ${formatUnknownDiagnosticValue(iterations, "unprintable value")}`,
    );
  }
}
