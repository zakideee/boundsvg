/**
 * Message protocol for boundsvg Worker communication.
 *
 * Main thread sends WorkerRequest messages to the Worker.
 * Worker responds with WorkerResponse messages.
 * Each request/response pair is correlated by a monotonically increasing `id`.
 */

import {
  type AnimatedRasterWriteResult,
  FatalError,
  type Frame,
  fromSceneDocument,
  type GeometryDoc,
  type IntrinsicInlineSizeInput,
  type IntrinsicInlineSizeResult,
  type IR,
  type LayeredPngOptions,
  type LayeredPngResult,
  type LayeredSvgOptions,
  type LayeredSvgResult,
  type MeasureTextBlockInput,
  type MeasureTextBlockResult,
  RecoverableError,
  type RenderAnimatedGifOptions,
  type RenderAnimatedSvgOptions,
  type RenderAnimatedWebpOptions,
  type RenderPngFramesOptions,
  type RenderPngOptions,
  type RenderSvgFramesOptions,
  type RenderSvgOptions,
  type RenderWebpOptions,
  type SceneNode,
  type SerializedFatalError,
  type SerializedRecoverableError,
  type ShrinkwrapFlowInput,
  type ShrinkwrapFlowResult,
  type ShrinkwrapTextInput,
  type ShrinkwrapTextResult,
  type SymbolDefinition,
  type TextFlowInput,
  type TextFlowResult,
  type TextFlowWithExclusionsInput,
  type TextFlowWithExclusionsResult,
  type VNode,
} from "@boundsvg/core";
import {
  isWasmIntrinsicInlineSizeResult,
  isWasmMeasureTextBlockResult,
  isWasmShrinkwrapFlowResult,
  isWasmShrinkwrapTextResult,
  isWasmTextFlowResult,
  isWasmTextFlowWithExclusionsResult,
  validateStructuralIR,
} from "@boundsvg/core/wasm";
import {
  type DecodedWorkerLayoutTransitionInput,
  decodeWorkerLayoutTransitionInput,
  type WorkerLayoutTransitionInput,
} from "./layout-transition-transport.js";

// ---------------------------------------------------------------------------
// Worker-safe render options (no callbacks — must survive structuredClone)
// ---------------------------------------------------------------------------

/**
 * Format-specific option subsets that are safe for `postMessage` /
 * `structuredClone`.
 *
 * Callbacks (`onWarning`, `onPngResolutionAdjusted`) cannot cross the Worker
 * boundary. Warnings are returned in the response payload instead.
 */
export type WorkerRenderSvgOptions = Omit<RenderSvgOptions, "onWarning">;
/** Serializable animated SVG options; warning callbacks remain in the caller realm. */
export type WorkerRenderAnimatedSvgOptions = Omit<RenderAnimatedSvgOptions, "onWarning">;
/** Serializable static PNG options with caller callbacks removed. */
export type WorkerRenderPngOptions = Omit<
  RenderPngOptions,
  "onWarning" | "onPngResolutionAdjusted"
>;
/** Serializable static WebP options with caller callbacks removed. */
export type WorkerRenderWebpOptions = Omit<
  RenderWebpOptions,
  "onWarning" | "onPngResolutionAdjusted"
>;
/** Serializable frame sampling options with warning callbacks removed. */
export type WorkerFrameRenderOptions =
  | Omit<RenderSvgFramesOptions, "timesMs" | "onWarning">
  | Omit<RenderPngFramesOptions, "timesMs" | "onWarning" | "onPngResolutionAdjusted">;
/** Serializable WebP schedule and raster options sent once when opening a stream. */
export type WorkerAnimatedWebpRenderOptions = Omit<
  RenderAnimatedWebpOptions,
  "onWarning" | "onPngResolutionAdjusted"
>;
/** Serializable GIF schedule and raster options sent once when opening a stream. */
export type WorkerAnimatedGifRenderOptions = Omit<
  RenderAnimatedGifOptions,
  "onWarning" | "onPngResolutionAdjusted"
>;
/** Serializable layered SVG options with caller callbacks removed. */
export type WorkerLayeredSvgRenderOptions = Omit<LayeredSvgOptions, "onWarning">;
/** Serializable layered PNG options with caller callbacks removed. */
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

/** Request: Initialize the Worker with explicitly transferred font and asset data. */
export type InitRequest = {
  id: number;
  type: "init";
  fonts: FontTransfer[];
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  symbols?: Array<{ id: string; def: SymbolDefinition }>;
};

/** Request: Render one static SVG scene. */
export type RenderSvgRequest = {
  id: number;
  type: "render-svg";
  scene: SceneNode;
  options?: WorkerRenderSvgOptions;
};

/** Request: Render one independently played animated SVG scene. */
export type RenderAnimatedSvgRequest = {
  id: number;
  type: "render-animated-svg";
  scene: SceneNode;
  options: WorkerRenderAnimatedSvgOptions;
};

/** Request: Render one static PNG scene. */
export type RenderPngRequest = {
  id: number;
  type: "render-png";
  scene: SceneNode;
  options?: WorkerRenderPngOptions;
};

/** Request: Render one static WebP scene. */
export type RenderWebpRequest = {
  id: number;
  type: "render-webp";
  scene: SceneNode;
  options?: WorkerRenderWebpOptions;
};

/** Begin one streaming raster job; no raster work occurs before next. */
export type OpenRasterStreamRequest = {
  id: number;
  type: "open-raster-stream";
  scene: SceneNode;
  format: "webp" | "gif";
  options: WorkerAnimatedWebpRenderOptions | WorkerAnimatedGifRenderOptions;
};

/** Begin one streaming raster job from two layout-transition states. */
export type OpenLayoutTransitionRasterStreamRequest = {
  id: number;
  type: "open-layout-transition-raster-stream";
  transition: WorkerLayoutTransitionInput;
  format: "webp" | "gif";
  options: WorkerAnimatedWebpRenderOptions | WorkerAnimatedGifRenderOptions;
};

/** Request exactly one preparation, warning or output step. */
export type NextRasterStreamRequest = { id: number; type: "next-raster-stream"; streamId: number };
/** Close the remote owner after any in-flight operation has physically completed. */
export type CloseRasterStreamRequest = {
  id: number;
  type: "close-raster-stream";
  streamId: number;
};

/** Request: Render one scene as layered SVG output. */
export type RenderLayeredSvgRequest = {
  id: number;
  type: "render-layered-svg";
  scene: SceneNode;
  options?: WorkerLayeredSvgRenderOptions;
};

/** Request: Render one scene as layered PNG output. */
export type RenderLayeredPngRequest = {
  id: number;
  type: "render-layered-png";
  scene: SceneNode;
  options?: WorkerLayeredPngRenderOptions;
};

/** Request: Render one scene as SVG with its corresponding IR. */
export type RenderSvgAndIrRequest = {
  id: number;
  type: "render-svg-and-ir";
  scene: SceneNode;
  options?: WorkerRenderSvgOptions;
};

/** Request: Render one scene as animated SVG with its corresponding IR. */
export type RenderAnimatedSvgAndIrRequest = {
  id: number;
  type: "render-animated-svg-and-ir";
  scene: SceneNode;
  options: WorkerRenderAnimatedSvgOptions;
};

/** One validated nonnegative sample time and its explicit frame-stream index. */
export type IndexedFrameTime = {
  index: number;
  timeMs: number;
};

/** Request: Open a pull-driven scene frame stream with its detached explicit schedule. */
export type OpenFrameStreamRequest = {
  id: number;
  type: "open-frame-stream";
  scene: SceneNode;
  schedule: IndexedFrameTime[];
  options: WorkerFrameRenderOptions;
};

/** Request: Compile a transition once and open its pull-driven explicit frame stream. */
export type OpenLayoutTransitionFrameStreamRequest = {
  id: number;
  type: "open-layout-transition-frame-stream";
  transition: WorkerLayoutTransitionInput;
  schedule: IndexedFrameTime[];
  options: WorkerFrameRenderOptions;
};

/** Request: Pull the next frame from an existing frame-stream capability. */
export type NextFrameStreamRequest = {
  id: number;
  type: "next-frame-stream";
  streamId: number;
};

/** Request: Release an existing frame stream and its retained producer. */
export type CloseFrameStreamRequest = {
  id: number;
  type: "close-frame-stream";
  streamId: number;
};

/** Request: Lay out a supplied text-flow DTO. */
export type LayoutTextFlowRequest = {
  id: number;
  type: "layout-text-flow";
  input: TextFlowInput;
};

/** Request: Lay out a supplied text flow around its exclusion shapes. */
export type LayoutTextFlowWithExclusionsRequest = {
  id: number;
  type: "layout-text-flow-with-exclusions";
  input: TextFlowWithExclusionsInput;
};

/** Request: Measure the supplied text block. */
export type MeasureTextBlockRequest = {
  id: number;
  type: "measure-text-block";
  input: MeasureTextBlockInput;
};

/** Request: Measure the supplied shrinkwrapped text. */
export type ShrinkwrapTextRequest = {
  id: number;
  type: "shrinkwrap-text";
  input: ShrinkwrapTextInput;
};

/** Request: Measure the supplied shrinkwrapped text flow. */
export type ShrinkwrapFlowRequest = {
  id: number;
  type: "shrinkwrap-flow";
  input: ShrinkwrapFlowInput;
};

/** Request: Measure intrinsic inline dimensions of the supplied text. */
export type MeasureIntrinsicInlineSizeRequest = {
  id: number;
  type: "measure-intrinsic-inline-size";
  input: IntrinsicInlineSizeInput;
};

/** Request: Release the Worker engine and its owned resources. */
export type DisposeRequest = {
  id: number;
  type: "dispose";
};

/** Closed request families accepted by the dedicated Worker dispatcher. */
export type WorkerRequest =
  | InitRequest
  | RenderSvgRequest
  | RenderAnimatedSvgRequest
  | RenderPngRequest
  | RenderWebpRequest
  | OpenRasterStreamRequest
  | OpenLayoutTransitionRasterStreamRequest
  | NextRasterStreamRequest
  | CloseRasterStreamRequest
  | RenderLayeredSvgRequest
  | RenderLayeredPngRequest
  | RenderSvgAndIrRequest
  | RenderAnimatedSvgAndIrRequest
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

type DecodeWorkerRequest<Request> = Request extends { readonly scene: SceneNode }
  ? Omit<Request, "scene"> & { readonly scene: VNode }
  : Request extends { readonly transition: WorkerLayoutTransitionInput }
    ? Omit<Request, "transition"> & {
        readonly transition: DecodedWorkerLayoutTransitionInput;
      }
    : Request;

/** Worker-local request after nested Scene values cross the Core boundary. */
export type DecodedWorkerRequest = DecodeWorkerRequest<WorkerRequest>;

// ---------------------------------------------------------------------------
// Worker responses (Worker → main thread)
// ---------------------------------------------------------------------------

/** Acknowledge initialization. */
export type InitOkResponse = {
  id: number;
  type: "init-ok";
};

/** Return SVG and ordered recoverable warnings. */
export type RenderSvgOkResponse = {
  id: number;
  type: "render-svg-ok";
  svg: string;
  warnings: SerializedRecoverableError[];
};

/** Return animated SVG and ordered recoverable warnings. */
export type RenderAnimatedSvgOkResponse = {
  id: number;
  type: "render-animated-svg-ok";
  svg: string;
  warnings: SerializedRecoverableError[];
};

/** Return static PNG bytes and ordered recoverable warnings. */
export type RenderPngOkResponse = {
  id: number;
  type: "render-png-ok";
  /** PNG bytes. Transferred (not copied) back to the main thread. */
  png: Uint8Array;
  warnings: SerializedRecoverableError[];
};

/** Correlate the logical job with its initial open request. */
export type OpenRasterStreamOkResponse = {
  id: number;
  type: "open-raster-stream-ok";
  streamId: number;
};
/** Transfer one step without prefetching another frame or chunk. */
export type NextRasterStreamOkResponse = {
  id: number;
  type: "next-raster-stream-ok";
  streamId: number;
} & (
  | { kind: "preparing" }
  | { kind: "ready"; warnings: SerializedRecoverableError[] }
  | { kind: "chunk"; chunk: ArrayBuffer }
  | {
      kind: "finished";
      result: AnimatedRasterWriteResult;
      patch?: { offset: 4; bytes: Uint8Array };
    }
);
/** Acknowledge synchronous remote resource and token release. */
export type CloseRasterStreamOkResponse = {
  id: number;
  type: "close-raster-stream-ok";
  streamId: number;
};

/** Return static WebP bytes and ordered recoverable warnings. */
export type RenderWebpOkResponse = {
  id: number;
  type: "render-webp-ok";
  /** Lossless WebP bytes. Transferred (not copied) back to the main thread. */
  webp: Uint8Array;
  warnings: SerializedRecoverableError[];
};

type WorkerLayerSvgEntry = LayeredSvgResult["layers"][number];

/** Layered SVG transport result with warnings serialized across the Worker boundary. */
export type WorkerLayeredSvgResult = Omit<LayeredSvgResult, "layers"> & {
  layers: WorkerLayerSvgEntry[];
};

/** Return layered SVG metadata, layers and ordered recoverable warnings. */
export type RenderLayeredSvgOkResponse = {
  id: number;
  type: "render-layered-svg-ok";
  result: WorkerLayeredSvgResult;
  warnings: SerializedRecoverableError[];
};

type WorkerLayerPngEntry = LayeredPngResult["layers"][number];

/** Layered PNG transport result with warnings serialized across the Worker boundary. */
export type WorkerLayeredPngResult = Omit<LayeredPngResult, "layers"> & {
  layers: WorkerLayerPngEntry[];
};

/** Return layered PNG metadata, bytes and ordered recoverable warnings. */
export type RenderLayeredPngOkResponse = {
  id: number;
  type: "render-layered-png-ok";
  result: WorkerLayeredPngResult;
  warnings: SerializedRecoverableError[];
};

/**
 * IR data safe for Worker `postMessage`.
 *
 * `IR.warnings` contains `RecoverableError` class instances that cannot
 * survive structured clone. Warnings are captured separately via `onWarning`
 * and returned in the response's top-level `warnings` field instead.
 */
export type WorkerIR = Omit<IR, "warnings">;

/** Return SVG, IR and ordered recoverable warnings. */
export type RenderSvgAndIrOkResponse = {
  id: number;
  type: "render-svg-and-ir-ok";
  svg: string;
  /** IR with `warnings` stripped (see `WorkerIR`). */
  ir: WorkerIR;
  warnings: SerializedRecoverableError[];
};

/** Return animated SVG, IR and ordered recoverable warnings. */
export type RenderAnimatedSvgAndIrOkResponse = {
  id: number;
  type: "render-animated-svg-and-ir-ok";
  svg: string;
  /** IR with `warnings` stripped (see `WorkerIR`). */
  ir: WorkerIR;
  warnings: SerializedRecoverableError[];
};

/** Return an opened frame-stream capability and its preparation warnings. */
export type OpenFrameStreamOkResponse = {
  id: number;
  type: "open-frame-stream-ok";
  streamId: number;
  warnings: SerializedRecoverableError[];
};

/** Return one sampled frame or explicit completion without prefetching. */
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

/** Acknowledge release of a frame-stream capability. */
export type CloseFrameStreamOkResponse = {
  id: number;
  type: "close-frame-stream-ok";
  streamId: number;
};

/** Return the decoded text-flow result. */
export type LayoutTextFlowOkResponse = {
  id: number;
  type: "layout-text-flow-ok";
  result: TextFlowResult;
};

/** Return the decoded text-flow result with exclusions. */
export type LayoutTextFlowWithExclusionsOkResponse = {
  id: number;
  type: "layout-text-flow-with-exclusions-ok";
  result: TextFlowWithExclusionsResult;
};

/** Return decoded text-block measurements. */
export type MeasureTextBlockOkResponse = {
  id: number;
  type: "measure-text-block-ok";
  result: MeasureTextBlockResult;
};

/** Return decoded shrinkwrapped text measurements. */
export type ShrinkwrapTextOkResponse = {
  id: number;
  type: "shrinkwrap-text-ok";
  result: ShrinkwrapTextResult;
};

/** Return decoded shrinkwrapped flow measurements. */
export type ShrinkwrapFlowOkResponse = {
  id: number;
  type: "shrinkwrap-flow-ok";
  result: ShrinkwrapFlowResult;
};

/** Return decoded intrinsic inline dimensions. */
export type MeasureIntrinsicInlineSizeOkResponse = {
  id: number;
  type: "measure-intrinsic-inline-size-ok";
  result: IntrinsicInlineSizeResult;
};

/** Return a serialized fatal error for the correlated request. */
export type ErrorResponse = {
  id: number;
  type: "error";
  error: SerializedFatalError;
};

/** Acknowledge release of the Worker engine. */
export type DisposeOkResponse = {
  id: number;
  type: "dispose-ok";
};

/** Closed success and structured-error families returned by the Worker dispatcher. */
export type WorkerResponse =
  | InitOkResponse
  | RenderSvgOkResponse
  | RenderAnimatedSvgOkResponse
  | RenderPngOkResponse
  | RenderWebpOkResponse
  | OpenRasterStreamOkResponse
  | NextRasterStreamOkResponse
  | CloseRasterStreamOkResponse
  | RenderLayeredSvgOkResponse
  | RenderLayeredPngOkResponse
  | RenderSvgAndIrOkResponse
  | RenderAnimatedSvgAndIrOkResponse
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

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Closed own-key sets used to authenticate each request family without reading accessors. */
const WORKER_REQUEST_KEYS = [
  "id",
  "type",
  "fonts",
  "geometries",
  "symbols",
  "scene",
  "options",
  "transition",
  "schedule",
  "format",
  "streamId",
  "input",
] as const;

/** Known request discriminants recognized before family-specific validation. */
const WORKER_REQUEST_TYPES = new Set<string>([
  "init",
  "render-svg",
  "render-animated-svg",
  "render-png",
  "render-webp",
  "render-layered-svg",
  "render-layered-png",
  "render-svg-and-ir",
  "render-animated-svg-and-ir",
  "open-frame-stream",
  "open-raster-stream",
  "open-layout-transition-raster-stream",
  "next-raster-stream",
  "close-raster-stream",
  "open-layout-transition-frame-stream",
  "next-frame-stream",
  "close-frame-stream",
  "layout-text-flow",
  "layout-text-flow-with-exclusions",
  "measure-text-block",
  "shrinkwrap-text",
  "shrinkwrap-flow",
  "measure-intrinsic-inline-size",
  "dispose",
]);

/** Closed own-key sets used to authenticate each response family. */
const WORKER_RESPONSE_KEYS = [
  "id",
  "type",
  "error",
  "svg",
  "png",
  "webp",
  "result",
  "ir",
  "warnings",
  "streamId",
  "done",
  "frame",
  "kind",
  "chunk",
  "patch",
] as const;

function getProperty(value: object, key: string): unknown {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
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

function snapshotDenseOwnDataArray(value: unknown): unknown[] | undefined {
  let arrayValue: unknown[];
  try {
    if (!Array.isArray(value)) {
      return undefined;
    }
    arrayValue = value;
  } catch {
    return undefined;
  }

  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Reflect.getOwnPropertyDescriptor(arrayValue, "length");
  } catch {
    return undefined;
  }
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return undefined;
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(arrayValue, String(index));
    } catch {
      return undefined;
    }
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return undefined;
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function isDenseArrayOf<T>(
  value: unknown,
  predicate: (entry: unknown) => entry is T,
): value is T[] {
  const snapshot = snapshotDenseOwnDataArray(value);
  if (snapshot === undefined) {
    return false;
  }
  return snapshot.every(predicate);
}

function snapshotKnownProperties(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  const snapshot: Record<string, unknown> = {};
  try {
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        continue;
      }
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: descriptor.value,
      });
    }
  } catch {
    return undefined;
  }
  return snapshot;
}

function snapshotArrayProperties(value: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const propertyValue = value[key];
    if (propertyValue === undefined) {
      continue;
    }
    const arraySnapshot = snapshotDenseOwnDataArray(propertyValue);
    if (arraySnapshot === undefined) {
      return false;
    }
    const entrySnapshots: unknown[] = [];
    for (const entry of arraySnapshot) {
      const entrySnapshot = snapshotRequestArrayEntry(key, entry);
      if (entrySnapshot === undefined) {
        return false;
      }
      entrySnapshots.push(entrySnapshot);
    }
    value[key] = entrySnapshots;
  }
  return true;
}

function snapshotRequestArrayEntry(key: string, entry: unknown): unknown {
  switch (key) {
    case "fonts":
      return snapshotFontTransfer(entry);
    case "geometries":
      return snapshotNamedObjectEntry(entry, "doc");
    case "symbols":
      return snapshotNamedObjectEntry(entry, "def");
    case "schedule":
      return snapshotIndexedFrameTime(entry);
    default:
      return undefined;
  }
}

function snapshotFontTransfer(value: unknown): FontTransfer | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  const alias = getStringProperty(value, "alias");
  const weight = getNumberProperty(value, "weight");
  const style = getProperty(value, "style");
  const data = getProperty(value, "data");
  if (
    alias === undefined ||
    weight === undefined ||
    (style !== "normal" && style !== "italic") ||
    !(data instanceof ArrayBuffer)
  ) {
    return undefined;
  }
  return { alias, weight, style, data };
}

function snapshotNamedObjectEntry(
  value: unknown,
  valueKey: "doc" | "def",
): { id: string; doc?: GeometryDoc; def?: SymbolDefinition } | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  const id = getStringProperty(value, "id");
  const nestedValue = getProperty(value, valueKey);
  if (id === undefined || !isObjectLike(nestedValue)) {
    return undefined;
  }
  return valueKey === "doc"
    ? { id, doc: nestedValue as GeometryDoc }
    : { id, def: nestedValue as SymbolDefinition };
}

function snapshotIndexedFrameTime(value: unknown): IndexedFrameTime | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  const index = getNumberProperty(value, "index");
  const timeMs = getNumberProperty(value, "timeMs");
  if (
    index === undefined ||
    !Number.isInteger(index) ||
    index < 0 ||
    timeMs === undefined ||
    !Number.isFinite(timeMs) ||
    timeMs < 0
  ) {
    return undefined;
  }
  return { index, timeMs };
}

function snapshotRecoverableWarnings(value: unknown): SerializedRecoverableError[] | undefined {
  const entries = snapshotDenseOwnDataArray(value);
  if (entries === undefined) {
    return undefined;
  }

  const warnings: SerializedRecoverableError[] = [];
  for (const entry of entries) {
    try {
      warnings.push(RecoverableError.fromSerialized(entry).toJSON());
    } catch {
      return undefined;
    }
  }
  return warnings;
}

// Keep future fields forward-compatible while ensuring known fields receive
// only complete, plain, getter-free values. Invalid unknown values become a
// sentinel and cannot make a later supported alias reuse a partial snapshot.
/** Private marker for a property whose descriptor cannot be safely snapshotted. */
const INVALID_SNAPSHOT_VALUE = Symbol("worker-protocol-invalid-snapshot");

type GetterFreeSnapshotResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false };

type GetterFreeSnapshotState = {
  status: "visiting" | "complete" | "failed";
  value: unknown;
};

type GetterFreeSnapshotContainer = {
  readonly isArrayValue: boolean;
  readonly valueSnapshot: object;
  readonly snapshotState: GetterFreeSnapshotState;
};

function snapshotOwnDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  try {
    return Reflect.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function invalidGetterFreeSnapshot(
  value: object,
  snapshots: WeakMap<object, GetterFreeSnapshotState>,
): undefined {
  snapshots.set(value, { status: "complete", value: INVALID_SNAPSHOT_VALUE });
  return undefined;
}

function prepareGetterFreeSnapshotContainer(
  value: object,
  snapshots: WeakMap<object, GetterFreeSnapshotState>,
): GetterFreeSnapshotContainer | undefined {
  let isArrayValue: boolean;
  let valuePrototype: object | null;
  try {
    isArrayValue = Array.isArray(value);
    valuePrototype = Reflect.getPrototypeOf(value);
  } catch {
    return invalidGetterFreeSnapshot(value, snapshots);
  }

  if (
    (isArrayValue && valuePrototype !== Array.prototype) ||
    (!isArrayValue && valuePrototype !== Object.prototype && valuePrototype !== null)
  ) {
    return invalidGetterFreeSnapshot(value, snapshots);
  }

  const valueSnapshot: object = isArrayValue ? [] : Object.create(valuePrototype);
  const snapshotState: GetterFreeSnapshotState = {
    status: "visiting",
    value: valueSnapshot,
  };
  snapshots.set(value, snapshotState);
  return { isArrayValue, valueSnapshot, snapshotState };
}

function defineGetterFreeSnapshotProperty({
  valueSnapshot,
  key,
  descriptor,
  snapshots,
}: {
  valueSnapshot: object;
  key: PropertyKey;
  descriptor: PropertyDescriptor | undefined;
  snapshots: WeakMap<object, GetterFreeSnapshotState>;
}): void {
  const childSnapshot =
    descriptor !== undefined && "value" in descriptor
      ? snapshotGetterFreeValue(descriptor.value, snapshots)
      : ({ ok: true, value: INVALID_SNAPSHOT_VALUE } as const);
  Object.defineProperty(valueSnapshot, key, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value: childSnapshot.ok ? childSnapshot.value : INVALID_SNAPSHOT_VALUE,
    writable: true,
  });
}

function finalizeGetterFreeArraySnapshot(
  valueSnapshot: object,
  arrayLengthDescriptor: PropertyDescriptor | undefined,
): boolean {
  if (
    arrayLengthDescriptor === undefined ||
    !("value" in arrayLengthDescriptor) ||
    typeof arrayLengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(arrayLengthDescriptor.value) ||
    arrayLengthDescriptor.value < 0
  ) {
    return false;
  }
  Object.defineProperty(valueSnapshot, "length", {
    configurable: false,
    enumerable: false,
    value: arrayLengthDescriptor.value,
    writable: true,
  });
  return true;
}

function failGetterFreeSnapshot(snapshotState: GetterFreeSnapshotState): GetterFreeSnapshotResult {
  snapshotState.status = "failed";
  snapshotState.value = INVALID_SNAPSHOT_VALUE;
  return { ok: false };
}

function materializeGetterFreeSnapshot(
  value: object,
  container: GetterFreeSnapshotContainer,
  snapshots: WeakMap<object, GetterFreeSnapshotState>,
): GetterFreeSnapshotResult {
  const { isArrayValue, valueSnapshot, snapshotState } = container;
  try {
    let arrayLengthDescriptor: PropertyDescriptor | undefined;
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = snapshotOwnDescriptor(value, key);
      if (isArrayValue && key === "length") {
        arrayLengthDescriptor = descriptor;
        continue;
      }
      defineGetterFreeSnapshotProperty({ valueSnapshot, key, descriptor, snapshots });
    }

    if (isArrayValue && !finalizeGetterFreeArraySnapshot(valueSnapshot, arrayLengthDescriptor)) {
      return failGetterFreeSnapshot(snapshotState);
    }

    snapshotState.status = "complete";
    return { ok: true, value: valueSnapshot };
  } catch {
    return failGetterFreeSnapshot(snapshotState);
  }
}

function snapshotGetterFreeValue(
  value: unknown,
  snapshots: WeakMap<object, GetterFreeSnapshotState>,
): GetterFreeSnapshotResult {
  if (typeof value === "function") {
    return { ok: true, value: INVALID_SNAPSHOT_VALUE };
  }
  if (!isObjectLike(value)) {
    return { ok: true, value };
  }

  const existingSnapshot = snapshots.get(value);
  if (existingSnapshot !== undefined) {
    if (existingSnapshot.status === "failed") {
      return { ok: false };
    }
    if (existingSnapshot.status === "visiting") {
      return { ok: true, value: INVALID_SNAPSHOT_VALUE };
    }
    return { ok: true, value: existingSnapshot.value };
  }

  const container = prepareGetterFreeSnapshotContainer(value, snapshots);
  if (container === undefined) {
    return { ok: true, value: INVALID_SNAPSHOT_VALUE };
  }
  return materializeGetterFreeSnapshot(value, container, snapshots);
}

function snapshotGetterFreeObject(value: unknown): Record<string, unknown> | undefined {
  const snapshotResult = snapshotGetterFreeValue(value, new WeakMap());
  if (
    !snapshotResult.ok ||
    !isObjectLike(snapshotResult.value) ||
    Array.isArray(snapshotResult.value)
  ) {
    return undefined;
  }
  return snapshotResult.value as Record<string, unknown>;
}

function detachOptionalWarnings(value: Record<string, unknown>): boolean {
  const warningDescriptor = Reflect.getOwnPropertyDescriptor(value, "warnings");
  if (warningDescriptor === undefined) {
    return true;
  }
  if (!warningDescriptor.enumerable || !("value" in warningDescriptor)) {
    return false;
  }
  if (warningDescriptor.value === undefined) {
    return true;
  }
  const warnings = snapshotRecoverableWarnings(warningDescriptor.value);
  if (warnings === undefined) {
    return false;
  }
  Object.defineProperty(value, "warnings", { ...warningDescriptor, value: warnings });
  return true;
}

function snapshotMeasurementResult(value: Record<string, unknown>, type: string): boolean {
  switch (type) {
    case "layout-text-flow-ok":
    case "layout-text-flow-with-exclusions-ok":
    case "measure-text-block-ok":
    case "shrinkwrap-text-ok":
    case "shrinkwrap-flow-ok":
    case "measure-intrinsic-inline-size-ok": {
      const resultSnapshot = snapshotGetterFreeObject(value.result);
      if (resultSnapshot === undefined) {
        return false;
      }

      if (
        (type === "layout-text-flow-ok" ||
          type === "layout-text-flow-with-exclusions-ok" ||
          type === "measure-intrinsic-inline-size-ok") &&
        !detachOptionalWarnings(resultSnapshot)
      ) {
        return false;
      }
      if (type === "shrinkwrap-flow-ok") {
        const layoutSnapshot = getProperty(resultSnapshot, "layout");
        if (
          !isObjectLike(layoutSnapshot) ||
          Array.isArray(layoutSnapshot) ||
          !detachOptionalWarnings(layoutSnapshot as Record<string, unknown>)
        ) {
          return false;
        }
      }

      value.result = resultSnapshot;
      return true;
    }
    default:
      return true;
  }
}

function requestArrayKeys(type: string): readonly string[] {
  switch (type) {
    case "init":
      return ["fonts", "geometries", "symbols"];
    case "open-frame-stream":
    case "open-layout-transition-frame-stream":
      return ["schedule"];
    default:
      return [];
  }
}

function responseArrayKeys(type: string): readonly string[] {
  switch (type) {
    case "render-svg-ok":
    case "render-animated-svg-ok":
    case "render-png-ok":
    case "render-webp-ok":
    case "render-layered-svg-ok":
    case "render-layered-png-ok":
    case "render-svg-and-ir-ok":
    case "render-animated-svg-and-ir-ok":
    case "open-frame-stream-ok":
      return ["warnings"];
    default:
      return [];
  }
}

function snapshotResponseDiagnostics(value: Record<string, unknown>, type: string): boolean {
  if (type === "next-raster-stream-ok" && value.kind === "ready") {
    const warnings = snapshotRecoverableWarnings(value.warnings);
    if (warnings === undefined) {
      return false;
    }
    value.warnings = warnings;
  }
  for (const key of responseArrayKeys(type)) {
    const propertyValue = value[key];
    if (propertyValue === undefined) {
      continue;
    }
    const warnings = snapshotRecoverableWarnings(propertyValue);
    if (warnings === undefined) {
      return false;
    }
    value[key] = warnings;
  }

  if (!snapshotMeasurementResult(value, type)) {
    return false;
  }

  if (type === "error" && value.error !== undefined) {
    try {
      value.error = FatalError.fromSerialized(value.error).toJSON();
    } catch {
      return false;
    }
  }
  return true;
}

type WorkerMessageDecodeResult<TMessage> = {
  readonly id: number | undefined;
  readonly message: TMessage | undefined;
  readonly error?: FatalError;
};

/** Return whether a protocol ID can be correlated without precision loss. */
export function isWorkerMessageId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Read a safe positive message ID without invoking an untrusted property accessor. */
export function getWorkerMessageId(value: unknown): number | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  const id = getProperty(value, "id");
  return isWorkerMessageId(id) ? id : undefined;
}

function isSerializedFatalError(value: unknown): value is SerializedFatalError {
  return FatalError.isSerialized(value);
}

function isSerializedRecoverableError(value: unknown): value is SerializedRecoverableError {
  return RecoverableError.isSerialized(value);
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
  return isWorkerMessageId(streamId);
}

/** Require exactly the declared own data keys at the new raster transport boundary. */
function hasRasterMessageKeys(value: unknown, type: string): boolean {
  if (!isObjectLike(value) || Array.isArray(value)) {
    return false;
  }
  const common = ["id", "type", "streamId"];
  let keys: string[];
  if (type === "open-raster-stream") {
    keys = ["id", "type", "scene", "format", "options"];
  } else if (type === "open-layout-transition-raster-stream") {
    keys = ["id", "type", "transition", "format", "options"];
  } else if (type === "next-raster-stream-ok") {
    const kind = getStringProperty(value, "kind");
    keys = [
      ...common,
      "kind",
      ...(kind === "ready"
        ? ["warnings"]
        : kind === "chunk"
          ? ["chunk"]
          : kind === "finished"
            ? ["result", "patch"]
            : []),
    ];
  } else {
    keys = common;
  }
  try {
    return Reflect.ownKeys(value).every(
      (key) =>
        typeof key === "string" &&
        keys.includes(key) &&
        Reflect.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
        "value" in (Reflect.getOwnPropertyDescriptor(value, key) ?? {}),
    );
  } catch {
    return false;
  }
}

/** Authenticate completion metadata without accepting unsafe counters or undeclared fields. */
function isRasterWriteResult(value: unknown): value is AnimatedRasterWriteResult {
  if (!isObjectLike(value) || Array.isArray(value)) {
    return false;
  }
  const format = getStringProperty(value, "format");
  const count = getNumberProperty(value, "frameCount");
  const length = getNumberProperty(value, "bytesWritten");
  return (
    Reflect.ownKeys(value).length === 3 &&
    (format === "webp" || format === "gif") &&
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count > 0 &&
    typeof length === "number" &&
    Number.isSafeInteger(length) &&
    length > 0
  );
}

/** Authenticate one closed step, retaining null/missing distinctions for required fields. */
function isRasterStreamStep(value: object): boolean {
  if (!isFrameStreamId(value)) {
    return false;
  }
  const kind = getStringProperty(value, "kind");
  if (kind === "preparing") {
    return true;
  }
  if (kind === "ready") {
    return isDenseArrayOf(getProperty(value, "warnings"), isSerializedRecoverableError);
  }
  if (kind === "chunk") {
    const chunk = getProperty(value, "chunk");
    return chunk instanceof ArrayBuffer && chunk.byteLength > 0 && chunk.byteLength <= 65536;
  }
  if (kind !== "finished") {
    return false;
  }
  const result = getProperty(value, "result");
  if (!isRasterWriteResult(result)) {
    return false;
  }
  if (result.format === "gif") {
    return !Object.hasOwn(value, "patch");
  }
  const patch = getProperty(value, "patch");
  if (
    !isObjectLike(patch) ||
    Array.isArray(patch) ||
    Reflect.ownKeys(patch).length !== 2 ||
    getNumberProperty(patch, "offset") !== 4
  ) {
    return false;
  }
  const bytes = getProperty(patch, "bytes");
  return bytes instanceof Uint8Array && bytes.length === 4;
}

function isWorkerRequestOuterSnapshot(value: object, type: string): boolean {
  switch (type) {
    case "init": {
      const fonts = getProperty(value, "fonts");
      const geometries = getProperty(value, "geometries");
      const symbols = getProperty(value, "symbols");
      return (
        isDenseArrayOf(fonts, isFontTransfer) &&
        (geometries === undefined ||
          isDenseArrayOf(geometries, (entry): entry is { id: string; doc: GeometryDoc } =>
            isNamedObjectEntry(entry, "doc"),
          )) &&
        (symbols === undefined ||
          isDenseArrayOf(symbols, (entry): entry is { id: string; def: SymbolDefinition } =>
            isNamedObjectEntry(entry, "def"),
          ))
      );
    }
    case "render-svg":
    case "render-png":
    case "render-webp":
    case "render-layered-svg":
    case "render-layered-png":
    case "render-svg-and-ir":
      return true;
    case "render-animated-svg":
    case "render-animated-svg-and-ir":
      return isObjectLike(getProperty(value, "options"));
    case "open-raster-stream":
    case "open-layout-transition-raster-stream":
      return (
        (getStringProperty(value, "format") === "webp" ||
          getStringProperty(value, "format") === "gif") &&
        isObjectLike(getProperty(value, "options")) &&
        !Array.isArray(getProperty(value, "options"))
      );
    case "open-frame-stream": {
      const schedule = getProperty(value, "schedule");
      return (
        isDenseArrayOf(schedule, isIndexedFrameTime) &&
        isWorkerFrameRenderOptions(getProperty(value, "options"))
      );
    }
    case "open-layout-transition-frame-stream": {
      const schedule = getProperty(value, "schedule");
      return (
        isDenseArrayOf(schedule, isIndexedFrameTime) &&
        isWorkerFrameRenderOptions(getProperty(value, "options"))
      );
    }
    case "next-raster-stream":
    case "close-raster-stream":
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

function decodeNestedWorkerRequest(
  snapshot: Record<string, unknown>,
  type: string,
  id: number,
): WorkerMessageDecodeResult<DecodedWorkerRequest> {
  switch (type) {
    case "render-svg":
    case "render-animated-svg":
    case "render-png":
    case "render-webp":
    case "render-layered-svg":
    case "render-layered-png":
    case "render-svg-and-ir":
    case "render-animated-svg-and-ir":
    case "open-raster-stream":
    case "open-frame-stream": {
      const scene = fromSceneDocument(getProperty(snapshot, "scene"));
      Object.defineProperty(snapshot, "scene", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: scene,
      });
      return { id, message: snapshot as unknown as DecodedWorkerRequest };
    }
    case "open-layout-transition-raster-stream":
    case "open-layout-transition-frame-stream": {
      const transition = decodeWorkerLayoutTransitionInput(getProperty(snapshot, "transition"));
      Object.defineProperty(snapshot, "transition", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: transition,
      });
      return { id, message: snapshot as unknown as DecodedWorkerRequest };
    }
    default:
      return { id, message: snapshot as unknown as DecodedWorkerRequest };
  }
}

/** Decode one request and its correlation ID from the same getter-free snapshot. */
export function decodeWorkerRequestMessage(
  value: unknown,
): WorkerMessageDecodeResult<DecodedWorkerRequest> {
  const snapshot = snapshotKnownProperties(value, WORKER_REQUEST_KEYS);
  if (snapshot === undefined) {
    return { id: undefined, message: undefined };
  }
  const id = getWorkerMessageId(snapshot);
  if (id === undefined) {
    return { id: undefined, message: undefined };
  }
  try {
    const type = getStringProperty(snapshot, "type");
    if (type === undefined || !WORKER_REQUEST_TYPES.has(type)) {
      return { id, message: undefined };
    }
    if (type.includes("raster-stream") && !hasRasterMessageKeys(value, type)) {
      return { id, message: undefined };
    }
    if (!snapshotArrayProperties(snapshot, requestArrayKeys(type))) {
      return { id, message: undefined };
    }
    if (!isWorkerRequestOuterSnapshot(snapshot, type)) {
      return { id, message: undefined };
    }
    return decodeNestedWorkerRequest(snapshot, type, id);
  } catch (error) {
    if (error instanceof FatalError) {
      return { id, message: undefined, error };
    }
    return { id, message: undefined };
  }
}

/** Decode one request into a getter-free top-level snapshot. */
function decodeWorkerRequest(value: unknown): DecodedWorkerRequest | undefined {
  return decodeWorkerRequestMessage(value).message;
}

/** Authenticate and decode an unknown message as one closed Worker request family. */
export function isWorkerRequest(value: unknown): value is WorkerRequest {
  return decodeWorkerRequest(value) !== undefined;
}

function isWorkerResponseSnapshot(value: object): value is WorkerResponse {
  const id = getNumberProperty(value, "id");
  const type = getStringProperty(value, "type");
  if (!isWorkerMessageId(id) || type === undefined) {
    return false;
  }

  switch (type) {
    case "init-ok":
    case "dispose-ok":
      return true;
    case "render-svg-ok":
    case "render-animated-svg-ok": {
      const svg = getStringProperty(value, "svg");
      const warnings = getProperty(value, "warnings");
      return svg !== undefined && isDenseArrayOf(warnings, isSerializedRecoverableError);
    }
    case "render-png-ok": {
      const png = getProperty(value, "png");
      const warnings = getProperty(value, "warnings");
      return png instanceof Uint8Array && isDenseArrayOf(warnings, isSerializedRecoverableError);
    }
    case "render-webp-ok": {
      const webp = getProperty(value, "webp");
      const warnings = getProperty(value, "warnings");
      return webp instanceof Uint8Array && isDenseArrayOf(warnings, isSerializedRecoverableError);
    }
    case "render-layered-svg-ok": {
      const warnings = getProperty(value, "warnings");
      return (
        isWorkerLayeredSvgResult(getProperty(value, "result")) &&
        isDenseArrayOf(warnings, isSerializedRecoverableError)
      );
    }
    case "render-layered-png-ok": {
      const warnings = getProperty(value, "warnings");
      return (
        isWorkerLayeredPngResult(getProperty(value, "result")) &&
        isDenseArrayOf(warnings, isSerializedRecoverableError)
      );
    }
    case "render-svg-and-ir-ok":
    case "render-animated-svg-and-ir-ok": {
      const svg = getStringProperty(value, "svg");
      const ir = getProperty(value, "ir");
      const warnings = getProperty(value, "warnings");
      return (
        svg !== undefined &&
        validateStructuralIR(ir) &&
        isDenseArrayOf(warnings, isSerializedRecoverableError)
      );
    }
    case "open-frame-stream-ok": {
      const warnings = getProperty(value, "warnings");
      return isFrameStreamId(value) && isDenseArrayOf(warnings, isSerializedRecoverableError);
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
    case "open-raster-stream-ok":
    case "close-raster-stream-ok":
      return isFrameStreamId(value);
    case "next-raster-stream-ok":
      return isRasterStreamStep(value);
    case "close-frame-stream-ok":
      return isFrameStreamId(value);
    case "layout-text-flow-ok":
      return isWasmTextFlowResult(getProperty(value, "result"));
    case "layout-text-flow-with-exclusions-ok":
      return isWasmTextFlowWithExclusionsResult(getProperty(value, "result"));
    case "measure-text-block-ok":
      return isWasmMeasureTextBlockResult(getProperty(value, "result"));
    case "shrinkwrap-text-ok":
      return isWasmShrinkwrapTextResult(getProperty(value, "result"));
    case "shrinkwrap-flow-ok":
      return isWasmShrinkwrapFlowResult(getProperty(value, "result"));
    case "measure-intrinsic-inline-size-ok":
      return isWasmIntrinsicInlineSizeResult(getProperty(value, "result"));
    case "error":
      return isSerializedFatalError(getProperty(value, "error"));
    default:
      return false;
  }
}

/** Decode one response and its correlation ID from the same getter-free snapshot. */
export function decodeWorkerResponseMessage(
  value: unknown,
): WorkerMessageDecodeResult<WorkerResponse> {
  const snapshot = snapshotKnownProperties(value, WORKER_RESPONSE_KEYS);
  if (snapshot === undefined) {
    return { id: undefined, message: undefined };
  }
  const id = getWorkerMessageId(snapshot);
  try {
    const type = getStringProperty(snapshot, "type");
    if (type?.includes("raster-stream") && !hasRasterMessageKeys(value, type)) {
      return { id, message: undefined };
    }
    if (type !== undefined && !snapshotResponseDiagnostics(snapshot, type)) {
      return { id, message: undefined };
    }
    if (!isWorkerResponseSnapshot(snapshot)) {
      return { id, message: undefined };
    }
    return { id, message: snapshot };
  } catch {
    return { id, message: undefined };
  }
}

/** Decode one response into a getter-free top-level snapshot. */
export function decodeWorkerResponse(value: unknown): WorkerResponse | undefined {
  return decodeWorkerResponseMessage(value).message;
}

/** Authenticate an unknown message as one closed Worker response family. */
export function isWorkerResponse(value: unknown): value is WorkerResponse {
  return decodeWorkerResponse(value) !== undefined;
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
  if (response.type === "render-webp-ok") {
    return response.webp.buffer instanceof ArrayBuffer ? [response.webp.buffer] : [];
  }
  if (response.type === "next-raster-stream-ok") {
    if (response.kind === "chunk") {
      return [response.chunk];
    }
    if (response.kind === "finished" && response.patch?.bytes.buffer instanceof ArrayBuffer) {
      return [response.patch.bytes.buffer];
    }
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
    isDenseArrayOf(nodeIds, (nodeId): nodeId is string => typeof nodeId === "string") &&
    isDenseArrayOf(warnings, (warning): warning is object => isLayerWarning(warning))
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
  return width !== undefined && height !== undefined && isDenseArrayOf(layers, isLayerSvgEntry);
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
  return (
    width !== undefined &&
    height !== undefined &&
    pixelWidth !== undefined &&
    pixelHeight !== undefined &&
    isDenseArrayOf(layers, isLayerPngEntry)
  );
}
