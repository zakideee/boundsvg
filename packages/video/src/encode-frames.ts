import { FatalError, type OutputGenerator } from "@boundsvg/core";
import { throwIfExportAborted } from "./abort.js";
import {
  createEncodePipeline,
  type EncodedSample,
  type EncodePipeline,
} from "./encode-pipeline.js";
import {
  type VideoFrameRate,
  videoFrameDurationMicros,
  videoTimestampMicros,
} from "./frame-rate.js";
import { createMp4Writer, type Mp4Writer } from "./mp4-writer.js";
import { createPaddedFrameCanvas, type PaddedFrameCanvas } from "./padded-canvas.js";

/** One PNG frame of an export, as produced by the deterministic frame sampler. */
export type PngFrameInput = {
  data: Uint8Array;
  timeMs: number;
};

type EncodeFramesOptions = {
  frameRate: VideoFrameRate;
  /** Codec string handed to the encoder. */
  codec: string;
  /** Colour painted behind every frame. H.264 has no alpha channel. */
  background: string;
  /** Expected sample count; sizes the index space reserved for faststart. */
  frameCountHint: number;
  /** Frame count reported to `onProgress`; falls back to the running count. */
  expectedFrameCount?: number;
  bitrate?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  generator?: OutputGenerator;
};

/** Longest export accepted, in frames (two minutes at 30fps). */
export const VIDEO_EXPORT_FRAMES_MAX = 3600;

/** Shortest export accepted, in frames; a single-frame MP4 has no duration to play. */
export const VIDEO_EXPORT_FRAMES_MIN = 2;

/** Bits per pixel per second used to derive a default bitrate. */
const BITRATE_PER_PIXEL_PER_SECOND = 0.15;

const BITRATE_MIN = 1_000_000;
const BITRATE_MAX = 50_000_000;

/** Seconds between forced key frames. */
const KEY_FRAME_INTERVAL_SECONDS = 2;

/** Live state of one export run, created once the first frame settles the size. */
type EncodeRun = {
  canvas: PaddedFrameCanvas;
  writer: Mp4Writer;
  pipeline: EncodePipeline;
  frameSize: { width: number; height: number };
};

/**
 * Encode a PNG frame stream into an MP4 file.
 *
 * Frames are consumed one at a time — decoded, composited onto an even-sized
 * canvas, and handed to the encoder — so nothing accumulates a full clip of
 * pixel buffers. The first frame settles the output size.
 *
 * @throws FatalError with `VIDEO_INVALID_FRAMES`, `VIDEO_INVALID_OPTION`,
 * `VIDEO_TOO_MANY_FRAMES`, `VIDEO_ENCODER_UNSUPPORTED`, or `VIDEO_EXPORT_ABORTED`.
 */
export async function encodeFrames(
  frames: AsyncIterable<PngFrameInput> | Iterable<PngFrameInput>,
  options: EncodeFramesOptions,
): Promise<Uint8Array> {
  let run: EncodeRun | null = null;
  let frameCount = 0;

  try {
    for await (const frame of frames) {
      throwIfExportAborted(options.signal);
      if (frameCount >= VIDEO_EXPORT_FRAMES_MAX) {
        throw tooManyFrames(frameCount + 1);
      }
      // The expected count sizes the container index, so a longer stream would
      // encode in full and only fail at the very end.
      if (options.expectedFrameCount !== undefined && frameCount >= options.expectedFrameCount) {
        throw new FatalError(
          "VIDEO_INVALID_FRAMES",
          `the frame stream is longer than the expected ${options.expectedFrameCount} frames`,
          { frameCount: options.expectedFrameCount },
        );
      }

      const bitmap = await createImageBitmap(
        new Blob([frame.data as BlobPart], { type: "image/png" }),
        // Colour management and premultiplication are per-browser transforms;
        // frames go to the encoder as decoded.
        { colorSpaceConversion: "none", premultiplyAlpha: "none" },
      );
      try {
        run ??= await startRun(bitmap.width, bitmap.height, options);
        assertMatchingFrameSize(run, bitmap, frameCount);
        run.canvas.draw(bitmap);
      } finally {
        bitmap.close();
      }

      const videoFrame = new VideoFrame(run.canvas.source, {
        timestamp: videoTimestampMicros(options.frameRate, frameCount),
        duration: videoFrameDurationMicros(options.frameRate, frameCount),
      });
      await run.pipeline.submit(videoFrame, frameCount);

      frameCount += 1;
      options.onProgress?.(frameCount, options.expectedFrameCount ?? frameCount);
    }

    if (!run || frameCount < VIDEO_EXPORT_FRAMES_MIN) {
      throw new FatalError(
        "VIDEO_INVALID_FRAMES",
        `MP4 export needs at least ${VIDEO_EXPORT_FRAMES_MIN} frames; a shorter clip has no duration to play (got ${frameCount})`,
        { frameCount },
      );
    }
    await run.pipeline.finish();

    // One sample per submitted frame is what makes the fixed per-sample
    // duration equal the animation length.
    const sampleCount = run.writer.sampleCount();
    if (sampleCount !== frameCount) {
      throw new FatalError(
        "VIDEO_ENCODER_UNSUPPORTED",
        `the encoder returned ${sampleCount} samples for ${frameCount} frames; MP4 export needs one sample per frame`,
        { sampleCount, frameCount },
      );
    }
    return run.writer.finish();
  } catch (error) {
    run?.pipeline.close();
    run?.writer.dispose();
    throw error;
  }
}

async function startRun(
  frameWidth: number,
  frameHeight: number,
  options: EncodeFramesOptions,
): Promise<EncodeRun> {
  // Samples cannot arrive before the first frame is submitted, which is after
  // this function returns; until then there is nothing to write them to.
  let writeSample: (sample: EncodedSample) => void = () => {};

  const canvas = createPaddedFrameCanvas(frameWidth, frameHeight, options.background);
  // The encoder settles its configuration first: the container has to describe
  // the stream the encoder actually produces, not the one that was requested.
  const pipeline = await createEncodePipeline({
    config: buildEncoderConfig(canvas, options),
    keyFrameInterval: resolveKeyFrameInterval(options.frameRate),
    onSample: (sample) => {
      writeSample(sample);
    },
    ...(options.signal !== undefined && { signal: options.signal }),
  });

  let writer: Mp4Writer;
  try {
    writer = await createMp4Writer({
      width: pipeline.config.width,
      height: pipeline.config.height,
      frameRate: options.frameRate,
      frameCountHint: options.frameCountHint,
      ...(options.generator !== undefined && { generator: options.generator }),
    });
  } catch (error) {
    pipeline.close();
    throw error;
  }
  writeSample = (sample) => {
    writer.write(sample);
  };

  return { canvas, writer, pipeline, frameSize: { width: frameWidth, height: frameHeight } };
}

/**
 * Reject a frame the run was not sized for.
 *
 * The canvas is fixed by the first frame, so a larger one would be cropped and
 * a smaller one would leave the previous frame's pixels showing through.
 */
function assertMatchingFrameSize(
  run: EncodeRun,
  bitmap: { width: number; height: number },
  frameIndex: number,
): void {
  if (bitmap.width === run.frameSize.width && bitmap.height === run.frameSize.height) {
    return;
  }
  throw new FatalError(
    "VIDEO_INVALID_FRAMES",
    `every frame must be the same size: frame ${frameIndex} is ${bitmap.width}x${bitmap.height}, expected ${run.frameSize.width}x${run.frameSize.height}`,
    { frameIndex },
  );
}

function buildEncoderConfig(
  canvas: PaddedFrameCanvas,
  options: EncodeFramesOptions,
): VideoEncoderConfig {
  const { numerator, denominator } = options.frameRate;
  return {
    codec: options.codec,
    width: canvas.width,
    height: canvas.height,
    bitrate: resolveBitrate(canvas, options),
    framerate: numerator / denominator,
    // Length-prefixed NAL units with an avcC description; annexb would force us
    // to re-extract SPS/PPS ourselves.
    avc: { format: "avc" },
    // latencyMode is deliberately left at the default: "realtime" is allowed to
    // drop frames to keep up with the declared rate, and this is an offline
    // export that needs every frame. Output the encoder reorders instead is
    // caught by the ordering check in the writer.
  };
}

function resolveBitrate(canvas: PaddedFrameCanvas, options: EncodeFramesOptions): number {
  const { bitrate } = options;
  if (bitrate === undefined) {
    return resolveDefaultBitrate(canvas, options.frameRate);
  }
  if (!Number.isSafeInteger(bitrate) || bitrate <= 0) {
    throw new FatalError(
      "VIDEO_INVALID_OPTION",
      `bitrate must be a positive whole number of bits per second (got ${String(bitrate)})`,
      { bitrate },
    );
  }
  return bitrate;
}

function resolveDefaultBitrate(canvas: PaddedFrameCanvas, frameRate: VideoFrameRate): number {
  const framesPerSecond = frameRate.numerator / frameRate.denominator;
  const target = Math.round(
    canvas.width * canvas.height * framesPerSecond * BITRATE_PER_PIXEL_PER_SECOND,
  );
  return Math.min(Math.max(target, BITRATE_MIN), BITRATE_MAX);
}

function resolveKeyFrameInterval(frameRate: VideoFrameRate): number {
  const framesPerSecond = frameRate.numerator / frameRate.denominator;
  return Math.max(1, Math.round(KEY_FRAME_INTERVAL_SECONDS * framesPerSecond));
}

export function tooManyFrames(frameCount: number): FatalError {
  return new FatalError(
    "VIDEO_TOO_MANY_FRAMES",
    `MP4 export is limited to ${VIDEO_EXPORT_FRAMES_MAX} frames (got ${frameCount})`,
    { frameCount, frameCountMax: VIDEO_EXPORT_FRAMES_MAX },
  );
}
