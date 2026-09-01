import { FatalError } from "../errors.js";
import {
  type AffineMatrix,
  assertValidTransform2D,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
} from "../transform.js";
import type { FlowExclusionMarginPx, FlowExclusionShape } from "../wasm/index.js";
import { wasmEvaluateShapeRegion } from "../wasm/index.js";
import { resolveSymbolGeometry } from "./compiler.js";
import { regionToPathData } from "./serialize-region.js";
import type {
  Contour,
  CurveSegment,
  GeometryDoc,
  Region,
  SymbolDefinition,
  Transform2D,
} from "./types.js";

/**
 * Placement of the shape in the flow box's coordinate system.
 *
 * The caller supplies the shape's position and display size (typically the
 * node's computed layout box). The geometry is scaled anisotropically from
 * its viewBox to `width`/`height` (matching `Shape`'s default
 * `preserveAspectRatio: "none"`) and translated to (`x`, `y`).
 */
export type GeometryExclusionOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  marginPx?: FlowExclusionMarginPx;
  /** Post-layout paint transform, using the same local-origin semantics as Shape. */
  transform?: Transform2D;
  /** Node id attached to placement-validation errors, for diagnostics. */
  nodeId?: string;
};

/**
 * Derive a text-flow exclusion from shape geometry, so the same
 * `GeometryDoc` can drive both rendering (`Shape`) and text exclusion
 * without hand-duplicating path data.
 *
 * The geometry is boolean-evaluated first, so the exclusion uses the actual
 * resolved outline, not a bounding box (horizontal flow; vertical/column
 * flow currently approximates path exclusions by their bounding box).
 *
 * Caveats:
 * - Stroke width is not considered; use `marginPx` to keep text clear of
 *   stroked edges.
 * - Interior holes (e.g. a subtract donut) remain excluded regions for text:
 *   text does not flow inside holes.
 */
export function geometryToFlowExclusion(
  geometry: GeometryDoc,
  options: GeometryExclusionOptions,
): FlowExclusionShape {
  assertPlacement(options);
  // Holes stay excluded regardless of the kernel's hole-winding convention:
  // with every contour oriented the same way, `nonzero` fills them.
  const region = unifyContourWindings(wasmEvaluateShapeRegion(geometry));
  const scaleX = options.width / geometry.viewBox.width;
  const scaleY = options.height / geometry.viewBox.height;
  const translateX = options.x - (geometry.viewBox.x ?? 0) * scaleX;
  const translateY = options.y - (geometry.viewBox.y ?? 0) * scaleY;
  const placementMatrix: AffineMatrix = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: translateX,
    f: translateY,
  };
  const d = regionToPathData(region, resolveExclusionMatrix(options, placementMatrix));
  // x/y are pre-baked into `d`; the DTO still requires explicit offsets.
  return {
    kind: "path",
    d,
    x: 0,
    y: 0,
    fillRule: "nonzero",
    ...(options.marginPx === undefined ? {} : { marginPx: options.marginPx }),
  };
}

function resolveExclusionMatrix(
  options: GeometryExclusionOptions,
  placementMatrix: AffineMatrix,
): AffineMatrix {
  if (!options.transform) {
    return placementMatrix;
  }
  assertValidTransform2D(options.transform, {
    code: "INVALID_FLOW_EXCLUSION_TRANSFORM",
    stage: "validate",
    nodeId: options.nodeId ?? "flow-exclusion",
    ownerName: "Flow exclusion",
  });
  const paintMatrix = createResolvedTransformMatrix(options.transform, {
    x: options.x,
    y: options.y,
  });
  return multiplyAffineMatrices(paintMatrix, placementMatrix);
}

/**
 * Derive a text-flow exclusion from a symbol definition. Elastic segments are
 * resolved for the target `width`/`height` first (same as `Symbol` rendering),
 * then converted like {@link geometryToFlowExclusion}.
 */
export function symbolToFlowExclusion(
  symbol: SymbolDefinition,
  options: GeometryExclusionOptions,
): FlowExclusionShape {
  assertPlacement(options);
  const geometry = resolveSymbolGeometry(symbol, {
    width: options.width,
    height: options.height,
  });
  return geometryToFlowExclusion(geometry, options);
}

function unifyContourWindings(region: Region): Region {
  return {
    contours: region.contours.map((contour) =>
      contourSignedArea(contour) < 0 ? reverseContour(contour) : contour,
    ),
  };
}

// Shoelace over segment endpoints — exact for lines, and orientation-correct
// for curved contours (control points cannot flip the sign of the total).
function contourSignedArea(contour: Contour): number {
  let doubledArea = 0;
  for (const segment of contour.segments) {
    const endPoint =
      segment.kind === "line" ? segment.p1 : segment.kind === "quad" ? segment.p2 : segment.p3;
    doubledArea += segment.p0.x * endPoint.y - endPoint.x * segment.p0.y;
  }
  return doubledArea / 2;
}

function reverseContour(contour: Contour): Contour {
  return { segments: [...contour.segments].reverse().map(reverseSegment) };
}

function reverseSegment(segment: CurveSegment): CurveSegment {
  switch (segment.kind) {
    case "line":
      return { kind: "line", p0: segment.p1, p1: segment.p0 };
    case "quad":
      return { kind: "quad", p0: segment.p2, p1: segment.p1, p2: segment.p0 };
    case "cubic":
      return { kind: "cubic", p0: segment.p3, p1: segment.p2, p2: segment.p1, p3: segment.p0 };
  }
}

function assertPlacement(options: GeometryExclusionOptions): void {
  const { x, y, width, height, nodeId } = options;
  if (!(Number.isFinite(x) && Number.isFinite(y))) {
    throw new FatalError("VALIDATION", `Exclusion placement x/y must be finite, got ${x}/${y}.`, {
      stage: "validate",
      ...(nodeId !== undefined && { nodeId }),
    });
  }
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new FatalError(
      "VALIDATION",
      `Exclusion width/height must be positive and finite, got ${width}/${height}.`,
      { stage: "validate", ...(nodeId !== undefined && { nodeId }) },
    );
  }
}
