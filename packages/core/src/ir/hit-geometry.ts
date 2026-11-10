import { FatalError } from "../errors.js";
import {
  type AffineMatrix,
  type AffineProjectionUnavailableReason,
  applyInverseAffineMatrixToPoint,
  classifyAffineLinear,
  type Point2D,
} from "../transform.js";
import type { BBox, BoxClip, IR, IRPathNode } from "./types.js";

/** Extrema may be infinite only during conservative internal interval arithmetic. */
export type HitBounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Main local-to-target matrix plus linear evidence, never a list of transforms to compose. */
export type HitPose = Readonly<{
  matrix: Readonly<AffineMatrix>;
  linearWitnesses: readonly Readonly<Pick<AffineMatrix, "a" | "b" | "c" | "d">>[];
}>;

/** Innermost strict-interior clip at the head, then parent ancestors; coordinates are pre-transform. */
export type HitClip = Readonly<{
  parent: HitClip | null;
  pose: HitPose;
  geometry: BoxClip;
}>;

/** Checked local containment; calculation failures are not ordinary misses. */
export type HitContainmentResult =
  | Readonly<{ status: "ready"; contains: boolean }>
  | Readonly<{
      status: "unavailable";
      reason: AffineProjectionUnavailableReason | "nonFiniteGeometry";
    }>;

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
 * Require canonical Path output, including null for empty geometry.
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
    throw new FatalError("VALIDATION", "Path hit testing requires canonical pathGeometry", {
      stage: "ir",
      nodeId: node.nodeId,
    });
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

/** Require canonical clip extents and corners before containment. */
function assertResolvedBoxClip(clip: Extract<BoxClip, { kind: "boxContour" }>): void {
  const { bbox, corners } = clip;
  if (
    ![bbox.x, bbox.y, bbox.w, bbox.h, bbox.x + bbox.w, bbox.y + bbox.h].every(Number.isFinite) ||
    bbox.w < 0 ||
    bbox.h < 0 ||
    corners.some(
      (corner) =>
        !Number.isFinite(corner.rx) ||
        !Number.isFinite(corner.ry) ||
        corner.rx < 0 ||
        corner.ry < 0 ||
        corner.rx > bbox.w / 2 ||
        corner.ry > bbox.h / 2,
    )
  ) {
    throw new FatalError("VALIDATION", "Hit testing requires a resolved box clip.", {
      stage: "ir",
    });
  }
}

/** Test the strict interior of the resolved contour; floating comparisons use no tolerance. */
function pointInBoxClip(point: Point2D, clip: BoxClip): boolean {
  if (clip.kind === "empty") {
    return false;
  }
  if (
    point.x <= clip.bbox.x ||
    point.y <= clip.bbox.y ||
    point.x >= clip.bbox.x + clip.bbox.w ||
    point.y >= clip.bbox.y + clip.bbox.h
  ) {
    return false;
  }
  const { bbox, corners } = clip;
  const right = bbox.x + bbox.w;
  const bottom = bbox.y + bbox.h;
  const centers = [
    { x: bbox.x + corners[0].rx, y: bbox.y + corners[0].ry },
    { x: right - corners[1].rx, y: bbox.y + corners[1].ry },
    { x: right - corners[2].rx, y: bottom - corners[2].ry },
    { x: bbox.x + corners[3].rx, y: bottom - corners[3].ry },
  ];
  for (const [index, radius] of corners.entries()) {
    if (radius.rx <= 0 || radius.ry <= 0) {
      continue;
    }
    const center = centers[index];
    if (!center) {
      continue;
    }
    const isLeft = index === 0 || index === 3;
    const isTop = index < 2;
    if (
      (isLeft ? point.x < center.x : point.x > center.x) &&
      (isTop ? point.y < center.y : point.y > center.y)
    ) {
      return Math.hypot((point.x - center.x) / radius.rx, (point.y - center.y) / radius.ry) < 1;
    }
  }
  return true;
}

/**
 * Test the strict interior of the IR viewport in IR root px; zero dimensions are empty.
 * The caller guarantees a finite point. Its coordinates are not rechecked here.
 * Dimensions are required, finite and nonnegative, and are checked on each call.
 * @throws {FatalError} VALIDATION for noncanonical viewport dimensions.
 */
export function isPointInViewport(
  dimensions: Readonly<Pick<IR, "width" | "height">>,
  point: Readonly<Point2D>,
): boolean {
  const contour = {
    kind: "boxContour",
    bbox: { x: 0, y: 0, w: dimensions.width, h: dimensions.height },
    corners: [
      { rx: 0, ry: 0 },
      { rx: 0, ry: 0 },
      { rx: 0, ry: 0 },
      { rx: 0, ry: 0 },
    ],
  } satisfies Extract<BoxClip, { kind: "boxContour" }>;
  assertResolvedBoxClip(contour);
  return pointInBoxClip(point, contour);
}

type HitConstraint = Readonly<{
  pose: HitPose;
  geometry: BoxClip | Readonly<{ kind: "frame"; bbox: Readonly<BBox> }>;
}>;

/** Validate the entire constraint set before an empty proof can suppress a derived failure. */
function evaluateConstraints(
  constraints: readonly HitConstraint[],
  point: Readonly<Point2D>,
): HitContainmentResult {
  let invalid: HitContainmentResult | null = null;
  const projections = new Map<
    HitPose["matrix"],
    ReturnType<typeof applyInverseAffineMatrixToPoint>
  >();
  const classifications = new Map<
    HitPose["linearWitnesses"][number],
    ReturnType<typeof classifyAffineLinear>
  >();
  const checked = constraints.map(({ geometry, pose }) => {
    if (geometry.kind === "boxContour") {
      assertResolvedBoxClip(geometry);
    }
    if (geometry.kind === "frame") {
      const bbox = geometry.bbox;
      if (
        ![bbox.x, bbox.y, bbox.w, bbox.h, bbox.x + bbox.w, bbox.y + bbox.h].every(Number.isFinite)
      ) {
        invalid ??= { status: "unavailable", reason: "nonFiniteGeometry" };
      }
    }
    let projection = projections.get(pose.matrix);
    if (!projection) {
      projection = applyInverseAffineMatrixToPoint(pose.matrix, point);
      projections.set(pose.matrix, projection);
    }
    if (projection.status === "unavailable" && projection.reason === "nonFiniteMatrix") {
      invalid ??= projection;
    }
    const witnesses = pose.linearWitnesses.map((witness) => {
      let classification = classifications.get(witness);
      if (!classification) {
        classification = classifyAffineLinear(witness);
        classifications.set(witness, classification);
      }
      if (classification.status === "unavailable" && classification.reason === "nonFiniteMatrix") {
        invalid ??= classification;
      }
      return classification;
    });
    return { geometry, projection, witnesses };
  });
  if (invalid) {
    return invalid;
  }
  let isEmpty = false;
  let failure: HitContainmentResult | null = null;
  for (const { geometry, projection, witnesses } of checked) {
    if (geometry.kind === "empty" || geometry.bbox.w === 0 || geometry.bbox.h === 0) {
      isEmpty = true;
      continue;
    }
    if (projection.status === "degenerate") {
      isEmpty = true;
    } else if (projection.status === "unavailable") {
      failure ??= projection;
    } else if (
      !(geometry.kind === "frame"
        ? pointInHitBBox(projection.point, geometry.bbox)
        : pointInBoxClip(projection.point, geometry))
    ) {
      isEmpty = true;
    }
    for (const linear of witnesses) {
      if (linear.status === "degenerate") {
        isEmpty = true;
      } else if (linear.status === "unavailable") {
        failure ??= linear;
      }
    }
  }
  return isEmpty
    ? { status: "ready", contains: false }
    : (failure ?? { status: "ready", contains: true });
}

/** Stable diagnostic order is inner-to-outer; established emptiness outranks derived failure. */
export function evaluateHitClips(
  clip: HitClip | null,
  point: Readonly<Point2D>,
): HitContainmentResult {
  const constraints: HitConstraint[] = [];
  for (let current = clip; current; current = current.parent) {
    constraints.push(current);
  }
  return evaluateConstraints(constraints, point);
}

/**
 * Evaluate a closed semantic Frame using its supplied pose and strict-interior canonical clips.
 * Validate geometry, poses and clips first, then prefer proven emptiness over derived failures.
 * The caller guarantees a finite point in the same query coordinates as every pose:
 * client CSS px for Browser calls, IR root px for snapshots. The point is not rechecked.
 * Diagnostics retain Frame, innermost clip, ancestor order. Native SVG paint and
 * external CSS geometry are outside this pure boundary.
 * @throws {FatalError} VALIDATION for a noncanonical BoxClip in the supplied IR chain.
 */
// biome-ignore lint/complexity/useMaxParams: The pure boundary keeps geometry, pose, clip chain and query-space point explicit.
export function queryFrameContainment(
  bbox: Readonly<BBox>,
  pose: HitPose,
  clips: HitClip | null,
  clientPoint: Readonly<Point2D>,
): HitContainmentResult {
  const constraints: HitConstraint[] = [{ pose, geometry: { kind: "frame", bbox } }];
  for (let current = clips; current; current = current.parent) {
    constraints.push(current);
  }
  return evaluateConstraints(constraints, clientPoint);
}
