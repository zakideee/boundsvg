/**
 * Message protocol for boundsvg Worker communication.
 *
 * Main thread sends WorkerRequest messages to the Worker.
 * Worker responds with WorkerResponse messages.
 * Each request/response pair is correlated by a monotonically increasing `id`.
 */

import {
  type Frame,
  type GeometryDoc,
  type IntrinsicInlineSizeInput,
  type IntrinsicInlineSizeResult,
  type IR,
  isSceneNode,
  type LayeredPngOptions,
  type LayeredPngResult,
  type LayeredSvgOptions,
  type LayeredSvgResult,
  type MeasureTextBlockInput,
  type MeasureTextBlockResult,
  type RenderAnimatedGifOptions,
  type RenderAnimatedWebpOptions,
  type RenderFramesOptions,
  type RenderOptions,
  type SceneNode,
  type ShrinkwrapFlowInput,
  type ShrinkwrapFlowResult,
  type ShrinkwrapTextInput,
  type ShrinkwrapTextResult,
  type StructuredError,
  type SymbolDefinition,
  type TextFlowInput,
  type TextFlowResult,
  type TextFlowWithExclusionsInput,
  type TextFlowWithExclusionsResult,
  validateSerializedIR,
} from "@boundsvg/core";
import {
  isWorkerLayoutTransitionInput,
  type WorkerLayoutTransitionInput,
} from "./layout-transition-transport.js";

// ---------------------------------------------------------------------------
// Worker-safe render options (no callbacks — must survive structuredClone)
// ---------------------------------------------------------------------------

/**
 * Subset of `RenderOptions` that is safe for `postMessage` / `structuredClone`.
 *
 * Callbacks (`onWarning`, `onPngResolutionAdjusted`) cannot cross the Worker
 * boundary. Warnings are returned in the response payload instead.
 */
export type WorkerRenderOptions = Omit<RenderOptions, "onWarning" | "onPngResolutionAdjusted">;
export type WorkerFrameRenderOptions = Omit<
  RenderFramesOptions,
  "timesMs" | "onWarning" | "onPngResolutionAdjusted"
>;
export type WorkerAnimatedWebpRenderOptions = Omit<
  RenderAnimatedWebpOptions,
  "onWarning" | "onPngResolutionAdjusted"
>;
export type WorkerAnimatedGifRenderOptions = Omit<
  RenderAnimatedGifOptions,
  "onWarning" | "onPngResolutionAdjusted"
>;
export type WorkerLayeredSvgRenderOptions = Omit<LayeredSvgOptions, "onWarning">;
export type WorkerLayeredPngRenderOptions = Omit<
  LayeredPngOptions,
  "onWarning" | "onPngResolutionAdjusted"
>;

// ---------------------------------------------------------------------------
// Font transfer
// ---------------------------------------------------------------------------

/** Font data for transferring to the Worker. Uses ArrayBuffer for zero-copy Transferable. */
export type FontTransfer = {
  alias: string;
  weight: number;
  style: "normal" | "italic";
  /** Raw font binary. Transferred (not copied) to the Worker. */
  data: ArrayBuffer;
};

// ---------------------------------------------------------------------------
// Worker requests (main thread → Worker)
// ---------------------------------------------------------------------------

export type InitRequest = {
  id: number;
  type: "init";
  fonts: FontTransfer[];
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  symbols?: Array<{ id: string; def: SymbolDefinition }>;
};

export type RenderSvgRequest = {
  id: number;
  type: "render-svg";
  scene: SceneNode;
  options?: WorkerRenderOptions;
};

export type RenderPngRequest = {
  id: number;
  type: "render-png";
  scene: SceneNode;
  options?: WorkerRenderOptions;
};

export type RenderWebpRequest = {
  id: number;
  type: "render-webp";
  scene: SceneNode;
  options?: WorkerRenderOptions;
};

export type RenderAnimatedWebpRequest = {
  id: number;
  type: "render-animated-webp";
  scene: SceneNode;
  options: WorkerAnimatedWebpRenderOptions;
};

export type RenderAnimatedGifRequest = {
  id: number;
  type: "render-animated-gif";
  scene: SceneNode;
  options: WorkerAnimatedGifRenderOptions;
};

export type RenderLayoutTransitionAnimatedWebpRequest = {
  id: number;
  type: "render-layout-transition-animated-webp";
  transition: WorkerLayoutTransitionInput;
  options: WorkerAnimatedWebpRenderOptions;
};

export type RenderLayoutTransitionAnimatedGifRequest = {
  id: number;
  type: "render-layout-transition-animated-gif";
  transition: WorkerLayoutTransitionInput;
  options: WorkerAnimatedGifRenderOptions;
};

export type RenderLayeredSvgRequest = {
  id: number;
  type: "render-layered-svg";
  scene: SceneNode;
  options?: WorkerLayeredSvgRenderOptions;
};

export type RenderLayeredPngRequest = {
  id: number;
  type: "render-layered-png";
  scene: SceneNode;
  options?: WorkerLayeredPngRenderOptions;
};

export type RenderSvgAndIrRequest = {
  id: number;
  type: "render-svg-and-ir";
  scene: SceneNode;
  options?: WorkerRenderOptions;
};

export type IndexedFrameTime = {
  index: number;
  timeMs: number;
};

export type OpenFrameStreamRequest = {
  id: number;
  type: "open-frame-stream";
  scene: SceneNode;
  schedule: IndexedFrameTime[];
  options: WorkerFrameRenderOptions;
};

export type OpenLayoutTransitionFrameStreamRequest = {
  id: number;
  type: "open-layout-transition-frame-stream";
  transition: WorkerLayoutTransitionInput;
  schedule: IndexedFrameTime[];
  options: WorkerFrameRenderOptions;
};

export type NextFrameStreamRequest = {
  id: number;
  type: "next-frame-stream";
  streamId: number;
};

export type CloseFrameStreamRequest = {
  id: number;
  type: "close-frame-stream";
  streamId: number;
};

export type LayoutTextFlowRequest = {
  id: number;
  type: "layout-text-flow";
  input: TextFlowInput;
};

export type LayoutTextFlowWithExclusionsRequest = {
  id: number;
  type: "layout-text-flow-with-exclusions";
  input: TextFlowWithExclusionsInput;
};

export type MeasureTextBlockRequest = {
  id: number;
  type: "measure-text-block";
  input: MeasureTextBlockInput;
};

export type ShrinkwrapTextRequest = {
  id: number;
  type: "shrinkwrap-text";
  input: ShrinkwrapTextInput;
};

export type ShrinkwrapFlowRequest = {
  id: number;
  type: "shrinkwrap-flow";
  input: ShrinkwrapFlowInput;
};

export type MeasureIntrinsicInlineSizeRequest = {
  id: number;
  type: "measure-intrinsic-inline-size";
  input: IntrinsicInlineSizeInput;
};

export type DisposeRequest = {
  id: number;
  type: "dispose";
};

export type WorkerRequest =
  | InitRequest
  | RenderSvgRequest
  | RenderPngRequest
  | RenderWebpRequest
  | RenderAnimatedWebpRequest
  | RenderAnimatedGifRequest
  | RenderLayoutTransitionAnimatedWebpRequest
  | RenderLayoutTransitionAnimatedGifRequest
  | RenderLayeredSvgRequest
  | RenderLayeredPngRequest
  | RenderSvgAndIrRequest
  | OpenFrameStreamRequest
  | OpenLayoutTransitionFrameStreamRequest
  | NextFrameStreamRequest
  | CloseFrameStreamRequest
  | LayoutTextFlowRequest
  | LayoutTextFlowWithExclusionsRequest
  | MeasureTextBlockRequest
  | ShrinkwrapTextRequest
  | ShrinkwrapFlowRequest
  | MeasureIntrinsicInlineSizeRequest
  | DisposeRequest;

// ---------------------------------------------------------------------------
// Worker responses (Worker → main thread)
// ---------------------------------------------------------------------------

export type InitOkResponse = {
  id: number;
  type: "init-ok";
};

export type RenderSvgOkResponse = {
  id: number;
  type: "render-svg-ok";
  svg: string;
  warnings: StructuredError[];
};

export type RenderPngOkResponse = {
  id: number;
  type: "render-png-ok";
  /** PNG bytes. Transferred (not copied) back to the main thread. */
  png: Uint8Array;
  warnings: StructuredError[];
};

export type RenderAnimatedWebpOkResponse = {
  id: number;
  type: "render-animated-webp-ok";
  /** Animated WebP bytes. Transferred (not copied) back to the main thread. */
  webp: Uint8Array;
  warnings: StructuredError[];
};

export type RenderAnimatedGifOkResponse = {
  id: number;
  type: "render-animated-gif-ok";
  /** Animated GIF bytes. Transferred (not copied) back to the main thread. */
  gif: Uint8Array;
  warnings: StructuredError[];
};

export type RenderWebpOkResponse = {
  id: number;
  type: "render-webp-ok";
  /** Lossless WebP bytes. Transferred (not copied) back to the main thread. */
  webp: Uint8Array;
  warnings: StructuredError[];
};

type WorkerLayerSvgEntry = LayeredSvgResult["layers"][number];

export type WorkerLayeredSvgResult = Omit<LayeredSvgResult, "layers"> & {
  layers: WorkerLayerSvgEntry[];
  warnings: StructuredError[];
};

export type RenderLayeredSvgOkResponse = {
  id: number;
  type: "render-layered-svg-ok";
  result: WorkerLayeredSvgResult;
};

type WorkerLayerPngEntry = LayeredPngResult["layers"][number];

export type WorkerLayeredPngResult = Omit<LayeredPngResult, "layers"> & {
  layers: WorkerLayerPngEntry[];
  warnings: StructuredError[];
};

export type RenderLayeredPngOkResponse = {
  id: number;
  type: "render-layered-png-ok";
  result: WorkerLayeredPngResult;
};

/**
 * IR data safe for Worker `postMessage`.
 *
 * `IR.warnings` contains `RecoverableError` class instances that cannot
 * survive structured clone. Warnings are captured separately via `onWarning`
 * and returned in the response's top-level `warnings` field instead.
 */
export type WorkerIR = Omit<IR, "warnings">;

export type RenderSvgAndIrOkResponse = {
  id: number;
  type: "render-svg-and-ir-ok";
  svg: string;
  /** IR with `warnings` stripped (see `WorkerIR`). */
  ir: WorkerIR;
  warnings: StructuredError[];
};

export type OpenFrameStreamOkResponse = {
  id: number;
  type: "open-frame-stream-ok";
  streamId: number;
  warnings: StructuredError[];
};

export type NextFrameStreamOkResponse =
  | {
      id: number;
      type: "next-frame-stream-ok";
      streamId: number;
      done: true;
    }
  | {
      id: number;
      type: "next-frame-stream-ok";
      streamId: number;
      done: false;
      frame: Frame;
    };

export type CloseFrameStreamOkResponse = {
  id: number;
  type: "close-frame-stream-ok";
  streamId: number;
};

export type LayoutTextFlowOkResponse = {
  id: number;
  type: "layout-text-flow-ok";
  result: TextFlowResult;
};

export type LayoutTextFlowWithExclusionsOkResponse = {
  id: number;
  type: "layout-text-flow-with-exclusions-ok";
  result: TextFlowWithExclusionsResult;
};

export type MeasureTextBlockOkResponse = {
  id: number;
  type: "measure-text-block-ok";
  result: MeasureTextBlockResult;
};

export type ShrinkwrapTextOkResponse = {
  id: number;
  type: "shrinkwrap-text-ok";
  result: ShrinkwrapTextResult;
};

export type ShrinkwrapFlowOkResponse = {
  id: number;
  type: "shrinkwrap-flow-ok";
  result: ShrinkwrapFlowResult;
};

export type MeasureIntrinsicInlineSizeOkResponse = {
  id: number;
  type: "measure-intrinsic-inline-size-ok";
  result: IntrinsicInlineSizeResult;
};

export type ErrorResponse = {
  id: number;
  type: "error";
  error: StructuredError;
};

export type DisposeOkResponse = {
  id: number;
  type: "dispose-ok";
};

export type WorkerResponse =
  | InitOkResponse
  | RenderSvgOkResponse
  | RenderPngOkResponse
  | RenderWebpOkResponse
  | RenderAnimatedWebpOkResponse
  | RenderAnimatedGifOkResponse
  | RenderLayeredSvgOkResponse
  | RenderLayeredPngOkResponse
  | RenderSvgAndIrOkResponse
  | OpenFrameStreamOkResponse
  | NextFrameStreamOkResponse
  | CloseFrameStreamOkResponse
  | LayoutTextFlowOkResponse
  | LayoutTextFlowWithExclusionsOkResponse
  | MeasureTextBlockOkResponse
  | ShrinkwrapTextOkResponse
  | ShrinkwrapFlowOkResponse
  | MeasureIntrinsicInlineSizeOkResponse
  | ErrorResponse
  | DisposeOkResponse;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: ReadonlySet<string> = new Set(["fatal", "recoverable"]);

const VALID_STAGES: ReadonlySet<string> = new Set([
  "validate",
  "layout",
  "text",
  "ir",
  "emit",
  "wasm",
  "font",
  "engine",
  "analyzer",
]);

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function getProperty(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function getNumberProperty(value: object, key: string): number | undefined {
  const prop = getProperty(value, key);
  return typeof prop === "number" ? prop : undefined;
}

function getStringProperty(value: object, key: string): string | undefined {
  const prop = getProperty(value, key);
  return typeof prop === "string" ? prop : undefined;
}

function getBooleanProperty(value: object, key: string): boolean | undefined {
  const prop = getProperty(value, key);
  return typeof prop === "boolean" ? prop : undefined;
}

export function getWorkerMessageId(value: unknown): number | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  return getNumberProperty(value, "id");
}

function isStructuredError(value: unknown): value is StructuredError {
  if (!isObjectLike(value)) {
    return false;
  }
  const severity = getStringProperty(value, "severity");
  if (severity === undefined || !VALID_SEVERITIES.has(severity)) {
    return false;
  }
  const code = getStringProperty(value, "code");
  const message = getStringProperty(value, "message");
  if (code === undefined || message === undefined) {
    return false;
  }
  const stage = getProperty(value, "stage");
  if (stage !== undefined && (typeof stage !== "string" || !VALID_STAGES.has(stage))) {
    return false;
  }
  const nodeId = getProperty(value, "nodeId");
  if (nodeId !== undefined && typeof nodeId !== "string") {
    return false;
  }
  const fallback = getProperty(value, "fallback");
  if (fallback !== undefined && typeof fallback !== "string") {
    return false;
  }
  const context = getProperty(value, "context");
  if (context !== undefined && !isObjectLike(context)) {
    return false;
  }
  return true;
}

function isRecoverableStructuredError(value: unknown): value is StructuredError {
  return isStructuredError(value) && value.severity === "recoverable";
}

function isFontTransfer(value: unknown): value is FontTransfer {
  if (!isObjectLike(value)) {
    return false;
  }
  const alias = getStringProperty(value, "alias");
  const weight = getNumberProperty(value, "weight");
  const style = getProperty(value, "style");
  const data = getProperty(value, "data");
  return (
    alias !== undefined &&
    weight !== undefined &&
    (style === "normal" || style === "italic") &&
    data instanceof ArrayBuffer
  );
}

function isNamedObjectEntry(value: unknown, valueKey: "doc" | "def"): boolean {
  if (!isObjectLike(value) || getStringProperty(value, "id") === undefined) {
    return false;
  }
  return isObjectLike(getProperty(value, valueKey));
}

function isIndexedFrameTime(value: unknown): value is IndexedFrameTime {
  if (!isObjectLike(value)) {
    return false;
  }
  const index = getNumberProperty(value, "index");
  const timeMs = getNumberProperty(value, "timeMs");
  return (
    index !== undefined &&
    Number.isInteger(index) &&
    index >= 0 &&
    timeMs !== undefined &&
    Number.isFinite(timeMs) &&
    timeMs >= 0
  );
}

function isWorkerFrameRenderOptions(value: unknown): value is WorkerFrameRenderOptions {
  if (!isObjectLike(value)) {
    return false;
  }
  const format = getStringProperty(value, "format");
  return format === "svg" || format === "png";
}

function isFrameStreamId(value: object): boolean {
  const streamId = getNumberProperty(value, "streamId");
  return streamId !== undefined && Number.isInteger(streamId) && streamId > 0;
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isObjectLike(value)) {
    return false;
  }
  const id = getNumberProperty(value, "id");
  const type = getStringProperty(value, "type");
  if (id === undefined || type === undefined) {
    return false;
  }

  switch (type) {
    case "init": {
      const fonts = getProperty(value, "fonts");
      const geometries = getProperty(value, "geometries");
      const symbols = getProperty(value, "symbols");
      return (
        Array.isArray(fonts) &&
        fonts.every(isFontTransfer) &&
        (geometries === undefined ||
          (Array.isArray(geometries) &&
            geometries.every((entry) => isNamedObjectEntry(entry, "doc")))) &&
        (symbols === undefined ||
          (Array.isArray(symbols) && symbols.every((entry) => isNamedObjectEntry(entry, "def"))))
      );
    }
    case "render-svg":
    case "render-png":
    case "render-webp":
    case "render-layered-svg":
    case "render-layered-png":
    case "render-svg-and-ir":
      return isSceneNode(getProperty(value, "scene"));
    case "render-animated-webp":
    case "render-animated-gif":
      return (
        isSceneNode(getProperty(value, "scene")) && isObjectLike(getProperty(value, "options"))
      );
    case "render-layout-transition-animated-webp":
    case "render-layout-transition-animated-gif":
      return (
        isWorkerLayoutTransitionInput(getProperty(value, "transition")) &&
        isObjectLike(getProperty(value, "options"))
      );
    case "open-frame-stream": {
      const schedule = getProperty(value, "schedule");
      return (
        isSceneNode(getProperty(value, "scene")) &&
        Array.isArray(schedule) &&
        schedule.every(isIndexedFrameTime) &&
        isWorkerFrameRenderOptions(getProperty(value, "options"))
      );
    }
    case "open-layout-transition-frame-stream": {
      const schedule = getProperty(value, "schedule");
      return (
        isWorkerLayoutTransitionInput(getProperty(value, "transition")) &&
        Array.isArray(schedule) &&
        schedule.every(isIndexedFrameTime) &&
        isWorkerFrameRenderOptions(getProperty(value, "options"))
      );
    }
    case "next-frame-stream":
    case "close-frame-stream":
      return isFrameStreamId(value);
    case "layout-text-flow":
    case "layout-text-flow-with-exclusions":
    case "measure-text-block":
    case "shrinkwrap-text":
    case "shrinkwrap-flow":
    case "measure-intrinsic-inline-size":
      return isObjectLike(getProperty(value, "input"));
    case "dispose":
      return true;
    default:
      return false;
  }
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isObjectLike(value)) {
    return false;
  }
  const id = getNumberProperty(value, "id");
  const type = getStringProperty(value, "type");
  if (id === undefined || type === undefined) {
    return false;
  }

  switch (type) {
    case "init-ok":
    case "dispose-ok":
      return true;
    case "render-svg-ok": {
      const svg = getStringProperty(value, "svg");
      const warnings = getProperty(value, "warnings");
      return (
        svg !== undefined && Array.isArray(warnings) && warnings.every(isRecoverableStructuredError)
      );
    }
    case "render-png-ok": {
      const png = getProperty(value, "png");
      const warnings = getProperty(value, "warnings");
      return (
        png instanceof Uint8Array &&
        Array.isArray(warnings) &&
        warnings.every(isRecoverableStructuredError)
      );
    }
    case "render-animated-gif-ok": {
      const gif = getProperty(value, "gif");
      const warnings = getProperty(value, "warnings");
      return (
        gif instanceof Uint8Array &&
        Array.isArray(warnings) &&
        warnings.every(isRecoverableStructuredError)
      );
    }
    case "render-animated-webp-ok":
    case "render-webp-ok": {
      const webp = getProperty(value, "webp");
      const warnings = getProperty(value, "warnings");
      return (
        webp instanceof Uint8Array &&
        Array.isArray(warnings) &&
        warnings.every(isRecoverableStructuredError)
      );
    }
    case "render-layered-svg-ok": {
      return isWorkerLayeredSvgResult(getProperty(value, "result"));
    }
    case "render-layered-png-ok": {
      return isWorkerLayeredPngResult(getProperty(value, "result"));
    }
    case "render-svg-and-ir-ok": {
      const svg = getStringProperty(value, "svg");
      const ir = getProperty(value, "ir");
      const warnings = getProperty(value, "warnings");
      const serializedIr = isObjectLike(ir) ? { ...ir, warnings: [] } : ir;
      return (
        svg !== undefined &&
        validateSerializedIR(serializedIr) &&
        Array.isArray(warnings) &&
        warnings.every(isRecoverableStructuredError)
      );
    }
    case "open-frame-stream-ok": {
      const warnings = getProperty(value, "warnings");
      return (
        isFrameStreamId(value) &&
        Array.isArray(warnings) &&
        warnings.every(isRecoverableStructuredError)
      );
    }
    case "next-frame-stream-ok": {
      if (!isFrameStreamId(value)) {
        return false;
      }
      const done = getBooleanProperty(value, "done");
      if (done === true) {
        return true;
      }
      return done === false && isFrame(getProperty(value, "frame"));
    }
    case "close-frame-stream-ok":
      return isFrameStreamId(value);
    case "layout-text-flow-ok":
    case "layout-text-flow-with-exclusions-ok":
    case "measure-text-block-ok":
    case "shrinkwrap-text-ok":
    case "shrinkwrap-flow-ok":
    case "measure-intrinsic-inline-size-ok":
      return isObjectLike(getProperty(value, "result"));
    case "error":
      return isStructuredError(getProperty(value, "error"));
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect ArrayBuffer transferables from a WorkerRequest. */
export function collectRequestTransferables(request: WorkerRequest): ArrayBuffer[] {
  if (request.type === "init") {
    return [...new Set(request.fonts.map((font) => font.data))];
  }
  return [];
}

/** Collect ArrayBuffer transferables from a WorkerResponse. */
export function collectResponseTransferables(response: WorkerResponse): ArrayBuffer[] {
  if (response.type === "render-png-ok") {
    return response.png.buffer instanceof ArrayBuffer ? [response.png.buffer] : [];
  }
  if (response.type === "render-webp-ok" || response.type === "render-animated-webp-ok") {
    return response.webp.buffer instanceof ArrayBuffer ? [response.webp.buffer] : [];
  }
  if (response.type === "render-animated-gif-ok") {
    return response.gif.buffer instanceof ArrayBuffer ? [response.gif.buffer] : [];
  }
  if (response.type === "render-layered-png-ok") {
    const buffers: ArrayBuffer[] = [];
    for (const layer of response.result.layers) {
      if (layer.png.buffer instanceof ArrayBuffer) {
        buffers.push(layer.png.buffer);
      }
    }
    return buffers;
  }
  if (
    response.type === "next-frame-stream-ok" &&
    !response.done &&
    response.frame.format === "png" &&
    response.frame.data.buffer instanceof ArrayBuffer
  ) {
    return [response.frame.data.buffer];
  }
  return [];
}

function isFrame(value: unknown): value is Frame {
  if (!isObjectLike(value)) {
    return false;
  }
  const index = getNumberProperty(value, "index");
  const timeMs = getNumberProperty(value, "timeMs");
  const format = getStringProperty(value, "format");
  const data = getProperty(value, "data");
  return (
    index !== undefined &&
    Number.isInteger(index) &&
    index >= 0 &&
    timeMs !== undefined &&
    Number.isFinite(timeMs) &&
    timeMs >= 0 &&
    ((format === "svg" && typeof data === "string") ||
      (format === "png" && data instanceof Uint8Array))
  );
}

function isLayerWarning(value: unknown): boolean {
  return isObjectLike(value) && typeof getStringProperty(value, "code") === "string";
}

function isLayerManifestEntry(value: unknown): value is object {
  if (!isObjectLike(value)) {
    return false;
  }
  const id = getStringProperty(value, "id");
  const mode = getStringProperty(value, "mode");
  const paintOrder = getNumberProperty(value, "paintOrder");
  const nodeIds = getProperty(value, "nodeIds");
  const warnings = getProperty(value, "warnings");
  return (
    id !== undefined &&
    (mode === "independent" || mode === "atomic") &&
    paintOrder !== undefined &&
    Array.isArray(nodeIds) &&
    nodeIds.every((nodeId) => typeof nodeId === "string") &&
    Array.isArray(warnings) &&
    warnings.every(isLayerWarning)
  );
}

function isLayerSvgEntry(value: unknown): value is WorkerLayerSvgEntry {
  if (!isLayerManifestEntry(value)) {
    return false;
  }
  return typeof getProperty(value, "svg") === "string";
}

function isLayerPngEntry(value: unknown): value is WorkerLayerPngEntry {
  if (!isLayerManifestEntry(value)) {
    return false;
  }
  return getProperty(value, "png") instanceof Uint8Array;
}

function isWorkerLayeredSvgResult(value: unknown): value is WorkerLayeredSvgResult {
  if (!isObjectLike(value)) {
    return false;
  }
  const width = getNumberProperty(value, "width");
  const height = getNumberProperty(value, "height");
  const layers = getProperty(value, "layers");
  const warnings = getProperty(value, "warnings");
  return (
    width !== undefined &&
    height !== undefined &&
    Array.isArray(layers) &&
    layers.every(isLayerSvgEntry) &&
    Array.isArray(warnings) &&
    warnings.every(isRecoverableStructuredError)
  );
}

function isWorkerLayeredPngResult(value: unknown): value is WorkerLayeredPngResult {
  if (!isObjectLike(value)) {
    return false;
  }
  const width = getNumberProperty(value, "width");
  const height = getNumberProperty(value, "height");
  const pixelWidth = getNumberProperty(value, "pixelWidth");
  const pixelHeight = getNumberProperty(value, "pixelHeight");
  const layers = getProperty(value, "layers");
  const warnings = getProperty(value, "warnings");
  return (
    width !== undefined &&
    height !== undefined &&
    pixelWidth !== undefined &&
    pixelHeight !== undefined &&
    Array.isArray(layers) &&
    layers.every(isLayerPngEntry) &&
    Array.isArray(warnings) &&
    warnings.every(isRecoverableStructuredError)
  );
}
