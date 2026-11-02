import { FatalError } from "../errors.js";
import { HANDLER_KEYS } from "./internal.js";
import type { IR, IRNode } from "./types.js";

/** Reference to a semantic occurrence in one immutable IR snapshot; not a persistent ID. */
export type IRSourceRef = Readonly<{ sourceIndex: number; nodeId: string }>;

/** Physical occurrence and tree-derived ranks in the same snapshot. */
export type IRNodeOccurrence = Readonly<{
  nodeIndex: number;
  node: IRNode;
  source: IRSourceRef;
  parentNodeIndex: number | null;
  paintOrder: number | null;
  enterOrder: number;
  leaveOrder: number;
}>;

/** Source-owned facts; primary geometry remains a reference into the original tree. */
export type IRSourceInfo = Readonly<{
  source: IRSourceRef;
  node: IRNode;
  parentSourceIndex: number | null;
  primaryNodeIndex: number | null;
  depth: number;
}>;

/** Readonly occurrence projection whose references belong to exactly one IR snapshot. */
export type IRSourceIndex = Readonly<{
  ir: Omit<IR, "warnings">;
  nodes: ReadonlyMap<number, IRNodeOccurrence>;
  sources: ReadonlyMap<number, IRSourceInfo>;
}>;

type MutableOccurrence = Omit<IRNodeOccurrence, "leaveOrder"> & { leaveOrder: number };
type MutableSourceInfo = Omit<IRSourceInfo, "primaryNodeIndex"> & {
  primaryNodeIndex: number | null;
};

function invalid(node: IRNode, message: string): never {
  throw new FatalError("VALIDATION", message, { stage: "ir", nodeId: node.nodeId });
}

function validateOwnership(node: IRNode): void {
  if (Object.hasOwn(node, "on") || Object.hasOwn(node, "meta")) {
    invalid(node, "Semantic metadata belongs to source ownership.");
  }
  const ownership = node.ownership;
  if (!ownership || typeof ownership !== "object") {
    invalid(node, "Every IR node requires ownership.");
  }
  if (ownership.role === "source") {
    validateSourceFields(node, ownership);
    return;
  }
  const allowed =
    ownership.role === "wrapper" ? ["role", "ownerNodeId", "placement"] : ["role", "ownerNodeId"];
  if (Object.keys(ownership).some((key) => !allowed.includes(key))) {
    invalid(node, "Unexpected non-source ownership field.");
  }
  if (ownership.role === "wrapper") {
    if (
      node.type !== "group" ||
      (ownership.placement !== "inner" && ownership.placement !== "outer")
    ) {
      invalid(node, "A wrapper must be an inner or outer group.");
    }
  } else if (
    (ownership.role !== "content" && ownership.role !== "decoration") ||
    node.type === "group"
  ) {
    invalid(node, "Content and decoration require paint primitives.");
  }
}

function validateSourceFields(
  node: IRNode,
  ownership: Extract<IRNode["ownership"], { role: "source" }>,
): void {
  if (Object.keys(ownership).some((key) => !["role", "on", "meta"].includes(key))) {
    invalid(node, "Unexpected source ownership field.");
  }
  if (
    ownership.meta !== undefined &&
    (ownership.meta === null ||
      typeof ownership.meta !== "object" ||
      Array.isArray(ownership.meta) ||
      Object.keys(ownership.meta).length > 16 ||
      Object.entries(ownership.meta).some(
        ([key, value]) =>
          !/^[a-z][a-z0-9-]{0,31}$/u.test(key) || typeof value !== "string" || value.length > 256,
      ))
  ) {
    invalid(node, "Invalid source metadata.");
  }
  if (
    ownership.on !== undefined &&
    (ownership.on === null ||
      typeof ownership.on !== "object" ||
      Array.isArray(ownership.on) ||
      Object.entries(ownership.on).some(
        ([key, value]) =>
          !HANDLER_KEYS.some((handlerKey) => handlerKey === key) || typeof value !== "string",
      ))
  ) {
    invalid(node, "Invalid source event references.");
  }
}

function resolveOwner(
  node: IRNode,
  {
    nodeIndex,
    parentSourceIndex,
    sources,
  }: {
    nodeIndex: number;
    parentSourceIndex: number | null;
    sources: Map<number, MutableSourceInfo>;
  },
): IRSourceRef {
  const ownership = node.ownership;
  if (ownership.role === "source") {
    return { sourceIndex: nodeIndex, nodeId: node.nodeId };
  }
  let sourceIndex: number;
  let sourceId: string;
  if (ownership.role === "wrapper" && ownership.placement === "outer") {
    if (
      node.type !== "group" ||
      node.children?.length !== 1 ||
      node.children[0]?.ownership?.role !== "source"
    ) {
      invalid(node, "An outer wrapper requires one direct source child.");
    }
    sourceIndex = nodeIndex + 1;
    sourceId = node.children[0].nodeId;
  } else {
    if (parentSourceIndex === null) {
      invalid(node, "A non-source node requires its nearest source ancestor.");
    }
    const parentSource = sources.get(parentSourceIndex);
    if (!parentSource) {
      invalid(node, "Missing source ancestor.");
    }
    sourceIndex = parentSourceIndex;
    sourceId = parentSource.source.nodeId;
    if (ownership.role === "content") {
      if (parentSource.primaryNodeIndex !== null) {
        invalid(node, "A source may own at most one content primitive.");
      }
      parentSource.primaryNodeIndex = nodeIndex;
    }
  }
  if (ownership.ownerNodeId !== sourceId) {
    invalid(node, "ownerNodeId must match the structural source owner.");
  }
  return { sourceIndex, nodeId: sourceId };
}

type Task =
  | {
      kind: "enter";
      node: IRNode;
      parentNodeIndex: number | null;
      parentSourceIndex: number | null;
    }
  | { kind: "leave"; occurrence: MutableOccurrence };

type IndexBuildState = {
  nodes: Map<number, MutableOccurrence>;
  sources: Map<number, MutableSourceInfo>;
  refs: Map<number, IRSourceRef>;
  paintOrder: number;
  eventOrder: number;
};
function enterNode(
  task: Extract<Task, { kind: "enter" }>,
  state: IndexBuildState,
): MutableOccurrence {
  const { node, parentNodeIndex, parentSourceIndex } = task;
  const { nodes, sources, refs } = state;
  const nodeIndex = nodes.size;
  validateOwnership(node);
  const ownership = node.ownership;
  const isGroup = node.type === "group";
  const owner = resolveOwner(node, { nodeIndex, parentSourceIndex, sources });
  const sourceIndex = owner.sourceIndex;
  const sourceId = owner.nodeId;
  let source = refs.get(sourceIndex);
  if (!source) {
    source = { sourceIndex, nodeId: sourceId };
    refs.set(sourceIndex, source);
  }
  if (ownership.role === "source") {
    sources.set(nodeIndex, {
      source,
      node,
      parentSourceIndex,
      primaryNodeIndex: isGroup ? null : nodeIndex,
      depth: parentSourceIndex === null ? 0 : (sources.get(parentSourceIndex)?.depth ?? 0) + 1,
    });
  }
  const occurrence: MutableOccurrence = {
    nodeIndex,
    node,
    source,
    parentNodeIndex,
    paintOrder: isGroup ? null : state.paintOrder++,
    enterOrder: state.eventOrder++,
    leaveOrder: 0,
  };
  nodes.set(nodeIndex, occurrence);
  return occurrence;
}

function queueChildren(
  task: Extract<Task, { kind: "enter" }>,
  occurrence: IRNodeOccurrence,
  tasks: Task[],
): void {
  const { node, parentSourceIndex } = task;
  const ownership = node.ownership;
  const nodeIndex = occurrence.nodeIndex;
  if (node.type === "group") {
    for (let childIndex = (node.children?.length ?? 0) - 1; childIndex >= 0; childIndex--) {
      const child = node.children?.[childIndex];
      if (child) {
        tasks.push({
          kind: "enter",
          node: child,
          parentNodeIndex: nodeIndex,
          parentSourceIndex: ownership.role === "source" ? nodeIndex : parentSourceIndex,
        });
      }
    }
  }
}
/**
 * Validate ownership and index sources, primary paints and traversal ranks in one walk.
 * Rebuild after topology changes; no ID lookup is used to resolve ownership.
 * @throws {FatalError} VALIDATION for malformed ownership or application metadata.
 */
export function buildIRSourceIndex(ir: Omit<IR, "warnings">): IRSourceIndex {
  if (Object.hasOwn(ir, "drawOrder")) {
    invalid(ir.root, "IR order is derived from the tree; drawOrder is not accepted.");
  }
  const nodes = new Map<number, MutableOccurrence>();
  const sources = new Map<number, MutableSourceInfo>();
  const refs = new Map<number, IRSourceRef>();
  const tasks: Task[] = [
    { kind: "enter", node: ir.root, parentNodeIndex: null, parentSourceIndex: null },
  ];
  const state: IndexBuildState = { nodes, sources, refs, paintOrder: 0, eventOrder: 0 };
  while (tasks.length > 0) {
    const task = tasks.pop();
    if (!task) {
      break;
    }
    if (task.kind === "leave") {
      task.occurrence.leaveOrder = state.eventOrder++;
      continue;
    }
    const occurrence = enterNode(task, state);
    tasks.push({ kind: "leave", occurrence });
    queueChildren(task, occurrence, tasks);
  }
  return { ir, nodes, sources };
}
