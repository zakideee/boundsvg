import { FatalError } from "./errors.js";
import { generateNodeId } from "./ir/node-id.js";
import { resolveSceneOrVNodeInput } from "./scene/from-vnode.js";
import type { SceneNode } from "./scene/types.js";
import type { VNode, VNodeType } from "./vnode/types.js";

/** Source of an explicit, automatic, or owner-generated identifier. */
export type CollectedNodeIdSource = "explicit" | "auto";

/** One authored, automatic, or generated ID with its source-tree position and optional owner. */
export type CollectedNodeId = {
  id: string;
  source: CollectedNodeIdSource;
  nodeType: VNodeType;
  path: readonly number[];
};

/** All source entries that claim the same render identifier. */
export type NodeIdDuplicate = {
  id: string;
  entries: CollectedNodeId[];
};

/** Collected identifiers partitioned by source, with every collision retained for diagnostics. */
export type NodeIdValidationResult = {
  valid: boolean;
  ids: CollectedNodeId[];
  duplicates: NodeIdDuplicate[];
  explicitIds: string[];
  autoIds: string[];
};

type NodeIdInput = VNode | SceneNode;

/** Collect source IDs and source IDs without rendering the input. */
export function collectNodeIds(input: NodeIdInput): CollectedNodeId[] {
  const vnode = resolveSceneOrVNodeInput(input);
  const ids: CollectedNodeId[] = [];
  collectVNodeNodeIds(vnode, ids, {
    depth: 0,
    siblingIndex: 0,
    parentNodeId: undefined,
    path: [],
  });
  return ids;
}

/** Find collisions across authored and automatic source identifiers. */
export function validateNodeIds(input: NodeIdInput): NodeIdValidationResult {
  const ids = collectNodeIds(input);
  const byId = new Map<string, CollectedNodeId[]>();
  const explicitIds: string[] = [];
  const autoIds: string[] = [];

  for (const entry of ids) {
    const entries = byId.get(entry.id);
    if (entries) {
      entries.push(entry);
    } else {
      byId.set(entry.id, [entry]);
    }

    switch (entry.source) {
      case "explicit":
        explicitIds.push(entry.id);
        break;
      case "auto":
        autoIds.push(entry.id);
        break;
    }
  }

  const duplicates: NodeIdDuplicate[] = [];
  for (const [id, entries] of byId) {
    if (entries.length > 1) {
      duplicates.push({ id, entries });
    }
  }

  return {
    valid: duplicates.length === 0,
    ids,
    duplicates,
    explicitIds,
    autoIds,
  };
}

/** Throw NODE_ID_COLLISION when source IDs overlap. */
export function assertUniqueNodeIds(input: NodeIdInput): void {
  const result = validateNodeIds(input);
  if (result.valid) {
    return;
  }

  const duplicate = result.duplicates[0];
  if (!duplicate) {
    return;
  }
  const sources = duplicate.entries.map((entry) => entry.source).join(", ");
  throw new FatalError(
    "NODE_ID_COLLISION",
    `Validation error: node id "${duplicate.id}" duplicates a source ID (${sources})`,
    {
      stage: "validate",
      nodeId: duplicate.id,
    },
  );
}

function collectVNodeNodeIds(
  vnode: VNode,
  ids: CollectedNodeId[],
  position: {
    depth: number;
    siblingIndex: number;
    parentNodeId: string | undefined;
    path: number[];
  },
): void {
  const { id: nodeId, authored } = generateNodeId(vnode, position);
  const source: CollectedNodeIdSource = authored ? "explicit" : "auto";
  ids.push({
    id: nodeId,
    source,
    nodeType: vnode.type,
    path: position.path,
  });

  for (const [index, child] of vnode.children.entries()) {
    if (typeof child === "string") {
      continue;
    }
    collectVNodeNodeIds(child, ids, {
      depth: position.depth + 1,
      siblingIndex: index,
      parentNodeId: nodeId,
      path: [...position.path, index],
    });
  }
}
