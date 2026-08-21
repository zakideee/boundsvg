import { createElement } from "./create-element.js";
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
  VNodeChildrenArgs,
  VNodeFor,
} from "./types.js";

/**
 * Canvas — root container.
 * Must be the unique root of the VNode tree.
 */
export function Canvas(
  props: CanvasProps,
  ...children: VNodeChildrenArgs<"Canvas">
): VNodeFor<"Canvas"> {
  return createElement("Canvas", { ...props, children });
}

/**
 * Flex — flex layout container.
 */
export function Flex(props: FlexProps, ...children: VNodeChildrenArgs<"Flex">): VNodeFor<"Flex"> {
  return createElement("Flex", { ...props, children });
}

/**
 * Grid — CSS Grid layout container.
 */
export function Grid(props: GridProps, ...children: VNodeChildrenArgs<"Grid">): VNodeFor<"Grid"> {
  return createElement("Grid", { ...props, children });
}

/**
 * Box — simple container (internally flex direction=column).
 */
export function Box(props: BoxProps, ...children: VNodeChildrenArgs<"Box">): VNodeFor<"Box"> {
  return createElement("Box", { ...props, children });
}

/**
 * Text — text content.
 * Children must be strings only.
 */
export function Text(props: TextProps, ...children: VNodeChildrenArgs<"Text">): VNodeFor<"Text"> {
  return createElement("Text", { ...props, children });
}

/**
 * TextOnPath — single-line plain or shaping-rich text positioned along one path.
 */
export function TextOnPath(
  props: TextOnPathProps,
  ...children: VNodeChildrenArgs<"TextOnPath">
): VNodeFor<"TextOnPath"> {
  return createElement("TextOnPath", { ...props, children });
}

/**
 * Inline — span-like text run override inside Text.
 * Children must be string or nested Inline.
 */
export function Inline(
  props: InlineProps,
  ...children: VNodeChildrenArgs<"Inline">
): VNodeFor<"Inline"> {
  return createElement("Inline", { ...props, children });
}

/**
 * InlineBox — decorated atomic inline box inside Text.
 * Children must be string or nested Inline.
 */
export function InlineBox(
  props: InlineBoxProps,
  ...children: VNodeChildrenArgs<"InlineBox">
): VNodeFor<"InlineBox"> {
  return createElement("InlineBox", { ...props, children });
}

/**
 * InlineRect — childless atomic rectangle inside a Text rich flow.
 */
export function InlineRect(props: InlineRectProps): VNodeFor<"InlineRect"> {
  return createElement("InlineRect", props);
}

/**
 * Ruby — inline ruby annotation container.
 */
export function Ruby(props: RubyProps, ...children: VNodeChildrenArgs<"Ruby">): VNodeFor<"Ruby"> {
  return createElement("Ruby", { ...props, children });
}

/**
 * Rt — ruby annotation text.
 */
export function Rt(props: RtProps, ...children: VNodeChildrenArgs<"Rt">): VNodeFor<"Rt"> {
  return createElement("Rt", { ...props, children });
}

/**
 * Image — embedded image.
 * No children allowed.
 */
export function Image(props: ImageProps): VNodeFor<"Image"> {
  return createElement("Image", props);
}

/**
 * Path — SVG path data.
 * No children allowed.
 */
export function Path(props: PathProps): VNodeFor<"Path"> {
  return createElement("Path", props);
}

/**
 * Svg — nested SVG content.
 * No children allowed.
 */
export function Svg(props: SvgProps): VNodeFor<"Svg"> {
  return createElement("Svg", props);
}

/**
 * Shape — low-level geometry primitive resolved through the shape registry.
 * No children allowed.
 */
export function Shape(props: ShapeProps): VNodeFor<"Shape"> {
  return createElement("Shape", props);
}

/**
 * Symbol — parameterized shape instance resolved through the symbol registry.
 * No children allowed.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: JSX component name matching VNodeType "Symbol"
export function Symbol(props: SymbolProps): VNodeFor<"Symbol"> {
  return createElement("Symbol", props);
}
