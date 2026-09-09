import type { OutputGenerator } from "@boundsvg/core";
import {
  cleanupAfterFailure,
  createVideoError,
  decodeMp4Failure,
  type VideoOperation,
} from "./diagnostics.js";
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
  await initVideoWasm();

  const muxer = createMuxer(options);
  let hasCodecDescription = false;
  let isDisposed = false;
  let sampleCount = 0;
  let lastTimestampMicros: number | undefined;

  const dispose = (): void => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    try {
      muxer.free();
    } catch {
      throw createVideoError("VIDEO_MUXER_PROTOCOL_ERROR", "disposeMuxer");
    }
  };

  const failWriter = (failure: unknown): never => {
    cleanupAfterFailure(dispose);
    throw failure;
  };
  const assertActive = (operation: "writeSample" | "finishMuxer"): void => {
    if (isDisposed) {
      throw createVideoError("VIDEO_MUXER_INVALID_STATE", operation);
    }
  };
  const runOnMuxer = <T>(action: () => T, operation: VideoOperation): T => {
    try {
      return action();
    } catch (error) {
      return failWriter(decodeMp4Failure(error, operation));
    }
  };

  return {
    write(sample) {
      assertActive("writeSample");
      if (sample.codecDescription && !hasCodecDescription) {
        runOnMuxer(
          () => muxer.set_codec_description(sample.codecDescription as Uint8Array),
          "setDescription",
        );
        hasCodecDescription = true;
      }
      if (!hasCodecDescription) {
        failWriter(
          createVideoError("VIDEO_MUXER_MISSING_INPUT", "writeSample", {
            field: "codecDescription",
          }),
        );
      }
      // The container gives every sample the same duration in frame order, so
      // reordered output (B-frames) would play out of order rather than fail.
      if (
        lastTimestampMicros === undefined
          ? sample.timestampMicros === Number.NEGATIVE_INFINITY
          : sample.timestampMicros <= lastTimestampMicros
      ) {
        failWriter(
          createVideoError("VIDEO_SAMPLE_ORDER_INVALID", "writeSample", {
            ...(lastTimestampMicros !== undefined && {
              previousTimestampMicros: lastTimestampMicros,
            }),
            timestampMicros: sample.timestampMicros,
          }),
        );
      }
      lastTimestampMicros = sample.timestampMicros;
      runOnMuxer(() => muxer.append_sample(sample.bytes, sample.keyFrame), "appendSample");
      sampleCount += 1;
    },
    sampleCount() {
      return sampleCount;
    },
    finish() {
      assertActive("finishMuxer");
      if (sampleCount === 0) {
        failWriter(
          createVideoError("VIDEO_MUXER_MISSING_INPUT", "finishMuxer", { sampleCount: 0 }),
        );
      }
      const bytes = runOnMuxer(() => muxer.finish(), "finishMuxer");
      dispose();
      return bytes;
    },
    dispose,
  };
}

function createMuxer(options: Mp4WriterOptions): InstanceType<typeof Mp4VideoMuxer> {
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
    throw decodeMp4Failure(error, "createMuxer");
  }
}
