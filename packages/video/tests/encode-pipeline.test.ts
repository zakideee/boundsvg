import { FatalError } from "@boundsvg/core";
import { describe, expect, it, vi } from "vitest";
import {
  createEncodePipeline,
  type EncodedSample,
  type VideoEncoderConstructorLike,
  type VideoEncoderLike,
} from "../src/encode-pipeline.js";

const CONFIG: VideoEncoderConfig = {
  codec: "avc1.640028",
  width: 64,
  height: 32,
  bitrate: 1_000_000,
  framerate: 30,
  avc: { format: "avc" },
};

type EncodeCall = {
  frame: VideoFrame;
  keyFrame: boolean;
};

/**
 * Scripted stand-in for `VideoEncoder`.
 *
 * `queueSizes` is consumed one entry per read so a test can hold the queue full
 * for a fixed number of checks and then let it drain.
 */
function createFakeEncoder(
  options: {
    queueSizes?: number[];
    isSupported?: boolean;
    configureError?: Error;
    flushError?: Error;
  } = {},
) {
  const state = {
    calls: [] as EncodeCall[],
    flushCount: 0,
    closeCount: 0,
    queueReads: 0,
    emit: (_sample: { chunk: EncodedVideoChunk; metadata?: EncodedVideoChunkMetadata }) => {},
    fail: (_error: Error) => {},
    configuredWith: undefined as VideoEncoderConfig | undefined,
  };
  const queueSizes = options.queueSizes ?? [];

  class FakeVideoEncoder implements VideoEncoderLike {
    constructor(init: VideoEncoderInit) {
      state.emit = ({ chunk, metadata }) => {
        init.output(chunk, metadata);
      };
      state.fail = (error) => {
        init.error(error as DOMException);
      };
    }

    get encodeQueueSize(): number {
      const size = queueSizes[state.queueReads] ?? 0;
      state.queueReads += 1;
      return size;
    }

    configure(config: VideoEncoderConfig): void {
      if (options.configureError) {
        throw options.configureError;
      }
      state.configuredWith = config;
    }

    encode(frame: VideoFrame, encodeOptions?: VideoEncoderEncodeOptions): void {
      state.calls.push({ frame, keyFrame: encodeOptions?.keyFrame === true });
    }

    async flush(): Promise<void> {
      state.flushCount += 1;
      if (options.flushError) {
        throw options.flushError;
      }
    }

    close(): void {
      state.closeCount += 1;
    }

    static isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
      return Promise.resolve({ supported: options.isSupported ?? true, config });
    }
  }

  return { state, constructor: FakeVideoEncoder as unknown as VideoEncoderConstructorLike };
}

function createFakeFrame(): { frame: VideoFrame; closeSpy: ReturnType<typeof vi.fn> } {
  const closeSpy = vi.fn();
  return { frame: { close: closeSpy } as unknown as VideoFrame, closeSpy };
}

function createFakeChunk(bytes: number[], type: "key" | "delta" = "key"): EncodedVideoChunk {
  return {
    byteLength: bytes.length,
    timestamp: 0,
    duration: 33333,
    type,
    copyTo: (destination: Uint8Array) => {
      destination.set(bytes);
    },
  } as unknown as EncodedVideoChunk;
}

async function createPipeline(
  encoder: ReturnType<typeof createFakeEncoder>,
  overrides: Partial<Parameters<typeof createEncodePipeline>[0]> = {},
) {
  const samples: EncodedSample[] = [];
  const pipeline = await createEncodePipeline({
    config: CONFIG,
    keyFrameInterval: 2,
    onSample: (sample) => {
      samples.push(sample);
    },
    encoderConstructor: encoder.constructor,
    ...overrides,
  });
  return { pipeline, samples };
}

describe("createEncodePipeline", () => {
  it("configures the encoder with the configuration the runtime returned", async () => {
    const encoder = createFakeEncoder();
    await createPipeline(encoder);
    expect(encoder.state.configuredWith).toEqual(CONFIG);
  });

  it("rejects an unsupported configuration", async () => {
    const encoder = createFakeEncoder({ isSupported: false });
    await expect(createPipeline(encoder)).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
  });

  it("rejects a configuration the runtime normalized into a different stream", async () => {
    const encoder = createFakeEncoder();
    const encoderConstructor = encoder.constructor as unknown as {
      isConfigSupported: (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>;
    };
    encoderConstructor.isConfigSupported = (config) =>
      Promise.resolve({ supported: true, config: { ...config, width: config.width + 2 } });

    await expect(createPipeline(encoder)).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
  });

  it("rejects a configuration whose bitstream format was changed", async () => {
    const encoder = createFakeEncoder();
    const encoderConstructor = encoder.constructor as unknown as {
      isConfigSupported: (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>;
    };
    encoderConstructor.isConfigSupported = (config) =>
      Promise.resolve({ supported: true, config: { ...config, avc: { format: "annexb" } } });

    await expect(createPipeline(encoder)).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
  });

  it("accepts a configuration that simply does not echo the bitstream format", async () => {
    const encoder = createFakeEncoder();
    const encoderConstructor = encoder.constructor as unknown as {
      isConfigSupported: (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>;
    };
    encoderConstructor.isConfigSupported = (config) =>
      Promise.resolve({ supported: true, config: { ...config, avc: undefined } });

    await expect(createPipeline(encoder)).resolves.toBeDefined();
  });

  it("surfaces a rejecting flush", async () => {
    const encoder = createFakeEncoder({ flushError: new Error("encoder gave up") });
    const { pipeline } = await createPipeline(encoder);

    await expect(pipeline.finish()).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
    expect(encoder.state.closeCount).toBe(1);
  });

  it("reports a rejected support probe as unsupported", async () => {
    const encoder = createFakeEncoder();
    const encoderConstructor = encoder.constructor as unknown as {
      isConfigSupported: (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>;
    };
    encoderConstructor.isConfigSupported = () => Promise.reject(new TypeError("bad config"));

    await expect(createPipeline(encoder)).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
  });

  it("reports a configure() throw as unsupported", async () => {
    const encoder = createFakeEncoder({ configureError: new TypeError("bad config") });
    await expect(createPipeline(encoder)).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
    expect(encoder.state.closeCount).toBe(1);
  });

  it("rejects when the runtime has no VideoEncoder", async () => {
    await expect(
      createEncodePipeline({
        config: CONFIG,
        keyFrameInterval: 2,
        onSample: () => {},
      }),
    ).rejects.toBeInstanceOf(FatalError);
  });

  it("marks key frames on the configured interval and closes every frame", async () => {
    const encoder = createFakeEncoder();
    const { pipeline } = await createPipeline(encoder);

    const frames = [createFakeFrame(), createFakeFrame(), createFakeFrame()];
    for (const [index, entry] of frames.entries()) {
      await pipeline.submit(entry.frame, index);
    }

    expect(encoder.state.calls.map((call) => call.keyFrame)).toEqual([true, false, true]);
    for (const entry of frames) {
      expect(entry.closeSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("waits while the encoder queue is saturated", async () => {
    // Full for the first three checks, then drained.
    const encoder = createFakeEncoder({ queueSizes: [8, 8, 8, 0] });
    const { pipeline } = await createPipeline(encoder);

    const { frame } = createFakeFrame();
    await pipeline.submit(frame, 0);

    expect(encoder.state.queueReads).toBeGreaterThan(1);
    expect(encoder.state.calls).toHaveLength(1);
  });

  it("collects samples with the codec description from the first key chunk", async () => {
    const encoder = createFakeEncoder();
    const { pipeline, samples } = await createPipeline(encoder);

    encoder.state.emit({
      chunk: createFakeChunk([1, 2, 3]),
      metadata: { decoderConfig: { codec: "avc1.640028", description: new Uint8Array([9, 9]) } },
    });
    encoder.state.emit({ chunk: createFakeChunk([4, 5], "delta") });
    await pipeline.finish();

    expect(samples).toHaveLength(2);
    expect(samples[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(samples[0]?.keyFrame).toBe(true);
    expect(samples[0]?.codecDescription).toEqual(new Uint8Array([9, 9]));
    expect(samples[1]?.keyFrame).toBe(false);
    expect(samples[1]?.codecDescription).toBeUndefined();
  });

  it("surfaces an encoder error on the next submit", async () => {
    const encoder = createFakeEncoder();
    const { pipeline } = await createPipeline(encoder);

    encoder.state.fail(new Error("encoder blew up"));
    const { frame, closeSpy } = createFakeFrame();

    await expect(pipeline.submit(frame, 0)).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(encoder.state.closeCount).toBe(1);
  });

  it("surfaces a sample handler that throws synchronously", async () => {
    // A throw inside the encoder's own output task is invisible to the caller
    // unless it is captured here, which would truncate the file silently.
    const encoder = createFakeEncoder();
    const pipeline = await createEncodePipeline({
      config: CONFIG,
      keyFrameInterval: 2,
      onSample: () => {
        throw new Error("muxer refused the sample");
      },
      encoderConstructor: encoder.constructor,
    });

    encoder.state.emit({ chunk: createFakeChunk([1]) });
    await expect(pipeline.finish()).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
  });

  it("aborts through the supplied signal", async () => {
    const encoder = createFakeEncoder();
    const controller = new AbortController();
    const { pipeline } = await createPipeline(encoder, { signal: controller.signal });

    controller.abort();
    const { frame, closeSpy } = createFakeFrame();

    await expect(pipeline.submit(frame, 0)).rejects.toMatchObject({
      code: "VIDEO_EXPORT_ABORTED",
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(encoder.state.calls).toHaveLength(0);
  });

  it("closes the encoder only once", async () => {
    const encoder = createFakeEncoder();
    const { pipeline } = await createPipeline(encoder);

    pipeline.close();
    pipeline.close();
    expect(encoder.state.closeCount).toBe(1);
  });
});
