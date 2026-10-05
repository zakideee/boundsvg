import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  type AnimationScheduleOptions,
  createAnimationScheduleCursor,
  createGifDelayCursor,
  getAnimationScheduleEntry,
  resolveAnimationScheduleDescriptor,
} from "../../src/animation-schedule.js";
import { FatalError } from "../../src/errors.js";

/** Fixed GIF diagnostic identity used by the schedule cursor and duration oracle. */
const context = { format: "gif", invalidSchedule: "ANIMATED_GIF_INVALID_SCHEDULE" } as const;

/** Materialize the old algorithm only in the oracle, independently of the cursor. */
function legacySampledEntries(fps: number, durationMs: number) {
  const frameCount = Math.max(2, Math.ceil((durationMs * fps) / 1000));
  const totalMs = Math.max(frameCount, Math.round(durationMs));
  const boundaries = Array.from({ length: frameCount + 1 }, (_, index) =>
    index >= frameCount
      ? totalMs
      : Math.min(Math.round((index * 1000) / fps), totalMs - (frameCount - index)),
  );
  return Array.from({ length: frameCount }, (_, index) => ({
    index,
    timeMs: Math.min((index * 1000) / fps, durationMs),
    durationMs: boundaries[index + 1]! - boundaries[index]!,
  }));
}

describe("animation schedule cursors", () => {
  it("preserves the old sample times and integer boundaries, including fractional FPS", () => {
    for (const fps of [1, 8, 20, 29.97, 59.94, 60]) {
      for (const durationMs of [
        Number.MIN_VALUE,
        0.1,
        1,
        16.666666666666664,
        16.666666666666668,
        33.5,
        1000,
        4999.999,
      ]) {
        const descriptor = resolveAnimationScheduleDescriptor({ fps, durationMs }, context);
        const cursor = createAnimationScheduleCursor(descriptor, context);
        for (const expected of legacySampledEntries(fps, durationMs)) {
          expect(cursor.next()).toEqual({ done: false, value: expected });
        }
        expect(cursor.next()).toEqual({ done: true, value: undefined });
      }
    }
  });

  it("represents a billion sampled frames without retaining schedule arrays", () => {
    const descriptor = resolveAnimationScheduleDescriptor(
      { fps: 60, durationMs: (1_000_000_000 * 1000) / 60 },
      context,
    );
    expect(descriptor.kind).toBe("sampled");
    expect(Object.values(descriptor).some(Array.isArray)).toBe(false);
    expect(descriptor.frameCount).toBe(1_000_000_000);
    expect(
      getAnimationScheduleEntry(descriptor, descriptor.frameCount - 1, context).durationMs,
    ).toBeGreaterThanOrEqual(1);
    const cursor = createAnimationScheduleCursor(descriptor, context);
    expect(cursor.next().done).toBe(false);
    cursor.return();
    expect(cursor.next().done).toBe(true);
  });

  it("keeps independent scan and render cursors over explicit snapshots", () => {
    const descriptor = resolveAnimationScheduleDescriptor(
      { timesMs: [9, 0, 9], frameDurationsMs: [1, 25, 60_000] },
      context,
    );
    const scan = createAnimationScheduleCursor(descriptor, context);
    const render = createAnimationScheduleCursor(descriptor, context);
    expect(scan.next().value).toEqual({ index: 0, timeMs: 9, durationMs: 1 });
    scan.return();
    expect(render.next().value).toEqual({ index: 0, timeMs: 9, durationMs: 1 });
    expect(render.next().value).toEqual({ index: 1, timeMs: 0, durationMs: 25 });
    expect(render.next().value).toEqual({ index: 2, timeMs: 9, durationMs: 60_000 });
    expect(render.next().done).toBe(true);
  });

  it("accepts real cross-realm arrays and rejects null, coercion and other iterables", () => {
    const crossRealm = runInNewContext(
      "({timesMs:[0],frameDurationsMs:[20]})",
    ) as AnimationScheduleOptions;
    expect(resolveAnimationScheduleDescriptor(crossRealm, context).frameCount).toBe(1);
    const invalid = [
      { fps: null, durationMs: 1 },
      { fps: "20", durationMs: 1 },
      { timesMs: null, durationMs: 1 },
      { timesMs: 0, durationMs: 1 },
      { timesMs: new Float64Array([0]), frameDurationsMs: [20] },
      { timesMs: [0], frameDurationsMs: null },
      { durationMs: 1, frameDurationsMs: null },
    ];
    for (const options of invalid) {
      expect(() =>
        resolveAnimationScheduleDescriptor(options as unknown as AnimationScheduleOptions, context),
      ).toThrow(FatalError);
    }
  });

  it("reports a late malformed entry and closes only that cursor", () => {
    const descriptor = resolveAnimationScheduleDescriptor(
      { timesMs: [0, 1, Number.NaN], frameDurationsMs: [20, 20, 20] },
      context,
    );
    const cursor = createAnimationScheduleCursor(descriptor, context);
    cursor.next();
    cursor.next();
    expect(() => cursor.next()).toThrow(FatalError);
    expect(cursor.next().done).toBe(true);
  });

  it("rejects unsafe derived indices before materialization", () => {
    for (const durationMs of [Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        resolveAnimationScheduleDescriptor({ fps: 1, durationMs }, context),
      ).toThrowError(expect.objectContaining({ code: "ANIMATED_RASTER_NUMERIC_UNREPRESENTABLE" }));
    }
  });
});

describe("GIF delay remainder", () => {
  it("matches cumulative half-up rounding and the browser floor across residue boundaries", () => {
    const durations = [1, 4, 5, 9, 10, 24, 25, 33, 34, 60_000];
    for (const prefixMs of [0, 1, 4, 5, 9]) {
      const cursor = createGifDelayCursor();
      let elapsedMs = prefixMs;
      let previousCs = Math.floor((prefixMs + 5) / 10);
      if (prefixMs > 0) {
        cursor.next(prefixMs);
      }
      for (let iteration = 0; iteration < 100; iteration++) {
        for (const durationMs of durations) {
          elapsedMs += durationMs;
          const boundaryCs = Math.floor((elapsedMs + 5) / 10);
          expect(cursor.next(durationMs)).toBe(Math.max(2, boundaryCs - previousCs));
          previousCs = boundaryCs;
        }
      }
    }
  });
});
