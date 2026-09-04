import { FatalError } from "./errors.js";
import { generateNodeId } from "./ir/node-id.js";
import { resolveSceneOrVNodeInput } from "./scene/from-vnode.js";
import type { SceneNode } from "./scene/types.js";
import type { VNode, VNodeType } from "./vnode/types.js";

export type CollectedNodeIdSource = "explicit" | "auto" | "background" | "border";

export type CollectedNodeId = {
  id: string;
  source: CollectedNodeIdSource;
  nodeType: VNodeType;
  path: readonly number[];
  baseNodeId?: string;
};

export type NodeIdDuplicate = {
  id: string;
  entries: CollectedNodeId[];
};

export type NodeIdValidationResult = {
  valid: boolean;
  ids: CollectedNodeId[];
  duplicates: NodeIdDuplicate[];
  explicitIds: string[];
  autoIds: string[];
  generatedIds: string[];
};

type NodeIdInput = VNode | SceneNode;

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

export function validateNodeIds(input: NodeIdInput): NodeIdValidationResult {
  const ids = collectNodeIds(input);
  const byId = new Map<string, CollectedNodeId[]>();
  const explicitIds: string[] = [];
  const autoIds: string[] = [];
  const generatedIds: string[] = [];

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
      case "background":
      case "border":
        generatedIds.push(entry.id);
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
    generatedIds,
  };
}

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
    `Validation error: node id "${duplicate.id}" collides across generated render IDs (${sources})`,
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

  if (hasBackgroundRenderNode(vnode)) {
    ids.push({
      id: `${nodeId}:bg`,
      source: "background",
      nodeType: vnode.type,
      path: position.path,
      baseNodeId: nodeId,
    });
  }

  if (hasBorderRenderNode(vnode)) {
    ids.push({
      id: `${nodeId}:border`,
      source: "border",
      nodeType: vnode.type,
      path: position.path,
      baseNodeId: nodeId,
    });
  }

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

function hasBackgroundRenderNode(vnode: VNode): boolean {
  switch (vnode.type) {
    case "Canvas":
    case "Flex":
    case "Grid":
    case "Box":
      return typeof vnode.props.background === "string" && vnode.props.background.length > 0;
    default:
      return false;
  }
}

function hasBorderRenderNode(vnode: VNode): boolean {
  switch (vnode.type) {
    case "Flex":
    case "Grid":
    case "Box":
      return Boolean(vnode.props.borderWidth && vnode.props.borderColor);
    default:
      return false;
  }
}
