import type {
  BoxVNode,
  CanvasVNode,
  DebugOverlayPart,
  FlexVNode,
  GridVNode,
  InlineBoxVNode,
  InlineVNode,
  RtVNode,
  RubyVNode,
  TextOnPathVNode,
  TextVNode,
  VNode,
} from "@boundsvg/react";
import type { RendererMode, TextPathModeOption } from "../types";

export type TemplateOverrides = {
  canvasWidth: number;
  canvasHeight: number;
  background: string;
  fontSizeScale: number;
  textColor: string;
  lineHeight: number;
  renderer: RendererMode;
  pngScale: number;
  textPathMode: TextPathModeOption;
  debugOverlayParts: DebugOverlayPart[];
};

type OverrideDimensions = {
  origCanvasW: number;
  origCanvasH: number;
};

type LayoutVNode = FlexVNode | GridVNode | BoxVNode;
type LayoutProps = LayoutVNode["props"];

export function extractTemplateDefaults(vnode: VNode): TemplateOverrides {
  if (vnode.type !== "Canvas") {
    throw new Error("Template root must be a Canvas node");
  }

  return {
    canvasWidth: vnode.props.width,
    canvasHeight: vnode.props.height,
    background: vnode.props.background ?? "#ffffff",
    fontSizeScale: 1.0,
    textColor: "",
    lineHeight: 0,
    renderer: "boundsvg",
    pngScale: 2,
    textPathMode: "merged",
    debugOverlayParts: [],
  };
}

function overrideCanvasProps(
  props: CanvasVNode["props"],
  overrides: TemplateOverrides,
): CanvasVNode["props"] {
  return {
    ...props,
    width: overrides.canvasWidth,
    height: overrides.canvasHeight,
    background: overrides.background,
  };
}

function overrideLayoutProps<T extends LayoutProps>(
  props: T,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): T {
  const next = { ...props };
  if (next.width === dims.origCanvasW) {
    next.width = overrides.canvasWidth;
  }
  if (next.height === dims.origCanvasH) {
    next.height = overrides.canvasHeight;
  }
  return next;
}

function overrideTextProps(
  props: TextVNode["props"],
  overrides: TemplateOverrides,
): TextVNode["props"] {
  const next = {
    ...props,
    fontSizePx: Math.round(props.fontSizePx * overrides.fontSizeScale),
  };

  if (next.minFontSizePx !== undefined) {
    next.minFontSizePx = Math.round(next.minFontSizePx * overrides.fontSizeScale);
  }
  if (overrides.textColor) {
    next.color = overrides.textColor;
  }
  if (overrides.lineHeight > 0) {
    next.lineHeight = overrides.lineHeight;
  }

  return next;
}

function cloneInlineVNode(
  node: InlineVNode,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): InlineVNode {
  return {
    ...node,
    props: { ...node.props },
    children: node.children.map((child) => cloneInlineChild(child, overrides, dims)),
  };
}

function cloneInlineBoxVNode(
  node: InlineBoxVNode,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): InlineBoxVNode {
  return {
    ...node,
    props: { ...node.props },
    children: node.children.map((child) => cloneInlineBoxChild(child, overrides, dims)),
  };
}

function cloneRtVNode(
  node: RtVNode,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): RtVNode {
  return {
    ...node,
    props: { ...node.props },
    children: node.children.map((child) => cloneRtChild(child, overrides, dims)),
  };
}

function cloneRubyVNode(
  node: RubyVNode,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): RubyVNode {
  return {
    ...node,
    props: { ...node.props },
    children: node.children.map((child) => cloneRubyChild(child, overrides, dims)),
  };
}

function cloneTextVNode(
  node: TextVNode,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): TextVNode {
  return {
    ...node,
    props: overrideTextProps(node.props, overrides),
    children: node.children.map((child) => cloneTextChild(child, overrides, dims)),
  };
}

function cloneTextOnPathVNode(
  node: TextOnPathVNode,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): TextOnPathVNode {
  return {
    ...node,
    props: {
      ...node.props,
      width: node.props.width === dims.origCanvasW ? overrides.canvasWidth : node.props.width,
      height: node.props.height === dims.origCanvasH ? overrides.canvasHeight : node.props.height,
      fontSizePx: Math.round(node.props.fontSizePx * overrides.fontSizeScale),
      color: overrides.textColor || node.props.color,
    },
    children: [...node.children],
  };
}

function cloneCanvasVNode(
  node: CanvasVNode,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): CanvasVNode {
  return {
    ...node,
    props: overrideCanvasProps(node.props, overrides),
    children: node.children.map((child) =>
      typeof child === "string" ? child : cloneVNode(child, overrides, dims),
    ),
  };
}

function cloneLayoutVNode<T extends LayoutVNode>(
  node: T,
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): T {
  return {
    ...node,
    props: overrideLayoutProps(node.props, overrides, dims),
    children: node.children.map((child) =>
      typeof child === "string" ? child : cloneVNode(child, overrides, dims),
    ),
  };
}

function cloneTextChild(
  child: TextVNode["children"][number],
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): TextVNode["children"][number] {
  if (typeof child === "string") {
    return child;
  }
  switch (child.type) {
    case "Inline":
      return cloneInlineVNode(child, overrides, dims);
    case "InlineBox":
      return cloneInlineBoxVNode(child, overrides, dims);
    case "InlineRect":
      return { ...child, props: { ...child.props }, children: [] };
    case "Ruby":
      return cloneRubyVNode(child, overrides, dims);
  }
}

function cloneInlineChild(
  child: InlineVNode["children"][number],
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): InlineVNode["children"][number] {
  if (typeof child === "string") {
    return child;
  }
  switch (child.type) {
    case "Inline":
      return cloneInlineVNode(child, overrides, dims);
    case "InlineRect":
      return { ...child, props: { ...child.props }, children: [] };
    case "Ruby":
      return cloneRubyVNode(child, overrides, dims);
  }
}

function cloneInlineBoxChild(
  child: InlineBoxVNode["children"][number],
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): InlineBoxVNode["children"][number] {
  if (typeof child === "string") {
    return child;
  }
  switch (child.type) {
    case "Inline":
      return cloneInlineVNode(child, overrides, dims);
    case "InlineBox":
      return cloneInlineBoxVNode(child, overrides, dims);
    case "InlineRect":
      return { ...child, props: { ...child.props }, children: [] };
    case "Ruby":
      return cloneRubyVNode(child, overrides, dims);
  }
}

function cloneRubyChild(
  child: RubyVNode["children"][number],
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): RubyVNode["children"][number] {
  if (typeof child === "string") {
    return child;
  }
  return child.type === "Inline"
    ? cloneInlineVNode(child, overrides, dims)
    : cloneRtVNode(child, overrides, dims);
}

function cloneRtChild(
  child: RtVNode["children"][number],
  overrides: TemplateOverrides,
  dims: OverrideDimensions,
): RtVNode["children"][number] {
  if (typeof child === "string") {
    return child;
  }
  return cloneInlineVNode(child, overrides, dims);
}

function cloneVNode(node: VNode, overrides: TemplateOverrides, dims: OverrideDimensions): VNode {
  switch (node.type) {
    case "Canvas":
      return cloneCanvasVNode(node, overrides, dims);
    case "Flex":
    case "Grid":
    case "Box":
      return cloneLayoutVNode(node, overrides, dims);
    case "Text":
      return cloneTextVNode(node, overrides, dims);
    case "TextOnPath":
      return cloneTextOnPathVNode(node, overrides, dims);
    case "Inline":
      return cloneInlineVNode(node, overrides, dims);
    case "InlineBox":
      return cloneInlineBoxVNode(node, overrides, dims);
    case "InlineRect":
      return { ...node, props: { ...node.props }, children: [] };
    case "Ruby":
      return cloneRubyVNode(node, overrides, dims);
    case "Rt":
      return cloneRtVNode(node, overrides, dims);
    case "Image":
      return { ...node, props: { ...node.props }, children: [] };
    case "Path":
      return { ...node, props: { ...node.props }, children: [] };
    case "Svg":
      return { ...node, props: { ...node.props }, children: [] };
    case "Shape":
      return { ...node, props: { ...node.props }, children: [] };
    case "Symbol":
      return { ...node, props: { ...node.props }, children: [] };
  }
}

export function applyTemplateOverrides(original: VNode, overrides: TemplateOverrides): VNode {
  if (original.type !== "Canvas") {
    throw new Error("Template root must be a Canvas node");
  }

  const dims: OverrideDimensions = {
    origCanvasW: original.props.width,
    origCanvasH: original.props.height,
  };

  return cloneVNode(original, overrides, dims);
}
