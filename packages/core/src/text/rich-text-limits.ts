import { FatalError } from "../errors.js";
import type { TextOnPathVNode, TextVNode, VNode } from "../vnode/types.js";
import type { TextLayoutOperation } from "./layout-operation.js";
import type { RichTextNode } from "./types.js";

/** Text/root is depth 0; recursive rich-text containers through depth 48 are accepted. */
// Keep this value aligned with boundtext::text::types::MAX_RICH_TEXT_DEPTH.
export const MAX_RICH_TEXT_DEPTH = 48;

type VNodeDepthFrame = {
  node: VNode;
  containerDepth: number;
};

type RichTextDepthFrame = {
  node: RichTextNode;
  parentContainerDepth: number;
};

type RichTextContainerNode = Extract<
  RichTextNode,
  { kind: "ruby" | "inlineBox" | "decoratedSpan" }
>;

function throwRichTextDepthError(
  operation: TextLayoutOperation,
  nodeId: string | undefined,
  actualDepth: number,
): never {
  throw new FatalError("RICH_TEXT_MAX_DEPTH", "Rich text depth limit was exceeded.", {
    stage: "validate",
    ...(nodeId === undefined ? {} : { nodeId }),
    context: {
      operation,
      actual: actualDepth,
      limit: MAX_RICH_TEXT_DEPTH,
    },
  });
}

function authoredNodeId(node: VNode): string | undefined {
  const explicitId = "id" in node.props ? node.props.id : undefined;
  return typeof explicitId === "string" ? explicitId : undefined;
}

/** Guard recursive JSX rich-text traversals before validation or bridge conversion. */
export function assertVNodeRichTextDepth(textNode: TextVNode | TextOnPathVNode): void {
  const nodeId = authoredNodeId(textNode);
  const pending: VNodeDepthFrame[] = [];
  for (const child of textNode.children) {
    if (typeof child !== "string") {
      pending.push({ node: child, containerDepth: 1 });
    }
  }

  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) {
      break;
    }
    if (frame.containerDepth > MAX_RICH_TEXT_DEPTH) {
      throwRichTextDepthError("renderTextLayout", nodeId, frame.containerDepth);
    }
    for (const child of frame.node.children) {
      if (typeof child !== "string") {
        pending.push({ node: child, containerDepth: frame.containerDepth + 1 });
      }
    }
  }
}

function isRichTextContainer(node: RichTextNode): node is RichTextContainerNode {
  return node.kind === "ruby" || node.kind === "inlineBox" || node.kind === "decoratedSpan";
}

function pushRichTextChildren(
  node: RichTextContainerNode,
  parentContainerDepth: number,
  pending: RichTextDepthFrame[],
): void {
  if (node.kind === "ruby") {
    for (const child of node.base) {
      pending.push({ node: child, parentContainerDepth });
    }
    for (const child of node.rt) {
      pending.push({ node: child, parentContainerDepth });
    }
    for (const level of node.rtLevels ?? []) {
      for (const child of level) {
        pending.push({ node: child, parentContainerDepth });
      }
    }
    return;
  }
  for (const child of node.children) {
    pending.push({ node: child, parentContainerDepth });
  }
}

/** Guard recursive public RichTextNode containers; leaf nodes do not add depth. */
export function assertRichTextNodeDepth(
  nodes: readonly RichTextNode[],
  operation: TextLayoutOperation = "renderTextLayout",
): void {
  const pending: RichTextDepthFrame[] = [];
  for (const node of nodes) {
    pending.push({ node, parentContainerDepth: 0 });
  }

  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) {
      break;
    }
    if (!isRichTextContainer(frame.node)) {
      continue;
    }
    const containerDepth = frame.parentContainerDepth + 1;
    if (containerDepth > MAX_RICH_TEXT_DEPTH) {
      throwRichTextDepthError(operation, undefined, containerDepth);
    }
    pushRichTextChildren(frame.node, containerDepth, pending);
  }
}
