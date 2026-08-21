import type { HandlersRef } from "./types.js";

/** Position within the VNode tree, used for auto-generating node IDs. */
export type NodePosition = {
  depth: number;
  siblingIndex: number;
  parentNodeId?: string;
};

/** Authoring-side event-handler keys consumed while building layout input. */
export const HANDLER_KEYS: readonly (keyof HandlersRef)[] = [
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
];
