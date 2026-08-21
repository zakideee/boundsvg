import { transformToSvg } from "../transform.js";
import {
  type ShapeCompileOptions,
  type ShapeSymbolResolutionOptions,
  wasmCompileShapeSvg,
  wasmComputeShapeIntersections,
  wasmDivideShapeRegions,
  wasmEvaluateShapeParts,
  wasmHitTestShapeParts,
  wasmResolveSymbolGeometry,
} from "../wasm/index.js";
import type {
  DivideRegions,
  GeometryDoc,
  GeometryHitTestOptions,
  GeometryIntersection,
  GeometryPart,
  GeometryPartHit,
  SymbolDefinition,
} from "./types.js";

export function compileGeometryToSvgDocument(
  geometry: GeometryDoc,
  options?: ShapeCompileOptions,
): string {
  return wasmCompileShapeSvg(geometry, options);
}

export function resolveSymbolGeometry(
  definition: SymbolDefinition,
  options: ShapeSymbolResolutionOptions,
): GeometryDoc {
  return wasmResolveSymbolGeometry(definition, options);
}

/**
 * Evaluates a geometry document into its addressable parts (group/transform
 * children stay addressable; a boolean node fuses into one part).
 */
export function evaluateGeometryParts(geometry: GeometryDoc): GeometryPart[] {
  return wasmEvaluateShapeParts(geometry);
}

/**
 * Precise per-part hit test in geometry (viewBox) coordinates. Hits come
 * back in document (paint) order - the topmost part is last. A point inside
 * the stroke band reports `hit: "stroke"` (stroke paints over fill).
 */
export function hitTestGeometryParts(
  geometry: GeometryDoc,
  point: { x: number; y: number },
  options?: GeometryHitTestOptions,
): GeometryPartHit[] {
  return wasmHitTestShapeParts(geometry, point, options);
}

/**
 * Hit test against a Shape as placed on the canvas: converts a canvas-space
 * point into geometry coordinates using the shape's box (same anisotropic
 * viewBox-to-box mapping the renderer bakes), then queries the kernel.
 *
 * `strokeWidthPx` is converted with the average of the two scale factors -
 * exact for uniform scaling, an approximation under anisotropic scaling.
 */
export type ShapeHitTestPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeWidthPx?: number;
  tolerancePx?: number;
  /** Default fill rule for geometry paths that do not declare one. */
  fillRule?: "nonzero" | "evenodd";
};

export function hitTestShapeAt(
  geometry: GeometryDoc,
  canvasPoint: { x: number; y: number },
  placement: ShapeHitTestPlacement,
): GeometryPartHit[] {
  // The renderer bakes stroked geometry into the box minus a strokeWidth/2
  // inset per side (so strokes never clip); the hit mapping mirrors that
  // exact transform so hits align with painted pixels.
  const inset = (placement.strokeWidthPx ?? 0) / 2;
  const scaleX = (placement.width - inset * 2) / geometry.viewBox.width;
  const scaleY = (placement.height - inset * 2) / geometry.viewBox.height;
  const point = {
    x: (canvasPoint.x - placement.x - inset) / scaleX + (geometry.viewBox.x ?? 0),
    y: (canvasPoint.y - placement.y - inset) / scaleY + (geometry.viewBox.y ?? 0),
  };
  const averageScale = (scaleX + scaleY) / 2;
  const geometryOptions: GeometryHitTestOptions = {};
  if (placement.strokeWidthPx !== undefined) {
    geometryOptions.strokeWidth = placement.strokeWidthPx / averageScale;
  }
  if (placement.tolerancePx !== undefined) {
    geometryOptions.tolerance = placement.tolerancePx / averageScale;
  }
  if (placement.fillRule !== undefined) {
    geometryOptions.fillRule = placement.fillRule;
  }
  return wasmHitTestShapeParts(geometry, point, geometryOptions);
}

export function divideGeometryRegions(lhs: GeometryDoc, rhs: GeometryDoc): DivideRegions {
  return wasmDivideShapeRegions(lhs, rhs);
}

export function computeGeometryIntersections(
  lhs: GeometryDoc,
  rhs: GeometryDoc,
): GeometryIntersection[] {
  return wasmComputeShapeIntersections(lhs, rhs);
}

export { transformToSvg };
