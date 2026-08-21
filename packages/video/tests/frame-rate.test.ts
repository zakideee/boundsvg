import { FatalError } from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import {
  resolveVideoFrameRate,
  videoFrameDurationMicros,
  videoSampleTimeMs,
  videoTimestampMicros,
} from "../src/frame-rate.js";

const NTSC_30 = { numerator: 30000, denominator: 1001 };

describe("resolveVideoFrameRate", () => {
  it("keeps whole frame rates as integer rationals", () => {
    expect(resolveVideoFrameRate(30)).toEqual({ numerator: 30, denominator: 1 });
    expect(resolveVideoFrameRate(60)).toEqual({ numerator: 60, denominator: 1 });
  });

  it("maps the NTSC decimal aliases to their exact rational form", () => {
    expect(resolveVideoFrameRate(29.97)).toEqual(NTSC_30);
    expect(resolveVideoFrameRate(23.976)).toEqual({ numerator: 24000, denominator: 1001 });
    expect(resolveVideoFrameRate(59.94)).toEqual({ numerator: 60000, denominator: 1001 });
  });

  it("passes explicit rationals through", () => {
    expect(resolveVideoFrameRate(NTSC_30)).toEqual(NTSC_30);
  });

  it.each([0.5, 29.9, 24.5])("rejects the unlisted fractional rate %s", (value) => {
    expect(() => resolveVideoFrameRate(value)).toThrowError(FatalError);
    expect(() => resolveVideoFrameRate(value)).toThrowError(/not supported/);
  });

  it.each([0, -30, 130, Number.NaN])("rejects the out-of-range rate %s", (value) => {
    expect(() => resolveVideoFrameRate(value)).toThrowError(FatalError);
  });

  it("reports VIDEO_INVALID_FRAME_RATE", () => {
    try {
      resolveVideoFrameRate(29.9);
      expect.unreachable("expected a fatal error");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("VIDEO_INVALID_FRAME_RATE");
    }
  });

  it.each([
    { numerator: 0, denominator: 1 },
    { numerator: 30, denominator: 0 },
    { numerator: -30, denominator: 1 },
    { numerator: 30.5, denominator: 1 },
    // Both terms cross into the container as 32-bit values: this ratio is ~120
    // fps, but a truncated numerator would describe a completely different rate.
    { numerator: 4294997296, denominator: 35791644 },
  ])("rejects the malformed rational %o", (rate) => {
    expect(() => resolveVideoFrameRate(rate)).toThrowError(FatalError);
  });
});

describe("videoTimestampMicros", () => {
  it("stays exact after a full NTSC hour of frames", () => {
    // 30000 frames at 30000/1001 is exactly 1001 seconds; a drifting derivation
    // would miss it by milliseconds.
    expect(videoTimestampMicros(NTSC_30, 30000)).toBe(1_001_000_000);
  });

  it("advances by whole microseconds at integer rates", () => {
    const rate = { numerator: 30, denominator: 1 };
    expect(videoTimestampMicros(rate, 0)).toBe(0);
    expect(videoTimestampMicros(rate, 1)).toBe(33333);
    expect(videoTimestampMicros(rate, 30)).toBe(1_000_000);
  });
});

describe("videoFrameDurationMicros", () => {
  it("sums to the final timestamp across a long NTSC clip", () => {
    const frameCount = 3600;
    let total = 0;
    for (let index = 0; index < frameCount; index += 1) {
      total += videoFrameDurationMicros(NTSC_30, index);
    }
    expect(total).toBe(videoTimestampMicros(NTSC_30, frameCount));
  });

  it("alternates between neighbouring durations instead of drifting", () => {
    const durations = new Set(
      Array.from({ length: 12 }, (_unused, index) => videoFrameDurationMicros(NTSC_30, index)),
    );
    expect([...durations].sort((left, right) => left - right)).toEqual([33366, 33367]);
  });
});

describe("videoSampleTimeMs", () => {
  it("returns the exact rational sample time", () => {
    expect(videoSampleTimeMs({ numerator: 30, denominator: 1 }, 3)).toBe(100);
    expect(videoSampleTimeMs(NTSC_30, 30000)).toBe(1_001_000);
  });
});
