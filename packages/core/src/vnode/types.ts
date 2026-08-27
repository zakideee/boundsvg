import type { GeometryDoc, SymbolDefinition, Transform2D } from "../shape/types.js";
import type { TextDecoration, TextShadowLayer, TextStrokeLayer } from "../text/types.js";

/** Component type identifiers */
export type VNodeType =
  | "Canvas"
  | "Flex"
  | "Grid"
  | "Box"
  | "Text"
  | "TextOnPath"
  | "Inline"
  | "InlineBox"
  | "InlineRect"
  | "Ruby"
  | "Rt"
  | "Image"
  | "Path"
  | "Svg"
  | "Shape"
  | "Symbol";

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

/** Padding / margin shorthand: uniform number or [top, right, bottom, left] */
export type Spacing = number | [number, number, number, number];

/** Post-layout transform channels supported by declarative animation. */
export type AnimationTransform2D = Omit<Transform2D, "originX" | "originY">;

export type AnimationKeyframe = {
  /** Normalized offset in the inclusive range 0..1. */
  at: number;
  opacity?: number;
  transform?: AnimationTransform2D;
};

export type AnimationStepPosition = "jump-start" | "jump-end" | "jump-none" | "jump-both";

type AnimationSteps = {
  type: "steps";
  count: number;
  position?: AnimationStepPosition;
};

/**
 * Damped-spring easing evaluated in closed form.
 *
 * Omitted parameters default to stiffness 100 / damping 10 / mass 1. Declarative
 * SVG output expands the curve into a fixed-point CSS `linear()` function.
 */
export type AnimationSpring = {
  type: "spring";
  /** 1..1000. */
  stiffness?: number;
  /** 1..100. */
  damping?: number;
  /** 0.1..10. */
  mass?: number;
};

export type AnimationEasing =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step-start"
  | "step-end"
  | readonly [number, number, number, number]
  | AnimationSpring
  | AnimationSteps;

/** Declarative, post-layout animation attached to one logical node. */
export type AnimationSpec = {
  keyframes: readonly AnimationKeyframe[];
  durationMs: number;
  delayMs?: number;
  easing?: AnimationEasing;
  iterations?: number | "infinite";
  fill?: "none" | "both";
};

/** Post-layout animation applied independently to resolved text paint units. */
export type TextUnitAnimation = {
  /** Shaping-cluster or resolved line/column targeting. */
  by: "cluster" | "line";
  animation: AnimationSpec;
  /** Linear stagger added to the animation delay for each unit. Defaults to 0. */
  delayStepMs?: number;
  /**
   * Selects only the stagger index; glyph paint order is never changed.
   * `visual` follows the current resolved inline-axis placement and does not
   * add Unicode bidi reordering. Defaults to `logical`.
   */
  order?: "logical" | "visual";
  /** Whether ruby annotations share their base unit. Defaults to with-base. */
  ruby?: "with-base" | "separate";
};

/** Edge-specific clearance around a text-flow exclusion. */
export type TextFlowExclusionMarginPx =
  | number
  | {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };

/** Geometry excluded from a Text node's local layout frame. */
export type TextFlowExclusion =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      marginPx?: TextFlowExclusionMarginPx;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      marginPx?: TextFlowExclusionMarginPx;
    }
  | {
      kind: "path";
      d: string;
      x?: number;
      y?: number;
      fillRule?: "nonzero" | "evenodd";
      marginPx?: TextFlowExclusionMarginPx;
    };

/** Canvas — root container (must be unique root) */
export type CanvasProps = {
  width: number;
  height: number;
  background?: string;
  debug?: boolean;
  language?: "ja" | "en" | "auto";
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
  children?: VNodeChild;
};

/** Border radius: uniform number or [topLeft, topRight, bottomRight, bottomLeft] */
export type BorderRadius = number | [number, number, number, number];

/** Whether a supported stroke scales with post-layout transforms or stays stable in canvas space. */
export type StrokeScaling = "transform" | "canvas";

/** Flex — flex container */
export type FlexProps = {
  // Container
  direction?: "row" | "column";
  wrap?: "nowrap" | "wrap";
  alignItems?: "start" | "center" | "end" | "stretch";
  justifyContent?: "start" | "center" | "end" | "space-between" | "space-around";
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  // Flex item (when Flex is a child)
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  // Grid item (when Flex is a child of Grid)
  gridColumn?: string;
  gridRow?: string;
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  // Box model
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Aspect ratio (width / height) */
  aspectRatio?: number;
  padding?: Spacing;
  margin?: Spacing;
  // Visual
  background?: string;
  /** Box shadow: "offsetX offsetY blur spread color" (e.g. "0 4 8 0 rgba(0,0,0,0.2)") */
  boxShadow?: string;
  borderRadius?: BorderRadius;
  borderWidth?: number;
  borderColor?: string;
  /** Border width behavior under post-layout transforms. Defaults to "transform". */
  strokeScaling?: StrokeScaling;
  /** Stroke line cap for border */
  strokeLinecap?: "butt" | "round" | "square";
  /** Stroke line join for border */
  strokeLinejoin?: "miter" | "round" | "bevel";
  /** Stroke dash pattern for border (e.g. "5,5") */
  strokeDasharray?: string;
  /** Stroke miter limit for border */
  strokeMiterlimit?: number;
  overflow?: "visible" | "clip";
  /** Opacity (0-1) */
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  /** Static post-layout paint transform */
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  /** Logical layer assignment hint for layered SVG export */
  layer?: string;
  // Event handlers
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  // Identity
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
  children?: VNodeChild;
};

/** Grid — CSS Grid container */
export type GridProps = {
  // Grid template
  templateColumns?: string; // e.g. "100px 1fr 2fr"
  templateRows?: string; // e.g. "auto 100px"
  // Gap
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  // Alignment
  alignItems?: "start" | "center" | "end" | "stretch";
  justifyItems?: "start" | "center" | "end" | "stretch";
  // Grid item props (when Grid is a child)
  gridColumn?: string; // e.g. "1 / 3"
  gridRow?: string; // e.g. "2 / span 2"
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  // Box model
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Aspect ratio (width / height) */
  aspectRatio?: number;
  padding?: Spacing;
  margin?: Spacing;
  // Visual
  background?: string;
  /** Box shadow: "offsetX offsetY blur spread color" (e.g. "0 4 8 0 rgba(0,0,0,0.2)") */
  boxShadow?: string;
  borderRadius?: BorderRadius;
  borderWidth?: number;
  borderColor?: string;
  /** Border width behavior under post-layout transforms. Defaults to "transform". */
  strokeScaling?: StrokeScaling;
  /** Stroke line cap for border */
  strokeLinecap?: "butt" | "round" | "square";
  /** Stroke line join for border */
  strokeLinejoin?: "miter" | "round" | "bevel";
  /** Stroke dash pattern for border (e.g. "5,5") */
  strokeDasharray?: string;
  /** Stroke miter limit for border */
  strokeMiterlimit?: number;
  overflow?: "visible" | "clip";
  /** Opacity (0-1) */
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  /** Static post-layout paint transform */
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  /** Logical layer assignment hint for layered SVG export */
  layer?: string;
  // Event handlers
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  // Identity
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
  children?: VNodeChild;
};

/** Box — simple container (internally flex direction=column) */
export type BoxProps = {
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Aspect ratio (width / height) */
  aspectRatio?: number;
  padding?: Spacing;
  margin?: Spacing;
  background?: string;
  /** Box shadow: "offsetX offsetY blur spread color" (e.g. "0 4 8 0 rgba(0,0,0,0.2)") */
  boxShadow?: string;
  borderRadius?: BorderRadius;
  borderWidth?: number;
  borderColor?: string;
  /** Border width behavior under post-layout transforms. Defaults to "transform". */
  strokeScaling?: StrokeScaling;
  /** Stroke line cap for border */
  strokeLinecap?: "butt" | "round" | "square";
  /** Stroke line join for border */
  strokeLinejoin?: "miter" | "round" | "bevel";
  /** Stroke dash pattern for border (e.g. "5,5") */
  strokeDasharray?: string;
  /** Stroke miter limit for border */
  strokeMiterlimit?: number;
  overflow?: "visible" | "clip";
  /** Opacity (0-1) */
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  /** Static post-layout paint transform */
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  /** Logical layer assignment hint for layered SVG export */
  layer?: string;
  // Grid item (when Box is a child of Grid)
  gridColumn?: string;
  gridRow?: string;
  // Event handlers
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
  children?: VNodeChild;
};

/** Text — text content */
export type TextProps = {
  // Font
  font: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fallback?: string[];
  /** Variable font settings, e.g. "'wght' 700, 'wdth' 125" */
  fontVariationSettings?: string;
  /** OpenType feature settings, e.g. "'liga' 0, 'smcp' 1" */
  fontFeatureSettings?: string;
  /** Writing mode: horizontal (default) or vertical */
  writingMode?: "horizontal-tb" | "vertical-rl";
  /** Character orientation in vertical text */
  textOrientation?: "mixed" | "upright";
  // Size
  fontSizePx: number;
  /**
   * Layout size constraints (Taffy style). `preferredFrame` remains the
   * text-measurement frame; when both are set, width/height constrain the
   * layout box and preferredFrame constrains measurement inside it.
   */
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  // Line
  lineHeight?: number;
  lineHeightPx?: number;
  // Spacing
  letterSpacingPx?: number;
  /** Indent applied to the first line/column in px */
  textIndent?: number;
  // Color
  color?: string;
  textDecoration?: TextDecoration;
  // Stroke
  textStroke?: string;
  textStrokeWidth?: number;
  /** Stroke line cap for text stroke */
  textStrokeLinecap?: "butt" | "round" | "square";
  /** Stroke line join for text stroke (default: "round") */
  textStrokeLinejoin?: "miter" | "round" | "bevel";
  /** Stroke dash pattern for text stroke (e.g. "5,5") */
  textStrokeDasharray?: string;
  /** Stroke miter limit for text stroke */
  textStrokeMiterlimit?: number;
  /**
   * Multi-layer text outline; index 0 is the outermost layer (painted first).
   * Mutually exclusive with the scalar textStroke* props.
   */
  textStrokes?: readonly TextStrokeLayer[];
  /** Drop shadows painted below all stroke layers; index 0 is the bottom layer. */
  textShadows?: readonly TextShadowLayer[];
  // Wrapping / Fit
  wrap?: "none" | "word" | "char";
  /** Whitespace handling: "normal" (default), "nowrap", or "pre-wrap" */
  whiteSpace?: "normal" | "nowrap" | "pre-wrap";
  /** Number of spaces used when expanding tabs in pre-wrap text. */
  tabSize?: number;
  /** Shape geometry excluded from this Text node's local layout frame. */
  flowExclusions?: readonly TextFlowExclusion[];
  /** Minimum usable inline extent between flow exclusions. */
  flowMinRegionWidthPx?: number;
  fit?: "none" | "shrink" | "grow";
  maxLines?: number;
  ellipsis?: boolean;
  // Alignment
  textAlign?: "start" | "center" | "end";
  // Constraint (Frame mode)
  preferredFrame?: { w?: number; h?: number };
  // Kinsoku
  language?: "ja" | "en" | "auto";
  /** Enable hanging punctuation (line-end punctuation extends past maxWidth) */
  hangingPunctuation?: boolean;
  // Shrink params
  minFontSizePx?: number;
  shrinkEpsilonPx?: number;
  shrinkMaxIterations?: number;
  // Grow params
  maxFontSizePx?: number;
  growEpsilonPx?: number;
  growMaxIterations?: number;
  /** Maximum exact-grid fit evaluations for uncertified content or geometry. */
  fitMaxProbes?: number;
  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  // Grid item
  gridColumn?: string;
  gridRow?: string;
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  // Box model
  padding?: Spacing;
  margin?: Spacing;
  /** Opacity (0-1) */
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  /** Static post-layout paint transform */
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  /** Declarative animation of resolved cluster or line paint units. */
  animateUnits?: TextUnitAnimation;
  /** Logical layer assignment hint for layered SVG export */
  layer?: string;
  // Event handlers
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  // Identity
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
  children?: VNodeJsxChildFor<"Text">;
};

/** TextOnPath — single-line plain or shaping-rich text on one open or authored-closed SVG path. */
export type TextOnPathProps = {
  /** Node-local SVG path data. Exactly one non-empty drawable subpath. */
  d: string;
  /** Explicit layout frame. Path coordinates are local px in this frame. */
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
  opacity?: number;
  zIndex?: number;
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  margin?: Spacing;
  animate?: AnimationSpec;
  animateUnits?: TextUnitAnimation;
  layer?: string;
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  id?: string;
  meta?: Readonly<Record<string, string>>;
  children?: VNodeJsxChildFor<"TextOnPath">;
};

/** Inline — span-like text run override inside Text */
export type InlineProps = {
  // Font overrides
  font?: string;
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontVariationSettings?: string;
  /** OpenType feature settings, e.g. "'liga' 0, 'smcp' 1" */
  fontFeatureSettings?: string;
  /** Character orientation in vertical text */
  textOrientation?: "mixed" | "upright";
  /** Tate-chu-yoko / text-combine-upright */
  textCombineUpright?: "none" | "all";
  // Typography overrides
  fontSizePx?: number;
  letterSpacingPx?: number;
  // Color / language overrides
  color?: string;
  /** Replace the inherited stroke category; an empty array explicitly clears it. */
  textStrokes?: readonly TextStrokeLayer[];
  /** Replace the inherited shadow category; an empty array explicitly clears it. */
  textShadows?: readonly TextShadowLayer[];
  textDecoration?: TextDecoration;
  language?: "ja" | "en" | "auto";
  // Decoration (fragmentable: wraps across lines unlike InlineBox)
  paddingInline?: [number, number];
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  /** Per-corner border radii [topLeft, topRight, bottomRight, bottomLeft] */
  borderRadius?: [number, number, number, number];
  /**
   * Declarative post-layout animation applied to this Inline's decoration
   * fragments (background/border boxes). Requires a decoration prop; glyphs
   * animate through the parent Text's `animateUnits` instead.
   */
  animate?: AnimationSpec;
  children?: VNodeJsxChildFor<"Inline">;
};

/** InlineBox — decorated atomic inline box inside Text */
export type InlineBoxProps = {
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
  /**
   * Declarative post-layout animation applied to this box's decoration
   * fragment (background/border). Requires a decoration prop; glyphs animate
   * through the parent Text's `animateUnits` instead.
   */
  animate?: AnimationSpec;
  children?: VNodeJsxChildFor<"InlineBox">;
};

/** InlineRect — childless atomic paint primitive inside a Text rich flow. */
export type InlineRectProps = {
  /** Painted logical inline extent. */
  inlineSizePx: number;
  /** Painted logical block extent. Defaults to the resolved line extent. */
  blockSizePx?: number | "line";
  /** Inline advance consumed by layout and following content. Defaults to 0. */
  advancePx?: number;
  /** Cross-axis alignment for a numeric blockSizePx. Defaults to center. */
  blockAlign?: "start" | "center" | "end";
  color: string;
  borderRadiusPx?: number;
  opacity?: number;
  /** Paint below or above the text paint stack. Defaults to front. */
  paintOrder?: "behind" | "front";
  /** Declarative post-layout animation for this generated fragment. */
  animate?: AnimationSpec;
};

/** Ruby — inline ruby annotation container */
export type RubyProps = {
  rubyPosition?: "over" | "under" | "alternate" | "inter-character";
  rubyAlign?: "start" | "center" | "space-between" | "space-around";
  rubyGapPx?: number;
  rubyOffsetPx?: number;
  rubyLineSizing?: "stable" | "css";
  children?: VNodeJsxChildFor<"Ruby">;
};

/** Rt — ruby annotation text */
export type RtProps = {
  font?: string;
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontVariationSettings?: string;
  /** OpenType feature settings, e.g. "'liga' 0, 'smcp' 1" */
  fontFeatureSettings?: string;
  fontSizePx?: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  color?: string;
  textDecoration?: TextDecoration;
  language?: "ja" | "en" | "auto";
  textOrientation?: "mixed" | "upright";
  children?: VNodeJsxChildFor<"Rt">;
};

/** Image — embedded image */
export type ImageProps = {
  src: Uint8Array | string;
  /** Required with a `Uint8Array` src. Every format the rasterizer decodes. */
  mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
  width: number;
  height: number;
  objectFit?: "fill" | "contain" | "cover";
  /** Image position within the box (e.g. "top", "center", "bottom left") */
  objectPosition?: string;
  /** Border radius for rounded image clipping */
  borderRadius?: BorderRadius;
  /** Opacity (0-1) */
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  /** Static post-layout paint transform */
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  /** Logical layer assignment hint for layered SVG export */
  layer?: string;
  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  // Grid item
  gridColumn?: string;
  gridRow?: string;
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  // Box model
  margin?: Spacing;
  // Event handlers
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  // Identity
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
};

/** Path — SVG path data */
export type PathProps = {
  d: string;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Stroke scaling mode. `"canvas"` keeps a solid stroke stable in canvas space. */
  strokeScaling?: StrokeScaling;
  /** Fill rule for complex/self-intersecting paths */
  fillRule?: "nonzero" | "evenodd";
  /** Stroke line cap */
  strokeLinecap?: "butt" | "round" | "square";
  /** Stroke line join */
  strokeLinejoin?: "miter" | "round" | "bevel";
  /** Stroke dash pattern (e.g. "5,5") */
  strokeDasharray?: string;
  /** Stroke miter limit */
  strokeMiterlimit?: number;
  /** Opacity (0-1) */
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  /** Static post-layout paint transform */
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  /** Logical layer assignment hint for layered SVG export */
  layer?: string;
  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  // Grid item
  gridColumn?: string;
  gridRow?: string;
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  // Box model
  margin?: Spacing;
  // Event handlers
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  // Identity
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
};

/** Svg — nested SVG content */
export type SvgProps = {
  /** Raw SVG string content */
  content: string;
  /** Display width (px) */
  width: number;
  /** Display height (px) */
  height: number;
  /** How to fit the SVG content into the display box */
  preserveAspectRatio?: "none" | "meet" | "slice";
  /** Optional prefix for embedded SVG content IDs to avoid collisions */
  contentIdPrefix?: string;
  /** Opacity (0-1) */
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  /** Static post-layout paint transform */
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  /** Logical layer assignment hint for layered SVG export */
  layer?: string;
  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  // Grid item
  gridColumn?: string;
  gridRow?: string;
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  // Box model
  margin?: Spacing;
  // Event handlers
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  // Identity
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
};

/** Paint fields a partPaint entry may override (merged over base paint). */
export type PartPaintOverride = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  strokeDasharray?: string;
  strokeMiterlimit?: number;
};

type ShapeBaseProps = {
  width: number;
  height: number;
  /** Layered-composition layer this shape belongs to */
  layer?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: "nonzero" | "evenodd";
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  strokeDasharray?: string;
  strokeMiterlimit?: number;
  preserveAspectRatio?: "none" | "meet" | "slice";
  /**
   * Emit one path per addressable geometry part, tagged with
   * data-boundsvg-part-id. Opt-in: overlapping parts paint separately, which
   * changes evenodd/opacity semantics over the overlap.
   */
  emitPartIds?: boolean;
  /**
   * Per-part paint overrides keyed by partId (nodeId in the geometry, or
   * positional `part:<index>`). Each entry merges over the shape's base
   * paint - unset fields inherit. Implies part-split compilation;
   * `data-boundsvg-part-id` attributes still require `emitPartIds`.
   * Unknown partIds produce a Recoverable warning and are ignored.
   */
  partPaint?: Record<string, PartPaintOverride>;
  opacity?: number;
  /** Sibling-local paint order; higher paints later. Integers only. */
  zIndex?: number;
  transform?: Transform2D;
  /** Declarative post-layout opacity/transform animation. */
  animate?: AnimationSpec;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  gridColumn?: string;
  gridRow?: string;
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  margin?: Spacing;
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
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
  id?: string;
  /** Arbitrary string metadata carried into output (data-boundsvg-meta-* attributes and the layered manifest). */
  meta?: Readonly<Record<string, string>>;
};

export type ShapeProps = ShapeBaseProps & {
  geometry?: GeometryDoc;
  geometryId?: string;
};

export type SymbolProps = ShapeBaseProps & {
  symbol?: SymbolDefinition;
  symbolId?: string;
};

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

/** Map from VNodeType to its Props type — keys are PascalCase to match component names */
export type PropsMap = {
  Canvas: CanvasProps;
  Flex: FlexProps;
  Grid: GridProps;
  Box: BoxProps;
  Text: TextProps;
  TextOnPath: TextOnPathProps;
  Inline: InlineProps;
  InlineBox: InlineBoxProps;
  InlineRect: InlineRectProps;
  Ruby: RubyProps;
  Rt: RtProps;
  Image: ImageProps;
  Path: PathProps;
  Svg: SvgProps;
  Shape: ShapeProps;
  Symbol: SymbolProps;
};

type ChildlessVNodeType = "InlineRect" | "Image" | "Path" | "Svg" | "Shape" | "Symbol";
type VNodeKey = string | number;

export type PropsFor<T extends VNodeType> = PropsMap[T];
export type NormalizedPropsFor<T extends VNodeType> = Omit<PropsMap[T], "children">;

export type ChildFor<T extends VNodeType> = T extends "Text"
  ? TextChild
  : T extends "TextOnPath"
    ? TextOnPathChild
    : T extends "Inline"
      ? InlineChild
      : T extends "InlineBox"
        ? InlineBoxChild
        : T extends "Ruby"
          ? RubyChild
          : T extends "Rt"
            ? RtChild
            : VNode | string;

export type ChildrenFor<T extends VNodeType> = T extends ChildlessVNodeType
  ? []
  : Array<ChildFor<T>>;

export type VNodeInputChildFor<T extends VNodeType> = T extends "TextOnPath"
  ? TextOnPathChild | VNodeInputChildFor<T>[]
  : ChildFor<T> | number | boolean | null | undefined | VNodeInputChildFor<T>[];

/**
 * JSX child input for the rich-text containers. A JSX expression types as the
 * broad `VNode` union (`JSX.Element`), so the per-container narrowing of
 * `ChildFor` cannot apply at the JSX boundary; the allowed child kinds are
 * enforced by `validate()` at runtime instead. The function-call API keeps the
 * narrow static checking via `VNodeChildrenArgs` rest parameters.
 */
export type VNodeJsxChildFor<T extends VNodeType> =
  | VNodeInputChildFor<T>
  | VNode
  | VNodeJsxChildFor<T>[];

export type VNodeChildrenArgs<T extends VNodeType> = T extends ChildlessVNodeType
  ? []
  : Array<VNodeInputChildFor<T>>;

export type VNodeFor<T extends VNodeType> = {
  type: T;
  props: NormalizedPropsFor<T>;
  children: ChildrenFor<T>;
  key?: VNodeKey;
};

export type CanvasVNode = VNodeFor<"Canvas">;
export type FlexVNode = VNodeFor<"Flex">;
export type GridVNode = VNodeFor<"Grid">;
export type BoxVNode = VNodeFor<"Box">;
export type TextVNode = VNodeFor<"Text">;
export type TextOnPathVNode = VNodeFor<"TextOnPath">;
export type InlineVNode = VNodeFor<"Inline">;
export type InlineBoxVNode = VNodeFor<"InlineBox">;
export type InlineRectVNode = VNodeFor<"InlineRect">;
export type RubyVNode = VNodeFor<"Ruby">;
export type RtVNode = VNodeFor<"Rt">;
export type ImageVNode = VNodeFor<"Image">;
export type PathVNode = VNodeFor<"Path">;
export type SvgVNode = VNodeFor<"Svg">;
export type ShapeVNode = VNodeFor<"Shape">;
export type SymbolVNode = VNodeFor<"Symbol">;

/** Virtual node representing a component in the render tree */
export type VNode =
  | CanvasVNode
  | FlexVNode
  | GridVNode
  | BoxVNode
  | TextVNode
  | TextOnPathVNode
  | InlineVNode
  | InlineBoxVNode
  | InlineRectVNode
  | RubyVNode
  | RtVNode
  | ImageVNode
  | PathVNode
  | SvgVNode
  | ShapeVNode
  | SymbolVNode;

export type AnyVNode = VNode;

export type TextChild = string | InlineVNode | InlineBoxVNode | InlineRectVNode | RubyVNode;
export type TextOnPathChild = string | InlineVNode;
export type InlineChild = string | InlineVNode | InlineRectVNode | RubyVNode;
export type InlineBoxChild = string | InlineVNode | InlineBoxVNode | InlineRectVNode | RubyVNode;
export type RubyChild = string | InlineVNode | RtVNode;
export type RtChild = string | InlineVNode;

/** Allowed raw children in JSX/createElement input */
export type VNodeChild = VNode | string | number | boolean | null | undefined | VNodeChild[];
