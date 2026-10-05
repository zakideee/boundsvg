import { describe, expect, it, vi } from "vitest";
import {
  animatedRasterFailure,
  animatedRasterSinkFailure,
  decodeAnimatedRasterFatal,
} from "../../src/animation-errors.js";
import {
  assertAnimatedRasterSink,
  createAnimatedRasterCollector,
  createAnimatedWebpSpoolSink,
} from "../../src/animation-output.js";
import { FatalError } from "../../src/errors.js";

describe("explicit animation output", () => {
  it.each([
    undefined,
    null,
    {},
  ])("keeps WebP diagnostics for malformed sequential spool destinations: %j", (destination) => {
    const spool = {
      sink: { write: vi.fn(), patch: vi.fn(), finish: vi.fn(), abort: vi.fn() },
      read: vi.fn(),
      dispose: vi.fn(),
    };
    const rejectDestination = () =>
      createAnimatedWebpSpoolSink(
        spool,
        destination as unknown as Parameters<typeof createAnimatedWebpSpoolSink>[1],
      );
    expect(rejectDestination).toThrow(FatalError);
    try {
      rejectDestination();
    } catch (error) {
      expect(error).toMatchObject({
        context: {
          format: "webp",
          operation: "open",
          field: "sink",
          reason:
            destination === undefined
              ? "missingField"
              : destination === null
                ? "nullField"
                : "wrongType",
        },
      });
    }
    expect(spool.sink.abort).not.toHaveBeenCalled();
    expect(spool.dispose).not.toHaveBeenCalled();
  });

  it("requires patch only for positional destinations", () => {
    const destination = { write: vi.fn(), finish: vi.fn(), abort: vi.fn() };
    expect(() =>
      assertAnimatedRasterSink(destination, { format: "webp", shouldRequirePatch: true }),
    ).toThrow(/wrongType/);
    expect(() =>
      assertAnimatedRasterSink(destination, { format: "gif", shouldRequirePatch: false }),
    ).not.toThrow();
    expect(() =>
      assertAnimatedRasterSink(destination, { format: "webp", shouldRequirePatch: false }),
    ).not.toThrow();
  });
  it("patches received bytes and transfers its spare-capacity view once", () => {
    const collector = createAnimatedRasterCollector();
    expect(() => collector.takeBytes()).toThrow(/collectorNotFinished/);
    collector.write(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]));
    collector.patch(4, Uint8Array.from([4, 0, 0, 0]));
    collector.finish();
    const output = collector.takeBytes();
    expect([...output]).toEqual([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    expect(output.buffer.byteLength).toBeGreaterThan(output.byteLength);
    collector.abort("late cleanup");
    expect(output[0]).toBe(82);
    expect(() => collector.takeBytes()).toThrow(/collectorConsumed/);
    expect(() => collector.write(Uint8Array.of(1))).toThrow(/collectorConsumed/);
  });

  it("rejects an over-limit write before copying or allocating output", () => {
    const collector = createAnimatedRasterCollector();
    expect(() => collector.write(new Uint8Array(256 * 1024 * 1024 + 1))).toThrow(/collectorLimit/);
    collector.abort("failed write");
    collector.abort("repeat");
    expect(() => collector.finish()).toThrow(/aborted/);
  });

  it("rejects an out-of-range patch and cannot subsequently finish", () => {
    const collector = createAnimatedRasterCollector();
    collector.write(Uint8Array.of(1, 2, 3));
    expect(() => collector.patch(4, Uint8Array.of(1, 2, 3, 4))).toThrow(/outOfDomain/);
    expect(() => collector.finish()).toThrow(/outOfDomain/);
  });

  it("forwards a finished spool one bounded read at a time and cleans once", async () => {
    const events: string[] = [];
    const sink = {
      write: vi.fn(),
      patch: vi.fn(),
      finish: vi.fn(() => {
        events.push("spool-finish");
      }),
      abort: vi.fn(),
    };
    const destination = {
      write: vi.fn(async (chunk: Uint8Array) => {
        events.push(`write:${chunk.length}`);
      }),
      finish: vi.fn(() => {
        events.push("destination-finish");
      }),
      abort: vi.fn(),
    };
    const dispose = vi.fn(async () => {
      events.push("dispose");
    });
    const read = vi.fn(async (offset: number, length: number) => {
      expect(length).toBe(65536);
      events.push(`read:${offset}`);
      return offset === 0 ? Uint8Array.of(1, 2, 3) : new Uint8Array(0);
    });
    const forward = createAnimatedWebpSpoolSink({ sink, read, dispose }, destination);
    forward.write(Uint8Array.of(1));
    forward.patch(4, Uint8Array.of(1, 2, 3, 4));
    await forward.finish();
    await forward.abort("late cleanup");
    expect(events).toEqual([
      "spool-finish",
      "read:0",
      "write:3",
      "read:3",
      "destination-finish",
      "dispose",
    ]);
    expect(sink.patch).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(destination.abort).not.toHaveBeenCalled();
  });

  it("wraps foreign callback diagnostics and retains only validated sink errors", () => {
    const allowed = animatedRasterFailure("gif", "write", {
      family: "SINK_FAILED",
      reason: "write",
      field: "sink",
    });
    const storage = new Error("injected storage permission failure");
    Object.defineProperty(allowed, "cause", { value: storage });
    expect(animatedRasterSinkFailure("gif", "write", allowed)).toBe(allowed);
    expect(Reflect.get(animatedRasterSinkFailure("gif", "write", allowed), "cause")).toBe(storage);
    const foreign = new FatalError("ENGINE_DISPOSED", "foreign failure", { stage: "engine" });
    const wrapped = animatedRasterSinkFailure("gif", "write", foreign);
    expect(wrapped.code).toBe("ANIMATED_RASTER_SINK_FAILED");
    expect(Reflect.get(wrapped, "cause")).toBe(foreign);
    vi.spyOn(foreign, "toJSON").mockReturnValue(allowed.toJSON());
    expect(Reflect.get(animatedRasterSinkFailure("gif", "write", foreign), "cause")).toBe(foreign);
    const bad = allowed.toJSON();
    if (bad.context) {
      bad.context.extra = true;
    }
    expect(decodeAnimatedRasterFatal(bad)).toBeUndefined();
  });

  it("does not repatch WebP output or accept a patch on GIF", () => {
    const collector = createAnimatedRasterCollector();
    collector.write(new Uint8Array(12));
    collector.patch(4, Uint8Array.of(4, 0, 0, 0));
    expect(() => collector.patch(4, Uint8Array.of(5, 0, 0, 0))).toThrow(/outOfDomain/);
    const gif = createAnimatedRasterCollector();
    gif.write(Uint8Array.from([71, 73, 70, 56, 57, 97, 0, 0]));
    expect(() => gif.patch(4, Uint8Array.of(1, 2, 3, 4))).toThrow(/outOfDomain/);
  });

  it("retries spool cleanup after commit without aborting the completed destination", async () => {
    const disposal = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary cleanup"))
      .mockResolvedValue(undefined);
    const destination = { write: vi.fn(), finish: vi.fn(), abort: vi.fn() };
    const spool = {
      sink: { write: vi.fn(), patch: vi.fn(), finish: vi.fn(), abort: vi.fn() },
      read: vi.fn(async () => new Uint8Array(0)),
      dispose: disposal,
    };
    const forward = createAnimatedWebpSpoolSink(spool, destination);
    await expect(forward.finish()).rejects.toMatchObject({ code: "ANIMATED_RASTER_SINK_FAILED" });
    await forward.abort("cleanup retry");
    expect(disposal).toHaveBeenCalledTimes(2);
    expect(destination.finish).toHaveBeenCalledOnce();
    expect(destination.abort).not.toHaveBeenCalled();
    expect(spool.sink.abort).not.toHaveBeenCalled();
  });
});
