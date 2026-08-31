import { FatalError, type OutputGenerator } from "@boundsvg/core";
import type { EncodedSample } from "./encode-pipeline.js";
import type { VideoFrameRate } from "./frame-rate.js";
import { type InitInput, initMuxerWasm, Mp4VideoMuxer } from "./generated-wasm.js";

let initPromise: Promise<void> | null = null;

/**
 * Load the bundled MP4 muxer wasm.
 *
 * Called for you by the export entry points; call it directly to control when
 * the binary is fetched, or to supply it from a bundler-provided asset.
 * Repeated calls reuse the first initialization.
 */
export async function initVideoWasm(input?: InitInput): Promise<void> {
  initPromise ??= initMuxerWasm(input).catch((error: unknown) => {
    // A failed load must not poison later attempts with a rejected promise.
    initPromise = null;
    throw error;
  });
  return initPromise;
}

type Mp4WriterOptions = {
  /** Padded frame size in pixels; both values must be even. */
  width: number;
  height: number;
  frameRate: VideoFrameRate;
  /** Expected sample count; sizes the index space reserved for faststart. */
  frameCountHint: number;
  generator?: OutputGenerator;
};

/** Container writer that turns encoded samples into an MP4 file. */
export type Mp4Writer = {
  /** Append one encoded sample, adopting its codec description when present. */
  write(sample: EncodedSample): void;
  /** Samples accepted so far. */
  sampleCount(): number;
  /** Lay out the container and return the finished file. */
  finish(): Uint8Array;
  /** Release the wasm-side muxer without producing a file. Safe to call twice. */
  dispose(): void;
};

/**
 * Create a writer for a single H.264 track.
 *
 * Sample timing is left to the muxer, which derives it from the frame rate
 * alone (exact rational ticks), so encoder timestamps are never written to the
 * container.
 */
export async function createMp4Writer(options: Mp4WriterOptions): Promise<Mp4Writer> {
  await initVideoWasm().catch((error: unknown) => {
    throw new FatalError(
      "VIDEO_ENCODER_UNSUPPORTED",
      `the MP4 muxer wasm could not be loaded: ${describeError(error)}`,
    );
  });

  const muxer = createMuxer(options);
  let hasCodecDescription = false;
  let isDisposed = false;
  let sampleCount = 0;
  let lastTimestampMicros = Number.NEGATIVE_INFINITY;

  const dispose = (): void => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    muxer.free();
  };

  const failWriter = (message: string): FatalError => {
    dispose();
    return new FatalError("VIDEO_ENCODER_UNSUPPORTED", message);
  };

  /** Run a container call, turning its wasm-side failure into a FatalError. */
  const runOnMuxer = <T>(action: () => T, what: string): T => {
    try {
      return action();
    } catch (error) {
      throw failWriter(`MP4 container ${what} failed: ${describeError(error)}`);
    }
  };

  return {
    write(sample) {
      if (sample.codecDescription && !hasCodecDescription) {
        runOnMuxer(
          () => muxer.set_codec_description(sample.codecDescription as Uint8Array),
          "setup",
        );
        hasCodecDescription = true;
      }
      if (!hasCodecDescription) {
        throw failWriter(
          "the encoder produced a sample before reporting an avcC codec description, so the MP4 track cannot be described",
        );
      }
      // The container gives every sample the same duration in frame order, so
      // reordered output (B-frames) would play out of order rather than fail.
      if (sample.timestampMicros <= lastTimestampMicros) {
        throw failWriter(
          `the encoder emitted samples out of presentation order (${sample.timestampMicros}us after ${lastTimestampMicros}us); MP4 export needs one in-order frame per sample`,
        );
      }
      lastTimestampMicros = sample.timestampMicros;
      runOnMuxer(() => muxer.append_sample(sample.bytes, sample.keyFrame), "write");
      sampleCount += 1;
    },
    sampleCount() {
      return sampleCount;
    },
    finish() {
      if (sampleCount === 0) {
        throw failWriter("the encoder produced no samples");
      }
      try {
        return runOnMuxer(() => muxer.finish(), "finalize");
      } finally {
        dispose();
      }
    },
    dispose,
  };
}

function createMuxer(options: Mp4WriterOptions): Mp4VideoMuxer {
  try {
    return new Mp4VideoMuxer(
      options.width,
      options.height,
      options.frameRate.numerator,
      options.frameRate.denominator,
      options.frameCountHint,
      options.generator?.name,
      options.generator?.version,
    );
  } catch (error) {
    // The frame rate is validated before it gets here and frames are padded to
    // even sizes, so a rejection means this size cannot be carried at all.
    throw new FatalError(
      "VIDEO_ENCODER_UNSUPPORTED",
      `MP4 container setup failed: ${describeError(error)}`,
      {
        context: {
          width: options.width,
          height: options.height,
          frameRate: options.frameRate,
        },
      },
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
