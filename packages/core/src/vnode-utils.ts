import type { VNode } from "./vnode/types.js";

export type VNodePath = readonly number[];

/** Information passed to VNode traversal and mapping callbacks. */
export type VNodeVisit = {
  node: VNode;
  path: VNodePath;
  parent: VNode | null;
};

export type VNodeMapper = (visit: VNodeVisit) => VNode;

/** A text-bearing VNode found during traversal, with its path from the root. */
export type TextNodeMatch = {
  node: Extract<VNode, { type: "Text" | "TextOnPath" }>;
  path: VNodePath;
};

/**
 * Visit each non-string VNode in depth-first order.
 */
export function walkVNode(root: VNode, visitor: (visit: VNodeVisit) => void): void {
  function walk(node: VNode, path: number[], parent: VNode | null): void {
    visitor({ node, path, parent });
    for (const [index, child] of node.children.entries()) {
      if (typeof child !== "string") {
        walk(child, [...path, index], node);
      }
    }
  }

  walk(root, [], null);
}

/**
 * Create a transformed VNode tree without mutating the input tree.
 */
export function mapVNode(root: VNode, mapper: VNodeMapper): VNode {
  function mapNode(node: VNode, path: number[], parent: VNode | null): VNode {
    const children = node.children.map((child, index) =>
      typeof child === "string" ? child : mapNode(child, [...path, index], node),
    );
    const nextNode = cloneWithChildren(node, children);
    return mapper({ node: nextNode, path, parent });
  }

  return mapNode(root, [], null);
}

/**
 * Clone a VNode tree and its props/children arrays.
 */
export function cloneVNode(root: VNode): VNode {
  return mapVNode(root, ({ node }) => node);
}

/**
 * Find the first VNode with a matching explicit `id` prop.
 */
export function findVNodeById(root: VNode, id: string): VNode | null {
  let match: VNode | null = null;
  walkVNode(root, ({ node }) => {
    if (!match && getExplicitNodeId(node) === id) {
      match = node;
    }
  });
  return match;
}

/**
 * Collect Text nodes for localization, template editing, or content audits.
 */
export function collectTextNodes(root: VNode): TextNodeMatch[] {
  const matches: TextNodeMatch[] = [];
  walkVNode(root, ({ node, path }) => {
    if (node.type === "Text" || node.type === "TextOnPath") {
      matches.push({ node, path });
    }
  });
  return matches;
}

/**
 * Replace the children of a Text node selected by explicit `id`.
 */
export function replaceTextById(root: VNode, id: string, text: string): VNode {
  return mapVNode(root, ({ node }) => {
    if ((node.type !== "Text" && node.type !== "TextOnPath") || getExplicitNodeId(node) !== id) {
      return node;
    }
    return cloneWithChildren(node, [text]);
  });
}

/**
 * Prefix explicit node IDs before embedding or composing multiple VNode trees.
 */
export function withNodeIdPrefix(root: VNode, prefix: string): VNode {
  return mapVNode(root, ({ node }) => {
    const id = getExplicitNodeId(node);
    if (!id) {
      return node;
    }
    return cloneWithProps(node, { ...node.props, id: `${prefix}${id}` });
  });
}

function getExplicitNodeId(node: VNode): string | null {
  const props = node.props as Record<string, unknown>;
  return typeof props.id === "string" ? props.id : null;
}

function cloneWithChildren(node: VNode, children: VNode["children"]): VNode {
  return {
    ...node,
    props: { ...node.props, children },
    children,
  } as unknown as VNode;
}

function cloneWithProps(node: VNode, props: VNode["props"]): VNode {
  return {
    ...node,
    props,
  } as unknown as VNode;
}
