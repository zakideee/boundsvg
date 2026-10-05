import {
  RASTER_MAX_LONG_EDGE,
  RASTER_MAX_PIXELS,
  type RasterScaleOptions,
  type ResolvedRasterScale,
  resolveRasterScale,
} from "../../dist/index.js";

/** Accepted raster scale request type witness. */
const options: RasterScaleOptions = { width: 1_920, height: 1_080, requestedScale: 2 };
/** Resolved raster scale return-type witness. */
const resolution: ResolvedRasterScale = resolveRasterScale(options);
/** Public raster domain limits return-type witness. */
const limits: readonly number[] = [RASTER_MAX_LONG_EDGE, RASTER_MAX_PIXELS];

void resolution;
void limits;

// @ts-expect-error the resolver requires a requested scale
resolveRasterScale({ width: 1_920, height: 1_080 });
