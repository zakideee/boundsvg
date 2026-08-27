import { FatalError } from "../errors.js";
import { DEFAULT_FONT_WEIGHT } from "../font/types.js";
import { HANDLER_KEYS, type NodePosition } from "../ir/internal.js";
import { generateNodeId } from "../ir/node-id.js";
import type { HandlersRef } from "../ir/types.js";
import type { ShapeRegistry } from "../shape/expand.js";
import type { GeometryDoc, SymbolDefinition, Transform2D } from "../shape/types.js";
import { uint8ToBase64 } from "../svg/utils.js";
import {
  countTextOnPathRunResources,
  flattenRichText,
  flattenTextOnPathRuns,
} from "../text/inline-runs.js";
import type {
  InlineRectFragment,
  LineFragment,
  PositionedGlyph,
  RichTextNode,
  RichTextStyle,
  TextDecoration,
  TextDecorationFragment,
  TextDecorationLine,
  TextLayoutResult,
  TextOverflow,
  TextRunStyle,
  TextShadowLayer,
  TextStrokeLayer,
  TextUnitKind,
  TextUnitMap,
  TextUnitRubyMode,
} from "../text/types.js";
import {
  MAX_TEXT_PATH_INLINE_CONTAINERS,
  MAX_TEXT_PATH_PAINT_RANGES,
  MAX_TEXT_PATH_PAINTED_LAYERS,
  MAX_TEXT_PATH_SHAPING_RUNS,
  MAX_TEXT_PATH_SOURCE_ITEMS,
} from "../text/types.js";
import type {
  AnimationSpec,
  BorderRadius,
  PartPaintOverride,
  StrokeScaling,
  TextFlowExclusion,
  TextUnitAnimation,
  VNode,
  VNodeFor,
} from "../vnode/types.js";
import type { ComputeLayoutOptions } from "./backend.js";
import { assertLayoutTreeDepth } from "./limits.js";
import { type LayoutStyle, mapToLayoutStyle } from "./taffy-style-mapper.js";
import type { BBox, LayoutNode, LayoutResult, TextMeasureResult } from "./types.js";

// ---------------------------------------------------------------------------
// WASM transport DTOs for the Taffy layout backend
// ---------------------------------------------------------------------------

/** Transport DTO sent to the WASM Taffy backend */
type WasmLayoutInput = {
  root: WasmNodeInput;
  fonts: WasmFontInput[];
};

type WasmNodeInput = {
  nodeId: string;
  nodeType: string;
  /** Preserve ID provenance for Rust-owned transition compatibility checks. */
  authoredId: boolean;
  style: WasmStyleInput;
  children: WasmNodeInput[];
  text?: WasmTextInput;
  textPath?: WasmTextPathInput;
  image?: WasmImageInput;
  visual?: WasmVisualInput;
};

/**
 * Raw visual props carried for IR building.
 *
 * Values are transported uninterpreted (gradient strings, box-shadow strings,
 * raw border radius); interpretation stays with the Rust IR builder
 * (crates/boundsvg/src/ir/builder.rs). Text style fields
 * already carried by {@link WasmTextInput} are not duplicated here; only text
 * visuals the text pipeline does not transport (color, alignment, stroke and
 * shadow layers, unset-vs-default weight) are included.
 */
type WasmVisualInput = {
  // Box visuals
  background?: string;
  borderWidth?: number;
  borderColor?: string;
  /** Raw prop value: uniform number or [tl, tr, br, bl]. */
  borderRadius?: BorderRadius;
  overflow?: string;
  boxShadow?: string;
  opacity?: number;
  zIndex?: number;
  transform?: Transform2D;
  animation?: AnimationSpec;
  inlineRectAnimations?: Record<string, AnimationSpec>;
  inlineDecorationAnimations?: Record<string, AnimationSpec>;
  unitAnimation?: TextUnitAnimation;
  meta?: Readonly<Record<string, string>>;
  /** Canvas-only declarative debug overlay flag. */
  debug?: boolean;

  // Stroke styling (border rect / path / shape)
  strokeScaling?: StrokeScaling;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  strokeDasharray?: string;
  strokeMiterlimit?: number;

  // Paint (path / shape)
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: string;

  // Path
  d?: string;

  // Text visuals not carried by WasmTextInput
  color?: string;
  textAlign?: string;
  /** Raw author value; WasmTextInput.fontWeight is defaulted on the wire. */
  fontWeight?: number;
  /** Raw author value; WasmTextInput.fontFamily folds the fallback list in. */
  fontFallback?: string[];
  textStroke?: string;
  textStrokeWidth?: number;
  textStrokeLinecap?: string;
  textStrokeLinejoin?: string;
  textStrokeDasharray?: string;
  textStrokeMiterlimit?: number;
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];

  // Image
  /**
   * Embedded image source (data URI or reference URL). Byte sources are
   * converted to data URIs here; absence means the source could not be
   * embedded (load-failure fallback at IR build).
   */
  src?: string;
  objectFit?: string;
  objectPosition?: string;

  // Nested svg
  svgContent?: string;
  contentIdPrefix?: string;
  /** Raw prop value ("none" | "meet" | "slice"); shared by Svg and Shape. */
  preserveAspectRatio?: string;

  // Shape / Symbol (registry references resolved at serialization)
  shapeGeometry?: GeometryDoc;
  /** Raw registry id, carried for unresolvable-reference diagnostics. */
  shapeGeometryId?: string;
  symbolDefinition?: SymbolDefinition;
  /** Raw registry id, carried for unresolvable-reference diagnostics. */
  symbolId?: string;
  emitPartIds?: boolean;
  partPaint?: Record<string, PartPaintOverride>;

  // Event handlers
  handlers?: HandlersRef;
};

type WasmStyleInput = {
  display?: string;
  flexDirection?: string;
  flexWrap?: string;
  alignItems?: string;
  justifyContent?: string;
  justifyItems?: string;
  alignSelf?: string;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  padding?: [number, number, number, number];
  margin?: [number, number, number, number];
  overflow?: string;
  // Positioning
  position?: string;
  /** [top, right, bottom, left]; null = auto (side not specified). */
  inset?: [number | null, number | null, number | null, number | null];
  // Aspect ratio
  aspectRatio?: number;
  // Grid-specific
  gridTemplateColumns?: string[];
  gridTemplateRows?: string[];
  gridColumnStart?: number;
  gridColumnEnd?: number;
  gridRowStart?: number;
  gridRowEnd?: number;
};

type WasmTextInput = {
  content: string;
  spans?: WasmTextSpan[];
  richText?: WasmRichTextNode[];
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  textIndent?: number;
  fontFamily: string[];
  fontWeight: number;
  fontStyle: string;
  wrap?: string;
  whiteSpace?: string;
  tabSize?: number;
  flow?: {
    exclusions: TextFlowExclusion[];
    minRegionWidthPx?: number;
  };
  fit?: string;
  maxLines?: number;
  preferredFrame?: { w?: number; h?: number };
  writingMode?: string;
  language?: "ja" | "en" | "auto";
  textOrientation?: "mixed" | "upright";
  minFontSizePx?: number;
  shrinkEpsilonPx?: number;
  shrinkMaxIterations?: number;
  maxFontSizePx?: number;
  growEpsilonPx?: number;
  growMaxIterations?: number;
  fitMaxProbes?: number;
  ellipsis?: boolean;
  hangingPunctuation?: boolean;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  /** Internal opt-in. Populated together with the public unit animation API. */
  unitMap?: WasmTextUnitMapRequest;
  textDecorationRangeCount?: number;
};

type WasmTextPathInput = {
  spans: WasmTextSpan[];
  decorationOwnerIds: Array<number | null>;
  textDecorationRangeCount?: number;
  sourceItemCount: number;
  inlineCount: number;
  d: string;
  fontSizePx: number;
  letterSpacingPx?: number;
  fontFamily: string[];
  fontWeight: number;
  fontStyle: string;
  language?: "ja" | "en" | "auto";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  startOffsetPx?: number;
  textAnchor?: "start" | "middle" | "end";
  pathDirection?: "forward" | "reverse";
  pathNormal?: "left" | "right";
  pathOffsetPx?: number;
  pathFit?: "none" | "spacing" | "scale" | "shrink";
  pathOverflow?: "hidden" | "error" | "ellipsis";
  unitMap?: WasmTextUnitMapRequest;
};

type WasmTextDecoration = {
  line: TextDecorationLine[];
  color: string;
  style: "solid" | "double" | "dotted" | "dashed" | "wavy";
  thicknessPx?: number;
  offsetPx: number;
  skipInk: "none" | "all";
};

type WasmTextUnitMapRequest = {
  kind: TextUnitKind;
  ruby: TextUnitRubyMode;
};

type WasmTextSpan = {
  text: string;
  fontFamily: string[];
  fontWeight: number;
  fontStyle: string;
  fontSizePx: number;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  textOrientation?: "mixed" | "upright";
  color?: string;
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  textDecoration?: WasmTextDecoration;
  /** True when spans exist only to transport root paint metadata. */
  decorationTransportOnly?: boolean;
};

type WasmRichTextStyle = {
  fontFamily: string[];
  fontWeight: number;
  fontStyle: string;
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  color?: string;
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  textOrientation?: "mixed" | "upright";
  textDecoration?: WasmTextDecoration;
};

type WasmRichTextNode =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "span";
      text: string;
      style: WasmRichTextStyle;
    }
  | {
      kind: "combine";
      text: string;
      style: WasmRichTextStyle;
      decorationRuns?: Array<{ text: string; textDecoration?: WasmTextDecoration }>;
    }
  | {
      kind: "ruby";
      rubyPosition?: "over" | "under" | "alternate" | "inter-character";
      rubyAlign?: "start" | "center" | "space-between" | "space-around";
      rubyGapPx?: number;
      rubyOffsetPx?: number;
      rubyLineSizing?: "stable" | "css";
      style: WasmRichTextStyle;
      base: WasmRichTextNode[];
      rt: WasmRichTextNode[];
      rtLevels?: WasmRichTextNode[][];
    }
  | {
      kind: "inlineBox";
      style: WasmRichTextStyle;
      children: WasmRichTextNode[];
      paddingInline?: [number, number];
      background?: string;
      borderColor?: string;
      borderWidth?: number;
      borderRadius?: number;
      spanKey?: string;
    }
  | {
      kind: "inlineRect";
      fragmentId: string;
      inlineSizePx: number;
      blockSizePx?: number | "line";
      advancePx?: number;
      blockAlign?: "start" | "center" | "end";
      color: string;
      borderRadiusPx?: number;
      opacity?: number;
      paintOrder?: "behind" | "front";
    }
  | {
      kind: "decoratedSpan";
      style: WasmRichTextStyle;
      children: WasmRichTextNode[];
      paddingInline?: [number, number];
      background?: string;
      borderColor?: string;
      borderWidth?: number;
      borderRadius?: [number, number, number, number];
      spanKey?: string;
    };

type WasmImageInput = {
  width: number;
  height: number;
};

type WasmFontInput = {
  alias: string;
  weight: number;
  style: string;
  data: number[];
};

/** Transport DTO returned from the WASM Taffy backend */
type WasmLayoutOutput = {
  nodes: WasmNodeOutput[];
  measureCallCount: number;
  measureCacheHits?: number;
};

type WasmNodeOutput = {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  textLayout?: {
    glyphs: Array<{
      glyphId: number;
      xAdvance: number;
      yAdvance: number;
      xOffset: number;
      yOffset: number;
      cluster: number;
      fontAlias?: string;
      fontWeight?: number;
      fontStyle?: "normal" | "italic";
      rotationDeg?: number;
    }>;
    measuredWidth: number;
    measuredHeight: number;
    /** Rust Text Engine result. Optional on the wire; validated before text rendering. */
    lines?: Array<{
      text: string;
      glyphs: Array<{
        glyphId: number;
        xAdvance: number;
        yAdvance: number;
        xOffset: number;
        yOffset: number;
        cluster: number;
        fontAlias?: string;
        fontWeight?: number;
        fontStyle?: "normal" | "italic";
        rotationDeg?: number;
      }>;
      width: number;
      baselineY: number;
      fragments?: Array<{
        text: string;
        glyphs: Array<{
          glyphId: number;
          xAdvance: number;
          yAdvance: number;
          xOffset: number;
          yOffset: number;
          cluster: number;
          fontAlias?: string;
          fontWeight?: number;
          fontStyle?: "normal" | "italic";
          rotationDeg?: number;
        }>;
        width: number;
        style?: {
          font: string;
          fallback?: string[];
          fontWeight: number;
          fontStyle: "normal" | "italic";
          fontSizePx: number;
          letterSpacingPx: number;
          textOrientation?: "mixed" | "upright";
          fontVariationSettings?: string;
          fontFeatureSettings?: string;
          color?: string;
          language?: "ja" | "en" | "auto";
        };
      }>;
      positionedGlyphs?: PositionedGlyph[];
    }>;
    bbox?: { x: number; y: number; w: number; h: number };
    chosenFontSizePx?: number;
    overflow?: { type: string; reason?: string };
    sourceText?: string;
    displayText?: string;
    unitMap?: TextUnitMap;
    /** Recoverable text warnings from the engine (e.g. MISSING_GLYPH). */
    warnings?: Array<{ code: string; message: string; fallback?: string }>;
    /** Inline / InlineBox decoration rects, in text-local coordinates. */
    inlineBoxDecorations?: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      background?: string;
      borderColor?: string;
      borderWidth?: number;
      borderRadius?: [number, number, number, number];
    }>;
    textDecorations?: TextDecorationFragment[];
    inlineRects?: InlineRectFragment[];
  };
};

type WasmTextLayoutLine = NonNullable<NonNullable<WasmNodeOutput["textLayout"]>["lines"]>[number];
type WasmTextLayoutFragment = NonNullable<WasmTextLayoutLine["fragments"]>[number];
type WasmTextLayoutFragmentStyle = WasmTextLayoutFragment["style"];

// ---------------------------------------------------------------------------
// WASM function type (injected at runtime)
// ---------------------------------------------------------------------------

export type { ComputeLayoutTransportFn as ComputeLayoutFn } from "./backend.js";

const TEXT_OVERFLOW_TYPES = new Set<TextOverflow["type"]>([
  "none",
  "overflow",
  "kinsoku_unresolved",
  "cannot_fit",
]);

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function getObjectValue(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function isWasmLayoutOutput(value: unknown): value is WasmLayoutOutput {
  if (!isObjectLike(value)) {
    return false;
  }

  return (
    Array.isArray(getObjectValue(value, "nodes")) &&
    typeof getObjectValue(value, "measureCallCount") === "number"
  );
}

function parseWasmLayoutOutput(outputJson: string): WasmLayoutOutput {
  const parsed = JSON.parse(outputJson);
  if (!isWasmLayoutOutput(parsed)) {
    throw new FatalError(
      "LAYOUT_INVALID_WASM_OUTPUT",
      "computeLayoutFn returned invalid layout output JSON.",
      { stage: "layout" },
    );
  }

  return parsed;
}

function parseTextOverflow(
  overflow: NonNullable<WasmNodeOutput["textLayout"]>["overflow"],
): TextOverflow {
  if (!overflow || !TEXT_OVERFLOW_TYPES.has(overflow.type as TextOverflow["type"])) {
    return { type: "none" };
  }

  return {
    type: overflow.type as TextOverflow["type"],
    reason: overflow.reason,
  };
}

// ---------------------------------------------------------------------------
// Build WASM input from VNode tree
// ---------------------------------------------------------------------------

function mapSpacingToArray(spacing: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): [number, number, number, number] | undefined {
  const { top, right, bottom, left } = spacing;
  if (top !== 0 || right !== 0 || bottom !== 0 || left !== 0) {
    return [top, right, bottom, left];
  }
  return undefined;
}

function mapGap(gap: { top: number; right: number }, result: WasmStyleInput): void {
  const rowGap = gap.top;
  const colGap = gap.right;
  if (rowGap !== 0 || colGap !== 0) {
    if (rowGap === colGap) {
      result.gap = colGap;
    } else {
      result.rowGap = rowGap;
      result.columnGap = colGap;
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: central prop-to-wasm mapping is intentionally kept in one place.
function toWasmTaffyStyleInput(style: LayoutStyle): WasmStyleInput {
  const result: WasmStyleInput = {};

  if (style.display !== "flex") {
    result.display = style.display;
  }
  result.flexDirection = style.flexDirection;
  if (style.flexWrap !== "nowrap") {
    result.flexWrap = style.flexWrap;
  }
  result.alignItems = style.alignItems;
  result.justifyContent = style.justifyContent;
  if (style.justifyItems) {
    result.justifyItems = style.justifyItems;
  }
  if (style.alignSelf !== "auto") {
    result.alignSelf = style.alignSelf;
  }
  if (style.flexGrow !== 0) {
    result.flexGrow = style.flexGrow;
  }
  if (style.flexShrink !== 1) {
    result.flexShrink = style.flexShrink;
  }
  if (style.flexBasis !== null) {
    result.flexBasis = style.flexBasis;
  }

  mapGap(style.gap, result);

  if (style.size.width !== null) {
    result.width = style.size.width;
  }
  if (style.size.height !== null) {
    result.height = style.size.height;
  }
  if (style.minSize.width !== null) {
    result.minWidth = style.minSize.width;
  }
  if (style.minSize.height !== null) {
    result.minHeight = style.minSize.height;
  }
  if (style.maxSize.width !== null) {
    result.maxWidth = style.maxSize.width;
  }
  if (style.maxSize.height !== null) {
    result.maxHeight = style.maxSize.height;
  }

  const padding = mapSpacingToArray(style.padding);
  if (padding) {
    result.padding = padding;
  }

  const margin = mapSpacingToArray(style.margin);
  if (margin) {
    result.margin = margin;
  }

  if (style.overflow !== "visible") {
    result.overflow = style.overflow;
  }

  // Position
  if (style.position !== "relative") {
    result.position = style.position;
  }
  // Inset: null = auto side; only sent when at least one side is specified.
  const { top, right, bottom, left } = style.inset;
  if (top !== null || right !== null || bottom !== null || left !== null) {
    result.inset = [top, right, bottom, left];
  }

  // Aspect ratio
  if (style.aspectRatio !== null) {
    result.aspectRatio = style.aspectRatio;
  }

  // Grid-specific
  if (style.gridTemplateColumns) {
    result.gridTemplateColumns = style.gridTemplateColumns;
  }
  if (style.gridTemplateRows) {
    result.gridTemplateRows = style.gridTemplateRows;
  }
  if (style.gridColumnStart != null) {
    result.gridColumnStart = style.gridColumnStart;
  }
  if (style.gridColumnEnd != null) {
    result.gridColumnEnd = style.gridColumnEnd;
  }
  if (style.gridRowStart != null) {
    result.gridRowStart = style.gridRowStart;
  }
  if (style.gridRowEnd != null) {
    result.gridRowEnd = style.gridRowEnd;
  }

  return result;
}

const FIXED_SIZE_LEAF_TYPES = new Set<VNode["type"]>(["Image", "Svg", "Shape", "Symbol"]);

/** Whether this VNode type contributes children to WasmNodeInput.children. */
export function hasWasmLayoutChildren(nodeType: VNode["type"]): boolean {
  return nodeType !== "Text" && nodeType !== "TextOnPath" && !FIXED_SIZE_LEAF_TYPES.has(nodeType);
}

// Image byte sources are re-serialized on every layout call; base64
// conversion of multi-MB buffers dominates payload build time, so the
// conversion is cached by buffer identity for the buffer's lifetime.
const imageDataUriCache = new WeakMap<Uint8Array, { mediaType: string; dataUri: string }>();

/** Resolve an image source to the transported string form.
 *  Returns undefined when the source cannot be embedded — the IR builder
 *  treats absence as a load failure (placeholder rect + warning). */
function resolveImageSrc(
  src: Uint8Array | string,
  mediaType: string | undefined,
): string | undefined {
  if (typeof src === "string") {
    return src;
  }
  if (!mediaType) {
    return undefined;
  }
  const cached = imageDataUriCache.get(src);
  if (cached && cached.mediaType === mediaType) {
    return cached.dataUri;
  }
  try {
    const dataUri = `data:${mediaType};base64,${uint8ToBase64(src)}`;
    imageDataUriCache.set(src, { mediaType, dataUri });
    return dataUri;
  } catch {
    return undefined;
  }
}

/** Collect event handler strings from VNode props (mirrors the Rust IR builder). */
function collectHandlerRefs(vnode: VNode): HandlersRef | undefined {
  switch (vnode.type) {
    case "Inline":
    case "InlineBox":
    case "InlineRect":
    case "Ruby":
    case "Rt":
      return undefined;
    default:
      break;
  }

  const props: Partial<Record<keyof HandlersRef, string>> = vnode.props;
  const handlers: HandlersRef = {};
  let found = false;
  for (const key of HANDLER_KEYS) {
    const handlerValue = props[key];
    if (typeof handlerValue === "string") {
      handlers[key] = handlerValue;
      found = true;
    }
  }
  return found ? handlers : undefined;
}

function applyShapeVisual(
  vnode: VNodeFor<"Shape"> | VNodeFor<"Symbol">,
  shapeRegistry: ShapeRegistry | undefined,
  visual: WasmVisualInput,
): void {
  // Registry references resolve leniently: an unresolvable id is omitted
  // rather than thrown, so resolution failures keep surfacing at IR build
  // and layout-only rendering stays reference-tolerant.
  if (vnode.type === "Shape") {
    visual.shapeGeometry =
      vnode.props.geometry ??
      (vnode.props.geometryId ? shapeRegistry?.geometries.get(vnode.props.geometryId) : undefined);
    visual.shapeGeometryId = vnode.props.geometryId;
  } else {
    visual.symbolDefinition =
      vnode.props.symbol ??
      (vnode.props.symbolId ? shapeRegistry?.symbols.get(vnode.props.symbolId) : undefined);
    visual.symbolId = vnode.props.symbolId;
  }
  const props = vnode.props;
  visual.emitPartIds = props.emitPartIds;
  visual.partPaint = props.partPaint;
  visual.preserveAspectRatio = props.preserveAspectRatio;
  visual.fill = props.fill;
  visual.stroke = props.stroke;
  visual.strokeWidth = props.strokeWidth;
  visual.fillRule = props.fillRule;
  visual.strokeLinecap = props.strokeLinecap;
  visual.strokeLinejoin = props.strokeLinejoin;
  visual.strokeDasharray = props.strokeDasharray;
  visual.strokeMiterlimit = props.strokeMiterlimit;
}

function toWasmStrokeScaling(strokeScaling: StrokeScaling | undefined): StrokeScaling | undefined {
  return strokeScaling === "canvas" ? "canvas" : undefined;
}

function buildVisualInput(
  vnode: VNode,
  shapeRegistry: ShapeRegistry | undefined,
): WasmVisualInput | undefined {
  const visual: WasmVisualInput = {};

  switch (vnode.type) {
    case "Canvas":
      visual.background = vnode.props.background;
      visual.debug = vnode.props.debug;
      break;
    case "Flex":
    case "Grid":
    case "Box": {
      const props = vnode.props;
      visual.background = props.background;
      visual.borderWidth = props.borderWidth;
      visual.borderColor = props.borderColor;
      visual.strokeScaling = toWasmStrokeScaling(props.strokeScaling);
      visual.borderRadius = props.borderRadius;
      visual.overflow = props.overflow;
      visual.boxShadow = props.boxShadow;
      visual.strokeLinecap = props.strokeLinecap;
      visual.strokeLinejoin = props.strokeLinejoin;
      visual.strokeDasharray = props.strokeDasharray;
      visual.strokeMiterlimit = props.strokeMiterlimit;
      break;
    }
    case "Text": {
      const props = vnode.props;
      visual.color = props.color;
      visual.textAlign = props.textAlign;
      visual.fontWeight = props.fontWeight;
      visual.fontFallback = props.fallback;
      visual.textStroke = props.textStroke;
      visual.textStrokeWidth = props.textStrokeWidth;
      visual.textStrokeLinecap = props.textStrokeLinecap;
      visual.textStrokeLinejoin = props.textStrokeLinejoin;
      visual.textStrokeDasharray = props.textStrokeDasharray;
      visual.textStrokeMiterlimit = props.textStrokeMiterlimit;
      visual.textStrokes = props.textStrokes;
      visual.textShadows = props.textShadows;
      visual.unitAnimation = props.animateUnits;
      break;
    }
    case "TextOnPath": {
      const props = vnode.props;
      visual.color = props.color;
      visual.fontWeight = props.fontWeight;
      visual.fontFallback = props.fallback;
      visual.textStroke = props.textStroke;
      visual.textStrokeWidth = props.textStrokeWidth;
      visual.textStrokeLinecap = props.textStrokeLinecap;
      visual.textStrokeLinejoin = props.textStrokeLinejoin;
      visual.textStrokeDasharray = props.textStrokeDasharray;
      visual.textStrokeMiterlimit = props.textStrokeMiterlimit;
      visual.textStrokes = props.textStrokes;
      visual.textShadows = props.textShadows;
      visual.unitAnimation = props.animateUnits;
      break;
    }
    case "Image": {
      const props = vnode.props;
      visual.src = resolveImageSrc(props.src, props.mediaType);
      visual.objectFit = props.objectFit;
      visual.objectPosition = props.objectPosition;
      visual.borderRadius = props.borderRadius;
      break;
    }
    case "Path": {
      const props = vnode.props;
      visual.d = props.d;
      visual.fill = props.fill;
      visual.stroke = props.stroke;
      visual.strokeWidth = props.strokeWidth;
      visual.strokeScaling = toWasmStrokeScaling(props.strokeScaling);
      visual.fillRule = props.fillRule;
      visual.strokeLinecap = props.strokeLinecap;
      visual.strokeLinejoin = props.strokeLinejoin;
      visual.strokeDasharray = props.strokeDasharray;
      visual.strokeMiterlimit = props.strokeMiterlimit;
      break;
    }
    case "Svg": {
      const props = vnode.props;
      visual.svgContent = props.content;
      visual.preserveAspectRatio = props.preserveAspectRatio;
      visual.contentIdPrefix = props.contentIdPrefix;
      break;
    }
    case "Shape":
    case "Symbol":
      applyShapeVisual(vnode, shapeRegistry, visual);
      break;
    default:
      // Inline-level nodes are flattened into Text and never reach layout.
      return undefined;
  }

  switch (vnode.type) {
    case "Flex":
    case "Grid":
    case "Box":
    case "Text":
    case "Image":
    case "Path":
    case "Svg":
    case "Shape":
    case "Symbol":
      visual.opacity = vnode.props.opacity;
      visual.zIndex = vnode.props.zIndex;
      visual.transform = vnode.props.transform;
      visual.animation = vnode.props.animate;
      break;
    case "TextOnPath":
      visual.opacity = vnode.props.opacity;
      visual.zIndex = vnode.props.zIndex;
      visual.animation = vnode.props.animate;
      break;
    default:
      break;
  }

  visual.meta = vnode.props.meta;
  visual.handlers = collectHandlerRefs(vnode);

  // JSON.stringify drops undefined-valued keys, but an all-undefined object
  // would still serialize as an empty `visual` — omit it entirely instead.
  const hasAnyValue = Object.values(visual).some((value) => value !== undefined);
  return hasAnyValue ? visual : undefined;
}

/** Serialization state threaded through the VNode walk. */
type WasmInputContext = {
  canvasLanguage?: "ja" | "en" | "auto";
  shapeRegistry?: ShapeRegistry;
};

function buildWasmTextInput(
  vnode: VNodeFor<"Text">,
  textNodeId: string,
  canvasLanguage: WasmInputContext["canvasLanguage"],
): {
  text: WasmTextInput;
  inlineRectAnimations: Record<string, AnimationSpec>;
  inlineDecorationAnimations: Record<string, AnimationSpec>;
} {
  const props = vnode.props;
  const flattened = flattenRichText(vnode, canvasLanguage, textNodeId);
  const fallback = props.fallback as string[] | undefined;
  const fontFamily = [props.font as string, ...(fallback ?? [])];
  const hasDecoration = flattened.runs.some(
    (run) => run.style.textDecoration !== undefined && run.style.textDecoration !== "none",
  );
  const spans: WasmTextSpan[] | undefined =
    flattened.hasInline || hasDecoration
      ? flattened.runs.map((run) => ({
          text: run.text,
          fontFamily: [run.style.font, ...(run.style.fallback ?? [])],
          fontWeight: run.style.fontWeight,
          fontStyle: run.style.fontStyle,
          fontSizePx: run.style.fontSizePx,
          letterSpacingPx: run.style.letterSpacingPx,
          language: run.style.language,
          textOrientation: run.style.textOrientation,
          color: run.style.color,
          textStrokes: run.style.textStrokes,
          textShadows: run.style.textShadows,
          fontVariationSettings: run.style.fontVariationSettings,
          fontFeatureSettings: run.style.fontFeatureSettings,
          textDecoration: textDecorationToWasm(run.style.textDecoration, run.style.color),
          decorationTransportOnly: flattened.hasInline ? undefined : true,
        }))
      : undefined;
  const textDecorationRangeCount = countAuthoredTextDecorationRanges(vnode);

  const text: WasmTextInput = {
    content: flattened.text,
    spans,
    richText: flattened.richText?.map((node) => richTextNodeToWasm(node)),
    fontSizePx: props.fontSizePx as number,
    lineHeight: props.lineHeight as number | undefined,
    lineHeightPx: props.lineHeightPx as number | undefined,
    letterSpacingPx: props.letterSpacingPx as number | undefined,
    textIndent: props.textIndent as number | undefined,
    fontFamily,
    fontWeight: (props.fontWeight as number | undefined) ?? DEFAULT_FONT_WEIGHT,
    fontStyle: (props.fontStyle as string | undefined) ?? "normal",
    wrap: (props.wrap as string | undefined) ?? "char",
    whiteSpace: props.whiteSpace as string | undefined,
    tabSize: props.tabSize as number | undefined,
    flow:
      props.flowExclusions && props.flowExclusions.length > 0
        ? {
            exclusions: [...props.flowExclusions],
            minRegionWidthPx: props.flowMinRegionWidthPx,
          }
        : undefined,
    maxLines: props.maxLines as number | undefined,
    preferredFrame: props.preferredFrame as { w?: number; h?: number } | undefined,
    writingMode: props.writingMode as string | undefined,
    language: (props.language as "ja" | "en" | "auto" | undefined) ?? canvasLanguage,
    textOrientation: (props.textOrientation as "mixed" | "upright" | undefined) ?? "mixed",
    fit: props.fit as string | undefined,
    minFontSizePx: props.minFontSizePx as number | undefined,
    shrinkEpsilonPx: props.shrinkEpsilonPx as number | undefined,
    shrinkMaxIterations: props.shrinkMaxIterations as number | undefined,
    maxFontSizePx: props.maxFontSizePx as number | undefined,
    growEpsilonPx: props.growEpsilonPx as number | undefined,
    growMaxIterations: props.growMaxIterations as number | undefined,
    fitMaxProbes: props.fitMaxProbes as number | undefined,
    ellipsis: props.ellipsis as boolean | undefined,
    hangingPunctuation: props.hangingPunctuation as boolean | undefined,
    fontVariationSettings: props.fontVariationSettings as string | undefined,
    fontFeatureSettings: props.fontFeatureSettings as string | undefined,
    unitMap: props.animateUnits
      ? {
          kind: props.animateUnits.by,
          ruby: props.animateUnits.ruby ?? "with-base",
        }
      : undefined,
    textDecorationRangeCount: textDecorationRangeCount > 0 ? textDecorationRangeCount : undefined,
  };
  return {
    text,
    inlineRectAnimations: flattened.inlineRectAnimations,
    inlineDecorationAnimations: flattened.inlineDecorationAnimations,
  };
}

function buildWasmTextPathInput(
  vnode: VNodeFor<"TextOnPath">,
  canvasLanguage: WasmInputContext["canvasLanguage"],
): WasmTextPathInput {
  const { props } = vnode;
  const counts = validateTextOnPathInlineTransport(vnode.children, props.id ?? "<TextOnPath>");
  const flattened = flattenTextOnPathRuns(vnode, canvasLanguage);
  const { shapingRunCount, paintRangeCount, paintedLayerEstimate } = countTextOnPathRunResources(
    flattened.runs,
  );
  const decorationOwnerByValue = new WeakMap<object, number>();
  let nextDecorationOwnerId = 0;
  const decorationOwnerIds = flattened.runs.map((run): number | null => {
    const decoration = run.style.textDecoration;
    if (decoration === undefined || decoration === "none") {
      return null;
    }
    const existingOwnerId = decorationOwnerByValue.get(decoration);
    if (existingOwnerId !== undefined) {
      return existingOwnerId;
    }
    const ownerId = nextDecorationOwnerId;
    nextDecorationOwnerId += 1;
    decorationOwnerByValue.set(decoration, ownerId);
    return ownerId;
  });
  const textDecorationRangeCount = countAuthoredTextDecorationRanges(vnode);
  if (shapingRunCount > MAX_TEXT_PATH_SHAPING_RUNS) {
    throw new FatalError(
      "TEXT_PATH_RUN_LIMIT",
      `TextOnPath shaping run count exceeds the limit ${MAX_TEXT_PATH_SHAPING_RUNS}.`,
      { stage: "validate", nodeId: props.id ?? "<TextOnPath>" },
    );
  }
  if (
    paintRangeCount > MAX_TEXT_PATH_PAINT_RANGES ||
    paintedLayerEstimate > MAX_TEXT_PATH_PAINTED_LAYERS
  ) {
    throw new FatalError(
      "TEXT_PATH_PAINT_LIMIT",
      `TextOnPath paint resources exceed the limits ${MAX_TEXT_PATH_PAINT_RANGES} ranges / ${MAX_TEXT_PATH_PAINTED_LAYERS} painted layers.`,
      { stage: "validate", nodeId: props.id ?? "<TextOnPath>" },
    );
  }
  return {
    spans: flattened.runs.map((run) => ({
      text: run.text,
      fontFamily: [run.style.font, ...(run.style.fallback ?? [])],
      fontWeight: run.style.fontWeight,
      fontStyle: run.style.fontStyle,
      fontSizePx: run.style.fontSizePx,
      letterSpacingPx: run.style.letterSpacingPx,
      language: run.style.language,
      color: run.style.color,
      textStrokes: run.style.textStrokes,
      textShadows: run.style.textShadows,
      fontVariationSettings: run.style.fontVariationSettings,
      fontFeatureSettings: run.style.fontFeatureSettings,
      textDecoration: textDecorationToWasm(run.style.textDecoration, run.style.color),
    })),
    decorationOwnerIds,
    textDecorationRangeCount: textDecorationRangeCount > 0 ? textDecorationRangeCount : undefined,
    sourceItemCount: counts.sourceItemCount,
    inlineCount: counts.inlineCount,
    d: props.d,
    fontSizePx: props.fontSizePx,
    letterSpacingPx: props.letterSpacingPx,
    fontFamily: [props.font, ...(props.fallback ?? [])],
    fontWeight: props.fontWeight ?? DEFAULT_FONT_WEIGHT,
    fontStyle: props.fontStyle ?? "normal",
    language: props.language ?? canvasLanguage,
    fontVariationSettings: props.fontVariationSettings,
    fontFeatureSettings: props.fontFeatureSettings,
    startOffsetPx: props.startOffsetPx,
    textAnchor: props.textAnchor,
    pathDirection: props.pathDirection,
    pathNormal: props.pathNormal,
    pathOffsetPx: props.pathOffsetPx,
    pathFit: props.pathFit,
    pathOverflow: props.pathOverflow,
    unitMap: props.animateUnits
      ? {
          kind: props.animateUnits.by,
          ruby: props.animateUnits.ruby ?? "with-base",
        }
      : undefined,
  };
}

const TEXT_PATH_INLINE_TRANSPORT_PROPS: ReadonlySet<string> = new Set([
  "font",
  "fallback",
  "fontWeight",
  "fontStyle",
  "fontVariationSettings",
  "fontFeatureSettings",
  "fontSizePx",
  "letterSpacingPx",
  "language",
  "color",
  "textStrokes",
  "textShadows",
  "textDecoration",
]);

function validateTextOnPathInlineTransport(
  children: VNodeFor<"TextOnPath">["children"] | VNodeFor<"Inline">["children"],
  nodeId: string,
): { sourceItemCount: number; inlineCount: number } {
  let sourceItemCount = 0;
  let inlineCount = 0;
  const frames: Array<{ children: Array<string | VNode>; childIndex: number }> = [
    { children, childIndex: 0 },
  ];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (!frame || frame.childIndex >= frame.children.length) {
      frames.pop();
      continue;
    }
    const child = frame.children[frame.childIndex];
    frame.childIndex += 1;
    sourceItemCount += 1;
    if (sourceItemCount > MAX_TEXT_PATH_SOURCE_ITEMS) {
      throw new FatalError(
        "TEXT_PATH_SOURCE_LIMIT",
        `TextOnPath source item count exceeds the limit ${MAX_TEXT_PATH_SOURCE_ITEMS}.`,
        { stage: "validate", nodeId },
      );
    }
    if (typeof child === "string") {
      continue;
    }
    if (!child || typeof child !== "object" || child.type !== "Inline") {
      throw new FatalError(
        "TEXT_PATH_CHILD_UNSUPPORTED",
        "TextOnPath children must be strings or Inline nodes.",
        { stage: "validate", nodeId },
      );
    }
    inlineCount += 1;
    if (inlineCount > MAX_TEXT_PATH_INLINE_CONTAINERS) {
      throw new FatalError(
        "TEXT_PATH_INLINE_LIMIT",
        `TextOnPath Inline count exceeds the limit ${MAX_TEXT_PATH_INLINE_CONTAINERS}.`,
        { stage: "validate", nodeId },
      );
    }
    validateTextOnPathInlineTransportNode(child, nodeId);
    frames.push({ children: child.children, childIndex: 0 });
  }
  return { sourceItemCount, inlineCount };
}

function validateTextOnPathInlineTransportNode(node: VNodeFor<"Inline">, nodeId: string): void {
  const unsupportedProp = Object.keys(node.props).find(
    (propName) => !TEXT_PATH_INLINE_TRANSPORT_PROPS.has(propName),
  );
  if (unsupportedProp !== undefined) {
    throw new FatalError(
      "TEXT_PATH_INLINE_PROP_UNSUPPORTED",
      `TextOnPath Inline does not support prop "${unsupportedProp}".`,
      { stage: "validate", nodeId },
    );
  }
  validateTextOnPathInlineTransportFontProps(node.props, nodeId);
  validateTextOnPathInlineTransportMetricProps(node.props, nodeId);
}

function validateTextOnPathInlineTransportFontProps(
  props: VNodeFor<"Inline">["props"],
  nodeId: string,
): void {
  if (props.font !== undefined && (typeof props.font !== "string" || props.font.trim() === "")) {
    throw new FatalError("TEXT_PATH_INVALID", "TextOnPath Inline font must be non-empty.", {
      stage: "validate",
      nodeId,
    });
  }
  if (
    props.fallback !== undefined &&
    (!Array.isArray(props.fallback) ||
      props.fallback.some((alias) => typeof alias !== "string" || alias.trim() === ""))
  ) {
    throw new FatalError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline fallback must contain non-empty font aliases.",
      { stage: "validate", nodeId },
    );
  }
  if (
    props.fontWeight !== undefined &&
    (typeof props.fontWeight !== "number" ||
      !Number.isInteger(props.fontWeight) ||
      props.fontWeight < 1 ||
      props.fontWeight > 1_000)
  ) {
    throw new FatalError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline fontWeight must be an integer from 1 to 1000.",
      { stage: "validate", nodeId },
    );
  }
  if (
    props.fontStyle !== undefined &&
    props.fontStyle !== "normal" &&
    props.fontStyle !== "italic"
  ) {
    throw new FatalError("TEXT_PATH_INVALID", "TextOnPath Inline fontStyle is invalid.", {
      stage: "validate",
      nodeId,
    });
  }
  if (
    (props.fontVariationSettings !== undefined &&
      typeof props.fontVariationSettings !== "string") ||
    (props.fontFeatureSettings !== undefined && typeof props.fontFeatureSettings !== "string")
  ) {
    throw new FatalError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline variation and feature settings must be strings.",
      { stage: "validate", nodeId },
    );
  }
}

function validateTextOnPathInlineTransportMetricProps(
  props: VNodeFor<"Inline">["props"],
  nodeId: string,
): void {
  if (
    props.fontSizePx !== undefined &&
    (typeof props.fontSizePx !== "number" ||
      !Number.isFinite(props.fontSizePx) ||
      props.fontSizePx <= 0)
  ) {
    throw new FatalError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline fontSizePx must be positive and finite.",
      { stage: "validate", nodeId },
    );
  }
  if (
    props.letterSpacingPx !== undefined &&
    (typeof props.letterSpacingPx !== "number" || !Number.isFinite(props.letterSpacingPx))
  ) {
    throw new FatalError("TEXT_PATH_INVALID", "TextOnPath Inline letterSpacingPx must be finite.", {
      stage: "validate",
      nodeId,
    });
  }
  if (
    props.language !== undefined &&
    props.language !== "ja" &&
    props.language !== "en" &&
    props.language !== "auto"
  ) {
    throw new FatalError("TEXT_PATH_INVALID", "TextOnPath Inline language is invalid.", {
      stage: "validate",
      nodeId,
    });
  }
}

function textDecorationToWasm(
  decoration: TextDecoration | undefined,
  fallbackColor: string,
): WasmTextDecoration | undefined {
  if (decoration === undefined || decoration === "none") {
    return undefined;
  }
  const lines = Array.isArray(decoration.line) ? [...decoration.line] : [decoration.line];
  return {
    ...decoration,
    line: lines,
    color: decoration.color ?? fallbackColor,
    style: decoration.style ?? "solid",
    thicknessPx: decoration.thicknessPx,
    offsetPx: decoration.offsetPx ?? 0,
    skipInk: decoration.skipInk ?? "none",
  };
}

function countAuthoredTextDecorationRanges(node: VNode): number {
  const hasAuthoredRange =
    (node.type === "Text" ||
      node.type === "TextOnPath" ||
      node.type === "Inline" ||
      node.type === "InlineBox" ||
      node.type === "Rt") &&
    node.props.textDecoration !== undefined &&
    node.props.textDecoration !== "none";
  let count = hasAuthoredRange ? 1 : 0;
  for (const child of node.children) {
    if (typeof child !== "string") {
      count += countAuthoredTextDecorationRanges(child);
    }
  }
  return count;
}

function vnodeToWasmInput(
  vnode: VNode,
  position: NodePosition,
  context: WasmInputContext,
): WasmNodeInput {
  const { canvasLanguage, shapeRegistry } = context;
  const { depth, siblingIndex, parentNodeId } = position;
  assertLayoutTreeDepth(vnode, depth);
  const { id: nodeId, authored: authoredId } = generateNodeId(vnode, {
    depth,
    siblingIndex,
    parentNodeId,
  });
  const style = mapToLayoutStyle(vnode);
  const wasmStyle = toWasmTaffyStyleInput(style);

  const result: WasmNodeInput = {
    nodeId,
    nodeType: vnode.type.toLowerCase(),
    authoredId,
    style: wasmStyle,
    children: [],
  };

  let visual = buildVisualInput(vnode, shapeRegistry);

  if (vnode.type === "Text") {
    const builtText = buildWasmTextInput(vnode, nodeId, canvasLanguage);
    result.text = builtText.text;
    if (Object.keys(builtText.inlineRectAnimations).length > 0) {
      visual ??= {};
      visual.inlineRectAnimations = builtText.inlineRectAnimations;
    }
    if (Object.keys(builtText.inlineDecorationAnimations).length > 0) {
      visual ??= {};
      visual.inlineDecorationAnimations = builtText.inlineDecorationAnimations;
    }
  } else if (vnode.type === "TextOnPath") {
    result.textPath = buildWasmTextPathInput(vnode, canvasLanguage);
  } else if (!hasWasmLayoutChildren(vnode.type)) {
    // Fixed-size leaves (size set via taffy-style-mapper). An Image measure
    // callback would impose its authored width as an automatic min-content
    // size, making its public flexShrink prop ineffective. Shape/Symbol
    // geometry compiles later, at IR build - layout never reads it.
    // No measure callback needed — Taffy uses the size from style directly
  } else {
    // Container nodes: recurse into children
    const vnodeChildren: VNode[] = [];
    for (const child of vnode.children) {
      if (typeof child !== "string") {
        vnodeChildren.push(child);
      }
    }
    const childLang =
      vnode.type === "Canvas"
        ? ((vnode.props.language as "ja" | "en" | "auto" | undefined) ?? canvasLanguage)
        : canvasLanguage;
    result.children = vnodeChildren.map((child, i) =>
      vnodeToWasmInput(
        child,
        { depth: depth + 1, siblingIndex: i, parentNodeId: nodeId },
        { canvasLanguage: childLang, shapeRegistry },
      ),
    );
  }

  if (visual) {
    result.visual = visual;
  }
  return result;
}

function richTextStyleToWasm(style: RichTextStyle): WasmRichTextStyle {
  return {
    fontFamily: [style.font, ...(style.fallback ?? [])],
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSizePx: style.fontSizePx,
    lineHeight: style.lineHeight,
    lineHeightPx: style.lineHeightPx,
    letterSpacingPx: style.letterSpacingPx,
    language: style.language,
    color: style.color,
    textStrokes: style.textStrokes,
    textShadows: style.textShadows,
    fontVariationSettings: style.fontVariationSettings,
    fontFeatureSettings: style.fontFeatureSettings,
    textOrientation: style.textOrientation,
    textDecoration: textDecorationToWasm(style.textDecoration, style.color),
  };
}

function richTextNodeToWasm(node: RichTextNode): WasmRichTextNode {
  switch (node.kind) {
    case "text":
      return node;
    case "span":
      return {
        kind: "span",
        text: node.text,
        style: richTextStyleToWasm(node.style),
      };
    case "combine":
      return {
        kind: "combine",
        text: node.text,
        style: richTextStyleToWasm(node.style),
        decorationRuns: node.decorationRuns?.map((run) => ({
          text: run.text,
          textDecoration: textDecorationToWasm(run.style.textDecoration, run.style.color),
        })),
      };
    case "ruby":
      return {
        kind: "ruby",
        rubyPosition: node.rubyPosition,
        rubyAlign: node.rubyAlign,
        rubyGapPx: node.rubyGapPx,
        rubyOffsetPx: node.rubyOffsetPx,
        rubyLineSizing: node.rubyLineSizing,
        style: richTextStyleToWasm(node.style),
        base: node.base.map((child) => richTextNodeToWasm(child)),
        rt: node.rt.map((child) => richTextNodeToWasm(child)),
        rtLevels: node.rtLevels?.map((level) => level.map((child) => richTextNodeToWasm(child))),
      };
    case "inlineBox":
      return {
        kind: "inlineBox",
        style: richTextStyleToWasm(node.style),
        children: node.children.map((child) => richTextNodeToWasm(child)),
        paddingInline: node.paddingInline,
        background: node.background,
        borderColor: node.borderColor,
        borderWidth: node.borderWidth,
        borderRadius: node.borderRadius,
        spanKey: node.spanKey,
      };
    case "inlineRect":
      return node;
    case "decoratedSpan":
      return {
        kind: "decoratedSpan",
        style: richTextStyleToWasm(node.style),
        children: node.children.map((child) => richTextNodeToWasm(child)),
        paddingInline: node.paddingInline,
        background: node.background,
        borderColor: node.borderColor,
        borderWidth: node.borderWidth,
        borderRadius: node.borderRadius,
        spanKey: node.spanKey,
      };
  }
}

// ---------------------------------------------------------------------------
// Build LayoutNode tree from WASM output
// ---------------------------------------------------------------------------

/** Parse resolved text layout from WASM output.
 *  Throws FatalError if required fields are missing — indicates a broken computeLayoutFn. */
function parseResolvedTextLayout(
  wasmTextLayout: NonNullable<WasmNodeOutput["textLayout"]>,
  nodeId: string,
): TextLayoutResult {
  if (!wasmTextLayout.lines || !wasmTextLayout.bbox || wasmTextLayout.chosenFontSizePx == null) {
    throw new FatalError(
      "TEXT_LAYOUT_MISSING_FIELDS",
      `computeLayoutFn returned textLayout for node "${nodeId}" without required ` +
        `resolved fields (lines, bbox, chosenFontSizePx). ` +
        `Custom computeLayoutFn implementations must include full text layout data.`,
      { stage: "layout", nodeId },
    );
  }

  return {
    lines: wasmTextLayout.lines.map((line) => ({
      text: line.text,
      glyphs: line.glyphs,
      width: line.width,
      baselineY: line.baselineY,
      fragments: line.fragments?.map((fragment): LineFragment => {
        const style = parseFragmentStyle(fragment.style);
        return {
          text: fragment.text,
          glyphs: fragment.glyphs,
          width: fragment.width,
          ...(style ? { style } : {}),
        };
      }),
      positionedGlyphs: line.positionedGlyphs,
    })),
    bbox: wasmTextLayout.bbox,
    chosenFontSizePx: wasmTextLayout.chosenFontSizePx,
    overflow: parseTextOverflow(wasmTextLayout.overflow),
    ...(wasmTextLayout.sourceText !== undefined ? { sourceText: wasmTextLayout.sourceText } : {}),
    ...(wasmTextLayout.displayText !== undefined
      ? { displayText: wasmTextLayout.displayText }
      : {}),
    ...(wasmTextLayout.unitMap ? { unitMap: wasmTextLayout.unitMap } : {}),
    ...(wasmTextLayout.warnings?.length ? { warnings: wasmTextLayout.warnings } : {}),
    ...(wasmTextLayout.inlineBoxDecorations?.length
      ? { inlineBoxDecorations: wasmTextLayout.inlineBoxDecorations }
      : {}),
    ...(wasmTextLayout.textDecorations?.length
      ? { textDecorations: wasmTextLayout.textDecorations }
      : {}),
    ...(wasmTextLayout.inlineRects?.length ? { inlineRects: wasmTextLayout.inlineRects } : {}),
  };
}

function parseFragmentStyle(style: WasmTextLayoutFragmentStyle): TextRunStyle | undefined {
  if (!style || style.color == null) {
    return undefined;
  }

  return {
    font: style.font,
    fallback: style.fallback,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSizePx: style.fontSizePx,
    letterSpacingPx: style.letterSpacingPx,
    textOrientation: style.textOrientation,
    fontVariationSettings: style.fontVariationSettings,
    fontFeatureSettings: style.fontFeatureSettings,
    color: style.color,
    language: style.language,
  };
}

function buildLayoutTree(
  vnode: VNode,
  outputMap: Map<string, WasmNodeOutput>,
  position: NodePosition,
): LayoutNode {
  const { depth, siblingIndex, parentNodeId } = position;
  const { id: nodeId } = generateNodeId(vnode, { depth, siblingIndex, parentNodeId });
  const output = outputMap.get(nodeId);

  const bbox: BBox = output
    ? { x: output.x, y: output.y, width: output.width, height: output.height }
    : { x: 0, y: 0, width: 0, height: 0 };

  const textLayout: TextMeasureResult | undefined = output?.textLayout
    ? {
        measuredWidth: output.textLayout.measuredWidth,
        measuredHeight: output.textLayout.measuredHeight,
        glyphs: output.textLayout.glyphs,
        resolvedTextLayout: parseResolvedTextLayout(output.textLayout, nodeId),
      }
    : undefined;

  const vnodeChildren: VNode[] = [];
  for (const child of vnode.children) {
    if (typeof child !== "string") {
      vnodeChildren.push(child);
    }
  }

  return {
    nodeId,
    vnode,
    bbox,
    children: vnodeChildren.map((child, i) =>
      buildLayoutTree(child, outputMap, {
        depth: depth + 1,
        siblingIndex: i,
        parentNodeId: nodeId,
      }),
    ),
    textLayout,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build Taffy tree from VNode and compute layout via WASM.
 *
 * The VNode tree is serialized to JSON, sent to the WASM `compute_layout`
 * function, and the results are mapped back to a LayoutNode tree.
 */
// Fonts passed via ComputeLayoutOptions are re-sent on every call; converting
// multi-MB Uint8Arrays to number[] each render dominates payload build time,
// so the conversion is cached by buffer identity for the buffer's lifetime.
const wasmFontDataCache = new WeakMap<Uint8Array, number[]>();

function toWasmFontData(data: Uint8Array): number[] {
  const cached = wasmFontDataCache.get(data);
  if (cached) {
    return cached;
  }
  const converted = Array.from(data);
  wasmFontDataCache.set(data, converted);
  return converted;
}

/**
 * Serialize a VNode tree (plus fonts) into the layout transport JSON that
 * every WASM render entry point consumes (`compute_layout`, `render_to_ir`,
 * `render_to_svg`). Shared by `computeLayout` and the engine's wasm emit
 * backend so both paths send byte-identical payloads.
 */
export function buildLayoutTransportJson(
  rootVNode: VNode,
  options: Pick<ComputeLayoutOptions, "fonts" | "shapeRegistry">,
): string {
  const wasmRoot = vnodeToWasmInput(
    rootVNode,
    { depth: 0, siblingIndex: 0 },
    { shapeRegistry: options.shapeRegistry },
  );

  const wasmFonts: WasmFontInput[] = (options.fonts ?? []).map((font) => ({
    alias: font.alias,
    weight: font.weight ?? DEFAULT_FONT_WEIGHT,
    style: font.style ?? "normal",
    data: toWasmFontData(font.data),
  }));

  const input: WasmLayoutInput = {
    root: wasmRoot,
    fonts: wasmFonts,
  };

  return JSON.stringify(input);
}

export function computeLayout(rootVNode: VNode, options: ComputeLayoutOptions): LayoutResult {
  const inputJson = buildLayoutTransportJson(rootVNode, options);
  const outputJson = options.computeLayoutFn(inputJson);
  const output = parseWasmLayoutOutput(outputJson);

  // Build output map for O(1) lookup
  const outputMap = new Map<string, WasmNodeOutput>();
  for (const node of output.nodes) {
    outputMap.set(node.nodeId, node);
  }

  const root = buildLayoutTree(rootVNode, outputMap, { depth: 0, siblingIndex: 0 });

  return {
    root,
    measureCallCount: output.measureCallCount,
  };
}
