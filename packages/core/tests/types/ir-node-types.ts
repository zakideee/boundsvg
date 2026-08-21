import type { IRGroupNode, IRNode, IRRectNode, IRTextNode } from "../../dist/index.js";

const bbox = { x: 0, y: 0, w: 120, h: 40 };

const rectNode: IRRectNode = {
  type: "rect",
  nodeId: "rect",
  bbox,
  fill: "#fff",
};

const textNode: IRTextNode = {
  type: "text",
  nodeId: "text",
  bbox,
  lines: [],
  font: "TestFont",
  fontSizePx: 16,
  color: "#111",
  textAlign: "start",
  layoutBox: bbox,
  lineHeightPx: 20,
};

const groupNode: IRGroupNode = {
  type: "group",
  nodeId: "group",
  bbox,
  transform: { translateX: 12 },
  children: [rectNode, textNode],
};

const nodes: IRNode[] = [groupNode, rectNode, textNode];
void nodes;

const invalidLeafTransform: IRRectNode = {
  type: "rect",
  nodeId: "invalid-transform",
  bbox,
  // @ts-expect-error post-layout transforms belong to the group wrapper
  transform: { translateX: 12 },
};
void invalidLeafTransform;

// @ts-expect-error text variants require the Rust-emitted text payload
const incompleteText: IRTextNode = {
  type: "text",
  nodeId: "incomplete-text",
  bbox,
};
void incompleteText;

function childrenOf(node: IRNode): readonly IRNode[] {
  if (node.type === "group") {
    return node.children ?? [];
  }
  // @ts-expect-error non-group variants cannot carry children
  return node.children;
}

void childrenOf;
