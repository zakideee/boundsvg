import { FatalError } from "../errors.js";
import type { VNode } from "../vnode/types.js";

/** Canvas is depth 0; descendants through depth 48 are accepted. */
export const MAX_LAYOUT_TREE_DEPTH = 48;

const EMBEDDED_TEXT_NODE_TYPES: ReadonlySet<VNode["type"]> = new Set([
  "Inline",
  "InlineBox",
  "InlineRect",
  "Ruby",
  "Rt",
]);

/** Keep recursive core and WASM layout consumers behind one explicit resource boundary. */
export function assertLayoutTreeDepth(vnode: VNode, depth: number): void {
  if (EMBEDDED_TEXT_NODE_TYPES.has(vnode.type) || depth <= MAX_LAYOUT_TREE_DEPTH) {
    return;
  }

  const explicitId = "id" in vnode.props ? vnode.props.id : undefined;
  const nodeId = typeof explicitId === "string" ? explicitId : `<${vnode.type}>`;
  throw new FatalError(
    "LAYOUT_TREE_MAX_DEPTH",
    `Validation error: layout tree exceeds max depth (${MAX_LAYOUT_TREE_DEPTH})`,
    {
      stage: "validate",
      nodeId,
      maxDepth: MAX_LAYOUT_TREE_DEPTH,
      actualDepth: depth,
    },
  );
}
