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
import type { EventCallback } from "../types.js";
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
type HandlerKey = keyof Pick<
  PropsWithoutChildren<"Canvas">,
  | "onClick"
  | "onDoubleClick"
  | "onContextMenu"
  | "onPointerDown"
  | "onPointerUp"
  | "onPointerCancel"
  | "onPointerMove"
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerOver"
  | "onPointerOut"
  | "onMouseDown"
  | "onMouseUp"
  | "onMouseMove"
  | "onMouseEnter"
  | "onMouseLeave"
  | "onMouseOver"
  | "onMouseOut"
  | "onTouchStart"
  | "onTouchEnd"
  | "onTouchMove"
>;
type HandlerPropKey<T extends VNodeType> = Extract<keyof PropsWithoutChildren<T>, HandlerKey>;
type IdProps<T extends VNodeType> = Partial<
  Pick<PropsWithoutChildren<T>, Extract<keyof PropsWithoutChildren<T>, "id">>
>;

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

function createUnsupportedInteractiveChildError(value: ReactElement): Error {
  return new Error(
    `[boundsvg] Unsupported React element <${getElementDisplayName(value)}> inside declarative interactive boundsvg content. ` +
      "Only boundsvg components (Canvas, Flex, Grid, Box, Text, TextOnPath, Inline, InlineBox, InlineRect, Ruby, Rt, Image, Path, Svg, Shape, Symbol) " +
      "are supported. Inline helper components by calling them as functions before passing their result to <InteractiveBoundSvg>.",
  );
}

function createTextOnPathChildError(): FatalError {
  return new FatalError(
    "TEXT_PATH_CHILD_UNSUPPORTED",
    "TextOnPath children must be strings or Inline nodes.",
    { stage: "validate", nodeId: "<TextOnPath>" },
  );
}

const EVENT_KEYS = [
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
] as const;
const EVENT_KEY_SET = new Set<string>(EVENT_KEYS);

/** Result of converting a React element tree with interactive handler extraction */
export type ToInteractiveVNodeResult<T = VNode> = {
  /** VNode tree with function handlers replaced by stable string IDs */
  vnode: T;
  /** Map from handler ID (`nodeId#eventName`) → callback function */
  handlers: Map<string, EventCallback>;
};

/**
 * Resolve the node ID for handler mapping.
 * Uses explicit `id` prop if available, otherwise generates a positional auto-ID.
 * Warns in dev mode when interactive handlers are attached without an explicit `id`.
 */
function resolveNodeId(
  props: { id?: string | undefined },
  {
    parentPath,
    siblingIndex,
    hasHandlers,
  }: {
    parentPath: string;
    siblingIndex: number;
    hasHandlers: boolean;
  },
): string {
  const explicitId = props.id;
  if (typeof explicitId === "string" && explicitId.length > 0) {
    return explicitId;
  }

  const autoId = parentPath ? `auto:${parentPath}.${siblingIndex}` : `auto:${siblingIndex}`;

  if (hasHandlers && typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    console.warn(
      `[boundsvg] Interactive handler on node "${autoId}" without explicit id. ` +
        "Auto-generated IDs are positional and may change when siblings are added/removed. " +
        'Set an explicit id prop (e.g. id="my-button") for stable event targeting.',
    );
  }

  return autoId;
}

/**
 * Convert a single React element into a VNode, extracting function event handlers.
 */
function convertElement<T extends VNodeType>(
  element: BoundSvgElementFor<T>,
  {
    parentPath,
    siblingIndex,
    handlers,
    warnNonBoundsvg,
    insideTextOnPath = false,
  }: {
    parentPath: string;
    siblingIndex: number;
    handlers: Map<string, EventCallback>;
    warnNonBoundsvg: boolean;
    insideTextOnPath?: boolean;
  },
): VNodeFor<T> {
  const nodeType = element.type.__boundsvgNodeType;
  const elementProps = element.props as BoundSvgNodePropsFor<T> & {
    children?: ReactNode;
  };
  const children = elementProps.children;
  const rest = { ...elementProps };
  delete rest.children;
  const props: Partial<PropsWithoutChildren<T>> = {};
  const pendingHandlers: Array<[HandlerKey, EventCallback]> = [];

  for (const [key, value] of getDefinedEntries(rest as ElementPropsWithoutChildren<T>)) {
    if (EVENT_KEY_SET.has(key as string) && typeof value === "function") {
      pendingHandlers.push([key as HandlerKey, value as EventCallback]);
    } else {
      assignElementProp(props, key, value);
    }
  }

  if (pendingHandlers.length > 0) {
    const nodeId = resolveNodeId(props as IdProps<T>, {
      parentPath,
      siblingIndex,
      hasHandlers: true,
    });
    for (const [eventName, callback] of pendingHandlers) {
      const handlerId = `${nodeId}#${eventName}`;
      handlers.set(handlerId, callback);
      props[eventName as HandlerPropKey<T>] =
        handlerId as PropsWithoutChildren<T>[HandlerPropKey<T>];
    }
  }

  const currentPath =
    "id" in props && typeof props.id === "string"
      ? props.id
      : parentPath
        ? `${parentPath}.${siblingIndex}`
        : String(siblingIndex);

  const vnode = createVNodeFromParts(
    nodeType,
    finalizeProps(props),
    collectChildrenInner(children, {
      parentPath: currentPath,
      handlers,
      warnNonBoundsvg,
      insideTextOnPath: insideTextOnPath || nodeType === "TextOnPath",
    }),
  );

  if (element.key != null) {
    vnode.key = element.key as string | number;
  }

  return vnode;
}

function convertBoundSvgElement(
  element: AnyBoundSvgElement,
  context: {
    parentPath: string;
    siblingIndex: number;
    handlers: Map<string, EventCallback>;
    warnNonBoundsvg: boolean;
    insideTextOnPath?: boolean;
  },
): VNode {
  if (hasNodeType(element, "Canvas")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Flex")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Grid")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Box")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Text")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "TextOnPath")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Inline")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "InlineBox")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "InlineRect")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Ruby")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Rt")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Image")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Path")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Shape")) {
    return convertElement(element, context);
  }
  if (hasNodeType(element, "Symbol")) {
    return convertElement(element, context);
  }

  return convertElement(element, context);
}

/**
 * Normalize a single React child into a VNode or string, extracting event handlers.
 * Returns undefined for children that should be skipped (null, boolean, unknown elements).
 * Returns { result, incrementIndex } for element children that consume a sibling index.
 */
function normalizeInteractiveChild(
  child: Exclude<ReactNode, null | undefined>,
  {
    parentPath,
    siblingIndex,
    handlers,
    warnNonBoundsvg,
    collectFn,
    insideTextOnPath = false,
  }: {
    parentPath: string;
    siblingIndex: number;
    handlers: Map<string, EventCallback>;
    warnNonBoundsvg: boolean;
    insideTextOnPath?: boolean;
    collectFn: (
      children: ReactNode,
      context: {
        parentPath: string;
        handlers: Map<string, EventCallback>;
        warnNonBoundsvg: boolean;
        insideTextOnPath?: boolean;
      },
    ) => (VNode | string)[];
  },
): { items: VNode | string | (VNode | string)[]; incrementIndex: boolean } | undefined {
  if (typeof child === "boolean") {
    if (insideTextOnPath) {
      throw createTextOnPathChildError();
    }
    return undefined;
  }
  if (typeof child === "string") {
    return { items: child, incrementIndex: false };
  }
  if (typeof child === "number") {
    if (insideTextOnPath) {
      throw createTextOnPathChildError();
    }
    return { items: String(child), incrementIndex: false };
  }

  if (isValidElement(child)) {
    if (child.type === Fragment) {
      return {
        items: collectFn(getFragmentChildren(child), {
          parentPath,
          handlers,
          warnNonBoundsvg,
          insideTextOnPath,
        }),
        incrementIndex: false,
      };
    }

    if (isBoundSvgElement(child)) {
      return {
        items: convertBoundSvgElement(child, {
          parentPath,
          siblingIndex,
          handlers,
          warnNonBoundsvg,
          insideTextOnPath,
        }),
        incrementIndex: true,
      };
    }

    throw createUnsupportedInteractiveChildError(child);
  }

  if (insideTextOnPath) {
    throw createTextOnPathChildError();
  }
  return undefined;
}

/**
 * Walk React children and collect VNode / string entries, extracting event handlers.
 */
function collectChildrenInner(
  children: ReactNode,
  context: {
    parentPath: string;
    handlers: Map<string, EventCallback>;
    warnNonBoundsvg: boolean;
    insideTextOnPath?: boolean;
  },
): (VNode | string)[] {
  const { parentPath, handlers, warnNonBoundsvg, insideTextOnPath = false } = context;
  const result: (VNode | string)[] = [];
  let index = 0;

  Children.forEach(children, (child) => {
    if (child == null) {
      if (insideTextOnPath) {
        throw createTextOnPathChildError();
      }
      return;
    }
    const normalized = normalizeInteractiveChild(child, {
      parentPath,
      siblingIndex: index,
      handlers,
      warnNonBoundsvg,
      insideTextOnPath,
      collectFn: collectChildrenInner,
    });
    if (!normalized) {
      return;
    }
    if (Array.isArray(normalized.items)) {
      result.push(...normalized.items);
    } else {
      result.push(normalized.items);
    }
    if (normalized.incrementIndex) {
      index++;
    }
  });

  return result;
}

/**
 * Convert a React element tree rooted at a boundsvg phantom component into a VNode,
 * extracting function event handlers into a separate Map.
 *
 * Handler IDs use the stable format `nodeId#eventName` (e.g. `"my-button#onClick"`).
 * String handlers are passed through unchanged.
 *
 * ```tsx
 * const { vnode, handlers } = toInteractiveVNode(
 *   <Canvas width={960} height={320}>
 *     <Text id="btn" font="F" fontSizePx={24}
 *           onClick={(info) => console.log(info.nodeId)}>
 *       Click me
 *     </Text>
 *   </Canvas>
 * );
 * ```
 */
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Canvas">,
): ToInteractiveVNodeResult<VNodeFor<"Canvas">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Flex">,
): ToInteractiveVNodeResult<VNodeFor<"Flex">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Grid">,
): ToInteractiveVNodeResult<VNodeFor<"Grid">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Box">,
): ToInteractiveVNodeResult<VNodeFor<"Box">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Text">,
): ToInteractiveVNodeResult<VNodeFor<"Text">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"TextOnPath">,
): ToInteractiveVNodeResult<VNodeFor<"TextOnPath">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Inline">,
): ToInteractiveVNodeResult<VNodeFor<"Inline">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"InlineBox">,
): ToInteractiveVNodeResult<VNodeFor<"InlineBox">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"InlineRect">,
): ToInteractiveVNodeResult<VNodeFor<"InlineRect">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Ruby">,
): ToInteractiveVNodeResult<VNodeFor<"Ruby">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Rt">,
): ToInteractiveVNodeResult<VNodeFor<"Rt">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Image">,
): ToInteractiveVNodeResult<VNodeFor<"Image">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Path">,
): ToInteractiveVNodeResult<VNodeFor<"Path">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Svg">,
): ToInteractiveVNodeResult<VNodeFor<"Svg">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Shape">,
): ToInteractiveVNodeResult<VNodeFor<"Shape">>;
export function toInteractiveVNode(
  element: BoundSvgElementFor<"Symbol">,
): ToInteractiveVNodeResult<VNodeFor<"Symbol">>;
export function toInteractiveVNode(element: ReactElement): ToInteractiveVNodeResult {
  const handlers = new Map<string, EventCallback>();

  if (!isBoundSvgElement(element)) {
    throw new Error(
      "[boundsvg] toInteractiveVNode() requires a boundsvg element (Canvas, Flex, Grid, Box, Text, TextOnPath, Inline, InlineBox, InlineRect, Ruby, Rt, Image, Path, Svg, Shape, Symbol) as root.",
    );
  }

  const vnode = convertBoundSvgElement(element, {
    parentPath: "",
    siblingIndex: 0,
    handlers,
    warnNonBoundsvg: true,
  });
  return { vnode, handlers };
}

/**
 * Build a Canvas-rooted VNode from children and canvas props,
 * extracting function event handlers.
 *
 * Used internally by `<InteractiveBoundSvg>` for the declarative API.
 */
export function toInteractiveVNodeFromChildren(
  canvasProps: { width: number; height: number; background?: string },
  children: ReactNode,
): ToInteractiveVNodeResult {
  const handlers = new Map<string, EventCallback>();

  const vnode = createCanvasVNode(
    canvasProps,
    collectChildrenInner(children, { parentPath: "", handlers, warnNonBoundsvg: false }),
  );

  return { vnode, handlers };
}
