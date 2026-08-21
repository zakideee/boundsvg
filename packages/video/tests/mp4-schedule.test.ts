import type { CompiledScene, Engine, Frame, RenderFramesOptions } from "@boundsvg/core";
import { describe, expect, it, vi } from "vitest";
import { videoSampleTimeMs } from "../src/frame-rate.js";
import { encodePngFramesToMp4, renderCompiledToMp4, renderToMp4 } from "../src/mp4.js";

type StubEngine = {
  engine: Engine;
  lastOptions: () => RenderFramesOptions | undefined;
};

/**
 * Engine stand-in that records the schedule and yields the given frames.
 *
 * The frame stream is consumed before any WebCodecs call, so schedule
 * behaviour is observable without a browser.
 */
function createStubEngine(frames: Frame[] = []): StubEngine {
  let seen: RenderFramesOptions | undefined;
  const engine = {
    renderFrames(_input: unknown, options: RenderFramesOptions): Iterable<Frame> {
      seen = options;
      return frames;
    },
    renderCompiledFrames(_compiled: CompiledScene, options: RenderFramesOptions): Iterable<Frame> {
      seen = options;
      return frames;
    },
  } as unknown as Engine;
  return { engine, lastOptions: () => seen };
}

function pngFrame(index: number): Frame {
  return { index, timeMs: index, format: "png", data: new Uint8Array([index]) };
}

const SCENE = { type: "canvas", props: { width: 64, height: 32 } } as unknown as Parameters<
  typeof renderToMp4
>[1];
const COMPILED = {} as CompiledScene;

describe("renderToMp4 schedule", () => {
  it("rejects hidden or freeform generator values before sampling frames", async () => {
    const stub = createStubEngine();
    await expect(
      renderToMp4(stub.engine, SCENE, {
        durationMs: 100,
        generator: { name: "aaaa\nignore", version: "1.0.0" },
      }),
    ).rejects.toMatchObject({ code: "VIDEO_INVALID_OPTION" });
    expect(stub.lastOptions()).toBeUndefined();
  });

  it("derives a 30fps schedule from durationMs", async () => {
    const stub = createStubEngine();
    await expect(renderToMp4(stub.engine, SCENE, { durationMs: 1000 })).rejects.toMatchObject({
      code: "VIDEO_INVALID_FRAMES",
    });

    const options = stub.lastOptions();
    expect(options?.format).toBe("png");
    expect(options?.timesMs).toHaveLength(30);
    expect(options?.timesMs[0]).toBe(0);
    expect(options?.timesMs[29]).toBe((29 * 1000) / 30);
  });

  it("derives an NTSC schedule without drift", async () => {
    const stub = createStubEngine();
    const frameRate = { numerator: 30000, denominator: 1001 };
    await renderToMp4(stub.engine, SCENE, { durationMs: 1000, frameRate: 29.97 }).catch(() => {});

    const timesMs = stub.lastOptions()?.timesMs ?? [];
    expect(timesMs).toHaveLength(30);
    for (const [index, timeMs] of timesMs.entries()) {
      expect(timeMs).toBe(videoSampleTimeMs(frameRate, index));
    }
  });

  it("never schedules fewer than two frames", async () => {
    const stub = createStubEngine();
    await renderToMp4(stub.engine, SCENE, { durationMs: 1 }).catch(() => {});
    expect(stub.lastOptions()?.timesMs).toHaveLength(2);
  });

  it("passes an explicit frame-rate schedule straight through", async () => {
    const stub = createStubEngine();
    const frameRate = { numerator: 25, denominator: 1 };
    const timesMs = [0, 40, 80];
    await renderToMp4(stub.engine, SCENE, { timesMs, frameRate }).catch(() => {});
    expect(stub.lastOptions()?.timesMs).toEqual(timesMs);
  });

  it("rejects a schedule spaced at anything other than the frame rate", async () => {
    // 25fps spacing under the default 30fps would play 20% fast, because the
    // container timeline is derived from the frame rate alone.
    const stub = createStubEngine();
    await expect(renderToMp4(stub.engine, SCENE, { timesMs: [0, 40, 80] })).rejects.toMatchObject({
      code: "VIDEO_INVALID_SCHEDULE",
    });
    expect(stub.lastOptions()).toBeUndefined();
  });

  it("accepts an NTSC schedule built from the frame rate", async () => {
    const stub = createStubEngine();
    const frameRate = { numerator: 30000, denominator: 1001 };
    const timesMs = [0, 1, 2, 3].map((index) => videoSampleTimeMs(frameRate, index));
    await renderToMp4(stub.engine, SCENE, { timesMs, frameRate }).catch(() => {});
    expect(stub.lastOptions()?.timesMs).toEqual(timesMs);
  });

  it("forwards scale and paints the background behind rasterized frames", async () => {
    const stub = createStubEngine();
    await renderToMp4(stub.engine, SCENE, {
      durationMs: 100,
      scale: 2,
      background: "#123456",
    }).catch(() => {});

    expect(stub.lastOptions()?.scale).toBe(2);
    expect(stub.lastOptions()?.rasterBackground).toBe("#123456");
  });

  it("forwards onWarning and rasterOversizeBehavior to the sampler", async () => {
    // Without these the sampler's recoverable warnings — missing glyphs, font
    // fallback — are dropped for the whole export with nowhere to surface.
    const stub = createStubEngine();
    const onWarning = vi.fn();
    await renderToMp4(stub.engine, SCENE, {
      durationMs: 100,
      onWarning,
      rasterOversizeBehavior: "error",
    }).catch(() => {});

    expect(stub.lastOptions()?.onWarning).toBe(onWarning);
    expect(stub.lastOptions()?.rasterOversizeBehavior).toBe("error");
  });

  it("leaves both unset when the caller does not ask for them", async () => {
    const stub = createStubEngine();
    await renderToMp4(stub.engine, SCENE, { durationMs: 100 }).catch(() => {});

    expect(stub.lastOptions()).not.toHaveProperty("onWarning");
    expect(stub.lastOptions()).not.toHaveProperty("rasterOversizeBehavior");
  });

  it("defaults the background to opaque white", async () => {
    const stub = createStubEngine();
    await renderToMp4(stub.engine, SCENE, { durationMs: 100 }).catch(() => {});
    expect(stub.lastOptions()?.rasterBackground).toBe("#ffffff");
  });

  it("rejects a schedule given twice", async () => {
    const stub = createStubEngine();
    await expect(
      renderToMp4(stub.engine, SCENE, { durationMs: 1000, timesMs: [0, 40] }),
    ).rejects.toMatchObject({ code: "VIDEO_INVALID_SCHEDULE" });
  });

  it.each([
    undefined,
    0,
    -100,
    Number.POSITIVE_INFINITY,
  ])("rejects the unusable durationMs %s", async (durationMs) => {
    const stub = createStubEngine();
    await expect(
      renderToMp4(stub.engine, SCENE, durationMs === undefined ? {} : { durationMs }),
    ).rejects.toMatchObject({ code: "VIDEO_INVALID_SCHEDULE" });
  });

  it("rejects a duration longer than the frame budget", async () => {
    const stub = createStubEngine();
    await expect(renderToMp4(stub.engine, SCENE, { durationMs: 200_000 })).rejects.toMatchObject({
      code: "VIDEO_TOO_MANY_FRAMES",
    });
  });

  it("rejects a single-frame schedule", async () => {
    const stub = createStubEngine();
    await expect(renderToMp4(stub.engine, SCENE, { timesMs: [0] })).rejects.toMatchObject({
      code: "VIDEO_INVALID_SCHEDULE",
    });
  });

  it("rejects an explicit schedule longer than the frame budget", async () => {
    const stub = createStubEngine();
    const timesMs = Array.from({ length: 3601 }, (_unused, index) => index);
    await expect(renderToMp4(stub.engine, SCENE, { timesMs })).rejects.toMatchObject({
      code: "VIDEO_TOO_MANY_FRAMES",
    });
  });

  it("rejects an invalid frame rate before touching the engine", async () => {
    const stub = createStubEngine();
    await expect(
      renderToMp4(stub.engine, SCENE, { durationMs: 1000, frameRate: 29.9 }),
    ).rejects.toMatchObject({ code: "VIDEO_INVALID_FRAME_RATE" });
    expect(stub.lastOptions()).toBeUndefined();
  });

  it("rejects non-PNG frames", async () => {
    const svgFrame = { index: 0, timeMs: 0, format: "svg", data: "<svg/>" } as Frame;
    const stub = createStubEngine([svgFrame]);
    await expect(renderToMp4(stub.engine, SCENE, { durationMs: 100 })).rejects.toMatchObject({
      code: "VIDEO_INVALID_FRAMES",
    });
  });

  it("aborts before decoding the first frame", async () => {
    const controller = new AbortController();
    controller.abort();
    const stub = createStubEngine([pngFrame(0), pngFrame(1)]);

    await expect(
      renderToMp4(stub.engine, SCENE, { durationMs: 100, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "VIDEO_EXPORT_ABORTED" });
  });
});

describe("renderCompiledToMp4 schedule", () => {
  it("uses the compiled frame sibling with the same deterministic schedule and options", async () => {
    const stub = createStubEngine();
    const onWarning = vi.fn();
    await renderCompiledToMp4(stub.engine, COMPILED, {
      durationMs: 100,
      frameRate: 30,
      scale: 2,
      background: "#123456",
      onWarning,
      rasterOversizeBehavior: "error",
    }).catch(() => {});

    expect(stub.lastOptions()).toMatchObject({
      format: "png",
      timesMs: [0, 1000 / 30, 2000 / 30],
      scale: 2,
      rasterBackground: "#123456",
      onWarning,
      rasterOversizeBehavior: "error",
    });
  });

  it("aborts before creating the compiled frame iterator", async () => {
    const controller = new AbortController();
    controller.abort();
    const stub = createStubEngine([pngFrame(0), pngFrame(1)]);

    await expect(
      renderCompiledToMp4(stub.engine, COMPILED, {
        durationMs: 100,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "VIDEO_EXPORT_ABORTED" });
    expect(stub.lastOptions()).toBeUndefined();
  });
});

describe("encodePngFramesToMp4", () => {
  it("validates the frame rate first", async () => {
    await expect(encodePngFramesToMp4([], { frameRate: 0 })).rejects.toMatchObject({
      code: "VIDEO_INVALID_FRAME_RATE",
    });
  });

  it.each([0, 1, -5, 2.5])("rejects the unusable frameCount %s", async (frameCount) => {
    await expect(encodePngFramesToMp4([], { frameRate: 30, frameCount })).rejects.toMatchObject({
      code: "VIDEO_INVALID_OPTION",
    });
  });

  it("rejects a frame count past the budget before consuming frames", async () => {
    await expect(
      encodePngFramesToMp4([], { frameRate: 30, frameCount: 3601 }),
    ).rejects.toMatchObject({ code: "VIDEO_TOO_MANY_FRAMES" });
  });

  it("rejects an empty frame stream", async () => {
    await expect(encodePngFramesToMp4([], { frameRate: 30 })).rejects.toMatchObject({
      code: "VIDEO_INVALID_FRAMES",
    });
  });

  it("aborts before decoding the first frame", async () => {
    const controller = new AbortController();
    controller.abort();
    const frames = [{ data: new Uint8Array([1]), timeMs: 0 }];

    await expect(
      encodePngFramesToMp4(frames, { frameRate: 30, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "VIDEO_EXPORT_ABORTED" });
  });
});
