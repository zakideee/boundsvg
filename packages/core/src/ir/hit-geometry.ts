import { FatalError } from "../errors.js";
import { type AffineMatrix, applyInverseAffineMatrixToPoint, type Point2D } from "../transform.js";
import type { BBox, BorderRadii, IRPathNode } from "./types.js";

/** Extrema may be infinite only during conservative internal interval arithmetic. */
export type HitBounds = { minX: number; minY: number; maxX: number; maxY: number };

/** One shared ancestor link; coordinates belong to the pre-transform clip. */
export type HitClip = {
  parent: HitClip | null;
  matrix: AffineMatrix;
  bbox: BBox;
  radii?: number | BorderRadii;
};

/** Convert layout bounds without interpreting them as Path paint geometry. */
export function bboxHitBounds(bbox: BBox): HitBounds {
  return { minX: bbox.x, minY: bbox.y, maxX: bbox.x + bbox.w, maxY: bbox.y + bbox.h };
}

/** Intersect conservative intervals before creating finite spatial-index boxes. */
export function intersectHitBounds(left: HitBounds, right: HitBounds): HitBounds | null {
  const bounds = {
    minX: Math.max(left.minX, right.minX),
    minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX),
    maxY: Math.min(left.maxY, right.maxY),
  };
  return bounds.maxX < bounds.minX || bounds.maxY < bounds.minY ? null : bounds;
}

/** Map one interval; zero coefficients annihilate even infinite intermediates. */
function scaleInterval(low: number, high: number, scale: number): [number, number] {
  if (scale === 0) {
    return [0, 0];
  }
  return scale > 0 ? [low * scale, high * scale] : [high * scale, low * scale];
}

/** Opposing infinities represent indeterminate cancellation, hence an unbounded sum. */
function addEndpoint(left: number, right: number, isLowerBound: boolean): number {
  const sum = left + right;
  return Number.isNaN(sum)
    ? isLowerBound
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY
    : sum;
}

/** Transform a conservative enclosure without overflowing its finite wire extrema. */
export function worldHitBounds(matrix: AffineMatrix, bounds: HitBounds): HitBounds {
  const horizontalX = scaleInterval(bounds.minX, bounds.maxX, matrix.a);
  const horizontalY = scaleInterval(bounds.minY, bounds.maxY, matrix.c);
  const verticalX = scaleInterval(bounds.minX, bounds.maxX, matrix.b);
  const verticalY = scaleInterval(bounds.minY, bounds.maxY, matrix.d);
  return {
    minX: addEndpoint(addEndpoint(horizontalX[0], horizontalY[0], true), matrix.e, true),
    maxX: addEndpoint(addEndpoint(horizontalX[1], horizontalY[1], false), matrix.e, false),
    minY: addEndpoint(addEndpoint(verticalX[0], verticalY[0], true), matrix.f, true),
    maxY: addEndpoint(addEndpoint(verticalX[1], verticalY[1], false), matrix.f, false),
  };
}

/** Expand at the chosen coordinate scale; infinite extent remains an explicit interval. */
function expandHitBounds(bounds: HitBounds, outset: number): HitBounds {
  return {
    minX: addEndpoint(bounds.minX, -outset, true),
    minY: addEndpoint(bounds.minY, -outset, true),
    maxX: addEndpoint(bounds.maxX, outset, false),
    maxY: addEndpoint(bounds.maxY, outset, false),
  };
}

/** Decimal rounding shared with finite SVG attributes, retaining overflowed inputs. */
function roundHitDecimal(scalar: number, precision: number): number {
  const factor = 10 ** precision;
  const rounded = Math.round(scalar * factor) / factor;
  return Number.isFinite(rounded) ? rounded : scalar;
}

/**
 * Require canonical schema-34 output, including null for empty geometry.
 * @throws {FatalError} VALIDATION when metadata is absent or malformed; layout
 * bounds cannot replace missing geometry from an older output schema.
 */
function assertPathGeometry(node: IRPathNode): void {
  const geometry = node.pathGeometry;
  const bounds = geometry?.bounds;
  const stroke = geometry?.strokeOutset;
  if (
    !geometry ||
    typeof geometry.isComplete !== "boolean" ||
    !stroke ||
    !Number.isFinite(stroke.radius) ||
    stroke.radius < 0 ||
    !Number.isFinite(stroke.multiplier) ||
    stroke.multiplier < 1 ||
    (bounds !== null &&
      (!bounds ||
        ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) ||
        bounds.minX > bounds.maxX ||
        bounds.minY > bounds.maxY))
  ) {
    throw new FatalError(
      "VALIDATION",
      "Path hit testing requires canonical schema-34 pathGeometry",
      { stage: "ir", nodeId: node.nodeId },
    );
  }
}

/**
 * Place Rust's geometry independently of the layout dimensions. Normal stroke
 * expands before transforms; canvas stroke expands in world space at output
 * scale one. Native browser verification accounts for host CSS/output scales.
 * @throws {FatalError} For missing or invalid derived output metadata.
 */
export function pathWorldHitBounds(node: IRPathNode, matrix: AffineMatrix): HitBounds | null {
  assertPathGeometry(node);
  const geometry = node.pathGeometry;
  if (!geometry.bounds) {
    return null;
  }
  const { radius, multiplier } = geometry.strokeOutset;
  const roundedX = roundHitDecimal(node.bbox.x, 2);
  const roundedY = roundHitDecimal(node.bbox.y, 2);
  const placed = {
    minX:
      geometry.bounds.minX +
      Math.min(node.bbox.x, Number.isFinite(roundedX) ? roundedX : node.bbox.x),
    maxX:
      geometry.bounds.maxX +
      Math.max(node.bbox.x, Number.isFinite(roundedX) ? roundedX : node.bbox.x),
    minY:
      geometry.bounds.minY +
      Math.min(node.bbox.y, Number.isFinite(roundedY) ? roundedY : node.bbox.y),
    maxY:
      geometry.bounds.maxY +
      Math.max(node.bbox.y, Number.isFinite(roundedY) ? roundedY : node.bbox.y),
  };
  const outset = radius * multiplier;
  if (node.strokeScaling !== "canvas") {
    return worldHitBounds(matrix, expandHitBounds(placed, outset));
  }
  const effectiveScale = Math.hypot(matrix.a, matrix.b);
  // The emitter rounds fallback widths after dividing by the effective
  // scale. Include the resulting raster stroke as well as vector-effect paint.
  const authoredWidth = node.strokeWidth ?? 1;
  const fallbackRadius =
    authoredWidth < 0
      ? 0.5 * effectiveScale
      : effectiveScale > 0 && Number.isFinite(effectiveScale)
        ? roundHitDecimal(authoredWidth / effectiveScale, 6) * effectiveScale * 0.5
        : 0;
  const fallbackOutset = radius > 0 ? fallbackRadius * multiplier : 0;
  return expandHitBounds(worldHitBounds(matrix, placed), Math.max(outset, fallbackOutset));
}

/** Rectangle membership in its own coordinate system, including the boundary. */
export function pointInHitBBox(point: Point2D, bbox: BBox): boolean {
  return (
    point.x >= bbox.x &&
    point.y >= bbox.y &&
    point.x <= bbox.x + bbox.w &&
    point.y <= bbox.y + bbox.h
  );
}

/** Reject the circular cutout of a corner, using normalized distances to avoid squares overflowing. */
function cornerContains(point: Point2D, center: Point2D, radius: number): boolean {
  return Math.hypot((point.x - center.x) / radius, (point.y - center.y) / radius) <= 1;
}

/** Test the resolved rectangle/radii in original clip coordinates. */
function pointInRoundedClip(point: Point2D, bbox: BBox, radii?: number | BorderRadii): boolean {
  if (!pointInHitBBox(point, bbox)) {
    return false;
  }
  const uniform =
    typeof radii === "number" ? Math.max(0, Math.min(radii, bbox.w / 2, bbox.h / 2)) : 0;
  const corners =
    typeof radii === "object" ? radii : { tl: uniform, tr: uniform, br: uniform, bl: uniform };
  const right = bbox.x + bbox.w;
  const bottom = bbox.y + bbox.h;
  if (corners.tl > 0 && point.x < bbox.x + corners.tl && point.y < bbox.y + corners.tl) {
    return cornerContains(point, { x: bbox.x + corners.tl, y: bbox.y + corners.tl }, corners.tl);
  }
  if (corners.tr > 0 && point.x > right - corners.tr && point.y < bbox.y + corners.tr) {
    return cornerContains(point, { x: right - corners.tr, y: bbox.y + corners.tr }, corners.tr);
  }
  if (corners.br > 0 && point.x > right - corners.br && point.y > bottom - corners.br) {
    return cornerContains(point, { x: right - corners.br, y: bottom - corners.br }, corners.br);
  }
  if (corners.bl > 0 && point.x < bbox.x + corners.bl && point.y > bottom - corners.bl) {
    return cornerContains(point, { x: bbox.x + corners.bl, y: bottom - corners.bl }, corners.bl);
  }
  return true;
}

/** Check a shared clip chain without allocating or reparsing Path data per pointer. */
export function acceptsHitClips(clip: HitClip | null, point: Point2D): boolean {
  for (let current = clip; current; current = current.parent) {
    const local = applyInverseAffineMatrixToPoint(current.matrix, point);
    if (!local || !pointInRoundedClip(local, current.bbox, current.radii)) {
      return false;
    }
  }
  return true;
}
