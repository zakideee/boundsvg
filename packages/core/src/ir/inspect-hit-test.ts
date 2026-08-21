import { buildSpatialIndex, type SpatialIndex } from "./spatial-index.js";
import type { IR, IRNode } from "./types.js";

/**
 * Inspect hit test: include semantic leaf nodes plus container/root groups.
 *
 * The traversal order is pre-order so descendants and later siblings receive a
 * higher draw index than their ancestors, which makes inspect hover prefer:
 * leaf -> innermost container -> root.
 */
export function buildInspectHitTestIndex(ir: IR): SpatialIndex {
  const nodeLookup = new Map<string, { x: number; y: number; w: number; h: number }>();
  const inspectOrder: string[] = [];
  collectInspectEntries(ir.root, nodeLookup, inspectOrder);
  return buildSpatialIndex({ width: ir.width, height: ir.height }, inspectOrder, nodeLookup);
}

/**
 * Return inspect candidates at the given point, sorted front-to-back.
 */
export function inspectHitTestCandidates(index: SpatialIndex, x: number, y: number): string[] {
  return index.queryCandidates(x, y);
}

function collectInspectEntries(
  node: IRNode,
  bboxMap: Map<string, { x: number; y: number; w: number; h: number }>,
  inspectOrder: string[],
): void {
  if (!isInternalRenderNodeId(node.nodeId)) {
    bboxMap.set(node.nodeId, node.bbox);
    inspectOrder.push(node.nodeId);
  }

  if (node.type === "group" && node.children) {
    for (const child of node.children) {
      collectInspectEntries(child, bboxMap, inspectOrder);
    }
  }
}

function isInternalRenderNodeId(nodeId: string): boolean {
  return nodeId.endsWith(":bg") || nodeId.endsWith(":border");
}
