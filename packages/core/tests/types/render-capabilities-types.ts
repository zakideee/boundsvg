import {
  MAX_ANIMATION_FRAMES,
  MAX_ANIMATION_SVG_PAYLOAD_CHARS,
  RASTER_MAX_LONG_EDGE,
  RASTER_MAX_PIXELS,
  type RasterScaleOptions,
  type ResolvedRasterScale,
  resolveRasterScale,
} from "../../dist/index.js";

const options: RasterScaleOptions = { width: 1_920, height: 1_080, requestedScale: 2 };
const resolution: ResolvedRasterScale = resolveRasterScale(options);
const limits: readonly number[] = [
  RASTER_MAX_LONG_EDGE,
  RASTER_MAX_PIXELS,
  MAX_ANIMATION_FRAMES,
  MAX_ANIMATION_SVG_PAYLOAD_CHARS,
];

void resolution;
void limits;

// @ts-expect-error the resolver requires a requested scale
resolveRasterScale({ width: 1_920, height: 1_080 });
