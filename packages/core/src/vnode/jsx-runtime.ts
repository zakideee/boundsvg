import {
  type AnyFunctionComponent,
  createElement,
  type FunctionComponentInputProps,
  invokeFunctionComponent,
  normalizeLooseChildren,
} from "./create-element.js";
import type { PropsFor, VNode, VNodeChild, VNodeFor, VNodeType } from "./types.js";

/** Fragment symbol — converts to a flat children array */
export const Fragment: unique symbol = Symbol.for("boundsvg.Fragment") as never;

/** Tag types accepted by the JSX runtime */
type JsxElementType = VNodeType | AnyFunctionComponent | typeof Fragment;

/**
 * Shared implementation behind `jsx`, `jsxs`, and `jsxDEV`.
 * Fragments flatten to a children array; function components are invoked.
 */
export function createJsxElement(
  type: JsxElementType,
  props: FunctionComponentInputProps | null,
  key?: string | number,
): VNode | Array<VNode | string> {
  if (type === Fragment) {
    const fragmentChildren = props?.children;
    return normalizeLooseChildren(fragmentChildren === undefined ? [] : [fragmentChildren]);
  }

  const merged = key != null ? { ...props, key } : props;
  if (typeof type === "function") {
    return invokeFunctionComponent(type, merged, []);
  }

  // VNodeFor<VNodeType> does not distribute over the union — narrow back to VNode
  return createElement(
    type,
    merged as (PropsFor<VNodeType> & { key?: string | number }) | null,
  ) as VNode;
}

/**
 * JSX automatic runtime — `jsx` factory.
 * Called by the compiler for elements with a single child.
 */
export function jsx<T extends VNodeType>(
  type: T,
  props: PropsFor<T>,
  key?: string | number,
): VNodeFor<T>;

export function jsx<P extends object, R extends VNode>(
  type: (props: P, ...children: never[]) => R,
  props: P,
  key?: string | number,
): R;

export function jsx(
  type: typeof Fragment,
  props: { children?: VNodeChild },
  key?: string | number,
): Array<VNode | string>;

export function jsx(
  type: JsxElementType,
  props: FunctionComponentInputProps | null,
  key?: string | number,
): VNode | Array<VNode | string> {
  return createJsxElement(type, props, key);
}

/**
 * JSX automatic runtime — `jsxs` factory.
 * Called by the compiler for elements with static (multiple) children.
 */
export function jsxs<T extends VNodeType>(
  type: T,
  props: PropsFor<T>,
  key?: string | number,
): VNodeFor<T>;

export function jsxs<P extends object, R extends VNode>(
  type: (props: P, ...children: never[]) => R,
  props: P,
  key?: string | number,
): R;

export function jsxs(
  type: typeof Fragment,
  props: { children?: VNodeChild },
  key?: string | number,
): Array<VNode | string>;

export function jsxs(
  type: JsxElementType,
  props: FunctionComponentInputProps | null,
  key?: string | number,
): VNode | Array<VNode | string> {
  return createJsxElement(type, props, key);
}

/**
 * JSX type contract for `jsxImportSource: "@boundsvg/core"`.
 *
 * No `IntrinsicElements` on purpose — lowercase tags are not part of the
 * public API; only exported components and user function components are valid.
 */
// biome-ignore lint/style/useNamingConvention: TypeScript resolves the JSX type contract by this exact name
export namespace JSX {
  /** Type of a JSX expression */
  export type Element = VNode;
  /** Valid JSX tag types: function components and Fragment */
  export type ElementType = AnyFunctionComponent | typeof Fragment;
  /** Marks `children` as the prop populated by JSX child expressions */
  export type ElementChildrenAttribute = { children: unknown };
  /** Attributes handled by the JSX runtime itself, not by components */
  export type IntrinsicAttributes = { key?: string | number };
}

// Re-export types needed by JSX consumers
export type { VNode, VNodeType };
