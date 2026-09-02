import type { SerializedRecoverableError } from "../errors.js";
import { FatalError } from "../errors.js";
import { DEFAULT_FONT_WEIGHT } from "../font/types.js";
import type { LayeredCompositionValidationResult } from "../layered-svg.js";
import type { ComputeLayoutTransportFn } from "../layout/backend.js";
import type { ResolvedRasterScale } from "../render-capabilities.js";
import {
  assertGeometryTreeDepth,
  assertResolvedSymbolGeometryDepth,
  MAX_GEOMETRY_TREE_DEPTH,
} from "../shape/geometry-depth.js";
import type {
  CompiledShapePathPart,
  Contour,
  CurvePoint,
  CurveSegment,
  DivideRegions,
  GeometryDoc,
  GeometryHitTestOptions,
  GeometryIntersection,
  GeometryPart,
  GeometryPartBounds,
  GeometryPartHit,
  Region,
  SymbolDefinition,
} from "../shape/types.js";
import type { GlyphInfo, RichTextNode, ShapeFn, ShapingOptions } from "../text/types.js";
import type { TextLayoutOperation } from "./protocol-decoders.js";
import {
  decodeIntrinsicInlineSizeResult,
  decodeMeasureTextBlockResult,
  decodeShrinkwrapFlowResult,
  decodeShrinkwrapTextResult,
  decodeTextFlowResult,
  decodeTextFlowWithExclusionsResult,
} from "./protocol-decoders.js";
import type {
  WasmEngineInstance,
  WasmModule,
  WasmPreparedSceneInstance,
  WasmRasterSceneInstance,
} from "./types.js";

let wasmModule: WasmModule | null = null;

/**
 * Expected WASM DTO schema version. Must match `WASM_SCHEMA_VERSION` in
 * `crates/boundsvg/src/lib.rs`; both sides change in the same commit.
 * Bump whenever a WASM-boundary DTO shape or export signature changes.
 */
export const EXPECTED_WASM_SCHEMA_VERSION = 30;

function assertWasmSchemaVersion(preloaded: WasmModule): void {
  const readSchemaVersion = preloaded.wasm_schema_version;
  const actualVersion =
    typeof readSchemaVersion === "function" ? readSchemaVersion.call(preloaded) : undefined;
  if (actualVersion !== EXPECTED_WASM_SCHEMA_VERSION) {
    throw new FatalError(
      "WASM_SCHEMA_MISMATCH",
      `WASM DTO schema version mismatch: expected ${EXPECTED_WASM_SCHEMA_VERSION}, got ${actualVersion ?? "none"}. Rebuild the WASM package that matches this @boundsvg/core version.`,
      { stage: "wasm" },
    );
  }
}

/**
 * Initialize the WASM module with a pre-loaded instance.
 * Must be called before using any WASM functions.
 * Safe to call multiple times with the same module instance. A different
 * module is rejected so providers cannot appear ready while the old singleton
 * remains active.
 *
 * **Node.js**: use `initNodeWasm()` from `@boundsvg/core/node`.
 * **Browser**: load the browser build via `@boundsvg/browser` and pass the result here.
 */
export function initWasm(preloaded: WasmModule): void {
  if (wasmModule) {
    if (wasmModule === preloaded) {
      return;
    }
    throw new FatalError(
      "WASM_ALREADY_INITIALIZED",
      "WASM module is already initialized with a different module instance.",
      { stage: "wasm" },
    );
  }

  assertWasmSchemaVersion(preloaded);
  wasmModule = preloaded;
}

/**
 * Get the initialized WASM module.
 * Throws if initWasm() has not been called.
 */
export function getWasm(): WasmModule {
  if (!wasmModule) {
    throw new FatalError(
      "WASM_NOT_INIT",
      "WASM module not initialized. Call initNodeWasm() (Node.js) or initWasm(module) (browser) first.",
      { stage: "wasm" },
    );
  }
  return wasmModule;
}

/** Check if WASM module is initialized */
export function isWasmInitialized(): boolean {
  return wasmModule !== null;
}

function normalizeAliasChain(aliases: readonly string[]): string[] {
  const chain: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) {
      continue;
    }
    if (!chain.includes(trimmed)) {
      chain.push(trimmed);
    }
  }
  return chain;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function getStringProperty(value: object, key: string): string | undefined {
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : undefined;
}

function getNumberProperty(value: object, key: string): number | undefined {
  const property = Reflect.get(value, key);
  return typeof property === "number" ? property : undefined;
}

function parseWasmJson<T>(
  json: string,
  guard: (value: unknown) => value is T,
  code: string,
  message: string,
): T {
  const parsed = JSON.parse(json);
  if (!guard(parsed)) {
    throw new FatalError(code, message, { stage: "wasm" });
  }
  return parsed;
}

function normalizeWasmTextLayoutError(error: unknown, operation: TextLayoutOperation): FatalError {
  try {
    if (error instanceof FatalError) {
      return error;
    }
  } catch {
    // A hostile proxy may make instanceof itself throw.
  }
  if (typeof error === "string") {
    try {
      return FatalError.fromSerialized(JSON.parse(error) as unknown);
    } catch {
      // Fall through to the bounded transport diagnostic.
    }
  }
  return new FatalError("TEXT_LAYOUT_WASM_FAILED", "Text layout WASM transport failed.", {
    stage: "wasm",
    context: { operation },
  });
}

function invokeWasmTextLayout<Output>(
  operation: TextLayoutOperation,
  invoke: () => string,
  decode: (json: string) => Output,
): Output {
  let json: string;
  try {
    json = invoke();
  } catch (error) {
    throw normalizeWasmTextLayoutError(error, operation);
  }
  return decode(json);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isFontMetrics(
  value: unknown,
): value is { unitsPerEm: number; ascender: number; descender: number } {
  if (!isObjectLike(value)) {
    return false;
  }

  return (
    typeof getNumberProperty(value, "unitsPerEm") === "number" &&
    typeof getNumberProperty(value, "ascender") === "number" &&
    typeof getNumberProperty(value, "descender") === "number"
  );
}

function isGlyphInfo(value: unknown): value is GlyphInfo {
  if (!isObjectLike(value)) {
    return false;
  }

  return (
    typeof getNumberProperty(value, "glyphId") === "number" &&
    typeof getNumberProperty(value, "xAdvance") === "number" &&
    typeof getNumberProperty(value, "yAdvance") === "number" &&
    typeof getNumberProperty(value, "xOffset") === "number" &&
    typeof getNumberProperty(value, "yOffset") === "number" &&
    typeof getNumberProperty(value, "cluster") === "number"
  );
}

function isGlyphInfoArray(value: unknown): value is GlyphInfo[] {
  return Array.isArray(value) && value.every(isGlyphInfo);
}

function isWasmGlyphPath(value: unknown): value is WasmGlyphPath {
  if (!isObjectLike(value)) {
    return false;
  }

  return (
    typeof getStringProperty(value, "d") === "string" &&
    typeof getNumberProperty(value, "x") === "number" &&
    typeof getNumberProperty(value, "y") === "number"
  );
}

function isWasmGlyphPathArray(value: unknown): value is WasmGlyphPath[] {
  return Array.isArray(value) && value.every(isWasmGlyphPath);
}

function isLayeredCompositionValidationMetrics(
  value: unknown,
): value is WasmLayeredCompositionValidationMetrics {
  if (!isObjectLike(value)) {
    return false;
  }
  return (
    typeof getNumberProperty(value, "differentPixels") === "number" &&
    typeof getNumberProperty(value, "differenceRatio") === "number" &&
    typeof getNumberProperty(value, "width") === "number" &&
    typeof getNumberProperty(value, "height") === "number"
  );
}

function isResolvedRasterScale(value: unknown): value is ResolvedRasterScale {
  if (!isObjectLike(value)) {
    return false;
  }
  return (
    typeof getNumberProperty(value, "appliedScale") === "number" &&
    typeof getNumberProperty(value, "requestedWidth") === "number" &&
    typeof getNumberProperty(value, "requestedHeight") === "number" &&
    typeof getNumberProperty(value, "outputWidth") === "number" &&
    typeof getNumberProperty(value, "outputHeight") === "number" &&
    typeof Reflect.get(value, "adjusted") === "boolean"
  );
}

function isGeometryViewBox(value: unknown): value is GeometryDoc["viewBox"] {
  if (!isObjectLike(value)) {
    return false;
  }
  const width = getNumberProperty(value, "width");
  const height = getNumberProperty(value, "height");
  return typeof width === "number" && typeof height === "number";
}

type UnknownGeometryDepthFrame = {
  node: unknown;
  depth: number;
};

const geometryBooleanOps = new Set(["union", "subtract", "intersect", "xor"]);

function pushGeometryArrayChildren(
  children: unknown,
  depth: number,
  pending: UnknownGeometryDepthFrame[],
): boolean {
  if (!Array.isArray(children)) {
    return false;
  }
  for (const child of children) {
    pending.push({ node: child, depth: depth + 1 });
  }
  return true;
}

function pushGeometryNodeChildren(
  node: object,
  depth: number,
  pending: UnknownGeometryDepthFrame[],
): boolean {
  const kind = getStringProperty(node, "kind");
  switch (kind) {
    case "path":
      return typeof getStringProperty(node, "d") === "string";
    case "group":
      return pushGeometryArrayChildren(Reflect.get(node, "children"), depth, pending);
    case "transform":
      if (!isObjectLike(Reflect.get(node, "transform"))) {
        return false;
      }
      pending.push({ node: Reflect.get(node, "child"), depth: depth + 1 });
      return true;
    case "boolean":
      return (
        geometryBooleanOps.has(getStringProperty(node, "op") ?? "") &&
        pushGeometryArrayChildren(Reflect.get(node, "children"), depth, pending)
      );
    default:
      return false;
  }
}

function isGeometryNode(value: unknown): boolean {
  const pending: UnknownGeometryDepthFrame[] = [{ node: value, depth: 0 }];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame || !isObjectLike(frame.node) || frame.depth > MAX_GEOMETRY_TREE_DEPTH) {
      return false;
    }
    if (!pushGeometryNodeChildren(frame.node, frame.depth, pending)) {
      return false;
    }
  }
  return true;
}

function isGeometryDoc(value: unknown): value is GeometryDoc {
  if (!isObjectLike(value)) {
    return false;
  }
  return (
    isGeometryViewBox(Reflect.get(value, "viewBox")) && isGeometryNode(Reflect.get(value, "root"))
  );
}

function isCurvePoint(value: unknown): value is CurvePoint {
  if (!isObjectLike(value)) {
    return false;
  }
  return (
    typeof getNumberProperty(value, "x") === "number" &&
    typeof getNumberProperty(value, "y") === "number"
  );
}

function isCurveSegment(value: unknown): value is CurveSegment {
  if (!isObjectLike(value)) {
    return false;
  }
  const kind = getStringProperty(value, "kind");
  if (kind === "line") {
    return isCurvePoint(Reflect.get(value, "p0")) && isCurvePoint(Reflect.get(value, "p1"));
  }
  if (kind === "quad") {
    return (
      isCurvePoint(Reflect.get(value, "p0")) &&
      isCurvePoint(Reflect.get(value, "p1")) &&
      isCurvePoint(Reflect.get(value, "p2"))
    );
  }
  if (kind === "cubic") {
    return (
      isCurvePoint(Reflect.get(value, "p0")) &&
      isCurvePoint(Reflect.get(value, "p1")) &&
      isCurvePoint(Reflect.get(value, "p2")) &&
      isCurvePoint(Reflect.get(value, "p3"))
    );
  }
  return false;
}

function isContour(value: unknown): value is Contour {
  if (!isObjectLike(value)) {
    return false;
  }
  const segments = Reflect.get(value, "segments");
  return Array.isArray(segments) && segments.every(isCurveSegment);
}

function isRegion(value: unknown): value is Region {
  if (!isObjectLike(value)) {
    return false;
  }
  const contours = Reflect.get(value, "contours");
  return Array.isArray(contours) && contours.every(isContour);
}

function isGeometryIntersection(value: unknown): value is GeometryIntersection {
  if (!isObjectLike(value)) {
    return false;
  }
  return (
    isCurvePoint(Reflect.get(value, "point")) &&
    typeof getNumberProperty(value, "tA") === "number" &&
    typeof getNumberProperty(value, "tB") === "number" &&
    typeof getNumberProperty(value, "contourIndexA") === "number" &&
    typeof getNumberProperty(value, "segmentIndexA") === "number" &&
    typeof getNumberProperty(value, "contourIndexB") === "number" &&
    typeof getNumberProperty(value, "segmentIndexB") === "number"
  );
}

function isGeometryIntersectionArray(value: unknown): value is GeometryIntersection[] {
  return Array.isArray(value) && value.every(isGeometryIntersection);
}

function isDivideRegions(value: unknown): value is DivideRegions {
  if (!isObjectLike(value)) {
    return false;
  }
  return isRegion(Reflect.get(value, "subtract")) && isRegion(Reflect.get(value, "intersect"));
}

export type ShapeCompileOptions = {
  /**
   * Emit one path per addressable part with data-boundsvg-part-id attributes.
   * Opt-in: splitting overlapping parts changes paint semantics for evenodd
   * fills and group opacity over the overlap.
   */
  partIds?: boolean;
  preserveAspectRatio?: "none" | "meet" | "slice";
  paint?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    fillRule?: "nonzero" | "evenodd";
    strokeLinecap?: "butt" | "round" | "square";
    strokeLinejoin?: "miter" | "round" | "bevel";
    strokeDasharray?: string;
    strokeMiterlimit?: number;
    opacity?: number;
  };
  viewport?: {
    width: number;
    height: number;
  };
};

export type ShapeSymbolResolutionOptions = {
  width: number;
  height: number;
};

/**
 * Get font metrics from raw font data.
 */
export function getWasmFontMetrics(fontData: Uint8Array): {
  unitsPerEm: number;
  ascender: number;
  descender: number;
} {
  const wasm = getWasm();
  return parseWasmJson(
    wasm.get_font_metrics(fontData),
    isFontMetrics,
    "WASM_INVALID_FONT_METRICS",
    "WASM get_font_metrics returned invalid JSON.",
  );
}

/**
 * Create a ShapeFn that uses the real WASM module with given font data.
 */
export function createWasmShapeFn(fontData: Uint8Array): ShapeFn {
  const wasm = getWasm();
  return (
    text: string,
    params: { fontSizePx: number; letterSpacingPx: number; shapeOptions?: ShapingOptions },
  ): GlyphInfo[] => {
    const json = wasm.shape_text(fontData, text, params.fontSizePx, params.letterSpacingPx);
    // WASM output is already camelCase (serde rename_all = "camelCase")
    return parseWasmJson(
      json,
      isGlyphInfoArray,
      "WASM_INVALID_SHAPE_OUTPUT",
      "WASM shape_text returned invalid glyph JSON.",
    );
  };
}

/**
 * Transport shape for the animated raster WASM exports. Field names are the
 * camelCase serde names of `AnimationEncodeInput` in Rust.
 */
export type AnimationEncodeInput = {
  frames: Array<{ svg: string; durationMs: number }>;
  iterations: number | "infinite";
  options: PngRenderOptions;
};

/** Options for PNG rasterization */
export type PngRenderOptions = {
  /** CSS3 color string for background (e.g. "#ffffff") */
  background?: string;
  /** Output scale factor (e.g. 2.0 for Retina) */
  scale?: number;
  /** Resolution overflow behavior when PNG exceeds 4K-equivalent cap */
  oversizeBehavior?: "autoAdjust" | "error";
  /** Per-family font mapping for generic CSS families */
  fontFamilies?: {
    serif?: string;
    sansSerif?: string;
    cursive?: string;
    fantasy?: string;
    monospace?: string;
  };
  /** Public package/service identity embedded in the completed file. */
  generator?: {
    name: string;
    version: string;
  };
};

type WasmLayeredCompositionValidationInput = {
  singleSvg: string;
  layers: Array<{ svg: string; paintOrder: number }>;
  options?: Pick<PngRenderOptions, "fontFamilies">;
};

type WasmLayeredCompositionValidationMetrics = Pick<
  LayeredCompositionValidationResult,
  "differentPixels" | "differenceRatio" | "width" | "height"
>;

/** Glyph path result from WASM */
export type WasmGlyphPath = {
  d: string;
  x: number;
  y: number;
  glyphId?: number;
  requestIndex?: number;
};

/** Options for glyph path extraction */
export type GlyphPathOptions = {
  writingMode?: "horizontal-tb" | "vertical-rl";
};

/** Function type for extracting glyph paths */
export type GlyphPathFn = (
  text: string,
  params: {
    fontSizePx: number;
    letterSpacingPx: number;
    baselineY: number;
    startX: number;
    pathOptions?: GlyphPathOptions;
  },
) => WasmGlyphPath[];

export type PositionedGlyphPathRequest = {
  glyphId: number;
  text?: string;
  fontFallback?: string[];
  fontSizePx: number;
  originX: number;
  originY: number;
  rotationDeg: number;
  baselineRotationDeg?: number;
  inlineScale?: number;
  writingMode: "horizontal-tb" | "vertical-rl";
  fontAlias: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  fontVariationSettings?: string;
  showMissingGlyphs?: boolean;
};

export type ExtractPositionedGlyphPathsFn = (
  glyphs: PositionedGlyphPathRequest[],
) => WasmGlyphPath[];

/**
 * Split text into grapheme clusters using WASM.
 */
export function wasmGraphemeSplit(text: string): string[] {
  const wasm = getWasm();
  const json = wasm.grapheme_split(text);
  return parseWasmJson(
    json,
    isStringArray,
    "WASM_INVALID_GRAPHEME_OUTPUT",
    "WASM grapheme_split returned invalid JSON.",
  );
}

/**
 * Get UAX#14 line break opportunities for text using WASM.
 * Returns array of byte offsets where breaks are allowed.
 * Returns empty array if the WASM module doesn't support this function.
 */
export function wasmUax14LineBreaks(text: string): number[] {
  const wasm = getWasm();
  if (typeof wasm.uax14_line_breaks !== "function") {
    return [];
  }
  const json = wasm.uax14_line_breaks(text);
  return parseWasmJson(
    json,
    isNumberArray,
    "WASM_INVALID_LINE_BREAKS",
    "WASM uax14_line_breaks returned invalid JSON.",
  );
}

/** Function type for UAX#14 line break detection */
export type Uax14BreakFn = (text: string) => number[];

/** Parsed variation axis setting */
export type VariationSetting = {
  tag: string;
  value: number;
};

/**
 * Parse CSS fontVariationSettings string into structured settings.
 * Input format: "'wght' 700, 'wdth' 125" or "\"wght\" 700"
 */
export function parseFontVariationSettings(css: string | undefined): VariationSetting[] {
  if (!css) {
    return [];
  }
  return css
    .split(",")
    .map((setting) => setting.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/['"](\w{4})['"]\s+([-\d.]+)/);
      if (!match) {
        return null;
      }
      const [, tag = "", rawValue = "0"] = match;
      return { tag, value: parseFloat(rawValue) };
    })
    .filter(
      (variationSetting): variationSetting is VariationSetting =>
        variationSetting !== null && !Number.isNaN(variationSetting.value),
    );
}

/**
 * Function type for shaping text with variable font variations.
 * The variationsJson parameter is a JSON array of {tag, value} objects.
 */
export type ShapeWithVariationsFn = (
  text: string,
  params: {
    fontSizePx: number;
    letterSpacingPx: number;
    variationsJson: string;
    shapeOptions?: ShapingOptions;
  },
) => GlyphInfo[];

/**
 * Extract external image hrefs from an SVG string using WASM XML parser.
 * Returns non-data-URI hrefs found in <image> elements.
 * Returns empty array if WASM module doesn't support this function.
 */
export function wasmExtractImageHrefs(svgString: string): string[] {
  const wasm = getWasm();
  if (typeof wasm.extract_image_hrefs !== "function") {
    return [];
  }
  const json = wasm.extract_image_hrefs(svgString);
  return parseWasmJson(
    json,
    isStringArray,
    "WASM_INVALID_IMAGE_HREFS",
    "WASM extract_image_hrefs returned invalid JSON.",
  );
}

/** Extract hrefs rejected by the WASM image safety policy. */
export function wasmExtractSkippedImageHrefs(svgString: string): string[] {
  const wasm = getWasm();
  if (typeof wasm.extract_skipped_image_hrefs !== "function") {
    throw new FatalError(
      "WASM_MISSING_IMAGE_HREF_REPORT",
      "WASM module does not support reporting safety-skipped image hrefs.",
      { stage: "wasm" },
    );
  }
  const json = wasm.extract_skipped_image_hrefs(svgString);
  return parseWasmJson(
    json,
    isStringArray,
    "WASM_INVALID_IMAGE_HREFS",
    "WASM extract_skipped_image_hrefs returned invalid JSON.",
  );
}

/** Replace only `<image>` href attributes via WASM's XML parser. */
export function wasmReplaceImageHrefs(
  svgString: string,
  replacements: Readonly<Record<string, string>>,
): string {
  const wasm = getWasm();
  if (typeof wasm.replace_image_hrefs !== "function") {
    throw new FatalError(
      "WASM_MISSING_IMAGE_HREF_REPLACER",
      "WASM module does not support XML-aware image href replacement.",
      { stage: "wasm" },
    );
  }
  return wasm.replace_image_hrefs(svgString, JSON.stringify(replacements));
}

export function isShapeWasmAvailable(): boolean {
  if (!isWasmInitialized()) {
    return false;
  }
  const wasm = getWasm();
  return (
    typeof wasm.compile_shape_svg === "function" &&
    typeof wasm.resolve_symbol_geometry === "function" &&
    typeof wasm.divide_shape_regions === "function" &&
    typeof wasm.compute_shape_intersections === "function"
  );
}

export function wasmCompileShapeSvg(geometry: GeometryDoc, options?: ShapeCompileOptions): string {
  assertGeometryTreeDepth(geometry);
  const wasm = getWasm();
  if (typeof wasm.compile_shape_svg !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_COMPILE_API",
      "compile_shape_svg is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  return wasm.compile_shape_svg(
    JSON.stringify({
      geometry,
      paint: options?.paint,
      viewport: options?.viewport,
      preserveAspectRatio: options?.preserveAspectRatio ?? "none",
      partIds: options?.partIds ?? false,
    }),
  );
}

export function wasmHitTestShapeParts(
  geometry: GeometryDoc,
  point: { x: number; y: number },
  options?: GeometryHitTestOptions,
): GeometryPartHit[] {
  assertGeometryTreeDepth(geometry);
  const wasm = getWasm();
  if (typeof wasm.hit_test_shape_parts !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_HIT_TEST_API",
      "hit_test_shape_parts is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  return JSON.parse(
    wasm.hit_test_shape_parts(JSON.stringify({ geometry, point, options })),
  ) as GeometryPartHit[];
}

export function wasmCompileShapePaths(
  geometry: GeometryDoc,
  options?: ShapeCompileOptions,
): CompiledShapePathPart[] {
  assertGeometryTreeDepth(geometry);
  const wasm = getWasm();
  if (typeof wasm.compile_shape_paths !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_COMPILE_API",
      "compile_shape_paths is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  const raw = JSON.parse(
    wasm.compile_shape_paths(
      JSON.stringify({
        geometry,
        paint: options?.paint,
        viewport: options?.viewport,
        preserveAspectRatio: options?.preserveAspectRatio ?? "none",
        partIds: options?.partIds ?? false,
      }),
    ),
  ) as Array<{
    partId: string | null;
    d: string;
    strokeD?: string | null;
    bounds: GeometryPartBounds | null;
  }>;
  // serde serializes Option::None as null; normalize to absent fields.
  return raw.map((part) => ({
    d: part.d,
    ...(part.partId == null ? {} : { partId: part.partId }),
    ...(part.strokeD == null ? {} : { strokeD: part.strokeD }),
    ...(part.bounds == null ? {} : { bounds: part.bounds }),
  }));
}

export function wasmResolveSymbolGeometry(
  definition: SymbolDefinition,
  options: ShapeSymbolResolutionOptions,
): GeometryDoc {
  assertResolvedSymbolGeometryDepth(definition, options);
  const wasm = getWasm();
  if (typeof wasm.resolve_symbol_geometry !== "function") {
    throw new FatalError(
      "WASM_NO_SYMBOL_RESOLVE_API",
      "resolve_symbol_geometry is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  const json = wasm.resolve_symbol_geometry(
    JSON.stringify({
      definition,
      options,
    }),
  );
  return parseWasmJson(
    json,
    isGeometryDoc,
    "WASM_INVALID_SYMBOL_GEOMETRY",
    "WASM resolve_symbol_geometry returned invalid geometry JSON.",
  );
}

export function wasmEvaluateShapeParts(geometry: GeometryDoc): GeometryPart[] {
  assertGeometryTreeDepth(geometry);
  const wasm = getWasm();
  if (typeof wasm.evaluate_shape_parts !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_PARTS_API",
      "evaluate_shape_parts is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  const json = wasm.evaluate_shape_parts(JSON.stringify({ geometry }));
  return JSON.parse(json) as GeometryPart[];
}

export function wasmEvaluateShapeRegion(geometry: GeometryDoc): Region {
  assertGeometryTreeDepth(geometry);
  const wasm = getWasm();
  if (typeof wasm.evaluate_shape_region !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_REGION_API",
      "evaluate_shape_region is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  const json = wasm.evaluate_shape_region(
    JSON.stringify({
      geometry,
    }),
  );
  return parseWasmJson(
    json,
    isRegion,
    "WASM_INVALID_SHAPE_REGION",
    "WASM evaluate_shape_region returned invalid region JSON.",
  );
}

export function wasmRenderShapeRegionSvg(region: Region, options?: ShapeCompileOptions): string {
  const wasm = getWasm();
  if (typeof wasm.render_shape_region_svg !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_REGION_RENDER_API",
      "render_shape_region_svg is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  return wasm.render_shape_region_svg(
    JSON.stringify({
      region,
      paint: options?.paint,
      viewport: options?.viewport,
      preserveAspectRatio: options?.preserveAspectRatio ?? "none",
    }),
  );
}

export function wasmDivideShapeRegions(lhs: GeometryDoc, rhs: GeometryDoc): DivideRegions {
  assertGeometryTreeDepth(lhs);
  assertGeometryTreeDepth(rhs);
  const wasm = getWasm();
  if (typeof wasm.divide_shape_regions !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_DIVIDE_API",
      "divide_shape_regions is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  const json = wasm.divide_shape_regions(
    JSON.stringify({
      lhs,
      rhs,
    }),
  );
  return parseWasmJson(
    json,
    isDivideRegions,
    "WASM_INVALID_SHAPE_DIVIDE",
    "WASM divide_shape_regions returned invalid divide JSON.",
  );
}

export function wasmComputeShapeIntersections(
  lhs: GeometryDoc,
  rhs: GeometryDoc,
): GeometryIntersection[] {
  assertGeometryTreeDepth(lhs);
  assertGeometryTreeDepth(rhs);
  const wasm = getWasm();
  if (typeof wasm.compute_shape_intersections !== "function") {
    throw new FatalError(
      "WASM_NO_SHAPE_INTERSECTIONS_API",
      "compute_shape_intersections is not available in this WASM build. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  const json = wasm.compute_shape_intersections(
    JSON.stringify({
      lhs,
      rhs,
    }),
  );
  return parseWasmJson(
    json,
    isGeometryIntersectionArray,
    "WASM_INVALID_SHAPE_INTERSECTIONS",
    "WASM compute_shape_intersections returned invalid intersections JSON.",
  );
}

// ---------------------------------------------------------------------------
// Instance-based engine (each instance owns its own FontRegistry)
// ---------------------------------------------------------------------------

/**
 * Create an isolated WASM engine instance with its own font registry.
 * All operations on the returned handle use the instance's registry,
 * not the global one.
 *
 * Call `dispose()` on the returned handle to release Rust-side memory.
 */
export function createWasmEngineInstance(): WasmEngineHandle {
  const wasm = getWasm();
  if (!wasm.BoundSvgEngine) {
    throw new FatalError(
      "WASM_NO_INSTANCE_API",
      "This WASM build does not support instance-based engines. Rebuild WASM.",
      { stage: "wasm" },
    );
  }
  const instance = new wasm.BoundSvgEngine();
  return new WasmEngineHandle(instance);
}

type PreparedSceneState = {
  owner: WasmEngineHandle;
  ownerRecord: PreparedSceneOwnerRecord;
};

type PreparedSceneOwnerRecord = {
  reference: WeakRef<WasmPreparedSceneHandle>;
  instance: WasmPreparedSceneInstance;
  disposed: boolean;
};

const preparedSceneStates = new WeakMap<WasmPreparedSceneHandle, PreparedSceneState>();
const preparedScenesByOwner = new WeakMap<WasmEngineHandle, Set<PreparedSceneOwnerRecord>>();
type PreparedSceneFinalizerState = {
  ownerRecords: Set<PreparedSceneOwnerRecord>;
  ownerRecord: PreparedSceneOwnerRecord;
};

function releasePreparedSceneRecord(ownerRecord: PreparedSceneOwnerRecord): void {
  if (ownerRecord.disposed) {
    return;
  }
  ownerRecord.disposed = true;
  ownerRecord.instance.free();
}

const preparedSceneFinalizer =
  typeof FinalizationRegistry === "undefined"
    ? undefined
    : new FinalizationRegistry<PreparedSceneFinalizerState>(({ ownerRecords, ownerRecord }) => {
        ownerRecords.delete(ownerRecord);
        releasePreparedSceneRecord(ownerRecord);
      });

const preparedSceneDisposeSymbol = Symbol.dispose;

function requirePreparedSceneState(prepared: WasmPreparedSceneHandle): PreparedSceneState {
  const state = preparedSceneStates.get(prepared);
  if (!state || state.ownerRecord.disposed) {
    throw new FatalError("WASM_PREPARED_SCENE_DISPOSED", "Prepared scene has been disposed", {
      stage: "wasm",
    });
  }
  return state;
}

/**
 * Opaque handle for a parsed, outline-resolved IR owned by one WASM engine.
 * Call `dispose()` when sampling is complete; repeated disposal is safe.
 */
export class WasmPreparedSceneHandle {
  constructor(owner: WasmEngineHandle, instance: WasmPreparedSceneInstance) {
    const ownerRecords = preparedScenesByOwner.get(owner);
    if (!ownerRecords) {
      instance.free();
      throw new FatalError(
        "WASM_PREPARED_SCENE_WRONG_ENGINE",
        "Prepared scene owner is not a managed WASM engine instance",
        { stage: "wasm" },
      );
    }
    const ownerRecord = { reference: new WeakRef(this), instance, disposed: false };
    preparedSceneStates.set(this, { owner, ownerRecord });
    ownerRecords.add(ownerRecord);
    preparedSceneFinalizer?.register(this, { ownerRecords, ownerRecord }, this);
  }

  get isDisposed(): boolean {
    return preparedSceneStates.get(this)?.ownerRecord.disposed ?? true;
  }

  renderToSvg(optionsJson: string): string {
    const state = requirePreparedSceneState(this);
    return state.owner.renderPreparedToSvg(this, optionsJson);
  }

  dispose(): void {
    const state = preparedSceneStates.get(this);
    if (!state || state.ownerRecord.disposed) {
      return;
    }
    preparedSceneFinalizer?.unregister(this);
    preparedScenesByOwner.get(state.owner)?.delete(state.ownerRecord);
    releasePreparedSceneRecord(state.ownerRecord);
  }

  [preparedSceneDisposeSymbol](): void {
    this.dispose();
  }
}

type RasterSceneState = {
  owner: WasmEngineHandle;
  ownerRecord: RasterSceneOwnerRecord;
};

type RasterSceneOwnerRecord = {
  reference: WeakRef<WasmRasterSceneHandle>;
  instance: WasmRasterSceneInstance;
  disposed: boolean;
};

const rasterSceneStates = new WeakMap<WasmRasterSceneHandle, RasterSceneState>();
const rasterScenesByOwner = new WeakMap<WasmEngineHandle, Set<RasterSceneOwnerRecord>>();

function releaseRasterSceneRecord(ownerRecord: RasterSceneOwnerRecord): void {
  if (ownerRecord.disposed) {
    return;
  }
  ownerRecord.disposed = true;
  ownerRecord.instance.free();
}

const rasterSceneFinalizer =
  typeof FinalizationRegistry === "undefined"
    ? undefined
    : new FinalizationRegistry<{
        ownerRecords: Set<RasterSceneOwnerRecord>;
        ownerRecord: RasterSceneOwnerRecord;
      }>(({ ownerRecords, ownerRecord }) => {
        ownerRecords.delete(ownerRecord);
        releaseRasterSceneRecord(ownerRecord);
      });

function requireRasterSceneState(scene: WasmRasterSceneHandle): RasterSceneState {
  const state = rasterSceneStates.get(scene);
  if (!state || state.ownerRecord.disposed) {
    throw new FatalError("WASM_RASTER_SCENE_DISPOSED", "Raster scene has been disposed", {
      stage: "wasm",
    });
  }
  return state;
}

/** Opaque preflighted raster IR retained across user callbacks. */
export class WasmRasterSceneHandle {
  constructor(owner: WasmEngineHandle, instance: WasmRasterSceneInstance) {
    const ownerRecords = rasterScenesByOwner.get(owner);
    if (!ownerRecords) {
      instance.free();
      throw new FatalError(
        "WASM_RASTER_SCENE_WRONG_ENGINE",
        "Raster scene owner is not a managed WASM engine instance",
        { stage: "wasm" },
      );
    }
    const ownerRecord = { reference: new WeakRef(this), instance, disposed: false };
    rasterSceneStates.set(this, { owner, ownerRecord });
    ownerRecords.add(ownerRecord);
    rasterSceneFinalizer?.register(this, { ownerRecords, ownerRecord }, this);
  }

  resolveAndEmitToSvg(): string {
    return requireRasterSceneState(this).owner.resolveAndEmitRasterScene(this);
  }

  resolveToIr(): string {
    return requireRasterSceneState(this).owner.resolveRasterSceneToIr(this);
  }

  resolve(): void {
    requireRasterSceneState(this).owner.resolveRasterScene(this);
  }

  renderToSvg(optionsJson: string): string {
    return requireRasterSceneState(this).owner.renderRasterSceneToSvg(this, optionsJson);
  }

  dispose(): void {
    const state = rasterSceneStates.get(this);
    if (!state || state.ownerRecord.disposed) {
      return;
    }
    rasterSceneFinalizer?.unregister(this);
    rasterScenesByOwner.get(state.owner)?.delete(state.ownerRecord);
    releaseRasterSceneRecord(state.ownerRecord);
  }
}

/**
 * Handle wrapping a BoundSvgEngine WASM instance.
 * Provides factory methods that close over the instance (not the global module).
 */
export class WasmEngineHandle {
  private readonly instance: WasmEngineInstance;
  private _disposed = false;

  constructor(instance: WasmEngineInstance) {
    this.instance = instance;
    preparedScenesByOwner.set(this, new Set());
    rasterScenesByOwner.set(this, new Set());
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  registerFont(
    data: Uint8Array,
    options: { alias: string; weight?: number; style?: "normal" | "italic" },
  ): void {
    this.ensureNotDisposed();
    const { alias, weight = DEFAULT_FONT_WEIGHT, style = "normal" } = options;
    this.instance.register_font(data, alias, weight, style);
  }

  createComputeLayoutFn(): ComputeLayoutTransportFn {
    return (inputJson: string) => {
      this.ensureNotDisposed();
      return this.instance.compute_layout(inputJson);
    };
  }

  /** Compute layout and build the IR in one WASM call.
   *  Takes layout/options transport JSON; returns `{ ir, warnings }` JSON. */
  renderToIr(inputJson: string, optionsJson = "{}"): string {
    this.ensureNotDisposed();
    if (typeof this.instance.render_to_ir !== "function") {
      throw new FatalError(
        "WASM_NO_RENDER_TO_IR",
        "render_to_ir is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.render_to_ir(inputJson, optionsJson);
  }

  /** Compile both layout transports once in one Rust operation.
   *  Semantic provenance remains private; the response is an ordinary IR envelope. */
  compileLayoutTransition(
    referenceInputJson: string,
    targetInputJson: string,
    transitionPlanJson: string,
    optionsJson = "{}",
  ): string {
    this.ensureNotDisposed();
    if (typeof this.instance.compile_layout_transition !== "function") {
      throw new FatalError(
        "WASM_NO_LAYOUT_TRANSITION_COMPILER",
        "compile_layout_transition is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.compile_layout_transition(
      referenceInputJson,
      targetInputJson,
      transitionPlanJson,
      optionsJson,
    );
  }

  /** Compute layout, build the IR, and emit SVG in one WASM call.
   *  Takes the layout transport JSON plus emit options JSON; returns
   *  `{ svg, ir, warnings }` JSON. */
  renderToSvg(inputJson: string, optionsJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.render_to_svg !== "function") {
      throw new FatalError(
        "WASM_NO_RENDER_TO_SVG",
        "render_to_svg is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.render_to_svg(inputJson, optionsJson);
  }

  /** Compute layout, build IR, and emit declarative animated SVG. */
  renderToAnimatedSvg(inputJson: string, optionsJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.render_to_animated_svg !== "function") {
      throw new FatalError(
        "WASM_NO_RENDER_TO_ANIMATED_SVG",
        "render_to_animated_svg is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.render_to_animated_svg(inputJson, optionsJson);
  }

  /** Emit an SVG string from a public-IR JSON payload in one WASM call. */
  emitSvgFromIr(irJson: string, optionsJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.emit_svg_from_ir !== "function") {
      throw new FatalError(
        "WASM_NO_EMIT_SVG_FROM_IR",
        "emit_svg_from_ir is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.emit_svg_from_ir(irJson, optionsJson);
  }

  /** Emit declarative animated SVG from public IR. */
  emitAnimatedSvgFromIr(irJson: string, optionsJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.emit_animated_svg_from_ir !== "function") {
      throw new FatalError(
        "WASM_NO_EMIT_ANIMATED_SVG_FROM_IR",
        "emit_animated_svg_from_ir is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.emit_animated_svg_from_ir(irJson, optionsJson);
  }

  /** Resolve every text outline and return a public-IR envelope. */
  resolveIr(irJson: string, optionsJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.resolve_ir !== "function") {
      throw new FatalError(
        "WASM_NO_RESOLVE_IR",
        "resolve_ir is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.resolve_ir(irJson, optionsJson);
  }

  /** Run the bounded raster outline preflight. */
  preflightIr(irJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.preflight_ir !== "function") {
      throw new FatalError(
        "WASM_NO_PREFLIGHT_IR",
        "preflight_ir is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.preflight_ir(irJson);
  }

  /** Parse, preflight, and retain one immutable raster IR snapshot. */
  preflightRasterScene(irJson: string, optionsJson: string): WasmRasterSceneHandle {
    this.ensureNotDisposed();
    if (typeof this.instance.preflight_raster_scene !== "function") {
      throw new FatalError(
        "WASM_NO_RASTER_SCENE_API",
        "preflight_raster_scene is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return new WasmRasterSceneHandle(
      this,
      this.instance.preflight_raster_scene(irJson, optionsJson),
    );
  }

  resolveAndEmitRasterScene(scene: WasmRasterSceneHandle): string {
    this.ensureNotDisposed();
    const state = requireRasterSceneState(scene);
    if (state.owner !== this || typeof this.instance.resolve_and_emit_raster_scene !== "function") {
      throw new FatalError(
        "WASM_NO_RASTER_SCENE_API",
        "resolve_and_emit_raster_scene is unavailable for this WASM engine.",
        { stage: "wasm" },
      );
    }
    return this.instance.resolve_and_emit_raster_scene(state.ownerRecord.instance);
  }

  resolveRasterSceneToIr(scene: WasmRasterSceneHandle): string {
    this.ensureNotDisposed();
    const state = requireRasterSceneState(scene);
    if (state.owner !== this || typeof this.instance.resolve_raster_scene_to_ir !== "function") {
      throw new FatalError(
        "WASM_NO_RASTER_SCENE_API",
        "resolve_raster_scene_to_ir is unavailable for this WASM engine.",
        { stage: "wasm" },
      );
    }
    return this.instance.resolve_raster_scene_to_ir(state.ownerRecord.instance);
  }

  resolveRasterScene(scene: WasmRasterSceneHandle): void {
    this.ensureNotDisposed();
    const state = requireRasterSceneState(scene);
    if (state.owner !== this || typeof this.instance.resolve_raster_scene !== "function") {
      throw new FatalError(
        "WASM_NO_RASTER_SCENE_API",
        "resolve_raster_scene is unavailable for this WASM engine.",
        { stage: "wasm" },
      );
    }
    this.instance.resolve_raster_scene(state.ownerRecord.instance);
  }

  renderRasterSceneToSvg(scene: WasmRasterSceneHandle, optionsJson: string): string {
    this.ensureNotDisposed();
    const state = requireRasterSceneState(scene);
    if (state.owner !== this || typeof this.instance.render_raster_scene_to_svg !== "function") {
      throw new FatalError(
        "WASM_NO_RASTER_SCENE_API",
        "render_raster_scene_to_svg is unavailable for this WASM engine.",
        { stage: "wasm" },
      );
    }
    return this.instance.render_raster_scene_to_svg(state.ownerRecord.instance, optionsJson);
  }

  /** Resolve outlines and emit SVG without returning resolved IR. */
  resolveAndEmitSvgFromIr(irJson: string, optionsJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.resolve_and_emit_svg_from_ir !== "function") {
      throw new FatalError(
        "WASM_NO_RESOLVE_AND_EMIT_IR",
        "resolve_and_emit_svg_from_ir is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.resolve_and_emit_svg_from_ir(irJson, optionsJson);
  }

  /** Resolve outlines and emit declarative animated SVG. */
  resolveAndEmitAnimatedSvgFromIr(irJson: string, optionsJson: string): string {
    this.ensureNotDisposed();
    if (typeof this.instance.resolve_and_emit_animated_svg_from_ir !== "function") {
      throw new FatalError(
        "WASM_NO_RESOLVE_AND_EMIT_ANIMATED_IR",
        "resolve_and_emit_animated_svg_from_ir is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.resolve_and_emit_animated_svg_from_ir(irJson, optionsJson);
  }

  /** Sample per-node animation opacity/transform at a time, as JSON. */
  sampleAnimationState(irJson: string, timeMs: number): string {
    this.ensureNotDisposed();
    if (typeof this.instance.sample_animation_state !== "function") {
      throw new FatalError(
        "WASM_NO_SAMPLE_ANIMATION_STATE",
        "sample_animation_state is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.sample_animation_state(irJson, timeMs);
  }

  /** Parse and retain an outline-resolved public IR for repeated sampling. */
  prepareScene(irJson: string, optionsJson = "{}"): WasmPreparedSceneHandle {
    this.ensureNotDisposed();
    if (typeof this.instance.prepare_scene !== "function") {
      throw new FatalError(
        "WASM_NO_PREPARED_SCENE_API",
        "prepare_scene is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return new WasmPreparedSceneHandle(this, this.instance.prepare_scene(irJson, optionsJson));
  }

  /** Sample and emit a prepared scene, rejecting cross-instance handles. */
  renderPreparedToSvg(prepared: WasmPreparedSceneHandle, optionsJson: string): string {
    this.ensureNotDisposed();
    const state = requirePreparedSceneState(prepared);
    if (state.owner !== this) {
      throw new FatalError(
        "WASM_PREPARED_SCENE_WRONG_ENGINE",
        "Prepared scene belongs to a different WASM engine instance",
        { stage: "wasm" },
      );
    }
    if (typeof this.instance.render_prepared_to_svg !== "function") {
      throw new FatalError(
        "WASM_NO_PREPARED_SCENE_API",
        "render_prepared_to_svg is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return this.instance.render_prepared_to_svg(state.ownerRecord.instance, optionsJson);
  }

  createShapeFnRegistered(
    alias: string,
    weight = DEFAULT_FONT_WEIGHT,
    style: "normal" | "italic" = "normal",
  ): ShapeFn {
    return (
      text: string,
      params: { fontSizePx: number; letterSpacingPx: number; shapeOptions?: ShapingOptions },
    ): GlyphInfo[] => {
      this.ensureNotDisposed();
      const inst = this.instance;
      const { fontSizePx, letterSpacingPx, shapeOptions } = params;
      let json: string;
      if (shapeOptions && typeof inst.shape_text_registered_with_options === "function") {
        json = inst.shape_text_registered_with_options(
          alias,
          weight,
          style,
          text,
          fontSizePx,
          letterSpacingPx,
          JSON.stringify(shapeOptions),
        );
      } else {
        json = inst.shape_text_registered(alias, weight, style, text, fontSizePx, letterSpacingPx);
      }
      return parseWasmJson(
        json,
        isGlyphInfoArray,
        "WASM_INVALID_SHAPE_OUTPUT",
        "WASM shape_text_registered returned invalid glyph JSON.",
      );
    };
  }

  createShapeFnRegisteredWithFallback(
    aliases: readonly string[],
    weight = DEFAULT_FONT_WEIGHT,
    style: "normal" | "italic" = "normal",
  ): ShapeFn {
    const chain = normalizeAliasChain(aliases);
    const primary = chain[0];
    return (
      text: string,
      params: { fontSizePx: number; letterSpacingPx: number; shapeOptions?: ShapingOptions },
    ): GlyphInfo[] => {
      if (!primary) {
        return [];
      }
      this.ensureNotDisposed();
      const inst = this.instance;
      const { fontSizePx, letterSpacingPx, shapeOptions } = params;
      const aliasesJson = JSON.stringify(chain);
      let json: string;
      if (
        shapeOptions &&
        typeof inst.shape_text_registered_with_fallback_with_options === "function"
      ) {
        json = inst.shape_text_registered_with_fallback_with_options(
          aliasesJson,
          weight,
          style,
          text,
          fontSizePx,
          letterSpacingPx,
          JSON.stringify(shapeOptions),
        );
      } else if (typeof inst.shape_text_registered_with_fallback === "function") {
        json = inst.shape_text_registered_with_fallback(
          aliasesJson,
          weight,
          style,
          text,
          fontSizePx,
          letterSpacingPx,
        );
      } else if (shapeOptions && typeof inst.shape_text_registered_with_options === "function") {
        json = inst.shape_text_registered_with_options(
          primary,
          weight,
          style,
          text,
          fontSizePx,
          letterSpacingPx,
          JSON.stringify(shapeOptions),
        );
      } else {
        json = inst.shape_text_registered(
          primary,
          weight,
          style,
          text,
          fontSizePx,
          letterSpacingPx,
        );
      }
      return parseWasmJson(
        json,
        isGlyphInfoArray,
        "WASM_INVALID_FALLBACK_SHAPE_OUTPUT",
        "WASM fallback shaping returned invalid glyph JSON.",
      );
    };
  }

  createSvgToPngFn(): (svg: string, options?: PngRenderOptions) => Uint8Array {
    return (svg: string, options?: PngRenderOptions) => {
      this.ensureNotDisposed();
      const inst = this.instance;
      if (options && typeof inst.svg_to_png_with_options === "function") {
        return inst.svg_to_png_with_options(svg, JSON.stringify(options));
      }
      return inst.svg_to_png(svg);
    };
  }

  /** Resolve the Rust side of the shared raster dimension contract. */
  resolveRasterScale(width: number, height: number, requestedScale: number): ResolvedRasterScale {
    this.ensureNotDisposed();
    if (typeof this.instance.resolve_raster_scale !== "function") {
      throw new FatalError(
        "WASM_NO_RASTER_SCALE_RESOLVER",
        "resolve_raster_scale is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return parseWasmJson(
      this.instance.resolve_raster_scale(width, height, requestedScale),
      isResolvedRasterScale,
      "WASM_INVALID_RASTER_SCALE_OUTPUT",
      "WASM resolve_raster_scale returned invalid JSON.",
    );
  }

  /**
   * WebP encoding has no options-free WASM export, so a runtime built before
   * the WebP export exists yields `undefined` and the engine reports
   * `WEBP_NO_ENCODER` instead of failing inside WASM.
   */
  createSvgToWebpFn(): ((svg: string, options?: PngRenderOptions) => Uint8Array) | undefined {
    const instance = this.instance;
    const encodeWebp = instance.svg_to_webp_with_options;
    if (typeof encodeWebp !== "function") {
      return undefined;
    }
    return (svg: string, options?: PngRenderOptions) => {
      this.ensureNotDisposed();
      // wasm-bindgen methods read `this.__wbg_ptr`, so the call must keep the
      // instance as its receiver.
      return encodeWebp.call(instance, svg, JSON.stringify(options ?? {}));
    };
  }

  /**
   * Animated WebP muxing has no options-free export either, so a runtime built
   * before it exists yields `undefined` and the engine reports
   * `WEBP_NO_ENCODER`.
   */
  createSvgsToAnimatedWebpFn(): ((input: AnimationEncodeInput) => Uint8Array) | undefined {
    const instance = this.instance;
    const encodeAnimatedWebp = instance.svgs_to_animated_webp;
    if (typeof encodeAnimatedWebp !== "function") {
      return undefined;
    }
    return (input: AnimationEncodeInput) => {
      this.ensureNotDisposed();
      // wasm-bindgen methods read `this.__wbg_ptr`, so the call must keep the
      // instance as its receiver.
      return encodeAnimatedWebp.call(instance, JSON.stringify(input));
    };
  }

  /** Animated GIF muxing, absent on runtimes built before the export existed. */
  createSvgsToAnimatedGifFn(): ((input: AnimationEncodeInput) => Uint8Array) | undefined {
    const instance = this.instance;
    const encodeAnimatedGif = instance.svgs_to_animated_gif;
    if (typeof encodeAnimatedGif !== "function") {
      return undefined;
    }
    return (input: AnimationEncodeInput) => {
      this.ensureNotDisposed();
      // wasm-bindgen methods read `this.__wbg_ptr`, so the call must keep the
      // instance as its receiver.
      return encodeAnimatedGif.call(instance, JSON.stringify(input));
    };
  }

  createValidateLayeredSvgCompositionFn():
    | ((input: WasmLayeredCompositionValidationInput) => WasmLayeredCompositionValidationMetrics)
    | undefined {
    // Keep the method attached to the instance: wasm-bindgen methods read
    // `this.__wbg_ptr`, so a detached reference throws at call time — which
    // used to downgrade every real-WASM validation to status "skipped".
    const instance = this.instance;
    if (typeof instance.validate_layered_svg_composition !== "function") {
      return undefined;
    }

    return (input: WasmLayeredCompositionValidationInput) => {
      this.ensureNotDisposed();
      const json = instance.validate_layered_svg_composition?.(JSON.stringify(input)) ?? "";
      return parseWasmJson(
        json,
        isLayeredCompositionValidationMetrics,
        "WASM_INVALID_LAYERED_COMPOSITION_VALIDATION_OUTPUT",
        "WASM validate_layered_svg_composition returned invalid JSON.",
      );
    };
  }

  createGlyphPathFn(
    alias: string,
    weight = DEFAULT_FONT_WEIGHT,
    style: "normal" | "italic" = "normal",
  ): GlyphPathFn {
    return (
      text: string,
      params: {
        fontSizePx: number;
        letterSpacingPx: number;
        baselineY: number;
        startX: number;
        pathOptions?: GlyphPathOptions;
      },
    ): WasmGlyphPath[] => {
      this.ensureNotDisposed();
      const inst = this.instance;
      const { fontSizePx, letterSpacingPx, baselineY, startX, pathOptions } = params;
      let json: string;
      if (pathOptions && typeof inst.extract_glyph_paths_with_options === "function") {
        json = inst.extract_glyph_paths_with_options(
          alias,
          weight,
          style,
          text,
          fontSizePx,
          baselineY,
          startX,
          letterSpacingPx,
          JSON.stringify({ writingMode: pathOptions.writingMode }),
        );
      } else {
        json = inst.extract_glyph_paths(
          alias,
          weight,
          style,
          text,
          fontSizePx,
          baselineY,
          startX,
          letterSpacingPx,
        );
      }
      return parseWasmJson(
        json,
        isWasmGlyphPathArray,
        "WASM_INVALID_GLYPH_PATHS",
        "WASM extract_glyph_paths returned invalid JSON.",
      );
    };
  }

  createGlyphPathFnWithFallback(
    aliases: readonly string[],
    weight = DEFAULT_FONT_WEIGHT,
    style: "normal" | "italic" = "normal",
  ): GlyphPathFn {
    const chain = normalizeAliasChain(aliases);
    const primary = chain[0];
    return (
      text: string,
      params: {
        fontSizePx: number;
        letterSpacingPx: number;
        baselineY: number;
        startX: number;
        pathOptions?: GlyphPathOptions;
      },
    ): WasmGlyphPath[] => {
      if (!primary) {
        return [];
      }
      this.ensureNotDisposed();
      const inst = this.instance;
      const { fontSizePx, letterSpacingPx, baselineY, startX, pathOptions } = params;
      const aliasesJson = JSON.stringify(chain);
      let json: string;
      if (
        pathOptions &&
        typeof inst.extract_glyph_paths_with_fallback_with_options === "function"
      ) {
        json = inst.extract_glyph_paths_with_fallback_with_options(
          aliasesJson,
          weight,
          style,
          text,
          fontSizePx,
          baselineY,
          startX,
          letterSpacingPx,
          JSON.stringify({ writingMode: pathOptions.writingMode }),
        );
      } else if (typeof inst.extract_glyph_paths_with_fallback === "function") {
        json = inst.extract_glyph_paths_with_fallback(
          aliasesJson,
          weight,
          style,
          text,
          fontSizePx,
          baselineY,
          startX,
          letterSpacingPx,
        );
      } else if (pathOptions && typeof inst.extract_glyph_paths_with_options === "function") {
        json = inst.extract_glyph_paths_with_options(
          primary,
          weight,
          style,
          text,
          fontSizePx,
          baselineY,
          startX,
          letterSpacingPx,
          JSON.stringify({ writingMode: pathOptions.writingMode }),
        );
      } else {
        json = inst.extract_glyph_paths(
          primary,
          weight,
          style,
          text,
          fontSizePx,
          baselineY,
          startX,
          letterSpacingPx,
        );
      }
      return parseWasmJson(
        json,
        isWasmGlyphPathArray,
        "WASM_INVALID_FALLBACK_GLYPH_PATHS",
        "WASM fallback glyph path extraction returned invalid JSON.",
      );
    };
  }

  extractPositionedGlyphPaths(glyphs: PositionedGlyphPathRequest[]): WasmGlyphPath[] {
    this.ensureNotDisposed();
    const invalidGlyph = glyphs.find(
      (glyph) =>
        glyph.baselineRotationDeg !== undefined && !Number.isFinite(glyph.baselineRotationDeg),
    );
    if (invalidGlyph) {
      throw new FatalError(
        "TEXT_BASELINE_ROTATION_INVALID",
        "baselineRotationDeg must be finite.",
        { stage: "text" },
      );
    }
    const invalidInlineScale = glyphs.find(
      (glyph) =>
        glyph.inlineScale !== undefined &&
        (!Number.isFinite(glyph.inlineScale) || glyph.inlineScale <= 0),
    );
    if (invalidInlineScale) {
      throw new FatalError(
        "TEXT_PATH_INLINE_SCALE_INVALID",
        "inlineScale must be positive and finite.",
        { stage: "text" },
      );
    }
    if (typeof this.instance.extract_positioned_glyph_paths !== "function") {
      throw new FatalError(
        "WASM_NO_POSITIONED_GLYPH_PATHS",
        "This WASM build does not support positioned glyph outline extraction.",
        { stage: "wasm" },
      );
    }
    const json = this.instance.extract_positioned_glyph_paths(JSON.stringify(glyphs));
    return parseWasmJson(
      json,
      isWasmGlyphPathArray,
      "WASM_INVALID_POSITIONED_GLYPH_PATHS",
      "WASM extract_positioned_glyph_paths returned invalid JSON.",
    );
  }

  createShapeWithVariationsFn(
    alias: string,
    weight = DEFAULT_FONT_WEIGHT,
    style: "normal" | "italic" = "normal",
  ): ShapeWithVariationsFn | null {
    if (typeof this.instance.shape_text_with_variations !== "function") {
      return null;
    }
    return (
      text: string,
      params: {
        fontSizePx: number;
        letterSpacingPx: number;
        variationsJson: string;
        shapeOptions?: ShapingOptions;
      },
    ): GlyphInfo[] => {
      this.ensureNotDisposed();
      const inst = this.instance;
      const { fontSizePx, letterSpacingPx, variationsJson, shapeOptions } = params;
      let json: string;
      if (shapeOptions && typeof inst.shape_text_with_variations_with_options === "function") {
        json = inst.shape_text_with_variations_with_options(
          alias,
          weight,
          style,
          text,
          fontSizePx,
          letterSpacingPx,
          variationsJson,
          JSON.stringify(shapeOptions),
        );
      } else if (typeof inst.shape_text_with_variations === "function") {
        json = inst.shape_text_with_variations(
          alias,
          weight,
          style,
          text,
          fontSizePx,
          letterSpacingPx,
          variationsJson,
        );
      } else {
        throw new FatalError(
          "WASM_UNSUPPORTED",
          "shape_text_with_variations is not available in this WASM build",
          { stage: "wasm" },
        );
      }
      return parseWasmJson(
        json,
        isGlyphInfoArray,
        "WASM_INVALID_VARIATION_SHAPE_OUTPUT",
        "WASM variation shaping returned invalid glyph JSON.",
      );
    };
  }

  layoutTextFlow(input: TextFlowInput): TextFlowResult {
    this.ensureNotDisposed();
    const layoutTextFlow = this.instance.layout_text_flow;
    if (typeof layoutTextFlow !== "function") {
      throw new FatalError(
        "WASM_NO_FLOW_API",
        "layout_text_flow is not available in this WASM build. Rebuild WASM.",
        { stage: "wasm" },
      );
    }
    return invokeWasmTextLayout(
      "layoutTextFlow",
      () => layoutTextFlow.call(this.instance, JSON.stringify(input)),
      decodeTextFlowResult,
    );
  }

  layoutTextFlowWithExclusions(input: TextFlowWithExclusionsInput): TextFlowWithExclusionsResult {
    this.ensureNotDisposed();
    const layoutTextFlowWithExclusions = this.instance.layout_text_flow_with_exclusions;
    if (typeof layoutTextFlowWithExclusions !== "function") {
      throw new FatalError(
        "WASM_NO_EXCLUSION_FLOW_API",
        "layout_text_flow_with_exclusions is not available in this WASM build.",
        { stage: "wasm" },
      );
    }
    return invokeWasmTextLayout(
      "layoutTextFlowWithExclusions",
      () => layoutTextFlowWithExclusions.call(this.instance, JSON.stringify(input)),
      decodeTextFlowWithExclusionsResult,
    );
  }

  measureTextBlock(input: MeasureTextBlockInput): MeasureTextBlockResult {
    this.ensureNotDisposed();
    const measureTextBlock = this.instance.measure_text_block;
    if (typeof measureTextBlock !== "function") {
      throw new FatalError(
        "WASM_NO_MEASURE_API",
        "measure_text_block is not available in this WASM build.",
        { stage: "wasm" },
      );
    }
    return invokeWasmTextLayout(
      "measureTextBlock",
      () => measureTextBlock.call(this.instance, JSON.stringify(input)),
      decodeMeasureTextBlockResult,
    );
  }

  shrinkwrapText(input: ShrinkwrapTextInput): ShrinkwrapTextResult {
    this.ensureNotDisposed();
    const shrinkwrapText = this.instance.shrinkwrap_text;
    if (typeof shrinkwrapText !== "function") {
      throw new FatalError(
        "WASM_NO_SHRINKWRAP_API",
        "shrinkwrap_text is not available in this WASM build.",
        { stage: "wasm" },
      );
    }
    return invokeWasmTextLayout(
      "shrinkwrapText",
      () => shrinkwrapText.call(this.instance, JSON.stringify(input)),
      decodeShrinkwrapTextResult,
    );
  }

  shrinkwrapFlow(input: ShrinkwrapFlowInput): ShrinkwrapFlowResult {
    this.ensureNotDisposed();
    const shrinkwrapFlow = this.instance.shrinkwrap_flow;
    if (typeof shrinkwrapFlow !== "function") {
      throw new FatalError(
        "WASM_NO_SHRINKWRAP_FLOW_API",
        "shrinkwrap_flow is not available in this WASM build.",
        { stage: "wasm" },
      );
    }
    return invokeWasmTextLayout(
      "shrinkwrapFlow",
      () => shrinkwrapFlow.call(this.instance, JSON.stringify(input)),
      decodeShrinkwrapFlowResult,
    );
  }

  measureIntrinsicInlineSize(input: IntrinsicInlineSizeInput): IntrinsicInlineSizeResult {
    this.ensureNotDisposed();
    const measureIntrinsicInlineSize = this.instance.measure_intrinsic_inline_size;
    if (typeof measureIntrinsicInlineSize !== "function") {
      throw new FatalError(
        "WASM_NO_INTRINSIC_INLINE_SIZE_API",
        "measure_intrinsic_inline_size is not available in this WASM build.",
        { stage: "wasm" },
      );
    }
    return invokeWasmTextLayout(
      "measureIntrinsicInlineSize",
      () => measureIntrinsicInlineSize.call(this.instance, JSON.stringify(input)),
      decodeIntrinsicInlineSizeResult,
    );
  }

  dispose(): void {
    if (!this._disposed) {
      for (const ownerRecord of preparedScenesByOwner.get(this) ?? []) {
        const prepared = ownerRecord.reference.deref();
        if (prepared) {
          prepared.dispose();
        } else {
          releasePreparedSceneRecord(ownerRecord);
        }
      }
      preparedScenesByOwner.get(this)?.clear();
      for (const ownerRecord of rasterScenesByOwner.get(this) ?? []) {
        const scene = ownerRecord.reference.deref();
        if (scene) {
          scene.dispose();
        } else {
          releaseRasterSceneRecord(ownerRecord);
        }
      }
      rasterScenesByOwner.get(this)?.clear();
      this.instance.free();
      this._disposed = true;
    }
  }

  private ensureNotDisposed(): void {
    if (this._disposed) {
      throw new FatalError("WASM_INSTANCE_DISPOSED", "WASM engine instance has been disposed", {
        stage: "wasm",
      });
    }
  }
}

/** Input for variable-width text flow layout */
export type TextFlowInput = {
  text: string;
  fontFamily: string;
  /** Ordered fallback aliases, matching `Text.fallback`. */
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx: number;
  lineHeight?: number;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  wrap?: "none" | "word" | "char";
  /** Omitted preserves the default preformatted flow behavior. */
  whiteSpace?: "normal" | "nowrap" | "pre-wrap";
  tabSize?: number;
  hangingPunctuation?: boolean;
  lineWidths: number[];
  writingMode?: "horizontal-tb" | "vertical-rl";
  textOrientation?: "mixed" | "upright";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
};

/** A single line from flow layout */
export type TextFlowLine = {
  text: string;
  charStart: number;
  charEnd: number;
  inlineAdvancePx: number;
  availableInlineSizePx: number;
};

/** Result of variable-width text flow layout */
export type TextFlowResult = {
  lines: TextFlowLine[];
  exhausted: boolean;
  warnings?: SerializedRecoverableError[];
};

// ---------------------------------------------------------------------------
// Exclusion-based flow layout types
// ---------------------------------------------------------------------------

/** An exclusion shape that text flows around */
export type FlowExclusionMarginPx =
  | number
  | {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };

export type FlowExclusionShape =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      marginPx?: FlowExclusionMarginPx;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      marginPx?: FlowExclusionMarginPx;
    }
  | {
      kind: "path";
      d: string;
      x?: number;
      y?: number;
      fillRule?: "nonzero" | "evenodd";
      marginPx?: FlowExclusionMarginPx;
    };

/** Input for text flow with shape exclusions */
export type TextFlowWithExclusionsInput = {
  text: string;
  fontFamily: string;
  /** Ordered fallback aliases, matching `Text.fallback`. */
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  wrap?: "none" | "word" | "char";
  hangingPunctuation?: boolean;
  /** Whitespace policy. Omitted preserves the default preformatted flow behavior. */
  whiteSpace?: "normal" | "nowrap" | "pre-wrap";
  tabSize?: number;
  flowBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  exclusions: FlowExclusionShape[];
  minRegionWidthPx?: number;
  maxLines?: number;
  ellipsis?: boolean;
  fit?: "shrink" | "grow";
  minFontSizePx?: number;
  maxFontSizePx?: number;
  fitEpsilonPx?: number;
  fitMaxIterations?: number;
  /** Maximum exact-grid probes when content or flow geometry is not monotone-certified. */
  fitMaxProbes?: number;
  spans?: TextMeasureSpan[];
  richText?: RichTextNode[];
  writingMode?: "horizontal-tb" | "vertical-rl";
  textOrientation?: "mixed" | "upright";
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
};

/**
 * A styled text span for the measurement/flow APIs (`layoutTextFlowWithExclusions`,
 * `shrinkwrapText`, `shrinkwrapFlow`). One shared shape — the WASM side deserializes
 * all three identically.
 */
export type TextMeasureSpan = {
  text: string;
  fontFamily?: string;
  /** Ordered fallback aliases; inherits the top-level chain when omitted. */
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx?: number;
  letterSpacingPx?: number;
  color?: string;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  rubyText?: string;
  rubyPosition?: "over" | "under";
  rubyAlign?: "start" | "center" | "space-between" | "space-around";
  rubyFontSizePx?: number;
  rubyColor?: string;
};

/** Per-fragment style for inline runs (populated when spans are used) */
export type TextFlowFragmentStyle = {
  fontFamily: string;
  fontWeight: number;
  fontStyle: string;
  fontSizePx: number;
  letterSpacingPx?: number;
  color?: string;
};

/** Ruby annotation attached to a flow fragment */
export type TextFlowRubyAnnotation = {
  text: string;
  position: string;
  align: string;
  style: TextFlowFragmentStyle;
  /** Gap between annotation and base text (px). */
  gapPx: number;
  /** Additional displacement away from the base (px). */
  offsetPx: number;
  lineSizing: "stable" | "css";
  /** All annotation levels; top-level fields mirror the first level. */
  levels: Array<{
    text: string;
    position: "over" | "under";
    runs: Array<{ text: string; style: TextFlowFragmentStyle }>;
  }>;
};

/** A text fragment placed within one free region of a visual line */
export type TextFlowFragment = {
  text: string;
  charStart: number;
  charEnd: number;
  x: number;
  y: number;
  /** Consumed inline advance in px (physical width for horizontal, physical height for vertical). */
  inlineAdvancePx: number;
  /** Available inline size of the region in px. */
  availableInlineSizePx: number;
  regionIndex: number;
  /** Shared cross-axis reference offset: horizontal alphabetic baseline from
   *  line top, or vertical centerline from column left. */
  baselineOffset: number;
  overflowReason?: "kinsokuAbsorb" | "hangingPunctuation" | "ellipsis";
  style?: TextFlowFragmentStyle;
  ruby?: TextFlowRubyAnnotation;
};

/** A visual line with one or more fragments */
export type TextFlowExclusionLine = {
  fragments: TextFlowFragment[];
  lineIndex: number;
  /**
   * Cross-axis size of the line (height for horizontal, column width for
   * vertical). Mixed font sizes, ruby, and inline boxes make a line taller
   * than the base line height, so this cannot be derived from line positions.
   */
  crossSize: number;
};

/** Why the flow layout stopped before consuming all text. */
export type FlowOverflowReason = "maxLinesTruncated" | "flowBoxExhausted" | "cannotFit";

/** Result of text flow with shape exclusions */
export type TextFlowWithExclusionsResult = {
  lines: TextFlowExclusionLine[];
  exhausted: boolean;
  usedLineCount: number;
  overflowReason?: FlowOverflowReason;
  chosenFontSizePx?: number;
  warnings?: SerializedRecoverableError[];
  /** Over-side ruby annotation extent (font size + gap); never add it to measured height. */
  topRubyOverflowPx: number;
  /** Under-side ruby annotation extent (font size + gap); never add it to measured height. */
  bottomRubyOverflowPx: number;
};

// ---------------------------------------------------------------------------
// Measurement API types
// ---------------------------------------------------------------------------

type MeasureTextBlockCommonInput = {
  text: string;
  fontFamily: string;
  /** Ordered fallback aliases, matching `Text.fallback`. */
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  textIndent?: number;
  language?: "ja" | "en" | "auto";
  wrap?: "none" | "word" | "char";
  hangingPunctuation?: boolean;
  whiteSpace?: "normal" | "nowrap" | "pre-wrap";
  tabSize?: number;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
};

/** Input for horizontal text block measurement */
export type HorizontalMeasureTextBlockInput = MeasureTextBlockCommonInput & {
  writingMode?: "horizontal-tb";
  maxWidth: number;
};

/** Input for vertical text block measurement */
export type VerticalMeasureTextBlockInput = MeasureTextBlockCommonInput & {
  writingMode: "vertical-rl";
  textOrientation?: "mixed" | "upright";
  maxHeight: number;
};

/** Input for measuring a text block */
export type MeasureTextBlockInput = HorizontalMeasureTextBlockInput | VerticalMeasureTextBlockInput;

/**
 * Per-line break diagnostics from `measureTextBlock` (horizontal writing mode
 * only — for vertical per-line data use `layoutTextFlow`).
 */
export type MeasureTextBlockLine = {
  /** Grapheme-cluster range [start, end) in the input text. */
  charStart: number;
  charEnd: number;
  /**
   * The line's text, sliced engine-side from the whitespace-normalized
   * paragraph — exactly what was measured.
   */
  text: string;
  /** Consumed inline advance of the line in px. */
  inlineAdvancePx: number;
  /** Kinsoku backtracking failed for this line (forced break). */
  kinsokuUnresolved: boolean;
};

/**
 * Result of measuring a text block. The inline-axis constraint is a wrapping
 * boundary, not a clipping limit, so the complete input is always measured.
 */
export type MeasureTextBlockResult = {
  lineCount: number;
  usedWidth: number;
  usedHeight: number;
  /**
   * Per-line break diagnostics. Present for horizontal writing mode; omitted
   * for vertical. Forced-newline separators (`white-space: pre-wrap`) belong
   * to no line, leaving a one-grapheme gap between consecutive ranges.
   */
  lines?: MeasureTextBlockLine[];
};

// ---------------------------------------------------------------------------
// Shrinkwrap API types
// ---------------------------------------------------------------------------

/** Whether the shrinkwrap search found a width satisfying the target */
export type ShrinkwrapStatus = "satisfied" | "infeasible";

type ShrinkwrapTextCommonInput = {
  text: string;
  fontFamily: string;
  /** Ordered fallback aliases, matching `Text.fallback`. */
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  wrap?: "none" | "word" | "char";
  hangingPunctuation?: boolean;
  targetLineCount?: number;
  epsilonPx?: number;
  maxIterations?: number;
  whiteSpace?: "normal" | "nowrap" | "pre-wrap";
  tabSize?: number;
  spans?: TextMeasureSpan[];
  richText?: RichTextNode[];
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
};

/** Input for horizontal text shrinkwrap */
export type HorizontalShrinkwrapTextInput = ShrinkwrapTextCommonInput & {
  writingMode?: "horizontal-tb";
  maxWidth: number;
  minWidth?: number;
};

/** Input for vertical text shrinkwrap */
export type VerticalShrinkwrapTextInput = ShrinkwrapTextCommonInput & {
  writingMode: "vertical-rl";
  textOrientation?: "mixed" | "upright";
  maxWidth: number;
  maxHeight: number;
  minHeight?: number;
};

/** Input for text shrinkwrap */
export type ShrinkwrapTextInput = HorizontalShrinkwrapTextInput | VerticalShrinkwrapTextInput;

type ShrinkwrapTextResultBase = {
  status: ShrinkwrapStatus;
  lineCount: number;
  usedHeight: number;
};

/** Result of horizontal text shrinkwrap */
export type HorizontalShrinkwrapTextResult = ShrinkwrapTextResultBase & {
  chosenWidthPx: number;
  chosenHeightPx?: never;
  usedWidth?: never;
  maxLineWidth: number;
};

/** Result of vertical text shrinkwrap */
export type VerticalShrinkwrapTextResult = ShrinkwrapTextResultBase & {
  chosenWidthPx?: never;
  chosenHeightPx: number;
  usedWidth: number;
  maxLineWidth?: never;
};

/** Result of text shrinkwrap */
export type ShrinkwrapTextResult = HorizontalShrinkwrapTextResult | VerticalShrinkwrapTextResult;

/** Input for flow shrinkwrap with exclusions */
export type ShrinkwrapFlowInput = {
  text: string;
  fontFamily: string;
  /** Ordered fallback aliases, matching `Text.fallback`. */
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  language?: "ja" | "en" | "auto";
  wrap?: "none" | "word" | "char";
  hangingPunctuation?: boolean;
  flowBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  exclusions: FlowExclusionShape[];
  minRegionWidthPx?: number;
  maxLines?: number;
  writingMode?: "horizontal-tb" | "vertical-rl";
  textOrientation?: "mixed" | "upright";
  /** Minimum search width for horizontal shrinkwrap. */
  minWidth?: number;
  /** Minimum search height for vertical-rl shrinkwrap. */
  minHeight?: number;
  targetLineCount?: number;
  shrinkwrapEpsilonPx?: number;
  shrinkwrapMaxIterations?: number;
  spans?: TextMeasureSpan[];
  richText?: RichTextNode[];
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
};

/** Result of flow shrinkwrap with exclusions */
export type ShrinkwrapFlowResult = {
  status: ShrinkwrapStatus;
  /** Chosen width for horizontal shrinkwrap. Absent for vertical-rl. */
  chosenWidthPx?: number;
  /** Chosen height for vertical-rl shrinkwrap. Absent for horizontal. */
  chosenHeightPx?: number;
  usedLineCount: number;
  /** Actual used height from the layout result. */
  usedHeight: number;
  layout: TextFlowWithExclusionsResult;
};

/** Input for intrinsic inline-size measurement */
export type IntrinsicInlineSizeInput = {
  text: string;
  fontFamily: string;
  /** Ordered fallback aliases, matching `Text.fallback`. */
  fallback?: string[];
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontSizePx: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  textIndent?: number;
  language?: "ja" | "en" | "auto";
  richText?: RichTextNode[];
  writingMode?: "horizontal-tb" | "vertical-rl";
  textOrientation?: "mixed" | "upright";
  whiteSpace?: "normal" | "nowrap" | "pre-wrap";
  tabSize?: number;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
};

/** Result of intrinsic inline-size measurement */
export type IntrinsicInlineSizeResult = {
  minContentInlineSize: number;
  maxContentInlineSize: number;
  warnings?: SerializedRecoverableError[];
};

// Re-export types
export type {
  WasmEngineInstance,
  WasmGlyphInfo,
  WasmLayoutNode,
  WasmLayoutOutput,
  WasmModule,
  WasmPreparedSceneInstance,
} from "./types.js";
