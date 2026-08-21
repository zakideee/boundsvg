import { FatalError } from "../errors.js";
import type { VNode } from "../vnode/types.js";
import type { NodePosition } from "./internal.js";

/**
 * Generate a NodeId for a VNode.
 *
 * - If the node has an explicit `id` prop, use it directly.
 * - Otherwise, auto-generate a path-based id encoding the full tree position:
 *   `auto:{parentPath}.{siblingIndex}` (e.g. `auto:0`, `auto:0.1.0`)
 *   With key: `auto:{parentPath}.{siblingIndex}:{key}`
 */
type GeneratedNodeId = {
  id: string;
  authored: boolean;
};

function hasLoneUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Reject IDs that cannot round-trip through Rust's UTF-8 JSON strings. */
export function assertNodeIdIsWellFormedUnicode(nodeId: string): void {
  if (!hasLoneUtf16Surrogate(nodeId)) {
    return;
  }
  throw new FatalError(
    "VALIDATION",
    `Validation error: node id ${JSON.stringify(nodeId)} must contain only well-formed Unicode scalar values`,
    {
      stage: "validate",
      nodeId,
      reason: "lone UTF-16 surrogate",
    },
  );
}

export function generateNodeId(node: VNode, position: NodePosition): GeneratedNodeId {
  const { siblingIndex, parentNodeId } = position;
  const explicitId = "id" in node.props ? node.props.id : undefined;
  if (typeof explicitId === "string") {
    assertNodeIdIsWellFormedUnicode(explicitId);
    return { id: explicitId, authored: true };
  }

  // Build path-based segment: append siblingIndex to parent path
  const segment = parentNodeId != null ? `${parentNodeId}.${siblingIndex}` : `auto:${siblingIndex}`;

  const key = node.key;
  if (key != null) {
    const generatedId = `${segment}:${String(key)}`;
    assertNodeIdIsWellFormedUnicode(generatedId);
    return { id: generatedId, authored: false };
  }

  assertNodeIdIsWellFormedUnicode(segment);
  return { id: segment, authored: false };
}
