import {
  type AnimationScheduleErrorCodes,
  type AnimationScheduleOptions,
  assertAnimationIterations,
  GIF_DELAY_UNIT_MS,
  GIF_MIN_FRAME_MS,
  MAX_ANIMATED_GIF_ITERATIONS,
  MAX_ANIMATED_WEBP_ITERATIONS,
  type ResolvedAnimationSchedule,
  resolveAnimationFrameSchedule,
  resolveGifDelaysCs,
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
  RecoverableError,
  type StructuredError,
} from "./errors.js";
import { GENERIC_FONT_FAMILIES } from "./font/generic-families.js";
import { DEFAULT_FONT_WEIGHT } from "./font/types.js";
import { hitTest } from "./ir/hit-test.js";
import type { NodePosition } from "./ir/internal.js";
import { generateNodeId } from "./ir/node-id.js";
import type { IR, IRNode } from "./ir/types.js";
import type {
  LayeredCompositionValidationOptions,
  LayeredCompositionValidationResult,
  LayeredPngResult,
  LayeredSvgResult,
} from "./layered-svg.js";
import {
  hasAnimatedNode,
  type LayerEmitOptions,
  renderLayeredSvg,
  snapshotLayerSourceMetadata,
} from "./layered-svg.js";
import type { ComputeLayoutTransportFn } from "./layout/backend.js";
import { buildLayoutTransportJson, computeLayout } from "./layout/taffy-layout-adapter.js";
import type { LayoutNode, LayoutResult } from "./layout/types.js";
import { type LayoutTransitionInput, resolveLayoutTransitionInput } from "./layout-transition.js";
import { assertLayoutTransitionSemanticIds } from "./layout-transition-semantic-ids.js";
import {
  MAX_ANIMATION_SVG_PAYLOAD_CHARS,
  RASTER_MAX_LONG_EDGE,
  RASTER_MAX_PIXELS,
  type ResolvedRasterScale,
  resolveRasterScale,
} from "./render-capabilities.js";
import { fromSceneDocument } from "./scene/from-vnode.js";
import { assertSerializableSceneTransport } from "./scene/serializable-transport.js";
import type { SceneNode } from "./scene/types.js";
import { isSceneNode } from "./scene/types.js";
import { assertShapeReferencesResolvable, type ShapeRegistry } from "./shape/expand.js";
import type { CompiledShapePathPart, GeometryDoc, SymbolDefinition } from "./shape/types.js";
import { toCssSafeResourceId } from "./svg/resource-id.js";
import type { DebugOverlayConfig } from "./svg/types.js";
import { formatNumber } from "./svg/utils.js";
import { collectTextFontAliases } from "./text/inline-runs.js";
import { projectResolvedTextOutlines } from "./text/outline-projection.js";
import { assertRichTextNodeDepth } from "./text/rich-text-limits.js";
import type { RichTextNode, TextOutlineNode, TextPathMode } from "./text/types.js";
import { validate, validateAnimatedSvgTimeline } from "./validate/index.js";
import type { AnimationSpec, VNode } from "./vnode/types.js";
import type {
  AnimationEncodeInput,
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
import {
  decodeAnimationStateSamples,
  decodeRenderToIrEnvelope,
  decodeRenderToSvgEnvelope,
} from "./wasm/protocol-decoders.js";
import type { WasmIrOutput } from "./wasm/types.js";

export type { CompiledScene } from "./compiled-scene.js";

/** Engine input: either a VNode tree or a typed SceneNode tree */
export type EngineInput = VNode | SceneNode;

/**
 * How much longer than requested an animated GIF may play before it is worth
 * reporting. GIF's 10 ms quantum makes a small overshoot unavoidable for most
 * durations; 5% is past what the quantum alone can cause at a rate GIF can
 * represent.
 */
const GIF_TIMING_TOLERANCE = 0.05;
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
        `Compiled scene has an invalid canvas ${name}: ${String(value)}`,
        { stage: "emit" },
      );
    }
  }
}

function sceneNodeRasterDimensions(
  input: SceneNode,
): { width: unknown; height: unknown } | undefined {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    // Let the serializability guard turn failed descriptor inspection into its
    // structured engine-stage error instead of leaking an object trap error.
    return undefined;
  }
  const widthDescriptor = descriptors.width;
  const heightDescriptor = descriptors.height;
  if (
    (widthDescriptor !== undefined && !("value" in widthDescriptor)) ||
    (heightDescriptor !== undefined && !("value" in heightDescriptor))
  ) {
    // Accessors are not SceneNode transport data. Do not execute them here;
    // resolveInput() reports SCENE_NOT_SERIALIZABLE from the existing guard.
    return undefined;
  }
  return {
    width: widthDescriptor?.value,
    height: heightDescriptor?.value,
  };
}

function vnodeRasterDimensions(input: VNode): { width: unknown; height: unknown } {
  return {
    width: Reflect.get(input.props, "width"),
    height: Reflect.get(input.props, "height"),
  };
}

function assertRasterCanvasInput(input: EngineInput): void {
  const dimensions = isSceneNode(input)
    ? sceneNodeRasterDimensions(input)
    : vnodeRasterDimensions(input);
  if (dimensions === undefined) {
    return;
  }
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
        `Compiled scene has an invalid canvas ${name}: ${String(value)}`,
        { stage: "emit" },
      );
    }
  }
}

function assertPngScale(requestedScale: number): void {
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
    throw new FatalError(
      "PNG_INVALID_SCALE",
      `Invalid PNG scale factor: ${String(requestedScale)}`,
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
      `Invalid reducedMotion mode: ${String(options.reducedMotion)}`,
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
      `Invalid animation render mode: ${String(options.animation)}`,
      { stage: "emit" },
    );
  }
  if (options?.timeMs !== undefined && (!Number.isFinite(options.timeMs) || options.timeMs < 0)) {
    throw new FatalError(
      "ANIMATION_INVALID_TIME",
      `Animation timeMs must be a non-negative finite number, got ${String(options.timeMs)}`,
      { stage: "emit" },
    );
  }
}

const COMPILE_OPTION_KEYS = ["skipValidation", "textPathMode"] as const;
const OUTPUT_COMMON_OPTION_KEYS = [
  "scale",
  "debug",
  "onWarning",
  "showMissingGlyphs",
  "generator",
] as const;
const SVG_EMISSION_OPTION_KEYS = ["resourceIdPrefix", "nodeIdMetadata"] as const;
const RASTER_EMISSION_OPTION_KEYS = [
  "rasterBackground",
  "rasterOversizeBehavior",
  "onPngResolutionAdjusted",
] as const;
const STATIC_SVG_OPTION_KEYS = new Set<string>([
  ...COMPILE_OPTION_KEYS,
  ...OUTPUT_COMMON_OPTION_KEYS,
  ...SVG_EMISSION_OPTION_KEYS,
  "timeMs",
]);
const ANIMATED_SVG_OPTION_KEYS = new Set<string>([
  ...STATIC_SVG_OPTION_KEYS,
  "playback",
  "reducedMotion",
]);
const EMIT_STATIC_SVG_OPTION_KEYS = new Set<string>(
  [...STATIC_SVG_OPTION_KEYS].filter((key) => !COMPILE_OPTION_KEYS.includes(key as never)),
);
const EMIT_ANIMATED_SVG_OPTION_KEYS = new Set<string>([
  ...EMIT_STATIC_SVG_OPTION_KEYS,
  "playback",
  "reducedMotion",
]);
const RASTER_OPTION_KEYS = new Set<string>([
  ...COMPILE_OPTION_KEYS,
  ...OUTPUT_COMMON_OPTION_KEYS,
  ...RASTER_EMISSION_OPTION_KEYS,
  "timeMs",
]);
const EMIT_RASTER_OPTION_KEYS = new Set<string>(
  [...RASTER_OPTION_KEYS].filter((key) => !COMPILE_OPTION_KEYS.includes(key as never)),
);
const ANIMATION_SCHEDULE_OPTION_KEYS = [
  "timesMs",
  "frameDurationsMs",
  "fps",
  "durationMs",
] as const;
const ANIMATED_RASTER_OPTION_KEYS = new Set<string>([
  ...RASTER_OPTION_KEYS,
  ...ANIMATION_SCHEDULE_OPTION_KEYS,
  "iterations",
]);
const COMPILED_ANIMATED_RASTER_OPTION_KEYS = new Set<string>(
  [...ANIMATED_RASTER_OPTION_KEYS].filter((key) => !COMPILE_OPTION_KEYS.includes(key as never)),
);
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
      `nodeIdMetadata must be "include" or "omit", got ${String(options.nodeIdMetadata)}.`,
      { stage: "validate" },
    );
  }
}

const MAX_TIMELINE_DURATION_MS = 2 ** 32;
const MAX_TIMELINE_ITERATIONS = 2 ** 20;
const MAX_TIMELINE_TIME_MS = 2 ** 52;
const MAX_TIMELINE_TIME_RATIO = 2 ** 31;

function timelineReceived(container: object, field: string): string {
  if (!Object.hasOwn(container, field)) {
    return "missing";
  }
  const value = Reflect.get(container, field);
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function invalidAnimatedSvgTimeline(field: string, received: string): FatalError {
  return new FatalError(
    "ANIMATED_SVG_INVALID_TIMELINE",
    `Animated SVG timeline ${field} is outside the supported range.`,
    { stage: "validate", field, received },
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
        kind: "time-ratio",
        timeMs: elapsedMs,
        durationMs,
        limitRatio: MAX_TIMELINE_TIME_RATIO,
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
      `Frame format must be "svg" or "png", got ${String(options?.format)}`,
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
        `Animation timeMs must be a non-negative finite number, got ${String(timeMs)}`,
        { stage: "emit" },
      );
    }
  }
  return timesMs;
}

/** Rebuild RecoverableError instances from the structured wire warnings. */
function rehydrateWasmWarnings(warnings: StructuredError[]): RecoverableError[] {
  return warnings.map(
    (warning) =>
      new RecoverableError(warning.code, warning.message, {
        fallback: warning.fallback ?? "",
        context: {
          ...(warning.stage !== undefined && { stage: warning.stage }),
          ...(warning.nodeId !== undefined && { nodeId: warning.nodeId }),
        },
      }),
  );
}

/** Promote a validated wire IR to the public IR warning contract. */
function rehydrateWasmIr(ir: WasmIrOutput, warnings: StructuredError[]): IR {
  return {
    ...ir,
    warnings: rehydrateWasmWarnings(warnings),
  };
}

/**
 * Rebuild a FatalError from a WASM render export failure. The exports throw
 * a structured JSON envelope (code / message / stage / nodeId); anything
 * else becomes a generic engine-stage failure.
 */
function wrapWasmRenderError(error: unknown): FatalError {
  if (error instanceof FatalError) {
    return error;
  }
  const text =
    typeof error === "string" ? error : String((error as { message?: unknown })?.message ?? error);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const code = Reflect.get(parsed, "code");
      const message = Reflect.get(parsed, "message");
      const stage = Reflect.get(parsed, "stage");
      const nodeId = Reflect.get(parsed, "nodeId");
      const context = Reflect.get(parsed, "context");
      if (typeof code === "string" && typeof message === "string") {
        const errorContext: Record<string, unknown> =
          typeof context === "object" && context !== null && !Array.isArray(context)
            ? { ...(context as Record<string, unknown>) }
            : {};
        if (typeof stage === "string") {
          errorContext.stage = stage;
        }
        if (typeof nodeId === "string") {
          errorContext.nodeId = nodeId;
        }
        return new FatalError(code, message, {
          ...errorContext,
        });
      }
    }
  } catch {
    // Not a structured envelope — fall through to the generic wrapper.
  }
  return new FatalError("WASM_RENDER_FAILED", text, { stage: "engine" });
}

export type RasterOversizeBehavior = "auto-adjust" | "error";

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

export type EngineOptions = {
  /** WASM compute_layout function */
  computeLayoutFn: ComputeLayoutTransportFn;
  /** WASM svg_to_png function (optional, may accept PngRenderOptions) */
  svgToPngFn?: (svg: string, options?: PngRenderOptions) => Uint8Array;
  /** WASM svg_to_webp function (optional; absent on runtimes without the export) */
  svgToWebpFn?: (svg: string, options?: PngRenderOptions) => Uint8Array;
  /** WASM svgs_to_animated_webp function (optional; absent on runtimes without the export) */
  svgsToAnimatedWebpFn?: (input: AnimationEncodeInput) => Uint8Array;
  /** WASM svgs_to_animated_gif function (optional; absent on runtimes without the export) */
  svgsToAnimatedGifFn?: (input: AnimationEncodeInput) => Uint8Array;
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

export type OutputCommonOptions = {
  scale?: number;
  debug?: boolean | DebugOverlayConfig;
  onWarning?: (warning: RecoverableError) => void;
  /** Render synthetic tofu rectangles for missing glyphs (glyph_id=0). Default: false. */
  showMissingGlyphs?: boolean;
  /** Unsigned public generator identity. Do not put user or request identifiers here. */
  generator?: OutputGenerator;
};

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

export type RasterEmissionOptions = {
  rasterBackground?: string;
  rasterOversizeBehavior?: RasterOversizeBehavior;
  onPngResolutionAdjusted?: (warning: PngResolutionAdjustedWarning) => void;
};

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

export type AnimatedSvgPlayback =
  | { mode: "independent" }
  | ({ mode: "timeline" } & AnimationTimeline);

export type RenderSvgOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & { timeMs?: number };

export type RenderAnimatedSvgOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & {
    playback: AnimatedSvgPlayback;
    timeMs?: number;
    reducedMotion?: ReducedMotionMode;
  };

export type EmitSvgOptions = OutputCommonOptions & SvgEmissionOptions & { timeMs?: number };

export type EmitAnimatedSvgOptions = OutputCommonOptions &
  SvgEmissionOptions & {
    playback: AnimatedSvgPlayback;
    timeMs?: number;
    reducedMotion?: ReducedMotionMode;
  };

export type RenderIrOptions = CompileOptions & {
  onWarning?: (warning: RecoverableError) => void;
  showMissingGlyphs?: boolean;
  timeMs?: number;
};

export type RenderTextOutlinesOptions = CompileOptions & {
  onWarning?: (warning: RecoverableError) => void;
  showMissingGlyphs?: boolean;
};

export type EmitTextOutlinesOptions = Omit<RenderTextOutlinesOptions, keyof CompileOptions>;

export type RenderPngOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & { timeMs?: number };

export type RenderWebpOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & { timeMs?: number };

export type EmitPngOptions = OutputCommonOptions & RasterEmissionOptions & { timeMs?: number };

export type EmitWebpOptions = OutputCommonOptions & RasterEmissionOptions & { timeMs?: number };

export type LayeredSvgOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & {
    timeMs?: number;
    validateComposition?: LayeredCompositionValidationOptions;
  };

export type LayeredPngOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & {
    timeMs?: number;
    validateComposition?: LayeredCompositionValidationOptions;
  };

export type ValidateLayeredSvgCompositionInput = {
  singleSvg: string;
  layers: Array<{ svg: string; paintOrder: number }>;
  options?: Pick<PngRenderOptions, "fontFamilies">;
};

export type ValidateLayeredSvgCompositionMetrics = Pick<
  LayeredCompositionValidationResult,
  "differentPixels" | "differenceRatio" | "width" | "height"
>;

type CompiledSceneSource = Pick<CompiledSceneRecord, "ir" | "textPathMode">;

export type SvgFrame = {
  /** Zero-based position in the requested frame schedule. */
  index: number;
  /** Exact deterministic sampling time supplied by the caller. */
  timeMs: number;
  format: "svg";
  /** Static SVG with the sampled pose baked into ordinary attributes. */
  data: string;
};

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

/**
 * Error codes an animated raster format reports under. Extends the schedule
 * codes with the transport-size limit, which is not a schedule problem.
 */
type AnimationErrorCodes = AnimationScheduleErrorCodes & {
  payloadLimit: string;
};

/** Total number of animated-raster plays, or an unbounded animation. */
export type AnimatedRasterIterations = NonNullable<AnimationSpec["iterations"]>;

export type RenderAnimatedWebpOptions = Omit<RenderWebpOptions, "timeMs"> &
  AnimationScheduleOptions & {
    /** Total play count, 1..=65535, or `"infinite"`. */
    iterations: AnimatedRasterIterations;
  };

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

export type RenderSvgFramesOptions = CompileOptions &
  OutputCommonOptions &
  SvgEmissionOptions & {
    /** Non-negative finite sample times. Duplicates and non-monotonic order are preserved. */
    timesMs: readonly number[];
    format: "svg";
  };

export type RenderPngFramesOptions = CompileOptions &
  OutputCommonOptions &
  RasterEmissionOptions & {
    /** Non-negative finite sample times. Duplicates and non-monotonic order are preserved. */
    timesMs: readonly number[];
    format: "png";
  };

export type RenderFramesOptions = RenderSvgFramesOptions | RenderPngFramesOptions;

export type RenderCompiledSvgFramesOptions = Omit<RenderSvgFramesOptions, keyof CompileOptions>;

export type RenderCompiledPngFramesOptions = Omit<RenderPngFramesOptions, keyof CompileOptions>;

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

function snapshotRasterOptions<
  Options extends
    | RenderPngOptions
    | RenderWebpOptions
    | EmitPngOptions
    | EmitWebpOptions
    | LayeredPngOptions
    | LegacyRenderFramesOptions
    | RenderAnimatedWebpOptions
    | RenderAnimatedGifOptions,
>(options: Options): Options {
  const debug = options.debug;
  return {
    ...options,
    ...(typeof debug === "object" && debug !== null
      ? { debug: { ...(debug.parts !== undefined && { parts: [...debug.parts] }) } }
      : {}),
    ...(options.generator !== undefined ? { generator: { ...options.generator } } : {}),
    ...(Array.isArray(Reflect.get(options, "timesMs"))
      ? { timesMs: [...(Reflect.get(options, "timesMs") as readonly number[])] }
      : {}),
    ...(Array.isArray(Reflect.get(options, "frameDurationsMs"))
      ? {
          frameDurationsMs: [...(Reflect.get(options, "frameDurationsMs") as readonly number[])],
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

type AnimationFrameProducer = (
  options: LegacyRenderFramesOptions,
  rasterPlan: AnimationRasterPlan,
) => Iterable<Frame>;

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

type FrameRenderPlan = {
  stableOptions: LegacyRenderFramesOptions;
  timesMs: number[];
  format: LegacyRenderFramesOptions["format"];
  frameEncoder: FrameEncoder;
  rasterPlan: AnimationRasterPlan | undefined;
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

export class Engine {
  private readonly options: EngineOptions;
  private readonly compiledSceneOwnerToken: CompiledSceneOwnerToken =
    createCompiledSceneOwnerToken();
  private disposed = false;
  /**
   * Aliases of fonts registered through this engine (constructor `fonts` or
   * `registerFonts`). Empty when font state is managed outside the engine
   * (custom `computeLayoutFn` backends) — diagnostics then stay generic.
   */
  private readonly registeredFontAliases = new Set<string>();
  private readonly geometryRegistry = new Map<string, GeometryDoc>();
  private readonly shapeCompileCache = new Map<string, CompiledShapePathPart[]>();
  private readonly symbolRegistry = new Map<string, SymbolDefinition>();
  private readonly preparedFrameScenes = new Set<WeakRef<PreparedSceneRenderHandle>>();

  constructor(options: EngineOptions) {
    this.options = options;
    for (const font of options.fonts ?? []) {
      this.registeredFontAliases.add(font.alias);
    }
    for (const geometry of options.geometries ?? []) {
      this.geometryRegistry.set(geometry.id, geometry.doc);
    }
    for (const symbol of options.symbols ?? []) {
      this.symbolRegistry.set(symbol.id, symbol.def);
    }
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
    for (const font of fonts) {
      registerFontFn({
        alias: font.alias,
        weight: font.weight ?? DEFAULT_FONT_WEIGHT,
        style: font.style ?? "normal",
        data: font.data,
      });
      this.registeredFontAliases.add(font.alias);
    }
  }

  registerGeometry(id: string, doc: GeometryDoc): void {
    this.ensureNotDisposed();
    this.geometryRegistry.set(id, doc);
  }

  registerSymbol(id: string, def: SymbolDefinition): void {
    this.ensureNotDisposed();
    this.symbolRegistry.set(id, def);
  }

  unregisterGeometry(id: string): void {
    this.ensureNotDisposed();
    this.geometryRegistry.delete(id);
  }

  unregisterSymbol(id: string): void {
    this.ensureNotDisposed();
    this.symbolRegistry.delete(id);
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

  renderToLayeredSvg(input: EngineInput, renderOpts?: LayeredSvgOptions): LayeredSvgResult {
    assertOwnOptionKeys(
      renderOpts,
      new Set([...STATIC_SVG_OPTION_KEYS, "validateComposition"]),
      "renderToLayeredSvg",
    );
    assertSvgEmissionOptionValues(renderOpts);
    assertValidAnimationRenderOptions(renderOpts);
    this.ensureNotDisposed();
    const renderSnapshot = this.createLayeredRenderSnapshot();
    const { ir, layeredResult } = this.prepareLayeredSvgRender(
      input,
      renderOpts,
      renderSnapshot.emitLayerSvg,
    );

    const compositionValidation = this.validateLayeredSvgComposition({
      ir,
      layeredResult,
      renderOpts,
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

  renderToLayeredPng(input: EngineInput, renderOpts?: LayeredPngOptions): LayeredPngResult {
    assertOwnOptionKeys(
      renderOpts,
      new Set([...RASTER_OPTION_KEYS, "validateComposition"]),
      "renderToLayeredPng",
    );
    this.ensureNotDisposed();
    const stableRenderOpts =
      renderOpts === undefined ? undefined : snapshotRasterOptions(renderOpts);
    assertValidAnimationRenderOptions(stableRenderOpts);
    this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    const rasterize = this.requireRasterEncoder(this.options.svgToPngFn, {
      code: "PNG_NO_RASTERIZER",
      message: "svgToPngFn is required for PNG rendering",
    });
    const renderSnapshot = this.createLayeredRenderSnapshot();
    const requestedScale = stableRenderOpts?.scale ?? 1;
    assertPngScale(requestedScale);

    assertRasterCanvasInput(input);
    const vnode = this.resolveInput(input);
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
    const layoutRoot = computeLayout(vnode, {
      computeLayoutFn: this.options.computeLayoutFn,
      fonts: this.options.fonts,
      shapeRegistry: this.shapeRegistry(),
    });
    const sourceNodeMap = snapshotLayerSourceMetadata(layoutRoot.root);
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
      JSON.stringify({ ...compiledSource.ir, warnings: [] }),
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

  /**
   * Render a declarative animation to an animated lossless WebP.
   *
   * Frames are sampled through the same scale resolver and root-dimension
   * rounding as still/frame PNG, then encoded at raster scale 1.
   */
  renderToAnimatedWebp(input: EngineInput, renderOpts: RenderAnimatedWebpOptions): Uint8Array {
    assertOwnOptionKeys(renderOpts, ANIMATED_RASTER_OPTION_KEYS, "renderToAnimatedWebp");
    return this.renderAnimatedWebpWithFrameProducer(renderOpts, (frameOptions, rasterPlan) =>
      this.renderFramesFromInput(input, frameOptions, rasterPlan),
    );
  }

  /**
   * Render an already compiled immutable animation to animated lossless WebP.
   * Compilation choices are fixed by `compiled`; scheduling,
   * rasterization, warnings, and encoding are shared with
   * `renderToAnimatedWebp`.
   */
  renderCompiledToAnimatedWebp(
    compiled: CompiledScene,
    renderOpts: RenderCompiledAnimatedWebpOptions,
  ): Uint8Array {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertOwnOptionKeys(
      renderOpts,
      COMPILED_ANIMATED_RASTER_OPTION_KEYS,
      "renderCompiledToAnimatedWebp",
    );
    return this.renderAnimatedWebpWithFrameProducer(renderOpts, (frameOptions, rasterPlan) =>
      this.renderFramesWithCompiledRecord(compiledRecord, frameOptions, rasterPlan),
    );
  }

  private renderAnimatedWebpWithFrameProducer(
    renderOpts: RenderAnimatedWebpOptions,
    frameProducer: AnimationFrameProducer,
  ): Uint8Array {
    this.ensureNotDisposed();
    const stableRenderOpts = snapshotRasterOptions(renderOpts);
    // Reported ahead of WEBP_NO_ENCODER, matching renderToWebp's ordering.
    this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    const encodeAnimatedWebp = this.options.svgsToAnimatedWebpFn;
    if (!encodeAnimatedWebp) {
      throw new FatalError(
        "WEBP_NO_ENCODER",
        "svgsToAnimatedWebpFn is required for animated WebP rendering",
        { stage: "emit" },
      );
    }
    const requestedScale = stableRenderOpts.scale ?? 1;
    assertPngScale(requestedScale);
    const codes: AnimationErrorCodes = {
      invalidSchedule: "ANIMATED_WEBP_INVALID_SCHEDULE",
      tooManyFrames: "ANIMATED_WEBP_TOO_MANY_FRAMES",
      payloadLimit: "ANIMATED_WEBP_PAYLOAD_LIMIT",
    };
    assertAnimationIterations(stableRenderOpts.iterations, {
      maxIterations: MAX_ANIMATED_WEBP_ITERATIONS,
      code: codes.invalidSchedule,
      formatName: "Animated WebP",
    });
    const schedule = resolveAnimationFrameSchedule(stableRenderOpts, codes);

    const frames = frameProducer(
      {
        ...toAnimationFrameRenderOptions(stableRenderOpts),
        timesMs: schedule.timesMs,
        format: "svg",
      },
      {
        requestedScale,
        behavior: stableRenderOpts.rasterOversizeBehavior ?? "auto-adjust",
        emitOpts: stableRenderOpts,
        deferredWarnings: [],
      },
    );
    const encodeInput = this.buildAnimationEncodeInput(frames, stableRenderOpts, {
      schedule,
      codes,
    });
    try {
      return encodeAnimatedWebp(encodeInput);
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
  }

  /**
   * Render a declarative animation to an animated GIF.
   *
   * Same frame sampling as `renderToAnimatedWebp`; GIF quantizes each frame to
   * its own 256-color palette with 1-bit alpha, and rounds frame timing to its
   * 10 ms quantum.
   */
  renderToAnimatedGif(input: EngineInput, renderOpts: RenderAnimatedGifOptions): Uint8Array {
    assertOwnOptionKeys(renderOpts, ANIMATED_RASTER_OPTION_KEYS, "renderToAnimatedGif");
    return this.renderAnimatedGifWithFrameProducer(renderOpts, (frameOptions, rasterPlan) =>
      this.renderFramesFromInput(input, frameOptions, rasterPlan),
    );
  }

  /**
   * Render an already compiled immutable animation to animated GIF.
   * Compilation choices are fixed by `compiled`; scheduling,
   * rasterization, warnings, and encoding are shared with
   * `renderToAnimatedGif`.
   */
  renderCompiledToAnimatedGif(
    compiled: CompiledScene,
    renderOpts: RenderCompiledAnimatedGifOptions,
  ): Uint8Array {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertOwnOptionKeys(
      renderOpts,
      COMPILED_ANIMATED_RASTER_OPTION_KEYS,
      "renderCompiledToAnimatedGif",
    );
    return this.renderAnimatedGifWithFrameProducer(renderOpts, (frameOptions, rasterPlan) =>
      this.renderFramesWithCompiledRecord(compiledRecord, frameOptions, rasterPlan),
    );
  }

  private renderAnimatedGifWithFrameProducer(
    renderOpts: RenderAnimatedGifOptions,
    frameProducer: AnimationFrameProducer,
  ): Uint8Array {
    this.ensureNotDisposed();
    const stableRenderOpts = snapshotRasterOptions(renderOpts);
    // Reported ahead of GIF_NO_ENCODER, matching the other raster entry points.
    this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    const encodeAnimatedGif = this.options.svgsToAnimatedGifFn;
    if (!encodeAnimatedGif) {
      throw new FatalError(
        "GIF_NO_ENCODER",
        "svgsToAnimatedGifFn is required for animated GIF rendering",
        { stage: "emit" },
      );
    }
    const requestedScale = stableRenderOpts.scale ?? 1;
    assertPngScale(requestedScale);
    const codes: AnimationErrorCodes = {
      invalidSchedule: "ANIMATED_GIF_INVALID_SCHEDULE",
      tooManyFrames: "ANIMATED_GIF_TOO_MANY_FRAMES",
      payloadLimit: "ANIMATED_GIF_PAYLOAD_LIMIT",
    };
    assertAnimationIterations(stableRenderOpts.iterations, {
      maxIterations: MAX_ANIMATED_GIF_ITERATIONS,
      code: codes.invalidSchedule,
      formatName: "Animated GIF",
    });
    const schedule = resolveAnimationFrameSchedule(stableRenderOpts, codes);
    const timingWarning = this.createGifTimingAdjustmentWarning(schedule.frameDurationsMs, {
      sampled: stableRenderOpts.timesMs === undefined,
    });

    const frames = frameProducer(
      {
        ...toAnimationFrameRenderOptions(stableRenderOpts),
        timesMs: schedule.timesMs,
        format: "svg",
      },
      {
        requestedScale,
        behavior: stableRenderOpts.rasterOversizeBehavior ?? "auto-adjust",
        emitOpts: stableRenderOpts,
        deferredWarnings: timingWarning === undefined ? [] : [timingWarning],
      },
    );
    const encodeInput = this.buildAnimationEncodeInput(frames, stableRenderOpts, {
      schedule,
      codes,
    });
    try {
      return encodeAnimatedGif(encodeInput);
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
  }

  /**
   * GIF cannot express a frame shorter than 2 centiseconds, so a schedule with
   * short frames plays back longer than requested. Report it rather than
   * letting the animation quietly stretch.
   *
   * The trigger is the stretch itself. Keying on which frames were clamped
   * does not track distortion — anchoring a sampled schedule's last boundary
   * to `durationMs` leaves a sub-quantum tail frame for most durations — so a
   * relative threshold is both monotone in what the caller notices and short
   * to document.
   */
  private createGifTimingAdjustmentWarning(
    frameDurationsMs: readonly number[],
    { sampled }: { sampled: boolean },
  ): RecoverableError | undefined {
    const requestedMs = frameDurationsMs.reduce((sum, durationMs) => sum + durationMs, 0);
    const emittedMs = resolveGifDelaysCs(frameDurationsMs).reduce(
      (sum, delayCs) => sum + delayCs * GIF_DELAY_UNIT_MS,
      0,
    );
    if (emittedMs <= requestedMs * (1 + GIF_TIMING_TOLERANCE)) {
      return undefined;
    }
    return createInternalRecoverableError(
      "ANIMATED_GIF_TIMING_ADJUSTED",
      `GIF frame delays are limited to whole centiseconds of at least ${GIF_MIN_FRAME_MS / GIF_DELAY_UNIT_MS}; the animation plays for ${emittedMs} ms instead of ${requestedMs} ms. ${
        sampled
          ? `Raise durationMs, or lower fps, so no sampled frame falls under ${GIF_MIN_FRAME_MS} ms.`
          : `Keep every frameDurationsMs entry at ${GIF_MIN_FRAME_MS} ms or longer.`
      }`,
      { fallback: "clamped frame delays", context: { stage: "emit" } },
    );
  }

  /**
   * Sample the frames and pack them with the per-frame raster options.
   */
  private buildAnimationEncodeInput(
    sampledFrames: Iterable<Frame>,
    renderOpts: RenderAnimatedWebpOptions | RenderAnimatedGifOptions,
    plan: {
      schedule: ResolvedAnimationSchedule;
      codes: AnimationErrorCodes;
    },
  ): AnimationEncodeInput {
    const { schedule, codes } = plan;
    const rasterOptions: PngRenderOptions = {
      oversizeBehavior: renderOpts.rasterOversizeBehavior === "error" ? "error" : "autoAdjust",
    };
    if (renderOpts.rasterBackground) {
      rasterOptions.background = renderOpts.rasterBackground;
    }
    if (this.options.fontFamilies) {
      rasterOptions.fontFamilies = { ...this.options.fontFamilies };
    }
    if (renderOpts.generator) {
      rasterOptions.generator = { ...renderOpts.generator };
    }
    const frames: Array<{ svg: string; durationMs: number }> = [];
    let frameIndex = 0;
    let svgPayloadChars = 0;
    for (const frame of sampledFrames) {
      const durationMs = schedule.frameDurationsMs[frameIndex];
      if (durationMs === undefined) {
        throw new FatalError(
          codes.invalidSchedule,
          `Frame ${frameIndex} has no duration in the resolved schedule`,
          { stage: "emit" },
        );
      }
      if (frame.format !== "svg") {
        throw new FatalError(
          codes.invalidSchedule,
          `Animated raster frames must be sampled as SVG, got ${frame.format}`,
          { stage: "emit" },
        );
      }
      svgPayloadChars += frame.data.length;
      if (svgPayloadChars > MAX_ANIMATION_SVG_PAYLOAD_CHARS) {
        throw new FatalError(
          codes.payloadLimit,
          `Sampled animation frames exceed the ${MAX_ANIMATION_SVG_PAYLOAD_CHARS} character transport limit; reduce the frame count or the scene size`,
          { stage: "emit" },
        );
      }
      frames.push({ svg: frame.data, durationMs });
      frameIndex += 1;
    }

    return { frames, iterations: renderOpts.iterations, options: rasterOptions };
  }

  layoutTextFlow(input: TextFlowInput): TextFlowResult {
    this.ensureNotDisposed();
    if (!this.options.layoutTextFlowFn) {
      throw new FatalError(
        "NO_FLOW_API",
        "layoutTextFlow is not available. Engine was not created with flow layout support.",
        { stage: "engine" },
      );
    }
    this.assertMeasurementFontAliasesRegistered("layoutTextFlow", input);
    return invokeMeasurementTransport(this.options.layoutTextFlowFn, input);
  }

  layoutTextFlowWithExclusions(input: TextFlowWithExclusionsInput): TextFlowWithExclusionsResult {
    this.ensureNotDisposed();
    if (!this.options.layoutTextFlowWithExclusionsFn) {
      throw new FatalError(
        "NO_EXCLUSION_FLOW_API",
        "layoutTextFlowWithExclusions is not available.",
        { stage: "engine" },
      );
    }
    this.assertMeasurementFontAliasesRegistered("layoutTextFlowWithExclusions", input);
    return invokeMeasurementTransport(this.options.layoutTextFlowWithExclusionsFn, input);
  }

  measureTextBlock(input: MeasureTextBlockInput): MeasureTextBlockResult {
    this.ensureNotDisposed();
    if (!this.options.measureTextBlockFn) {
      throw new FatalError("NO_MEASURE_API", "measureTextBlock is not available.", {
        stage: "engine",
      });
    }
    this.assertMeasurementFontAliasesRegistered("measureTextBlock", input);
    return invokeMeasurementTransport(this.options.measureTextBlockFn, input);
  }

  shrinkwrapText(input: ShrinkwrapTextInput): ShrinkwrapTextResult {
    this.ensureNotDisposed();
    if (!this.options.shrinkwrapTextFn) {
      throw new FatalError("NO_SHRINKWRAP_API", "shrinkwrapText is not available.", {
        stage: "engine",
      });
    }
    this.assertMeasurementFontAliasesRegistered("shrinkwrapText", input);
    return invokeMeasurementTransport(this.options.shrinkwrapTextFn, input);
  }

  shrinkwrapFlow(input: ShrinkwrapFlowInput): ShrinkwrapFlowResult {
    this.ensureNotDisposed();
    if (!this.options.shrinkwrapFlowFn) {
      throw new FatalError("NO_SHRINKWRAP_FLOW_API", "shrinkwrapFlow is not available.", {
        stage: "engine",
      });
    }
    this.assertMeasurementFontAliasesRegistered("shrinkwrapFlow", input);
    return invokeMeasurementTransport(this.options.shrinkwrapFlowFn, input);
  }

  measureIntrinsicInlineSize(input: IntrinsicInlineSizeInput): IntrinsicInlineSizeResult {
    this.ensureNotDisposed();
    if (!this.options.measureIntrinsicInlineSizeFn) {
      throw new FatalError(
        "NO_INTRINSIC_INLINE_SIZE_API",
        "measureIntrinsicInlineSize is not available.",
        { stage: "engine" },
      );
    }
    this.assertMeasurementFontAliasesRegistered("measureIntrinsicInlineSize", input);
    return invokeMeasurementTransport(this.options.measureIntrinsicInlineSizeFn, input);
  }

  renderToLayoutTree(input: EngineInput, renderOpts?: LayoutRenderOptions): LayoutResult {
    assertOwnOptionKeys(renderOpts, new Set(["skipValidation"]), "renderToLayoutTree");
    this.ensureNotDisposed();
    const vnode = this.resolveInput(input);

    if (!renderOpts?.skipValidation) {
      validate(vnode);
    }
    this.assertVNodeFontAliasesRegistered(vnode);

    return computeLayout(vnode, {
      computeLayoutFn: this.options.computeLayoutFn,
      fonts: this.options.fonts,
      shapeRegistry: this.shapeRegistry(),
    });
  }

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
    deliverIrWarnings(ir, renderOpts?.onWarning);
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
      json = sampleFn(JSON.stringify(ir), timeMs);
    } catch (error) {
      throw wrapWasmRenderError(error);
    }
    return decodeAnimationStateSamples(json).map((sample) => ({
      nodeId: sample.nodeId,
      opacity: sample.opacity ?? null,
      transform: sample.transform ?? null,
    }));
  }

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
    this.assertVNodeFontAliasesRegistered(referenceVNode);
    this.assertVNodeFontAliasesRegistered(targetVNode);
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

  /** Compiled-scene frame entry plus the raster plan used by animated containers. */
  private renderFramesWithCompiledRecord(
    compiledRecord: CompiledSceneRecord,
    options: LegacyRenderFramesOptions,
    animationRasterPlan?: AnimationRasterPlan,
  ): Iterable<Frame> {
    this.prunePreparedFrameScenes();
    const plan = this.createFrameRenderPlan(options, animationRasterPlan);
    if (plan.rasterPlan !== undefined) {
      this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    }
    return this.renderFramesFromCompiledRecord(compiledRecord, plan);
  }

  /** `renderFrames` plus the raster plan used by animated containers. */
  private renderFramesFromInput(
    input: EngineInput,
    options: LegacyRenderFramesOptions,
    animationRasterPlan?: AnimationRasterPlan,
  ): Iterable<Frame> {
    this.ensureNotDisposed();
    this.prunePreparedFrameScenes();
    const plan = this.createFrameRenderPlan(options, animationRasterPlan);
    if (plan.rasterPlan !== undefined) {
      assertRasterCanvasInput(input);
      this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    }
    const compiled = this.compile(input, {
      skipValidation: plan.stableOptions.skipValidation,
      textPathMode: plan.stableOptions.textPathMode,
    });
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    return this.renderFramesFromCompiledRecord(compiledRecord, plan);
  }

  private createFrameRenderPlan(
    options: LegacyRenderFramesOptions,
    animationRasterPlan?: AnimationRasterPlan,
  ): FrameRenderPlan {
    const stableOptions = snapshotRasterOptions(options);
    const timesMs = validateFrameSchedule(stableOptions);
    const format = stableOptions.format;
    const frameEncoder = this.createFrameEncoder(format);
    const requestedScale = animationRasterPlan?.requestedScale ?? stableOptions.scale ?? 1;
    const rasterOutput = format === "png" || animationRasterPlan !== undefined;
    if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
      const code = rasterOutput ? "PNG_INVALID_SCALE" : "SVG_INVALID_SCALE";
      throw new FatalError(
        code,
        `Invalid ${rasterOutput ? "PNG" : "SVG"} scale factor: ${String(requestedScale)}`,
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
        : animationRasterPlan;
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
  ): Iterable<Frame> {
    const { stableOptions, timesMs, format, frameEncoder, rasterPlan, pngOptions } = plan;
    const irMetadataSnapshot: IR = {
      ...compiledRecord.ir,
      warnings: [...compiledRecord.ir.warnings],
    };
    assertRenderableCanvas(irMetadataSnapshot);
    const irSnapshotJson = JSON.stringify({ ...irMetadataSnapshot, warnings: [] });

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

    const renderFrame = (index: number, timeMs: number): Frame => {
      this.ensureNotDisposed();
      let svg: string;
      try {
        svg = prepared.renderToSvg(
          JSON.stringify({
            scale: appliedScale,
            debug,
            resourceIdPrefix: sanitizedResourceIdPrefix,
            nodeIdMetadata: format === "svg" ? stableOptions.nodeIdMetadata : undefined,
            rasterizerCompat: format === "png" ? true : undefined,
            animation: "static",
            timeMs,
            generator: format === "svg" ? stableOptions.generator : undefined,
          }),
        );
      } catch (error) {
        throw wrapWasmRenderError(error);
      }

      if (frameEncoder.format === "svg") {
        return { index, timeMs, format: "svg", data: svg };
      }
      return {
        index,
        timeMs,
        format: "png",
        data: frameEncoder.rasterize(svg, pngOptions),
      };
    };

    const iterator = new PreparedFrameIterator(timesMs, renderFrame, release);
    if (timesMs.length === 0) {
      release();
    }
    return iterator;
  }

  private prepareFrameScene(args: {
    irSnapshotJson: string;
    textPathMode: TextPathMode;
    options: RenderFramesOptions;
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
    options: RenderFramesOptions;
    rasterPlan: AnimationRasterPlan | undefined;
    rasterScene: RasterSceneRenderHandle | undefined;
  }): number | undefined {
    const { ir, options, rasterPlan, rasterScene } = args;
    deliverIrWarnings(ir, options.onWarning);
    for (const warning of rasterPlan?.deferredWarnings ?? []) {
      options.onWarning?.(warning);
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
              "TEXT_NO_LAYOUT",
              `Text node "${nodeId}" has content but computeLayoutFn produced no ` +
                `textLayout. Ensure computeLayoutFn returns textLayout with lines, bbox, ` +
                `and chosenFontSizePx for every text node.`,
              { stage: "text", nodeId },
            );
          }
        }
        return;
      }
      if (node.type === "TextOnPath") {
        if (!irTextNodeIds.has(nodeId)) {
          throw new FatalError(
            "TEXT_NO_LAYOUT",
            `TextOnPath node "${nodeId}" has content but computeLayoutFn produced no textLayout.`,
            { stage: "text", nodeId },
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

  /**
   * Reject unresolved authored aliases before authoritative Rust layout can
   * replace their identity with a generic shaping failure.
   */
  private assertVNodeFontAliasesRegistered(vnode: VNode): void {
    const visit = (node: VNode, position: NodePosition): void => {
      const { id: nodeId } = generateNodeId(node, position);
      if (node.type === "Text" || node.type === "TextOnPath") {
        const fontUsage = collectTextFontAliases(node);
        if (fontUsage.hasText || node.type === "TextOnPath") {
          this.assertFontAliasesRegistered(fontUsage.aliases, nodeId);
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
    this.assertVNodeFontAliasesRegistered(vnode);
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
        `Invalid SVG scale factor: ${String(requestedScale)}`,
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
    this.assertVNodeFontAliasesRegistered(vnode);
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
    deliverWarnings(warnings, renderOpts?.onWarning);
    if (!backendOptions.resolveReturnedIrOutlines) {
      return { svg: envelope.svg };
    }
    if (!envelope.ir) {
      throw new FatalError(
        "WASM_INVALID_SVG_OUTPUT",
        "render_to_svg omitted resolved IR requested by renderToSvgAndIR.",
        { stage: "wasm" },
      );
    }
    const ir = rehydrateWasmIr(envelope.ir, envelope.warnings);
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
          `Cannot emit non-finite number to SVG: ${String(scaled)}`,
          { stage: "emit" },
        );
      }
    }
    try {
      return emitSvgFromIrFn(
        // The emitter ignores warnings; class instances do not survive
        // JSON.stringify, so strip them from the transport copy.
        JSON.stringify({ ...ir, warnings: [] }),
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
        options?.irSnapshotJson ?? JSON.stringify({ ...ir, warnings: [] }),
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
    const decodedIr = rehydrateWasmIr(envelope.ir, envelope.warnings);
    const resolvedIr: IR = {
      ...decodedIr,
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
    const decodedIr = rehydrateWasmIr(envelope.ir, envelope.warnings);
    return {
      ...decodedIr,
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
          `Cannot emit non-finite number to SVG: ${String(scaled)}`,
          { stage: "emit" },
        );
      }
    }
    try {
      return resolveAndEmitSvgFromIrFn(
        emitOptions.irSnapshotJson ?? JSON.stringify({ ...ir, warnings: [] }),
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
      renderOpts === undefined ? undefined : snapshotRasterOptions(renderOpts);
    assertValidAnimationRenderOptions(stableRenderOpts);
    const renderToIrFn = this.requireWasmBackendFn(this.options.renderToIrFn, "renderToIrFn");
    this.requireWasmBackendFn(this.options.preflightRasterSceneFn, "preflightRasterSceneFn");
    const encode = resolveEncoder();
    const requestedScale = stableRenderOpts?.scale ?? 1;
    assertPngScale(requestedScale);
    assertRasterCanvasInput(input);
    const vnode = this.resolveInput(input);
    if (!stableRenderOpts?.skipValidation) {
      validate(vnode);
    }
    this.assertVNodeFontAliasesRegistered(vnode);

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
    const irSnapshotJson = JSON.stringify({ ...ir, warnings: [] });
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
        `Invalid SVG scale factor: ${String(requestedScale)}`,
        { stage: "emit" },
      );
    }
    deliverIrWarnings(compiledRecord.ir, emitOpts?.onWarning);
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
        `Invalid SVG scale factor: ${String(requestedScale)}`,
        { stage: "emit" },
      );
    }
    deliverIrWarnings(compiledRecord.ir, emitOpts?.onWarning);
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
    deliverIrWarnings(compiledRecord.ir, options?.onWarning);
    const resolvedIr = this.resolveIrViaWasm(compiledRecord.ir, compiledRecord.textPathMode, {
      showMissingGlyphs: options?.showMissingGlyphs,
      preserveResolvedUnitOutlines: !options?.showMissingGlyphs,
    });
    return projectResolvedTextOutlines(resolvedIr.root);
  }

  renderCompiledToPng(compiled: CompiledScene, emitOpts?: EmitPngOptions): Uint8Array {
    this.ensureNotDisposed();
    const compiledRecord = authenticateCompiledScene(compiled, this.compiledSceneOwnerToken);
    assertOwnOptionKeys(emitOpts, EMIT_RASTER_OPTION_KEYS, "renderCompiledToPng");
    const stableEmitOpts = emitOpts === undefined ? undefined : snapshotRasterOptions(emitOpts);
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
      warnings: [...compiledRecord.ir.warnings],
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
    const irSnapshotJson = JSON.stringify({ ...compiledRecord.ir, warnings: [] });
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

  /**
   * Compile and split a scene for the layered render entry points.
   *
   * The IR comes from the WASM compile (layout + text + IR build in one
   * call); the layer split additionally needs the VNode-annotated layout
   * tree, which only `computeLayout` produces, so the layered path runs a
   * second layout pass. Both passes are deterministic over the same
   * transport payload, so the trees always agree — the extra pass is an
   * accepted cost of the layered path.
   */
  private prepareLayeredSvgRender(
    input: EngineInput,
    renderOpts: LayeredSvgOptions | undefined,
    emitLayerSvg: (layerIr: IR, emitOptions: LayerEmitOptions) => string,
  ): { ir: IR; layoutRoot: LayoutNode; layeredResult: LayeredSvgResult } {
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
    const irSnapshotJson = JSON.stringify({ ...compiledSource.ir, warnings: [] });
    const layoutRoot = computeLayout(vnode, {
      computeLayoutFn: this.options.computeLayoutFn,
      fonts: this.options.fonts,
      shapeRegistry: this.shapeRegistry(),
    }).root;
    const sourceNodeMap = snapshotLayerSourceMetadata(layoutRoot);
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
    return { ir, layoutRoot, layeredResult };
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
      throw new FatalError("PNG_PIXEL_LIMIT", warningMessage, { stage: "emit", ...warning });
    }
    emitOpts?.onPngResolutionAdjusted?.(warning);
    const recoverableWarning = createInternalRecoverableError(
      "PNG_RESOLUTION_ADJUSTED",
      warningMessage,
      {
        fallback: "auto-adjusted scale",
        context: { stage: "emit", ...warning },
      },
    );
    ir.warnings.push(recoverableWarning);
    emitOpts?.onWarning?.(recoverableWarning);
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

  hitTest(ir: IR, x: number, y: number): string | null {
    return hitTest(ir, x, y);
  }

  dispose(): void {
    this.disposed = true;
    for (const preparedReference of this.preparedFrameScenes) {
      preparedReference.deref()?.dispose();
    }
    this.preparedFrameScenes.clear();
    this.options.wasmHandle?.dispose();
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

  private resolveInput(input: EngineInput): VNode {
    let vnode: VNode;
    if (isSceneNode(input)) {
      assertSerializableSceneTransport(input);
      vnode = fromSceneDocument(input);
    } else {
      vnode = input;
    }
    // Shape/Symbol survive layout as leaf boxes; geometry compiles at IR
    // build. Registry references still fail here, at validate timing.
    assertShapeReferencesResolvable(vnode, this.shapeRegistry());
    return vnode;
  }

  private shapeRegistry(): ShapeRegistry {
    return {
      geometries: this.geometryRegistry,
      symbols: this.symbolRegistry,
      compileCache: this.shapeCompileCache,
    };
  }

  /**
   * Reject aliases used by text content but absent from this engine's font
   * registry. The check runs even when WASM returned a fallback layout: rich
   * text can otherwise discard an unknown run font and silently render with
   * its parent style. Custom backends that do not expose font state leave the
   * tracked alias set empty and retain their own resolution contract.
   */
  private assertFontAliasesRegistered(aliases: Iterable<string>, nodeId: string): void {
    const unregistered = this.collectUnregisteredFontAliases(aliases);
    if (!unregistered) {
      return;
    }
    throw new FatalError(
      "FONT_ALIAS_NOT_REGISTERED",
      `Text node "${nodeId}" references unregistered font alias(es): ${unregistered.requested}. ` +
        `Registered aliases: ${unregistered.registered}. Register the font via createEngineAsync ` +
        `fonts or Engine.registerFonts before rendering.`,
      { stage: "text", nodeId },
    );
  }

  /**
   * Same diagnosis for the measurement APIs: the WASM engine silently drops
   * unresolved aliases and measurement then fails with an opaque shaping
   * error. Covers top-level, span, and nested rich-text font chains.
   */
  private assertMeasurementFontAliasesRegistered(
    apiName: string,
    input: {
      fontFamily: string;
      fallback?: string[];
      spans?: Array<{ fontFamily?: string; fallback?: string[] }>;
      richText?: RichTextNode[];
    },
  ): void {
    assertRichTextNodeDepth(input.richText ?? []);
    const aliases: Array<string | undefined> = [input.fontFamily, ...(input.fallback ?? [])];
    for (const span of input.spans ?? []) {
      aliases.push(span.fontFamily, ...(span.fallback ?? []));
    }
    collectRichTextFontAliases(input.richText ?? [], aliases);
    const unregistered = this.collectUnregisteredFontAliases(aliases);
    if (!unregistered) {
      return;
    }
    throw new FatalError(
      "FONT_ALIAS_NOT_REGISTERED",
      `${apiName} references unregistered font alias(es): ${unregistered.requested}. ` +
        `Registered aliases: ${unregistered.registered}. Register the font via ` +
        `createEngineAsync fonts or Engine.registerFonts before measuring.`,
      { stage: "text" },
    );
  }

  /**
   * Returns the unregistered aliases among `aliases`, or null when all
   * resolve. Skips generic CSS families (resolved at rasterization time)
   * and stays silent when this engine tracks no aliases (custom backends).
   */
  private collectUnregisteredFontAliases(
    aliases: Iterable<string | undefined>,
  ): { requested: string; registered: string } | null {
    if (this.registeredFontAliases.size === 0) {
      return null;
    }
    const unregisteredAliases = new Set<string>();
    for (const alias of aliases) {
      const normalizedAlias = alias?.trim();
      if (
        !normalizedAlias ||
        this.registeredFontAliases.has(normalizedAlias) ||
        GENERIC_FONT_FAMILIES.has(normalizedAlias.toLowerCase())
      ) {
        continue;
      }
      unregisteredAliases.add(normalizedAlias);
    }
    if (unregisteredAliases.size === 0) {
      return null;
    }
    return {
      requested: [...unregisteredAliases].join(", "),
      registered: [...this.registeredFontAliases].sort().join(", "),
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
      renderOpts?.onWarning?.(
        createInternalRecoverableError(
          "LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE",
          "Layered composition validation is not available in this engine.",
          {
            fallback: "skipped composition validation",
            context: {
              stage: "emit",
              validationStatus: skippedResult.status,
              width: skippedResult.width,
              height: skippedResult.height,
              thresholdPixels: skippedResult.thresholdPixels,
              thresholdRatio: skippedResult.thresholdRatio,
            },
          },
        ),
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
        renderOpts?.onWarning?.(
          createInternalRecoverableError(
            "LAYERED_COMPOSITION_MISMATCH",
            `Layered composition validation detected ${metrics.differentPixels} differing pixels (${metrics.differenceRatio}).`,
            {
              fallback: "returned layered SVG with mismatch warning",
              context: {
                stage: "emit",
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
        );
      }
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const skippedResult = createSkippedCompositionValidationResult({
        width: layeredResult.width,
        height: layeredResult.height,
        thresholdPixels: validationOptions.maxDifferentPixels,
        thresholdRatio: validationOptions.maxDifferenceRatio,
      });
      renderOpts?.onWarning?.(
        createInternalRecoverableError(
          "LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE",
          `Layered composition validation could not run: ${message}`,
          {
            fallback: "skipped composition validation",
            context: {
              stage: "emit",
              validationStatus: skippedResult.status,
              width: skippedResult.width,
              height: skippedResult.height,
              thresholdPixels: skippedResult.thresholdPixels,
              thresholdRatio: skippedResult.thresholdRatio,
              reason: message,
            },
          },
        ),
      );
      return skippedResult;
    }
  }
}

function collectRichTextFontAliases(
  nodes: RichTextNode[],
  target: Array<string | undefined>,
  inheritedStyle?: { font: string; fallback?: string[] },
): boolean {
  let hasText = false;
  for (const node of nodes) {
    hasText = collectRichTextNodeFontAliases(node, target, inheritedStyle) || hasText;
  }
  return hasText;
}

function collectRichTextNodeFontAliases(
  node: RichTextNode,
  target: Array<string | undefined>,
  inheritedStyle?: { font: string; fallback?: string[] },
): boolean {
  if (node.kind === "text") {
    if (node.text && inheritedStyle) {
      target.push(inheritedStyle.font, ...(inheritedStyle.fallback ?? []));
    }
    return Boolean(node.text);
  }
  if (node.kind === "span" || node.kind === "combine") {
    if (node.text) {
      target.push(node.style.font, ...(node.style.fallback ?? []));
    }
    return Boolean(node.text);
  }
  if (node.kind === "ruby") {
    return collectRichTextRubyFontAliases(node, target);
  }
  if (node.kind === "inlineRect") {
    return false;
  }
  return collectRichTextFontAliases(node.children, target, node.style);
}

function collectRichTextRubyFontAliases(
  node: Extract<RichTextNode, { kind: "ruby" }>,
  target: Array<string | undefined>,
): boolean {
  let hasText = false;
  for (const children of [node.base, node.rt, ...(node.rtLevels ?? [])]) {
    hasText = collectRichTextFontAliases(children, target, node.style) || hasText;
  }
  return hasText;
}

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
      svgsToAnimatedWebpFn: handle.createSvgsToAnimatedWebpFn(),
      svgsToAnimatedGifFn: handle.createSvgsToAnimatedGifFn(),
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
