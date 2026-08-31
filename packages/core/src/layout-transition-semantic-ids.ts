import { FatalError } from "./errors.js";
import { generateNodeId } from "./ir/node-id.js";
import { hasWasmLayoutChildren } from "./layout/taffy-layout-adapter.js";
import { fromSceneDocument } from "./scene/from-vnode.js";
import type { SceneNode } from "./scene/types.js";
import { isSceneNode } from "./scene/types.js";
import type { VNode } from "./vnode/types.js";

type SemanticIdMismatch = {
  nodeId: string;
  expected: "authored explicit ID" | "unique authored ID";
  observed: "generated ID" | "duplicate authored ID";
};

function layoutTransitionSemanticIdError(details: SemanticIdMismatch): FatalError {
  const { nodeId, expected, observed } = details;
  return new FatalError(
    "LAYOUT_TRANSITION_INCOMPATIBLE",
    `Layout transition id mismatch for node ${JSON.stringify(nodeId)}: expected ${expected}, observed ${observed}`,
    {
      stage: "layout",
      nodeId,
      context: {
        category: "id",
        expected,
        observed,
      },
    },
  );
}

/** Fast precheck; Rust repeats these checks authoritatively during compile. */
export function assertLayoutTransitionSemanticIds(input: VNode | SceneNode): void {
  const rootVNode = isSceneNode(input) ? fromSceneDocument(input) : input;
  const authoredIds = new Set<string>();

  const visit = (
    vnode: VNode,
    position: { depth: number; siblingIndex: number; parentNodeId?: string },
  ): void => {
    const generatedNodeId = generateNodeId(vnode, position);
    if (!generatedNodeId.authored) {
      throw layoutTransitionSemanticIdError({
        nodeId: generatedNodeId.id,
        expected: "authored explicit ID",
        observed: "generated ID",
      });
    }
    if (authoredIds.has(generatedNodeId.id)) {
      throw layoutTransitionSemanticIdError({
        nodeId: generatedNodeId.id,
        expected: "unique authored ID",
        observed: "duplicate authored ID",
      });
    }
    authoredIds.add(generatedNodeId.id);

    // Text-family children are flattened into the text payload, and fixed-size
    // leaves likewise never appear in WasmNodeInput.children. Match that wire
    // semantic boundary instead of treating rich-text VNodes as layout nodes.
    if (!hasWasmLayoutChildren(vnode.type)) {
      return;
    }
    const semanticChildren: VNode[] = [];
    for (const child of vnode.children) {
      if (typeof child !== "string") {
        semanticChildren.push(child);
      }
    }
    for (const [siblingIndex, child] of semanticChildren.entries()) {
      visit(child, {
        depth: position.depth + 1,
        siblingIndex,
        parentNodeId: generatedNodeId.id,
      });
    }
  };

  visit(rootVNode, { depth: 0, siblingIndex: 0 });
}
