import type { IR, IRNode, IRNodeType } from "./types.js";

/**
 * Build a flat map from nodeId → IRNodeType for leaf nodes.
 * Only includes leaf node types (rect, text, image, path).
 * Group nodes are excluded since they don't participate in hit testing.
 */
export function buildNodeTypeMap(ir: IR): Map<string, IRNodeType> {
  const map = new Map<string, IRNodeType>();
  walk(ir.root, map);
  return map;
}

function walk(node: IRNode, map: Map<string, IRNodeType>): void {
  if (node.type !== "group") {
    map.set(node.nodeId, node.type);
  }
  if (node.type === "group" && node.children) {
    for (const child of node.children) {
      walk(child, map);
    }
  }
}
