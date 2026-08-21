// @boundsvg/react/interactive — Interactive SVG components, hooks, and event types

export type { InteractiveBoundSvgProps } from "./components/interactive-boundsvg.js";
export { InteractiveBoundSvg } from "./components/interactive-boundsvg.js";
export type {
  TextContextMenuHit,
  UseInteractiveSvgOptions,
  UseInteractiveSvgResult,
} from "./hooks/use-interactive-svg.js";
export { useInteractiveSvg } from "./hooks/use-interactive-svg.js";
export type {
  BuildMenuInfoParams,
  CopyStatus,
  SvgPoint,
  TextCopyMenuInfo,
  UseTextCopyResult,
} from "./hooks/use-text-copy.js";
export { useTextCopy } from "./hooks/use-text-copy.js";
export type {
  EventCallback,
  InteractiveHandlerProps,
  PointerEventInfo,
} from "./types.js";
export type { ToInteractiveVNodeResult } from "./utils/to-interactive-vnode.js";
export {
  toInteractiveVNode,
  toInteractiveVNodeFromChildren,
} from "./utils/to-interactive-vnode.js";
