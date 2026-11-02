import {
  bindIRToSvg,
  type IRDomBinding,
  nativePathCandidates,
  resolveHitTarget as resolveHitTargetBrowser,
  translateSvgCoords,
} from "@boundsvg/browser/events";
import type { IR, RenderAnimatedSvgOptions, RenderSvgOptions, VNode } from "@boundsvg/core";
import {
  buildHitTestIndex,
  buildTextMap,
  type HandlersRef,
  type IRHitCandidate,
  type IRHitIndex,
  type IRSourceIndex,
  type IRSourceRef,
  type TextMap,
} from "@boundsvg/core/scene";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EventCallback, PointerEventInfo, RenderInputOptions } from "../types.js";
import { resolveMainThreadEngineError } from "../utils/main-thread-only.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./use-commit-phase-render-notifications.js";
import { useRenderInput } from "./use-render-input.js";
import { useStructurallyStableRenderOptions } from "./use-structurally-stable-value.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Info passed when a text node is right-clicked without a user-defined onContextMenu handler */
export type TextContextMenuHit = {
  source: IRSourceRef;
  svgX: number;
  svgY: number;
  clientX: number;
  clientY: number;
};

/** Cursor and text-copy behavior independent of the selected document family. */
type InteractiveBehaviorOptions = {
  /** Whether to show cursor:pointer on interactive elements (default: true) */
  showPointerCursor?: boolean;
  /** When true, right-click on text nodes fires onTextContextMenu instead of browser default */
  enableTextCopy?: boolean;
  /** Callback fired when a text node is right-clicked (requires enableTextCopy) */
  onTextContextMenu?: (hit: TextContextMenuHit) => void;
};

/** Interactive behavior and input revision with either static sampling or declarative SVG playback. */
export type UseInteractiveSvgOptions = InteractiveBehaviorOptions &
  RenderInputOptions &
  (
    | {
        /** Static sampled SVG is the default interactive document family. */
        renderMode?: "static";
        renderOptions?: RenderSvgOptions;
      }
    | {
        /** Preserve authored tracks in the interactive SVG document. */
        renderMode: "animated";
        renderOptions: RenderAnimatedSvgOptions;
      }
  );

/** Rendered SVG and inspection data with hover state and a container attachment callback. */
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
  /** The source occurrence currently hovered, or null */
  hoverSource: IRSourceRef | null;
  /** Ref callback to attach to the container div */
  containerRef: (node: HTMLDivElement | null) => void;
};

// ---------------------------------------------------------------------------
// Internal render artifacts
// ---------------------------------------------------------------------------

/** One render revision's matching SVG, IR, lookup maps, and candidate index. */
type RenderArtifacts = {
  svg: string | null;
  ir: IR | null;
  spatialIndex: IRHitIndex | null;
  textMap: TextMap | null;
  error: Error | null;
  isReady: boolean;
};

function sourceHandlers(index: IRSourceIndex, source: IRSourceRef): HandlersRef | undefined {
  const info = index.sources.get(source.sourceIndex);
  return info?.source === source && info.node.ownership.role === "source"
    ? info.node.ownership.on
    : undefined;
}

/** Empty interactive render state shared before a successful main-thread render. */
const EMPTY_ARTIFACTS: RenderArtifacts = {
  svg: null,
  ir: null,
  spatialIndex: null,
  textMap: null,
  error: null,
  isReady: false,
};

/** Render state plus notifications delivered only after that revision commits. */
type InteractiveRenderComputation = {
  artifacts: RenderArtifacts;
  deliveries: readonly RenderNotificationDelivery[];
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Render through the Provider's main-thread Engine and attach hit-tested pointer handlers to the returned container ref. */
export function useInteractiveSvg(
  vnode: VNode | null,
  handlers: Map<string, EventCallback>,
  options?: UseInteractiveSvgOptions,
): UseInteractiveSvgResult {
  const { engine, workerEngine, status, defaultCommonOptions } = useBoundSvg();
  const renderInput = useRenderInput(vnode, engine, options);
  const stableRenderOptions = useStructurallyStableRenderOptions(options?.renderOptions);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);
  const renderMode = options?.renderMode ?? "static";
  const [hoverSource, setHoverSource] = useState<IRSourceRef | null>(null);

  // Memoize render artifacts — uses engine.renderToSvgAndIR() for single layout pass
  const computation = useMemo<InteractiveRenderComputation>(() => {
    if (status !== "ready" || !engine || !renderInput.vnode) {
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
    const mergedOptions = {
      ...stableDefaultCommonOptions,
      ...stableRenderOptions,
      nodeIdMetadata: "include" as const,
    };
    const captured = captureRenderNotifications(mergedOptions);
    try {
      const { svg, ir } =
        renderMode === "animated"
          ? engine.renderToAnimatedSvgAndIR(
              renderInput.vnode,
              captured.options as RenderAnimatedSvgOptions,
            )
          : engine.renderToSvgAndIR(renderInput.vnode, captured.options as RenderSvgOptions);
      const spatialIndex = buildHitTestIndex(ir);
      const textMap = buildTextMap(ir, spatialIndex.sourceIndex);
      return {
        artifacts: {
          svg,
          ir,
          spatialIndex,
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
  }, [
    engine,
    workerEngine,
    status,
    renderInput,
    stableRenderOptions,
    stableDefaultCommonOptions,
    renderMode,
  ]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  const artifacts = computation.artifacts;

  // Store latest handlers & artifacts in refs to avoid closure staleness
  const bindingRef = useRef<IRDomBinding | null>(null);
  const handlersRef = useRef(handlers);
  const artifactsRef = useRef(artifacts);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
    if (artifactsRef.current !== artifacts) {
      bindingRef.current = null;
      hoverRef.current = null;
      activePointerTargetsRef.current.clear();
      setHoverSource(null);
    }
    artifactsRef.current = artifacts;
  }, [artifacts, handlers]);

  // Track current hover node for enter/leave detection
  const hoverRef = useRef<IRSourceRef | null>(null);

  // A pointer gesture can outlive a listener-effect instance when interactive
  // options change. Keep its original down target until the gesture terminates.
  const activePointerTargetsRef = useRef(new Map<number, IRSourceRef>());

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
    let pendingPointerMove: PointerEvent | null = null;

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

    /** Resolve a handler against the latest committed callback map. */
    function resolveCallback(handlerId: string): EventCallback | undefined {
      return handlersRef.current.get(handlerId);
    }

    /** Preserve the native event and translated coordinates in the public callback payload. */
    function buildInfo(
      handlerName: string,
      source: IRSourceRef,
      {
        coords,
        nativeEvent,
      }: { coords: { svgX: number; svgY: number }; nativeEvent: PointerEvent | MouseEvent },
    ): PointerEventInfo {
      return {
        handlerName,
        source,
        nodeId: source.nodeId,
        svgX: coords.svgX,
        svgY: coords.svgY,
        nativeEvent,
      };
    }

    /** Fire a named handler on a node if it exists. */
    function fireHandler(
      sourceIndex: IRSourceIndex,
      source: IRSourceRef,
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
      const irHandlers = sourceHandlers(sourceIndex, source);
      const handlerName = irHandlers?.[eventKey] as string | undefined;
      if (!handlerName) {
        return;
      }
      const callback = resolveCallback(handlerName);
      if (callback) {
        callback(buildInfo(handlerName, source, { coords, nativeEvent }));
      }
    }

    function bindingForCurrent(): IRDomBinding | null {
      const index = artifactsRef.current.spatialIndex;
      const root = container?.querySelector("svg");
      if (!index || !root) {
        return null;
      }
      const current = bindingRef.current;
      if (current?.root === root && current.sourceIndex === index.sourceIndex) {
        return current;
      }
      const binding = bindIRToSvg(root, index.sourceIndex);
      bindingRef.current = binding;
      return binding;
    }

    /** Resolve prepared and native Path candidates under the same canvas and clip gates. */
    function hitFromEvent(e: MouseEvent | PointerEvent): {
      source: IRSourceRef | null;
      candidates: IRHitCandidate[];
      coords: { svgX: number; svgY: number };
      sourceIndex: IRSourceIndex;
    } | null {
      const coords = translateCoords(e);
      const index = artifactsRef.current.spatialIndex;
      const binding = bindingForCurrent();
      if (!coords || !index || !binding) {
        return null;
      }
      const candidates = index.queryCandidates(coords.svgX, coords.svgY);
      for (const native of nativePathCandidates(binding, index, {
        clientX: e.clientX,
        clientY: e.clientY,
        x: coords.svgX,
        y: coords.svgY,
      })) {
        if (!candidates.some((entry) => entry.source === native.source)) {
          candidates.push(native);
        }
      }
      candidates.sort((left, right) => right.order - left.order);
      const source = resolveHitTargetBrowser(binding, candidates, e.clientX, e.clientY);
      return { source, candidates, coords, sourceIndex: index.sourceIndex };
    }

    /** Offer text copy through a source frame, but never through another painted primary. */
    function resolveTextContextTarget(
      candidates: readonly IRHitCandidate[],
      resolved: IRSourceRef | null,
    ): IRSourceRef | null {
      const index = artifactsRef.current.spatialIndex?.sourceIndex;
      if (!index || !resolved) {
        return null;
      }
      const source = index.sources.get(resolved.sourceIndex);
      const primary =
        source?.primaryNodeIndex === null || source?.primaryNodeIndex === undefined
          ? undefined
          : index.nodes.get(source.primaryNodeIndex);
      if (primary) {
        return primary.node.type === "text" ? resolved : null;
      }
      return (
        candidates.find(
          (candidate) => index.nodes.get(candidate.geometryNodeIndex)?.node.type === "text",
        )?.source ?? null
      );
    }

    /**
     * Clear hover state and fire leave handler on previous hover node.
     * Shared by pointerleave, pointercancel, and lostpointercapture.
     */
    function clearHover(e: PointerEvent) {
      cancelPendingPointerMove();
      const prevHover = hoverRef.current;
      if (prevHover) {
        const sourceIndex = artifactsRef.current.spatialIndex?.sourceIndex;
        if (sourceIndex) {
          const coords = translateCoords(e) ?? { svgX: 0, svgY: 0 };
          fireHandler(sourceIndex, prevHover, {
            eventKey: "onPointerLeave",
            coords,
            nativeEvent: e,
          });
          fireHandler(sourceIndex, prevHover, { eventKey: "onPointerOut", coords, nativeEvent: e });
          fireHandler(sourceIndex, prevHover, { eventKey: "onMouseLeave", coords, nativeEvent: e });
          fireHandler(sourceIndex, prevHover, { eventKey: "onMouseOut", coords, nativeEvent: e });
        }
      }
      hoverRef.current = null;
      setHoverSource(null);
      if (showPointerCursor && container) {
        container.style.cursor = "";
      }
    }

    /** Deliver one click to the final candidate at the current pointer. */
    function handleClick(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.source) {
        return;
      }
      fireHandler(hit.sourceIndex, hit.source, {
        eventKey: "onClick",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    /** Deliver one double-click to the final candidate at the current pointer. */
    function handleDoubleClick(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.source) {
        return;
      }
      fireHandler(hit.sourceIndex, hit.source, {
        eventKey: "onDoubleClick",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    /** Prefer a registered context handler, otherwise offer the enabled text-copy action. */
    function handleContextMenu(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.source) {
        return;
      }
      const irHandlers = sourceHandlers(hit.sourceIndex, hit.source);

      // User-defined onContextMenu handler takes priority
      if (irHandlers?.onContextMenu) {
        e.preventDefault();
        fireHandler(hit.sourceIndex, hit.source, {
          eventKey: "onContextMenu",
          coords: hit.coords,
          nativeEvent: e,
        });
        return;
      }

      // Text copy: if the topmost resolved node is a group wrapper, fall
      // through to the topmost text leaf under the pointer.
      if (enableTextCopy && onTextContextMenuRef.current) {
        const textSource = resolveTextContextTarget(hit.candidates, hit.source);
        if (!textSource) {
          return;
        }

        const textHandlers = sourceHandlers(hit.sourceIndex, textSource);
        if (textHandlers?.onContextMenu) {
          e.preventDefault();
          fireHandler(hit.sourceIndex, textSource, {
            eventKey: "onContextMenu",
            coords: hit.coords,
            nativeEvent: e,
          });
          return;
        }

        e.preventDefault();
        onTextContextMenuRef.current({
          source: textSource,
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

    /** Remember gesture ownership and deliver pointer/touch start to the current hit. */
    function handlePointerDown(e: PointerEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.source) {
        return;
      }
      activePointerTargets.set(e.pointerId, hit.source);
      fireHandler(hit.sourceIndex, hit.source, {
        eventKey: "onPointerDown",
        coords: hit.coords,
        nativeEvent: e,
      });
      if (e.pointerType === "touch") {
        fireHandler(hit.sourceIndex, hit.source, {
          eventKey: "onTouchStart",
          coords: hit.coords,
          nativeEvent: e,
        });
      }
    }

    /** End gesture ownership and deliver pointer/touch end at the current hit. */
    function handlePointerUp(e: PointerEvent) {
      activePointerTargets.delete(e.pointerId);
      const hit = hitFromEvent(e);
      if (!hit?.source) {
        return;
      }
      fireHandler(hit.sourceIndex, hit.source, {
        eventKey: "onPointerUp",
        coords: hit.coords,
        nativeEvent: e,
      });
      if (e.pointerType === "touch") {
        fireHandler(hit.sourceIndex, hit.source, {
          eventKey: "onTouchEnd",
          coords: hit.coords,
          nativeEvent: e,
        });
      }
    }

    /** Deliver the mouse-down compatibility handler at the current hit. */
    function handleMouseDown(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.source) {
        return;
      }
      fireHandler(hit.sourceIndex, hit.source, {
        eventKey: "onMouseDown",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    /** Deliver the mouse-up compatibility handler at the current hit. */
    function handleMouseUp(e: MouseEvent) {
      const hit = hitFromEvent(e);
      if (!hit?.source) {
        return;
      }
      fireHandler(hit.sourceIndex, hit.source, {
        eventKey: "onMouseUp",
        coords: hit.coords,
        nativeEvent: e,
      });
    }

    /** Fire a group of event names on a single target node. */
    function fireEventGroup(
      sourceIndex: IRSourceIndex,
      source: IRSourceRef,
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
        fireHandler(sourceIndex, source, { eventKey, coords, nativeEvent });
      }
    }

    /** Pointer, mouse, and touch handler names dispatched when hover ownership ends. */
    const LEAVE_EVENTS: ReadonlyArray<keyof HandlersRef> = [
      "onPointerLeave",
      "onPointerOut",
      "onMouseLeave",
      "onMouseOut",
    ];
    /** Pointer, mouse, and touch handler names dispatched when hover ownership begins. */
    const ENTER_EVENTS: ReadonlyArray<keyof HandlersRef> = [
      "onPointerEnter",
      "onPointerOver",
      "onMouseEnter",
      "onMouseOver",
    ];

    /** Deliver leave/enter transitions and move handlers for the current hover owner. */
    function dispatchHoverTransition(
      sourceIndex: IRSourceIndex,
      transition: {
        prevHover: IRSourceRef | null;
        source: IRSourceRef | null;
        coords: { svgX: number; svgY: number };
        nativeEvent: PointerEvent;
      },
    ): void {
      const { prevHover, source, coords, nativeEvent } = transition;
      if (prevHover && prevHover !== source) {
        fireEventGroup(sourceIndex, prevHover, { events: LEAVE_EVENTS, coords, nativeEvent });
      }
      if (source && source !== prevHover) {
        fireEventGroup(sourceIndex, source, { events: ENTER_EVENTS, coords, nativeEvent });
      }
      if (source) {
        fireHandler(sourceIndex, source, { eventKey: "onPointerMove", coords, nativeEvent });
        fireHandler(sourceIndex, source, { eventKey: "onMouseMove", coords, nativeEvent });
        if (nativeEvent.pointerType === "touch") {
          fireHandler(sourceIndex, source, { eventKey: "onTouchMove", coords, nativeEvent });
        }
      }
    }

    /** Resolve one throttled move, update hover ownership, and refresh the cursor. */
    function processPointerMoveFrame(e: PointerEvent) {
      const hit = hitFromEvent(e);
      if (!hit) {
        return;
      }
      const { source, coords, sourceIndex } = hit;
      dispatchHoverTransition(sourceIndex, {
        prevHover: hoverRef.current,
        source,
        coords,
        nativeEvent: e,
      });

      hoverRef.current = source;
      setHoverSource(source);

      if (showPointerCursor && container) {
        container.style.cursor =
          source && sourceHandlers(sourceIndex, source) !== undefined ? "pointer" : "";
      }
    }

    /** Cancel queued work when the current pointer or container lifetime ends. */
    function cancelPendingPointerMove(): void {
      pendingPointerMove = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    }

    /** Resolve the latest pointer position once per frame, including the final move. */
    function handlePointerMove(e: PointerEvent) {
      pendingPointerMove = e;
      if (rafRef.current) {
        return;
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const latestMove = pendingPointerMove;
        pendingPointerMove = null;
        if (latestMove) {
          processPointerMoveFrame(latestMove);
        }
      });
    }

    /** Clear hover when the native pointer leaves the interactive container. */
    function handlePointerLeave(e: PointerEvent) {
      clearHover(e);
    }

    /** Deliver cancellation to the original down target once and release gesture ownership. */
    function dispatchPointerCancel(e: PointerEvent) {
      const downTarget = activePointerTargets.get(e.pointerId);
      if (!downTarget) {
        return;
      }
      activePointerTargets.delete(e.pointerId);
      const sourceIndex = artifactsRef.current.spatialIndex?.sourceIndex;
      if (!sourceIndex) {
        return;
      }
      const coords = translateCoords(e) ?? { svgX: 0, svgY: 0 };
      fireHandler(sourceIndex, downTarget, {
        eventKey: "onPointerCancel",
        coords,
        nativeEvent: e,
      });
    }

    /** Cancel the active gesture and clear hover after native cancellation. */
    function handlePointerCancel(e: PointerEvent) {
      dispatchPointerCancel(e);
      clearHover(e);
    }

    /** Cancel any surviving gesture and clear hover when native capture ends. */
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
      cancelPendingPointerMove();
      hoverRef.current = null;
      setHoverSource(null);
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
  }, [containerEl, artifacts, showPointerCursor, enableTextCopy]);

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
    hoverSource,
    containerRef,
  };
}
