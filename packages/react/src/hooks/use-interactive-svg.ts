import {
  resolveHitTarget as resolveHitTargetBrowser,
  translateSvgCoords,
} from "@boundsvg/browser/events";
import type { IR, RenderOptions, VNode } from "@boundsvg/core";
import {
  buildHandlerMap,
  buildHitTestIndex,
  buildNodeTypeMap,
  buildTextMap,
  type HandlersRef,
  hitTestCandidates,
  type IRNodeType,
  type SpatialIndex,
  type TextMap,
} from "@boundsvg/core/scene";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EventCallback, PointerEventInfo } from "../types.js";
import { resolveMainThreadEngineError } from "../utils/main-thread-only.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./use-commit-phase-render-notifications.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./use-structurally-stable-value.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Info passed when a text node is right-clicked without a user-defined onContextMenu handler */
export type TextContextMenuHit = {
  nodeId: string;
  svgX: number;
  svgY: number;
  clientX: number;
  clientY: number;
};

export type UseInteractiveSvgOptions = {
  /** Render options passed to the engine */
  renderOptions?: RenderOptions;
  /** Whether to show cursor:pointer on interactive elements (default: true) */
  showPointerCursor?: boolean;
  /** When true, right-click on text nodes fires onTextContextMenu instead of browser default */
  enableTextCopy?: boolean;
  /** Callback fired when a text node is right-clicked (requires enableTextCopy) */
  onTextContextMenu?: (hit: TextContextMenuHit) => void;
};

export type UseInteractiveSvgResult = {
  /** Rendered SVG string (null while engine is not ready or on error) */
  svg: string | null;
  /** Full IR for advanced consumers (null while not ready) */
  ir: IR | null;
  /** Text structure map for text copy features (null while not ready) */
  textMap: TextMap | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether the engine is ready and rendering succeeded */
  isReady: boolean;
  /** The nodeId currently hovered, or null */
  hoverNodeId: string | null;
  /** Ref callback to attach to the container div */
  containerRef: (node: HTMLDivElement | null) => void;
};

// ---------------------------------------------------------------------------
// Internal render artifacts
// ---------------------------------------------------------------------------

type RenderArtifacts = {
  svg: string | null;
  ir: IR | null;
  spatialIndex: SpatialIndex | null;
  handlerMap: Map<string, HandlersRef> | null;
  nodeTypeMap: Map<string, IRNodeType> | null;
  textMap: TextMap | null;
  error: Error | null;
  isReady: boolean;
};

const EMPTY_ARTIFACTS: RenderArtifacts = {
  svg: null,
  ir: null,
  spatialIndex: null,
  handlerMap: null,
  nodeTypeMap: null,
  textMap: null,
  error: null,
  isReady: false,
};

type InteractiveRenderComputation = {
  artifacts: RenderArtifacts;
  deliveries: readonly RenderNotificationDelivery[];
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInteractiveSvg(
  vnode: VNode | null,
  handlers: Map<string, EventCallback>,
  options?: UseInteractiveSvgOptions,
): UseInteractiveSvgResult {
  const { engine, workerEngine, status, defaultRenderOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableRenderOptions = useStructurallyStableRenderOptions(options?.renderOptions);
  const stableDefaultRenderOptions = useStructurallyStableRenderOptions(defaultRenderOptions);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  // Memoize render artifacts — uses engine.renderToSvgAndIR() for single layout pass
  const computation = useMemo<InteractiveRenderComputation>(() => {
    if (status !== "ready" || !engine || !stableVNode) {
      const error = resolveMainThreadEngineError("useInteractiveSvg", {
        status,
        engine,
        workerEngine,
      });
      return {
        artifacts: error ? { ...EMPTY_ARTIFACTS, error } : EMPTY_ARTIFACTS,
        deliveries: NO_RENDER_NOTIFICATION_DELIVERIES,
      };
    }
    const mergedOptions = { ...stableDefaultRenderOptions, ...stableRenderOptions };
    const captured = captureRenderNotifications(mergedOptions);
    try {
      const { svg, ir } = engine.renderToSvgAndIR(stableVNode, captured.options);
      const spatialIndex = buildHitTestIndex(ir);
      const handlerMap = buildHandlerMap(ir);
      const nodeTypeMap = buildNodeTypeMap(ir);
      const textMap = buildTextMap(ir);
      return {
        artifacts: {
          svg,
          ir,
          spatialIndex,
          handlerMap,
          nodeTypeMap,
          textMap,
          error: null,
          isReady: true,
        },
        deliveries: [captured.delivery],
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        artifacts: { ...EMPTY_ARTIFACTS, error },
        deliveries: [captured.delivery],
      };
    }
  }, [engine, workerEngine, status, stableVNode, stableRenderOptions, stableDefaultRenderOptions]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  const artifacts = computation.artifacts;

  // Store latest handlers & artifacts in refs to avoid closure staleness
  const handlersRef = useRef(handlers);
  const artifactsRef = useRef(artifacts);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
    artifactsRef.current = artifacts;
  }, [artifacts, handlers]);

  // Track current hover node for enter/leave detection
  const hoverRef = useRef<string | null>(null);

  // A pointer gesture can outlive a listener-effect instance when interactive
  // options change. Keep its original down target until the gesture terminates.
  const activePointerTargetsRef = useRef(new Map<number, string>());

  const showPointerCursor = options?.showPointerCursor !== false;
  const enableTextCopy = options?.enableTextCopy === true;

  const onTextContextMenuRef = useRef(options?.onTextContextMenu);
  useLayoutEffect(() => {
    onTextContextMenuRef.current = options?.onTextContextMenu;
  }, [options?.onTextContextMenu]);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      activePointerTargetsRef.current.clear();
    },
    [],
  );

  // rAF throttle ref for pointermove
  const rafRef = useRef<number>(0);

  // Attach / detach DOM event listeners
  useEffect(() => {
    const container = containerEl;
    if (!container || !artifacts.isReady) {
      return;
    }
    const activePointerTargets = activePointerTargetsRef.current;

    /**
     * Translate DOM pointer coordinates to SVG user-space coordinates.
     * Delegates to @boundsvg/browser for CTM-based transform, then
     * falls back to getBoundingClientRect-based scaling.
     */
    function translateCoords(e: MouseEvent | PointerEvent): { svgX: number; svgY: number } | null {
      if (!container) {
        return null;
      }
      const svgEl = container.querySelector("svg");
      if (svgEl) {
        const result = translateSvgCoords(svgEl, e.clientX, e.clientY);
        if (result) {
          return { svgX: result.x, svgY: result.y };
        }
      }

      // Fallback: manual BoundingClientRect scaling
      const rect = container.getBoundingClientRect();
      const { ir } = artifactsRef.current;
      if (!ir || rect.width === 0 || rect.height === 0) {
        return null;
      }
      const scaleX = ir.width / rect.width;
      const scaleY = ir.height / rect.height;
      return {
        svgX: (e.clientX - rect.left) * scaleX,
        svgY: (e.clientY - rect.top) * scaleY,
      };
    }

    /** Resolve the actual hit target from bbox candidates. */
    function resolveHitTarget(
      candidates: string[],
      nativeEvent: MouseEvent | PointerEvent,
    ): string | null {
      const { nodeTypeMap } = artifactsRef.current;
      if (!nodeTypeMap || !container) {
        return candidates[0] ?? null;
      }
      return resolveHitTargetBrowser(
        container,
        candidates,
        nodeTypeMap,
        nativeEvent.clientX,
        nativeEvent.clientY,
      );
    }

    function resolveCallback(handlerId: string): EventCallback | undefined {
      return handlersRef.current.get(handlerId);
    }

    function buildInfo(
      handlerName: string,
      nodeId: string,
      {
        coords,
        nativeEvent,
      }: { coords: { svgX: number; svgY: number }; nativeEvent: PointerEvent | MouseEvent },
    ): PointerEventInfo {
      return { handlerName, nodeId, svgX: coords.svgX, svgY: coords.svgY, nativeEvent };
    }

    /** Fire a named handler on a node if it exists. */
    function fireHandler(
      handlerMap: Map<string, HandlersRef>,
      nodeId: string,
      {
        eventKey,
        coords,
        nativeEvent,
      }: {
        eventKey: keyof HandlersRef;
        coords: { svgX: number; svgY: number };
        nativeEvent: PointerEvent | MouseEvent;
      },
    ): void {
      const irHandlers = handlerMap.get(nodeId);
      const handlerName = irHandlers?.[eventKey] as string | undefined;
      if (!handlerName) {
        return;
      }
      const callback = resolveCallback(handlerName);
      if (callback) {
        callback(buildInfo(handlerName, nodeId, { coords, nativeEvent }));
      }
    }

    /** Resolve hit target from a pointer/mouse event. */
    function hitFromEvent(e: MouseEvent | PointerEvent): {
      nodeId: string | null;
      candidates: string[];
      coords: { svgX: number; svgY: number };
      handlerMap: Map<string, HandlersRef>;
    } | null {
      const coords = translateCoords(e);
      if (!coords) {
        return null;
      }
      const { spatialIndex, handlerMap } = artifactsRef.current;
      if (!spatialIndex || !handlerMap) {
        return null;
      }
      const candidates = hitTestCandidates(spatialIndex, coords.svgX, coords.svgY);
      const nodeId = resolveHitTarget(candidates, e);
      return { nodeId, candidates, coords, handlerMap };
    }

    function resolveTextContextTarget(
      candidates: ReadonlyArray<string>,
      resolvedNodeId: string | null,
    ): string | null {
      const { nodeTypeMap } = artifactsRef.current;
      if (!nodeTypeMap) {
        return null;
      }

      const resolvedType = resolvedNodeId ? nodeTypeMap.get(resolvedNodeId) : undefined;
      if (resolvedType === "text") {
        return resolvedNodeId;
      }

      // If the resolved target is another leaf node (rect/image/path/svg), keep
      // the browser behavior: do not open the text-copy menu through that node.
      if (resolvedType !== undefined) {
        return null;
      }

      // When the resolved target is a group wrapper, fall through to the topmost
      // text leaf under the pointer so text copy works across the text bbox.
      for (const candidate of candidates) {
        if (nodeTypeMap.get(candidate) === "text") {
          return candidate;
        }
      }

      return null;
    }

    /**
     * Clear hover state and fire leave handler on previous hover node.
     * Shared by pointerleave, pointercancel, and lostpointercapture.
     */
    function clearHover(e: PointerEvent) {
      const prevHover = hoverRef.current;
      if (prevHover) {
        const { handlerMap } = artifactsRef.current;
        if (handlerMap) {
          const coords = translateCoords(e) ?? { svgX: 0, svgY: 0 };
          fireHandler(handlerMap, prevHover, {
            eventKey: "onPointerLeave",
            coords,
            nativeEvent: e,
          });
          fireHandler(handlerMap, prevHover, { eventKey: "onPointerOut", coords, nativeEvent: e });
          fireHandler(handlerMap, prevHover, { eventKey: "onMouseLeave", coords, nativeEvent: e });
          fireHandler(handlerMap, prevHover, { eventKey: "onMouseOut", coords, nativeEvent: e });
        }
      }
      hoverRef.current = null;
      setHoverNodeId(null);
      if (showPointerCursor && container) {
        container.style.cursor = "";
      }
    }

    function handleClick(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.nodeId) {
        return;
      }
      fireHandler(hit.handlerMap, hit.nodeId, {
        eventKey: "onClick",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    function handleDoubleClick(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.nodeId) {
        return;
      }
      fireHandler(hit.handlerMap, hit.nodeId, {
        eventKey: "onDoubleClick",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    function handleContextMenu(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.nodeId) {
        return;
      }
      const irHandlers = hit.handlerMap.get(hit.nodeId);

      // User-defined onContextMenu handler takes priority
      if (irHandlers?.onContextMenu) {
        e.preventDefault();
        fireHandler(hit.handlerMap, hit.nodeId, {
          eventKey: "onContextMenu",
          coords: hit.coords,
          nativeEvent: e,
        });
        return;
      }

      // Text copy: if the topmost resolved node is a group wrapper, fall
      // through to the topmost text leaf under the pointer.
      if (enableTextCopy && onTextContextMenuRef.current) {
        const textNodeId = resolveTextContextTarget(hit.candidates, hit.nodeId);
        if (!textNodeId) {
          return;
        }

        const textHandlers = hit.handlerMap.get(textNodeId);
        if (textHandlers?.onContextMenu) {
          e.preventDefault();
          fireHandler(hit.handlerMap, textNodeId, {
            eventKey: "onContextMenu",
            coords: hit.coords,
            nativeEvent: e,
          });
          return;
        }

        e.preventDefault();
        onTextContextMenuRef.current({
          nodeId: textNodeId,
          svgX: hit.coords.svgX,
          svgY: hit.coords.svgY,
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Touch events (onTouchStart/End/Move) are implemented via Pointer Events.
    //
    // Known issue: Native TouchEvent (touchstart/touchmove/touchend) does not
    // reliably fire on real mobile browsers for SVG elements. Browsers may
    // silently fire touchcancel instead of touchend, and touchmove may stop
    // after the first event — even with touch-action:none and preventDefault.
    // This is a known cross-browser issue confirmed in D3.js, Konva, and
    // @use-gesture/react, which all default to Pointer Events for this reason.
    //
    // PointerEvent.pointerType === "touch" identifies touch-originated events.
    // -----------------------------------------------------------------------

    function handlePointerDown(e: PointerEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.nodeId) {
        return;
      }
      activePointerTargets.set(e.pointerId, hit.nodeId);
      fireHandler(hit.handlerMap, hit.nodeId, {
        eventKey: "onPointerDown",
        coords: hit.coords,
        nativeEvent: e,
      });
      if (e.pointerType === "touch") {
        fireHandler(hit.handlerMap, hit.nodeId, {
          eventKey: "onTouchStart",
          coords: hit.coords,
          nativeEvent: e,
        });
      }
    }

    function handlePointerUp(e: PointerEvent) {
      activePointerTargets.delete(e.pointerId);
      const hit = hitFromEvent(e);
      if (!hit?.nodeId) {
        return;
      }
      fireHandler(hit.handlerMap, hit.nodeId, {
        eventKey: "onPointerUp",
        coords: hit.coords,
        nativeEvent: e,
      });
      if (e.pointerType === "touch") {
        fireHandler(hit.handlerMap, hit.nodeId, {
          eventKey: "onTouchEnd",
          coords: hit.coords,
          nativeEvent: e,
        });
      }
    }

    function handleMouseDown(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.nodeId) {
        return;
      }
      fireHandler(hit.handlerMap, hit.nodeId, {
        eventKey: "onMouseDown",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    function handleMouseUp(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.nodeId) {
        return;
      }
      fireHandler(hit.handlerMap, hit.nodeId, {
        eventKey: "onMouseUp",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    /** Fire a group of event names on a single target node. */
    function fireEventGroup(
      handlerMap: Map<string, HandlersRef>,
      nodeId: string,
      {
        events,
        coords,
        nativeEvent,
      }: {
        events: ReadonlyArray<keyof HandlersRef>;
        coords: { svgX: number; svgY: number };
        nativeEvent: PointerEvent | MouseEvent;
      },
    ): void {
      for (const eventKey of events) {
        fireHandler(handlerMap, nodeId, { eventKey, coords, nativeEvent });
      }
    }

    const LEAVE_EVENTS: ReadonlyArray<keyof HandlersRef> = [
      "onPointerLeave",
      "onPointerOut",
      "onMouseLeave",
      "onMouseOut",
    ];
    const ENTER_EVENTS: ReadonlyArray<keyof HandlersRef> = [
      "onPointerEnter",
      "onPointerOver",
      "onMouseEnter",
      "onMouseOver",
    ];

    function dispatchHoverTransition(
      handlerMap: Map<string, HandlersRef>,
      transition: {
        prevHover: string | null;
        nodeId: string | null;
        coords: { svgX: number; svgY: number };
        nativeEvent: PointerEvent;
      },
    ): void {
      const { prevHover, nodeId, coords, nativeEvent } = transition;
      if (prevHover && prevHover !== nodeId) {
        fireEventGroup(handlerMap, prevHover, { events: LEAVE_EVENTS, coords, nativeEvent });
      }
      if (nodeId && nodeId !== prevHover) {
        fireEventGroup(handlerMap, nodeId, { events: ENTER_EVENTS, coords, nativeEvent });
      }
      if (nodeId) {
        fireHandler(handlerMap, nodeId, { eventKey: "onPointerMove", coords, nativeEvent });
        fireHandler(handlerMap, nodeId, { eventKey: "onMouseMove", coords, nativeEvent });
        if (nativeEvent.pointerType === "touch") {
          fireHandler(handlerMap, nodeId, { eventKey: "onTouchMove", coords, nativeEvent });
        }
      }
    }

    function processPointerMoveFrame(e: PointerEvent) {
      const hit = hitFromEvent(e);
      if (!hit) {
        return;
      }
      const { nodeId, coords, handlerMap } = hit;
      dispatchHoverTransition(handlerMap, {
        prevHover: hoverRef.current,
        nodeId,
        coords,
        nativeEvent: e,
      });

      hoverRef.current = nodeId;
      setHoverNodeId(nodeId);

      if (showPointerCursor && container) {
        container.style.cursor = nodeId && handlerMap.has(nodeId) ? "pointer" : "";
      }
    }

    function handlePointerMove(e: PointerEvent) {
      // rAF throttle: skip if a frame is already scheduled
      if (rafRef.current) {
        return;
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        processPointerMoveFrame(e);
      });
    }

    function handlePointerLeave(e: PointerEvent) {
      clearHover(e);
    }

    function dispatchPointerCancel(e: PointerEvent) {
      const downTarget = activePointerTargets.get(e.pointerId);
      if (!downTarget) {
        return;
      }
      activePointerTargets.delete(e.pointerId);
      const { handlerMap } = artifactsRef.current;
      if (!handlerMap) {
        return;
      }
      const coords = translateCoords(e) ?? { svgX: 0, svgY: 0 };
      fireHandler(handlerMap, downTarget, {
        eventKey: "onPointerCancel",
        coords,
        nativeEvent: e,
      });
    }

    function handlePointerCancel(e: PointerEvent) {
      dispatchPointerCancel(e);
      clearHover(e);
    }

    function handleLostPointerCapture(e: PointerEvent) {
      dispatchPointerCancel(e);
      clearHover(e);
    }

    container.addEventListener("click", handleClick);
    container.addEventListener("dblclick", handleDoubleClick);
    container.addEventListener("contextmenu", handleContextMenu);
    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerleave", handlePointerLeave);
    container.addEventListener("pointercancel", handlePointerCancel);
    container.addEventListener("lostpointercapture", handleLostPointerCapture);
    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mouseup", handleMouseUp);

    // touch-action: none prevents the browser from consuming pointer events
    // for scroll/zoom on touch devices.
    const prevTouchAction = container.style.touchAction;
    const prevUserSelect = container.style.userSelect;
    const prevWebkitUserSelect = container.style.getPropertyValue("-webkit-user-select");
    container.style.touchAction = "none";
    container.style.userSelect = "none";
    container.style.setProperty("-webkit-user-select", "none");

    return () => {
      container.style.touchAction = prevTouchAction;
      container.style.userSelect = prevUserSelect;
      container.style.setProperty("-webkit-user-select", prevWebkitUserSelect);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      hoverRef.current = null;
      setHoverNodeId(null);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("dblclick", handleDoubleClick);
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
      container.removeEventListener("pointercancel", handlePointerCancel);
      container.removeEventListener("lostpointercapture", handleLostPointerCapture);
      container.removeEventListener("mousedown", handleMouseDown);
      container.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerEl, artifacts.isReady, showPointerCursor, enableTextCopy]);

  useEffect(() => {
    if (!containerEl || !artifacts.isReady || artifacts.svg === null) {
      return;
    }

    // CSS touch-action is not inherited, so reapply it when innerHTML replaces
    // the generated SVG.
    const svgEl = containerEl.querySelector("svg");
    const prevSvgTouchAction = svgEl?.style.touchAction ?? "";
    if (svgEl) {
      svgEl.style.touchAction = "none";
    }

    return () => {
      if (svgEl) {
        svgEl.style.touchAction = prevSvgTouchAction;
      }
    };
  }, [containerEl, artifacts.isReady, artifacts.svg]);

  // Stable ref callback
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    activePointerTargetsRef.current.clear();
    setContainerEl(node);
  }, []);

  return {
    svg: artifacts.svg,
    ir: artifacts.ir,
    textMap: artifacts.textMap,
    error: artifacts.error,
    isReady: artifacts.isReady,
    hoverNodeId,
    containerRef,
  };
}
