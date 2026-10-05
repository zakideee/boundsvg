/** One remote animation stream separates its public deadline from pending callback cleanup. */
import type {
  AnimatedRasterSink,
  AnimatedRasterWriteResult,
  AnimatedWebpSink,
  RenderAnimatedGifOptions,
} from "@boundsvg/core";
import { FatalError } from "@boundsvg/core";
import { decodeAnimatedRasterFatal } from "@boundsvg/core/wasm";
import {
  type AnimatedRasterFormat,
  type AnimatedRasterOperation,
  animatedRasterFailure,
  animatedRasterSinkFailure,
  isAnimationSignalAborted,
} from "./animation-errors.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import { invalidWorkerResponseError } from "./worker-errors.js";

/** Detached open request whose source and explicit schedule are already owned. */
type RasterStreamOpen = Extract<
  WorkerRequest,
  {
    type: "open-raster-stream" | "open-layout-transition-raster-stream";
  }
>;

/** Main-thread transport; close acknowledgement belongs to the physical scheduler. */
type RasterStreamTransport = {
  open(
    request: RasterStreamOpen,
    deadline: number,
    error: (cause: unknown) => unknown,
  ): Promise<WorkerResponse>;
  next(
    streamId: number,
    deadline: number,
    error: (cause: unknown) => unknown,
  ): Promise<WorkerResponse>;
  close(streamId: number): void;
};

/** Main-thread cancellation, transport and release responsibilities for one stream owner. */
type AnimationStreamConfiguration = {
  signal: AbortSignal | undefined;
  timeoutMs: number;
  transport: RasterStreamTransport;
  release: () => void;
  deliverWarnings: (
    warnings: Extract<WorkerResponse, { type: "next-raster-stream-ok"; kind: "ready" }>["warnings"],
    check: () => void,
  ) => void;
};

/** A logical result and the later callback/cleanup barrier have separate lifetimes. */
export class WorkerAnimationStream {
  private readonly signal: AbortSignal | undefined;
  private readonly timeoutMs: number;
  private readonly transport: RasterStreamTransport;
  private readonly release: () => void;
  private readonly deliverWarnings: AnimationStreamConfiguration["deliverWarnings"];
  private operation: AnimatedRasterOperation = "open";
  private primary: unknown;
  private hasPrimaryFailure = false;
  private isPubliclySettled = false;
  private isCommitted = false;
  private streamId: number | undefined;
  private deadline: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resolveResult!: (result: AnimatedRasterWriteResult) => void;
  private rejectResult!: (error: unknown) => void;
  private resolveCleanup!: () => void;
  /** Release the main lease only after a pending callback and owned abort have settled. */
  readonly cleanup: Promise<void>;
  private readonly result: Promise<AnimatedRasterWriteResult>;
  private readonly handleSignal = (): void => {
    this.cancel("signal");
  };

  /** Adopt one sink; caller input is detached by initialize before the first await. */
  constructor(
    private readonly format: AnimatedRasterFormat,
    private readonly sink: AnimatedRasterSink,
    configuration: AnimationStreamConfiguration,
  ) {
    const { signal, timeoutMs, transport, release, deliverWarnings } = configuration;
    this.signal = signal;
    this.timeoutMs = timeoutMs;
    this.transport = transport;
    this.release = release;
    this.deliverWarnings = deliverWarnings;
    this.result = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    this.cleanup = new Promise((resolve) => {
      this.resolveCleanup = resolve;
    });
    if (signal) {
      EventTarget.prototype.addEventListener.call(signal, "abort", this.handleSignal, {
        once: true,
      });
    }
  }

  /** Start once; the returned result can reject before the cleanup barrier resolves. */
  start(initialize: () => RasterStreamOpen): Promise<AnimatedRasterWriteResult> {
    void this.run({ initialize });
    return this.result;
  }

  /** Reject immediately without interrupting a callback or deleting a later committed output. */
  cancel(reason: "signal" | "deadline" | "workerDisposed", cause?: unknown): void {
    if (this.isPubliclySettled || this.hasPrimaryFailure) {
      return;
    }
    const error = animatedRasterFailure(this.format, this.operation, {
      family: "ABORTED",
      reason: reason,
    });
    if (cause !== undefined) {
      Object.defineProperty(error, "cause", { value: cause, configurable: true });
    }
    this.fail(error);
  }

  /** Preserve a protocol or transport failure while waiting for owned callback cleanup. */
  fail(error: unknown): void {
    if (this.isPubliclySettled || this.hasPrimaryFailure) {
      return;
    }
    this.primary = error;
    this.hasPrimaryFailure = true;
    this.isPubliclySettled = true;
    this.rejectResult(error);
    this.close();
  }

  /** Check the clock in continuations as well as the timer delivery task. */
  private check(): void {
    if (!this.hasPrimaryFailure && isAnimationSignalAborted(this.signal)) {
      this.cancel("signal");
    }
    if (
      !this.hasPrimaryFailure &&
      this.deadline !== undefined &&
      performance.now() >= this.deadline
    ) {
      this.cancel("deadline");
    }
    if (this.hasPrimaryFailure) {
      throw this.primary;
    }
  }

  private close(): void {
    if (this.streamId !== undefined) {
      this.transport.close(this.streamId);
    }
  }

  /** Keep only the approved animation fatal envelope from a remote error. */
  private checkResponse(response: WorkerResponse): void {
    if (response.type === "error") {
      const fatal = FatalError.fromSerialized(response.error);
      if (fatal.code.startsWith("ANIMATED_RASTER_")) {
        const diagnostic = decodeAnimatedRasterFatal(FatalError.prototype.toJSON.call(fatal));
        if (!diagnostic) {
          throw invalidWorkerResponseError(response.id);
        }
        throw fatal;
      }
      throw fatal;
    }
  }

  private async invoke(
    operation: "write" | "patch" | "finish",
    callback: () => void | Promise<void>,
  ): Promise<void> {
    this.operation = operation;
    this.check();
    try {
      await callback();
    } catch (error) {
      throw animatedRasterSinkFailure(this.format, operation, error);
    }
    // A successful finish may have committed even after an immutable logical rejection.
    if (operation === "finish") {
      this.isCommitted = true;
    }
    this.check();
  }

  /** Pull one step only after the previous callback; settle normal results after local cleanup. */
  private async run(startup: { initialize: (() => RasterStreamOpen) | undefined }): Promise<void> {
    let initialize = startup.initialize;
    startup.initialize = undefined;
    let output: AnimatedRasterWriteResult | undefined;
    let failure: unknown;
    try {
      if (initialize === undefined) {
        throw new TypeError("Missing stream initialization");
      }
      let request: RasterStreamOpen | undefined = initialize();
      initialize = undefined;
      this.check();
      const streamId = request.id;
      this.streamId = streamId;
      this.deadline = performance.now() + this.timeoutMs;
      this.timer = setTimeout(() => this.cancel("deadline"), this.timeoutMs);
      const deadlineError = (cause: unknown): unknown => {
        this.cancel("deadline", cause);
        return this.primary;
      };
      const opened = await this.transport.open(request, this.deadline, deadlineError);
      request = undefined;
      this.check();
      this.checkResponse(opened);
      if (opened.type !== "open-raster-stream-ok" || opened.streamId !== streamId) {
        throw invalidWorkerResponseError(opened.id);
      }
      let isReady = false;
      while (true) {
        this.operation = isReady ? "push" : "open";
        this.check();
        const step = await this.transport.next(streamId, this.deadline, deadlineError);
        this.check();
        this.checkResponse(step);
        if (step.type !== "next-raster-stream-ok" || step.streamId !== streamId) {
          throw invalidWorkerResponseError(step.id);
        }
        if (step.kind === "preparing") {
          if (isReady) {
            throw invalidWorkerResponseError(step.id);
          }
          // Remote scan batches must permit message delivery and main-thread cancellation.
          await yieldAnimationTask();
        } else if (step.kind === "ready") {
          if (isReady) {
            throw invalidWorkerResponseError(step.id);
          }
          isReady = true;
          this.deliverWarnings(step.warnings, () => this.check());
          this.check();
        } else if (step.kind === "chunk") {
          if (!isReady) {
            throw invalidWorkerResponseError(step.id);
          }
          await this.invoke("write", () => this.sink.write(new Uint8Array(step.chunk)));
        } else {
          if (!isReady || step.result.format !== this.format) {
            throw invalidWorkerResponseError(step.id);
          }
          if (step.patch) {
            const patch = step.patch;
            await this.invoke("patch", () =>
              (this.sink as AnimatedWebpSink).patch(patch.offset, patch.bytes),
            );
          }
          await this.invoke("finish", () => this.sink.finish());
          output = step.result;
          break;
        }
      }
    } catch (error) {
      failure = this.hasPrimaryFailure ? this.primary : error;
    } finally {
      initialize = undefined;
      if (this.timer) {
        clearTimeout(this.timer);
      }
      if (this.signal) {
        EventTarget.prototype.removeEventListener.call(this.signal, "abort", this.handleSignal);
      }
      this.close();
      if (!this.isCommitted) {
        this.operation = "abort";
        try {
          await this.sink.abort(failure);
        } catch {
          // Preserve the primary failure.
        }
      }
      this.release();
      this.resolveCleanup();
      if (!this.isPubliclySettled) {
        this.isPubliclySettled = true;
        if (output) {
          this.resolveResult(output);
        } else {
          this.rejectResult(failure);
        }
      }
    }
  }
}

/**
 * Authenticate local option shapes before busy while their later domain owners remain unchanged.
 * @throws {FatalError} When an optional scalar or record has the wrong shape.
 */
function authenticateWorkerAnimationOptionValues(
  options: RenderAnimatedGifOptions,
  invalid: (reason: string) => never,
): void {
  const primitiveTypes = [
    ["onWarning", "function"],
    ["onPngResolutionAdjusted", "function"],
    ["skipValidation", "boolean"],
    ["showMissingGlyphs", "boolean"],
    ["rasterBackground", "string"],
    ["textPathMode", "string"],
  ] as const;
  for (const [key, expectedType] of primitiveTypes) {
    const optional: unknown = Reflect.get(options, key);
    if (optional !== undefined && typeof optional !== expectedType) {
      invalid(optional === null ? "nullField" : "wrongType");
    }
  }
  const behavior = options.rasterOversizeBehavior;
  if (behavior !== undefined && behavior !== "auto-adjust" && behavior !== "error") {
    invalid("outOfDomain");
  }
  const debug = options.debug;
  if (
    debug !== undefined &&
    typeof debug !== "boolean" &&
    (typeof debug !== "object" || debug === null || Array.isArray(debug))
  ) {
    invalid(debug === null ? "nullField" : "wrongType");
  }
  const generator = options.generator;
  if (
    generator !== undefined &&
    (typeof generator !== "object" || generator === null || Array.isArray(generator))
  ) {
    invalid(generator === null ? "nullField" : "wrongType");
  }
}

/** Validate callback and request options before acquiring the main animation lease. */
export function authenticateWorkerAnimationOptions(
  options: RenderAnimatedGifOptions,
  requestOptions: unknown,
  format: AnimatedRasterFormat,
): AbortSignal | undefined {
  const invalid = (reason: string): never => {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: reason,
      field: "options",
    });
  };
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    invalid(options === null ? "nullField" : "wrongType");
  }
  const allowed = [
    "scale",
    "debug",
    "showMissingGlyphs",
    "generator",
    "onWarning",
    "skipValidation",
    "textPathMode",
    "rasterBackground",
    "rasterOversizeBehavior",
    "onPngResolutionAdjusted",
    "durationMs",
    "fps",
    "timesMs",
    "frameDurationsMs",
    "iterations",
  ];
  if (Reflect.ownKeys(options).some((key) => typeof key !== "string" || !allowed.includes(key))) {
    invalid("unknownField");
  }
  authenticateWorkerAnimationOptionValues(options, invalid);
  if (
    requestOptions !== undefined &&
    (typeof requestOptions !== "object" || requestOptions === null || Array.isArray(requestOptions))
  ) {
    invalid(requestOptions === null ? "nullField" : "wrongType");
  }
  if (
    typeof requestOptions === "object" &&
    requestOptions !== null &&
    Reflect.ownKeys(requestOptions).some((key) => key !== "signal")
  ) {
    invalid("unknownField");
  }
  return requestOptions === undefined
    ? undefined
    : (Reflect.get(requestOptions as object, "signal") as AbortSignal | undefined);
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
