import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Engine, FatalError, type Frame, type RenderFramesOptions } from "@boundsvg/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { videoFrameDurationMicros, videoTimestampMicros } from "../src/frame-rate.js";
import { Mp4VideoMuxer } from "../src/generated-wasm.js";
import { encodePngFramesToMp4, renderToMp4 } from "../src/mp4.js";
import { initVideoWasm } from "../src/mp4-writer.js";

const NTSC_30 = { numerator: 30000, denominator: 1001 };

/** Minimal avcC record: High profile, level 4.0, four-byte NAL lengths. */
const CODEC_DESCRIPTION = new Uint8Array([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28, 0x01, 0x00, 0x03, 0x68,
  0xee, 0x3c,
]);

type RecordedVideoFrame = {
  timestamp: number;
  duration: number | undefined;
};

type BrowserStubState = {
  bitmapSize: { width: number; height: number };
  muxerFreeCount: number;
  decodeOptions: ImageBitmapOptions | undefined;
  bitmapCloseCount: number;
  videoFrames: RecordedVideoFrame[];
  videoFrameCloseCount: number;
  encoderConfig: VideoEncoderConfig | undefined;
  keyFrameFlags: boolean[];
  fillStyles: string[];
  drawCount: number;
  canvasSizes: Array<{ width: number; height: number }>;
  /** Frames the fake encoder swallows instead of emitting a chunk for. */
  dropFrameIndexes: Set<number>;
  /** Runs after each frame reaches the encoder, so a test can interrupt mid-stream. */
  onFrameDecoded?: () => void;
};

let state: BrowserStubState;

/** Colours a real canvas parses but serializes back with an alpha component. */
const TRANSLUCENT_COLORS = new Map([
  ["transparent", "rgba(0, 0, 0, 0)"],
  ["rgba(255, 0, 0, 0.5)", "rgba(255, 0, 0, 0.5)"],
  // CSS Color 4 colours keep their own syntax and append a slash-alpha instead.
  ["color(display-p3 1 0 0 / 0.5)", "color(display-p3 1 0 0 / 0.5)"],
]);

function installBrowserStubs(): void {
  class FakeImageBitmap {
    readonly width = state.bitmapSize.width;
    readonly height = state.bitmapSize.height;
    close(): void {
      state.bitmapCloseCount += 1;
    }
  }

  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      state.canvasSizes.push({ width, height });
    }
    getContext(): unknown {
      // Mirrors the canvas rule that an unparseable fillStyle is ignored, which
      // is what the background check relies on.
      let fillStyle = "#000000";
      return {
        get fillStyle() {
          return fillStyle;
        },
        set fillStyle(value: string) {
          if (/^#[0-9a-f]{6}$/i.test(value)) {
            // Canvas serializes what it stores, which is what the background
            // check has to cope with.
            fillStyle = value.toLowerCase();
          } else if (TRANSLUCENT_COLORS.has(value)) {
            // Canvas serializes a colour with alpha in the rgba() form, which is
            // the only signal that the background would composite against black.
            fillStyle = TRANSLUCENT_COLORS.get(value) ?? fillStyle;
          }
        },
        fillRect: () => {
          state.fillStyles.push(fillStyle);
        },
        drawImage: () => {
          state.drawCount += 1;
        },
      };
    }
  }

  class FakeVideoFrame {
    readonly timestamp: number;
    constructor(_source: unknown, init: VideoFrameInit) {
      this.timestamp = init.timestamp;
      state.videoFrames.push({ timestamp: init.timestamp, duration: init.duration });
      state.onFrameDecoded?.();
    }
    close(): void {
      state.videoFrameCloseCount += 1;
    }
  }

  class FakeVideoEncoder {
    readonly encodeQueueSize = 0;
    private emittedCount = 0;
    private submittedCount = 0;
    constructor(private readonly init: VideoEncoderInit) {}

    static isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
      return Promise.resolve({ supported: true, config });
    }

    configure(config: VideoEncoderConfig): void {
      state.encoderConfig = config;
    }

    encode(frame: { timestamp: number }, options?: VideoEncoderEncodeOptions): void {
      const index = this.submittedCount;
      this.submittedCount += 1;
      state.keyFrameFlags.push(options?.keyFrame === true);
      if (state.dropFrameIndexes.has(index)) {
        return;
      }
      const isFirst = this.emittedCount === 0;
      this.emittedCount += 1;
      const chunk = {
        byteLength: 4,
        timestamp: frame.timestamp,
        duration: 0,
        type: isFirst ? "key" : "delta",
        copyTo: (destination: Uint8Array) => {
          destination.set([1, 2, 3, 4]);
        },
      } as unknown as EncodedVideoChunk;
      this.init.output(
        chunk,
        isFirst ? { decoderConfig: { codec: "avc1.640028", description: CODEC_DESCRIPTION } } : {},
      );
    }

    flush(): Promise<void> {
      return Promise.resolve();
    }

    close(): void {}
  }

  Object.assign(globalThis, {
    createImageBitmap: (_blob: Blob, decodeOptions?: ImageBitmapOptions) => {
      state.decodeOptions = decodeOptions;
      return Promise.resolve(new FakeImageBitmap());
    },
    OffscreenCanvas: FakeOffscreenCanvas,
    VideoFrame: FakeVideoFrame,
    VideoEncoder: FakeVideoEncoder,
  });
}

function pngFrames(count: number): Array<{ data: Uint8Array; timeMs: number }> {
  return Array.from({ length: count }, (_unused, index) => ({
    data: new Uint8Array([index % 256]),
    timeMs: index,
  }));
}

/** Walk the top-level box chain, returning each box type in file order. */
function topLevelBoxTypes(fileBytes: Uint8Array): string[] {
  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const decoder = new TextDecoder("latin1");
  const types: string[] = [];
  let offset = 0;
  while (offset + 8 <= fileBytes.byteLength) {
    const declaredSize = view.getUint32(offset);
    types.push(decoder.decode(fileBytes.subarray(offset + 4, offset + 8)));
    const boxSize = declaredSize === 1 ? Number(view.getBigUint64(offset + 8)) : declaredSize;
    if (boxSize <= 0) {
      break;
    }
    offset += boxSize;
  }
  return types;
}

beforeAll(async () => {
  const wasmPath = fileURLToPath(new URL("../wasm-pkg/boundmp4_bg.wasm", import.meta.url));
  await initVideoWasm(await readFile(wasmPath));
});

beforeEach(() => {
  state = {
    bitmapSize: { width: 64, height: 32 },
    muxerFreeCount: 0,
    decodeOptions: undefined,
    bitmapCloseCount: 0,
    videoFrames: [],
    videoFrameCloseCount: 0,
    encoderConfig: undefined,
    keyFrameFlags: [],
    fillStyles: [],
    drawCount: 0,
    canvasSizes: [],
    dropFrameIndexes: new Set(),
  };
  installBrowserStubs();
});

describe("encodePngFramesToMp4 end to end", () => {
  it("produces a faststart MP4 from a frame stream", async () => {
    const fileBytes = await encodePngFramesToMp4(pngFrames(4), {
      frameRate: NTSC_30,
      frameCount: 4,
    });

    const boxTypes = topLevelBoxTypes(fileBytes);
    expect(boxTypes[0]).toBe("ftyp");
    expect(boxTypes.indexOf("moov")).toBeLessThan(boxTypes.indexOf("mdat"));
  });

  it("carries the requested generator only in the completed MP4", async () => {
    const fileBytes = await encodePngFramesToMp4(pngFrames(2), {
      frameRate: 30,
      frameCount: 2,
      generator: { name: "@scope/aaaa", version: "1.2.3-beta.1" },
    });

    expect(new TextDecoder("latin1").decode(fileBytes)).toContain("@scope/aaaa/1.2.3-beta.1");
  });

  it("stamps every frame with the rational timestamp and neighbour-gap duration", async () => {
    await encodePngFramesToMp4(pngFrames(5), { frameRate: NTSC_30, frameCount: 5 });

    expect(state.videoFrames).toEqual(
      [0, 1, 2, 3, 4].map((index) => ({
        timestamp: videoTimestampMicros(NTSC_30, index),
        duration: videoFrameDurationMicros(NTSC_30, index),
      })),
    );
  });

  it("closes every decoded bitmap and video frame", async () => {
    await encodePngFramesToMp4(pngFrames(6), { frameRate: 30, frameCount: 6 });

    expect(state.bitmapCloseCount).toBe(6);
    expect(state.videoFrameCloseCount).toBe(6);
  });

  it("pads odd frames to even dimensions over the background colour", async () => {
    state.bitmapSize = { width: 65, height: 33 };
    await encodePngFramesToMp4(pngFrames(2), {
      frameRate: 30,
      frameCount: 2,
      background: "#123456",
    });

    expect(state.canvasSizes).toEqual([{ width: 66, height: 34 }]);
    expect(state.encoderConfig?.width).toBe(66);
    expect(state.encoderConfig?.height).toBe(34);
    expect(state.fillStyles).toEqual(["#123456", "#123456"]);
    expect(state.drawCount).toBe(2);
  });

  it("configures H.264 with a length-prefixed bitstream and a derived bitrate", async () => {
    await encodePngFramesToMp4(pngFrames(2), { frameRate: 30, frameCount: 2 });

    expect(state.encoderConfig?.codec).toBe("avc1.640028");
    expect(state.encoderConfig?.avc).toEqual({ format: "avc" });
    expect(state.encoderConfig?.bitrate).toBe(1_000_000);
    // Left at the default: "realtime" may drop frames to keep up, and this
    // export needs every one of them.
    expect(state.encoderConfig?.latencyMode).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects the unusable bitrate %s", async (bitrate) => {
    await expect(
      encodePngFramesToMp4(pngFrames(2), { frameRate: 30, frameCount: 2, bitrate }),
    ).rejects.toMatchObject({ code: "VIDEO_INVALID_OPTION" });
  });

  it("decodes frames without colour management", async () => {
    await encodePngFramesToMp4(pngFrames(1 + 1), { frameRate: 30, frameCount: 2 });
    expect(state.decodeOptions).toEqual({
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
  });

  it("rejects a frame whose size differs from the first", async () => {
    async function* resizingFrames() {
      yield { data: new Uint8Array([1]), timeMs: 0 };
      state.bitmapSize = { width: 128, height: 64 };
      yield { data: new Uint8Array([2]), timeMs: 1 };
    }

    await expect(
      encodePngFramesToMp4(resizingFrames(), { frameRate: 30, frameCount: 2 }),
    ).rejects.toMatchObject({ code: "VIDEO_INVALID_FRAMES" });
    expect(state.bitmapCloseCount).toBe(2);
  });

  it("honours an explicit bitrate", async () => {
    await encodePngFramesToMp4(pngFrames(2), {
      frameRate: 30,
      frameCount: 2,
      bitrate: 4_000_000,
    });

    expect(state.encoderConfig?.bitrate).toBe(4_000_000);
  });

  it("requests a key frame about every two seconds", async () => {
    await encodePngFramesToMp4(pngFrames(4), { frameRate: 2, frameCount: 4 });

    expect(state.keyFrameFlags).toEqual([true, false, false, false]);
  });

  it("reports progress once per frame", async () => {
    const progress: Array<[number, number]> = [];
    await encodePngFramesToMp4(pngFrames(3), {
      frameRate: 30,
      frameCount: 3,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("rejects a stream longer than the frame budget without decoding the extra frame", async () => {
    await expect(encodePngFramesToMp4(pngFrames(3601), { frameRate: 30 })).rejects.toMatchObject({
      code: "VIDEO_TOO_MANY_FRAMES",
    });
    expect(state.bitmapCloseCount).toBe(3600);
  });

  it("stops and cleans up when the signal aborts mid-stream", async () => {
    const freeSpy = vi.spyOn(Mp4VideoMuxer.prototype, "free");
    const controller = new AbortController();
    async function* abortingFrames() {
      for (const frame of pngFrames(5)) {
        yield frame;
        if (state.videoFrames.length === 2) {
          controller.abort();
        }
      }
    }

    await expect(
      encodePngFramesToMp4(abortingFrames(), { frameRate: 30, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "VIDEO_EXPORT_ABORTED" });
    expect(state.bitmapCloseCount).toBe(2);
    expect(state.videoFrameCloseCount).toBe(2);
    // The muxer holds wasm memory that nothing else releases.
    expect(freeSpy).toHaveBeenCalledTimes(1);
    freeSpy.mockRestore();
  });

  it("fails as soon as the stream runs past the declared frameCount", async () => {
    // A generator, because an array's length is checked against the declaration
    // up front; only an uncountable stream can reach the running check.
    const streamed = (function* stream() {
      yield* pngFrames(6);
    })();

    await expect(
      encodePngFramesToMp4(streamed, { frameRate: 30, frameCount: 3 }),
    ).rejects.toMatchObject({ code: "VIDEO_INVALID_FRAMES" });
    // Stopped at the extra frame rather than encoding the whole stream first.
    expect(state.videoFrames).toHaveLength(3);
  });

  it("accepts a background that serializes to the probe colour", async () => {
    const fileBytes = await encodePngFramesToMp4(pngFrames(2), {
      frameRate: 30,
      frameCount: 2,
      background: "#FEDCBA",
    });
    expect(fileBytes.byteLength).toBeGreaterThan(0);
    expect(state.fillStyles).toEqual(["#fedcba", "#fedcba"]);
  });

  it("rejects a single-frame stream", async () => {
    await expect(encodePngFramesToMp4(pngFrames(1), { frameRate: 30 })).rejects.toMatchObject({
      code: "VIDEO_INVALID_FRAMES",
    });
  });

  it("rejects a background the canvas cannot parse", async () => {
    // Both background branches share one code, so the message is what pins
    // which of the two actually fired.
    await expect(
      encodePngFramesToMp4(pngFrames(2), { frameRate: 30, background: "rebeccapurpel" }),
    ).rejects.toMatchObject({
      code: "VIDEO_INVALID_OPTION",
      message: expect.stringContaining("can paint"),
    });
  });

  it.each([
    "transparent",
    "rgba(255, 0, 0, 0.5)",
    "color(display-p3 1 0 0 / 0.5)",
  ])("rejects the translucent background %s", async (background) => {
    // The canvas parses these, so they pass the paintability probe and would
    // otherwise be composited against black on an opaque surface. The last one
    // serializes in the CSS Color 4 slash-alpha form rather than as rgba().
    await expect(
      encodePngFramesToMp4(pngFrames(2), { frameRate: 30, background }),
    ).rejects.toMatchObject({
      code: "VIDEO_INVALID_OPTION",
      message: expect.stringContaining("opaque"),
    });
  });

  it("rejects a frameCount that contradicts the array it was given", async () => {
    // The array's real length is right there; a declaration that disagrees
    // would size the index for frames that never arrive.
    await expect(
      encodePngFramesToMp4(pngFrames(4), { frameRate: 30, frameCount: 10 }),
    ).rejects.toMatchObject({
      code: "VIDEO_INVALID_OPTION",
      message: expect.stringContaining("but the frames given are 4 long"),
    });
  });

  it("sizes the container index from an array of frames without a frameCount", async () => {
    // The declared count sizes the reserved index; deriving it from an array
    // avoids reserving for the frame ceiling and padding the file with `free`.
    // A generator cannot be counted up front, so it still pays that reservation.
    const streamed = (function* stream() {
      yield* pngFrames(4);
    })();

    const derived = await encodePngFramesToMp4(pngFrames(4), { frameRate: 30 });
    const declared = await encodePngFramesToMp4(pngFrames(4), { frameRate: 30, frameCount: 4 });
    const uncounted = await encodePngFramesToMp4(streamed, { frameRate: 30 });

    expect(derived.byteLength).toBe(declared.byteLength);
    expect(derived.byteLength).toBeLessThan(uncounted.byteLength);
  });

  it("uses the requested codec string", async () => {
    await encodePngFramesToMp4(pngFrames(2), {
      frameRate: 30,
      frameCount: 2,
      codec: "avc1.640033",
    });
    expect(state.encoderConfig?.codec).toBe("avc1.640033");
  });

  it("fails when the encoder returns fewer samples than frames", async () => {
    state.dropFrameIndexes = new Set([2]);

    await expect(
      encodePngFramesToMp4(pngFrames(4), { frameRate: 30, frameCount: 4 }),
    ).rejects.toMatchObject({ code: "VIDEO_ENCODER_UNSUPPORTED" });
  });
});

describe("renderToMp4 end to end", () => {
  const SCENE = { type: "canvas", props: { width: 64, height: 32 } } as unknown as Parameters<
    typeof renderToMp4
  >[1];

  /** Engine stand-in that answers a schedule with one PNG frame per sample time. */
  function createStubEngine(): { engine: Engine; lastOptions: () => RenderFramesOptions } {
    let seen: RenderFramesOptions | undefined;
    const engine = {
      renderFrames(_input: unknown, options: RenderFramesOptions): Iterable<Frame> {
        seen = options;
        return options.timesMs.map((timeMs, index) => ({
          index,
          timeMs,
          format: "png" as const,
          data: new Uint8Array([index % 256]),
        }));
      },
    } as unknown as Engine;
    return {
      engine,
      lastOptions: () => {
        if (!seen) {
          throw new Error("renderFrames was never called");
        }
        return seen;
      },
    };
  }

  it("samples, encodes, and writes a faststart MP4", async () => {
    const stub = createStubEngine();
    const fileBytes = await renderToMp4(stub.engine, SCENE, {
      durationMs: 200,
      frameRate: NTSC_30,
      background: "#123456",
      generator: { name: "@scope/aaaa", version: "1.2.3-beta.1" },
    });

    const timesMs = stub.lastOptions().timesMs;
    expect(stub.lastOptions().rasterBackground).toBe("#123456");
    expect(stub.lastOptions().generator).toBeUndefined();
    expect(state.videoFrames).toHaveLength(timesMs.length);
    expect(state.fillStyles.at(-1)).toBe("#123456");

    const boxTypes = topLevelBoxTypes(fileBytes);
    expect(boxTypes[0]).toBe("ftyp");
    expect(boxTypes.indexOf("moov")).toBeLessThan(boxTypes.indexOf("mdat"));
    expect(new TextDecoder("latin1").decode(fileBytes)).toContain("@scope/aaaa/1.2.3-beta.1");
  });

  it("preserves a text-layout FatalError from the frame producer", async () => {
    const fatalError = new FatalError(
      "TEXT_FONT_UNAVAILABLE",
      "No requested font is available for text layout.",
      {
        stage: "text",
        nodeId: "video-text",
        context: {
          operation: "renderTextLayout",
          runIndex: 0,
          requestedAliases: ["Missing"],
          omittedAliasCount: 0,
          fontWeight: 400,
          fontStyle: "normal",
        },
      },
    );
    const engine = {
      renderFrames(): Iterable<Frame> {
        throw fatalError;
      },
    } as unknown as Engine;

    await expect(renderToMp4(engine, SCENE, { durationMs: 200 })).rejects.toBe(fatalError);
  });

  it("preserves a rendered Symbol FatalError from the frame producer", async () => {
    const fatalError = new FatalError("SHAPE_PATH_DATA_INVALID", "Shape path data is invalid.", {
      stage: "validate",
      nodeId: "invalid-symbol",
      context: { operation: "renderSymbol" },
    });
    const engine = {
      renderFrames(): Iterable<Frame> {
        throw fatalError;
      },
    } as unknown as Engine;

    await expect(renderToMp4(engine, SCENE, { durationMs: 200 })).rejects.toBe(fatalError);
  });

  it("closes the engine's frame iterator when the export fails", async () => {
    const returnSpy = vi.fn(() => ({ done: true as const, value: undefined }));
    const engine = {
      renderFrames(): Iterable<Frame> {
        let index = 0;
        return {
          [Symbol.iterator]() {
            return {
              next: () => {
                index += 1;
                return {
                  done: false,
                  value: {
                    index,
                    timeMs: index,
                    format: "png" as const,
                    data: new Uint8Array([index % 256]),
                  },
                };
              },
              return: returnSpy,
            };
          },
        };
      },
    } as unknown as Engine;

    const controller = new AbortController();
    state.onFrameDecoded = () => {
      if (state.videoFrames.length === 1) {
        controller.abort();
      }
    };

    await expect(
      renderToMp4(engine, SCENE, { durationMs: 500, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "VIDEO_EXPORT_ABORTED" });
    // The iterator owns a prepared scene; leaving it open leaks native state.
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts before the engine compiles the scene", async () => {
    const controller = new AbortController();
    controller.abort();
    const stub = createStubEngine();

    await expect(
      renderToMp4(stub.engine, SCENE, { durationMs: 200, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "VIDEO_EXPORT_ABORTED" });
    expect(() => stub.lastOptions()).toThrowError("renderFrames was never called");
  });
});
