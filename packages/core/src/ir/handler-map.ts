import type { HandlersRef, IR, IRNode } from "./types.js";

/**
 * Build a flat map from nodeId → HandlersRef by walking the IR tree.
 * Only includes nodes that have at least one handler defined.
 */
export function buildHandlerMap(ir: IR): Map<string, HandlersRef> {
  const map = new Map<string, HandlersRef>();
  walk(ir.root, map);
  return map;
}

function walk(node: IRNode, map: Map<string, HandlersRef>): void {
  if (node.type !== "rect" && node.on) {
    map.set(node.nodeId, node.on);
  }
  if (node.type === "group" && node.children) {
    for (const child of node.children) {
      walk(child, map);
    }
  }
}
