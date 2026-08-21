import { type AnimationEasing, type AnimationSpec, FatalError } from "@boundsvg/core";

/**
 * Animation presets and composition helpers.
 *
 * Every function is pure and returns the core `AnimationSpec` type — no engine
 * or WASM involvement, and no new public types. Callers can hand the result
 * straight to a component's `animate` prop.
 */

const FADE_DURATION_MS = 400;
const SLIDE_DURATION_MS = 400;
const SLIDE_DISTANCE_PX = 24;
const SCALE_DURATION_MS = 400;
const SCALE_FROM = 0.8;
const ROTATE_DURATION_MS = 400;
const ROTATE_FROM_DEG = -8;
const POP_STIFFNESS = 170;
const POP_DAMPING = 14;
/**
 * Long enough for the default pop spring to settle.
 *
 * At stiffness 170 / damping 14 the damping ratio is about 0.54, so the decay
 * rate is roughly 7/s. A shorter segment leaves a visible residual that snaps
 * to the final keyframe: 420ms would still leave about 4 percent.
 */
const POP_DURATION_MS = 700;

const DEFAULT_EASING: AnimationEasing = "ease-out";

/** Options shared by every preset. */
export type AnimationPresetOptions = {
  durationMs?: number;
  delayMs?: number;
  easing?: AnimationEasing;
};

export type SlideDirection = "left" | "right" | "top" | "bottom";

export type SlideAnimationOptions = AnimationPresetOptions & {
  /** Edge the element travels from. Defaults to `"bottom"`. */
  from?: SlideDirection;
  distancePx?: number;
};

export type ScaleAnimationOptions = AnimationPresetOptions & {
  /** Starting scale on both axes. Defaults to 0.8. */
  from?: number;
};

export type RotateAnimationOptions = AnimationPresetOptions & {
  /** Starting rotation in degrees. Defaults to -8. */
  fromDeg?: number;
};

export type PopAnimationOptions = Omit<AnimationPresetOptions, "easing"> & {
  stiffness?: number;
  damping?: number;
  mass?: number;
  /** Starting scale on both axes. Defaults to 0.8. */
  from?: number;
};

export type StaggerOptions = {
  count: number;
  intervalMs: number;
  startDelayMs?: number;
};

export type SequenceOptions = {
  gapMs?: number;
};

function presetError(code: string, message: string): FatalError {
  return new FatalError(code, message, { stage: "validate" });
}

function requireFiniteCount(count: number): number {
  if (!Number.isInteger(count) || count < 0) {
    throw presetError(
      "ANIMATION_STAGGER_INVALID_COUNT",
      `staggerAnimations count must be a non-negative integer, received ${count}.`,
    );
  }
  return count;
}

/** Per-preset values applied when the caller overrides nothing. */
type PresetDefaults = {
  durationMs: number;
  easing?: AnimationEasing;
};

function baseSpec(
  keyframes: AnimationSpec["keyframes"],
  defaults: PresetDefaults,
  options?: AnimationPresetOptions,
): AnimationSpec {
  return {
    keyframes,
    durationMs: options?.durationMs ?? defaults.durationMs,
    delayMs: options?.delayMs ?? 0,
    easing: options?.easing ?? defaults.easing ?? DEFAULT_EASING,
    fill: "both",
  };
}

/** Fade from fully transparent to fully opaque. */
export function fadeInAnimation(options?: AnimationPresetOptions): AnimationSpec {
  return baseSpec(
    [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    { durationMs: FADE_DURATION_MS },
    options,
  );
}

/** Fade from fully opaque to fully transparent. */
export function fadeOutAnimation(options?: AnimationPresetOptions): AnimationSpec {
  return baseSpec(
    [
      { at: 0, opacity: 1 },
      { at: 1, opacity: 0 },
    ],
    { durationMs: FADE_DURATION_MS },
    options,
  );
}

/** Travel in from one edge while fading in. */
export function slideInAnimation(options?: SlideAnimationOptions): AnimationSpec {
  const distancePx = options?.distancePx ?? SLIDE_DISTANCE_PX;
  const from = options?.from ?? "bottom";
  const translateX = from === "left" ? -distancePx : from === "right" ? distancePx : 0;
  const translateY = from === "top" ? -distancePx : from === "bottom" ? distancePx : 0;
  return baseSpec(
    [
      { at: 0, opacity: 0, transform: { translateX, translateY } },
      { at: 1, opacity: 1, transform: { translateX: 0, translateY: 0 } },
    ],
    { durationMs: SLIDE_DURATION_MS },
    options,
  );
}

/** Grow from a smaller scale while fading in. */
export function scaleInAnimation(options?: ScaleAnimationOptions): AnimationSpec {
  const from = options?.from ?? SCALE_FROM;
  return baseSpec(
    [
      { at: 0, opacity: 0, transform: { scaleX: from, scaleY: from } },
      { at: 1, opacity: 1, transform: { scaleX: 1, scaleY: 1 } },
    ],
    { durationMs: SCALE_DURATION_MS },
    options,
  );
}

/** Rotate into place while fading in. */
export function rotateInAnimation(options?: RotateAnimationOptions): AnimationSpec {
  const fromDeg = options?.fromDeg ?? ROTATE_FROM_DEG;
  return baseSpec(
    [
      { at: 0, opacity: 0, transform: { rotateDeg: fromDeg } },
      { at: 1, opacity: 1, transform: { rotateDeg: 0 } },
    ],
    { durationMs: ROTATE_DURATION_MS },
    options,
  );
}

/**
 * Scale in on a spring, overshooting slightly before settling.
 *
 * Takes spring parameters instead of an easing, since the spring is the point
 * of the preset.
 */
export function popInAnimation(options?: PopAnimationOptions): AnimationSpec {
  const from = options?.from ?? SCALE_FROM;
  const spring: AnimationEasing = {
    type: "spring",
    stiffness: options?.stiffness ?? POP_STIFFNESS,
    damping: options?.damping ?? POP_DAMPING,
    ...(options?.mass === undefined ? {} : { mass: options.mass }),
  };
  return baseSpec(
    [
      { at: 0, opacity: 0, transform: { scaleX: from, scaleY: from } },
      { at: 1, opacity: 1, transform: { scaleX: 1, scaleY: 1 } },
    ],
    { durationMs: POP_DURATION_MS, easing: spring },
    { durationMs: options?.durationMs, delayMs: options?.delayMs },
  );
}

/**
 * Repeat one spec `count` times, offsetting each copy by a fixed interval.
 *
 * The interval adds to the base spec's own delay, so a preset built with
 * `delayMs` keeps that offset ahead of the whole group.
 */
export function staggerAnimations(base: AnimationSpec, options: StaggerOptions): AnimationSpec[] {
  const count = requireFiniteCount(options.count);
  if (!Number.isFinite(options.intervalMs)) {
    throw presetError(
      "ANIMATION_STAGGER_INVALID_INTERVAL",
      "staggerAnimations intervalMs must be a finite number.",
    );
  }
  const startDelayMs = options.startDelayMs ?? 0;
  return Array.from({ length: count }, (_unused, index) => ({
    ...base,
    delayMs: (base.delayMs ?? 0) + startDelayMs + index * options.intervalMs,
  }));
}

function iterationCount(spec: AnimationSpec): number {
  const iterations = spec.iterations ?? 1;
  if (iterations === "infinite") {
    throw presetError(
      "ANIMATION_SEQUENCE_INFINITE",
      'sequenceAnimations cannot follow a spec with iterations: "infinite" — it never ends, so the next start time is undefined.',
    );
  }
  return iterations;
}

/**
 * Chain specs back to back, each starting when the previous one finishes.
 *
 * The accumulated start time is `delayMs + durationMs * iterations + gapMs`.
 * Any spec other than the last may not run forever, since nothing after it
 * would ever begin; the last one may, because nothing follows it.
 */
export function sequenceAnimations(
  specs: readonly AnimationSpec[],
  options?: SequenceOptions,
): AnimationSpec[] {
  const gapMs = options?.gapMs ?? 0;
  if (!Number.isFinite(gapMs)) {
    throw presetError(
      "ANIMATION_SEQUENCE_INVALID_GAP",
      "sequenceAnimations gapMs must be a finite number.",
    );
  }
  let cursorMs = 0;
  return specs.map((spec, index) => {
    const startMs = cursorMs + (spec.delayMs ?? 0);
    if (index < specs.length - 1) {
      cursorMs = startMs + spec.durationMs * iterationCount(spec) + gapMs;
    }
    return { ...spec, delayMs: startMs };
  });
}
