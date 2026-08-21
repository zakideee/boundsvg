import type { FunctionComponentInputProps } from "./create-element.js";
import { createJsxElement, Fragment } from "./jsx-runtime.js";
import type { PropsFor, VNode, VNodeChild, VNodeFor, VNodeType } from "./types.js";

/** Tag types accepted by the JSX dev runtime */
type JsxDevElementType = Parameters<typeof createJsxElement>[0];

/**
 * JSX automatic runtime — dev-mode `jsxDEV` factory.
 * Extra dev-only arguments (isStaticChildren, source, self) are ignored.
 */
export function jsxDEV<T extends VNodeType>(
  type: T,
  props: PropsFor<T>,
  key?: string | number,
): VNodeFor<T>;

export function jsxDEV<P extends object, R extends VNode>(
  type: (props: P, ...children: never[]) => R,
  props: P,
  key?: string | number,
): R;

export function jsxDEV(
  type: typeof Fragment,
  props: { children?: VNodeChild },
  key?: string | number,
): Array<VNode | string>;

export function jsxDEV(
  type: JsxDevElementType,
  props: FunctionComponentInputProps | null,
  key?: string | number,
): VNode | Array<VNode | string> {
  return createJsxElement(type, props, key);
}

export { Fragment };
export type { JSX } from "./jsx-runtime.js";
