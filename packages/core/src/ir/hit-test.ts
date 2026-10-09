import {
  type AffineMatrix,
  applyInverseAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
} from "../transform.js";
import {
  acceptsHitClips,
  bboxHitBounds,
  type HitBounds,
  type HitClip,
  intersectHitBounds,
  pathWorldHitBounds,
  pointInHitBBox,
  worldHitBounds,
} from "./hit-geometry.js";
import { buildFilteredSpatialIndex, type SpatialIndex } from "./spatial-index.js";
import type { BBox, IR, IRNode } from "./types.js";

/** One candidate keeps its clip ownership separate from ordinary inserted boxes. */
type HitEntry = {
  nodeId: string;
  bbox: BBox;
  drawIndex: number;
  accepts: (x: number, y: number) => boolean;
};

/** Shared world transform and clip chain while walking the IR once. */
type HitContext = { matrix: AffineMatrix; clip: HitClip | null; visible: HitBounds | null };

/**
 * Find the topmost semantic candidate in canvas coordinates. Path candidates
 * use Rust paint bounds independently of their layout frames. Explicit clips,
 * including rounded corners, apply to their owner and descendants in clip
 * coordinates. Path fill/stroke holes still require native geometry refinement.
 * Trees with at least 16 draw-order entries use a spatial index.
 * @throws {FatalError} VALIDATION for Path output without schema-34 geometry.
 */
export function hitTest(ir: IR, x: number, y: number): string | null {
  const entries = collectHitEntries(ir);
  if (ir.drawOrder.length >= 16) {
    return buildFilteredSpatialIndex(
      { x: 0, y: 0, w: ir.width, h: ir.height },
      entries,
    ).queryTopmost(x, y);
  }
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex--) {
    const entry = entries[entryIndex];
    if (entry && pointInHitBBox({ x, y }, entry.bbox) && entry.accepts(x, y)) {
      return entry.nodeId;
    }
  }
  return null;
}

/** Query a prebuilt hit index using the same clip gates as a linear hit test. */
export function hitTestWithIndex(index: SpatialIndex, x: number, y: number): string | null {
  return index.queryTopmost(x, y);
}

/** Return candidates front-to-back for native Path fill/stroke refinement. */
export function hitTestCandidates(index: SpatialIndex, x: number, y: number): string[] {
  return index.queryCandidates(x, y);
}

/**
 * Build an IR hit index once; queries reuse geometry and shared clip chains.
 * Ordinary entries added through `insert` remain generic bbox entries.
 * @throws {FatalError} VALIDATION for absent or malformed Path output metadata.
 */
export function buildHitTestIndex(ir: IR): SpatialIndex {
  return buildFilteredSpatialIndex(
    { x: 0, y: 0, w: ir.width, h: ir.height },
    collectHitEntries(ir),
  );
}

/** Union text-unit samples without changing their layout/inspection frames. */
function localHitBounds(node: IRNode): HitBounds | null {
  if (node.type !== "text" || !node.unitAnimation || !node.unitAnimationSamples) {
    return bboxHitBounds(node.bbox);
  }
  let sampled: HitBounds | null = null;
  for (const sample of node.unitAnimationSamples) {
    if (!sample.bbox) {
      continue;
    }
    const bounds = worldHitBounds(
      createResolvedTransformMatrix(sample.transform, sample.bbox),
      bboxHitBounds(sample.bbox),
    );
    sampled = sampled
      ? {
          minX: Math.min(sampled.minX, bounds.minX),
          minY: Math.min(sampled.minY, bounds.minY),
          maxX: Math.max(sampled.maxX, bounds.maxX),
          maxY: Math.max(sampled.maxY, bounds.maxY),
        }
      : bounds;
  }
  return sampled;
}

/**
 * Collect geometry and entry-owned gates in semantic draw order. A paint child
 * with the layout group's id replaces that group's frame candidate, including
 * deletion for empty paint. The canvas is the outer clip for every query path.
 * @throws {FatalError} When a Path lacks canonical output geometry.
 */
function collectHitEntries(ir: IR): HitEntry[] {
  const canvas = { x: 0, y: 0, w: ir.width, h: ir.height };
  const lookup = new Map<string, Omit<HitEntry, "drawIndex">>();
  collectNode(ir.root, lookup, {
    matrix: createIdentityAffineMatrix(),
    clip: null,
    visible: bboxHitBounds(canvas),
  });
  return ir.drawOrder.flatMap((nodeId, drawIndex) => {
    const candidate = lookup.get(nodeId);
    return candidate && !nodeId.endsWith(":bg") && !nodeId.endsWith(":border")
      ? [{ ...candidate, drawIndex }]
      : [];
  });
}

/**
 * Walk the tree with one shared clip link per owner. Positive-area world AABBs
 * narrow the search; source-coordinate tests remove rotated and rounded cutouts.
 * @throws {FatalError} When a Path's derived output metadata is invalid.
 */
function collectNode(
  node: IRNode,
  lookup: Map<string, Omit<HitEntry, "drawIndex">>,
  context: HitContext,
): void {
  const matrix = multiplyAffineMatrices(
    context.matrix,
    createResolvedTransformMatrix(node.type === "group" ? node.transform : undefined, node.bbox),
  );
  let clip = context.clip;
  let visible: HitBounds | null = context.visible;
  if (node.type === "group" && node.clipPath) {
    clip = { parent: clip, matrix, bbox: node.clipPath, radii: node.clipBorderRadius };
    visible = visible
      ? intersectHitBounds(visible, worldHitBounds(matrix, bboxHitBounds(node.clipPath)))
      : null;
  }
  const local = node.type === "path" ? null : localHitBounds(node);
  const world =
    node.type === "path"
      ? pathWorldHitBounds(node, matrix)
      : local
        ? worldHitBounds(matrix, local)
        : null;
  const bounds = visible && world ? intersectHitBounds(visible, world) : null;
  if (bounds && bounds.minX < bounds.maxX && bounds.minY < bounds.maxY) {
    const ownFrame = node.type === "group" && node.on ? node.bbox : null;
    lookup.set(node.nodeId, {
      nodeId: node.nodeId,
      bbox: {
        x: bounds.minX,
        y: bounds.minY,
        w: bounds.maxX - bounds.minX,
        h: bounds.maxY - bounds.minY,
      },
      accepts(x, y) {
        const point = { x, y };
        const localPoint = applyInverseAffineMatrixToPoint(matrix, point);
        return (
          localPoint !== null &&
          (!ownFrame || pointInHitBBox(localPoint, ownFrame)) &&
          acceptsHitClips(clip, point)
        );
      },
    });
  } else {
    lookup.delete(node.nodeId);
  }
  // Even a fully clipped subtree is visited so malformed output metadata
  // cannot evade the schema-34 guard merely because this frame hides it.
  for (const child of node.type === "group" ? (node.children ?? []) : []) {
    collectNode(child, lookup, {
      matrix,
      clip,
      visible,
    });
  }
}
