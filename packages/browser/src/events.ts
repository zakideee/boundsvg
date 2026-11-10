export type {
  EventCallback,
  InteractiveHandlerProps,
  PointerEventInfo,
  SvgCoordinateResult,
  SvgCoordinateUnavailable,
  SvgHitQueryResult,
  SvgHoverState,
  SvgQueryFailure,
  SvgQueryUnavailable,
  TextContextMenuHit,
} from "./interaction-types.js";
export type { IRDomBinding } from "./ir-dom-binding.js";
export { bindIRToSvg } from "./ir-dom-binding.js";
export { queryCurrentSvgHit, translateSvgCoords } from "./svg-event-utils.js";
export type {
  SvgInteractionController,
  SvgInteractionScene,
} from "./svg-interaction-controller.js";
export { createSvgInteractionController } from "./svg-interaction-controller.js";
