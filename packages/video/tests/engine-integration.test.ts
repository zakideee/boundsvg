import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  CompiledScene,
  Engine,
  EngineInput,
  Frame,
  RenderFramesOptions,
} from "@boundsvg/core";
import { createElement, createEngineAsync } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPortableLayoutTransitionInput,
  PORTABLE_LAYOUT_TRANSITION_CANVAS,
} from "../../core/tests/animation/fixtures/layout-transition.js";
import { videoFrameDurationMicros, videoTimestampMicros } from "../src/frame-rate.js";
import { renderCompiledToMp4, renderToMp4 } from "../src/mp4.js";
import { initVideoWasm } from "../src/mp4-writer.js";

/**
 * The one suite that puts a real `Engine` behind `renderToMp4`.
 *
 * Everywhere else `renderFrames` is stubbed, so nothing pins the core contract
 * this package is built on: that a fractional NTSC schedule is accepted, that
 * the option names are the ones core actually reads, that the rasterized PNG is
 * the size the canvas gets sized from, and that sampling really varies with
 * time. A core-side change to any of those would otherwise land silently.
 *
 * WebCodecs itself stays stubbed — Node has no encoder — but the muxer wasm is
 * the real one, so the file that comes out is a real MP4.
 *
 * Prerequisite: built core WASM (`pnpm build:wasm`) and muxer wasm
 * (`pnpm build:wasm:mp4`).
 */

const NTSC_30 = { numerator: 30000, denominator: 1001 };
const SCENE_WIDTH = 61;
const SCENE_HEIGHT = 33;
const FONT_ALIAS = "NotoSansJP";

/** Minimal avcC record: High profile, level 4.0, four-byte NAL lengths. */
const CODEC_DESCRIPTION = new Uint8Array([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28, 0x01, 0x00, 0x03, 0x68,
  0xee, 0x3c,
]);

type StubState = {
  canvasSizes: Array<{ width: number; height: number }>;
  decodedSizes: Array<{ width: number; height: number }>;
  /** Hex digest of each decoded PNG, so frames can be compared without storing them. */
  frameDigests: string[];
  videoFrameInits: Array<{ timestamp: number; duration: number | undefined }>;
  onVideoFrame?: () => void;
};

let state: StubState;
let engine: Engine;

/** Width and height an actual PNG declares, read from its IHDR chunk. */
function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 8-byte signature, then the IHDR length/type, then width and height.
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Stub the browser surface `renderToMp4` needs, decoding real PNG headers.
 *
 * Sizes come from the frames themselves rather than a fixed constant, so the
 * canvas padding is exercised against whatever core actually rasterized.
 */
function installBrowserStubs(): void {
  class FakeImageBitmap {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    close(): void {}
  }

  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      state.canvasSizes.push({ width, height });
    }
    getContext(): unknown {
      let fillStyle = "#000000";
      return {
        get fillStyle() {
          return fillStyle;
        },
        set fillStyle(value: string) {
          if (/^#[0-9a-f]{6}$/i.test(value)) {
            fillStyle = value.toLowerCase();
          }
        },
        fillRect: () => {},
        drawImage: () => {},
      };
    }
  }

  class FakeVideoFrame {
    constructor(
      _source: unknown,
      readonly init: VideoFrameInit,
    ) {
      state.videoFrameInits.push({ timestamp: init.timestamp, duration: init.duration });
      state.onVideoFrame?.();
    }
    close(): void {}
  }

  class FakeVideoEncoder {
    readonly encodeQueueSize = 0;
    private emitted = 0;
    constructor(private readonly init: VideoEncoderInit) {}
    static isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
      return Promise.resolve({ supported: true, config });
    }
    configure(): void {}
    encode(_frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
      const isKey = options?.keyFrame === true;
      this.init.output(
        {
          byteLength: 4,
          timestamp: this.emitted,
          type: isKey ? "key" : "delta",
          copyTo: (target: Uint8Array) => target.set([1, 2, 3, 4]),
        } as unknown as EncodedVideoChunk,
        this.emitted === 0
          ? { decoderConfig: { description: CODEC_DESCRIPTION } as VideoDecoderConfig }
          : undefined,
      );
      this.emitted += 1;
    }
    flush(): Promise<void> {
      return Promise.resolve();
    }
    close(): void {}
  }

  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const size = readPngSize(bytes);
    state.decodedSizes.push(size);
    state.frameDigests.push(createHash("sha256").update(bytes).digest("hex"));
    return new FakeImageBitmap(size.width, size.height);
  });
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
  vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
}

/** Records the options core is handed, then renders with the real engine. */
function observing(target: Engine): {
  engine: Engine;
  lastOptions: () => RenderFramesOptions | undefined;
} {
  let seen: RenderFramesOptions | undefined;
  const observer = {
    ...target,
    renderFrames(input: EngineInput, options: RenderFramesOptions): Iterable<Frame> {
      seen = options;
      return target.renderFrames(input, options);
    },
  } as unknown as Engine;
  return { engine: observer, lastOptions: () => seen };
}

/** Records and lifecycle-wraps the compiled frame producer used by MP4. */
function observingCompiled(target: Engine): {
  engine: Engine;
  lastOptions: () => RenderFramesOptions | undefined;
  cleanupCount: () => number;
} {
  let seen: RenderFramesOptions | undefined;
  let cleanups = 0;
  const observer = {
    renderCompiledFrames(compiled: CompiledScene, options: RenderFramesOptions): Iterable<Frame> {
      seen = options;
      const frames = target.renderCompiledFrames(compiled, options);
      return (function* observedFrames() {
        try {
          yield* frames;
        } finally {
          cleanups += 1;
        }
      })();
    },
  } as unknown as Engine;
  return { engine: observer, lastOptions: () => seen, cleanupCount: () => cleanups };
}

function scene(text: string, animate = false): EngineInput {
  return createElement(
    "Canvas",
    { id: "video-canvas", width: SCENE_WIDTH, height: SCENE_HEIGHT, background: "#ffffff" },
    createElement(
      "Box",
      {
        id: "video-camera",
        position: "absolute",
        left: 0,
        top: 0,
        width: SCENE_WIDTH,
        height: SCENE_HEIGHT,
        transform: { scaleX: 1.2, scaleY: 1.2, originX: 0, originY: 0 },
      },
      createElement("Box", {
        id: "video-hairline",
        position: "absolute",
        left: 4,
        top: 4,
        width: 40,
        height: 20,
        borderWidth: 1,
        borderColor: "#2563eb",
        strokeScaling: "canvas",
      }),
      createElement("Path", {
        id: "video-path-hairline",
        position: "absolute",
        left: 26,
        top: 4,
        width: 20,
        height: 20,
        d: "M1 1H19V19H1Z",
        fill: "none",
        stroke: "#dc2626",
        strokeWidth: 1,
        strokeScaling: "canvas",
      }),
    ),
    createElement(
      "Text",
      {
        id: "video-text",
        font: FONT_ALIAS,
        fontSizePx: 12,
        color: "#111111",
        ...(animate && {
          animate: {
            keyframes: [
              { at: 0, opacity: 0 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 100,
          },
        }),
      },
      text,
    ),
  ) as unknown as EngineInput;
}

beforeAll(async () => {
  const muxerWasm = fileURLToPath(new URL("../wasm-pkg/boundmp4_bg.wasm", import.meta.url));
  await initVideoWasm(await readFile(muxerWasm));

  await initNodeWasm();
  const fontPath = fileURLToPath(
    new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url),
  );
  engine = await createEngineAsync({
    fonts: [
      {
        alias: FONT_ALIAS,
        weight: 400,
        style: "normal",
        data: await readFile(fontPath),
      },
    ],
  });
});

beforeEach(() => {
  state = { canvasSizes: [], decodedSizes: [], frameDigests: [], videoFrameInits: [] };
  installBrowserStubs();
});

describe("renderToMp4 against a real engine", () => {
  it("produces a playable container from engine-sampled frames", async () => {
    const file = await renderToMp4(engine, scene("boundsvg"), {
      durationMs: 200,
      frameRate: 30,
    });

    expect(new TextDecoder("latin1").decode(file.subarray(4, 8))).toBe("ftyp");
    // 200ms at 30fps is 6 frames, and every one has to reach the encoder.
    expect(state.decodedSizes).toHaveLength(6);
    expect(file.byteLength).toBeGreaterThan(0);
  });

  it("gets a fractional NTSC schedule accepted by the real sampler", async () => {
    // What this pins is that core takes fractional times at all and yields one
    // frame each. It does not prove core leaves them unrounded — the array read
    // back is the one renderToMp4 just built. `mp4-schedule.test.ts` owns the
    // element-by-element shape assertion.
    const observer = observing(engine);
    await renderToMp4(observer.engine, scene("ntsc"), {
      durationMs: 400,
      frameRate: NTSC_30,
    });

    const timesMs = observer.lastOptions()?.timesMs ?? [];
    expect(timesMs).toHaveLength(12);
    expect(timesMs[1]).toBeCloseTo(1001 / 30, 12);
    expect(timesMs[11]).toBeCloseTo((11 * 1000 * 1001) / 30000, 12);
    // A rounded schedule would land on whole milliseconds.
    expect(Number.isInteger(timesMs[1])).toBe(false);
  });

  it("reads the option names core actually consumes", async () => {
    const observer = observing(engine);
    await renderToMp4(observer.engine, scene("options"), {
      durationMs: 100,
      scale: 2,
      background: "#102030",
    });

    const options = observer.lastOptions();
    expect(options?.format).toBe("png");
    expect(options?.scale).toBe(2);
    expect(options?.rasterBackground).toBe("#102030");
    // scale reaches the rasterizer, so the decoded PNG is twice the scene.
    expect(state.decodedSizes[0]).toEqual({ width: SCENE_WIDTH * 2, height: SCENE_HEIGHT * 2 });
  });

  it("pads the odd rasterized size up to even canvas dimensions", async () => {
    await renderToMp4(engine, scene("padding"), { durationMs: 100 });

    // The scene is deliberately odd on both axes; H.264 needs even dimensions.
    expect(state.decodedSizes[0]).toEqual({ width: SCENE_WIDTH, height: SCENE_HEIGHT });
    expect(state.canvasSizes[0]).toEqual({ width: SCENE_WIDTH + 1, height: SCENE_HEIGHT + 1 });
  });

  it("samples an animated scene into frames that actually differ", async () => {
    // Frames are pulled one at a time from a lazy iterator. If the schedule did
    // not reach the sampler, or every frame came back rendered at the same
    // instant, the export would encode one still picture and still succeed.
    await renderToMp4(engine, scene("motion", true), { durationMs: 100 });

    expect(state.frameDigests).toHaveLength(3);
    expect(new Set(state.frameDigests).size).toBeGreaterThan(1);
  });

  it("renders a static scene identically at every sample time", async () => {
    // The counterpart to the animated case: without an animation the sampler
    // must be the only source of variation, so the frames are byte-identical.
    await renderToMp4(engine, scene("still"), { durationMs: 100 });

    expect(state.frameDigests).toHaveLength(3);
    expect(new Set(state.frameDigests).size).toBe(1);
  });

  it("forwards recoverable warnings from the compiled scene, once per export", async () => {
    // A glyph the fixture font has no coverage for is the sampler's own
    // recoverable warning; without forwarding it is dropped for the whole run.
    // Core delivers it at compile time, not per frame, so three sampled frames
    // still report it once — asserting the count pins that contract instead of
    // merely proving the callback is reachable.
    const onWarning = vi.fn();
    await renderToMp4(engine, scene("\u{1F600}\u{1F680}"), {
      durationMs: 100,
      onWarning,
    });

    expect(state.frameDigests).toHaveLength(3);
    expect(onWarning).toHaveBeenCalledTimes(1);
  });
});

describe("renderCompiledToMp4 against a real engine", () => {
  it("preserves schedule order, timestamps, dimensions, and transition checkpoint content", async () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const frameRate = { numerator: 10, denominator: 1 };
    const timesMs = Array.from({ length: 11 }, (_unused, index) => index * 100);
    const expectedDigests = timesMs.map((timeMs) =>
      createHash("sha256")
        .update(
          engine.renderCompiledToPng(compiled, {
            timeMs,
            rasterBackground: "#ffffff",
          }),
        )
        .digest("hex"),
    );
    const observer = observingCompiled(engine);

    const file = await renderCompiledToMp4(observer.engine, compiled, {
      durationMs: 1_100,
      frameRate,
    });

    expect(new TextDecoder("latin1").decode(file.subarray(4, 8))).toBe("ftyp");
    expect(observer.lastOptions()?.timesMs).toEqual(timesMs);
    expect(state.frameDigests).toEqual(expectedDigests);
    expect(state.decodedSizes).toEqual(
      timesMs.map(() => ({
        width: PORTABLE_LAYOUT_TRANSITION_CANVAS.width,
        height: PORTABLE_LAYOUT_TRANSITION_CANVAS.height,
      })),
    );
    expect(state.videoFrameInits).toEqual(
      timesMs.map((_timeMs, index) => ({
        timestamp: videoTimestampMicros(frameRate, index),
        duration: videoFrameDurationMicros(frameRate, index),
      })),
    );
    expect(observer.cleanupCount()).toBe(1);
  });

  it("closes the compiled frame iterator when an in-flight export is aborted", async () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const observer = observingCompiled(engine);
    const controller = new AbortController();
    state.onVideoFrame = () => {
      if (state.videoFrameInits.length === 2) {
        controller.abort();
      }
    };

    await expect(
      renderCompiledToMp4(observer.engine, compiled, {
        durationMs: 500,
        frameRate: 10,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "VIDEO_EXPORT_ABORTED" });
    expect(state.decodedSizes).toHaveLength(2);
    expect(observer.cleanupCount()).toBe(1);
  });

  it("cleans up repeatably when the codec is unavailable", async () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const observer = observingCompiled(engine);
    vi.stubGlobal("VideoEncoder", undefined);
    const runs: Array<{ timesMs: readonly number[]; firstDigest: string | undefined }> = [];

    for (let runIndex = 0; runIndex < 2; runIndex += 1) {
      state.frameDigests = [];
      await expect(
        renderCompiledToMp4(observer.engine, compiled, { durationMs: 200, frameRate: 10 }),
      ).rejects.toMatchObject({ code: "VIDEO_ENCODER_UNSUPPORTED" });
      runs.push({
        timesMs: observer.lastOptions()?.timesMs ?? [],
        firstDigest: state.frameDigests[0],
      });
    }

    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]?.timesMs).toEqual([0, 100]);
    expect(runs[0]?.firstDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(observer.cleanupCount()).toBe(2);
  });
});
