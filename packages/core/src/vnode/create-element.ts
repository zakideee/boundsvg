import { FatalError } from "../errors.js";
import type {
  ChildrenFor,
  NormalizedPropsFor,
  PropsFor,
  VNode,
  VNodeChild,
  VNodeChildrenArgs,
  VNodeFor,
  VNodeInputChildFor,
  VNodeType,
} from "./types.js";

/** Widest function-component type — `never` parameters accept any concrete component signature */
export type AnyFunctionComponent = (props: never, ...children: never[]) => VNode;

/** Invocable view of a function component — the public overloads guarantee the actual props shape */
type InvocableFunctionComponent = (
  props: Record<string, unknown>,
  ...children: Array<VNode | string>
) => VNode;

/** Loose input props accepted when `type` is a function component */
export type FunctionComponentInputProps = Record<string, unknown> & {
  key?: string | number;
  children?: VNodeChild;
};

type PropsChildrenFor<T extends VNodeType> =
  PropsFor<T> extends { children?: infer C } ? C : undefined;

type ElementInputProps<T extends VNodeType> = NormalizedPropsFor<T> & {
  children?: PropsChildrenFor<T>;
  key?: string | number;
};

type SplitElementInput<T extends VNodeType> = {
  key: string | number | undefined;
  props: NormalizedPropsFor<T>;
  propsChildren: PropsChildrenFor<T> | undefined;
  argChildren: VNodeChildrenArgs<T>;
};

const normalizedChildContainerWithUnsupportedTextOnPathPrimitive = new WeakSet<object>();

function hasUnsupportedTextOnPathPrimitive(raw: readonly unknown[]): boolean {
  for (const child of raw) {
    if (child == null || typeof child === "boolean" || typeof child === "number") {
      return true;
    }
    if (Array.isArray(child)) {
      if (
        normalizedChildContainerWithUnsupportedTextOnPathPrimitive.has(child) ||
        hasUnsupportedTextOnPathPrimitive(child)
      ) {
        return true;
      }
      continue;
    }
    if (
      typeof child === "object" &&
      normalizedChildContainerWithUnsupportedTextOnPathPrimitive.has(child)
    ) {
      return true;
    }
  }
  return false;
}

function unsupportedTextOnPathChildError(): FatalError {
  return new FatalError(
    "TEXT_PATH_CHILD_UNSUPPORTED",
    "TextOnPath children must be strings or Inline nodes.",
    { stage: "validate", nodeId: "<TextOnPath>" },
  );
}

/**
 * Flatten and filter children into a clean array of VNode | string.
 * Discards null, undefined, and boolean values.
 * Converts numbers to strings.
 */
function normalizeChildren<T extends VNodeType>(raw: readonly unknown[]): ChildrenFor<T> {
  const result: Array<ChildrenFor<T>[number]> = [];

  for (const child of raw) {
    if (child == null || typeof child === "boolean") {
      continue;
    }
    if (Array.isArray(child)) {
      result.push(...normalizeChildren(child));
    } else if (typeof child === "number") {
      result.push(String(child) as ChildrenFor<T>[number]);
    } else {
      result.push(child as ChildrenFor<T>[number]);
    }
  }

  return result as ChildrenFor<T>;
}

/** Normalize loose (untyped) children — flattens arrays, drops null/boolean, stringifies numbers */
export function normalizeLooseChildren(raw: VNodeChild[]): Array<VNode | string> {
  // "Canvas" instantiates ChildFor to the widest child union (VNode | string)
  const normalized = normalizeChildren<"Canvas">(raw);
  if (hasUnsupportedTextOnPathPrimitive(raw)) {
    normalizedChildContainerWithUnsupportedTextOnPathPrimitive.add(normalized);
  }
  return normalized;
}

/**
 * Invoke a function component with the `(props, ...children)` convention:
 * `key` and `children` are stripped from props, children are normalized and
 * passed as rest arguments, and a JSX `key` is attached to the returned VNode.
 */
export function invokeFunctionComponent(
  component: AnyFunctionComponent,
  props: FunctionComponentInputProps | null,
  argChildren: VNodeChild[],
): VNode {
  const { key, children: propsChildren, ...componentProps } = props ?? {};
  const rawChildren =
    argChildren.length > 0 ? argChildren : propsChildren === undefined ? [] : [propsChildren];
  const hasUnsupportedPrimitive = hasUnsupportedTextOnPathPrimitive(rawChildren);
  const normalizedChildren = normalizeLooseChildren(rawChildren);
  const rendered = (component as InvocableFunctionComponent)(componentProps, ...normalizedChildren);
  const keyedRendered = key != null && rendered.key == null ? { ...rendered, key } : rendered;

  if (
    keyedRendered !== rendered &&
    normalizedChildContainerWithUnsupportedTextOnPathPrimitive.has(rendered)
  ) {
    normalizedChildContainerWithUnsupportedTextOnPathPrimitive.add(keyedRendered);
  }

  if (hasUnsupportedPrimitive) {
    if (keyedRendered.type === "TextOnPath") {
      throw unsupportedTextOnPathChildError();
    }
    if (keyedRendered.type === "Inline") {
      normalizedChildContainerWithUnsupportedTextOnPathPrimitive.add(keyedRendered);
    }
  }
  return keyedRendered;
}

function hasPropsChildren<T extends VNodeType>(
  value: PropsChildrenFor<T> | undefined,
): value is Exclude<PropsChildrenFor<T>, undefined> {
  return value !== undefined;
}

function isArrayPropsChildren<T extends VNodeType>(
  value: Exclude<PropsChildrenFor<T>, undefined>,
): value is Extract<Exclude<PropsChildrenFor<T>, undefined>, VNodeInputChildFor<T>[]> {
  return Array.isArray(value);
}

function toRawChildArray<T extends VNodeType>(
  value: Exclude<PropsChildrenFor<T>, undefined>,
): VNodeInputChildFor<T>[] {
  if (isArrayPropsChildren(value)) {
    return value;
  }

  return [value as VNodeInputChildFor<T>];
}

function resolveRawChildren<T extends VNodeType>(
  argChildren: VNodeChildrenArgs<T>,
  propsChildren: PropsChildrenFor<T> | undefined,
): VNodeInputChildFor<T>[] {
  if (argChildren.length > 0) {
    return [...argChildren] as VNodeInputChildFor<T>[];
  }
  if (!hasPropsChildren(propsChildren)) {
    return [];
  }

  return toRawChildArray(propsChildren);
}

function splitElementInput<T extends VNodeType>(
  props: ElementInputProps<T> | null,
  argChildren: VNodeChildrenArgs<T>,
): SplitElementInput<T> {
  if (props == null) {
    return {
      key: undefined,
      props: {} as NormalizedPropsFor<T>,
      propsChildren: undefined,
      argChildren,
    };
  }

  const { key, children: propsChildren, ...restProps } = props;
  return {
    key,
    props: restProps as NormalizedPropsFor<T>,
    propsChildren,
    argChildren,
  };
}

/**
 * Create a VNode from a component type, props, and children.
 *
 * This is the manual `createElement` API — typically you use
 * JSX (`jsx`/`jsxs`) which call this internally.
 *
 * When `type` is a function component, it is invoked with
 * `(props, ...children)` and its VNode result is returned.
 */
export function createElement<T extends VNodeType>(
  type: T,
  props: (PropsFor<T> & { key?: string | number }) | null,
): VNodeFor<T>;

export function createElement<T extends VNodeType>(
  type: T,
  props: (PropsFor<T> & { key?: string | number }) | null,
  ...children: VNodeChildrenArgs<T>
): VNodeFor<T>;

export function createElement<P extends object, R extends VNode>(
  type: (props: P, ...children: never[]) => R,
  props: (P & { key?: string | number }) | null,
  ...children: VNodeChild[]
): R;

export function createElement<T extends VNodeType>(
  type: T | AnyFunctionComponent,
  props: ElementInputProps<T> | FunctionComponentInputProps | null,
  ...children: VNodeChildrenArgs<T> | VNodeChild[]
): VNodeFor<T> | VNode {
  if (typeof type === "function") {
    return invokeFunctionComponent(
      type,
      props as FunctionComponentInputProps | null,
      children as VNodeChild[],
    );
  }

  const {
    key,
    props: normalizedProps,
    propsChildren,
    argChildren,
  } = splitElementInput(props as ElementInputProps<T> | null, children as VNodeChildrenArgs<T>);
  const rawChildren = resolveRawChildren(argChildren, propsChildren);
  const hasUnsupportedPrimitive = hasUnsupportedTextOnPathPrimitive(rawChildren);
  if (type === "TextOnPath" && hasUnsupportedPrimitive) {
    throw unsupportedTextOnPathChildError();
  }
  const normalizedChildren = normalizeChildren(rawChildren);

  const node = (
    key != null
      ? {
          type,
          props: normalizedProps,
          children: normalizedChildren,
          key,
        }
      : {
          type,
          props: normalizedProps,
          children: normalizedChildren,
        }
  ) as VNodeFor<T>;
  if (type === "Inline" && hasUnsupportedPrimitive) {
    normalizedChildContainerWithUnsupportedTextOnPathPrimitive.add(node);
  }
  return node;
}
