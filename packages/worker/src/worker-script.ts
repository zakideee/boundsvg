/**
 * Worker entry point for boundsvg.
 *
 * This script runs inside a Web Worker. It initializes the WASM engine,
 * registers fonts, and handles render requests from the main thread.
 *
 * Usage (from main thread):
 *   const worker = new Worker(new URL("@boundsvg/worker/worker", import.meta.url), { type: "module" });
 *   worker.postMessage({ id: 1, type: "init", fonts: [...] });
 */

import {
  createEngineAsync,
  type Engine,
  FatalError,
  type Frame,
  type IntrinsicInlineSizeInput,
  type MeasureTextBlockInput,
  type RecoverableError,
  type SerializedFatalError,
  type SerializedRecoverableError,
  type ShrinkwrapFlowInput,
  type ShrinkwrapTextInput,
  type TextFlowInput,
  type TextFlowWithExclusionsInput,
  type VNode,
} from "@boundsvg/core";
import {
  type AnimatedRasterJob,
  type AnimatedRasterJobInput,
  createAnimatedRasterJob,
  initWasm,
} from "@boundsvg/core/wasm";
import { formatUnknownWorkerFailure } from "./diagnostic-format.js";
import {
  collectResponseTransferables,
  type DecodedWorkerRequest,
  decodeWorkerRequestMessage,
  type WorkerLayeredPngRenderOptions,
  type WorkerLayeredSvgRenderOptions,
  type WorkerRenderAnimatedSvgOptions,
  type WorkerRenderPngOptions,
  type WorkerRenderSvgOptions,
  type WorkerRenderWebpOptions,
  type WorkerResponse,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let engine: Engine | null = null;

type ActiveFrameStream = {
  iterator: Iterator<Frame>;
  schedule: ReadonlyArray<{ index: number; timeMs: number }>;
};

/** Standalone frame iterators retained by request ID until close or exhaustion. */
const activeFrameStreams = new Map<number, ActiveFrameStream>();
/** At most one logical raster job shares the Engine animation capability. */
const activeRasterStreams = new Map<number, AnimatedRasterJob>();

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/** Declared in lib.webworker.d.ts but we need the type for `self`. */
declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent) => {
  const data: unknown = event.data;
  const { id: requestId, message: request, error: decodeError } = decodeWorkerRequestMessage(data);

  if (request === undefined) {
    // Preserve the correlation ID captured by the failed decode, or fall back to -1.
    const fallbackId = requestId ?? -1;
    const response: WorkerResponse = {
      id: fallbackId,
      type: "error",
      error:
        decodeError?.toJSON() ??
        ({
          severity: "fatal",
          code: "WORKER_INVALID_MESSAGE",
          message: "Worker received an invalid request message.",
          stage: "engine",
        } as const),
    };
    self.postMessage(response);
    return;
  }

  void handleMessage(request);
};

async function handleMessage(request: DecodedWorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case "init":
        await handleInit(request);
        break;
      case "render-svg":
        handleRenderSvg(request.id, request.scene, request.options);
        break;
      case "render-animated-svg":
        handleRenderAnimatedSvg(request.id, request.scene, request.options);
        break;
      case "render-svg-and-ir":
        handleRenderSvgAndIr(request.id, request.scene, request.options);
        break;
      case "render-animated-svg-and-ir":
        handleRenderAnimatedSvgAndIr(request.id, request.scene, request.options);
        break;
      case "render-png":
        handleRenderPng(request.id, request.scene, request.options);
        break;
      case "render-webp":
        handleRenderWebp(request.id, request.scene, request.options);
        break;
      case "open-raster-stream":
      case "open-layout-transition-raster-stream":
        handleOpenRasterStream(request);
        break;
      case "next-raster-stream":
        handleNextRasterStream(request.id, request.streamId);
        break;
      case "close-raster-stream":
        handleCloseRasterStream(request.id, request.streamId);
        break;
      case "render-layered-svg":
        handleRenderLayeredSvg(request.id, request.scene, request.options);
        break;
      case "render-layered-png":
        handleRenderLayeredPng(request.id, request.scene, request.options);
        break;
      case "open-frame-stream":
        handleOpenFrameStream(request);
        break;
      case "open-layout-transition-frame-stream":
        handleOpenLayoutTransitionFrameStream(request);
        break;
      case "next-frame-stream":
        handleNextFrameStream(request.id, request.streamId);
        break;
      case "close-frame-stream":
        handleCloseFrameStream(request.id, request.streamId);
        break;
      case "layout-text-flow":
        handleLayoutTextFlow(request.id, request.input);
        break;
      case "layout-text-flow-with-exclusions":
        handleLayoutTextFlowWithExclusions(request.id, request.input);
        break;
      case "measure-text-block":
        handleMeasureTextBlock(request.id, request.input);
        break;
      case "shrinkwrap-text":
        handleShrinkwrapText(request.id, request.input);
        break;
      case "shrinkwrap-flow":
        handleShrinkwrapFlow(request.id, request.input);
        break;
      case "measure-intrinsic-inline-size":
        handleMeasureIntrinsicInlineSize(request.id, request.input);
        break;
      case "dispose":
        handleDispose(request.id);
        break;
    }
  } catch (err: unknown) {
    respond({
      id: request.id,
      type: "error",
      error: toSerializedFatalError(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleInit(request: Extract<DecodedWorkerRequest, { type: "init" }>): Promise<void> {
  closeAllStreams();
  if (engine) {
    engine.dispose();
    engine = null;
  }

  // Load WASM module (web target)
  const { loadWasmModule } = await import("@boundsvg/browser/wasm");
  const wasmModule = await loadWasmModule();
  await initWasm(wasmModule);

  // Convert FontTransfer (ArrayBuffer) → Uint8Array for engine
  const fontDefs = request.fonts.map((font) => ({
    alias: font.alias,
    weight: font.weight,
    style: font.style,
    data: new Uint8Array(font.data),
  }));

  engine = await createEngineAsync({
    fonts: fontDefs,
    geometries: request.geometries,
    symbols: request.symbols,
  });

  respond({ id: request.id, type: "init-ok" });
}

function handleRenderSvg(id: number, scene: VNode, options?: WorkerRenderSvgOptions): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const warnings: SerializedRecoverableError[] = [];
  const svg = eng.renderToSvg(scene, {
    ...options,
    onWarning: (warning) => warnings.push(warning.toJSON()),
  });
  respond({ id, type: "render-svg-ok", svg, warnings });
}

function handleRenderAnimatedSvg(
  id: number,
  scene: VNode,
  options: WorkerRenderAnimatedSvgOptions,
): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const warnings: SerializedRecoverableError[] = [];
  const svg = eng.renderToAnimatedSvg(scene, {
    ...options,
    onWarning: (warning) => warnings.push(warning.toJSON()),
  });
  respond({ id, type: "render-animated-svg-ok", svg, warnings });
}

function handleRenderSvgAndIr(id: number, scene: VNode, options?: WorkerRenderSvgOptions): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const { svg, ir } = eng.renderToSvgAndIR(scene, options);
  const warnings = ir.warnings.map((warning) => warning.toJSON());
  const { warnings: _irWarnings, ...serializableIr } = ir;
  respond({ id, type: "render-svg-and-ir-ok", svg, ir: serializableIr, warnings });
}

function handleRenderAnimatedSvgAndIr(
  id: number,
  scene: VNode,
  options: WorkerRenderAnimatedSvgOptions,
): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const { svg, ir } = eng.renderToAnimatedSvgAndIR(scene, options);
  const warnings = ir.warnings.map((warning) => warning.toJSON());
  const { warnings: _irWarnings, ...serializableIr } = ir;
  respond({ id, type: "render-animated-svg-and-ir-ok", svg, ir: serializableIr, warnings });
}

function handleRenderPng(id: number, scene: VNode, options?: WorkerRenderPngOptions): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const warnings: SerializedRecoverableError[] = [];
  const png = eng.renderToPng(scene, {
    ...options,
    onWarning: (warning) => warnings.push(warning.toJSON()),
  });
  const response: WorkerResponse = { id, type: "render-png-ok", png, warnings };
  // Transfer the PNG buffer for zero-copy
  self.postMessage(response, collectResponseTransferables(response));
}

function handleRenderWebp(id: number, scene: VNode, options?: WorkerRenderWebpOptions): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const warnings: SerializedRecoverableError[] = [];
  const webp = eng.renderToWebp(scene, {
    ...options,
    onWarning: (warning) => warnings.push(warning.toJSON()),
  });
  const response: WorkerResponse = { id, type: "render-webp-ok", webp, warnings };
  // Transfer the WebP buffer for zero-copy
  self.postMessage(response, collectResponseTransferables(response));
}

/** Register the shared Core job without preparing or encoding a frame. */
function handleOpenRasterStream(
  request: Extract<
    DecodedWorkerRequest,
    { type: "open-raster-stream" | "open-layout-transition-raster-stream" }
  >,
): void {
  const eng = requireEngine(request.id);
  if (!eng) {
    return;
  }
  if (activeFrameStreams.size !== 0 || activeRasterStreams.size !== 0) {
    throw new FatalError("ANIMATED_RASTER_JOB_BUSY", "Worker already has an active stream", {
      stage: "engine",
      context: { format: request.format, operation: "open", reason: "activeAnimation" },
    });
  }
  const { skipValidation, textPathMode, ...emitOptions } = request.options;
  const source =
    request.type === "open-raster-stream"
      ? { kind: "scene" as const, input: request.scene }
      : {
          kind: "transition" as const,
          input: request.transition,
          compileOptions: { skipValidation, textPathMode },
        };
  const input: AnimatedRasterJobInput =
    request.type === "open-raster-stream"
      ? ({
          format: request.format,
          source: { kind: "scene", input: request.scene },
          options: request.options,
        } as AnimatedRasterJobInput)
      : ({ format: request.format, source, options: emitOptions } as AnimatedRasterJobInput);
  activeRasterStreams.set(request.id, createAnimatedRasterJob(eng, input));
  respond({ id: request.id, type: "open-raster-stream-ok", streamId: request.id });
}

/** Advance once; transfer only the current copied chunk, never future output. */
function handleNextRasterStream(id: number, streamId: number): void {
  const job = activeRasterStreams.get(streamId);
  if (!job) {
    throw new FatalError("WORKER_STREAM_NOT_FOUND", "Raster stream does not exist", {
      stage: "engine",
    });
  }
  const step = job.advance();
  let response: WorkerResponse;
  if (step.kind === "chunk") {
    const chunk =
      step.chunk.byteOffset === 0 &&
      step.chunk.byteLength === step.chunk.buffer.byteLength &&
      step.chunk.buffer instanceof ArrayBuffer
        ? step.chunk.buffer
        : step.chunk.slice().buffer;
    response = { id, type: "next-raster-stream-ok", streamId, kind: "chunk", chunk };
  } else if (step.kind === "ready") {
    response = {
      id,
      type: "next-raster-stream-ok",
      streamId,
      kind: "ready",
      warnings: [...step.warnings],
    };
  } else {
    response = { id, type: "next-raster-stream-ok", streamId, ...step };
  }
  self.postMessage(response, collectResponseTransferables(response));
}

/** Idempotently close the remote owner before acknowledging physical slot reuse. */
function handleCloseRasterStream(id: number, streamId: number): void {
  const job = activeRasterStreams.get(streamId);
  activeRasterStreams.delete(streamId);
  job?.dispose();
  respond({ id, type: "close-raster-stream-ok", streamId });
}

function handleRenderLayeredSvg(
  id: number,
  scene: VNode,
  options?: WorkerLayeredSvgRenderOptions,
): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const warnings: SerializedRecoverableError[] = [];
  const result = eng.renderToLayeredSvg(scene, {
    ...options,
    onWarning: (warning: RecoverableError) => warnings.push(warning.toJSON()),
  });
  respond({
    id,
    type: "render-layered-svg-ok",
    result,
    warnings,
  });
}

function handleRenderLayeredPng(
  id: number,
  scene: VNode,
  options?: WorkerLayeredPngRenderOptions,
): void {
  const eng = requireEngine(id);
  if (!eng) {
    return;
  }

  const warnings: SerializedRecoverableError[] = [];
  const result = eng.renderToLayeredPng(scene, {
    ...options,
    onWarning: (warning: RecoverableError) => warnings.push(warning.toJSON()),
  });
  const response: WorkerResponse = {
    id,
    type: "render-layered-png-ok",
    result,
    warnings,
  };
  self.postMessage(response, collectResponseTransferables(response));
}

function handleOpenFrameStream(
  request: Extract<DecodedWorkerRequest, { type: "open-frame-stream" }>,
): void {
  const eng = requireEngine(request.id);
  if (!eng) {
    return;
  }
  if (activeRasterStreams.size > 0 || activeFrameStreams.has(request.id)) {
    throw new FatalError(
      "WORKER_FRAME_STREAM_EXISTS",
      `Frame stream ${request.id} already exists`,
      { stage: "engine" },
    );
  }

  // renderFrames prepares eagerly, so every warning in the current core
  // contract is delivered before this open response is posted.
  const warnings: SerializedRecoverableError[] = [];
  const iterator = eng
    .renderFrames(request.scene, {
      ...request.options,
      timesMs: request.schedule.map((entry) => entry.timeMs),
      onWarning: (warning) => warnings.push(warning.toJSON()),
    })
    [Symbol.iterator]();
  activeFrameStreams.set(request.id, { iterator, schedule: request.schedule });
  respond({
    id: request.id,
    type: "open-frame-stream-ok",
    streamId: request.id,
    warnings,
  });
}

function handleOpenLayoutTransitionFrameStream(
  request: Extract<DecodedWorkerRequest, { type: "open-layout-transition-frame-stream" }>,
): void {
  const eng = requireEngine(request.id);
  if (!eng) {
    return;
  }
  if (activeRasterStreams.size > 0 || activeFrameStreams.has(request.id)) {
    throw new FatalError(
      "WORKER_FRAME_STREAM_EXISTS",
      `Frame stream ${request.id} already exists`,
      { stage: "engine" },
    );
  }

  const { skipValidation, textPathMode, ...renderOptions } = request.options;
  const compiled = eng.compileLayoutTransition(request.transition, {
    skipValidation,
    textPathMode,
  });
  const warnings: SerializedRecoverableError[] = [];
  const iterator = eng
    .renderCompiledFrames(compiled, {
      ...renderOptions,
      timesMs: request.schedule.map((entry) => entry.timeMs),
      onWarning: (warning) => warnings.push(warning.toJSON()),
    })
    [Symbol.iterator]();
  activeFrameStreams.set(request.id, { iterator, schedule: request.schedule });
  respond({
    id: request.id,
    type: "open-frame-stream-ok",
    streamId: request.id,
    warnings,
  });
}

function handleNextFrameStream(id: number, streamId: number): void {
  const activeStream = activeFrameStreams.get(streamId);
  if (!activeStream) {
    throw new FatalError(
      "WORKER_FRAME_STREAM_NOT_FOUND",
      `Frame stream ${streamId} does not exist`,
      { stage: "engine" },
    );
  }

  let result: IteratorResult<Frame, undefined>;
  try {
    result = activeStream.iterator.next();
  } catch (error) {
    activeStream.iterator.return?.();
    activeFrameStreams.delete(streamId);
    throw error;
  }
  if (result.done) {
    activeFrameStreams.delete(streamId);
    respond({ id, type: "next-frame-stream-ok", streamId, done: true });
    return;
  }

  const scheduleEntry = activeStream.schedule[result.value.index];
  if (!scheduleEntry || scheduleEntry.timeMs !== result.value.timeMs) {
    activeStream.iterator.return?.();
    activeFrameStreams.delete(streamId);
    throw new FatalError(
      "WORKER_FRAME_STREAM_CORRUPT",
      `Frame stream ${streamId} returned an unexpected local index or time`,
      { stage: "engine" },
    );
  }
  const frame: Frame = { ...result.value, index: scheduleEntry.index };
  if (result.value.index + 1 >= activeStream.schedule.length) {
    activeFrameStreams.delete(streamId);
  }
  const response: WorkerResponse = {
    id,
    type: "next-frame-stream-ok",
    streamId,
    done: false,
    frame,
  };
  self.postMessage(response, collectResponseTransferables(response));
}

function handleCloseFrameStream(id: number, streamId: number): void {
  const activeStream = activeFrameStreams.get(streamId);
  activeStream?.iterator.return?.();
  activeFrameStreams.delete(streamId);
  respond({ id, type: "close-frame-stream-ok", streamId });
}

function handleLayoutTextFlow(id: number, input: TextFlowInput): void {
  const eng = requireEngine(id);
  if (eng) {
    respond({ id, type: "layout-text-flow-ok", result: eng.layoutTextFlow(input) });
  }
}

function handleLayoutTextFlowWithExclusions(id: number, input: TextFlowWithExclusionsInput): void {
  const eng = requireEngine(id);
  if (eng) {
    respond({
      id,
      type: "layout-text-flow-with-exclusions-ok",
      result: eng.layoutTextFlowWithExclusions(input),
    });
  }
}

function handleMeasureTextBlock(id: number, input: MeasureTextBlockInput): void {
  const eng = requireEngine(id);
  if (eng) {
    respond({ id, type: "measure-text-block-ok", result: eng.measureTextBlock(input) });
  }
}

function handleShrinkwrapText(id: number, input: ShrinkwrapTextInput): void {
  const eng = requireEngine(id);
  if (eng) {
    respond({ id, type: "shrinkwrap-text-ok", result: eng.shrinkwrapText(input) });
  }
}

function handleShrinkwrapFlow(id: number, input: ShrinkwrapFlowInput): void {
  const eng = requireEngine(id);
  if (eng) {
    respond({ id, type: "shrinkwrap-flow-ok", result: eng.shrinkwrapFlow(input) });
  }
}

function handleMeasureIntrinsicInlineSize(id: number, input: IntrinsicInlineSizeInput): void {
  const eng = requireEngine(id);
  if (eng) {
    respond({
      id,
      type: "measure-intrinsic-inline-size-ok",
      result: eng.measureIntrinsicInlineSize(input),
    });
  }
}

function handleDispose(id: number): void {
  closeAllStreams();
  if (engine) {
    engine.dispose();
    engine = null;
  }
  respond({ id, type: "dispose-ok" });
}

function closeAllStreams(): void {
  for (const job of activeRasterStreams.values()) {
    job.dispose();
  }
  activeRasterStreams.clear();
  for (const activeStream of activeFrameStreams.values()) {
    activeStream.iterator.return?.();
  }
  activeFrameStreams.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEngine(requestId: number): Engine | null {
  if (!engine) {
    respond({
      id: requestId,
      type: "error",
      error: {
        severity: "fatal",
        code: "WORKER_NOT_INITIALIZED",
        message: "Worker engine not initialized. Send an 'init' message first.",
        stage: "engine",
      },
    });
    return null;
  }
  return engine;
}

function respond(response: WorkerResponse): void {
  if (
    response.type === "render-png-ok" ||
    response.type === "render-webp-ok" ||
    response.type === "render-layered-png-ok"
  ) {
    // Raster bytes are transferred separately by their own handlers
    return;
  }
  self.postMessage(response);
}

function toSerializedFatalError(err: unknown): SerializedFatalError {
  try {
    if (err instanceof FatalError) {
      return err.toJSON();
    }
  } catch {
    // Fall through to the total boundary formatter.
  }
  return {
    severity: "fatal",
    code: "WORKER_UNHANDLED_ERROR",
    message: formatUnknownWorkerFailure(err, "Unknown worker failure"),
    stage: "engine",
  };
}
