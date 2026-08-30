import { FatalError } from "./errors.js";
import { formatNumber } from "./svg/utils.js";

/** Maximum raster output length on either axis, in pixels. */
export const RASTER_MAX_LONG_EDGE = 3_840;

/** Maximum total raster output area, in pixels. */
export const RASTER_MAX_PIXELS = 3_840 * 2_160;

/** Maximum requested-axis value reported across the Rust `u32` raster boundary. */
export const RASTER_DIMENSION_SATURATION = 0xffff_ffff;

/** Maximum number of frames accepted by an animated raster render. */
export const MAX_ANIMATION_FRAMES = 300;

/**
 * Maximum combined SVG character count transported to an animated raster
 * encoder. This is a character count, not a UTF-8 byte count.
 */
export const MAX_ANIMATION_SVG_PAYLOAD_CHARS = 64 * 1_024 * 1_024;

/** Hard limits enforced before document-timeline animation CSS is serialized. */
export const animatedSvgTimelineLimits = Object.freeze({
  maxKeyframeStops: 16_384,
  maxCssBytes: 16 * 1_024 * 1_024,
});

/** Post-layout base dimensions and requested scale used to resolve a raster plan. */
export type RasterScaleOptions = {
  /** Effective unscaled root width in px (for a render prediction, use current compiled IR). */
  width: number;
  /** Effective unscaled root height in px (for a render prediction, use current compiled IR). */
  height: number;
  /** Caller-requested raster multiplier. */
  requestedScale: number;
};

/** Raster dimensions and scale selected under the public hard limits. */
export type ResolvedRasterScale = {
  appliedScale: number;
  requestedWidth: number;
  requestedHeight: number;
  outputWidth: number;
  outputHeight: number;
  adjusted: boolean;
};

function rasterOutputDimensions(
  width: number,
  height: number,
  scale: number,
): { outputWidth: number; outputHeight: number } {
  // The Rust emitter formats root SVG dimensions through the same two-decimal
  // contract before the rasterizer reads them. Rounding here first prevents a
  // floating-point value just above an integer from predicting one extra pixel.
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const emittedWidth = Number.isFinite(scaledWidth)
    ? Number(formatNumber(scaledWidth))
    : scaledWidth;
  const emittedHeight = Number.isFinite(scaledHeight)
    ? Number(formatNumber(scaledHeight))
    : scaledHeight;
  return {
    outputWidth: Number.isFinite(emittedWidth)
      ? Math.min(Math.ceil(emittedWidth), RASTER_DIMENSION_SATURATION)
      : RASTER_DIMENSION_SATURATION,
    outputHeight: Number.isFinite(emittedHeight)
      ? Math.min(Math.ceil(emittedHeight), RASTER_DIMENSION_SATURATION)
      : RASTER_DIMENSION_SATURATION,
  };
}

function assertRasterScale(requestedScale: number): void {
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
    throw new FatalError(
      "PNG_INVALID_SCALE",
      `Invalid PNG scale factor: ${String(requestedScale)}`,
      { stage: "emit" },
    );
  }
}

function assertRasterCanvasDimension(name: "width" | "height", value: number): void {
  if (!Number.isFinite(value) || value <= 0 || Number(formatNumber(value)) <= 0) {
    throw new FatalError(
      "INVALID_CANVAS_SIZE",
      `Compiled scene has an invalid canvas ${name}: ${String(value)}`,
      { stage: "emit" },
    );
  }
}

function assertPositiveRasterOutput(
  outputWidth: number,
  outputHeight: number,
  options: RasterScaleOptions,
): void {
  if (outputWidth > 0 && outputHeight > 0) {
    return;
  }
  throw new FatalError(
    "PNG_OUTPUT_DIMENSION_TOO_SMALL",
    `PNG output rounds to a zero-pixel axis at scale ${String(options.requestedScale)}: ` +
      `${String(options.width)}x${String(options.height)}`,
    {
      stage: "emit",
      width: options.width,
      height: options.height,
      requestedScale: options.requestedScale,
      outputWidth,
      outputHeight,
    },
  );
}

function fitsRasterCaps(outputWidth: number, outputHeight: number): boolean {
  return (
    Math.max(outputWidth, outputHeight) <= RASTER_MAX_LONG_EDGE &&
    outputWidth * outputHeight <= RASTER_MAX_PIXELS
  );
}

/**
 * Resolve the raster scale and dimensions for the supplied base dimensions.
 *
 * Raster renderers call this with post-layout root dimensions. Authored Canvas
 * props can be changed by layout, including large integers beyond the exact
 * layout boundary, so pass the current `compiled.ir` dimensions when
 * predicting an actual compiled render. Invalid inputs and positive inputs
 * that quantize to a zero-pixel axis use the renderer's structured raster
 * errors.
 */
export function resolveRasterScale(options: RasterScaleOptions): ResolvedRasterScale {
  const { width, height, requestedScale } = options;
  assertRasterScale(requestedScale);
  assertRasterCanvasDimension("width", width);
  assertRasterCanvasDimension("height", height);

  const { outputWidth: requestedWidth, outputHeight: requestedHeight } = rasterOutputDimensions(
    width,
    height,
    requestedScale,
  );
  assertPositiveRasterOutput(requestedWidth, requestedHeight, options);

  if (fitsRasterCaps(requestedWidth, requestedHeight)) {
    return {
      appliedScale: requestedScale,
      requestedWidth,
      requestedHeight,
      outputWidth: requestedWidth,
      outputHeight: requestedHeight,
      adjusted: false,
    };
  }

  const longEdgeCap = RASTER_MAX_LONG_EDGE / Math.max(width, height);
  let appliedScale = Math.min(requestedScale, longEdgeCap);

  let { outputWidth, outputHeight } = rasterOutputDimensions(width, height, appliedScale);
  assertPositiveRasterOutput(outputWidth, outputHeight, options);
  if (fitsRasterCaps(outputWidth, outputHeight)) {
    return {
      appliedScale,
      requestedWidth,
      requestedHeight,
      outputWidth,
      outputHeight,
      adjusted: appliedScale < requestedScale,
    };
  }

  // Only a proven emitter-rounded integer violation reaches continuous area
  // correction. This preserves exact-cap requests whose f64 product is a few
  // ulps above the cap but whose emitted pixel dimensions are legal.
  const longEdgeBoundedWidth = width * appliedScale;
  const longEdgeBoundedHeight = height * appliedScale;
  const longEdgeBoundedArea = longEdgeBoundedWidth * longEdgeBoundedHeight;
  if (longEdgeBoundedArea > RASTER_MAX_PIXELS) {
    appliedScale *= Math.sqrt(RASTER_MAX_PIXELS / longEdgeBoundedArea);
  }

  ({ outputWidth, outputHeight } = rasterOutputDimensions(width, height, appliedScale));
  assertPositiveRasterOutput(outputWidth, outputHeight, options);

  // Continuous scale limits do not imply an integer-pixel limit: independently
  // ceiling both axes can add enough pixels to cross the area cap. Move to the
  // preceding ceil boundary on both axes until integer arithmetic proves both
  // public limits. Each iteration reduces at least one positive output axis.
  while (!fitsRasterCaps(outputWidth, outputHeight)) {
    const widthBoundary = outputWidth > 1 ? (outputWidth - 1) / width : appliedScale;
    const heightBoundary = outputHeight > 1 ? (outputHeight - 1) / height : appliedScale;
    const correctedScale = Math.min(appliedScale, widthBoundary, heightBoundary);
    appliedScale =
      correctedScale < appliedScale ? correctedScale : appliedScale * (1 - Number.EPSILON);
    ({ outputWidth, outputHeight } = rasterOutputDimensions(width, height, appliedScale));
    assertPositiveRasterOutput(outputWidth, outputHeight, options);
  }

  return {
    appliedScale,
    requestedWidth,
    requestedHeight,
    outputWidth,
    outputHeight,
    adjusted: appliedScale < requestedScale,
  };
}
