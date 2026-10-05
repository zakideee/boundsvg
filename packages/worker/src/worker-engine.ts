/**
 * Main-thread proxy that communicates with a boundsvg Worker.
 *
 * `WorkerEngine` proxies every `renderTo*` SVG and raster form — layered and
 * `renderToSvgAndIR` included — plus the six text measurement and flow methods.
 * There is no frame-streaming method here; that path is `WorkerPool`, which
 * creates and owns its own `WorkerEngine`s rather than reusing this one. All
 * heavy work (WASM layout, IR build, SVG emit, raster encoding) runs off the
 * main thread inside a Web Worker.
 *
 * Usage:
 * ```ts
 * const engine = await WorkerEngine.create({
 *   worker: new URL("@boundsvg/worker/worker", import.meta.url),
 *   fonts: [{ alias: "sans", weight: 400, style: "normal", data: fontBuffer }],
 * });
 * const svg = await engine.renderToSvg(scene);
 * engine.dispose();
 * ```
 */

import type {
  AnimatedRasterSink,
  AnimatedRasterWriteResult,
  AnimatedWebpSink,
  Frame,
  GeometryDoc,
  IntrinsicInlineSizeInput,
  IntrinsicInlineSizeResult,
  IR,
  LayeredPngOptions,
  LayeredPngResult,
  LayeredSvgOptions,
  LayeredSvgResult,
  MeasureTextBlockInput,
  MeasureTextBlockResult,
  OutputCommonOptions,
  PngResolutionAdjustedWarning,
  RasterEmissionOptions,
  RenderAnimatedGifOptions,
  RenderAnimatedSvgOptions,
  RenderAnimatedWebpOptions,
  RenderPngOptions,
  RenderSvgOptions,
  RenderWebpOptions,
  SceneNode,
  SerializedRecoverableError,
  ShrinkwrapFlowInput,
  ShrinkwrapFlowResult,
  ShrinkwrapTextInput,
  ShrinkwrapTextResult,
  SymbolDefinition,
  TextFlowInput,
  TextFlowResult,
  TextFlowWithExclusionsInput,
  TextFlowWithExclusionsResult,
} from "@boundsvg/core";
import { decodeSceneDocument, FatalError, RecoverableError } from "@boundsvg/core";
import {
  type AnimatedRasterFormat,
  animatedRasterFailure,
  assertAnimatedRasterSink,
  assertAnimationSignal,
} from "./animation-errors.js";
import { authenticateWorkerAnimationOptions, WorkerAnimationStream } from "./animation-stream.js";
import { formatUnknownWorkerFailure } from "./diagnostic-format.js";
import {
  snapshotWorkerLayoutTransitionInput,
  type WorkerLayoutTransitionInput,
} from "./layout-transition-transport.js";
import {
  collectRequestTransferables,
  decodeWorkerResponseMessage,
  type FontTransfer,
  type IndexedFrameTime,
  isWorkerMessageId,
  type WorkerFrameRenderOptions,
  type WorkerLayeredPngRenderOptions,
  type WorkerLayeredSvgRenderOptions,
  type WorkerRenderAnimatedSvgOptions,
  type WorkerRenderPngOptions,
  type WorkerRenderSvgOptions,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.js";
import {
  describeWorkerFailure,
  invalidWorkerResponseError,
  unexpectedWorkerResponseError,
  workerEngineDisposedError,
  workerLifecycleError,
} from "./worker-errors.js";
import { WorkerRequestScheduler } from "./worker-request-scheduler.js";
import { resolveWorkerTimeout } from "./worker-timeout.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Worker endpoint, initial assets, and timeout used to create a render proxy. */
export type WorkerEngineOptions = {
  /** Worker-like instance or URL. When a URL is given a new Worker is created. */
  worker: WorkerLike | URL;
  /** Fonts to register in the Worker engine. ArrayBuffers are transferred (zero-copy). */
  fonts: FontTransfer[];
  /** Geometry definitions registered in the Worker engine during initialization. */
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  /** Symbol definitions registered in the Worker engine during initialization. */
  symbols?: Array<{ id: string; def: SymbolDefinition }>;
  /** Timeout in ms for init and render calls. Default: 30 000. */
  timeout?: number;
};

/** Worker messaging and lifecycle capabilities required by the render proxy. */
export type WorkerLike = Pick<
  Worker,
  "postMessage" | "terminate" | "addEventListener" | "removeEventListener"
>;

/** Optional cancellation owned by the caller, never sent over the wire. */
export type WorkerRequestOptions = { signal?: AbortSignal };

/** Physical workers already assigned to an engine owner. */
const attachedWorkers = new WeakSet<WorkerLike>();

// ---------------------------------------------------------------------------
// Render result
// ---------------------------------------------------------------------------

/** SVG payload and serialized warnings returned over the Worker protocol. */
export type WorkerRenderSvgResult = {
  svg: string;
  warnings: SerializedRecoverableError[];
};

/** PNG payload and serialized warnings returned over the Worker protocol. */
export type WorkerRenderPngResult = {
  png: Uint8Array;
  warnings: SerializedRecoverableError[];
};

/** Layered SVG payload with serialized Worker warnings. */
export type WorkerRenderLayeredSvgResult = LayeredSvgResult & {
  warnings: SerializedRecoverableError[];
};

/** Layered PNG payload with serialized Worker warnings. */
export type WorkerRenderLayeredPngResult = LayeredPngResult & {
  warnings: SerializedRecoverableError[];
};

/** SVG payload and outline-resolved IR returned together by the Worker. */
export type WorkerRenderSvgAndIrResult = {
  svg: string;
  ir: IR;
};

// ---------------------------------------------------------------------------
// Pending request bookkeeping
// ---------------------------------------------------------------------------

type WarningCallback = NonNullable<OutputCommonOptions["onWarning"]>;
type PngResolutionAdjustedCallback = NonNullable<RasterEmissionOptions["onPngResolutionAdjusted"]>;

/** SVG or PNG frame payload with serialized warnings for materialized scene rendering. */
export type WorkerRenderedFrame =
  | { format: "svg"; data: string; warnings: SerializedRecoverableError[] }
  | { format: "png"; data: Uint8Array; warnings: SerializedRecoverableError[] };

/** Brand for scene snapshots already validated at the main-thread boundary. */
const preparedSceneDocumentBrand: unique symbol = Symbol("prepared-scene-document");
/** Brand for transition snapshots already validated at the main-thread boundary. */
const preparedLayoutTransitionBrand: unique symbol = Symbol("prepared-layout-transition");

/** Package-internal proof that one Scene snapshot already crossed the main boundary. */
export type PreparedSceneDocument = {
  readonly scene: SceneNode;
  readonly [preparedSceneDocumentBrand]: true;
};

/** Package-internal proof that both transition states already crossed the main boundary. */
export type PreparedWorkerLayoutTransition = {
  readonly transition: WorkerLayoutTransitionInput;
  readonly [preparedLayoutTransitionBrand]: true;
};

/** Validate and snapshot an unknown scene into a branded transport document. */
export function prepareSceneForTransport(input: unknown): PreparedSceneDocument {
  return {
    scene: decodeSceneDocument(input),
    [preparedSceneDocumentBrand]: true,
  };
}

/** Validate and snapshot both layout-transition states for Worker transport. */
export function prepareWorkerLayoutTransitionForTransport(
  input: WorkerLayoutTransitionInput,
): PreparedWorkerLayoutTransition {
  return {
    transition: snapshotWorkerLayoutTransitionInput(input),
    [preparedLayoutTransitionBrand]: true,
  };
}

/** Package-internal stream and materialized-render operations reserved for a WorkerPool. */
export type WorkerPoolEndpoint = {
  open(
    scene: PreparedSceneDocument,
    schedule: IndexedFrameTime[],
    options: WorkerFrameRenderOptions,
  ): Promise<{ streamId: number; warnings: SerializedRecoverableError[] }>;
  openLayoutTransition(
    transition: PreparedWorkerLayoutTransition,
    schedule: IndexedFrameTime[],
    options: WorkerFrameRenderOptions,
  ): Promise<{ streamId: number; warnings: SerializedRecoverableError[] }>;
  next(streamId: number): Promise<Frame | undefined>;
  close(streamId: number): Promise<void>;
  finish(): Promise<void>;
  render(
    scene: PreparedSceneDocument,
    format: "svg" | "png",
    options: WorkerRenderSvgOptions | WorkerRenderPngOptions,
  ): Promise<WorkerRenderedFrame>;
};

/** Registered pool integration endpoints associated with worker engines. */
const workerPoolEndpoints = new WeakMap<WorkerEngine, WorkerPoolEndpoint>();

/** Retrieve the registered pool endpoint or throw when the engine has none. */
export function getWorkerPoolEndpoint(engine: WorkerEngine): WorkerPoolEndpoint {
  const endpoint = workerPoolEndpoints.get(engine);
  if (!endpoint) {
    throw workerLifecycleError(
      "WORKER_FRAME_ENDPOINT_UNAVAILABLE",
      "WorkerEngine frame endpoint is unavailable",
    );
  }
  return endpoint;
}

// ---------------------------------------------------------------------------
// WorkerEngine
// ---------------------------------------------------------------------------

/** Serialize render requests to one Worker and manage deadlines, cancellation, and owned Worker disposal. */
export class WorkerEngine {
  private readonly worker: WorkerLike;
  private readonly ownsWorker: boolean;
  private nextId = 1;
  private disposed = false;
  private readonly scheduler: WorkerRequestScheduler;
  /** Main lease remains occupied until pending callbacks and owned cleanup settle. */
  private animation: WorkerAnimationStream | undefined;
  /** Drain callers share one admission close and one absolute wait deadline. */
  private drainPromise: Promise<void> | undefined;

  /** Bound handlers for addEventListener / removeEventListener. */
  private readonly handleMessage: (event: MessageEvent) => void;
  private readonly handleError: (event: ErrorEvent) => void;

  private constructor(
    worker: WorkerLike,
    ownsWorker: boolean,
    private readonly timeoutMs: number,
  ) {
    this.worker = worker;
    this.ownsWorker = ownsWorker;
    this.scheduler = new WorkerRequestScheduler(timeoutMs, {
      post: (request) => this.worker.postMessage(request, collectRequestTransferables(request)),
      nextRequestId: () => this.nextRequestId(),
    });

    this.handleMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      const { id: responseId, message: response } = decodeWorkerResponseMessage(data);
      if (response === undefined) {
        if (responseId !== undefined) {
          if (this.scheduler.receive(responseId, undefined)) {
            return;
          }
        }
        this.disposeAfterProtocolCorruption();
        return;
      }

      this.scheduler.receive(response.id, response);
    };

    this.handleError = (event: ErrorEvent) => {
      // Worker is fatally broken — transition to disposed state
      if (this.disposed) {
        return;
      }
      this.disposed = true;
      const workerMessage = describeWorkerErrorEvent(event);
      const error = workerLifecycleError("WORKER_CRASHED", `Worker error: ${workerMessage}`, {
        workerMessage,
      });
      this.animation?.fail(error);
      this.scheduler.dispose(error);

      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleError as EventListener);

      if (this.ownsWorker) {
        this.worker.terminate();
      }
    };

    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError as EventListener);

    workerPoolEndpoints.set(this, {
      open: async (scene, schedule, options) => {
        this.assertNotDisposed();
        const streamId = this.nextRequestId();
        let response: WorkerResponse;
        try {
          response = await this.send({
            id: streamId,
            type: "open-frame-stream",
            scene: scene.scene,
            schedule,
            options,
          });
        } catch (error) {
          this.closeFrameStreamBestEffort(streamId);
          throw error;
        }
        if (response.type === "error") {
          this.closeFrameStreamBestEffort(streamId);
          throw FatalError.fromSerialized(response.error);
        }
        if (response.type !== "open-frame-stream-ok") {
          this.closeFrameStreamBestEffort(streamId);
          throw unexpectedWorkerResponseError(response.type, "open-frame-stream-ok");
        }
        return { streamId: response.streamId, warnings: response.warnings };
      },
      openLayoutTransition: async (transition, schedule, options) => {
        this.assertNotDisposed();
        const streamId = this.nextRequestId();
        let response: WorkerResponse;
        try {
          response = await this.send({
            id: streamId,
            type: "open-layout-transition-frame-stream",
            transition: transition.transition,
            schedule,
            options,
          });
        } catch (error) {
          this.closeFrameStreamBestEffort(streamId);
          throw error;
        }
        if (response.type === "error") {
          this.closeFrameStreamBestEffort(streamId);
          throw FatalError.fromSerialized(response.error);
        }
        if (response.type !== "open-frame-stream-ok") {
          this.closeFrameStreamBestEffort(streamId);
          throw unexpectedWorkerResponseError(response.type, "open-frame-stream-ok");
        }
        return { streamId: response.streamId, warnings: response.warnings };
      },
      next: async (streamId) => {
        this.assertNotDisposed();
        const response = await this.send({
          id: this.nextRequestId(),
          type: "next-frame-stream",
          streamId,
        });
        if (response.type === "error") {
          throw FatalError.fromSerialized(response.error);
        }
        if (response.type !== "next-frame-stream-ok") {
          throw unexpectedWorkerResponseError(response.type, "next-frame-stream-ok");
        }
        return response.done ? undefined : response.frame;
      },
      close: async (streamId) => {
        this.assertNotDisposed();
        const response = await this.scheduler.closeStream(streamId);
        if (response.type === "error") {
          throw FatalError.fromSerialized(response.error);
        }
        if (response.type !== "close-frame-stream-ok") {
          throw unexpectedWorkerResponseError(response.type, "close-frame-stream-ok");
        }
      },
      finish: () => this.scheduler.finish(),
      render: async (scene, format, options) => {
        this.assertNotDisposed();
        const response = await this.send(
          format === "svg"
            ? {
                id: this.nextRequestId(),
                type: "render-svg",
                scene: scene.scene,
                options: options as WorkerRenderSvgOptions,
              }
            : {
                id: this.nextRequestId(),
                type: "render-png",
                scene: scene.scene,
                options: options as WorkerRenderPngOptions,
              },
        );
        if (response.type === "error") {
          throw FatalError.fromSerialized(response.error);
        }
        if (format === "svg" && response.type === "render-svg-ok") {
          return { format, data: response.svg, warnings: response.warnings };
        }
        if (format === "png" && response.type === "render-png-ok") {
          return { format, data: response.png, warnings: response.warnings };
        }
        throw unexpectedWorkerResponseError(
          response.type,
          format === "svg" ? "render-svg-ok" : "render-png-ok",
        );
      },
    });
  }

  /**
   * Create and initialize a `WorkerEngine`.
   *
   * Spawns (or reuses) a Worker, sends the `init` message with font data,
   * and resolves once the Worker has loaded WASM and registered all fonts.
   */
  static async create(options: WorkerEngineOptions): Promise<WorkerEngine> {
    const timeoutMs = resolveWorkerTimeout(options.timeout);
    let worker: WorkerLike;
    let ownsWorker: boolean;

    if (isWorkerLike(options.worker)) {
      worker = options.worker;
      ownsWorker = false;
    } else {
      try {
        worker = new Worker(options.worker, { type: "module" });
      } catch (error) {
        const causeMessage = describeWorkerFailure(error);
        throw workerLifecycleError(
          "WORKER_CREATION_FAILED",
          `Worker could not be created: ${causeMessage}`,
          { causeMessage },
        );
      }
      ownsWorker = true;
    }

    if (attachedWorkers.has(worker)) {
      throw workerLifecycleError(
        "WORKER_ALREADY_ATTACHED",
        "Worker instance has already been attached",
      );
    }
    attachedWorkers.add(worker);
    const engine = new WorkerEngine(worker, ownsWorker, timeoutMs);

    let response: WorkerResponse;
    try {
      response = await engine.send({
        id: engine.nextRequestId(),
        type: "init",
        fonts: options.fonts,
        ...(options.geometries ? { geometries: options.geometries } : {}),
        ...(options.symbols ? { symbols: options.symbols } : {}),
      });
    } catch (err) {
      engine.dispose();
      throw err;
    }

    if (response.type === "error") {
      engine.dispose();
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "init-ok") {
      engine.dispose();
      throw unexpectedWorkerResponseError(response.type, "init-ok", " during initialization");
    }

    return engine;
  }

  /**
   * Render a scene to SVG inside the Worker.
   *
   * Warnings from the Worker are forwarded to `options.onWarning` if provided,
   * then the SVG string is returned.
   */
  async renderToSvg(
    scene: SceneNode,
    options?: RenderSvgOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<string> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-svg",
      scene: preparedScene.scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request, requestOptions);

    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-svg-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-svg-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning);
    return response.svg;
  }

  /** Render authored animation tracks to animated SVG inside the Worker. */
  async renderToAnimatedSvg(
    scene: SceneNode,
    options: RenderAnimatedSvgOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<string> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning } = splitOptions(options);
    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-animated-svg",
      scene: preparedScene.scene,
      options: workerOptions as WorkerRenderAnimatedSvgOptions,
    };
    const response = await this.send(request, requestOptions);
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-animated-svg-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-animated-svg-ok");
    }
    forwardWorkerWarnings(response.warnings, onWarning);
    return response.svg;
  }

  /**
   * Render a scene to SVG + IR inside the Worker.
   *
   * Returns the SVG string and the IR (Intermediate Representation) tree.
   * IR enables inspect-hover overlays on the main thread without a
   * synchronous Engine instance.
   */
  async renderToSvgAndIR(
    scene: SceneNode,
    options?: RenderSvgOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<WorkerRenderSvgAndIrResult> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-svg-and-ir",
      scene: preparedScene.scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request, requestOptions);

    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-svg-and-ir-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-svg-and-ir-ok");
    }

    const warnings = rehydrateWorkerWarnings(response.warnings);
    forwardRehydratedWorkerWarnings({
      warnings,
      onWarning,
      onPngResolutionAdjusted: undefined,
      detachForRetainedIr: true,
    });
    const ir: IR = { ...response.ir, warnings };
    return { svg: response.svg, ir };
  }

  /** Render animated SVG + IR with authored animation tracks. */
  async renderToAnimatedSvgAndIR(
    scene: SceneNode,
    options: RenderAnimatedSvgOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<{ svg: string; ir: IR }> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning } = splitOptions(options);
    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-animated-svg-and-ir",
      scene: preparedScene.scene,
      options: workerOptions as WorkerRenderAnimatedSvgOptions,
    };
    const response = await this.send(request, requestOptions);
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-animated-svg-and-ir-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-animated-svg-and-ir-ok");
    }
    const warnings = rehydrateWorkerWarnings(response.warnings);
    forwardRehydratedWorkerWarnings({
      warnings,
      onWarning,
      onPngResolutionAdjusted: undefined,
      detachForRetainedIr: true,
    });
    const ir: IR = { ...response.ir, warnings };
    return { svg: response.svg, ir };
  }

  /**
   * Render a scene to PNG inside the Worker.
   *
   * The PNG `Uint8Array` is transferred (zero-copy) from the Worker.
   * Warnings are forwarded to `options.onWarning` if provided.
   */
  async renderToPng(
    scene: SceneNode,
    options?: RenderPngOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<Uint8Array> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-png",
      scene: preparedScene.scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request, requestOptions);

    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-png-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-png-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.png;
  }

  /**
   * Render a scene to a lossless WebP inside the Worker.
   *
   * The WebP `Uint8Array` is transferred (zero-copy) from the Worker.
   * Warnings are forwarded to `options.onWarning` if provided.
   */
  async renderToWebp(
    scene: SceneNode,
    options?: RenderWebpOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<Uint8Array> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-webp",
      scene: preparedScene.scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request, requestOptions);

    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-webp-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-webp-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.webp;
  }

  /** Stream animated lossless WebP into a required main-thread patchable sink. */
  // biome-ignore lint/complexity/useMaxParams: Input, render options, destination and optional cancellation are separate public contracts.
  renderToAnimatedWebp(
    scene: SceneNode,
    options: RenderAnimatedWebpOptions,
    sink: AnimatedWebpSink,
    requestOptions?: WorkerRequestOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation({
      format: "webp",
      source: { scene },
      options: options,
      sink: sink,
      requestOptions: requestOptions,
    });
  }

  /** Compile transition states remotely and stream WebP through the same sink contract. */
  // biome-ignore lint/complexity/useMaxParams: Input, render options, destination and optional cancellation are separate public contracts.
  renderLayoutTransitionToAnimatedWebp(
    input: WorkerLayoutTransitionInput,
    options: RenderAnimatedWebpOptions,
    sink: AnimatedWebpSink,
    requestOptions?: WorkerRequestOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation({
      format: "webp",
      source: { transition: input },
      options: options,
      sink: sink,
      requestOptions: requestOptions,
    });
  }

  /** Stream palette GIF to a sequential sink under the enqueue-time deadline. */
  // biome-ignore lint/complexity/useMaxParams: Input, render options, destination and optional cancellation are separate public contracts.
  renderToAnimatedGif(
    scene: SceneNode,
    options: RenderAnimatedGifOptions,
    sink: AnimatedRasterSink,
    requestOptions?: WorkerRequestOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation({
      format: "gif",
      source: { scene },
      options: options,
      sink: sink,
      requestOptions: requestOptions,
    });
  }

  /** Compile transition states remotely and stream GIF without collecting complete output. */
  // biome-ignore lint/complexity/useMaxParams: Input, render options, destination and optional cancellation are separate public contracts.
  renderLayoutTransitionToAnimatedGif(
    input: WorkerLayoutTransitionInput,
    options: RenderAnimatedGifOptions,
    sink: AnimatedRasterSink,
    requestOptions?: WorkerRequestOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation({
      format: "gif",
      source: { transition: input },
      options: options,
      sink: sink,
      requestOptions: requestOptions,
    });
  }

  /** Authenticate before adoption, then own input snapshots and pending callback cleanup. */
  private async writeAnimation(configuration: {
    format: AnimatedRasterFormat;
    source: { scene: SceneNode } | { transition: WorkerLayoutTransitionInput };
    options: RenderAnimatedGifOptions | RenderAnimatedWebpOptions;
    sink: AnimatedRasterSink;
    requestOptions?: WorkerRequestOptions;
  }): Promise<AnimatedRasterWriteResult> {
    const { format, source, options, sink, requestOptions } = configuration;
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    assertAnimatedRasterSink(sink, { format, shouldRequirePatch: format === "webp" });
    const sourceInput = "scene" in source ? source.scene : source.transition;
    if (typeof sourceInput !== "object" || sourceInput === null || Array.isArray(sourceInput)) {
      throw animatedRasterFailure(format, "open", {
        family: "SESSION_INVALID_INPUT",
        reason: "wrongType",
        field: "options",
      });
    }
    const signal = authenticateWorkerAnimationOptions(options, requestOptions, format);
    assertAnimationSignal(signal, format);
    if (this.animation) {
      throw animatedRasterFailure(format, "open", {
        family: "JOB_BUSY",
        reason: "activeAnimation",
      });
    }
    const callbacks = {
      onWarning: options.onWarning,
      onPngResolutionAdjusted: options.onPngResolutionAdjusted,
    };
    const owner = new WorkerAnimationStream(format, sink, {
      signal: signal,
      timeoutMs: this.timeoutMs,
      transport: {
        open: (request, deadline, error) =>
          this.scheduler.sendRasterOpen(request, { deadline, error }),
        next: (streamId, deadline, error) =>
          this.scheduler.sendRasterPull(
            { id: this.nextRequestId(), type: "next-raster-stream", streamId },
            { deadline, error },
          ),
        close: (streamId) => {
          void this.scheduler.closeStream(streamId).catch(() => {
            // Later close failure affects future admission through the scheduler.
          });
        },
      },
      release: () => {
        if (this.animation === owner) {
          this.animation = undefined;
        }
      },
      deliverWarnings: (warnings, check) => {
        forwardRehydratedWorkerWarnings({
          warnings: rehydrateWorkerWarnings(warnings),
          onWarning: callbacks.onWarning,
          onPngResolutionAdjusted: callbacks.onPngResolutionAdjusted,
          detachForRetainedIr: false,
          check,
        });
      },
    });
    this.animation = owner;
    return owner.start(() => {
      const {
        onWarning: _onWarning,
        onPngResolutionAdjusted: _onPngResolutionAdjusted,
        ...transportOptions
      } = options;
      const stableOptions = structuredClone(transportOptions);
      const id = this.nextRequestId();
      return "scene" in source
        ? {
            id,
            type: "open-raster-stream",
            format,
            options: stableOptions,
            scene: prepareSceneForTransport(source.scene).scene,
          }
        : {
            id,
            type: "open-layout-transition-raster-stream",
            format,
            options: stableOptions,
            transition: prepareWorkerLayoutTransitionForTransport(source.transition).transition,
          };
    });
  }

  /** Render ordered SVG layers in the Worker and deliver warnings after successful completion. */
  async renderToLayeredSvg(
    scene: SceneNode,
    options?: LayeredSvgOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<LayeredSvgResult> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning } = splitLayeredSvgOptions(options);

    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-layered-svg",
      scene: preparedScene.scene,
      ...(workerOptions ? { options: workerOptions } : {}),
    };

    const response = await this.send(request, requestOptions);

    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-layered-svg-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-layered-svg-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning);
    return response.result;
  }

  /** Render ordered PNG layers in the Worker and deliver warnings and scale adjustments after success. */
  async renderToLayeredPng(
    scene: SceneNode,
    options?: LayeredPngOptions,
    requestOptions?: WorkerRequestOptions,
  ): Promise<LayeredPngResult> {
    this.scheduler.assertAccepting();
    this.assertNotDisposed();
    const preparedScene = prepareSceneForTransport(scene);

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitLayeredPngOptions(options);

    const request: WorkerRequest = {
      id: this.nextRequestId(),
      type: "render-layered-png",
      scene: preparedScene.scene,
      ...(workerOptions ? { options: workerOptions } : {}),
    };

    const response = await this.send(request, requestOptions);

    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "render-layered-png-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-layered-png-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.result;
  }

  /** Request WASM text flow layout from the Worker with optional logical cancellation. */
  async layoutTextFlow(
    input: TextFlowInput,
    requestOptions?: WorkerRequestOptions,
  ): Promise<TextFlowResult> {
    this.scheduler.assertAccepting();
    const response = await this.send(
      { id: this.nextRequestId(), type: "layout-text-flow", input },
      requestOptions,
    );
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "layout-text-flow-ok") {
      throw unexpectedWorkerResponseError(response.type, "layout-text-flow-ok");
    }
    return response.result;
  }

  /** Request WASM flow layout around exclusions from the Worker with optional logical cancellation. */
  async layoutTextFlowWithExclusions(
    input: TextFlowWithExclusionsInput,
    requestOptions?: WorkerRequestOptions,
  ): Promise<TextFlowWithExclusionsResult> {
    this.scheduler.assertAccepting();
    const response = await this.send(
      {
        id: this.nextRequestId(),
        type: "layout-text-flow-with-exclusions",
        input,
      },
      requestOptions,
    );
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "layout-text-flow-with-exclusions-ok") {
      throw unexpectedWorkerResponseError(response.type, "layout-text-flow-with-exclusions-ok");
    }
    return response.result;
  }

  /** Request WASM text block measurements from the Worker with optional logical cancellation. */
  async measureTextBlock(
    input: MeasureTextBlockInput,
    requestOptions?: WorkerRequestOptions,
  ): Promise<MeasureTextBlockResult> {
    this.scheduler.assertAccepting();
    const response = await this.send(
      {
        id: this.nextRequestId(),
        type: "measure-text-block",
        input,
      },
      requestOptions,
    );
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "measure-text-block-ok") {
      throw unexpectedWorkerResponseError(response.type, "measure-text-block-ok");
    }
    return response.result;
  }

  /** Request a WASM fitted text size from the Worker with optional logical cancellation. */
  async shrinkwrapText(
    input: ShrinkwrapTextInput,
    requestOptions?: WorkerRequestOptions,
  ): Promise<ShrinkwrapTextResult> {
    this.scheduler.assertAccepting();
    const response = await this.send(
      { id: this.nextRequestId(), type: "shrinkwrap-text", input },
      requestOptions,
    );
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "shrinkwrap-text-ok") {
      throw unexpectedWorkerResponseError(response.type, "shrinkwrap-text-ok");
    }
    return response.result;
  }

  /** Request a WASM fitted flow size from the Worker with optional logical cancellation. */
  async shrinkwrapFlow(
    input: ShrinkwrapFlowInput,
    requestOptions?: WorkerRequestOptions,
  ): Promise<ShrinkwrapFlowResult> {
    this.scheduler.assertAccepting();
    const response = await this.send(
      { id: this.nextRequestId(), type: "shrinkwrap-flow", input },
      requestOptions,
    );
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "shrinkwrap-flow-ok") {
      throw unexpectedWorkerResponseError(response.type, "shrinkwrap-flow-ok");
    }
    return response.result;
  }

  /** Request WASM intrinsic text inline sizes from the Worker with optional logical cancellation. */
  async measureIntrinsicInlineSize(
    input: IntrinsicInlineSizeInput,
    requestOptions?: WorkerRequestOptions,
  ): Promise<IntrinsicInlineSizeResult> {
    this.scheduler.assertAccepting();
    const response = await this.send(
      {
        id: this.nextRequestId(),
        type: "measure-intrinsic-inline-size",
        input,
      },
      requestOptions,
    );
    if (response.type === "error") {
      throw FatalError.fromSerialized(response.error);
    }
    if (response.type !== "measure-intrinsic-inline-size-ok") {
      throw unexpectedWorkerResponseError(response.type, "measure-intrinsic-inline-size-ok");
    }
    return response.result;
  }

  /** Permanently close admission and wait for physical requests and stream cleanup. */
  drain(): Promise<void> {
    if (this.drainPromise) {
      return this.drainPromise;
    }
    this.scheduler.closeAdmission();
    this.drainPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            workerLifecycleError("WORKER_DRAIN_TIMEOUT", "Worker drain timed out", {
              timeoutMs: this.timeoutMs,
            }),
          ),
        this.timeoutMs,
      );
      const work = this.animation
        ? this.animation.cleanup.then(() => this.scheduler.drain())
        : this.scheduler.drain();
      void work.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
    return this.drainPromise;
  }

  /**
   * Dispose the Worker engine.
   *
   * Sends a `dispose` message and terminates the Worker (if we created it).
   * All pending requests are rejected.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    let disposeRequestId: number | undefined;
    try {
      disposeRequestId = this.nextRequestId();
    } catch {
      // ID exhaustion must not prevent local cleanup.
    }
    this.disposed = true;
    const error = workerEngineDisposedError();
    this.animation?.cancel("workerDisposed", error);

    // Best-effort dispose message — must not prevent cleanup
    try {
      if (disposeRequestId !== undefined) {
        const request: WorkerRequest = { id: disposeRequestId, type: "dispose" };
        const transferables = collectRequestTransferables(request);
        this.worker.postMessage(request, transferables);
      }
    } catch {
      // Swallow — Worker may already be in a broken state
    }

    // Reject all pending
    this.scheduler.dispose(error);

    // Remove listeners so externally-provided Workers are left clean
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError as EventListener);

    if (this.ownsWorker) {
      this.worker.terminate();
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private send(
    request: WorkerRequest,
    requestOptions?: WorkerRequestOptions,
  ): Promise<WorkerResponse> {
    return this.scheduler.send(request, requestOptions?.signal);
  }

  private disposeAfterProtocolCorruption(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.animation?.fail(
      workerLifecycleError(
        "WORKER_PROTOCOL_INVALID_RESPONSE",
        "Worker returned an uncorrelatable invalid response",
      ),
    );
    this.scheduler.dispose(invalidWorkerResponseError);
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError as EventListener);
    if (this.ownsWorker) {
      this.worker.terminate();
    }
  }

  private nextRequestId(): number {
    this.assertNotDisposed();
    if (!isWorkerMessageId(this.nextId)) {
      throw workerLifecycleError(
        "WORKER_REQUEST_ID_EXHAUSTED",
        "Worker request ID space has been exhausted",
      );
    }
    const requestId = this.nextId;
    this.nextId += 1;
    return requestId;
  }

  /**
   * An open request can time out while its synchronous Worker preparation is
   * still running. The Worker processes this later request after that open and
   * can therefore reclaim a stream whose response no longer has a listener.
   */
  private closeFrameStreamBestEffort(streamId: number): void {
    if (this.disposed) {
      return;
    }
    void this.scheduler.closeStream(streamId).catch(() => {
      // The owning pool observes physical cleanup through its finish barrier.
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw workerEngineDisposedError();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeWorkerErrorEvent(event: ErrorEvent): string {
  const fallback = "Unknown Worker error";
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(event, "message");
    if (!descriptor || !("value" in descriptor)) {
      return fallback;
    }
    const message = descriptor.value;
    if (message === undefined || message === null || message === "") {
      return fallback;
    }
    return formatUnknownWorkerFailure(message, fallback);
  } catch {
    return fallback;
  }
}

/**
 * Duck-type check for Worker-like objects (has postMessage + terminate).
 * Avoids `instanceof Worker` which fails in non-browser test environments.
 */
function isWorkerLike(value: unknown): value is WorkerLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    typeof Reflect.get(value, "postMessage") === "function" &&
    typeof Reflect.get(value, "terminate") === "function" &&
    typeof Reflect.get(value, "addEventListener") === "function" &&
    typeof Reflect.get(value, "removeEventListener") === "function"
  );
}

type SplitCallbacks<TWorkerOptions> = {
  workerOptions: TWorkerOptions | undefined;
  onWarning: WarningCallback | undefined;
  onPngResolutionAdjusted: PngResolutionAdjustedCallback | undefined;
};

type SplitLayeredSvgCallbacks = {
  workerOptions: WorkerLayeredSvgRenderOptions | undefined;
  onWarning: WarningCallback | undefined;
};

type SplitLayeredPngCallbacks = {
  workerOptions: WorkerLayeredPngRenderOptions | undefined;
  onWarning: WarningCallback | undefined;
  onPngResolutionAdjusted: PngResolutionAdjustedCallback | undefined;
};

/**
 * Split render options into Worker-safe options and main-thread callbacks.
 * Generic so each format-specific option bag — including animated raster
 * schedules — keeps its extra fields in the worker payload type instead of
 * widening to a shared callback-only shape.
 */
type RenderCallbacks = {
  onWarning?: WarningCallback;
  onPngResolutionAdjusted?: PngResolutionAdjustedCallback;
};

function splitOptions<TOptions extends RenderCallbacks>(
  options?: TOptions,
): SplitCallbacks<Omit<TOptions, "onWarning" | "onPngResolutionAdjusted">> {
  if (!options) {
    return { workerOptions: undefined, onWarning: undefined, onPngResolutionAdjusted: undefined };
  }

  const { onWarning: onWarningCb, onPngResolutionAdjusted: onPngAdjCb, ...rest } = options;

  const hasKeys = Object.keys(rest).length > 0;

  return {
    workerOptions: hasKeys ? rest : undefined,
    onWarning: onWarningCb,
    onPngResolutionAdjusted: onPngAdjCb,
  };
}

function splitLayeredSvgOptions(options?: LayeredSvgOptions): SplitLayeredSvgCallbacks {
  if (!options) {
    return { workerOptions: undefined, onWarning: undefined };
  }

  const { onWarning: onWarningCb, ...rest } = options;
  const hasKeys = Object.keys(rest).length > 0;

  return {
    workerOptions: hasKeys ? rest : undefined,
    onWarning: onWarningCb,
  };
}

function splitLayeredPngOptions(options?: LayeredPngOptions): SplitLayeredPngCallbacks {
  if (!options) {
    return { workerOptions: undefined, onWarning: undefined, onPngResolutionAdjusted: undefined };
  }

  const { onWarning: onWarningCb, onPngResolutionAdjusted: onPngAdjCb, ...rest } = options;
  const hasKeys = Object.keys(rest).length > 0;

  return {
    workerOptions: hasKeys ? rest : undefined,
    onWarning: onWarningCb,
    onPngResolutionAdjusted: onPngAdjCb,
  };
}

/**
 * Extract `PngResolutionAdjustedWarning` from a `PNG_RESOLUTION_ADJUSTED`
 * warning's context bag. Returns `undefined` if the context is missing
 * required fields.
 */
function extractPngResolutionWarning(
  warning: SerializedRecoverableError | RecoverableError,
): PngResolutionAdjustedWarning | undefined {
  if (warning.code !== "PNG_RESOLUTION_ADJUSTED" || !warning.context) {
    return undefined;
  }
  const ctx = warning.context;
  const requestedScale = getNumericContextValue(ctx, "requestedScale");
  const appliedScale = getNumericContextValue(ctx, "appliedScale");
  const baseWidth = getNumericContextValue(ctx, "baseWidth");
  const baseHeight = getNumericContextValue(ctx, "baseHeight");
  const requestedWidth = getNumericContextValue(ctx, "requestedWidth");
  const requestedHeight = getNumericContextValue(ctx, "requestedHeight");
  const outputWidth = getNumericContextValue(ctx, "outputWidth");
  const outputHeight = getNumericContextValue(ctx, "outputHeight");
  const maxLongEdge = getNumericContextValue(ctx, "maxLongEdge");
  const maxPixels = getNumericContextValue(ctx, "maxPixels");

  if (
    requestedScale === undefined ||
    appliedScale === undefined ||
    baseWidth === undefined ||
    baseHeight === undefined ||
    requestedWidth === undefined ||
    requestedHeight === undefined ||
    outputWidth === undefined ||
    outputHeight === undefined ||
    maxLongEdge === undefined ||
    maxPixels === undefined
  ) {
    return undefined;
  }

  const result: PngResolutionAdjustedWarning = {
    requestedScale,
    appliedScale,
    baseWidth,
    baseHeight,
    requestedWidth,
    requestedHeight,
    outputWidth,
    outputHeight,
    maxLongEdge,
    maxPixels,
  };
  return result;
}

function getNumericContextValue(
  context: NonNullable<SerializedRecoverableError["context"]>,
  key: keyof PngResolutionAdjustedWarning,
): number | undefined {
  const value = context[key];
  return typeof value === "number" ? value : undefined;
}

function rehydrateWorkerWarnings(
  warnings: readonly SerializedRecoverableError[],
): RecoverableError[] {
  return warnings.map((warning) => RecoverableError.fromSerialized(warning));
}

function forwardRehydratedWorkerWarnings(options: {
  warnings: readonly RecoverableError[];
  onWarning: WarningCallback | undefined;
  onPngResolutionAdjusted: PngResolutionAdjustedCallback | undefined;
  detachForRetainedIr: boolean;
  check?: () => void;
}): void {
  const { warnings, onWarning, onPngResolutionAdjusted, detachForRetainedIr } = options;
  for (const warning of warnings) {
    if (onPngResolutionAdjusted) {
      const pngWarning = extractPngResolutionWarning(warning);
      if (pngWarning) {
        onPngResolutionAdjusted(pngWarning);
        options.check?.();
      }
    }
    if (onWarning) {
      if (!detachForRetainedIr) {
        onWarning(warning);
        options.check?.();
        continue;
      }
      const serialized = warning.toJSON();
      onWarning(
        new RecoverableError(serialized.code, serialized.message, {
          fallback: serialized.fallback,
          stage: serialized.stage,
          ...(serialized.nodeId !== undefined && { nodeId: serialized.nodeId }),
          ...(serialized.context !== undefined && { context: serialized.context }),
        }),
      );
      options.check?.();
    }
  }
}

/**
 * Forward Worker warnings to the caller's callbacks.
 *
 * `PNG_RESOLUTION_ADJUSTED` warnings are also dispatched to
 * `onPngResolutionAdjusted` when provided.
 */
export function forwardWorkerWarnings(
  warnings: readonly SerializedRecoverableError[],
  onWarning: WarningCallback | undefined,
  onPngResolutionAdjusted?: PngResolutionAdjustedCallback | undefined,
): void {
  forwardRehydratedWorkerWarnings({
    warnings: rehydrateWorkerWarnings(warnings),
    onWarning,
    onPngResolutionAdjusted,
    detachForRetainedIr: false,
  });
}
