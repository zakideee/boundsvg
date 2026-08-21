import {
  Box,
  type BoxProps,
  Flex,
  type FlexProps,
  Image,
  type ImageProps,
  Text,
  type TextProps,
  type VNodeChildrenArgs,
  type VNodeFor,
} from "@boundsvg/core";

// `children` stays in the props types so the components are usable from JSX;
// the JSX runtime strips it and passes children as rest arguments.
export type StackProps = Omit<FlexProps, "direction">;
export type CenterProps = Omit<FlexProps, "alignItems" | "justifyContent">;
export type SpacerProps = Omit<BoxProps, "children">;
export type InsetProps = Omit<BoxProps, "padding"> & {
  inset: NonNullable<BoxProps["padding"]>;
};
export type FrameProps = BoxProps;
export type AbsoluteProps = Omit<BoxProps, "position">;
export type TextBoxProps = TextProps & {
  width?: number;
  height?: number;
};
export type FitTextProps = Omit<TextProps, "fit"> & {
  fit?: "shrink" | "grow";
};
export type ImageCoverProps = Omit<ImageProps, "objectFit">;

/**
 * Row stack helper built on top of `Flex`.
 */
export function HStack(
  props: StackProps,
  ...children: VNodeChildrenArgs<"Flex">
): VNodeFor<"Flex"> {
  return Flex({ ...props, direction: "row" }, ...children);
}

/**
 * Column stack helper built on top of `Flex`.
 */
export function VStack(
  props: StackProps,
  ...children: VNodeChildrenArgs<"Flex">
): VNodeFor<"Flex"> {
  return Flex({ ...props, direction: "column" }, ...children);
}

/**
 * Center children along both the main and cross axes.
 */
export function Center(
  props: CenterProps,
  ...children: VNodeChildrenArgs<"Flex">
): VNodeFor<"Flex"> {
  return Flex({ ...props, alignItems: "center", justifyContent: "center" }, ...children);
}

/**
 * Empty `Box` helper for deliberate spacing in composed layouts.
 */
export function Spacer(props: SpacerProps = {}): VNodeFor<"Box"> {
  return Box(props);
}

/**
 * Box helper that names padding intent as `inset`.
 */
export function Inset(props: InsetProps, ...children: VNodeChildrenArgs<"Box">): VNodeFor<"Box"> {
  const { inset, ...rest } = props;
  return Box({ ...rest, padding: inset }, ...children);
}

/**
 * Pass-through `Box` wrapper for naming reusable layout frames.
 */
export function Frame(props: FrameProps, ...children: VNodeChildrenArgs<"Box">): VNodeFor<"Box"> {
  return Box(props, ...children);
}

/**
 * Box helper with `position: "absolute"` preset.
 */
export function Absolute(
  props: AbsoluteProps,
  ...children: VNodeChildrenArgs<"Box">
): VNodeFor<"Box"> {
  return Box({ ...props, position: "absolute" }, ...children);
}

/**
 * Text helper that maps `width` and `height` to `preferredFrame`.
 */
export function TextBox(
  props: TextBoxProps,
  ...children: VNodeChildrenArgs<"Text">
): VNodeFor<"Text"> {
  const { width, height, preferredFrame, ...textProps } = props;
  const sizeFrame = {
    ...(width === undefined ? {} : { w: width }),
    ...(height === undefined ? {} : { h: height }),
  };
  const resolvedFrame =
    preferredFrame ?? (Object.keys(sizeFrame).length > 0 ? sizeFrame : undefined);
  return Text(
    {
      ...textProps,
      ...(resolvedFrame === undefined ? {} : { preferredFrame: resolvedFrame }),
    },
    ...children,
  );
}

/**
 * Text helper that defaults to shrink-to-fit behavior.
 */
export function FitText(
  props: FitTextProps,
  ...children: VNodeChildrenArgs<"Text">
): VNodeFor<"Text"> {
  return Text({ ...props, fit: props.fit ?? "shrink" }, ...children);
}

/**
 * Image helper with `objectFit: "cover"` preset.
 */
export function ImageCover(props: ImageCoverProps): VNodeFor<"Image"> {
  return Image({ ...props, objectFit: "cover" });
}

export {
  type AnimationPresetOptions,
  fadeInAnimation,
  fadeOutAnimation,
  type PopAnimationOptions,
  popInAnimation,
  type RotateAnimationOptions,
  rotateInAnimation,
  type ScaleAnimationOptions,
  type SequenceOptions,
  type SlideAnimationOptions,
  type SlideDirection,
  type StaggerOptions,
  scaleInAnimation,
  sequenceAnimations,
  slideInAnimation,
  staggerAnimations,
} from "./animation-presets.js";
