/**
 * Rational frame rate for MP4 export.
 *
 * Deliberately duplicated rather than shared with `@boundsvg/video`: that
 * package is browser-only and the CLI must not depend on it. The spec is the
 * one thing both sides agree on, so it is stated the same way in both.
 */
export type CliFrameRate = {
  numerator: number;
  denominator: number;
};

/**
 * Decimal spellings of the NTSC rates, mapped to the rationals they stand for.
 *
 * Accepting them as plain decimals would make a 29.97fps export drift, since
 * the true rate is 30000/1001 and no decimal expresses it.
 */
const NTSC_ALIASES: ReadonlyMap<number, CliFrameRate> = new Map([
  [23.976, { numerator: 24000, denominator: 1001 }],
  [29.97, { numerator: 30000, denominator: 1001 }],
  [59.94, { numerator: 60000, denominator: 1001 }],
]);

/** Highest effective rate accepted, matching the browser exporter. */
const FRAME_RATE_MAX = 120;

/**
 * Highest value either term may take, matching the browser exporter.
 *
 * Both terms cross into a container field that holds a 32-bit value, so a
 * ratio that reduces correctly is still not one the container can carry.
 */
const FRAME_RATE_TERM_MAX = 1_000_000;

/**
 * Parse a `--fps` value into a rational rate, or return null when it is not one.
 *
 * Accepts a positive integer, one of the NTSC decimal aliases, or an explicit
 * `numerator/denominator`. Any other decimal is refused rather than
 * approximated: the container carries one tick per frame, so a rate it cannot
 * express exactly would play at a different speed than it sampled.
 */
export function parseCliFrameRate(value: string): CliFrameRate | null {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash !== -1) {
    const numerator = Number(trimmed.slice(0, slash));
    const denominator = Number(trimmed.slice(slash + 1));
    return isPositiveInteger(numerator) && isPositiveInteger(denominator)
      ? withinRange({ numerator, denominator })
      : null;
  }

  const numeric = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (Number.isInteger(numeric)) {
    return withinRange({ numerator: numeric, denominator: 1 });
  }
  const alias = NTSC_ALIASES.get(numeric);
  return alias ? withinRange(alias) : null;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= FRAME_RATE_TERM_MAX;
}

function withinRange(rate: CliFrameRate): CliFrameRate | null {
  return rate.numerator / rate.denominator <= FRAME_RATE_MAX ? rate : null;
}

/** The `--fps` spellings accepted for MP4, for a usage message. */
export const CLI_FRAME_RATE_HELP = `a whole number, 23.976 / 29.97 / 59.94, or a rational such as 30000/1001, up to ${FRAME_RATE_MAX}fps`;
