import { generateNodeId } from "./ir/node-id.js";
import type { VNode } from "./vnode/types.js";

export const DEFAULT_LAYER_ID = "default";

export type SourceNodeInfo = {
  nodeId: string;
  nodeType: VNode["type"];
  requestedLayerId: string;
};

export type LayerSourceMetadata = ReadonlyMap<string, SourceNodeInfo>;

type MetadataFrame = {
  children: IterableIterator<VNode | string>;
  nodeId: string;
  requestedLayerId: string;
  siblingIndex: number;
};

/**
 * Snapshot authoring IDs, kinds, and inherited layers before warning callbacks.
 * Visit every non-string child, including inline nodes absent from layout output.
 * One frame per ancestor bounds traversal storage by depth; returned values retain
 * no VNodes, layout geometry, or glyphs.
 */
export function snapshotLayerSourceMetadata(root: VNode): LayerSourceMetadata {
  const sourceNodeMap = new Map<string, SourceNodeInfo>();
  const rootNodeId = generateNodeId(root, { depth: 0, siblingIndex: 0 }).id;
  const rootLayerId = normalizeLayerId(readLayerProp(root)) ?? DEFAULT_LAYER_ID;
  const frames: MetadataFrame[] = [
    {
      children: root.children.values(),
      nodeId: rootNodeId,
      requestedLayerId: rootLayerId,
      siblingIndex: 0,
    },
  ];
  sourceNodeMap.set(rootNodeId, {
    nodeId: rootNodeId,
    nodeType: root.type,
    requestedLayerId: rootLayerId,
  });

  while (true) {
    const frame = frames[frames.length - 1];
    if (frame === undefined) {
      break;
    }
    const nextChild = frame.children.next();
    if (nextChild.done) {
      frames.pop();
      continue;
    }
    const child = nextChild.value;
    if (typeof child === "string") {
      continue;
    }
    const nodeId = generateNodeId(child, {
      depth: frames.length,
      siblingIndex: frame.siblingIndex,
      parentNodeId: frame.nodeId,
    }).id;
    frame.siblingIndex += 1;
    const requestedLayerId = normalizeLayerId(readLayerProp(child)) ?? frame.requestedLayerId;
    sourceNodeMap.set(nodeId, { nodeId, nodeType: child.type, requestedLayerId });
    frames.push({ children: child.children.values(), nodeId, requestedLayerId, siblingIndex: 0 });
  }
  return sourceNodeMap;
}

function readLayerProp(vnode: VNode): string | undefined {
  switch (vnode.type) {
    case "Flex":
    case "Grid":
    case "Box":
    case "Text":
    case "TextOnPath":
    case "Image":
    case "Path":
    case "Svg":
    case "Shape":
    case "Symbol":
      return vnode.props.layer;
    default:
      return undefined;
  }
}

function normalizeLayerId(layerId: string | undefined): string | undefined {
  const trimmed = layerId?.trim();
  if (!trimmed || trimmed === DEFAULT_LAYER_ID) {
    return trimmed ? DEFAULT_LAYER_ID : undefined;
  }
  return trimmed;
}
