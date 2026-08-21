import type {
  AnimationEasing,
  AnimationKeyframe,
  AnimationSpec,
  AnimationTransform2D,
} from "./vnode/types.js";

// ---------------------------------------------------------------------------
// Track building — timed keyframes to a playable AnimationSpec.
//
// Plan-style consumers think in absolute milliseconds ("aim here at
// 3400ms"); AnimationSpec thinks in normalized 0..1 offsets that CSS
// only accepts when strictly increasing. This helper owns the
// conversion: clamping into range, nudging collisions apart by a small
// epsilon, and dropping frames that fall past the end.
// ---------------------------------------------------------------------------

/** One timed keyframe, in absolute milliseconds from the track start. */
export type TrackFrameInput = {
  atMs: number;
  opacity?: number;
  transform?: AnimationTransform2D;
};

/** The smallest offset gap two keyframes keep, so offsets stay strictly increasing. */
const TRACK_EPSILON = 0.0004;
/** Interior frames stop short of 1 so a terminal frame can always land there. */
const TRACK_INTERIOR_MAX = 1 - TRACK_EPSILON;

/**
 * Normalize timed keyframes into an `AnimationSpec`. Frames must be
 * given in play order; each lands at `atMs / durationMs`, nudged
 * forward by an epsilon when it would collide with or precede its
 * predecessor. A frame at or beyond `durationMs` becomes the terminal
 * keyframe at offset 1 (later ones are dropped), and interior frames
 * pushed past the end are dropped rather than reordered.
 */
export function buildAnimationTrack(options: {
  durationMs: number;
  frames: readonly TrackFrameInput[];
  easing?: AnimationEasing;
  fill?: "none" | "both";
  iterations?: number | "infinite";
}): AnimationSpec {
  const { durationMs, frames, easing, fill, iterations } = options;
  const keyframes: AnimationKeyframe[] = [];
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const frame of frames) {
    const { atMs, ...channels } = frame;
    const rawAt = atMs / durationMs;
    if (rawAt >= 1) {
      if (lastAt < 1) {
        keyframes.push({ at: 1, ...channels });
        lastAt = 1;
      }
      continue;
    }
    const at = Math.max(Math.min(rawAt, TRACK_INTERIOR_MAX), lastAt + TRACK_EPSILON);
    if (at > TRACK_INTERIOR_MAX) {
      continue;
    }
    keyframes.push({ at: Math.max(at, 0), ...channels });
    lastAt = at;
  }
  return {
    keyframes,
    durationMs,
    ...(easing === undefined ? {} : { easing }),
    ...(fill === undefined ? {} : { fill }),
    ...(iterations === undefined ? {} : { iterations }),
  };
}
