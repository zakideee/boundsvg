import {
  type AffineMatrix,
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
} from "../transform.js";
import { buildSpatialIndex, type SpatialIndex } from "./spatial-index.js";
import type { IR, IRNode } from "./types.js";

/**
 * Hit test: find the topmost semantic draw-order node at coordinates (x, y).
 *
 * Uses spatial index (Quadtree) for O(log N) performance when the IR
 * has enough nodes. Falls back to O(N) drawOrder scan for small trees.
 *
 * Coordinates are canvas (world) space: node and ancestor `transform`s are
 * applied to each bbox, and regions outside an ancestor `clipPath` never
 * hit. Rotated nodes and clips are approximated by their world-space
 * axis-aligned bounds; rounded clip corners are likewise treated as their
 * enclosing rectangle. This matches the bbox-level precision of this API.
 *
 * Skips internal background and border nodes. Semantic draw-order nodes,
 * including interactive groups, remain hittable.
 * Returns the nodeId of the first hit, or null if no hit.
 */
export function hitTest(ir: IR, x: number, y: number): string | null {
  const nodeLookup = new Map<string, WorldBBox>();
  collectWorldBboxes(ir.root, nodeLookup, { matrix: createIdentityAffineMatrix(), clip: null });

  // Use spatial index for larger trees (threshold: 16 draw order entries)
  if (ir.drawOrder.length >= 16) {
    const index = buildSpatialIndex(
      { width: ir.width, height: ir.height },
      ir.drawOrder,
      nodeLookup,
    );
    return index.queryTopmost(x, y);
  }

  // O(N) fallback for small trees
  return hitTestLinear(ir, { x, y }, nodeLookup);
}

/**
 * Hit test with a pre-built spatial index.
 * Use this when performing multiple hit tests on the same IR to avoid
 * rebuilding the index each time.
 */
export function hitTestWithIndex(index: SpatialIndex, x: number, y: number): string | null {
  return index.queryTopmost(x, y);
}

/**
 * Hit test returning all candidate nodes at (x, y), sorted front-to-back.
 * Use with path geometry verification to fall through bbox hits that miss
 * the actual path shape.
 */
export function hitTestCandidates(index: SpatialIndex, x: number, y: number): string[] {
  return index.queryCandidates(x, y);
}

/**
 * Build a spatial index from an IR for repeated hit testing.
 */
export function buildHitTestIndex(ir: IR): SpatialIndex {
  const nodeLookup = new Map<string, WorldBBox>();
  collectWorldBboxes(ir.root, nodeLookup, { matrix: createIdentityAffineMatrix(), clip: null });
  return buildSpatialIndex({ width: ir.width, height: ir.height }, ir.drawOrder, nodeLookup);
}

type WorldBBox = { x: number; y: number; w: number; h: number };

/** O(N) linear hit test — walk drawOrder in reverse */
function hitTestLinear(
  ir: IR,
  point: { x: number; y: number },
  nodeLookup: Map<string, WorldBBox>,
): string | null {
  const { x, y } = point;
  for (let i = ir.drawOrder.length - 1; i >= 0; i--) {
    const nodeId = ir.drawOrder[i];
    if (!nodeId) {
      continue;
    }
    const bbox = nodeLookup.get(nodeId);
    if (!bbox) {
      continue;
    }

    // Skip internal sub-nodes (bg, border) — only return semantic nodes
    if (nodeId.endsWith(":bg") || nodeId.endsWith(":border")) {
      continue;
    }

    // Point-in-bbox check
    if (x >= bbox.x && x <= bbox.x + bbox.w && y >= bbox.y && y <= bbox.y + bbox.h) {
      return nodeId;
    }
  }

  return null;
}

/** Axis-aligned world bounds of a local bbox under an affine transform. */
function transformBBoxToWorldAabb(matrix: AffineMatrix, bbox: WorldBBox): WorldBBox {
  const corners = [
    applyAffineMatrixToPoint(matrix, { x: bbox.x, y: bbox.y }),
    applyAffineMatrixToPoint(matrix, { x: bbox.x + bbox.w, y: bbox.y }),
    applyAffineMatrixToPoint(matrix, { x: bbox.x, y: bbox.y + bbox.h }),
    applyAffineMatrixToPoint(matrix, { x: bbox.x + bbox.w, y: bbox.y + bbox.h }),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

function unionWorldBBoxes(left: WorldBBox | null, right: WorldBBox): WorldBBox {
  if (!left) {
    return right;
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.w, right.x + right.w);
  const bottomEdge = Math.max(left.y + left.h, right.y + right.h);
  return { x, y, w: rightEdge - x, h: bottomEdge - y };
}

/** Local hit bounds, including sampled post-layout transforms of Text paint units. */
function resolveLocalHitBBox(node: IRNode): WorldBBox | null {
  if (node.type !== "text" || !node.unitAnimation || !node.unitAnimationSamples) {
    return node.bbox;
  }

  let sampledBBox: WorldBBox | null = null;
  for (const sample of node.unitAnimationSamples) {
    if (!sample.bbox) {
      continue;
    }
    const unitMatrix = createResolvedTransformMatrix(sample.transform, sample.bbox);
    sampledBBox = unionWorldBBoxes(sampledBBox, transformBBoxToWorldAabb(unitMatrix, sample.bbox));
  }
  return sampledBBox;
}

/** Intersection of two bboxes, or null when they do not overlap. */
function intersectBBox(a: WorldBBox, b: WorldBBox): WorldBBox | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) {
    return null;
  }
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Collect world-space hit bounds for every node.
 *
 * - `transform` (node + ancestors) maps each bbox into canvas coordinates —
 *   a translated node used to hit at its pre-transform position and miss at
 *   its rendered one.
 * - `clipPath` restricts every descendant: content outside an ancestor clip
 *   is invisible and must not steal clicks, so its entry is dropped (or
 *   shrunk to the visible intersection).
 */
type WorldContext = {
  matrix: AffineMatrix;
  clip: WorldBBox | null;
};

function collectWorldBboxes(
  node: IRNode,
  map: Map<string, WorldBBox>,
  context: WorldContext,
): void {
  const matrix = multiplyAffineMatrices(
    context.matrix,
    createResolvedTransformMatrix(node.type === "group" ? node.transform : undefined, node.bbox),
  );
  const localHitBBox = resolveLocalHitBBox(node);
  const worldBBox = localHitBBox ? transformBBoxToWorldAabb(matrix, localHitBBox) : null;

  // The node's own clip applies to its content and children, so it also
  // bounds the node's hit area.
  let effectiveClip = context.clip;
  if (node.type === "group" && node.clipPath) {
    const clipWorld = transformBBoxToWorldAabb(matrix, node.clipPath);
    effectiveClip = effectiveClip ? intersectBBox(effectiveClip, clipWorld) : clipWorld;
    if (effectiveClip === null) {
      // Fully clipped away: nothing in this subtree can be hit.
      return;
    }
  }

  const visible = worldBBox
    ? effectiveClip
      ? intersectBBox(worldBBox, effectiveClip)
      : worldBBox
    : null;
  if (visible && visible.w > 0 && visible.h > 0) {
    map.set(node.nodeId, visible);
  } else {
    // Semantic leaves are represented as a layout group plus a paint child
    // with the same nodeId. A zero-ink paint child (for example an entirely
    // hidden TextOnPath) must override, not inherit, its frame-sized group hit
    // area.
    map.delete(node.nodeId);
  }

  for (const child of node.type === "group" ? (node.children ?? []) : []) {
    collectWorldBboxes(child, map, { matrix, clip: effectiveClip });
  }
}
