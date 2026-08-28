// ---------------------------------------------------------------------------
// Frame schedule derivation for animated raster output
// ---------------------------------------------------------------------------

import { FatalError } from "./errors.js";
import { MAX_ANIMATION_FRAMES } from "./render-capabilities.js";

/** Inclusive bounds on a single frame's display duration, in whole milliseconds. */
const MIN_FRAME_DURATION_MS = 1;
const MAX_FRAME_DURATION_MS = 60_000;

/** Largest total play count representable by animated WebP's ANIM field. */
export const MAX_ANIMATED_WEBP_ITERATIONS = 65_535;

/** Largest total play count representable by GIF's repeat field plus one. */
export const MAX_ANIMATED_GIF_ITERATIONS = 65_536;

const DEFAULT_FPS = 20;
const MIN_FPS = 1;
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

/** Error codes a caller of {@link resolveAnimationFrameSchedule} reports under. */
export type AnimationScheduleErrorCodes = {
  invalidSchedule: string;
  tooManyFrames: string;
};

/** A resolved, validated schedule: one sample time and duration per frame. */
export type ResolvedAnimationSchedule = {
  timesMs: number[];
  frameDurationsMs: number[];
};

function scheduleError(code: string, message: string): FatalError {
  return new FatalError(code, message, { stage: "emit" });
}

function assertFrameCount(frameCount: number, code: string): void {
  if (frameCount > MAX_ANIMATION_FRAMES) {
    throw scheduleError(
      code,
      `Animated output is limited to ${MAX_ANIMATION_FRAMES} frames, got ${frameCount}`,
    );
  }
}

function assertFrameDuration(durationMs: number, index: number, code: string): void {
  if (
    !Number.isInteger(durationMs) ||
    durationMs < MIN_FRAME_DURATION_MS ||
    durationMs > MAX_FRAME_DURATION_MS
  ) {
    throw scheduleError(
      code,
      `Frame ${index} duration must be a whole number of milliseconds in ${MIN_FRAME_DURATION_MS}..${MAX_FRAME_DURATION_MS}, got ${String(durationMs)}`,
    );
  }
}

/**
 * Derive the frame schedule for an animated raster render.
 *
 * Two mutually exclusive forms:
 * - explicit `timesMs` plus a matching `frameDurationsMs`;
 * - `durationMs` with an optional `fps` (default 20), which samples at a fixed
 *   interval and gives every frame the same duration.
 *
 * @throws FatalError with `codes.invalidSchedule` for a malformed schedule, or
 *   `codes.tooManyFrames` when the frame count exceeds `MAX_ANIMATION_FRAMES`.
 */
export function resolveAnimationFrameSchedule(
  options: AnimationScheduleOptions,
  codes: AnimationScheduleErrorCodes,
): ResolvedAnimationSchedule {
  return options.timesMs
    ? resolveExplicitSchedule(options, codes)
    : resolveSampledSchedule(options, codes);
}

function resolveExplicitSchedule(
  options: AnimationScheduleOptions,
  codes: AnimationScheduleErrorCodes,
): ResolvedAnimationSchedule {
  const code = codes.invalidSchedule;
  const timesMs = [...(options.timesMs ?? [])];
  if (timesMs.length === 0) {
    throw scheduleError(code, "timesMs must contain at least one sample time");
  }
  if (options.fps !== undefined || options.durationMs !== undefined) {
    throw scheduleError(code, "timesMs cannot be combined with fps or durationMs");
  }
  for (const timeMs of timesMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw scheduleError(
        code,
        `Animation timeMs must be a non-negative finite number, got ${String(timeMs)}`,
      );
    }
  }
  if (!options.frameDurationsMs) {
    throw scheduleError(code, "frameDurationsMs is required when timesMs is given");
  }
  const frameDurationsMs = [...options.frameDurationsMs];
  if (frameDurationsMs.length !== timesMs.length) {
    throw scheduleError(
      code,
      `frameDurationsMs must have one entry per frame: got ${frameDurationsMs.length} for ${timesMs.length} times`,
    );
  }
  frameDurationsMs.forEach((durationMs, index) => {
    assertFrameDuration(durationMs, index, code);
  });
  assertFrameCount(timesMs.length, codes.tooManyFrames);
  return { timesMs, frameDurationsMs };
}

function resolveSampledSchedule(
  options: AnimationScheduleOptions,
  codes: AnimationScheduleErrorCodes,
): ResolvedAnimationSchedule {
  const code = codes.invalidSchedule;
  if (options.frameDurationsMs) {
    throw scheduleError(code, "frameDurationsMs requires an explicit timesMs schedule");
  }
  const fps = options.fps ?? DEFAULT_FPS;
  if (!Number.isFinite(fps) || fps < MIN_FPS || fps > MAX_FPS) {
    throw scheduleError(
      code,
      `fps must be a finite number in ${MIN_FPS}..${MAX_FPS}, got ${String(fps)}`,
    );
  }
  const durationMs = options.durationMs;
  if (durationMs === undefined) {
    throw scheduleError(code, "durationMs is required unless timesMs is given");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw scheduleError(
      code,
      `durationMs must be a positive finite number, got ${String(durationMs)}`,
    );
  }

  // Checked before materializing the arrays: a long duration at a high fps can
  // ask for orders of magnitude more frames than the cap allows.
  const frameCount = Math.max(2, Math.ceil((durationMs * fps) / 1000));
  assertFrameCount(frameCount, codes.tooManyFrames);

  // Durations are the differences between rounded frame boundaries, not a
  // rounded 1000/fps repeated. At 60 fps the latter would emit 17 ms per frame
  // and drift ~100 ms ahead of the sample times over 300 frames; telescoping
  // keeps the displayed timeline equal to the sampled one.
  //
  // The final boundary is `durationMs`, not the fps grid, so playback lasts
  // exactly as long as asked. `ceil` can put the last grid point past the end,
  // and the two-frame floor can put it well past; clamping each boundary to
  // leave one millisecond per remaining frame keeps them strictly increasing.
  // Sample times take the same ceiling: below one frame period the floor would
  // otherwise sample a pose from well past the requested window.
  const totalMs = Math.max(frameCount * MIN_FRAME_DURATION_MS, Math.round(durationMs));
  const boundaryMs = (index: number): number =>
    index >= frameCount
      ? totalMs
      : Math.min(Math.round((index * 1000) / fps), totalMs - (frameCount - index));

  const timesMs: number[] = [];
  const frameDurationsMs: number[] = [];
  for (let index = 0; index < frameCount; index++) {
    timesMs.push(Math.min((index * 1000) / fps, durationMs));
    const frameDurationMs = boundaryMs(index + 1) - boundaryMs(index);
    assertFrameDuration(frameDurationMs, index, code);
    frameDurationsMs.push(frameDurationMs);
  }
  return { timesMs, frameDurationsMs };
}

/** GIF stores frame delays in centiseconds. */
export const GIF_DELAY_UNIT_MS = 10;

/**
 * Browsers substitute their own default for a delay below 2 centiseconds, so
 * the encoder clamps to it and the emitted timeline can run longer than asked.
 */
const GIF_MIN_DELAY_CS = 2;

/**
 * Per-frame GIF delays in centiseconds: differences between rounded cumulative
 * timestamps, so the 10 ms quantum cannot accumulate into drift, then clamped
 * to the browser floor.
 *
 * Mirrors `resolve_frame_delays_cs` in `gif_anim.rs`; a test pins the two
 * against the bytes the encoder actually emits.
 */
export function resolveGifDelaysCs(frameDurationsMs: readonly number[]): number[] {
  const delays: number[] = [];
  let elapsedMs = 0;
  let previousCs = 0;
  for (const durationMs of frameDurationsMs) {
    elapsedMs += durationMs;
    const boundaryCs = Math.floor((elapsedMs + GIF_DELAY_UNIT_MS / 2) / GIF_DELAY_UNIT_MS);
    delays.push(Math.max(GIF_MIN_DELAY_CS, boundaryCs - previousCs));
    previousCs = boundaryCs;
  }
  return delays;
}

/** Shortest frame GIF can represent, in milliseconds. */
export const GIF_MIN_FRAME_MS = GIF_MIN_DELAY_CS * GIF_DELAY_UNIT_MS;

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
      `${formatName} iterations must be "infinite" or a whole number in 1..${maxIterations}, got ${String(iterations)}`,
    );
  }
}
