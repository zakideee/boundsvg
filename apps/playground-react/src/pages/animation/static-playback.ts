import type { Engine, EngineInput, RenderSvgOptions } from "@boundsvg/core";

export const STATIC_PLAYBACK_STEP_MS = 40;

export type StaticPlaybackFrame = {
  timeMs: number;
  svg: string;
};

export function createStaticPlaybackTimes(
  durationMs: number,
  stepMs = STATIC_PLAYBACK_STEP_MS,
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`Playback duration must be positive and finite, got ${durationMs}`);
  }
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new RangeError(`Playback step must be positive and finite, got ${stepMs}`);
  }

  const timesMs: number[] = [];
  for (let timeMs = 0; timeMs < durationMs; timeMs += stepMs) {
    timesMs.push(timeMs);
  }
  return timesMs;
}

export function sampleStaticPlaybackTime({
  wallTimeMs,
  originWallTimeMs,
  originSceneTimeMs,
  durationMs,
  stepMs = STATIC_PLAYBACK_STEP_MS,
}: {
  wallTimeMs: number;
  originWallTimeMs: number;
  originSceneTimeMs: number;
  durationMs: number;
  stepMs?: number;
}): number {
  // A requestAnimationFrame timestamp can precede a performance.now() captured
  // later in the same event-loop turn by a fraction of a millisecond.
  const elapsedMs = Math.max(0, wallTimeMs - originWallTimeMs);
  const rawTimeMs = (((originSceneTimeMs + elapsedMs) % durationMs) + durationMs) % durationMs;
  return Math.floor(rawTimeMs / stepMs) * stepMs;
}

export function renderStaticPlaybackFrames(
  engine: Pick<Engine, "renderFrames">,
  input: EngineInput,
  renderOptions: RenderSvgOptions,
  durationMs: number,
  stepMs = STATIC_PLAYBACK_STEP_MS,
): StaticPlaybackFrame[] {
  const timesMs = createStaticPlaybackTimes(durationMs, stepMs);
  const { timeMs: _timeMs, ...frameRenderOptions } = renderOptions;
  return [...engine.renderFrames(input, { ...frameRenderOptions, timesMs, format: "svg" })].map(
    (frame) => {
      if (frame.format !== "svg") {
        throw new TypeError(`Expected an SVG playback frame, got ${frame.format}`);
      }
      return { timeMs: frame.timeMs, svg: frame.data };
    },
  );
}
