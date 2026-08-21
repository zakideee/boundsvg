import type {
  CompiledScene,
  Engine,
  EngineInput,
  Frame,
  OutputGenerator,
  RasterOversizeBehavior,
  RecoverableError,
  RenderCompiledFramesOptions,
} from "@boundsvg/core";
import { FatalError } from "@boundsvg/core";
import { throwIfExportAborted } from "./abort.js";
import {
  encodeFrames,
  type PngFrameInput,
  tooManyFrames,
  VIDEO_EXPORT_FRAMES_MAX,
  VIDEO_EXPORT_FRAMES_MIN,
} from "./encode-frames.js";
import { resolveVideoFrameRate, type VideoFrameRate, videoSampleTimeMs } from "./frame-rate.js";

export type Mp4ExportOptions = {
  /** Frame rate; default 30. Fractional NTSC rates need their rational form or alias. */
  frameRate?: number | VideoFrameRate;
  /** Clip length; required unless `timesMs` is given. */
  durationMs?: number;
  /**
   * Explicit sample schedule, mutually exclusive with `durationMs`.
   *
   * Playback timing comes from `frameRate` alone, so the times must be the ones
   * that rate produces; a differently spaced schedule is rejected rather than
   * played at the wrong speed.
   */
  timesMs?: readonly number[];
  /** Target bitrate in bits per second; default scales with frame size and rate. */
  bitrate?: number;
  /**
   * WebCodecs codec string; default `"avc1.640028"` (H.264 High, level 4.0).
   *
   * Level 4.0 covers 1080p30. Larger or faster exports — 1080p60, 4K — need a
   * higher level, e.g. `"avc1.640033"` (5.1).
   */
  codec?: string;
  /** Colour painted behind every frame; default `"#ffffff"`. H.264 has no alpha. */
  background?: string;
  scale?: number;
  /** Video has no loop concept — the option exists only to reject it at the type level. */
  loopHint?: never;
  signal?: AbortSignal;
  /** Reports encode progress. `total` equals `done` when the frame count is unknown up front. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Receives recoverable render warnings — missing glyphs, font fallback.
   *
   * They come from the compiled scene, so each one is reported once per export,
   * before the first frame is sampled — not once per frame.
   */
  onWarning?: (warning: RecoverableError) => void;
  /** How to handle a frame larger than the rasterizer's limit; forwarded to the sampler. */
  rasterOversizeBehavior?: RasterOversizeBehavior;
  /** Unsigned public generator identity embedded in the completed MP4 file. */
  generator?: OutputGenerator;
};

/** Options for encoding a frame sequence that was sampled elsewhere. */
export type PngFramesMp4ExportOptions = Omit<
  Mp4ExportOptions,
  "durationMs" | "timesMs" | "scale" | "onWarning" | "rasterOversizeBehavior"
> & {
  frameRate: number | VideoFrameRate;
  /** Frame count when known: sharpens progress reporting and the container index. */
  frameCount?: number;
};

/** Frame rate used when the caller does not ask for one. */
const FRAME_RATE_DEFAULT = 30;

/** Background painted behind frames when the caller does not ask for one. */
const BACKGROUND_DEFAULT = "#ffffff";

/** H.264 High profile, level 4.0 — the widest-supported WebCodecs configuration. */
const CODEC_DEFAULT = "avc1.640028";

/**
 * Slack allowed when matching an explicit schedule against the frame rate.
 *
 * Well under the microsecond resolution of the encoder's own timestamps, so it
 * only absorbs floating-point noise from an equivalent formula.
 */
const SCHEDULE_TOLERANCE_MS = 1e-6;

const MILLIS_PER_SECOND = 1000;
const PACKAGE_NAME_PATTERN =
  /^(?:[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/u;

/**
 * Render an animated scene straight to an MP4 file.
 *
 * Frames are sampled deterministically through `renderFrames`, encoded with
 * WebCodecs, and framed by the bundled MP4 muxer. Encoding itself is outside
 * the byte-determinism contract — it depends on the browser's encoder.
 *
 * @throws FatalError with `VIDEO_INVALID_SCHEDULE` (the sample schedule),
 * `VIDEO_INVALID_OPTION` (any other option value), `VIDEO_INVALID_FRAMES` (the
 * sampled frames), `VIDEO_INVALID_FRAME_RATE`, `VIDEO_TOO_MANY_FRAMES`,
 * `VIDEO_ENCODER_UNSUPPORTED`, or `VIDEO_EXPORT_ABORTED`.
 */
export async function renderToMp4(
  engine: Engine,
  input: EngineInput,
  options: Mp4ExportOptions = {},
): Promise<Uint8Array> {
  return renderMp4WithFrameProducer(options, (frameOptions) =>
    engine.renderFrames(input, frameOptions),
  );
}

/**
 * Render a call-time snapshot of an already compiled animation to MP4.
 *
 * Schedule validation, WebCodecs encoding, muxing, cancellation, and cleanup
 * are shared with {@link renderToMp4}; only the frame producer differs.
 */
export async function renderCompiledToMp4(
  engine: Engine,
  compiled: CompiledScene,
  options: Mp4ExportOptions = {},
): Promise<Uint8Array> {
  return renderMp4WithFrameProducer(options, (frameOptions) =>
    engine.renderCompiledFrames(compiled, frameOptions),
  );
}

type Mp4FrameProducer = (options: RenderCompiledFramesOptions) => Iterable<Frame>;

async function renderMp4WithFrameProducer(
  options: Mp4ExportOptions,
  frameProducer: Mp4FrameProducer,
): Promise<Uint8Array> {
  // Both core frame producers prepare native state eagerly, so an abandoned
  // export should not pay for it.
  throwIfExportAborted(options.signal);
  assertValidOutputGenerator(options.generator);
  const frameRate = resolveVideoFrameRate(options.frameRate ?? FRAME_RATE_DEFAULT);
  const timesMs = resolveSchedule(options, frameRate);
  const background = options.background ?? BACKGROUND_DEFAULT;

  const frames = frameProducer({
    timesMs,
    format: "png",
    ...(options.scale !== undefined && { scale: options.scale }),
    rasterBackground: background,
    // Without these the sampler's recoverable warnings and oversize policy are
    // silently dropped for the whole export.
    ...(options.onWarning !== undefined && { onWarning: options.onWarning }),
    ...(options.rasterOversizeBehavior !== undefined && {
      rasterOversizeBehavior: options.rasterOversizeBehavior,
    }),
  });

  return encodeFrames(toPngFrames(frames), {
    frameRate,
    background,
    codec: options.codec ?? CODEC_DEFAULT,
    frameCountHint: timesMs.length,
    expectedFrameCount: timesMs.length,
    ...(options.bitrate !== undefined && { bitrate: options.bitrate }),
    ...(options.signal !== undefined && { signal: options.signal }),
    ...(options.onProgress !== undefined && { onProgress: options.onProgress }),
    ...(options.generator !== undefined && { generator: options.generator }),
  });
}

/**
 * Encode an existing PNG frame sequence into an MP4 file.
 *
 * Frame order defines the container timeline; the `timeMs` each frame carries
 * is not used for timing. The first frame fixes the output size.
 *
 * @throws FatalError with the same codes as {@link renderToMp4}.
 */
export async function encodePngFramesToMp4(
  frames: AsyncIterable<PngFrameInput> | Iterable<PngFrameInput>,
  options: PngFramesMp4ExportOptions,
): Promise<Uint8Array> {
  assertValidOutputGenerator(options.generator);
  const frameRate = resolveVideoFrameRate(options.frameRate);
  const declaredFrameCount = options.frameCount;
  if (declaredFrameCount !== undefined) {
    if (!Number.isSafeInteger(declaredFrameCount) || declaredFrameCount < VIDEO_EXPORT_FRAMES_MIN) {
      throw new FatalError(
        "VIDEO_INVALID_OPTION",
        `frameCount must be a whole number of at least ${VIDEO_EXPORT_FRAMES_MIN} (got ${String(declaredFrameCount)})`,
        { frameCount: declaredFrameCount },
      );
    }
    if (declaredFrameCount > VIDEO_EXPORT_FRAMES_MAX) {
      throw tooManyFrames(declaredFrameCount);
    }
    // A count that contradicts a sequence whose length is right there would size
    // the index for frames that never arrive and report progress against a total
    // the export cannot reach.
    const actualLength = arrayLength(frames);
    if (actualLength !== undefined && actualLength !== declaredFrameCount) {
      throw new FatalError(
        "VIDEO_INVALID_OPTION",
        `frameCount is ${declaredFrameCount} but the frames given are ${actualLength} long`,
        { frameCount: declaredFrameCount, actualLength },
      );
    }
  }
  // A sequence that already knows its length needs no hint: taking it here sizes
  // the container index exactly instead of reserving for the frame ceiling. An
  // unusable length is left alone so the frame-stream checks report it as one.
  const frameCount = declaredFrameCount ?? usableLength(frames);

  return encodeFrames(frames, {
    frameRate,
    background: options.background ?? BACKGROUND_DEFAULT,
    codec: options.codec ?? CODEC_DEFAULT,
    // Without a count, hold room for the ceiling: a reservation that turns out
    // too small would cost the faststart layout.
    frameCountHint: frameCount ?? VIDEO_EXPORT_FRAMES_MAX,
    ...(frameCount !== undefined && { expectedFrameCount: frameCount }),
    ...(options.bitrate !== undefined && { bitrate: options.bitrate }),
    ...(options.signal !== undefined && { signal: options.signal }),
    ...(options.onProgress !== undefined && { onProgress: options.onProgress }),
    ...(options.generator !== undefined && { generator: options.generator }),
  });
}

function assertValidOutputGenerator(generator: OutputGenerator | undefined): void {
  if (generator === undefined) {
    return;
  }
  if (!isValidPackageName(generator.name)) {
    throw new FatalError(
      "VIDEO_INVALID_OPTION",
      "generator.name must be a lowercase package identifier of at most 64 ASCII characters",
    );
  }
  if (
    generator.version.length === 0 ||
    generator.version.length > 64 ||
    !/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/u.test(generator.version)
  ) {
    throw new FatalError(
      "VIDEO_INVALID_OPTION",
      "generator.version must start with an ASCII letter or digit, contain only ASCII letters, digits, '.', '+', '-' or '_', and be at most 64 characters",
    );
  }
}

function isValidPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && PACKAGE_NAME_PATTERN.test(name);
}

function resolveSchedule(options: Mp4ExportOptions, frameRate: VideoFrameRate): number[] {
  if (options.timesMs !== undefined) {
    if (options.durationMs !== undefined) {
      throw new FatalError(
        "VIDEO_INVALID_SCHEDULE",
        "pass either durationMs or timesMs to renderToMp4, not both",
      );
    }
    if (options.timesMs.length > VIDEO_EXPORT_FRAMES_MAX) {
      throw tooManyFrames(options.timesMs.length);
    }
    if (options.timesMs.length < VIDEO_EXPORT_FRAMES_MIN) {
      throw new FatalError(
        "VIDEO_INVALID_SCHEDULE",
        `timesMs needs at least ${VIDEO_EXPORT_FRAMES_MIN} entries; a one-frame MP4 has no duration to play (got ${options.timesMs.length})`,
        { frameCount: options.timesMs.length },
      );
    }
    assertFrameRateSchedule(options.timesMs, frameRate);
    return [...options.timesMs];
  }

  const { durationMs } = options;
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new FatalError(
      "VIDEO_INVALID_SCHEDULE",
      `renderToMp4 needs a positive durationMs, or an explicit timesMs schedule (got ${String(durationMs)})`,
      { durationMs },
    );
  }

  const framesPerSecond = frameRate.numerator / frameRate.denominator;
  const frameCount = Math.max(
    VIDEO_EXPORT_FRAMES_MIN,
    Math.ceil((durationMs / MILLIS_PER_SECOND) * framesPerSecond),
  );
  if (frameCount > VIDEO_EXPORT_FRAMES_MAX) {
    throw tooManyFrames(frameCount);
  }
  return buildFrameRateSchedule(frameRate, frameCount);
}

function buildFrameRateSchedule(frameRate: VideoFrameRate, frameCount: number): number[] {
  return Array.from({ length: frameCount }, (_unused, index) =>
    videoSampleTimeMs(frameRate, index),
  );
}

/**
 * Reject a schedule the container cannot represent.
 *
 * Every sample lasts exactly one frame-rate tick, so times spaced at any other
 * interval would play back at a different speed than they sample.
 */
function assertFrameRateSchedule(timesMs: readonly number[], frameRate: VideoFrameRate): void {
  const expected = buildFrameRateSchedule(frameRate, timesMs.length);
  // Negated rather than compared with `>` so a NaN entry, which fails every
  // comparison, is reported here instead of deeper in the sampler.
  const mismatchIndex = timesMs.findIndex(
    (timeMs, index) => !(Math.abs(timeMs - (expected[index] ?? 0)) <= SCHEDULE_TOLERANCE_MS),
  );
  if (mismatchIndex === -1) {
    return;
  }
  throw new FatalError(
    "VIDEO_INVALID_SCHEDULE",
    `timesMs must be spaced at 1/frameRate because MP4 playback timing comes from frameRate alone; frame ${mismatchIndex} is at ${String(timesMs[mismatchIndex])}ms, expected ${String(expected[mismatchIndex])}ms`,
    { frameRate, mismatchIndex },
  );
}

function* toPngFrames(frames: Iterable<Frame>): Generator<PngFrameInput> {
  for (const frame of frames) {
    if (frame.format !== "png") {
      throw new FatalError(
        "VIDEO_INVALID_FRAMES",
        `MP4 export needs PNG frames but received a ${frame.format} frame`,
      );
    }
    yield { data: frame.data, timeMs: frame.timeMs };
  }
}

/**
 * Length of a frame sequence that both carries one and could be encoded.
 *
 * Only arrays qualify: reading `length` off a generator or an async source
 * would either be absent or, worse, an unrelated property. A length outside the
 * encodable range is reported as undefined rather than declared, so the failure
 * comes from the frame stream itself instead of an option the caller never set.
 */
function usableLength(
  frames: AsyncIterable<PngFrameInput> | Iterable<PngFrameInput>,
): number | undefined {
  const length = arrayLength(frames);
  if (length === undefined) {
    return undefined;
  }
  return length >= VIDEO_EXPORT_FRAMES_MIN && length <= VIDEO_EXPORT_FRAMES_MAX
    ? length
    : undefined;
}

/** Length of a frame sequence that is an array, whatever that length is. */
function arrayLength(
  frames: AsyncIterable<PngFrameInput> | Iterable<PngFrameInput>,
): number | undefined {
  return Array.isArray(frames) ? (frames as readonly PngFrameInput[]).length : undefined;
}
