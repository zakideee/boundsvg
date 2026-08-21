import { FatalError } from "@boundsvg/core";
import { throwIfExportAborted } from "./abort.js";

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
  let isClosed = false;

  const encoder = new encoderConstructor({
    output: (chunk, metadata) => {
      // This callback runs on the encoder's own task, so a throw here would be
      // lost without being captured and rethrown at the next submit or finish.
      try {
        options.onSample(toEncodedSample(chunk, metadata));
      } catch (error: unknown) {
        encoderError ??= error;
      }
    },
    error: (error) => {
      encoderError ??= error;
    },
  });
  const close = (): void => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    encoder.close();
  };

  try {
    encoder.configure(config);
  } catch (error) {
    close();
    throw unsupportedConfig(config, error);
  }

  const throwIfFailed = (): void => {
    if (encoderError !== undefined) {
      const failure = encoderError;
      encoderError = undefined;
      close();
      throw asEncoderFailure(failure);
    }
  };

  const throwIfAborted = (): void => {
    try {
      throwIfExportAborted(options.signal);
    } catch (error) {
      close();
      throw error;
    }
  };

  return {
    config,
    async submit(frame, frameIndex) {
      try {
        throwIfAborted();
        throwIfFailed();
        while (encoder.encodeQueueSize >= ENCODE_QUEUE_SIZE_MAX) {
          await nextTask();
          throwIfAborted();
          throwIfFailed();
        }
        encoder.encode(frame, { keyFrame: frameIndex % options.keyFrameInterval === 0 });
      } finally {
        // Frames hold decoded pixel buffers that GC reclaims far too late.
        frame.close();
      }
    },
    async finish() {
      throwIfAborted();
      throwIfFailed();
      await encoder.flush().catch((error: unknown) => {
        close();
        throw asEncoderFailure(error);
      });
      // flush() resolves only after every output callback has run, so a failure
      // raised inside one is visible by now.
      throwIfFailed();
      close();
    },
    close,
  };
}

function resolveAmbientEncoder(): VideoEncoderConstructorLike {
  const ambient = (globalThis as Record<string, unknown>).VideoEncoder as
    | VideoEncoderConstructorLike
    | undefined;
  if (!ambient) {
    throw new FatalError(
      "VIDEO_ENCODER_UNSUPPORTED",
      "WebCodecs VideoEncoder is unavailable in this runtime; MP4 export needs a browser that supports it",
    );
  }
  return ambient;
}

async function resolveSupportedConfig(
  encoderConstructor: VideoEncoderConstructorLike,
  config: VideoEncoderConfig,
): Promise<VideoEncoderConfig> {
  // A configuration the runtime considers malformed rejects here with a
  // TypeError, which would otherwise reach the caller untyped.
  const support = await encoderConstructor.isConfigSupported(config).catch((error: unknown) => {
    throw unsupportedConfig(config, error);
  });
  if (!support.supported) {
    throw unsupportedConfig(config);
  }
  // The runtime may hand back a normalized configuration; it takes precedence,
  // but only where it still describes the stream the container will declare.
  const resolved = support.config ?? config;
  // An omitted `avc` means the runtime did not echo the field, not that it
  // changed the bitstream format; a different value does mean that.
  if (
    resolved.width !== config.width ||
    resolved.height !== config.height ||
    (resolved.avc !== undefined && resolved.avc.format !== "avc")
  ) {
    throw unsupportedConfig(config, "the runtime normalized the request into a different stream");
  }
  return resolved;
}

function unsupportedConfig(config: VideoEncoderConfig, cause?: unknown): FatalError {
  const detail = cause === undefined ? "" : `: ${describeError(cause)}`;
  return new FatalError(
    "VIDEO_ENCODER_UNSUPPORTED",
    `this runtime cannot encode ${config.codec} at ${config.width}x${config.height}${detail}`,
    { codec: config.codec, width: config.width, height: config.height },
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function asEncoderFailure(error: unknown): FatalError {
  if (error instanceof FatalError) {
    return error;
  }
  const detail = describeError(error);
  return new FatalError("VIDEO_ENCODER_UNSUPPORTED", `video encoding failed: ${detail}`, {
    cause: detail,
  });
}

/** Yield to the event loop so the encoder can drain its queue. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
