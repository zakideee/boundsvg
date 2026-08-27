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
  PngResolutionAdjustedWarning,
  RenderAnimatedGifOptions,
  RenderAnimatedWebpOptions,
  RenderOptions,
  SceneNode,
  ShrinkwrapFlowInput,
  ShrinkwrapFlowResult,
  ShrinkwrapTextInput,
  ShrinkwrapTextResult,
  StructuredError,
  SymbolDefinition,
  TextFlowInput,
  TextFlowResult,
  TextFlowWithExclusionsInput,
  TextFlowWithExclusionsResult,
} from "@boundsvg/core";
import { FatalError, RecoverableError } from "@boundsvg/core";
import { rehydrateError } from "./error-rehydration.js";
import {
  snapshotWorkerLayoutTransitionInput,
  type WorkerLayoutTransitionInput,
} from "./layout-transition-transport.js";
import {
  collectRequestTransferables,
  type FontTransfer,
  type IndexedFrameTime,
  isWorkerResponse,
  type WorkerFrameRenderOptions,
  type WorkerLayeredPngRenderOptions,
  type WorkerLayeredSvgRenderOptions,
  type WorkerRenderOptions,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

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

export type WorkerLike = Pick<
  Worker,
  "postMessage" | "terminate" | "addEventListener" | "removeEventListener"
>;

/** Default timeout for all Worker calls (30 s). */
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Render result
// ---------------------------------------------------------------------------

export type WorkerRenderSvgResult = {
  svg: string;
  warnings: StructuredError[];
};

export type WorkerRenderPngResult = {
  png: Uint8Array;
  warnings: StructuredError[];
};

export type WorkerRenderLayeredSvgResult = LayeredSvgResult & {
  warnings: StructuredError[];
};

export type WorkerRenderLayeredPngResult = LayeredPngResult & {
  warnings: StructuredError[];
};

export type WorkerRenderSvgAndIrResult = {
  svg: string;
  ir: IR;
  warnings: StructuredError[];
};

// ---------------------------------------------------------------------------
// Pending request bookkeeping
// ---------------------------------------------------------------------------

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type WarningCallback = NonNullable<RenderOptions["onWarning"]>;
type RecoverableWarning = Parameters<WarningCallback>[0];
type PngResolutionAdjustedCallback = NonNullable<RenderOptions["onPngResolutionAdjusted"]>;

export type WorkerRenderedFrame =
  | { format: "svg"; data: string; warnings: StructuredError[] }
  | { format: "png"; data: Uint8Array; warnings: StructuredError[] };

export type WorkerPoolEndpoint = {
  open(
    scene: SceneNode,
    schedule: IndexedFrameTime[],
    options: WorkerFrameRenderOptions,
  ): Promise<{ streamId: number; warnings: StructuredError[] }>;
  openLayoutTransition(
    transition: WorkerLayoutTransitionInput,
    schedule: IndexedFrameTime[],
    options: WorkerFrameRenderOptions,
  ): Promise<{ streamId: number; warnings: StructuredError[] }>;
  next(streamId: number): Promise<Frame | undefined>;
  close(streamId: number): Promise<void>;
  render(
    scene: SceneNode,
    format: "svg" | "png",
    options: WorkerRenderOptions,
  ): Promise<WorkerRenderedFrame>;
};

const workerPoolEndpoints = new WeakMap<WorkerEngine, WorkerPoolEndpoint>();

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

export class WorkerEngine {
  private readonly worker: WorkerLike;
  private readonly ownsWorker: boolean;
  private readonly timeoutMs: number;
  private nextId = 1;
  private disposed = false;
  private readonly pending = new Map<number, PendingRequest<WorkerResponse>>();

  /** Bound handlers for addEventListener / removeEventListener. */
  private readonly handleMessage: (event: MessageEvent) => void;
  private readonly handleError: (event: ErrorEvent) => void;

  private constructor(worker: WorkerLike, ownsWorker: boolean, timeoutMs: number) {
    this.worker = worker;
    this.ownsWorker = ownsWorker;
    this.timeoutMs = timeoutMs;

    this.handleMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isWorkerResponse(data)) {
        const responseId = getWorkerResponseId(data);
        if (responseId !== undefined) {
          const entry = this.pending.get(responseId);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(responseId);
            entry.reject(invalidWorkerResponseError(responseId));
          }
        }
        return;
      }

      const entry = this.pending.get(data.id);
      if (!entry) {
        return;
      }

      clearTimeout(entry.timer);
      this.pending.delete(data.id);
      entry.resolve(data);
    };

    this.handleError = (event: ErrorEvent) => {
      // Worker is fatally broken — transition to disposed state
      if (this.disposed) {
        return;
      }
      this.disposed = true;

      const error = workerLifecycleError("WORKER_CRASHED", `Worker error: ${event.message}`, {
        workerMessage: event.message,
      });
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.reject(error);
      }

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
        const streamId = this.nextId++;
        let response: WorkerResponse;
        try {
          response = await this.send({
            id: streamId,
            type: "open-frame-stream",
            scene,
            schedule,
            options,
          });
        } catch (error) {
          this.closeFrameStreamBestEffort(streamId);
          throw error;
        }
        if (response.type === "error") {
          this.closeFrameStreamBestEffort(streamId);
          throw rehydrateError(response.error);
        }
        if (response.type !== "open-frame-stream-ok") {
          this.closeFrameStreamBestEffort(streamId);
          throw unexpectedWorkerResponseError(response.type, "open-frame-stream-ok");
        }
        return { streamId: response.streamId, warnings: response.warnings };
      },
      openLayoutTransition: async (transition, schedule, options) => {
        this.assertNotDisposed();
        const streamId = this.nextId++;
        let response: WorkerResponse;
        try {
          response = await this.send({
            id: streamId,
            type: "open-layout-transition-frame-stream",
            transition,
            schedule,
            options,
          });
        } catch (error) {
          this.closeFrameStreamBestEffort(streamId);
          throw error;
        }
        if (response.type === "error") {
          this.closeFrameStreamBestEffort(streamId);
          throw rehydrateError(response.error);
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
          id: this.nextId++,
          type: "next-frame-stream",
          streamId,
        });
        if (response.type === "error") {
          throw rehydrateError(response.error);
        }
        if (response.type !== "next-frame-stream-ok") {
          throw unexpectedWorkerResponseError(response.type, "next-frame-stream-ok");
        }
        return response.done ? undefined : response.frame;
      },
      close: async (streamId) => {
        this.assertNotDisposed();
        const response = await this.send({
          id: this.nextId++,
          type: "close-frame-stream",
          streamId,
        });
        if (response.type === "error") {
          throw rehydrateError(response.error);
        }
        if (response.type !== "close-frame-stream-ok") {
          throw unexpectedWorkerResponseError(response.type, "close-frame-stream-ok");
        }
      },
      render: async (scene, format, options) => {
        this.assertNotDisposed();
        const response = await this.send(
          format === "svg"
            ? { id: this.nextId++, type: "render-svg", scene, options }
            : { id: this.nextId++, type: "render-png", scene, options },
        );
        if (response.type === "error") {
          throw rehydrateError(response.error);
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
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
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

    const engine = new WorkerEngine(worker, ownsWorker, timeoutMs);

    let response: WorkerResponse;
    try {
      response = await engine.send({
        id: engine.nextId++,
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
      throw rehydrateError(response.error);
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
  async renderToSvg(scene: SceneNode, options?: RenderOptions): Promise<string> {
    this.assertNotDisposed();

    const { workerOptions, onWarning } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-svg",
      scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-svg-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-svg-ok");
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
    options?: RenderOptions,
  ): Promise<{ svg: string; ir: IR }> {
    this.assertNotDisposed();

    const { workerOptions, onWarning } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-svg-and-ir",
      scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-svg-and-ir-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-svg-and-ir-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning);
    // Rehydrate IR with empty warnings (originals were non-serializable;
    // warnings already forwarded above via onWarning callback)
    const ir: IR = { ...response.ir, warnings: [] };
    return { svg: response.svg, ir };
  }

  /**
   * Render a scene to PNG inside the Worker.
   *
   * The PNG `Uint8Array` is transferred (zero-copy) from the Worker.
   * Warnings are forwarded to `options.onWarning` if provided.
   */
  async renderToPng(scene: SceneNode, options?: RenderOptions): Promise<Uint8Array> {
    this.assertNotDisposed();

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-png",
      scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
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
  async renderToWebp(scene: SceneNode, options?: RenderOptions): Promise<Uint8Array> {
    this.assertNotDisposed();

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-webp",
      scene,
      ...(workerOptions && { options: workerOptions }),
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-webp-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-webp-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.webp;
  }

  /**
   * Render a declarative animation to an animated lossless WebP inside the
   * Worker. The bytes are transferred (zero-copy) from the Worker.
   */
  async renderToAnimatedWebp(
    scene: SceneNode,
    options: RenderAnimatedWebpOptions,
  ): Promise<Uint8Array> {
    this.assertNotDisposed();

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-animated-webp",
      scene,
      options: { ...workerOptions, iterations: options.iterations },
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-animated-webp-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-animated-webp-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.webp;
  }

  /**
   * Compile two flattened layout states in the Worker and render the result to
   * animated lossless WebP. `CompiledScene` is intentionally not transported.
   */
  async renderLayoutTransitionToAnimatedWebp(
    input: WorkerLayoutTransitionInput,
    options: RenderAnimatedWebpOptions,
  ): Promise<Uint8Array> {
    this.assertNotDisposed();
    const transition = snapshotWorkerLayoutTransitionInput(input);
    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);
    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-layout-transition-animated-webp",
      transition,
      options: { ...workerOptions, iterations: options.iterations },
    };
    const response = await this.send(request);
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-animated-webp-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-animated-webp-ok");
    }
    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.webp;
  }

  /**
   * Render a declarative animation to an animated GIF inside the Worker. The
   * bytes are transferred (zero-copy) from the Worker.
   */
  async renderToAnimatedGif(
    scene: SceneNode,
    options: RenderAnimatedGifOptions,
  ): Promise<Uint8Array> {
    this.assertNotDisposed();

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-animated-gif",
      scene,
      options: { ...workerOptions, iterations: options.iterations },
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-animated-gif-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-animated-gif-ok");
    }

    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.gif;
  }

  /**
   * Compile two flattened layout states in the Worker and render the result to
   * animated GIF. `CompiledScene` is intentionally not transported.
   */
  async renderLayoutTransitionToAnimatedGif(
    input: WorkerLayoutTransitionInput,
    options: RenderAnimatedGifOptions,
  ): Promise<Uint8Array> {
    this.assertNotDisposed();
    const transition = snapshotWorkerLayoutTransitionInput(input);
    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitOptions(options);
    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-layout-transition-animated-gif",
      transition,
      options: { ...workerOptions, iterations: options.iterations },
    };
    const response = await this.send(request);
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-animated-gif-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-animated-gif-ok");
    }
    forwardWorkerWarnings(response.warnings, onWarning, onPngResolutionAdjusted);
    return response.gif;
  }

  async renderToLayeredSvg(
    scene: SceneNode,
    options?: LayeredSvgOptions,
  ): Promise<LayeredSvgResult> {
    this.assertNotDisposed();

    const { workerOptions, onWarning } = splitLayeredSvgOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-layered-svg",
      scene,
      ...(workerOptions ? { options: workerOptions } : {}),
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-layered-svg-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-layered-svg-ok");
    }

    forwardWorkerWarnings(response.result.warnings, onWarning);
    const { warnings: _warnings, ...result } = response.result;
    return result;
  }

  async renderToLayeredPng(
    scene: SceneNode,
    options?: LayeredPngOptions,
  ): Promise<LayeredPngResult> {
    this.assertNotDisposed();

    const { workerOptions, onWarning, onPngResolutionAdjusted } = splitLayeredPngOptions(options);

    const request: WorkerRequest = {
      id: this.nextId++,
      type: "render-layered-png",
      scene,
      ...(workerOptions ? { options: workerOptions } : {}),
    };

    const response = await this.send(request);

    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "render-layered-png-ok") {
      throw unexpectedWorkerResponseError(response.type, "render-layered-png-ok");
    }

    forwardWorkerWarnings(response.result.warnings, onWarning, onPngResolutionAdjusted);
    const { warnings: _warnings, ...result } = response.result;
    return result;
  }

  async layoutTextFlow(input: TextFlowInput): Promise<TextFlowResult> {
    const response = await this.send({ id: this.nextRequestId(), type: "layout-text-flow", input });
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "layout-text-flow-ok") {
      throw unexpectedWorkerResponseError(response.type, "layout-text-flow-ok");
    }
    return response.result;
  }

  async layoutTextFlowWithExclusions(
    input: TextFlowWithExclusionsInput,
  ): Promise<TextFlowWithExclusionsResult> {
    const response = await this.send({
      id: this.nextRequestId(),
      type: "layout-text-flow-with-exclusions",
      input,
    });
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "layout-text-flow-with-exclusions-ok") {
      throw unexpectedWorkerResponseError(response.type, "layout-text-flow-with-exclusions-ok");
    }
    return response.result;
  }

  async measureTextBlock(input: MeasureTextBlockInput): Promise<MeasureTextBlockResult> {
    const response = await this.send({
      id: this.nextRequestId(),
      type: "measure-text-block",
      input,
    });
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "measure-text-block-ok") {
      throw unexpectedWorkerResponseError(response.type, "measure-text-block-ok");
    }
    return response.result;
  }

  async shrinkwrapText(input: ShrinkwrapTextInput): Promise<ShrinkwrapTextResult> {
    const response = await this.send({ id: this.nextRequestId(), type: "shrinkwrap-text", input });
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "shrinkwrap-text-ok") {
      throw unexpectedWorkerResponseError(response.type, "shrinkwrap-text-ok");
    }
    return response.result;
  }

  async shrinkwrapFlow(input: ShrinkwrapFlowInput): Promise<ShrinkwrapFlowResult> {
    const response = await this.send({ id: this.nextRequestId(), type: "shrinkwrap-flow", input });
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "shrinkwrap-flow-ok") {
      throw unexpectedWorkerResponseError(response.type, "shrinkwrap-flow-ok");
    }
    return response.result;
  }

  async measureIntrinsicInlineSize(
    input: IntrinsicInlineSizeInput,
  ): Promise<IntrinsicInlineSizeResult> {
    const response = await this.send({
      id: this.nextRequestId(),
      type: "measure-intrinsic-inline-size",
      input,
    });
    if (response.type === "error") {
      throw rehydrateError(response.error);
    }
    if (response.type !== "measure-intrinsic-inline-size-ok") {
      throw unexpectedWorkerResponseError(response.type, "measure-intrinsic-inline-size-ok");
    }
    return response.result;
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
    this.disposed = true;

    // Best-effort dispose message — must not prevent cleanup
    try {
      const request: WorkerRequest = { id: this.nextId++, type: "dispose" };
      const transferables = collectRequestTransferables(request);
      this.worker.postMessage(request, transferables);
    } catch {
      // Swallow — Worker may already be in a broken state
    }

    // Reject all pending
    const error = workerEngineDisposedError();
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(error);
    }

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

  private send(request: WorkerRequest): Promise<WorkerResponse> {
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(workerTimeoutError(request, this.timeoutMs));
      }, this.timeoutMs);

      this.pending.set(request.id, { resolve, reject, timer });

      try {
        const transferables = collectRequestTransferables(request);
        this.worker.postMessage(request, transferables);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(workerTransportError(request, err));
      }
    });
  }

  private nextRequestId(): number {
    this.assertNotDisposed();
    return this.nextId++;
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
    void this.send({
      id: this.nextId++,
      type: "close-frame-stream",
      streamId,
    }).catch(() => {
      // Worker failure or disposal also reclaims its prepared scenes.
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

function workerLifecycleError(
  code: string,
  message: string,
  context: Record<string, unknown> = {},
): FatalError {
  return new FatalError(code, message, { ...context, stage: "engine" });
}

function workerEngineDisposedError(): FatalError {
  return workerLifecycleError("WORKER_ENGINE_DISPOSED", "WorkerEngine has been disposed");
}

function getWorkerResponseId(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const id = Reflect.get(value, "id");
  return typeof id === "number" && Number.isSafeInteger(id) ? id : undefined;
}

function invalidWorkerResponseError(requestId: number): FatalError {
  return workerLifecycleError(
    "WORKER_PROTOCOL_INVALID_RESPONSE",
    `Worker returned an invalid response for request ${requestId}`,
    { requestId },
  );
}

function unexpectedWorkerResponseError(
  responseType: WorkerResponse["type"],
  expectedResponseType: WorkerResponse["type"],
  messageContext = "",
): FatalError {
  return workerLifecycleError(
    "WORKER_PROTOCOL_UNEXPECTED_RESPONSE",
    `Unexpected response type${messageContext}: ${responseType}`,
    { responseType, expectedResponseType },
  );
}

function workerTimeoutError(request: WorkerRequest, timeoutMs: number): FatalError {
  return workerLifecycleError(
    "WORKER_REQUEST_TIMEOUT",
    `Worker request timed out after ${timeoutMs}ms (id=${request.id})`,
    { requestId: request.id, requestType: request.type, timeoutMs },
  );
}

function workerTransportError(request: WorkerRequest, error: unknown): FatalError {
  const causeMessage = describeWorkerFailure(error);
  return workerLifecycleError(
    "WORKER_TRANSPORT_FAILED",
    `Worker request could not be posted: ${causeMessage}`,
    { requestId: request.id, requestType: request.type, causeMessage },
  );
}

function describeWorkerFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

type SplitCallbacks<TWorkerOptions = WorkerRenderOptions> = {
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
 * Generic so option bags that extend `RenderOptions` — animated raster
 * schedules, for instance — keep their extra fields in the worker payload
 * type rather than widening to plain `RenderOptions`.
 */
function splitOptions<TOptions extends RenderOptions>(
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
  warning: StructuredError,
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
  context: NonNullable<StructuredError["context"]>,
  key: keyof PngResolutionAdjustedWarning,
): number | undefined {
  const value = context[key];
  return typeof value === "number" ? value : undefined;
}

function rehydrateRecoverableWarning(warning: StructuredError): RecoverableWarning {
  const rehydrated = rehydrateError(warning);
  if (rehydrated instanceof RecoverableError) {
    return rehydrated;
  }
  throw workerLifecycleError(
    "WORKER_PROTOCOL_WARNING_SEVERITY",
    `Expected recoverable warning from worker, received ${rehydrated.code}`,
    { warningCode: rehydrated.code, warningSeverity: rehydrated.severity },
  );
}

/**
 * Forward Worker warnings to the caller's callbacks.
 *
 * `PNG_RESOLUTION_ADJUSTED` warnings are also dispatched to
 * `onPngResolutionAdjusted` when provided.
 */
export function forwardWorkerWarnings(
  warnings: StructuredError[],
  onWarning: WarningCallback | undefined,
  onPngResolutionAdjusted?: PngResolutionAdjustedCallback | undefined,
): void {
  if (warnings.length === 0) {
    return;
  }
  for (const warning of warnings) {
    if (onPngResolutionAdjusted) {
      const pngWarning = extractPngResolutionWarning(warning);
      if (pngWarning) {
        onPngResolutionAdjusted(pngWarning);
      }
    }
    onWarning?.(rehydrateRecoverableWarning(warning));
  }
}
