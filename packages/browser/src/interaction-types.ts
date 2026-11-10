import type { IRSourceRef, SvgPoint } from "@boundsvg/core/scene";

/** Root-coordinate failure independent of hit absence. */
export type SvgCoordinateUnavailable = Readonly<{
  status: "unavailable";
  reason: "detached" | "coordinatesUnavailable";
}>;
/** A current hit query whose coordinates or native scope capability are unavailable. */
export type SvgQueryUnavailable =
  | SvgCoordinateUnavailable
  | Readonly<{ status: "unavailable"; reason: "hitTestUnavailable" }>;
/** Invalid input or a binding that does not match the mounted IR endpoints. */
export type SvgQueryFailure = Readonly<{
  status: "invalid";
  reason: "nonFiniteClientPoint" | "bindingMismatch";
}>;
/** Finite root coordinates or a reason why they cannot be obtained. */
export type SvgCoordinateResult =
  | Readonly<{ status: "ready"; point: SvgPoint }>
  | SvgCoordinateUnavailable
  | Readonly<{ status: "invalid"; reason: "nonFiniteClientPoint" }>;
/** Current source query; hit=null is the sole successful absence. */
export type SvgHitQueryResult =
  | Readonly<{ status: "ready"; point: SvgPoint; hit: IRSourceRef | null }>
  | SvgQueryUnavailable
  | SvgQueryFailure;
/** One committed hover projection, with unresolved and invalid states preserved. */
export type SvgHoverState =
  | Readonly<{ status: "inactive" | "pending" }>
  | Readonly<{ status: "ready"; source: IRSourceRef | null }>
  | SvgQueryUnavailable
  | SvgQueryFailure;

/** Snapshot-owned callback payload, distinguishing native input from scene reevaluation. */
export type PointerEventInfo = Readonly<{
  source: IRSourceRef;
  handlerName: string;
  nodeId: string;
  point: SvgPoint | null;
  pointerId: number | null;
}> &
  (
    | Readonly<{ cause: "input"; nativeEvent: PointerEvent | MouseEvent }>
    | Readonly<{ cause: "scene"; nativeEvent: null }>
  );
/** Callback for one source-owned event reference. */
export type EventCallback = (info: PointerEventInfo) => void;

/** JSX event references or callbacks resolved into the same source-owned handler table. */
export type InteractiveHandlerProps = {
  // Discrete actions
  onClick?: EventCallback | string;
  onDoubleClick?: EventCallback | string;
  onContextMenu?: EventCallback | string;

  // Pointer
  onPointerDown?: EventCallback | string;
  onPointerUp?: EventCallback | string;
  onPointerCancel?: EventCallback | string;
  onPointerMove?: EventCallback | string;
  onPointerEnter?: EventCallback | string;
  onPointerLeave?: EventCallback | string;
  onPointerOver?: EventCallback | string;
  onPointerOut?: EventCallback | string;

  // Mouse
  onMouseDown?: EventCallback | string;
  onMouseUp?: EventCallback | string;
  onMouseMove?: EventCallback | string;
  onMouseEnter?: EventCallback | string;
  onMouseLeave?: EventCallback | string;
  onMouseOver?: EventCallback | string;
  onMouseOut?: EventCallback | string;

  // Touch
  onTouchStart?: EventCallback | string;
  onTouchEnd?: EventCallback | string;
  onTouchMove?: EventCallback | string;
};

/** Native Text witness and a point usable only with the matching sampled TextMap. */
export type TextContextMenuHit = Readonly<{
  source: IRSourceRef;
  point: SvgPoint | null;
  clientX: number;
  clientY: number;
}>;
