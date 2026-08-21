import type {
  BoxProps,
  CanvasProps,
  FlexProps,
  GridProps,
  ImageProps,
  InlineBoxProps,
  InlineProps,
  InlineRectProps,
  PathProps,
  RtProps,
  RubyProps,
  ShapeProps,
  SvgProps,
  SymbolProps,
  TextOnPathProps,
  TextProps,
  VNodeType,
} from "@boundsvg/core";
import type { ReactElement, ReactNode } from "react";
import type { InteractiveHandlerProps } from "../types.js";

/**
 * A phantom React component that maps to a VNode type.
 * Renders `null` — only used as a declarative description for `toVNode()`.
 */
export type BoundSvgNodeComponent<P> = {
  (props: P): null;
  __boundsvgNodeType: VNodeType;
  displayName: string;
};

export type BoundSvgNodeComponentFor<P, T extends VNodeType> = {
  (props: P): null;
  __boundsvgNodeType: T;
  displayName: string;
};

function createNodeComponent<P, T extends VNodeType>(
  nodeType: T,
  displayName: string,
): BoundSvgNodeComponentFor<P & { children?: ReactNode }, T> {
  const Component = (_props: P & { children?: ReactNode }) => null;
  Component.__boundsvgNodeType = nodeType;
  Component.displayName = displayName;
  return Component as BoundSvgNodeComponentFor<P & { children?: ReactNode }, T>;
}

function createLeafNodeComponent<P, T extends VNodeType>(
  nodeType: T,
  displayName: string,
): BoundSvgNodeComponentFor<P, T> {
  const Component = (_props: P) => null;
  Component.__boundsvgNodeType = nodeType;
  Component.displayName = displayName;
  return Component as BoundSvgNodeComponentFor<P, T>;
}

/**
 * Override core event handler props (string-only) with interactive variants
 * that also accept callback functions for use with InteractiveBoundSvg.
 */
type Interactivify<P> = Omit<P, keyof InteractiveHandlerProps> & InteractiveHandlerProps;

type WithReactChildren<P> = Omit<P, "children"> & { children?: ReactNode };
type TextOnPathInlineElement = ReactElement<
  WithReactChildren<InlineProps>,
  BoundSvgNodeComponentFor<WithReactChildren<InlineProps>, "Inline">
>;
type TextOnPathReactChild = string | TextOnPathInlineElement;
type WithTextOnPathChildren<P> = Omit<P, "children"> & {
  children?: TextOnPathReactChild | readonly TextOnPathReactChild[];
};

type BoundSvgNodeSpec =
  | { type: "Canvas"; props: WithReactChildren<CanvasProps> }
  | { type: "Flex"; props: WithReactChildren<Interactivify<FlexProps>> }
  | { type: "Grid"; props: WithReactChildren<Interactivify<GridProps>> }
  | { type: "Box"; props: WithReactChildren<Interactivify<BoxProps>> }
  | { type: "Text"; props: WithReactChildren<Interactivify<TextProps>> }
  | { type: "TextOnPath"; props: WithTextOnPathChildren<Interactivify<TextOnPathProps>> }
  | { type: "Inline"; props: WithReactChildren<InlineProps> }
  | { type: "InlineBox"; props: WithReactChildren<InlineBoxProps> }
  | { type: "InlineRect"; props: InlineRectProps }
  | { type: "Ruby"; props: WithReactChildren<RubyProps> }
  | { type: "Rt"; props: WithReactChildren<RtProps> }
  | { type: "Image"; props: WithReactChildren<Interactivify<ImageProps>> }
  | { type: "Path"; props: WithReactChildren<Interactivify<PathProps>> }
  | { type: "Svg"; props: WithReactChildren<Interactivify<SvgProps>> }
  | { type: "Shape"; props: WithReactChildren<Interactivify<ShapeProps>> }
  | { type: "Symbol"; props: WithReactChildren<Interactivify<SymbolProps>> };

export type BoundSvgNodePropsFor<T extends VNodeType> = Extract<
  BoundSvgNodeSpec,
  { type: T }
>["props"];

export type BoundSvgElementFor<T extends VNodeType> = ReactElement<
  BoundSvgNodePropsFor<T>,
  BoundSvgNodeComponentFor<BoundSvgNodePropsFor<T>, T>
>;

export type AnyBoundSvgElement = {
  [K in VNodeType]: BoundSvgElementFor<K>;
}[VNodeType];

export const Canvas = createNodeComponent<Omit<CanvasProps, "children">, "Canvas">(
  "Canvas",
  "BoundSvg.Canvas",
);
export const Flex = createNodeComponent<Interactivify<Omit<FlexProps, "children">>, "Flex">(
  "Flex",
  "BoundSvg.Flex",
);
export const Grid = createNodeComponent<Interactivify<Omit<GridProps, "children">>, "Grid">(
  "Grid",
  "BoundSvg.Grid",
);
export const Box = createNodeComponent<Interactivify<Omit<BoxProps, "children">>, "Box">(
  "Box",
  "BoundSvg.Box",
);
export const Text = createNodeComponent<Interactivify<Omit<TextProps, "children">>, "Text">(
  "Text",
  "BoundSvg.Text",
);
export const TextOnPath = createNodeComponent<
  Interactivify<Omit<TextOnPathProps, "children">> & {
    children?: TextOnPathReactChild | readonly TextOnPathReactChild[];
  },
  "TextOnPath"
>("TextOnPath", "BoundSvg.TextOnPath");
export const Inline = createNodeComponent<Omit<InlineProps, "children">, "Inline">(
  "Inline",
  "BoundSvg.Inline",
);
export const InlineBox = createNodeComponent<Omit<InlineBoxProps, "children">, "InlineBox">(
  "InlineBox",
  "BoundSvg.InlineBox",
);
export const InlineRect = createLeafNodeComponent<InlineRectProps, "InlineRect">(
  "InlineRect",
  "BoundSvg.InlineRect",
);
export const Ruby = createNodeComponent<Omit<RubyProps, "children">, "Ruby">(
  "Ruby",
  "BoundSvg.Ruby",
);
export const Rt = createNodeComponent<Omit<RtProps, "children">, "Rt">("Rt", "BoundSvg.Rt");
export const Image = createNodeComponent<Interactivify<Omit<ImageProps, "children">>, "Image">(
  "Image",
  "BoundSvg.Image",
);
export const Path = createNodeComponent<Interactivify<Omit<PathProps, "children">>, "Path">(
  "Path",
  "BoundSvg.Path",
);
export const Svg = createNodeComponent<Interactivify<Omit<SvgProps, "children">>, "Svg">(
  "Svg",
  "BoundSvg.Svg",
);
export const Shape = createNodeComponent<Interactivify<ShapeProps>, "Shape">(
  "Shape",
  "BoundSvg.Shape",
);
// biome-ignore lint/suspicious/noShadowRestrictedNames: matches core API name
export const Symbol = createNodeComponent<Interactivify<SymbolProps>, "Symbol">(
  "Symbol",
  "BoundSvg.Symbol",
);
