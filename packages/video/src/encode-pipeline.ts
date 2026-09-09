import { throwIfExportAborted } from "./abort.js";
import { cleanupAfterFailure, createVideoError } from "./diagnostics.js";

/** One encoded frame handed to the container writer. */
export type EncodedSample = {
  bytes: Uint8Array;
  /** Presentation time the encoder reported; checked for ordering, not written. */
  timestampMicros: number;
  keyFrame: boolean;
  /** `avcC` record reported alongside the first key chunk, when present. */
  codecDescription?: Uint8Array;
};

/**
 * The slice of `VideoEncoder` this package uses.
 *
 * Declared structurally so tests can drive the pipeline without WebCodecs.
 */
export type VideoEncoderLike = {
  readonly encodeQueueSize: number;
  configure(config: VideoEncoderConfig): void;
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void;
  flush(): Promise<void>;
  close(): void;
};

/** Constructor side of {@link VideoEncoderLike}, including config probing. */
export type VideoEncoderConstructorLike = {
  new (init: VideoEncoderInit): VideoEncoderLike;
  isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
};

type EncodePipelineOptions = {
  config: VideoEncoderConfig;
  /** Distance between forced key frames, in frames. */
  keyFrameInterval: number;
  /**
   * Receives samples in encode order.
   *
   * Synchronous on purpose: it runs inside the encoder's own output task, where
   * a rejected promise has no caller to reach. The container writer it feeds is
   * synchronous, so there is nothing to await.
   */
  onSample: (sample: EncodedSample) => void;
  signal?: AbortSignal;
  /** Encoder implementation; defaults to the ambient `VideoEncoder`. */
  encoderConstructor?: VideoEncoderConstructorLike;
};

/** Encoder-facing handle over one export run. */
export type EncodePipeline = {
  /** Configuration the runtime accepted, which may differ from the request. */
  readonly config: VideoEncoderConfig;
  /** Encode one frame and close it. Frame ownership transfers to the pipeline. */
  submit(frame: VideoFrame, frameIndex: number): Promise<void>;
  /** Flush the encoder, then release it. */
  finish(): Promise<void>;
  /** Release the encoder without flushing. Safe to call twice. */
  close(): void;
};

/**
 * Frames allowed in the encoder queue before submission waits.
 *
 * Unbounded submission grows the queue faster than the encoder drains it and
 * exhausts memory on long clips.
 */
const ENCODE_QUEUE_SIZE_MAX = 8;

/**
 * Set up a WebCodecs encoder and stream its output to `onSample`.
 *
 * @throws FatalError `VIDEO_ENCODER_UNSUPPORTED` when WebCodecs is missing or
 * the configuration is rejected.
 */
export async function createEncodePipeline(
  options: EncodePipelineOptions,
): Promise<EncodePipeline> {
  const encoderConstructor = options.encoderConstructor ?? resolveAmbientEncoder();
  const config = await resolveSupportedConfig(encoderConstructor, options.config);

  // An encoder reports failures through its error callback, where throwing
  // cannot reach the caller; it is rethrown at the next submit or finish.
  let encoderError: unknown;
  let hasEncoderError = false;
  let isClosed = false;
  const captureFailure = (failure: unknown): void => {
    if (!hasEncoderError) {
      hasEncoderError = true;
      encoderError = failure;
    }
  };
  let encoder: VideoEncoderLike;
  try {
    encoder = new encoderConstructor({
      output: (chunk, metadata) => {
        if (hasEncoderError) {
          return;
        }
        let sample: EncodedSample;
        try {
          sample = toEncodedSample(chunk, metadata);
        } catch {
          captureFailure(createVideoError("VIDEO_ENCODER_FAILED", "receiveSample"));
          return;
        }
        try {
          options.onSample(sample);
        } catch (failure) {
          captureFailure(failure);
        }
      },
      error: () => {
        captureFailure(createVideoError("VIDEO_ENCODER_FAILED", "encodeFrame"));
      },
    });
  } catch {
    throw createVideoError("VIDEO_ENCODER_FAILED", "createEncoder");
  }
  const close = (): void => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    try {
      encoder.close();
    } catch {
      throw createVideoError("VIDEO_ENCODER_FAILED", "closeEncoder");
    }
  };
  try {
    encoder.configure(config);
  } catch {
    cleanupAfterFailure(close);
    throw createVideoError("VIDEO_ENCODER_UNSUPPORTED", "configureEncoder");
  }
  const throwIfFailed = (): void => {
    if (hasEncoderError) {
      cleanupAfterFailure(close);
      throw encoderError;
    }
  };
  const throwIfAborted = (): void => {
    try {
      throwIfExportAborted(options.signal);
    } catch (failure) {
      cleanupAfterFailure(close);
      throw failure;
    }
  };
  return {
    config,
    async submit(frame, frameIndex) {
      let hasPrimaryFailure = false;
      try {
        throwIfAborted();
        throwIfFailed();
        while (encoder.encodeQueueSize >= ENCODE_QUEUE_SIZE_MAX) {
          await nextTask();
          throwIfAborted();
          throwIfFailed();
        }
        try {
          encoder.encode(frame, { keyFrame: frameIndex % options.keyFrameInterval === 0 });
        } catch {
          throwIfFailed();
          throw createVideoError("VIDEO_ENCODER_FAILED", "encodeFrame");
        }
      } catch (failure) {
        hasPrimaryFailure = true;
        cleanupAfterFailure(close);
        throw failure;
      } finally {
        closeSubmittedFrame(frame, hasPrimaryFailure, () => {
          cleanupAfterFailure(close);
          throwIfFailed();
        });
      }
    },
    async finish() {
      throwIfAborted();
      throwIfFailed();
      try {
        await encoder.flush();
      } catch {
        cleanupAfterFailure(close);
        throwIfFailed();
        throw createVideoError("VIDEO_ENCODER_FAILED", "flushEncoder");
      }
      throwIfFailed();
      close();
    },
    close,
  };
}

function closeSubmittedFrame(
  frame: VideoFrame,
  hasPrimaryFailure: boolean,
  beforeFailure: () => void,
): void {
  try {
    frame.close();
  } catch {
    if (!hasPrimaryFailure) {
      beforeFailure();
      throw createVideoError("VIDEO_ENCODER_FAILED", "closeFrame");
    }
  }
}

function resolveAmbientEncoder(): VideoEncoderConstructorLike {
  const ambient = (globalThis as Record<string, unknown>).VideoEncoder as
    | VideoEncoderConstructorLike
    | undefined;
  if (!ambient) {
    throw createVideoError("VIDEO_ENCODER_UNSUPPORTED", "probeEncoder");
  }
  return ambient;
}

async function resolveSupportedConfig(
  encoderConstructor: VideoEncoderConstructorLike,
  config: VideoEncoderConfig,
): Promise<VideoEncoderConfig> {
  let support: VideoEncoderSupport;
  try {
    support = await encoderConstructor.isConfigSupported(config);
  } catch {
    throw createVideoError("VIDEO_ENCODER_UNSUPPORTED", "probeEncoder");
  }
  if (!support.supported) {
    throw createVideoError("VIDEO_ENCODER_UNSUPPORTED", "probeEncoder");
  }
  const resolved = support.config ?? config;
  // Only accept normalization that still describes the container's requested stream.
  if (
    resolved.width !== config.width ||
    resolved.height !== config.height ||
    (resolved.avc !== undefined && resolved.avc.format !== "avc")
  ) {
    throw createVideoError("VIDEO_ENCODER_UNSUPPORTED", "probeEncoder");
  }
  return resolved;
}

function toEncodedSample(
  chunk: EncodedVideoChunk,
  metadata: EncodedVideoChunkMetadata | undefined,
): EncodedSample {
  const bytes = new Uint8Array(chunk.byteLength);
  chunk.copyTo(bytes);
  const description = metadata?.decoderConfig?.description;
  return {
    bytes,
    timestampMicros: chunk.timestamp,
    keyFrame: chunk.type === "key",
    ...(description !== undefined && { codecDescription: toUint8Array(description) }),
  };
}

function toUint8Array(source: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    );
  }
  return new Uint8Array(source.slice(0));
}

/** Yield to the event loop so the encoder can drain its queue. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
