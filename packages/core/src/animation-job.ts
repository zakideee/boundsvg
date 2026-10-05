/** A shared animation job owns lazy sampling, one native session and callback cleanup. */
import {
  type AnimatedRasterFormat,
  type AnimatedRasterOperation,
  animatedRasterFailure,
  animatedRasterSinkFailure,
} from "./animation-errors.js";
import type {
  AnimatedRasterSink,
  AnimatedRasterWriteResult,
  AnimatedWebpSink,
} from "./animation-output.js";
import {
  type AnimationScheduleCursor,
  type AnimationScheduleDescriptor,
  createAnimationScheduleCursor,
  createGifDelayCursor,
  GIF_DELAY_UNIT_MS,
  GIF_MIN_FRAME_MS,
} from "./animation-schedule.js";
import type { CompiledScene } from "./compiled-scene.js";
import type {
  CompileOptions,
  Engine,
  EngineInput,
  PngResolutionAdjustedWarning,
  RenderAnimatedGifOptions,
  RenderAnimatedWebpOptions,
  RenderCompiledAnimatedGifOptions,
  RenderCompiledAnimatedWebpOptions,
} from "./engine.js";
import {
  createInternalRecoverableError,
  RecoverableError,
  type SerializedRecoverableError,
} from "./errors.js";
import type { LayoutTransitionInput } from "./layout-transition.js";
import type {
  AnimatedRasterSessionHandle,
  AnimationRenderOptions,
  AnimationSessionFinishOutput,
} from "./wasm/animation-session.js";

/** Source whose compile choices have already been authenticated or snapshotted. */
type AnimatedRasterCompiledSource =
  | { kind: "compiled"; compiled: CompiledScene }
  | { kind: "transition"; input: LayoutTransitionInput; compileOptions?: CompileOptions };

/** Six supported format/source combinations for low-level streaming integrations. */
export type AnimatedRasterJobInput =
  | {
      format: "webp";
      source: { kind: "scene"; input: EngineInput };
      options: Omit<RenderAnimatedWebpOptions, "onWarning">;
    }
  | {
      format: "gif";
      source: { kind: "scene"; input: EngineInput };
      options: Omit<RenderAnimatedGifOptions, "onWarning">;
    }
  | {
      format: "webp";
      source: AnimatedRasterCompiledSource;
      options: Omit<RenderCompiledAnimatedWebpOptions, "onWarning">;
    }
  | {
      format: "gif";
      source: AnimatedRasterCompiledSource;
      options: Omit<RenderCompiledAnimatedGifOptions, "onWarning">;
    };

/** One bounded preparation, warning, output or completion step. */
export type AnimatedRasterJobStep =
  | { kind: "preparing" }
  | { kind: "ready"; warnings: readonly SerializedRecoverableError[] }
  | { kind: "chunk"; chunk: Uint8Array }
  | {
      kind: "finished";
      result: AnimatedRasterWriteResult;
      patch?: { offset: 4; bytes: Uint8Array };
    };

/** Owned producer; close it even if no first frame was requested. */
export type AnimatedRasterFrameProducer = {
  /** Push one native sample synchronously; false means the lazy schedule is exhausted. */
  pushNext(session: AnimatedRasterSessionHandle): boolean;
  /** Release the prepared scene and cursor; repeated cleanup is harmless. */
  return(): void;
};

/** Pull-driven animation owner shared by Core sinks and Worker transport. */
export type AnimatedRasterJob = {
  /** Run at most one scan batch, ready notification, output chunk or completion. */
  advance(): AnimatedRasterJobStep;
  /** Cancel synchronous resources without releasing a pending external IO lease. */
  abort(): void;
  /** Release owned resources and the animation token once. */
  dispose(): void;
};

/** Engine-private factory capability, unavailable on arbitrary Engine-shaped objects. */
type AnimatedRasterJobFactory = (
  input: AnimatedRasterJobInput,
  signal?: AbortSignal,
) => AnimatedRasterJob;
/** Registration separates package integration from public Engine properties. */
const factories = new WeakMap<Engine, AnimatedRasterJobFactory>();
/** Largest schedule scan batch before yielding back to the host task queue. */
const SCAN_ENTRIES_MAX = 4096;
/** Longest cooperative frame-processing interval before a host task yield. */
const FRAME_TASK_MS = 8;
/** Captured brand getter prevents an own property from masking cancellation. */
const signalAbortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

/** Register a private factory from an authentic Engine constructor. */
export function registerAnimatedRasterJobFactory(
  engine: Engine,
  factory: AnimatedRasterJobFactory,
): void {
  factories.set(engine, factory);
}

/** Create an owned streaming job; callers must dispose it after completion or cancellation. */
export function createAnimatedRasterJob(
  engine: Engine,
  input: AnimatedRasterJobInput,
  signal?: AbortSignal,
): AnimatedRasterJob {
  const factory = factories.get(engine);
  if (!factory) {
    throw animatedRasterFailure(input?.format === "gif" ? "gif" : "webp", "open", {
      family: "SESSION_INVALID_INPUT",
      reason: "wrongType",
      field: "options",
    });
  }
  return factory(input, signal);
}

/** Authenticate the native AbortSignal brand before adopting a job or sink. */
export function assertAnimationSignal(
  signal: unknown,
  format: AnimatedRasterFormat,
): asserts signal is AbortSignal | undefined {
  if (signal === undefined) {
    return;
  }
  try {
    if (
      !signalAbortedGetter ||
      typeof Reflect.apply(signalAbortedGetter, signal, []) !== "boolean"
    ) {
      throw undefined;
    }
  } catch {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: signal === null ? "nullField" : "wrongType",
      field: "options",
    });
  }
}

/** Read the authenticated signal's native cancellation state. */
export function isAnimationSignalAborted(signal: AbortSignal | undefined): boolean {
  return (
    signal !== undefined &&
    signalAbortedGetter !== undefined &&
    Reflect.apply(signalAbortedGetter, signal, []) === true
  );
}

/** Copy arrays, nested props and typed assets once before the first asynchronous step. */
export function snapshotAnimationInput<T>(input: T, format: AnimatedRasterFormat): T {
  const seen = new WeakMap<object, unknown>();
  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (seen.has(value)) {
      return seen.get(value);
    }
    if (value instanceof Uint8Array) {
      const bytes = value.slice();
      seen.set(value, bytes);
      return bytes;
    }
    if (Array.isArray(value)) {
      const array: unknown[] = new Array(value.length);
      seen.set(value, array);
      for (let index = 0; index < value.length; index += 1) {
        array[index] = copy(value[index]);
      }
      return array;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw animatedRasterFailure(format, "open", {
        family: "SESSION_INVALID_INPUT",
        reason: "wrongType",
        field: "options",
      });
    }
    const object: Record<string, unknown> = Object.create(prototype) as Record<string, unknown>;
    seen.set(value, object);
    for (const key of Object.keys(value)) {
      Object.defineProperty(object, key, {
        value: copy(Reflect.get(value, key)),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return object;
  };
  return copy(input) as T;
}

/** Backend work supplied by Engine after source/options authentication and one snapshot. */
type AnimatedRasterJobBackend = {
  format: AnimatedRasterFormat;
  descriptor: AnimationScheduleDescriptor;
  signal?: AbortSignal;
  isDisposed(): boolean;
  prepare(timingWarning: RecoverableError | undefined):
    | {
        kind: "ready";
        producer: AnimatedRasterFrameProducer;
        renderOptions: AnimationRenderOptions;
        warnings: readonly SerializedRecoverableError[];
      }
    | { kind: "failed"; error: unknown; warnings: readonly SerializedRecoverableError[] };
  open(renderOptions: AnimationRenderOptions): AnimatedRasterSessionHandle;
  release(): void;
};

/** State distinguishing scan, deferred open, frame drains and immutable completion. */
type AnimationJobPhase =
  | "scan"
  | "open"
  | "encode"
  | "drain"
  | "finish-drain"
  | "finished"
  | "aborted"
  | "failed";

/** Keep one prepared producer, one session and at most one current output chunk. */
export class OwnedAnimatedRasterJob implements AnimatedRasterJob {
  private backend: AnimatedRasterJobBackend | undefined;
  private scan: AnimationScheduleCursor | undefined;
  private readonly delay = createGifDelayCursor();
  private requestedMs = 0n;
  private emittedMs = 0n;
  private producer: AnimatedRasterFrameProducer | undefined;
  /** Hold fixed emission settings only until deferred open, after the ready callback. */
  private renderOptions: AnimationRenderOptions | undefined;
  /** Deliver accumulated warnings before reporting a later preparation failure. */
  private preparationFailure: { error: unknown } | undefined;
  private session: AnimatedRasterSessionHandle | undefined;
  private phase: AnimationJobPhase = "scan";
  private finishOutput: AnimationSessionFinishOutput | undefined;
  private primary: unknown;
  private operation: "open" | "push" | "drain" | "finish" = "open";
  private isReleased = false;
  private readonly format: AnimatedRasterFormat;
  private readonly releaseToken: () => void;
  /** Keep cancellation checks available after large backend references are released. */
  private readonly signal: AbortSignal | undefined;
  /** Read Engine disposal without retaining the detached source/options backend. */
  private readonly isEngineDisposed: () => boolean;
  /** Release synchronous resources on signal cancellation while retaining the external token. */
  private readonly onSignalAbort = (): void => {
    try {
      this.abort();
    } catch {
      // The external driver owns cleanup diagnostics.
    }
  };

  /** Adopt a detached descriptor; preparation and raster work start only in advance. */
  constructor(backend: AnimatedRasterJobBackend) {
    this.backend = backend;
    this.format = backend.format;
    this.releaseToken = backend.release;
    this.signal = backend.signal;
    this.isEngineDisposed = backend.isDisposed;
    if (this.signal) {
      EventTarget.prototype.addEventListener.call(this.signal, "abort", this.onSignalAbort, {
        once: true,
      });
    }
    this.scan = createAnimationScheduleCursor(backend.descriptor, {
      format: backend.format,
      invalidSchedule:
        backend.format === "webp"
          ? "ANIMATED_WEBP_INVALID_SCHEDULE"
          : "ANIMATED_GIF_INVALID_SCHEDULE",
    });
  }

  /** Reject cancellation between synchronous operations and scan entries. */
  private checkCancellation(): void {
    if (this.isEngineDisposed()) {
      throw animatedRasterFailure(this.format, this.operation, {
        family: "ABORTED",
        reason: "engineDisposed",
      });
    }
    if (isAnimationSignalAborted(this.signal)) {
      throw animatedRasterFailure(this.format, this.operation, {
        family: "ABORTED",
        reason: "signal",
      });
    }
    if (this.phase === "aborted") {
      throw (
        this.primary ??
        animatedRasterFailure(this.format, this.operation, {
          family: "SESSION_INVALID_STATE",
          reason: "aborted",
        })
      );
    }
  }

  /** Close synchronous resources before waiting for any external sink cleanup. */
  private cleanup(): void {
    if (this.signal) {
      EventTarget.prototype.removeEventListener.call(this.signal, "abort", this.onSignalAbort);
    }
    const producer = this.producer;
    this.producer = undefined;
    const session = this.session;
    this.session = undefined;
    this.scan?.return();
    this.scan = undefined;
    this.backend = undefined;
    this.preparationFailure = undefined;
    this.renderOptions = undefined;
    this.finishOutput = undefined;
    try {
      producer?.return();
    } finally {
      try {
        session?.abort();
      } finally {
        session?.dispose();
      }
    }
  }

  /** Compute the exact GIF timing warning at its original pre-frame position. */
  private timingWarning(): RecoverableError | undefined {
    if (this.format !== "gif" || 20n * this.emittedMs <= 21n * this.requestedMs) {
      return undefined;
    }
    return createInternalRecoverableError(
      "ANIMATED_GIF_TIMING_ADJUSTED",
      `GIF frame delays are limited to whole centiseconds of at least ${GIF_MIN_FRAME_MS / GIF_DELAY_UNIT_MS}; the animation plays for ${this.emittedMs} ms instead of ${this.requestedMs} ms. ${
        this.backend?.descriptor.kind === "sampled"
          ? `Raise durationMs, or lower fps, so no sampled frame falls under ${GIF_MIN_FRAME_MS} ms.`
          : `Keep every frameDurationsMs entry at ${GIF_MIN_FRAME_MS} ms or longer.`
      }`,
      { fallback: "clamped frame delays", stage: "emit" },
    );
  }

  /** Advance exactly one bounded externally observable step. */
  advance(): AnimatedRasterJobStep {
    if (this.phase === "failed") {
      throw this.primary;
    }
    if (this.phase === "finished") {
      throw animatedRasterFailure(this.format, "finish", {
        family: "SESSION_INVALID_STATE",
        reason: "alreadyFinished",
      });
    }
    try {
      this.checkCancellation();
      const step = this.advanceActive();
      this.checkCancellation();
      return step;
    } catch (error) {
      this.primary = error;
      this.phase = "failed";
      try {
        this.cleanup();
      } catch {
        // Keep the first operation failure.
      }
      throw error;
    }
  }

  /** Scan without frame arrays, then drive the single shared raster session. */
  private advanceActive(): AnimatedRasterJobStep {
    const backend = this.backend;
    if (!backend) {
      throw animatedRasterFailure(this.format, this.operation, {
        family: "SESSION_INVALID_STATE",
        reason: "aborted",
      });
    }
    if (this.phase === "scan") {
      for (let count = 0; count < SCAN_ENTRIES_MAX; count += 1) {
        this.checkCancellation();
        const entry = this.scan?.next();
        if (!entry || entry.done) {
          this.scan = undefined;
          const prepared = backend.prepare(this.timingWarning());
          if (prepared.kind === "ready") {
            this.producer = prepared.producer;
            this.renderOptions = prepared.renderOptions;
          } else {
            this.preparationFailure = { error: prepared.error };
          }
          this.phase = "open";
          return { kind: "ready", warnings: prepared.warnings };
        }
        if (this.format === "gif") {
          this.requestedMs += BigInt(entry.value.durationMs);
          this.emittedMs += BigInt(this.delay.next(entry.value.durationMs) * GIF_DELAY_UNIT_MS);
        }
      }
      return { kind: "preparing" };
    }
    if (this.phase === "open") {
      if (this.preparationFailure !== undefined) {
        throw this.preparationFailure.error;
      }
      const renderOptions = this.renderOptions;
      if (renderOptions === undefined) {
        throw animatedRasterFailure(this.format, "open", {
          family: "SESSION_INVALID_INPUT",
          reason: "missingField",
          field: "renderOptions",
        });
      }
      this.renderOptions = undefined;
      this.session = backend.open(renderOptions);
      this.checkCancellation();
      this.phase = "encode";
    }
    const session = this.session;
    if (!session) {
      throw animatedRasterFailure(this.format, this.operation, {
        family: "SESSION_INVALID_STATE",
        reason: "aborted",
      });
    }
    if (this.phase === "drain" || this.phase === "finish-drain") {
      this.operation = "drain";
      const chunk = session.readChunk();
      if (chunk !== null) {
        return { kind: "chunk", chunk };
      }
      if (this.phase === "finish-drain") {
        const output = this.finishOutput;
        if (
          !output ||
          output.frameCount !== backend.descriptor.frameCount ||
          output.format !== this.format
        ) {
          throw animatedRasterFailure(this.format, "finish", {
            family: "SESSION_INVALID_INPUT",
            reason: "outOfDomain",
            field: "frameCount",
          });
        }
        this.phase = "finished";
        const step: AnimatedRasterJobStep = {
          kind: "finished",
          result: {
            format: output.format,
            frameCount: output.frameCount,
            bytesWritten: output.bytesWritten,
          },
          ...(output.patch === undefined ? {} : { patch: output.patch }),
        };
        this.cleanup();
        return step;
      }
      this.phase = "encode";
    }
    this.operation = "push";
    if (this.producer?.pushNext(session)) {
      this.checkCancellation();
      this.phase = "drain";
      this.operation = "drain";
      const chunk = session.readChunk();
      if (chunk === null) {
        throw animatedRasterFailure(this.format, "drain", {
          family: "SESSION_INVALID_STATE",
          reason: "noFrames",
        });
      }
      return { kind: "chunk", chunk };
    }
    this.producer?.return();
    this.producer = undefined;
    this.operation = "finish";
    this.finishOutput = session.finish();
    this.phase = "finish-drain";
    return this.advanceActive();
  }

  /** Mark cancellation and synchronously release resources while preserving the token. */
  abort(): void {
    if (this.phase === "aborted") {
      return;
    }
    this.phase = "aborted";
    this.cleanup();
  }

  /** Release the token after the external owner has settled its callbacks and cleanup. */
  dispose(): void {
    if (this.isReleased) {
      return;
    }
    this.isReleased = true;
    try {
      this.cleanup();
    } finally {
      this.releaseToken();
    }
  }
}

/** Yield to a host task without nesting browser timers; close both temporary ports. */
async function yieldAnimationTask(): Promise<void> {
  const immediate: unknown = Reflect.get(globalThis, "setImmediate");
  await new Promise<void>((resolve, reject) => {
    if (typeof immediate === "function") {
      Reflect.apply(immediate, globalThis, [resolve]);
    } else if (typeof MessageChannel !== "undefined") {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      try {
        channel.port2.postMessage(undefined);
      } catch (error) {
        channel.port1.close();
        channel.port2.close();
        reject(error);
      }
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Deliver Core warnings in order, checking cancellation after each user callback. */
function deliverAnimationWarnings(
  warnings: readonly SerializedRecoverableError[],
  callbacks: Pick<RenderAnimatedGifOptions, "onWarning" | "onPngResolutionAdjusted">,
  check: (operation: AnimatedRasterOperation) => void,
): void {
  for (const serialized of warnings) {
    const warning = RecoverableError.fromSerialized(serialized);
    if (
      warning.code === "PNG_RESOLUTION_ADJUSTED" &&
      warning.context &&
      callbacks.onPngResolutionAdjusted
    ) {
      callbacks.onPngResolutionAdjusted({ ...warning.context } as PngResolutionAdjustedWarning);
      check("open");
    }
    callbacks.onWarning?.(warning);
    check("open");
  }
}

/** Drive one job through sink backpressure, preserving finish success and primary failures. */
export async function writeAnimatedRasterJob(
  job: AnimatedRasterJob,
  sink: AnimatedRasterSink,
  configuration: {
    format: AnimatedRasterFormat;
    callbacks: Pick<RenderAnimatedGifOptions, "onWarning" | "onPngResolutionAdjusted">;
    check: (operation: AnimatedRasterOperation) => void;
  },
): Promise<AnimatedRasterWriteResult> {
  const { format, callbacks, check } = configuration;
  let isSuccessful = false;
  let primary: unknown;
  let output: AnimatedRasterWriteResult | undefined;
  let lastYield = performance.now();
  let operation: AnimatedRasterOperation = "open";
  let callbackOperation: "write" | "patch" | "finish" | undefined;
  try {
    while (true) {
      check(operation);
      const step = job.advance();
      if (step.kind === "preparing") {
        await yieldAnimationTask();
        lastYield = performance.now();
      } else if (step.kind === "ready") {
        deliverAnimationWarnings(step.warnings, callbacks, check);
        operation = "push";
      } else if (step.kind === "chunk") {
        check("write");
        callbackOperation = "write";
        await sink.write(step.chunk);
        callbackOperation = undefined;
        check("write");
        if (performance.now() - lastYield >= FRAME_TASK_MS) {
          await yieldAnimationTask();
          lastYield = performance.now();
        }
      } else {
        if (step.patch) {
          const patch = step.patch;
          check("patch");
          callbackOperation = "patch";
          await (sink as AnimatedWebpSink).patch(patch.offset, patch.bytes);
          callbackOperation = undefined;
          check("patch");
        }
        check("finish");
        callbackOperation = "finish";
        await sink.finish();
        callbackOperation = undefined;
        isSuccessful = true;
        output = step.result;
        break;
      }
    }
  } catch (error) {
    primary =
      callbackOperation === undefined
        ? error
        : animatedRasterSinkFailure(format, callbackOperation, error);
  } finally {
    if (!isSuccessful) {
      try {
        job.abort();
      } catch {
        // Preserve the primary error.
      }
      try {
        await sink.abort(primary);
      } catch {
        // Cleanup cannot replace the primary error.
      }
    }
    try {
      job.dispose();
    } catch (error) {
      if (isSuccessful) {
        primary = error;
        isSuccessful = false;
      }
    }
  }
  if (!isSuccessful || output === undefined) {
    throw primary;
  }
  return output;
}
