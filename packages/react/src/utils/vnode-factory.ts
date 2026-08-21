import {
  type CanvasVNode,
  type ChildFor,
  createElement,
  FatalError,
  type NormalizedPropsFor,
  type VNode,
  type VNodeFor,
  type VNodeType,
} from "@boundsvg/core";

type AnyChild = VNode | string;

function assertTextChildren(children: AnyChild[]): asserts children is Array<ChildFor<"Text">> {
  for (const child of children) {
    if (typeof child === "string") {
      continue;
    }
    if (
      child.type === "Inline" ||
      child.type === "InlineBox" ||
      child.type === "InlineRect" ||
      child.type === "Ruby"
    ) {
      continue;
    }
    throw new Error(
      "[boundsvg] <Text> only accepts string, <Inline>, <InlineBox>, <InlineRect>, and <Ruby> children.",
    );
  }
}

function assertTextOnPathChildren(
  children: AnyChild[],
): asserts children is Array<ChildFor<"TextOnPath">> {
  for (const child of children) {
    if (typeof child === "string" || child.type === "Inline") {
      continue;
    }
    throw new FatalError(
      "TEXT_PATH_CHILD_UNSUPPORTED",
      "TextOnPath children must be strings or Inline nodes.",
      { stage: "validate", nodeId: "<TextOnPath>" },
    );
  }
}

function assertInlineBoxChildren(
  children: AnyChild[],
): asserts children is Array<ChildFor<"InlineBox">> {
  for (const child of children) {
    if (typeof child === "string") {
      continue;
    }
    if (
      child.type === "Inline" ||
      child.type === "InlineBox" ||
      child.type === "InlineRect" ||
      child.type === "Ruby"
    ) {
      continue;
    }
    throw new Error(
      "[boundsvg] <InlineBox> only accepts string, <Inline>, <InlineBox>, <InlineRect>, and <Ruby> children.",
    );
  }
}

function assertInlineChildren(children: AnyChild[]): asserts children is Array<ChildFor<"Inline">> {
  for (const child of children) {
    if (typeof child === "string") {
      continue;
    }
    if (child.type === "Inline" || child.type === "InlineRect" || child.type === "Ruby") {
      continue;
    }
    throw new Error(
      "[boundsvg] <Inline> only accepts string, <Inline>, <InlineRect>, and <Ruby> children.",
    );
  }
}

function assertRubyChildren(children: AnyChild[]): asserts children is Array<ChildFor<"Ruby">> {
  for (const child of children) {
    if (typeof child === "string") {
      continue;
    }
    if (child.type === "Inline" || child.type === "Rt") {
      continue;
    }
    throw new Error("[boundsvg] <Ruby> only accepts string, <Inline>, and <Rt> children.");
  }
}

function assertRtChildren(children: AnyChild[]): asserts children is Array<ChildFor<"Rt">> {
  for (const child of children) {
    if (typeof child === "string") {
      continue;
    }
    if (child.type === "Inline") {
      continue;
    }
    throw new Error("[boundsvg] <Rt> only accepts string and <Inline> children.");
  }
}

/**
 * Factory map keyed by VNodeType.
 *
 * Each entry constructs a VNode using the concrete createElement overload,
 * so TypeScript verifies props/children per component type.
 * Indexed access with generic T (`factory[nodeType]`) preserves the
 * NormalizedPropsFor<T> → VNodeFor<T> correlation that a switch-case cannot.
 */
const factory: {
  [K in VNodeType]: (props: NormalizedPropsFor<K>, children: AnyChild[]) => VNodeFor<K>;
} = {
  Canvas: (props, children) => createElement("Canvas", { ...props, children }),
  Flex: (props, children) => createElement("Flex", { ...props, children }),
  Grid: (props, children) => createElement("Grid", { ...props, children }),
  Box: (props, children) => createElement("Box", { ...props, children }),
  Text: (props, children) => {
    assertTextChildren(children);
    return createElement("Text", { ...props, children });
  },
  TextOnPath: (props, children) => {
    assertTextOnPathChildren(children);
    return createElement("TextOnPath", { ...props, children });
  },
  Inline: (props, children) => {
    assertInlineChildren(children);
    return createElement("Inline", { ...props, children });
  },
  Ruby: (props, children) => {
    assertRubyChildren(children);
    return createElement("Ruby", { ...props, children });
  },
  Rt: (props, children) => {
    assertRtChildren(children);
    return createElement("Rt", { ...props, children });
  },
  InlineBox: (props, children) => {
    assertInlineBoxChildren(children);
    return createElement("InlineBox", { ...props, children });
  },
  InlineRect: (props, children) => {
    if (children.length > 0) {
      throw new Error("[boundsvg] <InlineRect> does not accept children.");
    }
    return createElement("InlineRect", props);
  },
  Image: (props) => createElement("Image", props),
  Path: (props) => createElement("Path", props),
  Svg: (props) => createElement("Svg", props),
  Shape: (props) => createElement("Shape", props),
  Symbol: (props) => createElement("Symbol", props),
};

export function createVNodeFromParts<T extends VNodeType>(
  nodeType: T,
  props: NormalizedPropsFor<T>,
  children: AnyChild[],
): VNodeFor<T> {
  return factory[nodeType](props, children);
}

export function createCanvasVNode(
  canvasProps: { width: number; height: number; background?: string },
  children: Array<VNode | string>,
): CanvasVNode {
  return createElement("Canvas", { ...canvasProps, children });
}
