import { animatedRasterFailure } from "./animation-errors.js";
import type {
  AnimatedRasterFrameProducer,
  AnimatedRasterJob,
  AnimatedRasterJobInput,
} from "./animation-job.js";
import {
  assertAnimationSignal,
  isAnimationSignalAborted,
  OwnedAnimatedRasterJob,
  registerAnimatedRasterJobFactory,
  snapshotAnimationInput,
  writeAnimatedRasterJob,
} from "./animation-job.js";
import type {
  AnimatedRasterSink,
  AnimatedRasterWriteOptions,
  AnimatedRasterWriteResult,
  AnimatedWebpSink,
} from "./animation-output.js";
import { assertAnimatedRasterSink } from "./animation-output.js";
import {
  type AnimationScheduleCursor,
  type AnimationScheduleOptions,
  assertAnimationIterations,
  createAnimationScheduleCursor,
  MAX_ANIMATED_GIF_ITERATIONS,
  MAX_ANIMATED_WEBP_ITERATIONS,
  resolveAnimationScheduleDescriptor,
} from "./animation-schedule.js";
import {
  authenticateCompiledScene,
  type CompiledScene,
  type CompiledSceneOwnerToken,
  type CompiledSceneRecord,
  createCompiledScene,
  createCompiledSceneOwnerToken,
  snapshotCompiledSceneRecordIR,
} from "./compiled-scene.js";
import { invokeMeasurementTransport } from "./engine/measurement-transport.js";
import {
  assertAnimatedSvgTimelineIrJsonRepresentable,
  assertAnimatedSvgTimelineVNodeJsonRepresentable,
} from "./engine/timeline-domain-transport.js";
import {
  createInternalRecoverableError,
  FatalError,
  formatUnknownDiagnosticValue,
  RecoverableError,
  type SerializedRecoverableError,
  wrapWasmRenderError,
} from "./errors.js";
import { DEFAULT_FONT_WEIGHT } from "./font/types.js";
import { cloneRecoverableError } from "./ir/clone.js";
import { hitTest } from "./ir/hit-test.js";
import type { NodePosition } from "./ir/internal.js";
import { generateNodeId } from "./ir/node-id.js";
import type { IR, IRNode } from "./ir/types.js";
import { snapshotLayerSourceMetadata } from "./layer-source-metadata.js";
import type {
  LayeredCompositionValidationOptions,
  LayeredCompositionValidationResult,
  LayeredPngResult,
  LayeredSvgResult,
} from "./layered-svg.js";
import { hasAnimatedNode, type LayerEmitOptions, renderLayeredSvg } from "./layered-svg.js";
import type { ComputeLayoutTransportFn } from "./layout/backend.js";
import { buildLayoutTransportJson, computeLayout } from "./layout/taffy-layout-adapter.js";
import type { LayoutResult } from "./layout/types.js";
import { type LayoutTransitionInput, resolveLayoutTransitionInput } from "./layout-transition.js";
import { assertLayoutTransitionSemanticIds } from "./layout-transition-semantic-ids.js";
import {
  RASTER_MAX_LONG_EDGE,
  RASTER_MAX_PIXELS,
  type ResolvedRasterScale,
  resolveRasterScale,
} from "./render-capabilities.js";
import { resolveSceneOrVNodeInput } from "./scene/from-vnode.js";
import type { SceneNode } from "./scene/types.js";
import { assertShapeReferencesResolvable, type ShapeRegistry } from "./shape/expand.js";
import type { GeometryDoc, SymbolDefinition } from "./shape/types.js";
import { toCssSafeResourceId } from "./svg/resource-id.js";
import type { DebugOverlayConfig } from "./svg/types.js";
import { formatNumber } from "./svg/utils.js";
import { collectTextFontAliases } from "./text/inline-runs.js";
import { projectResolvedTextOutlines } from "./text/outline-projection.js";
import { assertRichTextNodeDepth } from "./text/rich-text-limits.js";
import type { TextOutlineNode, TextPathMode } from "./text/types.js";
import { validate, validateAnimatedSvgTimeline } from "./validate/index.js";
import type { AnimationSpec, VNode } from "./vnode/types.js";
import type {
  AnimatedRasterSessionHandle,
  AnimationRenderOptions,
  AnimationSessionOpenInput,
} from "./wasm/animation-session.js";
import type {
  IntrinsicInlineSizeInput,
  IntrinsicInlineSizeResult,
  MeasureTextBlockInput,
  MeasureTextBlockResult,
  PngRenderOptions,
  ShrinkwrapFlowInput,
  ShrinkwrapFlowResult,
  ShrinkwrapTextInput,
  ShrinkwrapTextResult,
  TextFlowInput,
  TextFlowResult,
  TextFlowWithExclusionsInput,
  TextFlowWithExclusionsResult,
} from "./wasm/index.js";
import { WasmRasterSceneHandle } from "./wasm/index.js";
import {
  decodeAnimationStateSamples,
  decodeRenderToIrEnvelope,
  decodeRenderToSvgEnvelope,
} from "./wasm/protocol-decoders.js";
import type { WasmIrOutput } from "./wasm/types.js";

export type { CompiledScene } from "./compiled-scene.js";

/** Engine input: either a VNode tree or a typed SceneNode tree */
export type EngineInput = VNode | SceneNode;

/** Default grouping mode for resolved glyph outline paths. */
const DEFAULT_TEXT_PATH_MODE: TextPathMode = "merged";

/**
 * Guard the compiled-scene render entry points against malformed private IR
 * returned by a custom backend. Authenticity proves artifact provenance, not
 * that a third-party transport returned valid canvas dimensions. A non-finite
 * or non-positive size produces a
 * `viewBox="0 0 NaN 20"` document or an unrasterizable one, both of which
 * fail far from the cause.
 */
function assertRenderableCanvas(ir: IR): void {
  for (const [name, value] of [
    ["width", ir.width],
    ["height", ir.height],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0 || Number(formatNumber(value)) <= 0) {
      throw new FatalError(
        "INVALID_CANVAS_SIZE",
        `Compiled scene has an invalid canvas ${name}: ${formatUnknownDiagnosticValue(value, "unprintable value")}`,
        { stage: "emit" },
      );
    }
  }
}

function vnodeRasterDimensions(input: VNode): { width: unknown; height: unknown } {
  return {
    width: Reflect.get(input.props, "width"),
    height: Reflect.get(input.props, "height"),
  };
}

function assertRasterCanvasInput(input: VNode): void {
  const dimensions = vnodeRasterDimensions(input);
  for (const name of ["width", "height"] as const) {
    const value = dimensions[name];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      Number(formatNumber(value)) <= 0
    ) {
      throw new FatalError(
        "INVALID_CANVAS_SIZE",
        `Compiled scene has an invalid canvas ${name}: ${formatUnknownDiagnosticValue(value, "unprintable value")}`,
        { stage: "emit" },
      );
    }
  }
}

function assertPngScale(requestedScale: number): void {
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
    throw new FatalError(
      "PNG_INVALID_SCALE",
      `Invalid PNG scale factor: ${formatUnknownDiagnosticValue(requestedScale, "unprintable value")}`,
      { stage: "emit" },
    );
  }
}

/**
 * Deliver the IR's recoverable warnings (MISSING_GLYPH, IMAGE_LOAD_FAILED,
 * KINSOKU_UNRESOLVED, …) to the caller's onWarning. All public render entry
 * points route through the three emit methods that call this, so warnings
 * are observable without renderToSvgAndIR.
 */
function deliverIrWarnings(ir: IR, onWarning?: (warning: RecoverableError) => void): void {
  deliverWarnings(ir.warnings, onWarning);
}

/** Keep callback mutation outside a reusable compiled artifact's warning state. */
function deliverDetachedIrWarnings(ir: IR, onWarning?: (warning: RecoverableError) => void): void {
  deliverDetachedWarnings(ir.warnings, onWarning);
}

function deliverDetachedWarnings(
  warnings: readonly RecoverableError[],
  onWarning?: (warning: RecoverableError) => void,
): void {
  if (!onWarning) {
    return;
  }
  for (const warning of warnings) {
    onWarning(cloneRecoverableError(warning));
  }
}

function deliverWarnings(
  warnings: readonly RecoverableError[],
  onWarning?: (warning: RecoverableError) => void,
): void {
  if (!onWarning) {
    return;
  }
  for (const warning of warnings) {
    onWarning(warning);
  }
}

/** Append a TS-owned warning to the canonical operation list before delivery. */
function appendOperationWarning(
  ir: IR,
  warning: RecoverableError,
  onWarning?: (warning: RecoverableError) => void,
): void {
  ir.warnings.push(warning);
  onWarning?.(warning);
}

function collectIrTextNodeIds(root: IRNode): Set<string> {
  const textNodeIds = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node.type === "text") {
      textNodeIds.add(node.nodeId);
    }
    if (node.type === "group") {
      pending.push(...(node.children ?? []));
    }
  }
  return textNodeIds;
}

function toCompileOptions(options?: CompileOptions): CompileOptions | undefined {
  if (!options) {
    return undefined;
  }
  const { skipValidation, textPathMode } = options;
  if (skipValidation == null && textPathMode == null) {
    return undefined;
  }
  return { skipValidation, textPathMode };
}

/** Map internal render fields onto the camelCase options JSON a WASM transport reads. */
function toWasmRenderOptionsJson(
  renderOpts: InternalRenderOptions | undefined,
  overrides?: {
    scale?: number;
    rasterizerCompat?: boolean;
    animation?: "declarative" | "static";
    sampleAnimation?: boolean;
    returnResolvedIr?: boolean;
    preserveResolvedUnitOutlines?: boolean;
    enforcePngOutlineGlyphLimit?: boolean;
    omitGenerator?: boolean;
  },
): string {
  return JSON.stringify({
    scale: overrides?.scale ?? renderOpts?.scale,
    debug: renderOpts?.debug,
    // Sanitized here exactly as the emitter would; keeps the transport JSON
    // valid for prefixes containing lone surrogates.
    resourceIdPrefix:
      renderOpts?.resourceIdPrefix === undefined
        ? undefined
        : toCssSafeResourceId(renderOpts.resourceIdPrefix),
    nodeIdMetadata: renderOpts?.nodeIdMetadata,
    textPathMode: renderOpts?.textPathMode,
    showMissingGlyphs: renderOpts?.showMissingGlyphs,
    rasterizerCompat: overrides?.rasterizerCompat,
    animation: overrides?.animation ?? renderOpts?.animation,
    playback: renderOpts?.playback,
    timeMs: renderOpts?.timeMs,
    reducedMotion: renderOpts?.reducedMotion,
    sampleAnimation: overrides?.sampleAnimation,
    returnResolvedIr: overrides?.returnResolvedIr,
    preserveResolvedUnitOutlines: overrides?.preserveResolvedUnitOutlines,
    enforcePngOutlineGlyphLimit: overrides?.enforcePngOutlineGlyphLimit,
    generator: overrides?.omitGenerator ? undefined : renderOpts?.generator,
  });
}

function assertValidAnimationRenderOptions(
  options:
    | { animation?: "declarative" | "static"; timeMs?: number; reducedMotion?: ReducedMotionMode }
    | undefined,
): void {
  if (
    options?.reducedMotion !== undefined &&
    options.reducedMotion !== "keep" &&
    options.reducedMotion !== "pause"
  ) {
    throw new FatalError(
      "ANIMATION_INVALID_REDUCED_MOTION",
      `Invalid reducedMotion mode: ${formatUnknownDiagnosticValue(options.reducedMotion, "unprintable value")}`,
      { stage: "emit" },
    );
  }
  if (
    options?.animation !== undefined &&
    options.animation !== "declarative" &&
    options.animation !== "static"
  ) {
    throw new FatalError(
      "ANIMATION_INVALID_MODE",
      `Invalid animation render mode: ${formatUnknownDiagnosticValue(options.animation, "unprintable value")}`,
      { stage: "emit" },
    );
  }
  if (options?.timeMs !== undefined && (!Number.isFinite(options.timeMs) || options.timeMs < 0)) {
    throw new FatalError(
      "ANIMATION_INVALID_TIME",
      `Animation timeMs must be a non-negative finite number, got ${formatUnknownDiagnosticValue(options.timeMs, "unprintable value")}`,
      { stage: "emit" },
    );
  }
}

/** Own option keys accepted when creating a compiled scene. */
const COMPILE_OPTION_KEYS = ["skipValidation", "textPathMode"] as const;
/** Own output keys shared by render families. */
const OUTPUT_COMMON_OPTION_KEYS = [
  "scale",
  "debug",
  "onWarning",
  "showMissingGlyphs",
  "generator",
] as const;
/** Own keys controlling SVG identifier isolation and node metadata. */
const SVG_EMISSION_OPTION_KEYS = ["resourceIdPrefix", "nodeIdMetadata"] as const;
/** Own keys controlling raster background and dimension adjustment. */
const RASTER_EMISSION_OPTION_KEYS = [
  "rasterBackground",
  "rasterOversizeBehavior",
  "onPngResolutionAdjusted",
] as const;
/** Complete own-key domain for direct static SVG rendering. */
const STATIC_SVG_OPTION_KEYS = new Set<string>([
  ...COMPILE_OPTION_KEYS,
  ...OUTPUT_COMMON_OPTION_KEYS,
  ...SVG_EMISSION_OPTION_KEYS,
  "timeMs",
]);
/** Complete own-key domain for direct declarative animated SVG rendering. */
const ANIMATED_SVG_OPTION_KEYS = new Set<string>([
  ...STATIC_SVG_OPTION_KEYS,
  "playback",
  "reducedMotion",
]);
/** Static SVG own-key domain after compile-time choices are fixed. */
const EMIT_STATIC_SVG_OPTION_KEYS = new Set<string>(
  [...STATIC_SVG_OPTION_KEYS].filter((key) => !COMPILE_OPTION_KEYS.includes(key as never)),
);
/** Animated SVG own-key domain after compile-time choices are fixed. */
const EMIT_ANIMATED_SVG_OPTION_KEYS = new Set<string>([
  ...EMIT_STATIC_SVG_OPTION_KEYS,
  "playback",
  "reducedMotion",
]);
/** Complete own-key domain for direct still-image raster rendering. */
const RASTER_OPTION_KEYS = new Set<string>([
  ...COMPILE_OPTION_KEYS,
  ...OUTPUT_COMMON_OPTION_KEYS,
  ...RASTER_EMISSION_OPTION_KEYS,
  "timeMs",
]);
/** Still-image raster own-key domain after compile-time choices are fixed. */
const EMIT_RASTER_OPTION_KEYS = new Set<string>(
  [...RASTER_OPTION_KEYS].filter((key) => !COMPILE_OPTION_KEYS.includes(key as never)),
);
/** Own keys selecting explicit or uniformly sampled animation timing. */
const ANIMATION_SCHEDULE_OPTION_KEYS = [
  "timesMs",
  "frameDurationsMs",
  "fps",
  "durationMs",
] as const;
/** Complete own-key domain for direct animated raster rendering. */
const ANIMATED_RASTER_OPTION_KEYS = new Set<string>([
  ...[...RASTER_OPTION_KEYS].filter((key) => key !== "timeMs"),
  ...ANIMATION_SCHEDULE_OPTION_KEYS,
  "iterations",
]);
/** Animated raster own-key domain after compile-time choices are fixed. */
const COMPILED_ANIMATED_RASTER_OPTION_KEYS = new Set<string>(
  [...ANIMATED_RASTER_OPTION_KEYS].filter((key) => !COMPILE_OPTION_KEYS.includes(key as never)),
);
/** Restrict animation envelopes to records before their closed-key authentication. */
function isAnimationRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
}

/** Migration diagnostics for rejected render option spellings. */
const LEGACY_RENDER_OPTION_MIGRATIONS: Readonly<Record<string, string>> = {
  animation:
    'Use renderToAnimatedSvg with playback: { mode: "independent" }, or use static SVG with an explicit timeMs.',
  loop: "Use the required total-play iterations option for animated WebP or GIF.",
  loopCount: "Use the required total-play iterations option for animated WebP or GIF.",
  // biome-ignore lint/style/useNamingConvention: exact legacy wire spelling
  loop_count: "Use the required total-play iterations option for animated WebP or GIF.",
};

function assertOwnOptionKeys(
  options: object | undefined,
  allowedKeys: ReadonlySet<string>,
  methodName: string,
): void {
  if (options === undefined) {
    return;
  }
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new FatalError("UNSUPPORTED_RENDER_OPTION", `${methodName} options must be an object.`, {
      stage: "validate",
    });
  }
  for (const key of Object.keys(options)) {
    const migration = LEGACY_RENDER_OPTION_MIGRATIONS[key];
    if (migration !== undefined) {
      throw new FatalError(
        "UNSUPPORTED_LEGACY_RENDER_OPTION",
        `${methodName} no longer accepts ${JSON.stringify(key)}. ${migration}`,
        { stage: "validate" },
      );
    }
    if (!allowedKeys.has(key)) {
      throw new FatalError(
        "UNSUPPORTED_RENDER_OPTION",
        `${methodName} does not support option ${JSON.stringify(key)}.`,
        { stage: "validate" },
      );
    }
  }
}

function assertSvgEmissionOptionValues(options: SvgEmissionOptions | undefined): void {
  if (
    options?.nodeIdMetadata !== undefined &&
    options.nodeIdMetadata !== "include" &&
    options.nodeIdMetadata !== "omit"
  ) {
    throw new FatalError(
      "UNSUPPORTED_RENDER_OPTION",
      `nodeIdMetadata must be "include" or "omit", got ${formatUnknownDiagnosticValue(options.nodeIdMetadata, "unprintable value")}.`,
      { stage: "validate" },
    );
  }
}

/** Largest document-cycle duration accepted by animated SVG timeline validation. */
const MAX_TIMELINE_DURATION_MS = 2 ** 32;
/** Largest finite total-play count accepted by animated SVG timeline validation. */
const MAX_TIMELINE_ITERATIONS = 2 ** 20;
/** Largest elapsed sample time accepted by animated SVG timeline validation. */
const MAX_TIMELINE_TIME_MS = 2 ** 52;
/** Largest elapsed-time to cycle-duration ratio accepted by timeline validation. */
const MAX_TIMELINE_TIME_RATIO = 2 ** 31;

function timelineReceived(container: object, field: string): string {
  let value: unknown;
  try {
    if (!Object.hasOwn(container, field)) {
      return "missing";
    }
    value = Reflect.get(container, field);
  } catch {
    return "uninspectable value";
  }
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? formatUnknownDiagnosticValue(value, "unprintable value");
  } catch {
    return formatUnknownDiagnosticValue(value, "unprintable value");
  }
}

function invalidAnimatedSvgTimeline(field: string, received: string): FatalError {
  return new FatalError(
    "ANIMATED_SVG_INVALID_TIMELINE",
    `Animated SVG timeline ${field} is outside the supported range.`,
    {
      stage: "validate",
      context: {
        field,
        received,
      },
    },
  );
}

function assertAnimatedSvgPlayback(
  playback: unknown,
  timeMs: unknown,
): asserts playback is AnimatedSvgPlayback {
  if (typeof playback !== "object" || playback === null || Array.isArray(playback)) {
    throw new FatalError(
      "UNSUPPORTED_ANIMATED_SVG_PLAYBACK",
      'Animated SVG playback must use mode "independent" or "timeline".',
      { stage: "validate" },
    );
  }
  const mode = Reflect.get(playback, "mode");
  if (mode === "independent") {
    if (Object.keys(playback).length !== 1 || !Object.hasOwn(playback, "mode")) {
      throw new FatalError(
        "UNSUPPORTED_RENDER_OPTION",
        "Independent animated SVG playback only supports the mode field.",
        { stage: "validate" },
      );
    }
    return;
  }
  if (mode !== "timeline") {
    throw new FatalError(
      "UNSUPPORTED_ANIMATED_SVG_PLAYBACK",
      'Animated SVG playback must use mode "independent" or "timeline".',
      { stage: "validate" },
    );
  }

  const durationMs = Reflect.get(playback, "durationMs");
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 1 ||
    durationMs > MAX_TIMELINE_DURATION_MS
  ) {
    throw invalidAnimatedSvgTimeline("durationMs", timelineReceived(playback, "durationMs"));
  }
  const iterations = Reflect.get(playback, "iterations");
  if (
    iterations !== "infinite" &&
    (typeof iterations !== "number" ||
      !Number.isFinite(iterations) ||
      iterations <= 0 ||
      iterations > MAX_TIMELINE_ITERATIONS)
  ) {
    throw invalidAnimatedSvgTimeline("iterations", timelineReceived(playback, "iterations"));
  }
  const timelineKeys = new Set(["mode", "durationMs", "iterations"]);
  const unsupportedKey = Object.keys(playback).find((key) => !timelineKeys.has(key));
  if (unsupportedKey !== undefined) {
    throw new FatalError(
      "UNSUPPORTED_RENDER_OPTION",
      `Animated SVG timeline playback does not support field ${JSON.stringify(unsupportedKey)}.`,
      { stage: "validate" },
    );
  }

  const elapsedMs = timeMs === undefined ? 0 : timeMs;
  if (
    typeof elapsedMs !== "number" ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs > MAX_TIMELINE_TIME_MS
  ) {
    const received = timeMs === undefined ? "missing" : timelineReceived({ timeMs }, "timeMs");
    throw invalidAnimatedSvgTimeline("timeMs", received);
  }
  if (elapsedMs / durationMs > MAX_TIMELINE_TIME_RATIO) {
    throw new FatalError(
      "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
      "Animated SVG timeline timeMs/durationMs ratio exceeds the supported precision limit.",
      {
        stage: "validate",
        context: {
          kind: "time-ratio",
          timeMs: elapsedMs,
          durationMs,
          limitRatio: MAX_TIMELINE_TIME_RATIO,
        },
      },
    );
  }
}

function assertFrameOptionKeys(
  options: RenderFramesOptions | RenderCompiledFramesOptions,
  methodName: string,
  compiled: boolean,
): void {
  const commonKeys = compiled
    ? OUTPUT_COMMON_OPTION_KEYS
    : [...COMPILE_OPTION_KEYS, ...OUTPUT_COMMON_OPTION_KEYS];
  const format = Reflect.get(options, "format");
  const formatKeys = format === "svg" ? SVG_EMISSION_OPTION_KEYS : RASTER_EMISSION_OPTION_KEYS;
  assertOwnOptionKeys(
    options,
    new Set([...commonKeys, ...formatKeys, "timesMs", "format"]),
    methodName,
  );
  if (format === "svg") {
    assertSvgEmissionOptionValues(options as SvgEmissionOptions);
  }
}

/**
 * Reduce animated-raster options to the render options a frame sample takes.
 *
 * `scale` is supplied separately as the shared raster plan, so every frame is
 * emitted with the same rounded root dimensions as still/frame PNG. The
 * encoder then rasterizes those dimensions at scale 1. `generator` belongs to
 * the completed animated container, not every temporary SVG frame.
 */
function toAnimationFrameRenderOptions(
  options: RenderAnimatedWebpOptions | RenderAnimatedGifOptions,
): Omit<RenderPngOptions, "timeMs" | "scale" | "generator"> {
  const {
    timesMs: _timesMs,
    frameDurationsMs: _frameDurationsMs,
    fps: _fps,
    durationMs: _durationMs,
    iterations: _iterations,
    scale: _scale,
    generator: _generator,
    ...renderOptions
  } = options;
  return renderOptions;
}

function validateFrameSchedule(options: LegacyRenderFramesOptions | undefined): number[] {
  if (!options || (options.format !== "svg" && options.format !== "png")) {
    throw new FatalError(
      "ANIMATION_INVALID_FRAME_FORMAT",
      `Frame format must be "svg" or "png", got ${formatUnknownDiagnosticValue(options?.format, "unprintable value")}`,
      { stage: "emit" },
    );
  }
  if (!Array.isArray(options.timesMs)) {
    throw new FatalError(
      "ANIMATION_INVALID_TIMES",
      "Frame timesMs must be an array of non-negative finite numbers",
      { stage: "emit" },
    );
  }
  const timesMs = [...options.timesMs];
  for (const timeMs of timesMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new FatalError(
        "ANIMATION_INVALID_TIME",
        `Animation timeMs must be a non-negative finite number, got ${formatUnknownDiagnosticValue(timeMs, "unprintable value")}`,
        { stage: "emit" },
      );
    }
  }
  return timesMs;
}

/** Rebuild RecoverableError instances from the structured wire warnings. */
function rehydrateWasmWarnings(
  warnings: readonly SerializedRecoverableError[],
): RecoverableError[] {
  return warnings.map((warning) => RecoverableError.fromSerialized(warning));
}

/** Promote a validated wire IR to the public IR warning contract. */
function rehydrateWasmIr(ir: WasmIrOutput, warnings: readonly SerializedRecoverableError[]): IR {
  return {
    ...ir,
    warnings: rehydrateWasmWarnings(warnings),
  };
}

/** Serialize exactly the fields accepted by Rust's `EmitIrInput`. */
export function serializeIrForWasm(ir: Pick<IR, "root" | "width" | "height" | "debug">): string {
  return JSON.stringify({
    root: ir.root,
    width: ir.width,
    height: ir.height,
    ...(ir.debug !== undefined && { debug: ir.debug }),
  });
}

/** Choose automatic scale reduction or an error when raster dimensions exceed the supported limits. */
export type RasterOversizeBehavior = "auto-adjust" | "error";

/** Requested and effective raster dimensions reported when automatic scale reduction occurs. */
export type PngResolutionAdjustedWarning = {
  requestedScale: number;
  appliedScale: number;
  baseWidth: number;
  baseHeight: number;
  requestedWidth: number;
  requestedHeight: number;
  outputWidth: number;
  outputHeight: number;
  maxLongEdge: number;
  maxPixels: number;
};

/** Injected WASM transports and initial resources used by an Engine instance. */
export type EngineOptions = {
  /** WASM compute_layout function */
  computeLayoutFn: ComputeLayoutTransportFn;
  /** WASM svg_to_png function (optional, may accept PngRenderOptions) */
  svgToPngFn?: (svg: string, options?: PngRenderOptions) => Uint8Array;
  /** WASM svg_to_webp function (optional; absent on runtimes without the export) */
  svgToWebpFn?: (svg: string, options?: PngRenderOptions) => Uint8Array;
  /** Open the common single-frame animation encoder on this engine's font registry. */
  openAnimatedRasterSessionFn?: (input: AnimationSessionOpenInput) => AnimatedRasterSessionHandle;
  /** Optional layered-SVG composition validator backed by the rasterizer */
  validateLayeredSvgCompositionFn?: (
    input: ValidateLayeredSvgCompositionInput,
  ) => ValidateLayeredSvgCompositionMetrics;
  /** Register an additional font on the underlying backend after creation */
  registerFontFn?: (font: {
    alias: string;
    weight: number;
    style: "normal" | "italic";
    data: Uint8Array;
  }) => void;
  /** Font family mapping for generic CSS families (used in PNG rasterization) */
  fontFamilies?: {
    serif?: string;
    sansSerif?: string;
    cursive?: string;
    fantasy?: string;
    monospace?: string;
  };
  /**
   * Fonts embedded into every compute_layout payload.
   *
   * Only for custom `computeLayoutFn` backends that cannot hold registered
   * state: each layout call re-serializes every font's bytes into the layout
   * JSON. Supported by the layout/measurement APIs only — the render entry
   * points resolve fonts from the WASM instance registry and reject inline
   * fonts. `createEngineAsync` registers fonts once on the WASM instance and
   * intentionally leaves this unset — prefer that path.
   */
  fonts?: Array<{
    alias: string;
    weight?: number;
    style?: "normal" | "italic";
    data: Uint8Array;
  }>;
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  symbols?: Array<{ id: string; def: SymbolDefinition }>;
  /** Variable-width text flow layout function (cursor-based) */
  layoutTextFlowFn?: (input: TextFlowInput) => TextFlowResult;
  /** Exclusion-based text flow layout function (geometry-aware) */
  layoutTextFlowWithExclusionsFn?: (
    input: TextFlowWithExclusionsInput,
  ) => TextFlowWithExclusionsResult;
  /** Measure a text block */
  measureTextBlockFn?: (input: MeasureTextBlockInput) => MeasureTextBlockResult;
  /** Find minimum width preserving line count (plain text) */
  shrinkwrapTextFn?: (input: ShrinkwrapTextInput) => ShrinkwrapTextResult;
  /** Find minimum flow box size preserving line count (flow with exclusions) */
  shrinkwrapFlowFn?: (input: ShrinkwrapFlowInput) => ShrinkwrapFlowResult;
  /** Measure intrinsic (min-content / max-content) inline sizes for text */
  measureIntrinsicInlineSizeFn?: (input: IntrinsicInlineSizeInput) => IntrinsicInlineSizeResult;
  /**
   * Handle to an isolated WASM engine instance.
   * When provided, Engine.dispose() calls handle.dispose() to free
   * Rust-side memory.
   */
  wasmHandle?: { dispose(): void };
  /**
   * WASM render transports. All rendering entry points (`compile`,
   * `renderToIR`, `renderToSvg*`, `renderToPng`, `renderToLayered*`,
   * `renderCompiled*`) require them; a render call on an engine missing the
   * transport it needs throws `WASM_BACKEND_UNAVAILABLE`. Engines created
   * without them (custom `computeLayoutFn` backends) keep working for the
   * layout and measurement APIs (`renderToLayoutTree`, `layoutTextFlow`, …).
   */
  /** WASM render_to_ir transport: layout/options JSON in, `{ ir, warnings }` JSON out */
  renderToIrFn?: (inputJson: string, optionsJson: string) => string;
  /** Compile two compatible layout states into one ordinary IR envelope. */
  compileLayoutTransitionFn?: (
    referenceInputJson: string,
    targetInputJson: string,
    transitionPlanJson: string,
    optionsJson: string,
  ) => string;
  /** WASM render_to_svg transport: layout + options JSON in, SVG/warnings/metadata envelope out */
  renderToSvgFn?: (inputJson: string, optionsJson: string) => string;
  /** WASM render_to_animated_svg transport. */
  renderToAnimatedSvgFn?: (inputJson: string, optionsJson: string) => string;
  /** WASM emit_svg_from_ir transport: IR + options JSON in, SVG string out */
  emitSvgFromIrFn?: (irJson: string, optionsJson: string) => string;
  /** WASM emit_animated_svg_from_ir transport. */
  emitAnimatedSvgFromIrFn?: (irJson: string, optionsJson: string) => string;
  /** Resolve all outlines and return a `{ ir, warnings }` envelope. */
  resolveIrFn?: (irJson: string, optionsJson: string) => string;
  /** Run the bounded PNG outline preflight. */
  preflightIrFn?: (irJson: string) => string;
  /** Parse, preflight, and retain one raster IR snapshot across callbacks. */
  preflightRasterSceneFn?: (irJson: string, optionsJson: string) => RasterSceneRenderHandle;
  /** Resolve outlines and emit SVG without returning resolved IR. */
  resolveAndEmitSvgFromIrFn?: (irJson: string, optionsJson: string) => string;
  /** Resolve outlines and emit declarative animated SVG without returning IR. */
  resolveAndEmitAnimatedSvgFromIrFn?: (irJson: string, optionsJson: string) => string;
  /** WASM sample_animation_state transport: IR JSON + time in, samples JSON out */
  sampleAnimationStateFn?: (irJson: string, timeMs: number) => string;
  /** Prepare a parsed, outline-resolved IR for repeated frame sampling. */
  prepareSceneFn?: (irJson: string, optionsJson: string) => PreparedSceneRenderHandle;
};

type PreparedSceneRenderHandle = {
  renderToSvg(optionsJson: string): string;
  dispose(): void;
};

type RasterSceneRenderHandle = PreparedSceneRenderHandle & {
  resolveAndEmitToSvg(): string;
  resolveToIr(): string;
  resolve(): void;
};

/** SVG-order affine matrix: `(x, y) -> (a*x + c*y + e, b*x + d*y + f)`. */
export type AnimationAffineMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

/** One node's resolved animation values at a sampled time. */
export type AnimationStateSample = {
  nodeId: string;
  opacity: number | null;
  transform: AnimationAffineMatrix | null;
};

/**
 * Whether declarative output carries a `prefers-reduced-motion` opt-out.
 *
 * `pause` is opt-in because the extra CSS changes the emitted bytes; `keep`
 * leaves output identical to a render that never passed the option.
 */
export type ReducedMotionMode = "keep" | "pause";

/**
 * Public package/service identity embedded in an exported file.
 *
 * Deliberately limited to two short identifiers: this is a diagnostics hint,
 * not a general-purpose or user-level metadata carrier.
 */
export type OutputGenerator = {
  name: string;
  version: string;
};

/** Output scale, diagnostics, and generator identity shared by render families. */
export type OutputCommonOptions = {
  scale?: number;
  debug?: boolean | DebugOverlayConfig;
  onWarning?: (warning: RecoverableError) => void;
  /** Render synthetic tofu rectangles for missing glyphs (glyph_id=0). Default: false. */
  showMissingGlyphs?: boolean;
  /** Unsigned public generator identity. Do not put user or request identifiers here. */
  generator?: OutputGenerator;
};

/** Document identifier isolation and node metadata controls for SVG output. */
export type SvgEmissionOptions = {
  /**
   * Literal prefix applied to every boundsvg-generated, document-global SVG
   * identifier and its references. Co-embedded outputs require normalized,
   * non-empty, pairwise prefix-free values for guaranteed non-intersection.
   */
  resourceIdPrefix?: string;
  /** Include generated node identity attributes by default, or omit them. */
  nodeIdMetadata?: "include" | "omit";
};

/** Raster background, dimension-limit behavior, and resolution adjustment notification. */
export type RasterEmissionOptions = {
  rasterBackground?: string;
  rasterOversizeBehavior?: RasterOversizeBehavior;
  onPngResolutionAdjusted?: (warning: PngResolutionAdjustedWarning) => void;
};

/** Validation and text outline grouping choices fixed when compiling a scene. */
export type CompileOptions = {
  skipValidation?: boolean;
  /** Text outline grouping mode carried with the compiled scene. */
  textPathMode?: TextPathMode;
};

/** Options that affect layout-tree construction. */
export type LayoutRenderOptions = Pick<CompileOptions, "skipValidation">;

/** Total document plays, including a fractional final play, or unbounded playback. */
export type AnimationIterationCount = number | "infinite";

/** Document clock shared by every authored animation track in timeline playback. */
export type AnimationTimeline = {
  /** One document-cycle duration in milliseconds. */
  durationMs: number;
  /** Total document plays, including a fractional final play, or unbounded playback. */
  iterations: AnimationIterationCount;
};

/** Select independent authored tracks or a shared document timeline. */
export type AnimatedSvgPlayback =
  | { mode: "independent" }
  | ({ mode: "timeline" } & AnimationTimeline);

/** Compile and emit a static SVG, optionally sampling animation at an explicit time. */
export type RenderSvgOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & { timeMs?: number };

/** Compile and emit declarative animated SVG with an explicit playback mode. */
export type RenderAnimatedSvgOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & {
    playback: AnimatedSvgPlayback;
    timeMs?: number;
    reducedMotion?: ReducedMotionMode;
  };

/** Emit static SVG from a compiled scene without changing compile-time choices. */
export type EmitSvgOptions = OutputCommonOptions & SvgEmissionOptions & { timeMs?: number };

/** Emit declarative animated SVG from a compiled scene with an explicit playback mode. */
export type EmitAnimatedSvgOptions = OutputCommonOptions &
  SvgEmissionOptions & {
    playback: AnimatedSvgPlayback;
    timeMs?: number;
    reducedMotion?: ReducedMotionMode;
  };

/** Compile a scene to sampled IR with recoverable warning delivery. */
export type RenderIrOptions = CompileOptions & {
  onWarning?: (warning: RecoverableError) => void;
  showMissingGlyphs?: boolean;
  timeMs?: number;
};

/** Compile and resolve text outlines, optionally including missing-glyph rectangles. */
export type RenderTextOutlinesOptions = CompileOptions & {
  onWarning?: (warning: RecoverableError) => void;
  showMissingGlyphs?: boolean;
};

/** Resolve text outlines from a compiled scene without changing compile-time choices. */
export type EmitTextOutlinesOptions = Omit<RenderTextOutlinesOptions, keyof CompileOptions>;

/** Compile and rasterize a static or explicitly sampled scene as PNG. */
export type RenderPngOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & { timeMs?: number };

/** Compile and rasterize a static or explicitly sampled scene as lossless WebP. */
export type RenderWebpOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & { timeMs?: number };

/** Rasterize a compiled scene as PNG with output-time controls. */
export type EmitPngOptions = OutputCommonOptions & RasterEmissionOptions & { timeMs?: number };

/** Rasterize a compiled scene as lossless WebP with output-time controls. */
export type EmitWebpOptions = OutputCommonOptions & RasterEmissionOptions & { timeMs?: number };

/** Render paint-ordered SVG layers with optional composition validation. */
export type LayeredSvgOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & {
    timeMs?: number;
    validateComposition?: LayeredCompositionValidationOptions;
  };

/** Rasterize paint-ordered layers with optional composition validation. */
export type LayeredPngOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & {
    timeMs?: number;
    validateComposition?: LayeredCompositionValidationOptions;
  };

/** Single-document reference and ordered SVG layers supplied to the raster comparison transport. */
export type ValidateLayeredSvgCompositionInput = {
  singleSvg: string;
  layers: Array<{ svg: string; paintOrder: number }>;
  options?: Pick<PngRenderOptions, "fontFamilies">;
};

/** Pixel difference counts and canvas dimensions returned by composition comparison. */
export type ValidateLayeredSvgCompositionMetrics = Pick<
  LayeredCompositionValidationResult,
  "differentPixels" | "differenceRatio" | "width" | "height"
>;

type CompiledSceneSource = Pick<CompiledSceneRecord, "ir" | "textPathMode">;

/** One ordered static SVG sample from a frame schedule. */
export type SvgFrame = {
  /** Zero-based position in the requested frame schedule. */
  index: number;
  /** Exact deterministic sampling time supplied by the caller. */
  timeMs: number;
  format: "svg";
  /** Static SVG with the sampled pose baked into ordinary attributes. */
  data: string;
};

/** One ordered PNG sample from a frame schedule. */
export type PngFrame = {
  /** Zero-based position in the requested frame schedule. */
  index: number;
  /** Exact deterministic sampling time supplied by the caller. */
  timeMs: number;
  format: "png";
  /** PNG bytes rasterized from a rasterizer-compatible SVG carrying the static sampled pose. */
  data: Uint8Array;
};

/** One ordered result from `renderFrames` or a WorkerPool frame stream. */
export type Frame = SvgFrame | PngFrame;

/** Total number of animated-raster plays, or an unbounded animation. */
export type AnimatedRasterIterations = NonNullable<AnimationSpec["iterations"]>;

/** Sample schedule and required total play count for animated WebP encoding. */
export type RenderAnimatedWebpOptions = Omit<RenderWebpOptions, "timeMs"> &
  AnimationScheduleOptions & {
    /** Total play count, 1..=65535, or `"infinite"`. */
    iterations: AnimatedRasterIterations;
  };

/** Sample schedule and required total play count for animated GIF encoding. */
export type RenderAnimatedGifOptions = Omit<RenderPngOptions, "timeMs"> &
  AnimationScheduleOptions & {
    /** Total play count, 1..=65536, or `"infinite"`. */
    iterations: AnimatedRasterIterations;
  };

/** Animated WebP options for a scene whose compile-time choices are already fixed. */
export type RenderCompiledAnimatedWebpOptions = Omit<
  RenderAnimatedWebpOptions,
  "skipValidation" | "textPathMode"
>;

/** Animated GIF options for a scene whose compile-time choices are already fixed. */
export type RenderCompiledAnimatedGifOptions = Omit<
  RenderAnimatedGifOptions,
  "skipValidation" | "textPathMode"
>;

/** Compile once and lazily emit static SVG at each requested sample time. */
export type RenderSvgFramesOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & {
    /** Non-negative finite sample times. Duplicates and non-monotonic order are preserved. */
    timesMs: readonly number[];
    format: "svg";
  };

/** Compile once and lazily rasterize PNG at each requested sample time. */
export type RenderPngFramesOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & {
    /** Non-negative finite sample times. Duplicates and non-monotonic order are preserved. */
    timesMs: readonly number[];
    format: "png";
  };

/** Select SVG or PNG payloads for an ordered frame iterator. */
export type RenderFramesOptions = RenderSvgFramesOptions | RenderPngFramesOptions;

/** Sample a compiled scene as SVG without changing compile-time choices. */
export type RenderCompiledSvgFramesOptions = Omit<RenderSvgFramesOptions, keyof CompileOptions>;

/** Sample a compiled scene as PNG without changing compile-time choices. */
export type RenderCompiledPngFramesOptions = Omit<RenderPngFramesOptions, keyof CompileOptions>;

/** Select SVG or PNG samples from an existing compiled scene. */
export type RenderCompiledFramesOptions =
  | RenderCompiledSvgFramesOptions
  | RenderCompiledPngFramesOptions;

type InternalRenderOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions &
  RasterEmissionOptions & {
    animation?: "declarative" | "static";
    playback?: AnimatedSvgPlayback;
    timeMs?: number;
    reducedMotion?: ReducedMotionMode;
  };

type InternalEmitOptions = Omit<InternalRenderOptions, keyof CompileOptions>;

type SvgRenderBackendOptions<ResolveReturnedIrOutlines extends boolean> = {
  resolveReturnedIrOutlines: ResolveReturnedIrOutlines;
  renderTransport: EngineOptions["renderToSvgFn"];
  transportName: string;
};

type ResolveAndEmitSvgRequest = {
  emitOptions: InternalEmitOptions & {
    showMissingGlyphs?: boolean;
    preserveResolvedUnitOutlines?: boolean;
    rasterizerCompat?: boolean;
    enforcePngOutlineGlyphLimit?: boolean;
    irSnapshotJson?: string;
  };
  animated: boolean;
};

type LegacyRenderFramesOptions = InternalRenderOptions & {
  /** Non-negative finite sample times. Duplicates and non-monotonic order are preserved. */
  timesMs: readonly number[];
  /** Payload format for every returned frame. */
  format: "svg" | "png";
};

/** Copy an authenticated schedule array by index without its iterable or species hooks. */
function snapshotScheduleArray(values: readonly unknown[]): unknown[] {
  const snapshot = new Array<unknown>(values.length);
  for (let index = 0; index < snapshot.length; index += 1) {
    snapshot[index] = values[index];
  }
  return snapshot;
}

function snapshotRenderOptions<
  Options extends
    | RenderPngOptions
    | RenderWebpOptions
    | EmitPngOptions
    | EmitWebpOptions
    | LayeredPngOptions
    | LayeredSvgOptions
    | LegacyRenderFramesOptions
    | RenderAnimatedWebpOptions
    | RenderAnimatedGifOptions,
>(options: Options, shouldUseIndexedScheduleCopy = false): Options {
  const source = shouldUseIndexedScheduleCopy ? { ...options } : options;
  const debug = source.debug;
  return {
    ...source,
    ...(typeof debug === "object" && debug !== null
      ? { debug: { ...(debug.parts !== undefined && { parts: [...debug.parts] }) } }
      : {}),
    ...(source.generator !== undefined ? { generator: { ...source.generator } } : {}),
    ...(Array.isArray(Reflect.get(source, "timesMs"))
      ? {
          timesMs: shouldUseIndexedScheduleCopy
            ? snapshotScheduleArray(Reflect.get(source, "timesMs") as readonly number[])
            : [...(Reflect.get(source, "timesMs") as readonly number[])],
        }
      : {}),
    ...(Array.isArray(Reflect.get(source, "frameDurationsMs"))
      ? {
          frameDurationsMs: shouldUseIndexedScheduleCopy
            ? snapshotScheduleArray(Reflect.get(source, "frameDurationsMs") as readonly number[])
            : [...(Reflect.get(source, "frameDurationsMs") as readonly number[])],
        }
      : {}),
    ...(Reflect.has(options, "validateComposition") &&
    typeof Reflect.get(options, "validateComposition") === "object" &&
    Reflect.get(options, "validateComposition") !== null
      ? {
          validateComposition: {
            ...(Reflect.get(options, "validateComposition") as LayeredCompositionValidationOptions),
          },
        }
      : {}),
  } as Options;
}

type AnimationRasterPlan = {
  requestedScale: number;
  behavior: RasterOversizeBehavior;
  emitOpts: Pick<
    OutputCommonOptions & RasterEmissionOptions,
    "scale" | "onPngResolutionAdjusted" | "onWarning"
  >;
  deferredWarnings: readonly RecoverableError[];
};

type FrameEncoder =
  | { format: "svg" }
  | { format: "png"; rasterize: NonNullable<EngineOptions["svgToPngFn"]> };

type LayeredRenderSnapshot = {
  emitLayerSvg: (layerIr: IR, emitOptions: LayerEmitOptions) => string;
  validateComposition: EngineOptions["validateLayeredSvgCompositionFn"];
  fontFamilies: PngRenderOptions["fontFamilies"];
};

type PreparedFrameScene = {
  prepared: PreparedSceneRenderHandle;
  rasterScene?: RasterSceneRenderHandle;
};

type PreparedFrameEmissionPlan = {
  stableOptions: InternalRenderOptions;
  format: "svg" | "png";
  rasterPlan: AnimationRasterPlan | undefined;
};

type FrameRenderPlan = PreparedFrameEmissionPlan & {
  timesMs: number[];
  frameEncoder: FrameEncoder;
  pngOptions: PngRenderOptions;
};

class PreparedFrameIterator implements IterableIterator<Frame> {
  private nextIndex = 0;
  private closed = false;

  constructor(
    private readonly timesMs: readonly number[],
    private readonly renderFrame: (index: number, timeMs: number) => Frame,
    private readonly release: () => void,
  ) {}

  next(): IteratorResult<Frame, undefined> {
    if (this.closed) {
      return { done: true, value: undefined };
    }
    if (this.nextIndex >= this.timesMs.length) {
      this.close();
      return { done: true, value: undefined };
    }

    const index = this.nextIndex;
    const timeMs = this.timesMs[index];
    if (timeMs === undefined) {
      this.close();
      return { done: true, value: undefined };
    }
    try {
      const frame = this.renderFrame(index, timeMs);
      this.nextIndex += 1;
      if (this.nextIndex >= this.timesMs.length) {
        this.close();
      }
      return { done: false, value: frame };
    } catch (error) {
      this.close();
      throw error;
    }
  }

  return(): IteratorResult<Frame, undefined> {
    this.close();
    return { done: true, value: undefined };
  }

  throw(error?: unknown): IteratorResult<Frame, undefined> {
    this.close();
    throw error;
  }

  [Symbol.iterator](): IterableIterator<Frame> {
    return this;
  }

  private close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.release();
  }
}

/** Own a lazy schedule and the shared prepared renderer until its last sample or return. */
class PreparedAnimationProducer implements AnimatedRasterFrameProducer {
  /** Detach the renderer and cursor on close to release scene and explicit input references. */
  constructor(
    private cursor: AnimationScheduleCursor | undefined,
    private renderer:
      | {
          pushFrame(session: AnimatedRasterSessionHandle, timeMs: number, durationMs: number): void;
          release(): void;
        }
      | undefined,
    private remaining: number,
  ) {}

  /** Push one sample and release the scene after its last synchronous native operation. */
  pushNext(session: AnimatedRasterSessionHandle): boolean {
    if (!this.cursor || !this.renderer) {
      return false;
    }
    try {
      const entry = this.cursor.next();
      if (entry.done) {
        this.return();
        return false;
      }
      this.renderer.pushFrame(session, entry.value.timeMs, entry.value.durationMs);
      this.remaining -= 1;
      if (this.remaining === 0) {
        this.return();
      }
      return true;
    } catch (error) {
      this.return();
      throw error;
    }
  }

  /** Release the prepared scene even when no first sample was requested. */
  return(): void {
    this.cursor?.return();
    this.cursor = undefined;
    const renderer = this.renderer;
    this.renderer = undefined;
    renderer?.release();
  }
}

/** Own rendering resources and coordinate WASM layout, compilation, emission, and rasterization. */
export class Engine {
  private readonly options: EngineOptions;
  private readonly compiledSceneOwnerToken: CompiledSceneOwnerToken =
    createCompiledSceneOwnerToken();
  private disposed = false;
  private resourceRevision = 0;
  private readonly resourceListeners = new Set<() => void>();
  private readonly geometryRegistry = new Map<string, GeometryDoc>();
  private readonly symbolRegistry = new Map<string, SymbolDefinition>();
  private readonly preparedFrameScenes = new Set<WeakRef<PreparedSceneRenderHandle>>();
  /** Retain the animation token until the external owner has settled cleanup. */
  private activeAnimation: { job?: AnimatedRasterJob } | undefined;

  /** Initialize local resource registries from the supplied transports and definitions. */
  constructor(options: EngineOptions) {
    this.options = options;
    registerAnimatedRasterJobFactory(this, (input, signal) =>
      this.createAnimatedRasterJobWithBackend(input, signal),
    );
    for (const geometry of options.geometries ?? []) {
      this.geometryRegistry.set(geometry.id, geometry.doc);
    }
    for (const symbol of options.symbols ?? []) {
      this.symbolRegistry.set(symbol.id, symbol.def);
    }
  }

  /** Current resource invalidation generation; throws after disposal. */
  get resourceVersion(): number {
    this.ensureNotDisposed();
    return this.resourceRevision;
  }

  /**
   * Observe resource invalidation and terminal disposal. Listeners must not
   * synchronously render or mutate resources. Unsubscribe is idempotent.
   */
  subscribeResourceChanges(listener: () => void): () => void {
    this.ensureNotDisposed();
    this.resourceListeners.add(listener);
    return () => {
      this.resourceListeners.delete(listener);
    };
  }

  /**
   * Register additional fonts after engine creation.
   *
   * Enables font packs and lazy loading (e.g. an editor adding a face on
   * demand) without recreating the engine. Registering an alias/weight/style
   * combination that already exists throws.
   */
  registerFonts(
    fonts: Array<{
      alias: string;
      weight?: number;
      style?: "normal" | "italic";
      data: Uint8Array;
    }>,
  ): void {
    this.ensureNotDisposed();
    const registerFontFn = this.options.registerFontFn;
    if (!registerFontFn) {
      throw new FatalError(
        "NO_FONT_REGISTRATION_API",
        "registerFonts is not available. Engine was not created with font registration support.",
        { stage: "engine" },
      );
    }
    let hasAttemptedRegistration = false;
    try {
      for (const font of fonts) {
        const fontRegistration = {
          alias: font.alias,
          weight: font.weight ?? DEFAULT_FONT_WEIGHT,
          style: font.style ?? "normal",
          data: font.data,
        };
        if (!hasAttemptedRegistration) {
          this.ensureResourceVersionAvailable();
        }
        hasAttemptedRegistration = true;
        registerFontFn(fontRegistration);
      }
    } finally {
      // A backend can change resources before throwing, including on its first call.
      if (hasAttemptedRegistration) {
        this.invalidateResources();
      }
    }
  }

  /** Register or replace a geometry definition and invalidate resource observers. */
  registerGeometry(id: string, doc: GeometryDoc): void {
    this.ensureNotDisposed();
    this.ensureResourceVersionAvailable();
    this.geometryRegistry.set(id, doc);
    this.invalidateResources();
  }

  /** Register or replace a symbol definition and invalidate resource observers. */
  registerSymbol(id: string, def: SymbolDefinition): void {
    this.ensureNotDisposed();
    this.ensureResourceVersionAvailable();
    this.symbolRegistry.set(id, def);
    this.invalidateResources();
  }

  /** Remove a registered geometry and invalidate observers only when it existed. */
  unregisterGeometry(id: string): void {
    this.ensureNotDisposed();
    if (this.geometryRegistry.has(id)) {
      this.ensureResourceVersionAvailable();
      this.geometryRegistry.delete(id);
      this.invalidateResources();
    }
  }

  /** Remove a registered symbol and invalidate observers only when it existed. */
  unregisterSymbol(id: string): void {
    this.ensureNotDisposed();
    if (this.symbolRegistry.has(id)) {
      this.ensureResourceVersionAvailable();
      this.symbolRegistry.delete(id);
      this.invalidateResources();
    }
  }

  /**
   * Render to an SVG string. The SVG is produced entirely by the WASM
   * emitter (glyph outlines included), so this is a string-only fast path
   * that does not resolve outlines on — or even retain — the intermediate
   * IR. Use {@link renderToSvgAndIR} when the returned IR's `glyphPaths` are
   * needed; Rust then returns the same resolved IR it emitted.
   */
  renderToSvg(input: EngineInput, renderOpts?: RenderSvgOptions): string {
    assertOwnOptionKeys(renderOpts, STATIC_SVG_OPTION_KEYS, "renderToSvg");
    assertSvgEmissionOptionValues(renderOpts);
    assertValidAnimationRenderOptions(renderOpts);
    return this.renderWithWasmBackend(input, renderOpts, {
      resolveReturnedIrOutlines: false,
      renderTransport: this.options.renderToSvgFn,
      transportName: "renderToSvgFn",
    }).svg;
  }

  /**
   * Render to an SVG string plus the resolved IR. Unlike {@link renderToSvg},
   * this resolves glyph outlines on the returned IR (populating `glyphPaths`)
   * so downstream hit-test / text-selection consumers see the full contract.
   */
  renderToSvgAndIR(input: EngineInput, renderOpts?: RenderSvgOptions): { svg: string; ir: IR } {
    assertOwnOptionKeys(renderOpts, STATIC_SVG_OPTION_KEYS, "renderToSvgAndIR");
    assertSvgEmissionOptionValues(renderOpts);
    assertValidAnimationRenderOptions(renderOpts);
    return this.renderWithWasmBackend(input, renderOpts, {
      resolveReturnedIrOutlines: true,
      renderTransport: this.options.renderToSvgFn,
      transportName: "renderToSvgFn",
    });
  }

  /** Render declarative SVG animation using the required independent or timeline playback mode. */
  renderToAnimatedSvg(input: EngineInput, renderOpts: RenderAnimatedSvgOptions): string {
    assertOwnOptionKeys(renderOpts, ANIMATED_SVG_OPTION_KEYS, "renderToAnimatedSvg");
    assertSvgEmissionOptionValues(renderOpts);
    assertAnimatedSvgPlayback(renderOpts?.playback, renderOpts?.timeMs);
    assertValidAnimationRenderOptions(renderOpts);
    return this.renderWithWasmBackend(input, renderOpts, {
      resolveReturnedIrOutlines: false,
      renderTransport: this.options.renderToAnimatedSvgFn,
      transportName: "renderToAnimatedSvgFn",
    }).svg;
  }

  /** Render declarative animated SVG and return the outline-resolved IR used to emit it. */
  renderToAnimatedSvgAndIR(
    input: EngineInput,
    renderOpts: RenderAnimatedSvgOptions,
  ): { svg: string; ir: IR } {
    assertOwnOptionKeys(renderOpts, ANIMATED_SVG_OPTION_KEYS, "renderToAnimatedSvgAndIR");
    assertSvgEmissionOptionValues(renderOpts);
    assertAnimatedSvgPlayback(renderOpts?.playback, renderOpts?.timeMs);
    assertValidAnimationRenderOptions(renderOpts);
    return this.renderWithWasmBackend(input, renderOpts, {
      resolveReturnedIrOutlines: true,
      renderTransport: this.options.renderToAnimatedSvgFn,
      transportName: "renderToAnimatedSvgFn",
    });
  }

  /** Render paint-ordered SVG layers and optionally compare their composition with a single SVG. */
  renderToLayeredSvg(input: EngineInput, renderOpts?: LayeredSvgOptions): LayeredSvgResult {
    assertOwnOptionKeys(
      renderOpts,
      new Set([...STATIC_SVG_OPTION_KEYS, "validateComposition"]),
      "renderToLayeredSvg",
    );
    assertSvgEmissionOptionValues(renderOpts);
    assertValidAnimationRenderOptions(renderOpts);
    this.ensureNotDisposed();
    const stableRenderOpts =
      renderOpts === undefined ? undefined : snapshotRenderOptions(renderOpts);
    const renderSnapshot = this.createLayeredRenderSnapshot();
    const { ir, layeredResult } = this.prepareLayeredSvgRender(
      input,
      stableRenderOpts,
      renderSnapshot.emitLayerSvg,
    );

    const compositionValidation = this.validateLayeredSvgComposition({
      ir,
      layeredResult,
      renderOpts: stableRenderOpts,
      renderSnapshot,
    });
    if (compositionValidation) {
      return {
        ...layeredResult,
        compositionValidation,
      };
    }
    return layeredResult;
  }

  /** Rasterize paint-ordered layers with shared scale resolution and optional composition validation. */
  renderToLayeredPng(input: EngineInput, renderOpts?: LayeredPngOptions): LayeredPngResult {
    assertOwnOptionKeys(
      renderOpts,
      new Set([...RASTER_OPTION_KEYS, "validateComposition"]),
      "renderToLayeredPng",
    );
    this.ensureNotDisposed();
    const stableRenderOpts =
      renderOpts === undefined ? undefined : snapshotRenderOptions(renderOpts);
    assertValidAnimationRenderOptions(stableRenderOpts);
    this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    const rasterize = this.requireRasterEncoder(this.options.svgToPngFn, {
      code: "PNG_NO_RASTERIZER",
      message: "svgToPngFn is required for PNG rendering",
    });
    const renderSnapshot = this.createLayeredRenderSnapshot();
    const requestedScale = stableRenderOpts?.scale ?? 1;
    assertPngScale(requestedScale);

    const vnode = this.resolveInput(input, assertRasterCanvasInput);
    if (!stableRenderOpts?.skipValidation) {
      validate(vnode);
    }
    const compiledSource = this.compileSourceWithWasmBackend(
      vnode,
      toCompileOptions(stableRenderOpts),
      {
        sampleAnimation: true,
        timeMs: stableRenderOpts?.timeMs,
        showMissingGlyphs: stableRenderOpts?.showMissingGlyphs,
      },
    );
    const irMetadataSnapshot: IR = {
      ...compiledSource.ir,
      warnings: [...compiledSource.ir.warnings],
    };
    assertRenderableCanvas(irMetadataSnapshot);
    const sourceNodeMap = snapshotLayerSourceMetadata(vnode);
    const behavior = stableRenderOpts?.rasterOversizeBehavior ?? "auto-adjust";
    let scaleResolution: ResolvedRasterScale | undefined;
    let scaleError: FatalError | undefined;
    try {
      scaleResolution = resolveRasterScale({
        width: irMetadataSnapshot.width,
        height: irMetadataSnapshot.height,
        requestedScale,
      });
    } catch (error) {
      if (!(error instanceof FatalError)) {
        throw error;
      }
      scaleError = error;
    }
    const rasterScene = this.preflightRasterScene(
      serializeIrForWasm(compiledSource.ir),
      JSON.stringify({
        textPathMode: compiledSource.textPathMode,
        showMissingGlyphs: stableRenderOpts?.showMissingGlyphs,
        preserveResolvedUnitOutlines: true,
      }),
    );
    const pngOptions = this.createLayeredPngRenderOptions(
      stableRenderOpts,
      renderSnapshot.fontFamilies,
    );

    try {
      deliverIrWarnings(irMetadataSnapshot, stableRenderOpts?.onWarning);
      if (scaleError) {
        throw scaleError;
      }
      if (!scaleResolution) {
        throw new FatalError("RASTER_SCALE_UNRESOLVED", "Raster scale was not resolved", {
          stage: "engine",
        });
      }
      this.handleResolvedPngScale({
        ir: irMetadataSnapshot,
        scaleResolution,
        behavior,
        emitOpts: stableRenderOpts,
      });

      const ir = this.resolveRasterSceneIr(rasterScene, irMetadataSnapshot);
      const appliedRenderOpts: LayeredPngOptions = {
        ...stableRenderOpts,
        scale: scaleResolution.appliedScale,
      };
      const layeredRenderInput = {
        ir,
        sourceNodeMap,
        options: {
          debug: appliedRenderOpts.debug ?? ir.debug,
          scale: appliedRenderOpts.scale,
          timeMs: appliedRenderOpts.timeMs ?? 0,
        },
        emitLayerSvg: renderSnapshot.emitLayerSvg,
      } as const;
      const layeredResult = renderLayeredSvg(layeredRenderInput);
      // Both passes intentionally use the identical resolved IR and immutable
      // applied options. The second pass is the raster payload measured by the
      // transport audit; no callback can reopen scale selection between them.
      const rasterizedLayeredResult = renderLayeredSvg(layeredRenderInput);

      const layers = layeredResult.layers.map((layer) => {
        let png: Uint8Array;
        try {
          png = rasterize(findLayerSvgForPaintOrder(rasterizedLayeredResult, layer), pngOptions);
        } catch (error) {
          throw wrapWasmRenderError(error);
        }
        return { ...stripLayerSvg(layer), png };
      });

      const compositionValidation = this.validateLayeredSvgComposition({
        ir,
        layeredResult,
        renderOpts: appliedRenderOpts,
        renderSnapshot,
      });
      return {
        width: layeredResult.width,
        height: layeredResult.height,
        pixelWidth: scaleResolution.outputWidth,
        pixelHeight: scaleResolution.outputHeight,
        layers,
        ...(compositionValidation ? { compositionValidation } : {}),
        manifest: {
          width: layeredResult.width,
          height: layeredResult.height,
          pixelWidth: scaleResolution.outputWidth,
          pixelHeight: scaleResolution.outputHeight,
          ...(layeredResult.manifest.animated
            ? { animated: true as const, timeMs: layeredResult.manifest.timeMs ?? 0 }
            : {}),
          layers: layers.map(({ png: _png, ...entry }) => entry),
        },
      };
    } finally {
      rasterScene.dispose();
    }
  }

  /** Compile a scene and return resolved text outline nodes for inspection or export. */
  renderToTextOutlines(
    input: EngineInput,
    renderOpts?: RenderTextOutlinesOptions,
  ): TextOutlineNode[] {
    assertOwnOptionKeys(
      renderOpts,
      new Set([...COMPILE_OPTION_KEYS, "showMissingGlyphs", "onWarning"]),
      "renderToTextOutlines",
    );
    const compiled = this.compile(input, toCompileOptions(renderOpts));
    return this.renderCompiledToTextOutlines(compiled, {
      showMissingGlyphs: renderOpts?.showMissingGlyphs,
      onWarning: renderOpts?.onWarning,
    });
  }

  /** Compile a scene and return PNG bytes through the injected WASM rasterizer. */
  renderToPng(input: EngineInput, renderOpts?: RenderPngOptions): Uint8Array {
    assertOwnOptionKeys(renderOpts, RASTER_OPTION_KEYS, "renderToPng");
    return this.renderToPngWithWasmBackend(input, renderOpts);
  }

  /**
   * Render to a lossless (VP8L) WebP. Same pipeline and raster caps as
   * `renderToPng`; only the encoder differs.
   */
  renderToWebp(input: EngineInput, renderOpts?: RenderWebpOptions): Uint8Array {
    assertOwnOptionKeys(renderOpts, RASTER_OPTION_KEYS, "renderToWebp");
    return this.renderToWebpWithWasmBackend(input, renderOpts);
  }

  /** Stream sampled lossless WebP to a required patchable sink; await its commit. */
  // biome-ignore lint/complexity/useMaxParams: Public writes keep source, render options, sink and transport cancellation separate.
  async renderToAnimatedWebp(
    input: EngineInput,
    renderOpts: RenderAnimatedWebpOptions,
    sink: AnimatedWebpSink,
    writeOptions?: AnimatedRasterWriteOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation(
      { format: "webp", source: { kind: "scene", input }, options: renderOpts },
      sink,
      writeOptions,
    );
  }

  /** Stream an authentic compiled scene without changing its compile-time choices. */
  // biome-ignore lint/complexity/useMaxParams: Public writes keep source, render options, sink and transport cancellation separate.
  async renderCompiledToAnimatedWebp(
    compiled: CompiledScene,
    renderOpts: RenderCompiledAnimatedWebpOptions,
    sink: AnimatedWebpSink,
    writeOptions?: AnimatedRasterWriteOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation(
      { format: "webp", source: { kind: "compiled", compiled }, options: renderOpts },
      sink,
      writeOptions,
    );
  }

  /** Stream palette GIF with cumulative centisecond timing to a required sink. */
  // biome-ignore lint/complexity/useMaxParams: Public writes keep source, render options, sink and transport cancellation separate.
  async renderToAnimatedGif(
    input: EngineInput,
    renderOpts: RenderAnimatedGifOptions,
    sink: AnimatedRasterSink,
    writeOptions?: AnimatedRasterWriteOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation(
      { format: "gif", source: { kind: "scene", input }, options: renderOpts },
      sink,
      writeOptions,
    );
  }

  /** Stream an authentic compiled scene as GIF, then await sink completion. */
  // biome-ignore lint/complexity/useMaxParams: Public writes keep source, render options, sink and transport cancellation separate.
  async renderCompiledToAnimatedGif(
    compiled: CompiledScene,
    renderOpts: RenderCompiledAnimatedGifOptions,
    sink: AnimatedRasterSink,
    writeOptions?: AnimatedRasterWriteOptions,
  ): Promise<AnimatedRasterWriteResult> {
    return this.writeAnimation(
      { format: "gif", source: { kind: "compiled", compiled }, options: renderOpts },
      sink,
      writeOptions,
    );
  }

  /** Authenticate source identity without compiling or adopting caller output. */
  private authenticateAnimationSource(
    source: AnimatedRasterJobInput["source"],
    invalid: (reason: string, field?: "format" | "options") => never,
  ): void {
    const sourceKeys =
      source.kind === "scene"
        ? ["kind", "input"]
        : source.kind === "compiled"
          ? ["kind", "compiled"]
          : ["kind", "input", "compileOptions"];
    if (
      Reflect.ownKeys(source).some((key) => typeof key !== "string" || !sourceKeys.includes(key))
    ) {
      invalid("unknownField");
    }
    if (source.kind === "compiled") {
      authenticateCompiledScene(source.compiled, this.compiledSceneOwnerToken);
    } else if (source.kind === "scene" || source.kind === "transition") {
      if (!isAnimationRecord(source.input)) {
        invalid("wrongType");
      }
      if (source.kind === "transition" && source.compileOptions !== undefined) {
        if (!isAnimationRecord(source.compileOptions)) {
          invalid(source.compileOptions === null ? "nullField" : "wrongType");
        }
        assertOwnOptionKeys(
          source.compileOptions,
          new Set(COMPILE_OPTION_KEYS),
          "createAnimatedRasterJob",
        );
      }
    } else {
      invalid("outOfDomain");
    }
  }

  /** Reject coercion of optional scalars while leaving their domain checks to their owner. */
  private authenticateAnimationOptionValues(
    options: AnimatedRasterJobInput["options"],
    invalid: (reason: string, field?: "format" | "options") => never,
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
    if (debug !== undefined && typeof debug !== "boolean" && !isAnimationRecord(debug)) {
      invalid(debug === null ? "nullField" : "wrongType");
    }
    if (options.generator !== undefined && !isAnimationRecord(options.generator)) {
      invalid(options.generator === null ? "nullField" : "wrongType");
    }
  }

  /** Authenticate without adopting caller output; busy entries never abort an outer sink. */
  private authenticateAnimationInput(
    input: AnimatedRasterJobInput,
    publicCallbacks: boolean,
  ): void {
    const format = input?.format === "gif" ? "gif" : "webp";
    const invalid = (reason: string, field: "format" | "options" = "options"): never => {
      throw animatedRasterFailure(format, "open", {
        family: "SESSION_INVALID_INPUT",
        reason,
        field,
      });
    };
    if (!isAnimationRecord(input)) {
      invalid(input === null ? "nullField" : "wrongType");
    }
    if (
      Reflect.ownKeys(input).some(
        (key) => typeof key !== "string" || !["format", "source", "options"].includes(key),
      )
    ) {
      invalid("unknownField");
    }
    if (input.format !== "webp" && input.format !== "gif") {
      invalid("outOfDomain", "format");
    }
    if (!isAnimationRecord(input.source) || !isAnimationRecord(input.options)) {
      invalid("wrongType");
    }
    this.authenticateAnimationSource(input.source, invalid);
    const allowed =
      input.source.kind === "scene"
        ? ANIMATED_RASTER_OPTION_KEYS
        : COMPILED_ANIMATED_RASTER_OPTION_KEYS;
    assertOwnOptionKeys(input.options, allowed, "createAnimatedRasterJob");
    if (
      Reflect.ownKeys(input.options).some(
        (key) =>
          typeof key !== "string" || !allowed.has(key) || (!publicCallbacks && key === "onWarning"),
      )
    ) {
      invalid("unknownField");
    }
    this.authenticateAnimationOptionValues(input.options, invalid);
  }

  /** Acquire one animation token, snapshot once, then construct the shared pull owner. */
  private createAnimatedRasterJobWithBackend(
    input: AnimatedRasterJobInput,
    signal?: AbortSignal,
    onAdopt?: (release: () => void) => void,
  ): AnimatedRasterJob {
    this.ensureNotDisposed();
    const format = input?.format === "gif" ? "gif" : "webp";
    this.authenticateAnimationInput(input, onAdopt !== undefined);
    assertAnimationSignal(signal, format);
    if (this.activeAnimation !== undefined) {
      throw animatedRasterFailure(format, "open", {
        family: "JOB_BUSY",
        reason: "activeAnimation",
      });
    }
    const token: { job?: AnimatedRasterJob } = {};
    this.activeAnimation = token;
    const release = (): void => {
      if (this.activeAnimation === token) {
        this.activeAnimation = undefined;
      }
    };
    onAdopt?.(release);
    try {
      const stableOptions: RenderAnimatedGifOptions | RenderAnimatedWebpOptions =
        snapshotRenderOptions(input.options, true);
      let stableSource: AnimatedRasterJobInput["source"] | undefined =
        input.source.kind === "compiled"
          ? { kind: "compiled", compiled: input.source.compiled }
          : input.source.kind === "scene"
            ? {
                kind: "scene",
                // Scene documents keep their getter-free boundary before the owned VNode copy.
                input: snapshotAnimationInput(resolveSceneOrVNodeInput(input.source.input), format),
              }
            : snapshotAnimationInput(input.source, format);
      this.ensureNotDisposed();
      if (isAnimationSignalAborted(signal)) {
        throw animatedRasterFailure(format, "open", { family: "ABORTED", reason: "signal" });
      }
      this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
      const open = this.options.openAnimatedRasterSessionFn;
      if (!open) {
        throw new FatalError(
          format === "webp" ? "WEBP_NO_ENCODER" : "GIF_NO_ENCODER",
          "openAnimatedRasterSessionFn is required for animated raster rendering",
          { stage: "emit" },
        );
      }
      const scale = stableOptions.scale === undefined ? 1 : stableOptions.scale;
      if (typeof scale !== "number") {
        throw new FatalError("PNG_INVALID_SCALE", "PNG scale must be a positive finite number", {
          stage: "emit",
        });
      }
      assertPngScale(scale);
      const invalidSchedule =
        format === "webp" ? "ANIMATED_WEBP_INVALID_SCHEDULE" : "ANIMATED_GIF_INVALID_SCHEDULE";
      assertAnimationIterations(stableOptions.iterations, {
        maxIterations:
          format === "webp" ? MAX_ANIMATED_WEBP_ITERATIONS : MAX_ANIMATED_GIF_ITERATIONS,
        code: invalidSchedule,
        formatName: format === "webp" ? "Animated WebP" : "Animated GIF",
      });
      const descriptor = resolveAnimationScheduleDescriptor(stableOptions, {
        format: format,
        invalidSchedule,
      });
      const job = new OwnedAnimatedRasterJob({
        format: format,
        descriptor,
        signal,
        isDisposed: () => this.disposed,
        release,
        prepare: (timingWarning) => {
          const source = stableSource;
          if (!source) {
            throw animatedRasterFailure(format, "open", {
              family: "SESSION_INVALID_STATE",
              reason: "aborted",
            });
          }
          let compiled: CompiledScene;
          if (source.kind === "compiled") {
            compiled = source.compiled;
          } else if (source.kind === "transition") {
            compiled = this.compileLayoutTransition(source.input, source.compileOptions);
          } else {
            const vnode = this.resolveInput(source.input, assertRasterCanvasInput);
            compiled = this.compile(vnode, {
              skipValidation: stableOptions.skipValidation,
              textPathMode: stableOptions.textPathMode,
            });
          }
          const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
          stableSource = undefined;
          const warnings: SerializedRecoverableError[] = [];
          const collect = (warning: RecoverableError): void => {
            warnings.push(warning.toJSON());
          };
          const frameOptions: InternalRenderOptions = {
            ...toAnimationFrameRenderOptions(stableOptions),
            onWarning: collect,
            onPngResolutionAdjusted: undefined,
          };
          try {
            const renderer = this.createPreparedAnimationRenderer(
              compiledRecord,
              {
                stableOptions: frameOptions,
                format: "svg",
                rasterPlan: {
                  requestedScale: scale,
                  behavior: stableOptions.rasterOversizeBehavior ?? "auto-adjust",
                  emitOpts: { scale, onWarning: collect },
                  deferredWarnings: timingWarning ? [timingWarning] : [],
                },
              },
              { detachCompiledWarnings: source.kind !== "scene" },
            );
            const producer = new PreparedAnimationProducer(
              createAnimationScheduleCursor(descriptor, { format: format, invalidSchedule }),
              renderer,
              descriptor.frameCount,
            );
            return { kind: "ready", producer, warnings, renderOptions: renderer.renderOptions };
          } catch (error) {
            return { kind: "failed", error, warnings };
          }
        },
        open: (renderOptions) => {
          const rasterOptions: PngRenderOptions = {
            oversizeBehavior:
              stableOptions.rasterOversizeBehavior === "error" ? "error" : "autoAdjust",
            ...(stableOptions.rasterBackground === undefined
              ? {}
              : { background: stableOptions.rasterBackground }),
            ...(this.options.fontFamilies === undefined
              ? {}
              : { fontFamilies: { ...this.options.fontFamilies } }),
            ...(stableOptions.generator === undefined
              ? {}
              : { generator: { ...stableOptions.generator } }),
          };
          try {
            return open({
              format: format,
              frameCount: descriptor.frameCount,
              iterations: stableOptions.iterations,
              options: rasterOptions,
              renderOptions,
            });
          } catch (error) {
            throw wrapWasmRenderError(error);
          }
        },
      });
      token.job = job;
      return job;
    } catch (error) {
      if (onAdopt === undefined) {
        release();
      }
      throw error;
    }
  }

  /** Keep adopted sink cleanup and the main token pending until callback settlement. */
  private async writeAnimation(
    input: AnimatedRasterJobInput & {
      options: RenderAnimatedGifOptions | RenderAnimatedWebpOptions;
    },
    sink: AnimatedRasterSink,
    writeOptions?: AnimatedRasterWriteOptions,
  ): Promise<AnimatedRasterWriteResult> {
    const format = input.format;
    const callbacks = {
      onWarning: input.options?.onWarning,
      onPngResolutionAdjusted: input.options?.onPngResolutionAdjusted,
    };
    assertAnimatedRasterSink(sink, { format, shouldRequirePatch: format === "webp" });
    if (
      writeOptions !== undefined &&
      (typeof writeOptions !== "object" ||
        writeOptions === null ||
        Array.isArray(writeOptions) ||
        Reflect.ownKeys(writeOptions).some((key) => key !== "signal"))
    ) {
      throw animatedRasterFailure(format, "open", {
        family: "SESSION_INVALID_INPUT",
        reason: writeOptions === null ? "nullField" : "wrongType",
        field: "options",
      });
    }
    const signal = writeOptions?.signal;
    assertAnimationSignal(signal, format);
    let release: (() => void) | undefined;
    let job: AnimatedRasterJob;
    try {
      job = this.createAnimatedRasterJobWithBackend(input, signal, (callback) => {
        release = callback;
      });
    } catch (error) {
      if (release !== undefined) {
        try {
          await sink.abort(error);
        } catch {
          // Preserve initialization failure.
        } finally {
          release();
        }
      }
      throw error;
    }
    const check = (operation: import("./animation-errors.js").AnimatedRasterOperation): void => {
      if (this.disposed) {
        throw animatedRasterFailure(format, operation, {
          family: "ABORTED",
          reason: "engineDisposed",
        });
      }
      if (isAnimationSignalAborted(signal)) {
        throw animatedRasterFailure(format, operation, { family: "ABORTED", reason: "signal" });
      }
    };
    return writeAnimatedRasterJob(job, sink, { format, callbacks, check });
  }

  /** Lay out text in flow regions through the injected WASM measurement transport. */
  layoutTextFlow(input: TextFlowInput): TextFlowResult {
    this.ensureNotDisposed();
    if (!this.options.layoutTextFlowFn) {
      throw new FatalError(
        "NO_FLOW_API",
        "layoutTextFlow is not available. Engine was not created with flow layout support.",
        { stage: "engine" },
      );
    }
    return invokeMeasurementTransport("layoutTextFlow", this.options.layoutTextFlowFn, input);
  }

  /** Lay out text around exclusions through WASM after checking rich-text depth. */
  layoutTextFlowWithExclusions(input: TextFlowWithExclusionsInput): TextFlowWithExclusionsResult {
    this.ensureNotDisposed();
    if (!this.options.layoutTextFlowWithExclusionsFn) {
      throw new FatalError(
        "NO_EXCLUSION_FLOW_API",
        "layoutTextFlowWithExclusions is not available.",
        { stage: "engine" },
      );
    }
    assertRichTextNodeDepth(input.richText ?? [], "layoutTextFlowWithExclusions");
    return invokeMeasurementTransport(
      "layoutTextFlowWithExclusions",
      this.options.layoutTextFlowWithExclusionsFn,
      input,
    );
  }

  /** Measure a text block through the injected WASM measurement transport. */
  measureTextBlock(input: MeasureTextBlockInput): MeasureTextBlockResult {
    this.ensureNotDisposed();
    if (!this.options.measureTextBlockFn) {
      throw new FatalError("NO_MEASURE_API", "measureTextBlock is not available.", {
        stage: "engine",
      });
    }
    return invokeMeasurementTransport("measureTextBlock", this.options.measureTextBlockFn, input);
  }

  /** Find a fitted text size through WASM after checking rich-text depth. */
  shrinkwrapText(input: ShrinkwrapTextInput): ShrinkwrapTextResult {
    this.ensureNotDisposed();
    if (!this.options.shrinkwrapTextFn) {
      throw new FatalError("NO_SHRINKWRAP_API", "shrinkwrapText is not available.", {
        stage: "engine",
      });
    }
    assertRichTextNodeDepth(input.richText ?? [], "shrinkwrapText");
    return invokeMeasurementTransport("shrinkwrapText", this.options.shrinkwrapTextFn, input);
  }

  /** Find a fitted flow size through WASM after checking rich-text depth. */
  shrinkwrapFlow(input: ShrinkwrapFlowInput): ShrinkwrapFlowResult {
    this.ensureNotDisposed();
    if (!this.options.shrinkwrapFlowFn) {
      throw new FatalError("NO_SHRINKWRAP_FLOW_API", "shrinkwrapFlow is not available.", {
        stage: "engine",
      });
    }
    assertRichTextNodeDepth(input.richText ?? [], "shrinkwrapFlow");
    return invokeMeasurementTransport("shrinkwrapFlow", this.options.shrinkwrapFlowFn, input);
  }

  /** Measure intrinsic text inline sizes through WASM after checking rich-text depth. */
  measureIntrinsicInlineSize(input: IntrinsicInlineSizeInput): IntrinsicInlineSizeResult {
    this.ensureNotDisposed();
    if (!this.options.measureIntrinsicInlineSizeFn) {
      throw new FatalError(
        "NO_INTRINSIC_INLINE_SIZE_API",
        "measureIntrinsicInlineSize is not available.",
        { stage: "engine" },
      );
    }
    assertRichTextNodeDepth(input.richText ?? [], "measureIntrinsicInlineSize");
    return invokeMeasurementTransport(
      "measureIntrinsicInlineSize",
      this.options.measureIntrinsicInlineSizeFn,
      input,
    );
  }

  /** Validate the input and return its WASM-computed layout tree without emitting an artifact. */
  renderToLayoutTree(input: EngineInput, renderOpts?: LayoutRenderOptions): LayoutResult {
    assertOwnOptionKeys(renderOpts, new Set(["skipValidation"]), "renderToLayoutTree");
    this.ensureNotDisposed();
    const vnode = this.resolveInput(input);

    if (!renderOpts?.skipValidation) {
      validate(vnode);
    }
    return computeLayout(vnode, {
      computeLayoutFn: this.options.computeLayoutFn,
      fonts: this.options.fonts,
      shapeRegistry: this.shapeRegistry(),
    });
  }

  /** Return detached sampled IR and deliver its recoverable warnings. */
  renderToIR(input: EngineInput, renderOpts?: RenderIrOptions): IR {
    assertOwnOptionKeys(
      renderOpts,
      new Set([...COMPILE_OPTION_KEYS, "onWarning", "showMissingGlyphs", "timeMs"]),
      "renderToIR",
    );
    this.ensureNotDisposed();
    assertValidAnimationRenderOptions(renderOpts);
    const vnode = this.resolveInput(input);
    if (!renderOpts?.skipValidation) {
      validate(vnode);
    }
    const ir = this.compileSourceWithWasmBackend(vnode, toCompileOptions(renderOpts), {
      sampleAnimation: true,
      timeMs: renderOpts?.timeMs,
      showMissingGlyphs: renderOpts?.showMissingGlyphs,
    }).ir;
    deliverDetachedIrWarnings(ir, renderOpts?.onWarning);
    return ir;
  }

  /**
   * Read every animated node's resolved opacity and transform at a time.
   *
   * Additive read API for inspectors and downstream editors. It does not
   * render: use it to show what a scrubbed frame resolves to, alongside the
   * static render at the same `timeMs`.
   *
   * Only nodes with a node-level `animate` track appear. Text unit tracks
   * resolve per paint unit, so they have no single value to report here.
   */
  sampleAnimationState(input: EngineInput, timeMs: number): AnimationStateSample[] {
    this.ensureNotDisposed();
    assertValidAnimationRenderOptions({ timeMs });
    const vnode = this.resolveInput(input);
    validate(vnode);
    // Compile without sampling so the raw animation track survives; the
    // export samples it itself.
    const { ir } = this.compileSourceWithWasmBackend(vnode, undefined, {
      sampleAnimation: false,
    });
    const sampleFn = this.requireWasmBackendFn(
      this.options.sampleAnimationStateFn,
      "sampleAnimationStateFn",
    );
    let json: string;
    try {
      json = sampleFn(serializeIrForWasm(ir), timeMs);
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    return decodeAnimationStateSamples(json).map((sample) => ({
      nodeId: sample.nodeId,
      opacity: sample.opacity ?? null,
      transform: sample.transform ?? null,
    }));
  }

  /** Create an immutable, unsampled scene artifact owned by this Engine for repeated emission. */
  compile(input: EngineInput, compileOpts?: CompileOptions): CompiledScene {
    assertOwnOptionKeys(compileOpts, new Set(COMPILE_OPTION_KEYS), "compile");
    this.ensureNotDisposed();
    const vnode = this.resolveInput(input);

    if (!compileOpts?.skipValidation) {
      validate(vnode);
    }

    const compiledSource = this.compileSourceWithWasmBackend(vnode, compileOpts);
    return createCompiledScene(
      this.compiledSceneOwnerToken,
      compiledSource.ir,
      compiledSource.textPathMode,
    );
  }

  /**
   * Return a detached, editable inspection copy of a compiled scene's IR.
   *
   * Mutating the returned graph or its warnings cannot affect the artifact.
   */
  snapshotCompiledIR(compiled: CompiledScene): IR {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    return snapshotCompiledSceneRecordIR(compiledRecord);
  }

  /**
   * Compile exactly two compatible full-layout states into one ordinary
   * `CompiledScene`. The accepted timeline is four checkpoints with the state
   * sequence `[first, second, second, first]`.
   *
   * `skipValidation` skips only the TypeScript VNode validator. Schedule and
   * semantic-ID checks, plus the authoritative Rust compatibility checks,
   * always run. Animation sampling is fixed by the operation and is not a
   * caller option.
   */
  compileLayoutTransition(
    input: LayoutTransitionInput,
    compileOpts?: CompileOptions,
  ): CompiledScene {
    assertOwnOptionKeys(compileOpts, new Set(COMPILE_OPTION_KEYS), "compileLayoutTransition");
    this.ensureNotDisposed();
    const resolvedTransition = resolveLayoutTransitionInput(input);
    const referenceVNode = this.resolveInput(resolvedTransition.referenceInput);
    const targetVNode = this.resolveInput(resolvedTransition.targetInput);
    assertLayoutTransitionSemanticIds(referenceVNode);
    assertLayoutTransitionSemanticIds(targetVNode);

    if (!compileOpts?.skipValidation) {
      validate(referenceVNode);
      validate(targetVNode);
    }

    const compileLayoutTransitionFn = this.requireWasmBackendFn(
      this.options.compileLayoutTransitionFn,
      "compileLayoutTransitionFn",
    );
    let envelopeJson: string;
    try {
      envelopeJson = compileLayoutTransitionFn(
        this.buildWasmTransportJson(referenceVNode),
        this.buildWasmTransportJson(targetVNode),
        JSON.stringify(resolvedTransition.wirePlan),
        JSON.stringify({ textPathMode: compileOpts?.textPathMode }),
      );
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    const envelope = decodeRenderToIrEnvelope(envelopeJson);
    const ir = rehydrateWasmIr(envelope.ir, envelope.warnings);
    const textNodeIds = collectIrTextNodeIds(ir.root);
    this.assertWasmTextContracts(referenceVNode, textNodeIds);
    this.assertWasmTextContracts(targetVNode, textNodeIds);
    return createCompiledScene(
      this.compiledSceneOwnerToken,
      ir,
      compileOpts?.textPathMode ?? DEFAULT_TEXT_PATH_MODE,
    );
  }

  /**
   * Render one scene at explicit deterministic times while amortizing layout,
   * shaping, outline resolution, and IR parsing across every frame.
   *
   * The returned iterator is single-use and owns its native prepared scene.
   * Normal completion, `return()`, `throw()`, render failure, and Engine
   * disposal all release that state.
   */
  renderFrames(input: EngineInput, options: RenderFramesOptions): Iterable<Frame> {
    assertFrameOptionKeys(options, "renderFrames", false);
    return this.renderFramesFromInput(input, options as LegacyRenderFramesOptions);
  }

  /**
   * Render deterministic frames from an already compiled scene.
   *
   * The artifact's private immutable IR is prepared when this method is
   * called. The returned iterator is single-use and shares the prepared-scene
   * cleanup guarantees of `renderFrames`.
   */
  renderCompiledFrames(
    compiled: CompiledScene,
    options: RenderCompiledFramesOptions,
  ): Iterable<Frame> {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertFrameOptionKeys(options, "renderCompiledFrames", true);
    return this.renderFramesWithCompiledRecord(
      compiledRecord,
      options as LegacyRenderFramesOptions,
    );
  }

  /** Prepare standalone frames from an authenticated compiled scene. */
  private renderFramesWithCompiledRecord(
    compiledRecord: CompiledSceneRecord,
    options: LegacyRenderFramesOptions,
  ): Iterable<Frame> {
    this.prunePreparedFrameScenes();
    const plan = this.createFrameRenderPlan(options);
    if (plan.rasterPlan !== undefined) {
      this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    }
    return this.renderFramesFromCompiledRecord(compiledRecord, plan, {
      detachCompiledWarnings: true,
    });
  }

  /** Compile and prepare standalone SVG or PNG frames. */
  private renderFramesFromInput(
    input: EngineInput,
    options: LegacyRenderFramesOptions,
  ): Iterable<Frame> {
    this.ensureNotDisposed();
    this.prunePreparedFrameScenes();
    const plan = this.createFrameRenderPlan(options);
    const vnode = this.resolveInput(
      input,
      plan.rasterPlan === undefined ? undefined : assertRasterCanvasInput,
    );
    if (plan.rasterPlan !== undefined) {
      this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    }
    const compiled = this.compile(vnode, {
      skipValidation: plan.stableOptions.skipValidation,
      textPathMode: plan.stableOptions.textPathMode,
    });
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    return this.renderFramesFromCompiledRecord(compiledRecord, plan, {
      detachCompiledWarnings: false,
    });
  }

  private createFrameRenderPlan(options: LegacyRenderFramesOptions): FrameRenderPlan {
    const stableOptions = snapshotRenderOptions(options);
    const timesMs = validateFrameSchedule(stableOptions);
    const format = stableOptions.format;
    const frameEncoder = this.createFrameEncoder(format);
    const requestedScale = stableOptions.scale ?? 1;
    const rasterOutput = format === "png";
    if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
      const code = rasterOutput ? "PNG_INVALID_SCALE" : "SVG_INVALID_SCALE";
      throw new FatalError(
        code,
        `Invalid ${rasterOutput ? "PNG" : "SVG"} scale factor: ${formatUnknownDiagnosticValue(requestedScale, "unprintable value")}`,
        { stage: "emit" },
      );
    }

    const rasterPlan =
      format === "png"
        ? {
            requestedScale,
            behavior: stableOptions.rasterOversizeBehavior ?? "auto-adjust",
            emitOpts: stableOptions,
            deferredWarnings: [] as readonly RecoverableError[],
          }
        : undefined;
    const pngOptions: PngRenderOptions = {
      oversizeBehavior: stableOptions.rasterOversizeBehavior === "error" ? "error" : "autoAdjust",
      ...(stableOptions.rasterBackground && { background: stableOptions.rasterBackground }),
      ...(this.options.fontFamilies !== undefined
        ? { fontFamilies: { ...this.options.fontFamilies } }
        : {}),
      ...(format === "png" && stableOptions.generator !== undefined
        ? { generator: { ...stableOptions.generator } }
        : {}),
    };

    return { stableOptions, timesMs, format, frameEncoder, rasterPlan, pngOptions };
  }

  private renderFramesFromCompiledRecord(
    compiledRecord: CompiledSceneRecord,
    plan: FrameRenderPlan,
    warningOptions: { detachCompiledWarnings: boolean },
  ): Iterable<Frame> {
    const { renderFrame, release } = this.createPreparedFrameRenderer(
      compiledRecord,
      plan,
      warningOptions,
    );
    const iterator = new PreparedFrameIterator(plan.timesMs, renderFrame, release);
    if (plan.timesMs.length === 0) {
      release();
    }
    return iterator;
  }

  /** Retain and finalize one scene with the shared warning, outline and raster-scale ordering. */
  private prepareFrameEmission(
    compiledRecord: CompiledSceneRecord,
    plan: PreparedFrameEmissionPlan,
    warningOptions: { detachCompiledWarnings: boolean },
  ): PreparedFrameScene & {
    renderOptions: Omit<AnimationRenderOptions, "animation">;
    release(): void;
  } {
    const { stableOptions, format, rasterPlan } = plan;
    const irMetadataSnapshot: IR = {
      ...compiledRecord.ir,
      warnings: warningOptions.detachCompiledWarnings
        ? compiledRecord.ir.warnings.map(cloneRecoverableError)
        : [...compiledRecord.ir.warnings],
    };
    assertRenderableCanvas(irMetadataSnapshot);
    const irSnapshotJson = serializeIrForWasm(irMetadataSnapshot);

    const { prepared, rasterScene } = this.prepareFrameScene({
      irSnapshotJson,
      textPathMode: compiledRecord.textPathMode,
      options: stableOptions,
      raster: rasterPlan !== undefined,
    });
    const preparedReference = new WeakRef(prepared);
    this.preparedFrameScenes.add(preparedReference);

    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      this.preparedFrameScenes.delete(preparedReference);
      prepared.dispose();
    };

    let appliedScale: number | undefined;
    try {
      appliedScale = this.finalizePreparedFrameScene({
        ir: irMetadataSnapshot,
        options: stableOptions,
        rasterPlan,
        rasterScene,
      });
      this.ensureNotDisposed();
    } catch (error) {
      release();
      throw error;
    }

    const sanitizedResourceIdPrefix =
      format !== "svg" || stableOptions.resourceIdPrefix === undefined
        ? undefined
        : toCssSafeResourceId(stableOptions.resourceIdPrefix);
    const debug = stableOptions.debug ?? irMetadataSnapshot.debug;

    return {
      prepared,
      rasterScene,
      release,
      renderOptions: {
        scale: appliedScale,
        debug,
        resourceIdPrefix: sanitizedResourceIdPrefix,
        nodeIdMetadata: format === "svg" ? stableOptions.nodeIdMetadata : undefined,
        rasterizerCompat: format === "png" ? true : undefined,
        generator: format === "svg" ? stableOptions.generator : undefined,
      },
    };
  }

  /** Connect one genuine raster scene to the native encoder without returning frame SVGs. */
  private createPreparedAnimationRenderer(
    compiledRecord: CompiledSceneRecord,
    plan: PreparedFrameEmissionPlan,
    warningOptions: { detachCompiledWarnings: boolean },
  ): {
    pushFrame(session: AnimatedRasterSessionHandle, timeMs: number, durationMs: number): void;
    release(): void;
    renderOptions: AnimationRenderOptions;
  } {
    const emission = this.prepareFrameEmission(compiledRecord, plan, warningOptions);
    const scene = emission.rasterScene;
    if (!(scene instanceof WasmRasterSceneHandle)) {
      emission.release();
      throw new FatalError(
        "RASTER_SCENE_UNAVAILABLE",
        "Animated raster rendering requires a managed raster scene",
        { stage: "engine" },
      );
    }
    const renderOptions: AnimationRenderOptions = { animation: "static" };
    // Optional undefined values are absent on the wire; omit them before the once-per-session snapshot.
    if (emission.renderOptions.scale !== undefined) {
      renderOptions.scale = emission.renderOptions.scale;
    }
    if (emission.renderOptions.debug !== undefined) {
      renderOptions.debug = emission.renderOptions.debug;
    }
    if (emission.renderOptions.resourceIdPrefix !== undefined) {
      renderOptions.resourceIdPrefix = emission.renderOptions.resourceIdPrefix;
    }
    if (emission.renderOptions.nodeIdMetadata !== undefined) {
      renderOptions.nodeIdMetadata = emission.renderOptions.nodeIdMetadata;
    }
    if (emission.renderOptions.rasterizerCompat !== undefined) {
      renderOptions.rasterizerCompat = emission.renderOptions.rasterizerCompat;
    }
    if (emission.renderOptions.generator !== undefined) {
      renderOptions.generator = emission.renderOptions.generator;
    }
    return {
      release: emission.release,
      renderOptions,
      pushFrame: (session, timeMs, durationMs) => {
        this.ensureNotDisposed();
        session.push(scene, timeMs, durationMs);
      },
    };
  }

  /** Prepare the standalone SVG/PNG frame renderer without materializing sample times. */
  private createPreparedFrameRenderer(
    compiledRecord: CompiledSceneRecord,
    plan: Omit<FrameRenderPlan, "timesMs">,
    warningOptions: { detachCompiledWarnings: boolean },
  ): { renderFrame(index: number, timeMs: number): Frame; release(): void } {
    const { frameEncoder, pngOptions } = plan;
    const emission = this.prepareFrameEmission(compiledRecord, plan, warningOptions);
    const renderFrame = (index: number, timeMs: number): Frame => {
      this.ensureNotDisposed();
      let svg: string;
      try {
        svg = emission.prepared.renderToSvg(
          JSON.stringify({ ...emission.renderOptions, animation: "static", timeMs }),
        );
      } catch (error) {
        throw wrapWasmRenderError(error);
      }
      if (frameEncoder.format === "svg") {
        return { index, timeMs, format: "svg", data: svg };
      }
      return { index, timeMs, format: "png", data: frameEncoder.rasterize(svg, pngOptions) };
    };
    return { renderFrame, release: emission.release };
  }

  private prepareFrameScene(args: {
    irSnapshotJson: string;
    textPathMode: TextPathMode;
    options: Pick<InternalRenderOptions, "showMissingGlyphs">;
    raster: boolean;
  }): PreparedFrameScene {
    const { irSnapshotJson, textPathMode, options, raster } = args;
    const outlineOptionsJson = JSON.stringify({
      textPathMode,
      showMissingGlyphs: options.showMissingGlyphs,
      preserveResolvedUnitOutlines: !options.showMissingGlyphs,
    });
    if (raster) {
      const rasterScene = this.preflightRasterScene(irSnapshotJson, outlineOptionsJson);
      return { prepared: rasterScene, rasterScene };
    }

    const prepareSceneFn = this.requireWasmBackendFn(this.options.prepareSceneFn, "prepareSceneFn");
    try {
      return { prepared: prepareSceneFn(irSnapshotJson, outlineOptionsJson) };
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
  }

  private finalizePreparedFrameScene(args: {
    ir: IR;
    options: Pick<InternalRenderOptions, "onWarning" | "scale">;
    rasterPlan: AnimationRasterPlan | undefined;
    rasterScene: RasterSceneRenderHandle | undefined;
  }): number | undefined {
    const { ir, options, rasterPlan, rasterScene } = args;
    deliverIrWarnings(ir, options.onWarning);
    for (const warning of rasterPlan?.deferredWarnings ?? []) {
      appendOperationWarning(ir, warning, options.onWarning);
    }
    if (!rasterPlan) {
      return options.scale;
    }

    const scaleResolution = resolveRasterScale({
      width: ir.width,
      height: ir.height,
      requestedScale: rasterPlan.requestedScale,
    });
    this.handleResolvedPngScale({
      ir,
      scaleResolution,
      behavior: rasterPlan.behavior,
      emitOpts: rasterPlan.emitOpts,
    });
    if (!rasterScene) {
      throw new FatalError("RASTER_SCENE_UNAVAILABLE", "Raster scene was not prepared", {
        stage: "engine",
      });
    }
    try {
      rasterScene.resolve();
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    return scaleResolution.appliedScale;
  }

  private createFrameEncoder(format: RenderFramesOptions["format"]): FrameEncoder {
    if (format === "svg") {
      return { format: "svg" };
    }
    const rasterize = this.options.svgToPngFn;
    if (!rasterize) {
      throw new FatalError("PNG_NO_RASTERIZER", "svgToPngFn is required for PNG rendering", {
        stage: "emit",
      });
    }
    return { format: "png", rasterize };
  }

  private requireWasmBackendFn<TransportFn>(
    transportFn: TransportFn | undefined,
    name: string,
  ): TransportFn {
    if (!transportFn) {
      throw new FatalError(
        "WASM_BACKEND_UNAVAILABLE",
        `Rendering requires the WASM render transport ${name}. Create the engine via createEngineAsync or provide the transport function.`,
        { stage: "engine" },
      );
    }
    return transportFn;
  }

  private buildWasmTransportJson(vnode: VNode): string {
    if (this.options.fonts?.length) {
      // Inline fonts exist for custom transport backends whose WASM instance
      // holds no registered state; the WASM render pipeline resolves outlines
      // from the instance registry, so the two font sources would diverge.
      throw new FatalError(
        "WASM_BACKEND_UNAVAILABLE",
        "Rendering does not support EngineOptions.fonts (inline per-render fonts). Register fonts on the WASM instance (createEngineAsync fonts / Engine.registerFonts) instead.",
        { stage: "engine" },
      );
    }
    return buildLayoutTransportJson(vnode, {
      fonts: this.options.fonts,
      shapeRegistry: this.shapeRegistry(),
    });
  }

  /** Require every authored text node with content to survive WASM layout. */
  private assertWasmTextContracts(vnode: VNode, irTextNodeIds: ReadonlySet<string>): void {
    const visit = (node: VNode, position: NodePosition): void => {
      const { id: nodeId } = generateNodeId(node, position);
      if (node.type === "Text") {
        const fontUsage = collectTextFontAliases(node);
        if (fontUsage.hasText) {
          if (!irTextNodeIds.has(nodeId)) {
            throw new FatalError(
              "TEXT_LAYOUT_RESULT_MISSING",
              "Text layout result is missing required text data.",
              {
                stage: "text",
                nodeId,
                context: { operation: "renderTextLayout" },
              },
            );
          }
        }
        return;
      }
      if (node.type === "TextOnPath") {
        if (!irTextNodeIds.has(nodeId)) {
          throw new FatalError(
            "TEXT_PATH_LAYOUT_UNAVAILABLE",
            "Text-on-path layout is unavailable.",
            {
              stage: "text",
              nodeId,
              context: { operation: "renderTextLayout" },
            },
          );
        }
        return;
      }
      let siblingIndex = 0;
      for (const child of node.children) {
        if (typeof child !== "string") {
          visit(child, { depth: position.depth + 1, siblingIndex, parentNodeId: nodeId });
          siblingIndex += 1;
        }
      }
    };
    visit(vnode, { depth: 0, siblingIndex: 0 });
  }

  private compileSourceWithWasmBackend(
    vnode: VNode,
    compileOpts?: CompileOptions,
    animationOptions?: {
      sampleAnimation: boolean;
      timeMs?: number;
      showMissingGlyphs?: boolean;
    },
  ): CompiledSceneSource {
    const renderToIrFn = this.requireWasmBackendFn(this.options.renderToIrFn, "renderToIrFn");
    let envelopeJson: string;
    try {
      envelopeJson = renderToIrFn(
        this.buildWasmTransportJson(vnode),
        JSON.stringify({
          sampleAnimation: animationOptions?.sampleAnimation ?? false,
          timeMs: animationOptions?.timeMs,
          textPathMode: compileOpts?.textPathMode,
          showMissingGlyphs: animationOptions?.showMissingGlyphs,
        }),
      );
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    const envelope = decodeRenderToIrEnvelope(envelopeJson);
    const ir = rehydrateWasmIr(envelope.ir, envelope.warnings);
    this.assertWasmTextContracts(vnode, collectIrTextNodeIds(ir.root));
    return {
      ir,
      textPathMode: compileOpts?.textPathMode ?? DEFAULT_TEXT_PATH_MODE,
    };
  }

  private renderWithWasmBackend(
    input: EngineInput,
    renderOpts: InternalRenderOptions | undefined,
    backendOptions: SvgRenderBackendOptions<false>,
  ): { svg: string };
  private renderWithWasmBackend(
    input: EngineInput,
    renderOpts: InternalRenderOptions | undefined,
    backendOptions: SvgRenderBackendOptions<true>,
  ): { svg: string; ir: IR };
  private renderWithWasmBackend(
    input: EngineInput,
    renderOpts: InternalRenderOptions | undefined,
    backendOptions: SvgRenderBackendOptions<boolean>,
  ): { svg: string; ir?: IR } {
    this.ensureNotDisposed();
    const renderToSvgFn = this.requireWasmBackendFn(
      backendOptions.renderTransport,
      backendOptions.transportName,
    );
    // Guard TS-side: JSON transport turns non-finite numbers into null,
    // which the emitter would silently read as "no scale".
    const requestedScale = renderOpts?.scale ?? 1;
    if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
      throw new FatalError(
        "SVG_INVALID_SCALE",
        `Invalid SVG scale factor: ${formatUnknownDiagnosticValue(requestedScale, "unprintable value")}`,
        { stage: "emit" },
      );
    }
    const vnode = this.resolveInput(input);
    if (renderOpts?.playback?.mode === "timeline") {
      if (renderOpts.skipValidation) {
        assertAnimatedSvgTimelineVNodeJsonRepresentable(vnode);
      } else {
        validateAnimatedSvgTimeline(vnode);
      }
    } else if (!renderOpts?.skipValidation) {
      validate(vnode);
    }
    let envelopeJson: string;
    try {
      envelopeJson = renderToSvgFn(
        this.buildWasmTransportJson(vnode),
        toWasmRenderOptionsJson(renderOpts, {
          // renderToSvg discards the IR, so its glyph outlines never cross the
          // boundary; renderToSvgAndIR asks Rust for the resolved object it emitted.
          returnResolvedIr: backendOptions.resolveReturnedIrOutlines,
        }),
      );
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    const envelope = decodeRenderToSvgEnvelope(envelopeJson);
    this.assertWasmTextContracts(vnode, new Set(envelope.textNodeIds));
    const warnings = rehydrateWasmWarnings(envelope.warnings);
    if (!backendOptions.resolveReturnedIrOutlines) {
      deliverWarnings(warnings, renderOpts?.onWarning);
      return { svg: envelope.svg };
    }
    if (!envelope.ir) {
      throw new FatalError(
        "WASM_INVALID_SVG_OUTPUT",
        "render_to_svg omitted resolved IR requested by renderToSvgAndIR.",
        { stage: "wasm" },
      );
    }
    const ir: IR = { ...envelope.ir, warnings };
    deliverDetachedWarnings(warnings, renderOpts?.onWarning);
    return { svg: envelope.svg, ir };
  }

  /** Emit resolved IR through a callback-entry snapshot of the WASM transport. */
  private emitIrViaWasmWithTransport(
    emitTransport: EngineOptions["emitSvgFromIrFn"],
    ir: IR,
    emitOptions: LayerEmitOptions & { rasterizerCompat?: boolean },
  ): string {
    const emitSvgFromIrFn = this.requireWasmBackendFn(emitTransport, "emitSvgFromIrFn");
    // JSON transport turns non-finite numbers into null; reproduce the
    // emitter's INVALID_NUMBER guard for the scaled root dimensions here.
    const scale = emitOptions.scale ?? 1;
    for (const scaled of [ir.width * scale, ir.height * scale]) {
      if (!Number.isFinite(scaled)) {
        throw new FatalError(
          "INVALID_NUMBER",
          `Cannot emit non-finite number to SVG: ${formatUnknownDiagnosticValue(scaled, "unprintable value")}`,
          { stage: "emit" },
        );
      }
    }
    try {
      return emitSvgFromIrFn(
        serializeIrForWasm(ir),
        JSON.stringify({
          scale: emitOptions.scale,
          debug: emitOptions.debug,
          resourceIdPrefix:
            emitOptions.resourceIdPrefix === undefined
              ? undefined
              : toCssSafeResourceId(emitOptions.resourceIdPrefix),
          nodeIdMetadata: emitOptions.nodeIdMetadata,
          rasterizerCompat: emitOptions.rasterizerCompat,
          timeMs: emitOptions.timeMs,
          generator: emitOptions.generator,
        }),
      );
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
  }

  /** Resolve IR in Rust for APIs that return or inspect the resolved graph. */
  private resolveIrViaWasm(
    ir: IR,
    textPathMode: TextPathMode,
    options?: {
      showMissingGlyphs?: boolean;
      preserveResolvedUnitOutlines?: boolean;
      enforcePngOutlineGlyphLimit?: boolean;
      irSnapshotJson?: string;
    },
  ): IR {
    const resolveIrFn = this.requireWasmBackendFn(this.options.resolveIrFn, "resolveIrFn");
    let envelopeJson: string;
    try {
      envelopeJson = resolveIrFn(
        options?.irSnapshotJson ?? serializeIrForWasm(ir),
        JSON.stringify({
          textPathMode,
          showMissingGlyphs: options?.showMissingGlyphs,
          preserveResolvedUnitOutlines: options?.preserveResolvedUnitOutlines,
          enforcePngOutlineGlyphLimit: options?.enforcePngOutlineGlyphLimit,
        }),
      );
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    const envelope = decodeRenderToIrEnvelope(envelopeJson);
    const resolvedIr: IR = {
      ...envelope.ir,
      drawOrder: ir.drawOrder,
      warnings: ir.warnings,
    };
    return resolvedIr;
  }

  private preflightRasterScene(
    irSnapshotJson: string,
    optionsJson: string,
  ): RasterSceneRenderHandle {
    const preflightRasterSceneFn = this.requireWasmBackendFn(
      this.options.preflightRasterSceneFn,
      "preflightRasterSceneFn",
    );
    try {
      return preflightRasterSceneFn(irSnapshotJson, optionsJson);
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
  }

  private resolveRasterSceneIr(scene: RasterSceneRenderHandle, sourceIr: IR): IR {
    let envelopeJson: string;
    try {
      envelopeJson = scene.resolveToIr();
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    const envelope = decodeRenderToIrEnvelope(envelopeJson);
    return {
      ...envelope.ir,
      drawOrder: sourceIr.drawOrder,
      warnings: sourceIr.warnings,
    };
  }

  /** Resolve and emit in one native operation without returning full IR. */
  private resolveAndEmitIrViaWasm(
    ir: IR,
    textPathMode: TextPathMode,
    request: ResolveAndEmitSvgRequest,
  ): string {
    const { animated, emitOptions } = request;
    const resolveAndEmitSvgFromIrFn = this.requireWasmBackendFn(
      animated
        ? this.options.resolveAndEmitAnimatedSvgFromIrFn
        : this.options.resolveAndEmitSvgFromIrFn,
      animated ? "resolveAndEmitAnimatedSvgFromIrFn" : "resolveAndEmitSvgFromIrFn",
    );
    const scale = emitOptions.scale ?? 1;
    for (const scaled of [ir.width * scale, ir.height * scale]) {
      if (!Number.isFinite(scaled)) {
        throw new FatalError(
          "INVALID_NUMBER",
          `Cannot emit non-finite number to SVG: ${formatUnknownDiagnosticValue(scaled, "unprintable value")}`,
          { stage: "emit" },
        );
      }
    }
    try {
      return resolveAndEmitSvgFromIrFn(
        emitOptions.irSnapshotJson ?? serializeIrForWasm(ir),
        JSON.stringify({
          scale: emitOptions.scale,
          debug: emitOptions.debug,
          resourceIdPrefix:
            emitOptions.resourceIdPrefix === undefined
              ? undefined
              : toCssSafeResourceId(emitOptions.resourceIdPrefix),
          nodeIdMetadata: emitOptions.nodeIdMetadata,
          textPathMode,
          showMissingGlyphs: emitOptions.showMissingGlyphs,
          preserveResolvedUnitOutlines: emitOptions.preserveResolvedUnitOutlines,
          enforcePngOutlineGlyphLimit: emitOptions.enforcePngOutlineGlyphLimit,
          rasterizerCompat: emitOptions.rasterizerCompat,
          timeMs: emitOptions.timeMs,
          playback: animated ? emitOptions.playback : undefined,
          reducedMotion: animated ? emitOptions.reducedMotion : undefined,
          generator: emitOptions.generator,
        }),
      );
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
  }

  private createWasmLayerEmitter(
    emitSvgFromIrFn: EngineOptions["emitSvgFromIrFn"],
  ): (layerIr: IR, emitOptions: LayerEmitOptions) => string {
    return (layerIr, emitOptions) =>
      this.emitIrViaWasmWithTransport(emitSvgFromIrFn, layerIr, emitOptions);
  }

  private createLayeredRenderSnapshot(): LayeredRenderSnapshot {
    return {
      emitLayerSvg: this.createWasmLayerEmitter(this.options.emitSvgFromIrFn),
      validateComposition: this.options.validateLayeredSvgCompositionFn,
      fontFamilies:
        this.options.fontFamilies === undefined ? undefined : { ...this.options.fontFamilies },
    };
  }

  private renderToPngWithWasmBackend(
    input: EngineInput,
    renderOpts?: RenderPngOptions,
  ): Uint8Array {
    return this.rasterizeWithWasmBackend(input, renderOpts, () =>
      this.requireRasterEncoder(this.options.svgToPngFn, {
        code: "PNG_NO_RASTERIZER",
        message: "svgToPngFn is required for PNG rendering",
      }),
    );
  }

  private renderToWebpWithWasmBackend(
    input: EngineInput,
    renderOpts?: RenderWebpOptions,
  ): Uint8Array {
    return this.rasterizeWithWasmBackend(input, renderOpts, () =>
      this.requireRasterEncoder(this.options.svgToWebpFn, {
        code: "WEBP_NO_ENCODER",
        message: "svgToWebpFn is required for WebP rendering",
      }),
    );
  }

  private requireRasterEncoder(
    encode: ((svg: string, options?: PngRenderOptions) => Uint8Array) | undefined,
    missing: { code: string; message: string },
  ): (svg: string, options?: PngRenderOptions) => Uint8Array {
    if (!encode) {
      throw new FatalError(missing.code, missing.message, { stage: "emit" });
    }
    return encode;
  }

  /**
   * Shared raster path for `renderToPng` and `renderToWebp`. Only the encoder
   * differs: layout, the outline-glyph limit, and the resolution cap are the
   * same raster constraints regardless of container, so both formats report
   * them through the existing `PNG_*` codes.
   *
   * `resolveEncoder` runs after the WASM transport checks so a missing
   * transport keeps reporting `WASM_BACKEND_UNAVAILABLE` first.
   */
  private rasterizeWithWasmBackend(
    input: EngineInput,
    renderOpts: RenderPngOptions | RenderWebpOptions | undefined,
    resolveEncoder: () => (svg: string, options?: PngRenderOptions) => Uint8Array,
  ): Uint8Array {
    this.ensureNotDisposed();
    const stableRenderOpts =
      renderOpts === undefined ? undefined : snapshotRenderOptions(renderOpts);
    assertValidAnimationRenderOptions(stableRenderOpts);
    const renderToIrFn = this.requireWasmBackendFn(this.options.renderToIrFn, "renderToIrFn");
    this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    const encode = resolveEncoder();
    const requestedScale = stableRenderOpts?.scale ?? 1;
    assertPngScale(requestedScale);
    const vnode = this.resolveInput(input, assertRasterCanvasInput);
    if (!stableRenderOpts?.skipValidation) {
      validate(vnode);
    }
    // Layout once (matching the TS backend's single compile); the emit at
    // the applied scale reuses this IR so callback-driven registry changes
    // cannot re-layout the scene between the two steps.
    let irEnvelopeJson: string;
    try {
      irEnvelopeJson = renderToIrFn(
        this.buildWasmTransportJson(vnode),
        JSON.stringify({
          sampleAnimation: false,
          textPathMode: stableRenderOpts?.textPathMode,
          showMissingGlyphs: stableRenderOpts?.showMissingGlyphs,
        }),
      );
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    const envelope = decodeRenderToIrEnvelope(irEnvelopeJson);
    const ir = rehydrateWasmIr(envelope.ir, envelope.warnings);
    this.assertWasmTextContracts(vnode, collectIrTextNodeIds(ir.root));
    assertRenderableCanvas(ir);

    const behavior = stableRenderOpts?.rasterOversizeBehavior ?? "auto-adjust";
    let scaleResolution: ResolvedRasterScale | undefined;
    let scaleError: FatalError | undefined;
    try {
      scaleResolution = resolveRasterScale({ width: ir.width, height: ir.height, requestedScale });
    } catch (error) {
      if (!(error instanceof FatalError)) {
        throw error;
      }
      scaleError = error;
    }
    const irSnapshotJson = serializeIrForWasm(ir);
    const rasterOptions: PngRenderOptions = {
      oversizeBehavior: behavior === "error" ? "error" : "autoAdjust",
    };
    if (stableRenderOpts?.rasterBackground) {
      rasterOptions.background = stableRenderOpts.rasterBackground;
    }
    if (this.options.fontFamilies) {
      rasterOptions.fontFamilies = { ...this.options.fontFamilies };
    }
    if (stableRenderOpts?.generator) {
      rasterOptions.generator = { ...stableRenderOpts.generator };
    }
    const rasterScene = this.preflightRasterScene(
      irSnapshotJson,
      toWasmRenderOptionsJson(stableRenderOpts, {
        scale: scaleResolution?.appliedScale ?? requestedScale,
        rasterizerCompat: true,
        animation: "static",
        preserveResolvedUnitOutlines: true,
        omitGenerator: true,
      }),
    );

    try {
      deliverIrWarnings(ir, stableRenderOpts?.onWarning);
      if (scaleError) {
        throw scaleError;
      }
      if (!scaleResolution) {
        throw new FatalError("RASTER_SCALE_UNRESOLVED", "Raster scale was not resolved", {
          stage: "engine",
        });
      }
      this.handleResolvedPngScale({
        ir,
        scaleResolution,
        behavior,
        emitOpts: stableRenderOpts,
      });

      let svg: string;
      try {
        svg = rasterScene.resolveAndEmitToSvg();
      } catch (error) {
        throw wrapWasmRenderError(error);
      }

      try {
        return encode(svg, rasterOptions);
      } catch (error) {
        throw wrapWasmRenderError(error);
      }
    } finally {
      rasterScene.dispose();
    }
  }

  /** Authenticate this Engine's compiled scene and emit static SVG with detached warning delivery. */
  renderCompiledToSvg(compiled: CompiledScene, emitOpts?: EmitSvgOptions): string {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertOwnOptionKeys(emitOpts, EMIT_STATIC_SVG_OPTION_KEYS, "renderCompiledToSvg");
    assertSvgEmissionOptionValues(emitOpts);
    assertValidAnimationRenderOptions(emitOpts);
    assertRenderableCanvas(compiledRecord.ir);
    const requestedScale = emitOpts?.scale ?? 1;
    if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
      throw new FatalError(
        "SVG_INVALID_SCALE",
        `Invalid SVG scale factor: ${formatUnknownDiagnosticValue(requestedScale, "unprintable value")}`,
        { stage: "emit" },
      );
    }
    deliverDetachedIrWarnings(compiledRecord.ir, emitOpts?.onWarning);
    return this.resolveAndEmitIrViaWasm(compiledRecord.ir, compiledRecord.textPathMode, {
      emitOptions: {
        scale: emitOpts?.scale,
        debug: emitOpts?.debug ?? compiledRecord.ir.debug,
        resourceIdPrefix: emitOpts?.resourceIdPrefix,
        nodeIdMetadata: emitOpts?.nodeIdMetadata,
        showMissingGlyphs: emitOpts?.showMissingGlyphs,
        preserveResolvedUnitOutlines: !emitOpts?.showMissingGlyphs,
        timeMs: emitOpts?.timeMs,
        generator: emitOpts?.generator,
      },
      animated: false,
    });
  }

  /** Authenticate this Engine's compiled scene and emit declarative SVG using the requested playback mode. */
  renderCompiledToAnimatedSvg(compiled: CompiledScene, emitOpts: EmitAnimatedSvgOptions): string {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertOwnOptionKeys(emitOpts, EMIT_ANIMATED_SVG_OPTION_KEYS, "renderCompiledToAnimatedSvg");
    assertSvgEmissionOptionValues(emitOpts);
    assertAnimatedSvgPlayback(emitOpts?.playback, emitOpts?.timeMs);
    assertValidAnimationRenderOptions(emitOpts);
    assertRenderableCanvas(compiledRecord.ir);
    if (emitOpts.playback.mode === "timeline") {
      assertAnimatedSvgTimelineIrJsonRepresentable(compiledRecord.ir);
    }
    const requestedScale = emitOpts?.scale ?? 1;
    if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
      throw new FatalError(
        "SVG_INVALID_SCALE",
        `Invalid SVG scale factor: ${formatUnknownDiagnosticValue(requestedScale, "unprintable value")}`,
        { stage: "emit" },
      );
    }
    deliverDetachedIrWarnings(compiledRecord.ir, emitOpts?.onWarning);
    return this.resolveAndEmitIrViaWasm(compiledRecord.ir, compiledRecord.textPathMode, {
      emitOptions: {
        scale: emitOpts?.scale,
        debug: emitOpts?.debug ?? compiledRecord.ir.debug,
        resourceIdPrefix: emitOpts?.resourceIdPrefix,
        nodeIdMetadata: emitOpts?.nodeIdMetadata,
        showMissingGlyphs: emitOpts?.showMissingGlyphs,
        preserveResolvedUnitOutlines: !emitOpts?.showMissingGlyphs,
        playback: emitOpts?.playback,
        timeMs: emitOpts?.timeMs,
        reducedMotion: emitOpts?.reducedMotion,
        generator: emitOpts?.generator,
      },
      animated: true,
    });
  }

  /** Authenticate a compiled scene and return resolved text outlines without changing the artifact. */
  renderCompiledToTextOutlines(
    compiled: CompiledScene,
    options?: EmitTextOutlinesOptions,
  ): TextOutlineNode[] {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertOwnOptionKeys(
      options,
      new Set(["showMissingGlyphs", "onWarning"]),
      "renderCompiledToTextOutlines",
    );
    deliverDetachedIrWarnings(compiledRecord.ir, options?.onWarning);
    const resolvedIr = this.resolveIrViaWasm(compiledRecord.ir, compiledRecord.textPathMode, {
      showMissingGlyphs: options?.showMissingGlyphs,
      preserveResolvedUnitOutlines: !options?.showMissingGlyphs,
    });
    return projectResolvedTextOutlines(resolvedIr.root);
  }

  /** Authenticate a compiled scene and rasterize PNG with a callback-safe resource snapshot. */
  renderCompiledToPng(compiled: CompiledScene, emitOpts?: EmitPngOptions): Uint8Array {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertOwnOptionKeys(emitOpts, EMIT_RASTER_OPTION_KEYS, "renderCompiledToPng");
    const stableEmitOpts = emitOpts === undefined ? undefined : snapshotRenderOptions(emitOpts);
    assertValidAnimationRenderOptions(stableEmitOpts);
    const requestedScale = stableEmitOpts?.scale ?? 1;
    assertPngScale(requestedScale);
    assertRenderableCanvas(compiledRecord.ir);
    const rasterize = this.requireRasterEncoder(this.options.svgToPngFn, {
      code: "PNG_NO_RASTERIZER",
      message: "svgToPngFn is required for PNG rendering",
    });

    this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    const behavior = stableEmitOpts?.rasterOversizeBehavior ?? "auto-adjust";
    const irMetadataSnapshot: IR = {
      ...compiledRecord.ir,
      warnings: compiledRecord.ir.warnings.map(cloneRecoverableError),
    };
    let scaleResolution: ResolvedRasterScale | undefined;
    let scaleError: FatalError | undefined;
    try {
      scaleResolution = resolveRasterScale({
        width: irMetadataSnapshot.width,
        height: irMetadataSnapshot.height,
        requestedScale,
      });
    } catch (error) {
      if (!(error instanceof FatalError)) {
        throw error;
      }
      scaleError = error;
    }
    const irSnapshotJson = serializeIrForWasm(compiledRecord.ir);
    const pngOptions: PngRenderOptions = {
      oversizeBehavior: behavior === "error" ? "error" : "autoAdjust",
    };
    if (stableEmitOpts?.rasterBackground) {
      pngOptions.background = stableEmitOpts.rasterBackground;
    }
    if (this.options.fontFamilies) {
      pngOptions.fontFamilies = { ...this.options.fontFamilies };
    }
    if (stableEmitOpts?.generator) {
      pngOptions.generator = { ...stableEmitOpts.generator };
    }
    const rasterScene = this.preflightRasterScene(
      irSnapshotJson,
      JSON.stringify({
        scale: scaleResolution?.appliedScale ?? requestedScale,
        debug: stableEmitOpts?.debug ?? irMetadataSnapshot.debug,
        textPathMode: compiledRecord.textPathMode,
        showMissingGlyphs: stableEmitOpts?.showMissingGlyphs,
        preserveResolvedUnitOutlines: !stableEmitOpts?.showMissingGlyphs,
        rasterizerCompat: true,
        animation: "static",
        timeMs: stableEmitOpts?.timeMs,
      }),
    );

    try {
      deliverIrWarnings(irMetadataSnapshot, stableEmitOpts?.onWarning);
      if (scaleError) {
        throw scaleError;
      }
      if (!scaleResolution) {
        throw new FatalError("RASTER_SCALE_UNRESOLVED", "Raster scale was not resolved", {
          stage: "engine",
        });
      }
      this.handleResolvedPngScale({
        ir: irMetadataSnapshot,
        scaleResolution,
        behavior,
        emitOpts: stableEmitOpts,
      });

      let svg: string;
      try {
        svg = rasterScene.resolveAndEmitToSvg();
      } catch (error) {
        throw wrapWasmRenderError(error);
      }

      try {
        return rasterize(svg, pngOptions);
      } catch (error) {
        throw wrapWasmRenderError(error);
      }
    } finally {
      rasterScene.dispose();
    }
  }

  /** Compile once and split using metadata captured from the authoring tree. */
  private prepareLayeredSvgRender(
    input: EngineInput,
    renderOpts: LayeredSvgOptions | undefined,
    emitLayerSvg: (layerIr: IR, emitOptions: LayerEmitOptions) => string,
  ): { ir: IR; layeredResult: LayeredSvgResult } {
    const vnode = this.resolveInput(input);
    assertValidAnimationRenderOptions(renderOpts);

    if (!renderOpts?.skipValidation) {
      validate(vnode);
    }

    const compiledSource = this.compileSourceWithWasmBackend(vnode, toCompileOptions(renderOpts), {
      sampleAnimation: true,
      timeMs: renderOpts?.timeMs,
      showMissingGlyphs: renderOpts?.showMissingGlyphs,
    });
    if (renderOpts?.timeMs === undefined && hasAnimatedNode(compiledSource.ir.root)) {
      throw new FatalError(
        "STATIC_ANIMATION_TIME_REQUIRED",
        "Static SVG output requires an explicit timeMs when the scene contains animation.",
        { stage: "emit" },
      );
    }
    const irSnapshotJson = serializeIrForWasm(compiledSource.ir);
    const sourceNodeMap = snapshotLayerSourceMetadata(vnode);
    const ir = this.resolveIrViaWasm(compiledSource.ir, compiledSource.textPathMode, {
      showMissingGlyphs: renderOpts?.showMissingGlyphs,
      preserveResolvedUnitOutlines: true,
      irSnapshotJson,
    });
    deliverIrWarnings(compiledSource.ir, renderOpts?.onWarning);
    const layeredResult = renderLayeredSvg({
      ir,
      sourceNodeMap,
      options: {
        debug: renderOpts?.debug ?? ir.debug,
        resourceIdPrefix: renderOpts?.resourceIdPrefix,
        nodeIdMetadata: renderOpts?.nodeIdMetadata,
        scale: renderOpts?.scale,
        timeMs: renderOpts?.timeMs,
        generator: renderOpts?.generator,
      },
      // The composition (layer separation, manifest, atomic grouping)
      // stays in TS; only the per-layer SVG translation goes through the
      // WASM emitter.
      emitLayerSvg,
    });
    return { ir, layeredResult };
  }

  private handleResolvedPngScale(args: {
    ir: IR;
    scaleResolution: ResolvedRasterScale;
    behavior: RasterOversizeBehavior;
    emitOpts?: Pick<
      OutputCommonOptions & RasterEmissionOptions,
      "scale" | "onPngResolutionAdjusted" | "onWarning"
    >;
  }): void {
    const { ir, scaleResolution, behavior, emitOpts } = args;
    if (!scaleResolution.adjusted) {
      return;
    }

    const requestedScale = emitOpts?.scale ?? 1;
    const warning: PngResolutionAdjustedWarning = {
      requestedScale,
      appliedScale: scaleResolution.appliedScale,
      baseWidth: ir.width,
      baseHeight: ir.height,
      requestedWidth: scaleResolution.requestedWidth,
      requestedHeight: scaleResolution.requestedHeight,
      outputWidth: scaleResolution.outputWidth,
      outputHeight: scaleResolution.outputHeight,
      maxLongEdge: RASTER_MAX_LONG_EDGE,
      maxPixels: RASTER_MAX_PIXELS,
    };
    const warningMessage =
      `PNG resolution exceeded 4K-equivalent cap; auto-adjusted scale ` +
      `from ${requestedScale} to ${scaleResolution.appliedScale} ` +
      `(${scaleResolution.requestedWidth}x${scaleResolution.requestedHeight} -> ` +
      `${scaleResolution.outputWidth}x${scaleResolution.outputHeight})`;

    if (behavior === "error") {
      throw new FatalError("PNG_PIXEL_LIMIT", warningMessage, {
        stage: "emit",
        context: {
          ...warning,
        },
      });
    }
    const recoverableWarning = createInternalRecoverableError(
      "PNG_RESOLUTION_ADJUSTED",
      warningMessage,
      { fallback: "auto-adjusted scale", stage: "emit", context: { ...warning } },
    );
    emitOpts?.onPngResolutionAdjusted?.(warning);
    appendOperationWarning(ir, recoverableWarning, emitOpts?.onWarning);
  }

  private createLayeredPngRenderOptions(
    renderOpts?: LayeredPngOptions,
    fontFamilies?: PngRenderOptions["fontFamilies"],
  ): PngRenderOptions | undefined {
    const behavior = renderOpts?.rasterOversizeBehavior ?? "auto-adjust";
    const pngOptions: PngRenderOptions = {
      oversizeBehavior: behavior === "error" ? "error" : "autoAdjust",
    };
    if (fontFamilies) {
      pngOptions.fontFamilies = { ...fontFamilies };
    }
    if (renderOpts?.generator) {
      pngOptions.generator = { ...renderOpts.generator };
    }
    return pngOptions;
  }

  /** Return the hit node identifier at canvas coordinates, or null when no node is hit. */
  hitTest(ir: IR, x: number, y: number): string | null {
    return hitTest(ir, x, y);
  }

  /** Release prepared frame scenes and the WASM handle, then notify resource observers once. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      this.activeAnimation?.job?.abort();
      for (const preparedReference of this.preparedFrameScenes) {
        preparedReference.deref()?.dispose();
      }
      this.preparedFrameScenes.clear();
      this.options.wasmHandle?.dispose();
    } finally {
      this.notifyResourceChanges();
      this.resourceListeners.clear();
    }
  }

  private ensureResourceVersionAvailable(): void {
    if (this.resourceRevision === Number.MAX_SAFE_INTEGER) {
      throw new FatalError(
        "RESOURCE_VERSION_EXHAUSTED",
        "Engine resource version space has been exhausted",
        { stage: "engine", context: {} },
      );
    }
  }

  private invalidateResources(): void {
    this.resourceRevision += 1;
    this.notifyResourceChanges();
  }

  private notifyResourceChanges(): void {
    for (const listener of [...this.resourceListeners]) {
      try {
        listener();
      } catch (error: unknown) {
        // Observer failures must not replace the mutation's result or skip other observers.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  private prunePreparedFrameScenes(): void {
    for (const preparedReference of this.preparedFrameScenes) {
      if (preparedReference.deref() === undefined) {
        this.preparedFrameScenes.delete(preparedReference);
      }
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new FatalError("ENGINE_DISPOSED", "Engine has been disposed", { stage: "engine" });
    }
  }

  private resolveInput(
    input: EngineInput,
    beforeResourceResolution?: (vnode: VNode) => void,
  ): VNode {
    const vnode = resolveSceneOrVNodeInput(input);
    beforeResourceResolution?.(vnode);
    // Shape/Symbol survive layout as leaf boxes; geometry compiles at IR
    // build. Registry references still fail here, at validate timing.
    assertShapeReferencesResolvable(vnode, this.shapeRegistry());
    return vnode;
  }

  private shapeRegistry(): ShapeRegistry {
    return {
      geometries: this.geometryRegistry,
      symbols: this.symbolRegistry,
    };
  }

  private validateLayeredSvgComposition(args: {
    ir: IR;
    layeredResult: LayeredSvgResult;
    renderOpts: LayeredSvgOptions | undefined;
    renderSnapshot: LayeredRenderSnapshot;
  }): LayeredCompositionValidationResult | undefined {
    const { ir, layeredResult, renderOpts, renderSnapshot } = args;
    const validationOptions = normalizeLayeredCompositionValidationOptions(
      renderOpts?.validateComposition,
    );
    if (!validationOptions.enabled) {
      return undefined;
    }

    const validationFn = renderSnapshot.validateComposition;
    if (!validationFn) {
      const skippedResult = createSkippedCompositionValidationResult({
        width: layeredResult.width,
        height: layeredResult.height,
        thresholdPixels: validationOptions.maxDifferentPixels,
        thresholdRatio: validationOptions.maxDifferenceRatio,
      });
      appendOperationWarning(
        ir,
        createInternalRecoverableError(
          "LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE",
          "Layered composition validation is not available in this engine.",
          {
            fallback: "skipped composition validation",
            stage: "emit",
            context: {
              validationStatus: skippedResult.status,
              width: skippedResult.width,
              height: skippedResult.height,
              thresholdPixels: skippedResult.thresholdPixels,
              thresholdRatio: skippedResult.thresholdRatio,
            },
          },
        ),
        renderOpts?.onWarning,
      );
      return skippedResult;
    }

    // The single-render reference must come from the same emitter as the
    // layer SVGs, or emitter differences would read as composition failures.
    const singleSvg = renderSnapshot.emitLayerSvg(ir, {
      debug: renderOpts?.debug ?? ir.debug,
      resourceIdPrefix: renderOpts?.resourceIdPrefix,
      nodeIdMetadata: renderOpts?.nodeIdMetadata,
      scale: renderOpts?.scale,
      timeMs: renderOpts?.timeMs,
    });

    try {
      const metrics = validationFn({
        singleSvg,
        layers: layeredResult.layers.map((layer) => ({
          svg: layer.svg,
          paintOrder: layer.paintOrder,
        })),
        options: renderSnapshot.fontFamilies
          ? { fontFamilies: { ...renderSnapshot.fontFamilies } }
          : undefined,
      });
      const mismatched =
        metrics.differentPixels > validationOptions.maxDifferentPixels ||
        metrics.differenceRatio > validationOptions.maxDifferenceRatio;
      const result: LayeredCompositionValidationResult = {
        status: mismatched ? "mismatched" : "passed",
        differentPixels: metrics.differentPixels,
        differenceRatio: metrics.differenceRatio,
        thresholdPixels: validationOptions.maxDifferentPixels,
        thresholdRatio: validationOptions.maxDifferenceRatio,
        width: metrics.width,
        height: metrics.height,
      };
      if (mismatched) {
        appendOperationWarning(
          ir,
          createInternalRecoverableError(
            "LAYERED_COMPOSITION_MISMATCH",
            `Layered composition validation detected ${metrics.differentPixels} differing pixels (${metrics.differenceRatio}).`,
            {
              fallback: "returned layered SVG with mismatch warning",
              stage: "emit",
              context: {
                validationStatus: result.status,
                differentPixels: result.differentPixels,
                differenceRatio: result.differenceRatio,
                thresholdPixels: result.thresholdPixels,
                thresholdRatio: result.thresholdRatio,
                width: result.width,
                height: result.height,
              },
            },
          ),
          renderOpts?.onWarning,
        );
      }
      return result;
    } catch (error: unknown) {
      const message = formatUnknownDiagnosticValue(
        error,
        "Unknown layered composition validation failure",
      );
      const skippedResult = createSkippedCompositionValidationResult({
        width: layeredResult.width,
        height: layeredResult.height,
        thresholdPixels: validationOptions.maxDifferentPixels,
        thresholdRatio: validationOptions.maxDifferenceRatio,
      });
      appendOperationWarning(
        ir,
        createInternalRecoverableError(
          "LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE",
          `Layered composition validation could not run: ${message}`,
          {
            fallback: "skipped composition validation",
            stage: "emit",
            context: {
              validationStatus: skippedResult.status,
              width: skippedResult.width,
              height: skippedResult.height,
              thresholdPixels: skippedResult.thresholdPixels,
              thresholdRatio: skippedResult.thresholdRatio,
              reason: message,
            },
          },
        ),
        renderOpts?.onWarning,
      );
      return skippedResult;
    }
  }
}

/**
 * Create an isolated WASM-backed Engine, loading bundled WASM in Node when needed.
 * Browser callers must initialize WASM first; failed setup releases the new handle.
 */
export async function createEngineAsync(options: {
  fonts?: Array<{
    alias: string;
    weight?: number;
    style?: "normal" | "italic";
    data: Uint8Array;
  }>;
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  symbols?: Array<{ id: string; def: SymbolDefinition }>;
}): Promise<Engine> {
  const wasmIndex = await import("./wasm/index.js");
  // Typed without @types/node so this file stays environment-agnostic.
  const nodeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (!wasmIndex.isWasmInitialized() && nodeProcess?.versions?.node) {
    // Node consumers follow the quick-start and call createEngineAsync
    // directly, so resolve the bundled wasm-pkg for them here. node.js pulls
    // in node: builtins, so the specifier is hidden from browser bundlers
    // (@vite-ignore + runtime-built string); browser/worker paths initWasm()
    // via @boundsvg/browser before reaching this branch.
    const nodeModuleSpecifier = ["./node", "js"].join(".");
    const nodeInit = (await import(/* @vite-ignore */ nodeModuleSpecifier)) as {
      initNodeWasm: (initialize?: typeof wasmIndex.initWasm) => Promise<void>;
    };
    // Multi-entry bundles can contain distinct wasm/index singletons. Pass
    // the initializer owned by this entry so the loaded module reaches the
    // same singleton used below by createEngineFromInstance().
    await nodeInit.initNodeWasm(wasmIndex.initWasm);
  }
  return createEngineFromInstance(wasmIndex, options);
}

async function createEngineFromInstance(
  wasmIndex: typeof import("./wasm/index.js"),
  options: {
    fonts?: Array<{
      alias: string;
      weight?: number;
      style?: "normal" | "italic";
      data: Uint8Array;
    }>;
    geometries?: Array<{ id: string; doc: GeometryDoc }>;
    symbols?: Array<{ id: string; def: SymbolDefinition }>;
  },
): Promise<Engine> {
  const handle = wasmIndex.createWasmEngineInstance();

  try {
    const engine = new Engine({
      computeLayoutFn: handle.createComputeLayoutFn(),
      renderToIrFn: (inputJson, optionsJson) => handle.renderToIr(inputJson, optionsJson),
      compileLayoutTransitionFn: (...transportArgs) =>
        handle.compileLayoutTransition(...transportArgs),
      renderToSvgFn: (inputJson, optionsJson) => handle.renderToSvg(inputJson, optionsJson),
      renderToAnimatedSvgFn: (inputJson, optionsJson) =>
        handle.renderToAnimatedSvg(inputJson, optionsJson),
      emitSvgFromIrFn: (irJson, optionsJson) => handle.emitSvgFromIr(irJson, optionsJson),
      emitAnimatedSvgFromIrFn: (irJson, optionsJson) =>
        handle.emitAnimatedSvgFromIr(irJson, optionsJson),
      resolveIrFn: (irJson, optionsJson) => handle.resolveIr(irJson, optionsJson),
      preflightIrFn: (irJson) => handle.preflightIr(irJson),
      preflightRasterSceneFn: (irJson, optionsJson) =>
        handle.preflightRasterScene(irJson, optionsJson),
      resolveAndEmitSvgFromIrFn: (irJson, optionsJson) =>
        handle.resolveAndEmitSvgFromIr(irJson, optionsJson),
      resolveAndEmitAnimatedSvgFromIrFn: (irJson, optionsJson) =>
        handle.resolveAndEmitAnimatedSvgFromIr(irJson, optionsJson),
      sampleAnimationStateFn: (irJson, timeMs) => handle.sampleAnimationState(irJson, timeMs),
      prepareSceneFn: (irJson, optionsJson) => handle.prepareScene(irJson, optionsJson),
      registerFontFn: (font) =>
        handle.registerFont(font.data, {
          alias: font.alias,
          weight: font.weight,
          style: font.style,
        }),
      svgToPngFn: handle.createSvgToPngFn(),
      svgToWebpFn: handle.createSvgToWebpFn(),
      openAnimatedRasterSessionFn: handle.createOpenAnimatedRasterSessionFn(),
      validateLayeredSvgCompositionFn: handle.createValidateLayeredSvgCompositionFn(),
      layoutTextFlowFn: (input) => handle.layoutTextFlow(input),
      layoutTextFlowWithExclusionsFn: (input) => handle.layoutTextFlowWithExclusions(input),
      measureTextBlockFn: (input) => handle.measureTextBlock(input),
      shrinkwrapTextFn: (input) => handle.shrinkwrapText(input),
      shrinkwrapFlowFn: (input) => handle.shrinkwrapFlow(input),
      measureIntrinsicInlineSizeFn: (input) => handle.measureIntrinsicInlineSize(input),
      geometries: options.geometries,
      symbols: options.symbols,
      wasmHandle: handle,
    });
    if (options.fonts?.length) {
      engine.registerFonts(options.fonts);
    }
    return engine;
  } catch (error) {
    handle.dispose();
    throw error;
  }
}

/** Create an Engine from caller-supplied transports and resources without initializing WASM. */
export function createEngine(options: EngineOptions): Engine {
  return new Engine(options);
}

function normalizeLayeredCompositionValidationOptions(
  options?: LayeredCompositionValidationOptions,
): {
  enabled: boolean;
  maxDifferentPixels: number;
  maxDifferenceRatio: number;
} {
  return {
    enabled: options?.enabled === true,
    maxDifferentPixels: normalizeNonNegativeNumber(options?.maxDifferentPixels),
    maxDifferenceRatio: normalizeNonNegativeNumber(options?.maxDifferenceRatio),
  };
}

function stripLayerSvg(
  layer: LayeredSvgResult["layers"][number],
): Omit<LayeredSvgResult["layers"][number], "svg"> {
  const { svg: _svg, ...entry } = layer;
  return entry;
}

function findLayerSvgForPaintOrder(
  layeredResult: LayeredSvgResult,
  targetLayer: LayeredSvgResult["layers"][number],
): string {
  const rasterizedLayer = layeredResult.layers.find((layer) => {
    return layer.paintOrder === targetLayer.paintOrder && layer.id === targetLayer.id;
  });
  return rasterizedLayer?.svg ?? targetLayer.svg;
}

function normalizeNonNegativeNumber(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function createSkippedCompositionValidationResult(params: {
  width: number;
  height: number;
  thresholdPixels: number;
  thresholdRatio: number;
}): LayeredCompositionValidationResult {
  return {
    status: "skipped",
    differentPixels: 0,
    differenceRatio: 0,
    thresholdPixels: params.thresholdPixels,
    thresholdRatio: params.thresholdRatio,
    width: params.width,
    height: params.height,
  };
}
