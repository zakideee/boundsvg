import {
  FatalError,
  type PropsFor,
  type VNode,
  type VNodeFor,
  type VNodeType,
} from "@boundsvg/core";
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import type {
  AnyBoundSvgElement,
  BoundSvgElementFor,
  BoundSvgNodePropsFor,
} from "../components/nodes.js";
import { getNodeType } from "./get-node-type.js";
import { createCanvasVNode, createVNodeFromParts } from "./vnode-factory.js";

// biome-ignore lint/style/useNamingConvention: standard Node.js process global shape
declare const process: { env?: { NODE_ENV?: string } } | undefined;

type PropsWithoutChildren<T extends VNodeType> = Omit<PropsFor<T>, "children">;
type ElementPropsWithoutChildren<T extends VNodeType> = Omit<BoundSvgNodePropsFor<T>, "children">;
type BoundSvgElementWithType<T extends VNodeType> = Extract<
  AnyBoundSvgElement,
  { type: { __boundsvgNodeType: T } }
>;
type DefinedEntry<T extends object> = {
  [K in keyof T]-?: [K, Exclude<T[K], undefined>];
}[keyof T];

function isBoundSvgElement(element: ReactElement): element is AnyBoundSvgElement {
  return getNodeType(element) !== undefined;
}

function hasNodeType<T extends VNodeType>(
  element: AnyBoundSvgElement,
  nodeType: T,
): element is BoundSvgElementWithType<T> {
  return element.type.__boundsvgNodeType === nodeType;
}

function getDefinedEntries<T extends object>(value: T): DefinedEntry<T>[] {
  const entries: DefinedEntry<T>[] = [];

  for (const key of Object.keys(value) as Array<keyof T>) {
    const entryValue = value[key];
    if (entryValue !== undefined) {
      entries.push([key, entryValue] as DefinedEntry<T>);
    }
  }

  return entries;
}

function assignElementProp<T extends VNodeType, K extends keyof ElementPropsWithoutChildren<T>>(
  target: Partial<PropsWithoutChildren<T>>,
  key: K,
  value: Exclude<ElementPropsWithoutChildren<T>[K], undefined>,
): void {
  target[key as keyof PropsWithoutChildren<T>] =
    value as PropsWithoutChildren<T>[keyof PropsWithoutChildren<T>];
}

function finalizeProps<T extends VNodeType>(
  props: Partial<PropsWithoutChildren<T>>,
): PropsWithoutChildren<T> {
  return props as PropsWithoutChildren<T>;
}

function getFragmentChildren(value: ReactElement): ReactNode {
  return (value.props as { children?: ReactNode }).children;
}

function getElementDisplayName(value: ReactElement): string {
  return typeof value.type === "string"
    ? value.type
    : ((value.type as { displayName?: string; name?: string }).displayName ??
        (value.type as { name?: string }).name ??
        "Unknown");
}

function createUnsupportedChildError(value: ReactElement): Error {
  return new Error(
    `[boundsvg] Unsupported React element <${getElementDisplayName(value)}> inside declarative boundsvg content. ` +
      "Only boundsvg components (Canvas, Flex, Grid, Box, Text, TextOnPath, Inline, InlineBox, InlineRect, Ruby, Rt, Image, Path, Svg, Shape, Symbol) " +
      "are supported. Inline helper components by calling them as functions before passing their result to <BoundSvg>.",
  );
}

function createTextOnPathChildError(): FatalError {
  return new FatalError(
    "TEXT_PATH_CHILD_UNSUPPORTED",
    "TextOnPath children must be strings or Inline nodes.",
    { stage: "validate", nodeId: "<TextOnPath>" },
  );
}

/**
 * Normalize a single React child into a VNode or string.
 * Returns undefined for children that should be skipped (null, boolean).
 */
function normalizeChild(
  child: Exclude<ReactNode, null | undefined>,
  collectFn: (children: ReactNode, insideTextOnPath: boolean) => (VNode | string)[],
  insideTextOnPath: boolean,
): VNode | string | (VNode | string)[] | undefined {
  if (typeof child === "boolean") {
    if (insideTextOnPath) {
      throw createTextOnPathChildError();
    }
    return undefined;
  }
  if (typeof child === "string") {
    return child;
  }
  if (typeof child === "number") {
    if (insideTextOnPath) {
      throw createTextOnPathChildError();
    }
    return String(child);
  }

  if (isValidElement(child)) {
    if (child.type === Fragment) {
      return collectFn(getFragmentChildren(child), insideTextOnPath);
    }

    if (isBoundSvgElement(child)) {
      return convertBoundSvgElement(child, insideTextOnPath);
    }

    throw createUnsupportedChildError(child);
  }

  if (insideTextOnPath) {
    throw createTextOnPathChildError();
  }
  return undefined;
}

/**
 * Walk React children and collect VNode / string entries.
 */
function collectChildren(children: ReactNode, insideTextOnPath = false): (VNode | string)[] {
  const result: (VNode | string)[] = [];

  Children.forEach(children, (child) => {
    if (child == null) {
      if (insideTextOnPath) {
        throw createTextOnPathChildError();
      }
      return;
    }
    const normalized = normalizeChild(child, collectChildren, insideTextOnPath);
    if (normalized === undefined) {
      return;
    }
    if (Array.isArray(normalized)) {
      result.push(...normalized);
    } else {
      result.push(normalized);
    }
  });

  return result;
}

const EVENT_KEYS = new Set([
  "onClick",
  "onDoubleClick",
  "onContextMenu",
  "onPointerDown",
  "onPointerUp",
  "onPointerCancel",
  "onPointerMove",
  "onPointerEnter",
  "onPointerLeave",
  "onPointerOver",
  "onPointerOut",
  "onMouseDown",
  "onMouseUp",
  "onMouseMove",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseOver",
  "onMouseOut",
  "onTouchStart",
  "onTouchEnd",
  "onTouchMove",
]);

/**
 * Convert a single React element (with a known VNodeType) into a VNode.
 */
function convertElement<T extends VNodeType>(
  element: BoundSvgElementFor<T>,
  insideTextOnPath = false,
): VNodeFor<T> {
  const nodeType = element.type.__boundsvgNodeType;
  // Extract props — strip `children` from the VNode props, filter out undefined values
  const elementProps = element.props as BoundSvgNodePropsFor<T> & {
    children?: ReactNode;
  };
  const children = elementProps.children;
  const rest = { ...elementProps };
  delete rest.children;
  const props: Partial<PropsWithoutChildren<T>> = {};
  for (const [key, value] of getDefinedEntries(rest as ElementPropsWithoutChildren<T>)) {
    // Warn if function event handlers are passed through non-interactive path
    if (EVENT_KEYS.has(key as string) && typeof value === "function") {
      if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
        console.warn(
          `[boundsvg] Function handler for "${String(key)}" on <${nodeType}> will be ignored. ` +
            "Use <InteractiveBoundSvg> or toInteractiveVNode() for function event handlers.",
        );
      }
      continue; // Drop function handlers — core expects string only
    }

    assignElementProp(props, key, value);
  }

  const vnode = createVNodeFromParts(
    nodeType,
    finalizeProps(props),
    collectChildren(children, insideTextOnPath || nodeType === "TextOnPath"),
  );

  // React stores `key` on the element itself, not in props
  if (element.key != null) {
    vnode.key = element.key as string | number;
  }

  return vnode;
}

function convertBoundSvgElement(element: AnyBoundSvgElement, insideTextOnPath = false): VNode {
  if (hasNodeType(element, "Canvas")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Flex")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Grid")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Box")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Text")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "TextOnPath")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Inline")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "InlineBox")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "InlineRect")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Ruby")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Rt")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Image")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Path")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Shape")) {
    return convertElement(element, insideTextOnPath);
  }
  if (hasNodeType(element, "Symbol")) {
    return convertElement(element, insideTextOnPath);
  }

  return convertElement(element, insideTextOnPath);
}

/**
 * Convert a React element tree rooted at a boundsvg phantom component into a VNode.
 *
 * ```tsx
 * const vnode = toVNode(
 *   <Canvas width={960} height={320}>
 *     <Flex direction="column" padding={40}>
 *       <Text font="NotoSansJP-woff2" fontSizePx={58}>Hello</Text>
 *     </Flex>
 *   </Canvas>
 * );
 * ```
 */
export function toVNode(element: BoundSvgElementFor<"Canvas">): VNodeFor<"Canvas">;
export function toVNode(element: BoundSvgElementFor<"Flex">): VNodeFor<"Flex">;
export function toVNode(element: BoundSvgElementFor<"Grid">): VNodeFor<"Grid">;
export function toVNode(element: BoundSvgElementFor<"Box">): VNodeFor<"Box">;
export function toVNode(element: BoundSvgElementFor<"Text">): VNodeFor<"Text">;
export function toVNode(element: BoundSvgElementFor<"TextOnPath">): VNodeFor<"TextOnPath">;
export function toVNode(element: BoundSvgElementFor<"Inline">): VNodeFor<"Inline">;
export function toVNode(element: BoundSvgElementFor<"InlineBox">): VNodeFor<"InlineBox">;
export function toVNode(element: BoundSvgElementFor<"InlineRect">): VNodeFor<"InlineRect">;
export function toVNode(element: BoundSvgElementFor<"Ruby">): VNodeFor<"Ruby">;
export function toVNode(element: BoundSvgElementFor<"Rt">): VNodeFor<"Rt">;
export function toVNode(element: BoundSvgElementFor<"Image">): VNodeFor<"Image">;
export function toVNode(element: BoundSvgElementFor<"Path">): VNodeFor<"Path">;
export function toVNode(element: BoundSvgElementFor<"Svg">): VNodeFor<"Svg">;
export function toVNode(element: BoundSvgElementFor<"Shape">): VNodeFor<"Shape">;
export function toVNode(element: BoundSvgElementFor<"Symbol">): VNodeFor<"Symbol">;
export function toVNode(element: ReactElement): VNode {
  if (!isBoundSvgElement(element)) {
    throw new Error(
      "[boundsvg] toVNode() requires a boundsvg element (Canvas, Flex, Grid, Box, Text, TextOnPath, Inline, InlineBox, InlineRect, Ruby, Rt, Image, Path, Svg, Shape, Symbol) as root.",
    );
  }
  return convertBoundSvgElement(element);
}

/**
 * Build a Canvas-rooted VNode from children and canvas props.
 * Used internally by `<BoundSvg>` when using the declarative API.
 *
 * ```tsx
 * <BoundSvg width={960} height={320} background="#0f172a">
 *   <Flex direction="column" padding={40}>
 *     <Text font="NotoSansJP-woff2" fontSizePx={58}>Hello</Text>
 *   </Flex>
 * </BoundSvg>
 * ```
 */
export function toVNodeFromChildren(
  canvasProps: { width: number; height: number; background?: string },
  children: ReactNode,
): VNode {
  return createCanvasVNode(canvasProps, collectChildren(children));
}
