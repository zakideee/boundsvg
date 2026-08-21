import type { VNodeType } from "@boundsvg/core";
import type { ReactElement } from "react";

type BoundSvgElementType = {
  __boundsvgNodeType: VNodeType;
};

function isBoundSvgElementType(value: unknown): value is BoundSvgElementType {
  return (
    (typeof value === "function" || typeof value === "object") &&
    value !== null &&
    "__boundsvgNodeType" in value &&
    typeof value.__boundsvgNodeType === "string"
  );
}

/**
 * Check whether a React element's `type` is a boundsvg phantom component
 * (i.e. has a `__boundsvgNodeType` string property).
 */
export function getNodeType(element: ReactElement): VNodeType | undefined {
  const { type } = element;
  if (isBoundSvgElementType(type)) {
    return type.__boundsvgNodeType;
  }
  return undefined;
}
