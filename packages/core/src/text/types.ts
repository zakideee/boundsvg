/** Bounding box */
export type BBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Individual glyph info from shaping */
export type GlyphInfo = {
  glyphId: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  /** Byte offset into the original text for this cluster */
  cluster: number;
  fontAlias?: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  rotationDeg?: number;
};

/** Optional shaping behavior hints (used by WASM shape functions) */
export type ShapingOptions = {
  writingMode?: "horizontal-tb" | "vertical-rl";
  language?: "ja" | "en" | "auto";
};

export type PositionedGlyph = {
  glyphId: number;
  text: string;
  clusterStart: number;
  clusterEnd: number;
  /** Grapheme range in the logical base text, for editor selection. */
  sourceStart?: number;
  sourceEnd?: number;
  sourceRole?: "content" | "rubyBase" | "rubyAnnotation";
  paintRangeIndex?: number;
  textStrokes?: TextStrokeLayer[];
  textShadows?: TextShadowLayer[];
  fontAlias: string;
  fontFallback?: string[];
  fontWeight: number;
  fontStyle: "normal" | "italic";
  fontSizePx?: number;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  /** Effective fill is resolved as `PositionedGlyph.fill ?? LineFragment.style?.color ?? IRTextNode.color`. */
  fill?: string;
  originX: number;
  originY: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  yAdvance: number;
  rotationDeg: number;
  baselineRotationDeg?: number;
  /** Inline-axis outline scale applied before baseline rotation. */
  inlineScale?: number;
  /** Layout-generated glyph kind. */
  syntheticKind?: "ellipsis";
  outlineWritingMode?: "horizontal-tb" | "vertical-rl";
  absolutePosition?: boolean;
};

export type TextUnitKind = "cluster" | "line";

export type TextUnitRubyMode = "with-base" | "separate";

type TextUnitSourceRole = "content" | "rubyBase" | "rubyAnnotation";

/** Reference to one positioned glyph owned by a text unit. */
type TextUnitGlyphMember = {
  lineIndex: number;
  glyphIndex: number;
  sourceRole: TextUnitSourceRole;
};

/** Additive text paint-unit metadata. `unitId` and `lineId` are opaque. */
export type TextUnitMapEntry = {
  unitId: string;
  kind: TextUnitKind;
  sourceStart: number;
  sourceEnd: number;
  lineId: string;
  logicalOrder: number;
  /**
   * Physical inline-axis order emitted by the current renderer. In v1 this
   * does not add Unicode bidi reordering beyond the resolved glyph layout.
   */
  visualOrder: number;
  members: TextUnitGlyphMember[];
};

export type TextUnitMap = {
  kind: TextUnitKind;
  ruby: TextUnitRubyMode;
  units: TextUnitMapEntry[];
};

export type TextPathMode = "merged" | "glyphs";

export type TextDecorationLine = "underline" | "overline" | "line-through";

/** Declarative text decoration. `none` stops inherited decoration. */
export type TextDecoration =
  | "none"
  | {
      line: TextDecorationLine | readonly TextDecorationLine[];
      color?: string;
      style?: "solid" | "double" | "dotted" | "dashed" | "wavy";
      thicknessPx?: number;
      /** Signed offset along the logical block-end axis. */
      offsetPx?: number;
      /** Skip intersecting glyph fill ink for underline/overline. Default: "none". */
      skipInk?: "none" | "all";
    };

/** Maximum stroke/shadow layers per Text node (deterministic contract: exceeding is a validation error, never a silent truncation). */
export const MAX_TEXT_EFFECT_LAYERS = 8;
/** Maximum animated text paint units in one scene. */
export const MAX_TEXT_ANIMATION_UNITS = 4_096;
/** Maximum estimated shadow/stroke/fill fragments for animated text units. */
export const MAX_TEXT_ANIMATION_FRAGMENTS = 8_192;
/** Unit count above which rendering emits a recoverable budget warning. */
export const TEXT_ANIMATION_UNIT_WARNING_THRESHOLD = 1_024;
/** Fragment estimate above which rendering emits a recoverable budget warning. */
export const TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD = 2_048;
/** Maximum authored text-decoration ranges in one Text node; mirrors the Rust trust boundary. */
export const MAX_TEXT_DECORATION_RANGES = 4_096;
/** Maximum resolved physical text-decoration paths; enforced by Rust. */
export const MAX_TEXT_DECORATION_PATHS = 16_384;
/** Maximum filled contours materialized for one Text node; enforced by Rust. */
export const MAX_TEXT_DECORATION_PATTERN_CONTOURS = 65_536;
/** Maximum line/curve segments materialized for one Text node; enforced by Rust. */
export const MAX_TEXT_DECORATION_PATTERN_SEGMENTS = 262_144;
/** Maximum glyphs tested by outline-aware text-decoration ink skipping. */
export const MAX_TEXT_DECORATION_SKIP_INK_GLYPHS = 16_384;
/** Maximum curve-segment pairs tested by outline-aware text-decoration booleans. */
export const MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS = 1_048_576;
/** Maximum authored string/Inline items visited in one TextOnPath source tree. */
export const MAX_TEXT_PATH_SOURCE_ITEMS = 65_536;
/** Maximum authored Inline containers in one TextOnPath source tree. */
export const MAX_TEXT_PATH_INLINE_CONTAINERS = 4_096;
/** Maximum resolved shaping runs in one TextOnPath request. */
export const MAX_TEXT_PATH_SHAPING_RUNS = 16_384;
/** Maximum contiguous logical paint ranges in one TextOnPath request. */
export const MAX_TEXT_PATH_PAINT_RANGES = 16_384;
/** Maximum aggregate fill/stroke/shadow layers across TextOnPath paint ranges. */
export const MAX_TEXT_PATH_PAINTED_LAYERS = 65_536;
/** Maximum inline rectangles in one Text node; mirrors the Rust trust boundary. */
export const MAX_INLINE_RECTS = 4_096;

/**
 * One outline layer of multi-layer text stroke.
 * Layers paint below the glyph fill; index 0 is the outermost (painted
 * first). `widthPx` is the SVG stroke-width (centered on the glyph edge, so
 * the visible rim is about half of it beyond the fill - same convention as
 * the scalar `textStroke*` props).
 */
export type TextStrokeLayer = {
  color: string;
  widthPx: number;
  /** Default "round" (typical for telop-style outlines). */
  linejoin?: "miter" | "round" | "bevel";
  /** Default "round". */
  linecap?: "butt" | "round" | "square";
  dasharray?: string;
  miterlimit?: number;
};

/**
 * One drop-shadow layer painted below every stroke layer.
 * `blurPx` follows the box-shadow blur-radius convention.
 */
export type TextShadowLayer = {
  dx: number;
  dy: number;
  blurPx?: number;
  color: string;
};

export type TextOutlinePath = {
  nodeId: string;
  d: string;
  fill: string;
  glyphIds: number[];
  text: string;
  bbox: BBox;
  /** Opaque paint-unit identity when the owning Text opts into unit animation. */
  unitId?: string;
  /** Logical base-text source metadata copied from the positioned glyph. */
  sourceStart?: number;
  sourceEnd?: number;
  sourceRole?: "content" | "rubyBase" | "rubyAnnotation";
  paintRangeIndex?: number;
  strokes?: TextStrokeLayer[];
  shadows?: TextShadowLayer[];
  /** True when this path is a synthetic tofu marker for a missing glyph. */
  missingGlyph?: boolean;
};

export type TextOutlineNode = {
  nodeId: string;
  text: string;
  bbox: BBox;
  writingMode?: "horizontal-tb" | "vertical-rl";
  paths: TextOutlinePath[];
  /**
   * Composed node + ancestor transform mapping the path coordinates (and
   * `bbox`) into canvas space. The SVG output wraps the same paths in a
   * `transform` attribute; consumers that place the outline paths directly
   * must apply this matrix. Omitted when it is the identity.
   */
  worldTransform?: { a: number; b: number; c: number; d: number; e: number; f: number };
};

/** Resolved inline text style */
export type TextRunStyle = {
  font: string;
  fallback?: string[];
  fontWeight: number;
  fontStyle: "normal" | "italic";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  color: string;
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];
  language?: "ja" | "en" | "auto";
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx: number;
  textOrientation?: "mixed" | "upright";
  textDecoration?: TextDecoration;
};

/** Text run with its own style */
export type TextRun = {
  text: string;
  style: TextRunStyle;
};

export type RichTextStyle = {
  font: string;
  fallback?: string[];
  fontWeight: number;
  fontStyle: "normal" | "italic";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  color: string;
  textStrokes?: readonly TextStrokeLayer[];
  textShadows?: readonly TextShadowLayer[];
  language?: "ja" | "en" | "auto";
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx: number;
  textOrientation?: "mixed" | "upright";
  textDecoration?: TextDecoration;
};

export type RichTextTextNode = {
  kind: "text";
  text: string;
};

export type RichTextSpanNode = {
  kind: "span";
  text: string;
  style: RichTextStyle;
};

export type RichTextCombineNode = {
  kind: "combine";
  text: string;
  style: RichTextStyle;
  /** Paint-only source runs retained while shaping the combined text once. */
  decorationRuns?: TextRun[];
};

export type RichTextRubyNode = {
  kind: "ruby";
  rubyPosition?: "over" | "under" | "alternate" | "inter-character";
  rubyAlign?: "start" | "center" | "space-between" | "space-around";
  rubyGapPx?: number;
  rubyOffsetPx?: number;
  rubyLineSizing?: "stable" | "css";
  style: RichTextStyle;
  base: RichTextNode[];
  /** First annotation level, retained for the existing Rust bridge shape. */
  rt: RichTextNode[];
  /** All annotation levels. If omitted, `rt` is used as the single level. */
  rtLevels?: RichTextNode[][];
};

export type RichTextInlineBoxNode = {
  kind: "inlineBox";
  style: RichTextStyle;
  children: RichTextNode[];
  paddingInline?: [number, number];
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  /** Provenance key echoed on the decoration fragment (set when the box animates). */
  spanKey?: string;
};

export type RichTextInlineRectNode = {
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
};

export type RichTextDecoratedSpanNode = {
  kind: "decoratedSpan";
  style: RichTextStyle;
  children: RichTextNode[];
  paddingInline?: [number, number];
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: [number, number, number, number];
  /** Provenance key echoed on decoration fragments (set when the span animates). */
  spanKey?: string;
};

export type RichTextNode =
  | RichTextTextNode
  | RichTextSpanNode
  | RichTextCombineNode
  | RichTextRubyNode
  | RichTextInlineBoxNode
  | RichTextInlineRectNode
  | RichTextDecoratedSpanNode;

export type IntrinsicInlineSizes = {
  minContentInlineSize: number;
  maxContentInlineSize: number;
};

export type FlattenedRichText = {
  text: string;
  runs: TextRun[];
  richText?: RichTextNode[];
  hasInline: boolean;
  hasRichContent: boolean;
};

/** A style fragment inside a line */
export type LineFragment = {
  text: string;
  glyphs: GlyphInfo[];
  width: number;
  /**
   * Present only when the fragment carries an explicit color-bearing style override.
   * Effective fill is resolved as `PositionedGlyph.fill ?? LineFragment.style?.color ?? IRTextNode.color`.
   */
  style?: TextRunStyle;
};

/** A single laid-out line */
export type Line = {
  /** The text content of this line */
  text: string;
  /** Glyph data for this line */
  glyphs: GlyphInfo[];
  /** Total advance width of this line */
  width: number;
  /** Y position of the baseline (from top of text block) */
  baselineY: number;
  /** Optional per-style fragments (present when inline spans are used) */
  fragments?: LineFragment[];
  /** Glyph placements resolved by the Rust text engine. */
  positionedGlyphs?: PositionedGlyph[];
};

/** Overflow information */
export type TextOverflow = {
  type: "none" | "overflow" | "kinsoku_unresolved" | "cannot_fit";
  reason?: string;
};

/** Recoverable text warning bridged from the engine (e.g. MISSING_GLYPH). */
export type TextLayoutWarning = {
  code: string;
  message: string;
  fallback?: string;
};

/**
 * A background / border rectangle for an `Inline` or `InlineBox` decoration,
 * in text-local coordinates (relative to the text node's origin). A decoration
 * that wraps across lines produces one rect per line fragment.
 */
export type InlineBoxDecoration = {
  x: number;
  y: number;
  width: number;
  height: number;
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  /** Per-corner radii: [top-left, top-right, bottom-right, bottom-left]. */
  borderRadius?: [number, number, number, number];
};

/** One resolved physical text-decoration region as canonical filled path geometry. */
export type TextDecorationPaintPath = {
  d: string;
  originX: number;
  originY: number;
  contourCount: number;
  segmentCount: number;
  pathDistanceStartPx?: number;
  pathDistanceEndPx?: number;
};

/** One authored decoration range resolved into physical line or column strips. */
export type TextDecorationFragment = {
  line: TextDecorationLine;
  style: "solid" | "double" | "dotted" | "dashed" | "wavy";
  color: string;
  skipInk?: "all";
  paths: readonly TextDecorationPaintPath[];
  sourceStart: number;
  sourceEnd: number;
};

/** Resolved physical InlineRect geometry in text-local coordinates. */
export type InlineRectFragment = {
  fragmentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  borderRadiusPx: number;
  opacity: number;
  paintOrder: "behind" | "front";
};

/** Result of text layout */
export type TextLayoutResult = {
  lines: Line[];
  bbox: BBox;
  chosenFontSizePx: number;
  overflow: TextOverflow;
  /** Authored source text when layout creates a distinct display sequence. */
  sourceText?: string;
  /** Shaped display sequence after path overflow handling. */
  displayText?: string;
  /** Present only when an internal caller requested stable text paint units. */
  unitMap?: TextUnitMap;
  /** Present when the engine reported recoverable warnings for this node. */
  warnings?: TextLayoutWarning[];
  /** Present when the text contains decorated `Inline` / `InlineBox` runs. */
  inlineBoxDecorations?: InlineBoxDecoration[];
  /** Present when text decoration strips were resolved by the text engine. */
  textDecorations?: TextDecorationFragment[];
  /** Atomic inline rectangles resolved by the text engine. */
  inlineRects?: InlineRectFragment[];
};

/**
 * A function that shapes text at a given font size and returns
 * glyph info + per-glyph advances.
 */
export type ShapeFn = (
  text: string,
  params: { fontSizePx: number; letterSpacingPx: number; shapeOptions?: ShapingOptions },
) => GlyphInfo[];
