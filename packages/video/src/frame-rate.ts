import { FatalError } from "@boundsvg/core";

/** Rational frame rate. 29.97fps is `{ numerator: 30000, denominator: 1001 }`. */
export type VideoFrameRate = {
  numerator: number;
  denominator: number;
};

/**
 * Decimal frame rates accepted as a plain `number`.
 *
 * NTSC rates are irrational as decimals, so only their exact rational form is
 * used internally; any other fractional input is rejected rather than rounded.
 */
const FRACTIONAL_FRAME_RATE_ALIASES: ReadonlyMap<number, VideoFrameRate> = new Map([
  [23.976, { numerator: 24000, denominator: 1001 }],
  [29.97, { numerator: 30000, denominator: 1001 }],
  [59.94, { numerator: 60000, denominator: 1001 }],
]);

/** Highest effective frame rate an export may request. */
const FRAME_RATE_MAX = 120;

/** Largest numerator or denominator, kept inside the container's 32-bit fields. */
const FRAME_RATE_TERM_MAX = 1_000_000;

/** Microseconds per second, the unit WebCodecs timestamps use. */
const MICROS_PER_SECOND = 1_000_000;

/** Milliseconds per second, the unit the frame sampler uses. */
const MILLIS_PER_SECOND = 1000;

/**
 * Normalize a frame rate to its rational form.
 *
 * Accepts a positive integer, one of the NTSC decimal aliases, or an explicit
 * `{ numerator, denominator }` pair.
 */
export function resolveVideoFrameRate(value: number | VideoFrameRate): VideoFrameRate {
  const rate =
    typeof value === "number" ? resolveNumericFrameRate(value) : validateRationalRate(value);
  const effectiveFrameRate = rate.numerator / rate.denominator;
  if (effectiveFrameRate <= 0 || effectiveFrameRate > FRAME_RATE_MAX) {
    throw invalidFrameRate(
      `frame rate must be greater than 0 and at most ${FRAME_RATE_MAX} fps (got ${effectiveFrameRate})`,
      value,
    );
  }
  return rate;
}

function resolveNumericFrameRate(value: number): VideoFrameRate {
  const alias = FRACTIONAL_FRAME_RATE_ALIASES.get(value);
  if (alias) {
    // Copied: the resolved rate reaches user code, and the table is shared.
    return { ...alias };
  }
  if (!Number.isInteger(value)) {
    const supported = [...FRACTIONAL_FRAME_RATE_ALIASES.keys()].join(", ");
    throw invalidFrameRate(
      `fractional frame rate ${value} is not supported; use an integer, one of ${supported}, or a { numerator, denominator } pair`,
      value,
    );
  }
  return { numerator: value, denominator: 1 };
}

function validateRationalRate(value: VideoFrameRate): VideoFrameRate {
  const { numerator, denominator } = value;
  if (!isRateTerm(numerator) || !isRateTerm(denominator)) {
    throw invalidFrameRate(
      `frame rate numerator and denominator must both be whole numbers in 1..${FRAME_RATE_TERM_MAX} (got ${numerator}/${denominator})`,
      value,
    );
  }
  return { numerator, denominator };
}

/**
 * Both terms cross into the container as 32-bit values, so an out-of-range one
 * would be truncated there and describe a different rate than was validated.
 */
function isRateTerm(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= FRAME_RATE_TERM_MAX;
}

function invalidFrameRate(message: string, frameRate: number | VideoFrameRate): FatalError {
  return new FatalError("VIDEO_INVALID_FRAME_RATE", message, { frameRate });
}

/**
 * Presentation timestamp of a frame, in microseconds.
 *
 * Every frame is rounded independently from the exact rational time so the
 * error never exceeds half a microsecond, whatever the frame index.
 */
export function videoTimestampMicros(rate: VideoFrameRate, frameIndex: number): number {
  return Math.round((frameIndex * MICROS_PER_SECOND * rate.denominator) / rate.numerator);
}

/**
 * Duration of a frame, in microseconds.
 *
 * Taken as the gap to the next timestamp — never as a fixed per-frame value —
 * because accumulating a rounded duration drifts on rates such as 30000/1001.
 */
export function videoFrameDurationMicros(rate: VideoFrameRate, frameIndex: number): number {
  return videoTimestampMicros(rate, frameIndex + 1) - videoTimestampMicros(rate, frameIndex);
}

/** Sampling time of a frame, in milliseconds, for the deterministic frame sampler. */
export function videoSampleTimeMs(rate: VideoFrameRate, frameIndex: number): number {
  return (frameIndex * MILLIS_PER_SECOND * rate.denominator) / rate.numerator;
}
