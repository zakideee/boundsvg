import type { SerializedRecoverableError } from "../errors.js";
import type { GeneratedStructuralIr } from "../generated/ir/structural-ir.js";
import type { InlineRectFragment, TextDecorationFragment, TextUnitMap } from "../text/types.js";

/**
 * Instance-based WASM engine. Each instance owns its own FontRegistry on the
 * Rust side — fonts registered to one instance are invisible to other instances.
 *
 * Returned by `new WasmModule.BoundSvgEngine()`.
 * Call `free()` to release Rust-side memory when the instance is no longer needed.
 */
export type WasmPreparedSceneInstance = {
  /** Release the Rust-side prepared IR. */
  free(): void;
};

export type WasmRasterSceneInstance = {
  /** Release the retained preflighted raster IR. */
  free(): void;
};

type LayoutTransitionCheckpointWire = {
  timeMs: number;
  stateIndex: number;
};

type LayoutTransitionPlanWire = {
  checkpoints: LayoutTransitionCheckpointWire[];
  easing?: import("../vnode/types.js").AnimationEasing;
};

type LayoutTransitionCompileOptionsWire = {
  textPathMode?: string;
};

type LayoutTransitionJson<WireShape> = string & {
  readonly __layoutTransitionWireShape?: WireShape;
};

export type WasmEngineInstance = {
  /** Register a font into this instance's registry */
  register_font(data: Uint8Array, alias: string, weight: number, style: string): void;
  /** Compute layout using this instance's font registry */
  compute_layout(inputJson: string): string;
  /** Compute layout and build the IR in one call: returns `{ ir, warnings }` JSON */
  render_to_ir?(inputJson: string, optionsJson: string): string;
  /** Compile two compatible layout states once each into one IR envelope. */
  compile_layout_transition?(
    referenceInputJson: string,
    targetInputJson: string,
    transitionPlanJson: LayoutTransitionJson<LayoutTransitionPlanWire>,
    optionsJson: LayoutTransitionJson<LayoutTransitionCompileOptionsWire>,
  ): string;
  /** Compute layout, build the IR, and emit SVG in one call:
   *  returns `{ svg, ir, warnings }` JSON */
  render_to_svg?(inputJson: string, optionsJson: string): string;
  /** Compute layout, build IR, and emit declarative animated SVG. */
  render_to_animated_svg?(inputJson: string, optionsJson: string): string;
  /** Emit an SVG string from a public-IR JSON payload */
  emit_svg_from_ir?(irJson: string, optionsJson: string): string;
  /** Emit declarative animated SVG from a public-IR JSON payload. */
  emit_animated_svg_from_ir?(irJson: string, optionsJson: string): string;
  /** Resolve every text outline and return a public-IR envelope. */
  resolve_ir?(irJson: string, optionsJson: string): string;
  /** Run the bounded raster outline preflight. */
  preflight_ir?(irJson: string): string;
  /** Parse, preflight, and retain one raster IR snapshot. */
  preflight_raster_scene?(irJson: string, optionsJson: string): WasmRasterSceneInstance;
  /** Resolve and emit from the retained raster snapshot. */
  resolve_and_emit_raster_scene?(scene: WasmRasterSceneInstance): string;
  /** Resolve and return the retained raster IR. */
  resolve_raster_scene_to_ir?(scene: WasmRasterSceneInstance): string;
  /** Resolve a retained raster scene for repeated sampling. */
  resolve_raster_scene?(scene: WasmRasterSceneInstance): void;
  /** Emit one frame from a resolved retained raster scene. */
  render_raster_scene_to_svg?(scene: WasmRasterSceneInstance, optionsJson: string): string;
  /** Resolve outlines and emit SVG without returning resolved IR. */
  resolve_and_emit_svg_from_ir?(irJson: string, optionsJson: string): string;
  /** Resolve outlines and emit declarative animated SVG. */
  resolve_and_emit_animated_svg_from_ir?(irJson: string, optionsJson: string): string;
  /** Sample per-node animation opacity/transform from a public-IR payload. */
  sample_animation_state?(irJson: string, timeMs: number): string;
  /** Parse and retain an outline-resolved public IR for repeated sampling. */
  prepare_scene?(irJson: string, optionsJson: string): WasmPreparedSceneInstance;
  /** Sample and emit a prepared scene owned by this engine instance. */
  render_prepared_to_svg?(prepared: WasmPreparedSceneInstance, optionsJson: string): string;
  /** Resolve the shared raster scale contract without SVG parsing. */
  resolve_raster_scale?(width: number, height: number, requestedScale: number): string;
  /** Shape text using a registered font from this instance's registry */
  shape_text_registered(
    alias: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    letterSpacingPx: number,
  ): string;
  /** Shape text with shaping options */
  shape_text_registered_with_options?(
    alias: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    letterSpacingPx: number,
    optionsJson: string,
  ): string;
  /** Shape text using fallback chain */
  shape_text_registered_with_fallback?(
    aliasesJson: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    letterSpacingPx: number,
  ): string;
  /** Shape text using fallback chain with shaping options */
  shape_text_registered_with_fallback_with_options?(
    aliasesJson: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    letterSpacingPx: number,
    optionsJson: string,
  ): string;
  /** Rasterize SVG string to PNG bytes */
  svg_to_png(svgString: string): Uint8Array;
  /** Rasterize SVG string to PNG bytes with options */
  svg_to_png_with_options?(svgString: string, optionsJson: string): Uint8Array;
  /** Rasterize SVG string to lossless WebP bytes with options */
  svg_to_webp_with_options?(svgString: string, optionsJson: string): Uint8Array;
  /** Encode pre-sampled SVG frames into an animated lossless WebP */
  svgs_to_animated_webp?(inputJson: string): Uint8Array;
  /** Encode pre-sampled SVG frames into an animated GIF */
  svgs_to_animated_gif?(inputJson: string): Uint8Array;
  /** Validate layered SVG composition by rasterizing and diffing against a single SVG */
  validate_layered_svg_composition?(inputJson: string): string;
  /** Extract glyph outline paths */
  extract_glyph_paths(
    alias: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    baselineY: number,
    startX: number,
    letterSpacingPx: number,
  ): string;
  /** Extract glyph outline paths with shaping options */
  extract_glyph_paths_with_options?(
    alias: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    baselineY: number,
    startX: number,
    letterSpacingPx: number,
    optionsJson: string,
  ): string;
  /** Extract glyph outline paths using fallback chain */
  extract_glyph_paths_with_fallback?(
    aliasesJson: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    baselineY: number,
    startX: number,
    letterSpacingPx: number,
  ): string;
  /** Extract glyph outline paths using fallback chain with shaping options */
  extract_glyph_paths_with_fallback_with_options?(
    aliasesJson: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    baselineY: number,
    startX: number,
    letterSpacingPx: number,
    optionsJson: string,
  ): string;
  /** Extract glyph outline paths from positioned glyph metadata */
  extract_positioned_glyph_paths?(glyphsJson: string): string;
  /** Shape text with variable font variation axes */
  shape_text_with_variations?(
    alias: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    letterSpacingPx: number,
    variationsJson: string,
  ): string;
  /** Shape text with variable font variations + shaping options */
  shape_text_with_variations_with_options?(
    alias: string,
    weight: number,
    style: string,
    text: string,
    fontSizePx: number,
    letterSpacingPx: number,
    variationsJson: string,
    optionsJson: string,
  ): string;
  /** Layout text with per-line variable widths (flow layout) */
  layout_text_flow?(jsonInput: string): string;
  /** Layout text flow with shape exclusions (geometry-aware flow layout) */
  layout_text_flow_with_exclusions?(jsonInput: string): string;
  /** Measure a text block and return line count, used width/height */
  measure_text_block?(jsonInput: string): string;
  /** Find minimum width preserving line count (shrinkwrap) */
  shrinkwrap_text?(jsonInput: string): string;
  /** Shrinkwrap flow layout with exclusions */
  shrinkwrap_flow?(jsonInput: string): string;
  /** Measure intrinsic (min-content / max-content) inline sizes for text */
  measure_intrinsic_inline_size?(jsonInput: string): string;
  /** Release Rust-side memory. Required to prevent WASM heap leaks. */
  free(): void;
};

/** WASM module exports (generated by wasm-pack) */
export type WasmModule = {
  /** Get font metrics (unitsPerEm, ascender, descender) as JSON */
  get_font_metrics(fontData: Uint8Array): string;

  /** Shape text and return glyph info as JSON (with inline font data) */
  shape_text(
    fontData: Uint8Array,
    text: string,
    fontSizePx: number,
    letterSpacingPx: number,
  ): string;

  /** Split text into grapheme clusters */
  grapheme_split(text: string): string;
  /** DTO schema version handshake; absent in pre-handshake builds. */
  wasm_schema_version?(): number;
  /** Evaluate a geometry document into addressable parts; absent in older builds. */
  evaluate_shape_parts?(jsonInput: string): string;

  /** Get UAX#14 line break opportunities (returns JSON array of byte offsets) */
  uax14_line_breaks?(text: string): string;

  /** Extract external image href values from SVG (returns JSON array of non-data-URI hrefs) */
  extract_image_hrefs?(svgString: string): string;
  /** Extract image hrefs rejected by the safety policy. */
  extract_skipped_image_hrefs?(svgString: string): string;
  /** Replace safe image href values from a JSON string map. */
  replace_image_hrefs?(svgString: string, replacementsJson: string): string;

  /** Compile GeometryDoc + paint options into an SVG document string. */
  compile_shape_svg?(jsonInput: string): string;
  compile_shape_paths?(jsonInput: string): string;
  hit_test_shape_parts?(jsonInput: string): string;

  /** Resolve a SymbolDefinition into a GeometryDoc JSON string. */
  resolve_symbol_geometry?(jsonInput: string): string;

  /** Evaluate GeometryDoc into a normalized Region JSON string. */
  evaluate_shape_region?(jsonInput: string): string;

  /** Render a normalized Region JSON payload into an SVG document string. */
  render_shape_region_svg?(jsonInput: string): string;

  /** Divide closed fill regions into subtract/intersect results. */
  divide_shape_regions?(jsonInput: string): string;

  /** Compute intersections between two closed fill geometries. */
  compute_shape_intersections?(jsonInput: string): string;

  /** Create a new isolated engine instance with its own font registry. */
  BoundSvgEngine: new () => WasmEngineInstance;
};

/** Glyph info returned from WASM shaping (camelCase via serde) */
export type WasmGlyphInfo = {
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
};

/** Positioned glyph metadata from Rust text layout output. */
export type WasmPositionedGlyph = {
  glyphId: number;
  text: string;
  clusterStart: number;
  clusterEnd: number;
  sourceStart?: number;
  sourceEnd?: number;
  sourceRole?: "content" | "rubyBase" | "rubyAnnotation";
  fontAlias: string;
  fontFallback?: string[];
  fontWeight: number;
  fontStyle: "normal" | "italic";
  fontSizePx?: number;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  fill?: string;
  originX: number;
  originY: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  yAdvance: number;
  rotationDeg: number;
  baselineRotationDeg?: number;
  inlineScale?: number;
  syntheticKind?: "ellipsis";
  outlineWritingMode?: "horizontal-tb" | "vertical-rl";
  absolutePosition?: boolean;
};

/** Per-fragment inline style attached to Rust text layout fragments. */
export type WasmTextRunStyle = {
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

/** Text fragment output from Rust line breaking. */
export type WasmLineFragment = {
  text: string;
  glyphs: WasmGlyphInfo[];
  width: number;
  style?: WasmTextRunStyle;
};

/** Single laid-out line/column from Rust text layout. */
export type WasmTextLine = {
  text: string;
  glyphs: WasmGlyphInfo[];
  width: number;
  baselineY: number;
  fragments?: WasmLineFragment[];
  positionedGlyphs?: WasmPositionedGlyph[];
};

/** Text bounding box returned from Rust layout. */
export type WasmTextBBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Overflow metadata returned from Rust layout. */
export type WasmTextOverflow = {
  type: string;
  reason?: string;
};

/** Full text layout payload attached to text nodes. */
export type WasmTextLayoutOutput = {
  glyphs: WasmGlyphInfo[];
  measuredWidth: number;
  measuredHeight: number;
  lines?: WasmTextLine[];
  bbox?: WasmTextBBox;
  chosenFontSizePx?: number;
  overflow?: WasmTextOverflow;
  sourceText?: string;
  displayText?: string;
  unitMap?: TextUnitMap;
  textDecorations?: TextDecorationFragment[];
  inlineRects?: InlineRectFragment[];
};

/** IR decoded from a WASM response before warning DTOs are rehydrated. */
export type WasmIrOutput = GeneratedStructuralIr;

/** Decoded envelope returned by `render_to_ir`. */
export type RenderToIrEnvelope = {
  ir: WasmIrOutput;
  warnings: SerializedRecoverableError[];
};

export type PngOutlineGlyphLimitExceeded = {
  actualGlyphs: number;
  maxGlyphs: number;
  nodeId: string;
};

/** Decoded envelope returned by `render_to_svg`. */
export type RenderToSvgEnvelope = {
  svg: string;
  ir?: WasmIrOutput;
  warnings: SerializedRecoverableError[];
  textNodeIds: string[];
};

/** Layout output node from WASM compute_layout (flat node list, not a tree). */
export type WasmLayoutNode = {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  textLayout?: WasmTextLayoutOutput;
};

/** Layout output from WASM compute_layout */
export type WasmLayoutOutput = {
  nodes: WasmLayoutNode[];
  measureCallCount: number;
  measureCacheHits: number;
};
