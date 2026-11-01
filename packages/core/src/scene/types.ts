import type { GeometryDoc, SymbolDefinition, Transform2D } from "../shape/types.js";
import type { TextDecoration, TextShadowLayer, TextStrokeLayer } from "../text/types.js";
import type {
  AnimationSpec,
  BoxOutlineStyle,
  PartPaintOverride,
  StrokeScaling,
  TextFlowExclusion,
  TextUnitAnimation,
} from "../vnode/types.js";

/**
 * SceneDocument — typed, JSON-serializable engine input contract.
 *
 * Unlike VNode (which uses a discriminated union of typed props/children), SceneNode uses
 * explicit typed fields per component type. This enables:
 * - Worker/CLI direct construction without JSX
 * - JSON serialization for cross-context messaging
 * - Type-safe prop access without casts
 *
 * Image.src is always a string (data URI), not Uint8Array.
 */

// ---------------------------------------------------------------------------
// Shared types (mirrors vnode/types.ts)
// ---------------------------------------------------------------------------

/** Padding / margin shorthand: uniform number or [top, right, bottom, left] */
export type Spacing = number | [number, number, number, number];

/** Border radius: uniform number or [topLeft, topRight, bottomRight, bottomLeft] */
type BorderRadius = number | [number, number, number, number];

/** Plain text or rich inline content accepted by a Text scene node. */
export type TextSceneChild =
  | string
  | InlineSceneNode
  | InlineBoxSceneNode
  | InlineRectSceneNode
  | RubySceneNode;
/** Plain text, nested Inline, InlineRect, or Ruby content accepted inside Inline. */
export type InlineSceneChild = string | InlineSceneNode | InlineRectSceneNode | RubySceneNode;
/** Rich inline content accepted inside a layout-bearing inline box. */
export type InlineBoxSceneChild =
  | string
  | InlineSceneNode
  | InlineBoxSceneNode
  | InlineRectSceneNode
  | RubySceneNode;
/** Ruby base text and annotation containers accepted inside Ruby. */
export type RubySceneChild = string | InlineSceneNode | RtSceneNode;
/** Annotation text or styled Inline content accepted inside Rt. */
export type RtSceneChild = string | InlineSceneNode;
/** Path text content; only strings and restricted Inline spans are accepted. */
export type TextOnPathSceneChild = string | TextOnPathInlineSceneNode;

// ---------------------------------------------------------------------------
// Shared prop mixins (used to compose node interfaces without duplication)
// ---------------------------------------------------------------------------

type PositionProps = {
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type BoxModelProps = {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  padding?: Spacing;
  margin?: Spacing;
};

type VisualBoxProps = {
  background?: string;
  boxShadow?: string;
  borderRadius?: BorderRadius;
  borderWidth?: Spacing;
  borderColor?: string;
  outline?: BoxOutlineStyle;
  overflow?: "visible" | "clip";
  opacity?: number;
  zIndex?: number;
};

type FlexItemProps = {
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
};

type GridItemProps = {
  gridColumn?: string;
  gridRow?: string;
};

type LayerProps = {
  layer?: string;
};

type TransformProps = {
  transform?: Transform2D;
};

type AnimationProps = {
  animate?: AnimationSpec;
};

type EventHandlerProps = {
  onClick?: string;
  onDoubleClick?: string;
  onPointerMove?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
  onContextMenu?: string;
  onMouseDown?: string;
  onMouseUp?: string;
  onMouseMove?: string;
  onMouseEnter?: string;
  onMouseLeave?: string;
  onMouseOver?: string;
  onMouseOut?: string;
  onTouchStart?: string;
  onTouchEnd?: string;
  onTouchMove?: string;
};

// ---------------------------------------------------------------------------
// Scene node types
// ---------------------------------------------------------------------------

/** JSON scene root defining the output canvas and its child layout tree. */
export type CanvasSceneNode = EventHandlerProps & {
  type: "Canvas";
  id?: string;
  meta?: Record<string, string>;
  width: number;
  height: number;
  background?: string;
  debug?: boolean;
  language?: "ja" | "en" | "auto";
  children: SceneNode[];
};

/** JSON flex container with layout-reserving borders and optional paint-only outline. */
export type FlexSceneNode = PositionProps &
  BoxModelProps &
  VisualBoxProps &
  FlexItemProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "Flex";
    id?: string;
    meta?: Record<string, string>;
    direction?: "row" | "column";
    wrap?: "nowrap" | "wrap";
    alignItems?: "start" | "center" | "end" | "stretch";
    justifyContent?: "start" | "center" | "end" | "space-between" | "space-around";
    gap?: number;
    rowGap?: number;
    columnGap?: number;
    children: SceneNode[];
  };

/** JSON grid container with layout-reserving borders and optional paint-only outline. */
export type GridSceneNode = PositionProps &
  BoxModelProps &
  VisualBoxProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "Grid";
    id?: string;
    meta?: Record<string, string>;
    templateColumns?: string;
    templateRows?: string;
    gap?: number;
    rowGap?: number;
    columnGap?: number;
    alignItems?: "start" | "center" | "end" | "stretch";
    justifyItems?: "start" | "center" | "end" | "stretch";
    alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
    children: SceneNode[];
  };

/** JSON box container with layout-reserving borders and optional paint-only outline. */
export type BoxSceneNode = PositionProps &
  BoxModelProps &
  VisualBoxProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "Box";
    id?: string;
    meta?: Record<string, string>;
    children: SceneNode[];
  };

/** JSON text block with typography, inherited paint, and rich inline children. */
export type TextSceneNode = PositionProps &
  BoxModelProps &
  FlexItemProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "Text";
    id?: string;
    meta?: Record<string, string>;
    // Font
    font: string;
    fontWeight?: number;
    fontStyle?: "normal" | "italic";
    fallback?: string[];
    fontVariationSettings?: string;
    fontFeatureSettings?: string;
    writingMode?: "horizontal-tb" | "vertical-rl";
    textOrientation?: "mixed" | "upright";
    // Size
    fontSizePx: number;
    // Line
    lineHeight?: number;
    lineHeightPx?: number;
    // Spacing
    letterSpacingPx?: number;
    textIndent?: number;
    // Color
    color?: string;
    textDecoration?: TextDecoration;
    // Stroke
    textStroke?: string;
    textStrokeWidth?: number;
    textStrokeLinecap?: "butt" | "round" | "square";
    textStrokeLinejoin?: "miter" | "round" | "bevel";
    textStrokeDasharray?: string;
    textStrokeMiterlimit?: number;
    textStrokes?: readonly TextStrokeLayer[];
    textShadows?: readonly TextShadowLayer[];
    animateUnits?: TextUnitAnimation;
    // Wrapping / Fit
    wrap?: "none" | "word" | "char";
    fit?: "none" | "shrink" | "grow";
    maxLines?: number;
    ellipsis?: boolean;
    // Alignment
    textAlign?: "start" | "center" | "end";
    // Constraint
    preferredFrame?: { w?: number; h?: number };
    // Kinsoku
    language?: "ja" | "en" | "auto";
    hangingPunctuation?: boolean;
    // Shrink params
    minFontSizePx?: number;
    shrinkEpsilonPx?: number;
    shrinkMaxIterations?: number;
    // Grow params
    maxFontSizePx?: number;
    growEpsilonPx?: number;
    growMaxIterations?: number;
    fitMaxProbes?: number;
    // Box model
    padding?: Spacing;
    margin?: Spacing;
    opacity?: number;
    zIndex?: number;
    whiteSpace?: "normal" | "nowrap" | "pre-wrap";
    tabSize?: number;
    flowExclusions?: readonly TextFlowExclusion[];
    flowMinRegionWidthPx?: number;
    children: TextSceneChild[];
  };

/** JSON text node laid out along a path using the restricted path-text child grammar. */
export type TextOnPathSceneNode = PositionProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "TextOnPath";
    id?: string;
    meta?: Record<string, string>;
    d: string;
    width: number;
    height: number;
    font: string;
    fallback?: string[];
    fontWeight?: number;
    fontStyle?: "normal" | "italic";
    fontVariationSettings?: string;
    fontFeatureSettings?: string;
    fontSizePx: number;
    letterSpacingPx?: number;
    language?: "ja" | "en" | "auto";
    color?: string;
    startOffsetPx?: number;
    textAnchor?: "start" | "middle" | "end";
    pathDirection?: "forward" | "reverse";
    pathNormal?: "left" | "right";
    pathOffsetPx?: number;
    pathFit?: "none" | "spacing" | "scale" | "shrink";
    pathOverflow?: "hidden" | "error" | "ellipsis";
    textStroke?: string;
    textStrokeWidth?: number;
    textStrokeLinecap?: "butt" | "round" | "square";
    textStrokeLinejoin?: "miter" | "round" | "bevel";
    textStrokeDasharray?: string;
    textStrokeMiterlimit?: number;
    textStrokes?: readonly TextStrokeLayer[];
    textShadows?: readonly TextShadowLayer[];
    textDecoration?: TextDecoration;
    animateUnits?: TextUnitAnimation;
    opacity?: number;
    zIndex?: number;
    margin?: Spacing;
    children: TextOnPathSceneChild[];
  };

/** Shaping and paint Inline node accepted inside TextOnPath. */
export type TextOnPathInlineSceneNode = {
  type: "Inline";
  font?: string;
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  fontSizePx?: number;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  color?: string;
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];
  textDecoration?: TextDecoration;
  children: TextOnPathSceneChild[];
};

/** JSON styled inline span whose text paint inherits through its parent. */
export type InlineSceneNode = {
  type: "Inline";
  font?: string;
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  textOrientation?: "mixed" | "upright";
  textCombineUpright?: "none" | "all";
  fontSizePx?: number;
  letterSpacingPx?: number;
  color?: string;
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];
  textDecoration?: TextDecoration;
  language?: "ja" | "en" | "auto";
  paddingInline?: [number, number];
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: [number, number, number, number];
  /** Declarative post-layout animation for this Inline's decoration fragments. */
  animate?: AnimationSpec;
  children: InlineSceneChild[];
};

/** JSON inline layout box with its own rich-text children and box decoration. */
export type InlineBoxSceneNode = {
  type: "InlineBox";
  font?: string;
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx?: number;
  letterSpacingPx?: number;
  color?: string;
  textDecoration?: TextDecoration;
  language?: "ja" | "en" | "auto";
  paddingInline?: [number, number];
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  /** Declarative post-layout animation for this box's decoration fragment. */
  animate?: AnimationSpec;
  children: InlineBoxSceneChild[];
};

/** JSON childless inline rectangle contributing size and paint to a text line. */
export type InlineRectSceneNode = {
  type: "InlineRect";
  inlineSizePx: number;
  blockSizePx?: number | "line";
  advancePx?: number;
  blockAlign?: "start" | "center" | "end";
  color: string;
  borderRadiusPx?: number;
  opacity?: number;
  paintOrder?: "behind" | "front";
  animate?: AnimationSpec;
};

/** JSON ruby container separating base content from annotation levels. */
export type RubySceneNode = {
  type: "Ruby";
  rubyPosition?: "over" | "under" | "alternate" | "inter-character";
  rubyAlign?: "start" | "center" | "space-between" | "space-around";
  rubyGapPx?: number;
  rubyOffsetPx?: number;
  rubyLineSizing?: "stable" | "css";
  children: RubySceneChild[];
};

/** JSON ruby annotation container with its own inline typography. */
export type RtSceneNode = {
  type: "Rt";
  font?: string;
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  fontSizePx?: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  color?: string;
  textDecoration?: TextDecoration;
  language?: "ja" | "en" | "auto";
  textOrientation?: "mixed" | "upright";
  children: RtSceneChild[];
};

/** JSON childless image node whose source is a string suitable for serialization. */
export type ImageSceneNode = PositionProps &
  FlexItemProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "Image";
    id?: string;
    meta?: Record<string, string>;
    /** Data URI string (not Uint8Array — must be pre-encoded for JSON serialization) */
    src: string;
    mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
    width: number;
    height: number;
    objectFit?: "fill" | "contain" | "cover";
    objectPosition?: string;
    borderRadius?: BorderRadius;
    opacity?: number;
    zIndex?: number;
    margin?: Spacing;
  };

/** JSON SVG-path primitive with explicit dimensions and independent fill/stroke paint. */
export type PathSceneNode = PositionProps &
  FlexItemProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "Path";
    id?: string;
    meta?: Record<string, string>;
    d: string;
    width: number;
    height: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeScaling?: StrokeScaling;
    fillRule?: "nonzero" | "evenodd";
    strokeLinecap?: "butt" | "round" | "square";
    strokeLinejoin?: "miter" | "round" | "bevel";
    strokeDasharray?: string;
    strokeMiterlimit?: number;
    opacity?: number;
    zIndex?: number;
    margin?: Spacing;
  };

/** JSON embedded SVG document with explicit dimensions and outer node transforms. */
export type SvgSceneNode = PositionProps &
  FlexItemProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  LayerProps &
  EventHandlerProps & {
    type: "Svg";
    id?: string;
    meta?: Record<string, string>;
    content: string;
    width: number;
    height: number;
    preserveAspectRatio?: "none" | "meet" | "slice";
    /**
     * Prefix for exact embedded `id` attributes and their supported same-document references.
     * A non-empty prefix enables structural validation and fails on unsafe known-local syntax.
     */
    contentIdPrefix?: string;
    opacity?: number;
    zIndex?: number;
    margin?: Spacing;
  };

type ShapeSceneBase = PositionProps &
  FlexItemProps &
  GridItemProps &
  TransformProps &
  AnimationProps &
  EventHandlerProps & {
    id?: string;
    meta?: Record<string, string>;
    width: number;
    height: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    fillRule?: "nonzero" | "evenodd";
    strokeLinecap?: "butt" | "round" | "square";
    strokeLinejoin?: "miter" | "round" | "bevel";
    strokeDasharray?: string;
    strokeMiterlimit?: number;
    preserveAspectRatio?: "none" | "meet" | "slice";
    emitPartIds?: boolean;
    partPaint?: Record<string, PartPaintOverride>;
    layer?: string;
    opacity?: number;
    zIndex?: number;
    margin?: Spacing;
  };

/** JSON geometry node using an inline or registered geometry document. */
export type ShapeSceneNode = ShapeSceneBase & {
  type: "Shape";
  geometry?: GeometryDoc;
  geometryId?: string;
};

/** JSON symbol node using an inline or registered elastic symbol definition. */
export type SymbolSceneNode = ShapeSceneBase & {
  type: "Symbol";
  symbol?: SymbolDefinition;
  symbolId?: string;
};

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/** Discriminated JSON scene-node union used by structural decoding and VNode conversion. */
export type SceneNode =
  | CanvasSceneNode
  | FlexSceneNode
  | GridSceneNode
  | BoxSceneNode
  | TextSceneNode
  | TextOnPathSceneNode
  | InlineSceneNode
  | InlineBoxSceneNode
  | InlineRectSceneNode
  | RubySceneNode
  | RtSceneNode
  | ImageSceneNode
  | PathSceneNode
  | SvgSceneNode
  | ShapeSceneNode
  | SymbolSceneNode;
