import { resolveHitTarget, translateSvgCoords } from "@boundsvg/browser";
import type { IR } from "@boundsvg/core";
import {
  buildHitTestIndex,
  buildNodeTypeMap,
  buildTextSelectionMap,
  findTextCaretAtPoint,
  getTextRangeQuads,
  hitTestCandidates,
  type TextSelectionMap,
  type TextSelectionQuad,
} from "@boundsvg/core/scene";
import type { Engine, VNode } from "@boundsvg/react";
import type { BooleanOp } from "@boundsvg/shape";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "../../components/Tooltip";
import {
  type EditorLayer,
  type EditorPresent,
  type EditorState,
  type EditorTextLayer,
  type EditorTextSelection,
  layerText,
  splitEditorGraphemes,
} from "./editor-model";
import { type EditorAction, resolveLayerSelection } from "./editor-reducer";

export type EditorArtifacts = { svg: string; ir: IR } | null;

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type DragState = {
  mode: "move" | "resize" | "rotate" | "text-select";
  before: EditorPresent;
  layer: EditorLayer;
  layers: EditorLayer[];
  startX: number;
  startY: number;
  handle?: ResizeHandle;
  anchor?: number;
  collapseToLayerId?: string;
  bounds?: SelectionBounds;
  startAngleDeg?: number;
  changed?: boolean;
};
type ActiveInteraction = DragState["mode"] | "range-select";
type MarqueeSelection = {
  start: CanvasPoint;
  current: CanvasPoint;
  additive: boolean;
};

type Props = {
  engine: Engine;
  vnode: VNode;
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  onArtifacts: (artifacts: EditorArtifacts) => void;
  showDebug: boolean;
  onBooleanOperation: (operation: BooleanOp) => void;
};

type CanvasPointEvent = ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>;
type EditorKeyboardEvent = ReactKeyboardEvent<HTMLElement> | KeyboardEvent;
type GlobalCaret = { offset: number; affinity: "before" | "after" };
type CaretSegment = {
  nodeId: string;
  offset: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
};
type SelectionBounds = { left: number; top: number; right: number; bottom: number };
type CanvasPoint = { x: number; y: number };
type TextSelectionStart = { selection: EditorTextSelection; drag: DragState };

const MIN_LAYER_SIZE = 20;
const DRAG_THRESHOLD_PX = 2;
const RESIZE_HANDLE_LABELS: Record<ResizeHandle, string> = {
  nw: "Resize from top left",
  n: "Resize from top",
  ne: "Resize from top right",
  e: "Resize from right",
  se: "Resize from bottom right",
  s: "Resize from bottom",
  sw: "Resize from bottom left",
  w: "Resize from left",
};

export function EditorCanvas({
  engine,
  vnode,
  state,
  dispatch,
  onArtifacts,
  showDebug,
  onBooleanOperation,
}: Props) {
  const document = state.present.document;
  const selectedLayer = document.layers.find((layer) => layer.id === state.present.selectedLayerId);
  const selectedLayers = useMemo(
    () => document.layers.filter((layer) => state.present.selectedLayerIds.includes(layer.id)),
    [document.layers, state.present.selectedLayerIds],
  );
  const containerRef = useRef<HTMLFieldSetElement>(null);
  const keyboardTargetRef = useRef<HTMLButtonElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const compositionBeforeRef = useRef<EditorPresent | null>(null);
  const compositionActiveRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<MarqueeSelection | null>(null);
  const rafRef = useRef(0);
  const [activeInteraction, setActiveInteraction] = useState<ActiveInteraction | null>(null);
  const [contextMenuPoint, setContextMenuPoint] = useState<CanvasPoint | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<MarqueeSelection | null>(null);
  const textEditorLayer = selectedLayer?.type === "text" ? selectedLayer : null;
  const textEditorLayerId = textEditorLayer?.id;
  const hoveredLayer = document.layers.find((layer) => layer.id === hoveredLayerId);

  const renderResult = useMemo(() => {
    try {
      return {
        artifacts: engine.renderToSvgAndIR(vnode, { textPathMode: "glyphs", debug: showDebug }),
        error: null,
      };
    } catch (error) {
      return { artifacts: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [engine, vnode, showDebug]);
  const artifacts = renderResult.artifacts;
  const interaction = useMemo(() => {
    if (!artifacts) {
      return null;
    }
    return {
      hitIndex: buildHitTestIndex(artifacts.ir),
      nodeTypeMap: buildNodeTypeMap(artifacts.ir),
      textSelectionMap: buildTextSelectionMap(artifacts.ir),
    };
  }, [artifacts]);

  useEffect(() => {
    onArtifacts(artifacts);
  }, [artifacts, onArtifacts]);
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
    },
    [],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditorShortcutInputTarget(event.target)) {
        return;
      }
      handleKeyDown(event, state, dispatch);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, state]);
  useEffect(() => {
    const selection = state.present.textSelection;
    if (!state.present.textEditMode || !textEditorLayerId || !textEditorLayer || !selection) {
      return;
    }
    const animationFrame = requestAnimationFrame(() => {
      const editor = textEditorRef.current;
      if (!editor || compositionActiveRef.current) {
        return;
      }
      const text = layerText(textEditorLayer);
      const anchor = graphemeIndexToUtf16Offset(text, selection.anchor);
      const focus = graphemeIndexToUtf16Offset(text, selection.focus);
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(
        Math.min(anchor, focus),
        Math.max(anchor, focus),
        anchor > focus ? "backward" : "forward",
      );
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [state.present.textEditMode, state.present.textSelection, textEditorLayer, textEditorLayerId]);

  const selectionQuads = useMemo(
    () => resolveSelectionQuads(interaction?.textSelectionMap, state),
    [interaction?.textSelectionMap, state],
  );
  const selectionBounds = useMemo(() => resolveSelectionBounds(selectionQuads), [selectionQuads]);
  const layerSelectionBounds = useMemo(
    () => resolveLayerSelectionBounds(selectedLayers),
    [selectedLayers],
  );
  const caretSegment = useMemo(
    () => resolveCaretSegment(interaction?.textSelectionMap, state),
    [interaction?.textSelectionMap, state],
  );

  const pointFromEvent = (event: CanvasPointEvent): CanvasPoint | null => {
    const svg = containerRef.current?.querySelector("svg[data-boundsvg-node-id]");
    if (!svg) {
      return null;
    }
    return translateSvgCoords(svg as SVGSVGElement, event.clientX, event.clientY);
  };

  const hitFromEvent = (
    event: CanvasPointEvent,
    point: { x: number; y: number },
  ): string | null => {
    if (!interaction || !containerRef.current) {
      return null;
    }
    const candidates = hitTestCandidates(interaction.hitIndex, point.x, point.y);
    return resolveHitTarget(
      containerRef.current,
      candidates,
      interaction.nodeTypeMap,
      event.clientX,
      event.clientY,
    );
  };

  const enterTextEdit = (layer: EditorTextLayer, caret?: GlobalCaret) => {
    const text = layerText(layer);
    const resolvedCaret = caret ?? {
      offset: splitEditorGraphemes(text).length,
      affinity: "after" as const,
    };
    dispatch({ type: "select", layerId: layer.id });
    dispatch({
      type: "set-text-selection",
      layerId: layer.id,
      anchor: resolvedCaret.offset,
      focus: resolvedCaret.offset,
      focusAffinity: resolvedCaret.affinity,
    });
    dispatch({ type: "set-text-edit", enabled: true });
  };

  const selectLayerFromPointer = (layer: EditorLayer, point: CanvasPoint, shiftKey: boolean) => {
    const clickSelection = resolveLayerSelection(state.present, layer.id);
    const nextSelection = resolveLayerSelection(state.present, layer.id, {
      additive: shiftKey,
      preserveSelection: !shiftKey,
    });
    const collapseSelectionOnClick =
      !shiftKey &&
      (clickSelection.selectedLayerId !== nextSelection.selectedLayerId ||
        !sameLayerIds(clickSelection.selectedLayerIds, nextSelection.selectedLayerIds));
    dispatch({
      type: "select",
      layerId: layer.id,
      additive: shiftKey,
      preserveSelection: !shiftKey,
    });
    if (shiftKey) {
      return;
    }
    const dragLayers = document.layers.filter((candidate) =>
      nextSelection.selectedLayerIds.includes(candidate.id),
    );
    if (canMoveLayerSelection(dragLayers)) {
      dragRef.current = {
        mode: "move",
        before: {
          ...state.present,
          ...nextSelection,
          textSelection: null,
          textEditMode: false,
        },
        layer,
        layers: dragLayers,
        startX: point.x,
        startY: point.y,
        collapseToLayerId: collapseSelectionOnClick ? layer.id : undefined,
      };
      setActiveInteraction("move");
    } else if (collapseSelectionOnClick) {
      dispatch({ type: "select", layerId: layer.id });
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    setContextMenuPoint(null);
    setHoveredLayerId(null);
    if (event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest("[data-editor-transform-handle]")) {
      return;
    }
    keyboardTargetRef.current?.focus({ preventScroll: true });
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }
    const nodeId = hitFromEvent(event, point);
    const layerId = resolvePointerLayerId(
      nodeId,
      point,
      state.canvasMode === "range" ? undefined : selectedLayer,
      document.layers,
    );
    if (state.canvasMode === "range") {
      event.currentTarget.setPointerCapture(event.pointerId);
      if (layerId) {
        dispatch({ type: "select", layerId, additive: event.shiftKey });
        return;
      }
      const nextMarquee = { start: point, current: point, additive: event.shiftKey };
      marqueeRef.current = nextMarquee;
      setMarquee(nextMarquee);
      setActiveInteraction("range-select");
      return;
    }
    if (!layerId) {
      dispatch({ type: "select", layerId: null });
      return;
    }
    const layer = document.layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);

    const textSelectionStart = resolveTextSelectionStart({
      layer,
      nodeId,
      point,
      textEditMode: state.present.textEditMode,
      textSelectionMap: interaction?.textSelectionMap,
      layers: document.layers,
      before: state.present,
    });
    if (textSelectionStart) {
      dispatch({ type: "set-text-selection", ...textSelectionStart.selection });
      dragRef.current = textSelectionStart.drag;
      setActiveInteraction("text-select");
      return;
    }

    selectLayerFromPointer(layer, point, event.shiftKey);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const activeMarquee = marqueeRef.current;
    if (activeMarquee) {
      const point = pointFromEvent(event);
      if (!point) {
        return;
      }
      const nextMarquee = {
        ...activeMarquee,
        current: clampCanvasPoint(point, document.canvas),
      };
      marqueeRef.current = nextMarquee;
      setMarquee(nextMarquee);
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      if (state.canvasMode === "move") {
        const point = pointFromEvent(event);
        if (point) {
          const nodeId = hitFromEvent(event, point);
          setHoveredLayerId(resolvePointerLayerId(nodeId, point, undefined, document.layers));
        }
      }
      return;
    }
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }
    pendingPointRef.current = point;
    if (rafRef.current !== 0) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const nextPoint = pendingPointRef.current;
      const activeDrag = dragRef.current;
      if (!nextPoint || !activeDrag) {
        return;
      }
      applyDrag(activeDrag, nextPoint, state, interaction?.textSelectionMap, dispatch);
    });
  };

  const endDrag = () => {
    const activeMarquee = marqueeRef.current;
    if (activeMarquee) {
      dispatch({
        type: "select-range",
        layerIds: resolveMarqueeLayerIds(document.layers, marqueeBounds(activeMarquee)),
        additive: activeMarquee.additive,
      });
      marqueeRef.current = null;
      setMarquee(null);
      setActiveInteraction(null);
      return;
    }
    const drag = dragRef.current;
    if (drag?.changed && drag.mode !== "text-select") {
      dispatch({ type: "commit-preview", before: drag.before });
    } else if (drag?.mode === "move" && drag.collapseToLayerId) {
      dispatch({ type: "select", layerId: drag.collapseToLayerId });
    }
    dragRef.current = null;
    pendingPointRef.current = null;
    setActiveInteraction(null);
  };

  const startHandleDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: "resize" | "rotate",
    handle?: ResizeHandle,
  ) => {
    if (!selectedLayer || selectedLayer.locked) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const artboard = containerRef.current?.querySelector("svg[data-boundsvg-node-id]");
    if (!artboard) {
      return;
    }
    const point = translateSvgCoords(artboard as SVGSVGElement, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      before: state.present,
      layer: selectedLayer,
      layers: [selectedLayer],
      startX: point.x,
      startY: point.y,
      handle,
    };
    setActiveInteraction(mode);
  };

  const startGroupHandleDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: "resize" | "rotate",
    handle?: ResizeHandle,
  ) => {
    if (
      !selectedLayer ||
      !layerSelectionBounds ||
      !isSingleGroupSelection(selectedLayers) ||
      !canMoveLayerSelection(selectedLayers)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const artboard = containerRef.current?.querySelector("svg[data-boundsvg-node-id]");
    if (!artboard) {
      return;
    }
    const point = translateSvgCoords(artboard as SVGSVGElement, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const centerX = (layerSelectionBounds.left + layerSelectionBounds.right) / 2;
    const centerY = (layerSelectionBounds.top + layerSelectionBounds.bottom) / 2;
    dragRef.current = {
      mode,
      before: state.present,
      layer: selectedLayer,
      layers: selectedLayers,
      startX: point.x,
      startY: point.y,
      handle,
      bounds: layerSelectionBounds,
      startAngleDeg: radiansToDegrees(Math.atan2(point.y - centerY, point.x - centerX)),
    };
    setActiveInteraction(mode);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }
    const nodeId = hitFromEvent(event, point);
    const layerId = resolvePointerLayerId(nodeId, point, selectedLayer, document.layers);
    if (layerId && !state.present.selectedLayerIds.includes(layerId)) {
      dispatch({ type: "select", layerId });
    }
    setContextMenuPoint(point);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (state.canvasMode === "range") {
      return;
    }
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }
    const nodeId = hitFromEvent(event, point);
    const layerId = resolveLayerId(nodeId, document.layers);
    const layer =
      document.layers.find((candidate) => candidate.id === layerId) ??
      document.layers.find(
        (candidate) =>
          candidate.id === state.present.selectedLayerId &&
          point.x >= candidate.x &&
          point.x <= candidate.x + candidate.width &&
          point.y >= candidate.y &&
          point.y <= candidate.y + candidate.height,
      );
    if (layer?.type === "text") {
      const selectionNodeId =
        nodeId && interaction?.textSelectionMap.nodes.has(nodeId) ? nodeId : null;
      const caret =
        selectionNodeId && interaction
          ? resolveGlobalCaret(interaction.textSelectionMap, selectionNodeId, point)
          : null;
      enterTextEdit(layer, caret ?? undefined);
    }
  };

  return (
    <div className="visual-editor-stage">
      <fieldset className="visual-editor-modebar">
        <legend>Canvas mode</legend>
        <div className="visual-editor-mode-switch">
          <button
            type="button"
            className={state.canvasMode === "move" ? "active" : undefined}
            onClick={() => {
              dispatch({ type: "set-canvas-mode", mode: "move" });
            }}
          >
            Move layers
          </button>
          <button
            type="button"
            className={state.canvasMode === "text" ? "active" : undefined}
            disabled={!textEditorLayer}
            onClick={() => textEditorLayer && enterTextEdit(textEditorLayer)}
          >
            Edit text
          </button>
          <button
            type="button"
            className={state.canvasMode === "range" ? "active" : undefined}
            onClick={() => dispatch({ type: "set-canvas-mode", mode: "range" })}
          >
            Select range
          </button>
        </div>
        <span>
          {state.canvasMode === "text"
            ? "Click to place the caret · drag to select · Esc exits"
            : state.canvasMode === "range"
              ? "Drag from empty canvas to select visible layers · Shift adds to selection"
              : "Click to select · drag to move · Delete removes selection · double-click Text to edit"}
        </span>
      </fieldset>
      <div className="visual-editor-stage-scroll">
        <div
          className="visual-editor-artboard-zoom"
          style={{
            width: document.canvas.width * state.zoom,
            height: document.canvas.height * state.zoom,
          }}
        >
          <fieldset
            ref={containerRef}
            className={`visual-editor-artboard-content is-${state.canvasMode}${activeInteraction ? ` is-interacting interaction-${activeInteraction}` : ""}`}
            aria-label="Editable canvas"
            style={{
              width: document.canvas.width,
              height: document.canvas.height,
              transform: `scale(${state.zoom})`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => {
              if (!dragRef.current && !marqueeRef.current) {
                setHoveredLayerId(null);
              }
            }}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
          >
            {artifacts ? (
              <div
                className="visual-editor-render"
                dangerouslySetInnerHTML={{ __html: artifacts.svg }}
              />
            ) : (
              <div className="visual-editor-render-error">Render failed: {renderResult.error}</div>
            )}
            {state.present.textEditMode && textEditorLayer && (
              <textarea
                ref={textEditorRef}
                className="visual-editor-text-editor"
                aria-label={`Edit ${textEditorLayer.name}`}
                value={layerText(textEditorLayer)}
                spellCheck={false}
                style={textEditorStyle(textEditorLayer)}
                onChange={(event) => {
                  const selection = textareaSelection(event.currentTarget);
                  dispatch({
                    type: "replace-text",
                    layerId: textEditorLayer.id,
                    text: event.currentTarget.value,
                    record: !compositionActiveRef.current,
                    ...selection,
                  });
                }}
                onCompositionStart={() => {
                  compositionActiveRef.current = true;
                  compositionBeforeRef.current = state.present;
                }}
                onCompositionEnd={(event) => {
                  const before = compositionBeforeRef.current;
                  const selection = textareaSelection(event.currentTarget);
                  compositionActiveRef.current = false;
                  compositionBeforeRef.current = null;
                  dispatch({
                    type: "replace-text",
                    layerId: textEditorLayer.id,
                    text: event.currentTarget.value,
                    record: false,
                    ...selection,
                  });
                  const beforeLayer = before?.document.layers.find(
                    (layer): layer is EditorTextLayer =>
                      layer.id === textEditorLayer.id && layer.type === "text",
                  );
                  if (
                    before &&
                    beforeLayer &&
                    layerText(beforeLayer) !== event.currentTarget.value
                  ) {
                    dispatch({ type: "commit-preview", before });
                  }
                }}
                onSelect={(event) => {
                  const selection = textareaSelection(event.currentTarget);
                  const current = state.present.textSelection;
                  if (
                    current?.layerId !== textEditorLayer.id ||
                    current.anchor !== selection.anchor ||
                    current.focus !== selection.focus
                  ) {
                    dispatch({
                      type: "set-text-selection",
                      layerId: textEditorLayer.id,
                      ...selection,
                    });
                  }
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    dispatch({ type: "set-text-edit", enabled: false });
                    dispatch({ type: "clear-text-selection" });
                  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                    event.preventDefault();
                    dispatch({ type: event.shiftKey ? "redo" : "undo" });
                  }
                }}
              />
            )}
            <svg
              className="visual-editor-text-selection"
              viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
              aria-hidden="true"
            >
              {selectionQuads.map((quad, index) => (
                <polygon
                  key={`${quad.nodeId}:${quad.sourceStart}:${index}`}
                  points={quad.points.map((point) => `${point.x},${point.y}`).join(" ")}
                />
              ))}
              {caretSegment && (
                <line
                  className="visual-editor-text-caret"
                  data-node-id={caretSegment.nodeId}
                  data-offset={caretSegment.offset}
                  x1={caretSegment.start.x}
                  y1={caretSegment.start.y}
                  x2={caretSegment.end.x}
                  y2={caretSegment.end.y}
                />
              )}
            </svg>
            {hoveredLayer &&
              state.canvasMode === "move" &&
              !state.present.selectedLayerIds.includes(hoveredLayer.id) && (
                <HoverTargetFrame layer={hoveredLayer} />
              )}
            {marquee && <MarqueeFrame selection={marquee} />}
            {selectedLayer && selectedLayers.length === 1 && (
              <SelectionFrame
                layer={selectedLayer}
                editing={state.present.textEditMode}
                interaction={activeInteraction}
                primary
                showControls
                showLabel
                onStart={startHandleDrag}
              />
            )}
            {selectedLayers.length > 1 && layerSelectionBounds && (
              <>
                {selectedLayers.map((layer) => (
                  <SelectionFrame
                    key={layer.id}
                    layer={layer}
                    editing={false}
                    interaction={activeInteraction}
                    primary={layer.id === state.present.selectedLayerId}
                    showControls={false}
                    showLabel={false}
                    onStart={startHandleDrag}
                  />
                ))}
                <MultiSelectionFrame
                  bounds={layerSelectionBounds}
                  layers={selectedLayers}
                  interaction={activeInteraction}
                  dispatch={dispatch}
                  onStart={startGroupHandleDrag}
                  onBooleanOperation={onBooleanOperation}
                />
              </>
            )}
            {contextMenuPoint && (
              <SelectionContextMenu
                point={contextMenuPoint}
                layers={selectedLayers}
                primaryLayerId={state.present.selectedLayerId}
                dispatch={dispatch}
                onBooleanOperation={onBooleanOperation}
                onClose={() => setContextMenuPoint(null)}
              />
            )}
            {state.present.textSelection &&
              state.present.textSelection.anchor !== state.present.textSelection.focus && (
                <RichToolbar
                  layer={selectedLayer}
                  selection={state.present.textSelection}
                  selectionBounds={selectionBounds}
                  canvasWidth={document.canvas.width}
                  canvasHeight={document.canvas.height}
                  dispatch={dispatch}
                  onReturnFocus={() =>
                    requestAnimationFrame(() =>
                      textEditorRef.current?.focus({ preventScroll: true }),
                    )
                  }
                  onExit={() => {
                    dispatch({ type: "set-text-edit", enabled: false });
                    dispatch({ type: "clear-text-selection" });
                  }}
                />
              )}
          </fieldset>
        </div>
      </div>
      <div className="visual-editor-status">
        <button
          ref={keyboardTargetRef}
          type="button"
          onKeyDown={(event) => handleKeyDown(event, state, dispatch)}
        >
          Canvas shortcuts
        </button>
        <span>{Math.round(state.zoom * 100)}%</span>
        <span>
          {interactionStatus(
            activeInteraction,
            state.canvasMode,
            selectedLayer,
            selectedLayers.length,
          )}
        </span>
        {state.present.textSelection && (
          <span>
            range {state.present.textSelection.anchor}–{state.present.textSelection.focus}
          </span>
        )}
        <span>
          {document.canvas.width} × {document.canvas.height}px
        </span>
      </div>
    </div>
  );
}

function sameLayerIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((layerId, index) => layerId === right[index]);
}

function marqueeBounds(selection: MarqueeSelection): SelectionBounds {
  return {
    left: Math.min(selection.start.x, selection.current.x),
    top: Math.min(selection.start.y, selection.current.y),
    right: Math.max(selection.start.x, selection.current.x),
    bottom: Math.max(selection.start.y, selection.current.y),
  };
}

function HoverTargetFrame({ layer }: { layer: EditorLayer }) {
  return (
    <div
      className="visual-editor-hover-target"
      style={{
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        transform: `rotate(${layer.rotateDeg}deg)`,
      }}
    >
      <span>{`${layer.name} · click to ${layer.locked ? "select" : "move"}`}</span>
    </div>
  );
}

function MarqueeFrame({ selection }: { selection: MarqueeSelection }) {
  const bounds = marqueeBounds(selection);
  return (
    <div
      className="visual-editor-marquee"
      data-testid="visual-editor-marquee"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      }}
    />
  );
}

function SelectionFrame({
  layer,
  editing,
  interaction,
  primary,
  showControls,
  showLabel,
  onStart,
}: {
  layer: EditorLayer;
  editing: boolean;
  interaction: ActiveInteraction | null;
  primary: boolean;
  showControls: boolean;
  showLabel: boolean;
  onStart: (
    event: ReactPointerEvent<HTMLElement>,
    mode: "resize" | "rotate",
    handle?: ResizeHandle,
  ) => void;
}) {
  return (
    <div
      className={`visual-editor-selection${layer.locked ? " is-locked" : ""}${editing ? " is-editing" : ""}${primary ? " is-primary" : " is-member"}${interaction ? ` is-${interaction}` : ""}`}
      style={{
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        transform: `rotate(${layer.rotateDeg}deg)`,
      }}
    >
      {!layer.locked &&
        !editing &&
        showControls &&
        (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((handle) => (
          <Tooltip
            key={handle}
            label={RESIZE_HANDLE_LABELS[handle]}
            className={`visual-editor-transform-target handle-${handle}`}
          >
            <button
              type="button"
              aria-label={`Resize ${handle}`}
              className="visual-editor-handle"
              data-editor-transform-handle={handle}
              onPointerDown={(event) => onStart(event, "resize", handle)}
            />
          </Tooltip>
        ))}
      {!layer.locked && !editing && showControls && (
        <>
          <span className="visual-editor-rotate-guide" aria-hidden="true" />
          <Tooltip
            label={`Drag to rotate · ${Math.round(layer.rotateDeg)}°`}
            className="visual-editor-transform-target visual-editor-rotate-target"
          >
            <button
              type="button"
              aria-label="Rotate layer"
              className="visual-editor-rotate-handle"
              data-editor-transform-handle="rotate"
              onPointerDown={(event) => onStart(event, "rotate")}
            />
          </Tooltip>
        </>
      )}
      {showLabel && (
        <span className="visual-editor-selection-label">
          {layer.name}
          {editing ? " · editing" : ""}
          {interaction === "move" ? " · moving" : ""}
          {interaction === "resize" ? " · resizing" : ""}
          {interaction === "rotate" ? " · rotating" : ""}
        </span>
      )}
    </div>
  );
}

function MultiSelectionFrame({
  bounds,
  layers,
  interaction,
  dispatch,
  onStart,
  onBooleanOperation,
}: {
  bounds: SelectionBounds;
  layers: EditorLayer[];
  interaction: ActiveInteraction | null;
  dispatch: (action: EditorAction) => void;
  onStart: (
    event: ReactPointerEvent<HTMLElement>,
    mode: "resize" | "rotate",
    handle?: ResizeHandle,
  ) => void;
  onBooleanOperation: (operation: BooleanOp) => void;
}) {
  const firstGroupId = layers[0]?.groupId;
  const isSingleGroup =
    firstGroupId !== undefined && layers.every((layer) => layer.groupId === firstGroupId);
  const includesGroup = layers.some((layer) => layer.groupId !== undefined);
  const hasLockedMember = layers.some((layer) => layer.locked);
  const booleanAvailability = resolveBooleanAvailability(layers);
  return (
    <div
      className={`visual-editor-multi-selection${isSingleGroup ? " is-group" : ""}${hasLockedMember ? " is-locked" : ""}${interaction ? ` is-${interaction}` : ""}`}
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      }}
    >
      <span className="visual-editor-selection-label">
        {isSingleGroup ? `Group · ${layers.length} layers` : `${layers.length} layers selected`}
        {interaction === "move" ? " · moving" : ""}
        {interaction === "resize" ? " · scaling" : ""}
        {interaction === "rotate" ? " · rotating" : ""}
      </span>
      {isSingleGroup &&
        (["nw", "ne", "se", "sw"] as const).map((handle) => (
          <Tooltip
            key={handle}
            label={
              hasLockedMember
                ? "Unlock every group member to resize the group"
                : "Drag to scale the group proportionally"
            }
            className={`visual-editor-transform-target handle-${handle}`}
          >
            <button
              type="button"
              aria-label={`Resize group ${handle}`}
              className="visual-editor-handle"
              data-editor-transform-handle={handle}
              disabled={hasLockedMember}
              onPointerDown={(event) => onStart(event, "resize", handle)}
            />
          </Tooltip>
        ))}
      {isSingleGroup && (
        <>
          <span className="visual-editor-rotate-guide" aria-hidden="true" />
          <Tooltip
            label={
              hasLockedMember
                ? "Unlock every group member to rotate the group"
                : "Drag to rotate the group around its center"
            }
            className="visual-editor-transform-target visual-editor-rotate-target"
          >
            <button
              type="button"
              aria-label="Rotate group"
              className="visual-editor-rotate-handle"
              data-editor-transform-handle="rotate-group"
              disabled={hasLockedMember}
              onPointerDown={(event) => onStart(event, "rotate")}
            />
          </Tooltip>
        </>
      )}
      <div
        className="visual-editor-selection-actions"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip
          label={
            isSingleGroup
              ? "These layers already belong to one group"
              : "Assign one group to the selected layers"
          }
        >
          <button
            type="button"
            aria-label="Group selected layers"
            disabled={isSingleGroup}
            onClick={() => dispatch({ type: "group-selection" })}
          >
            Group
          </button>
        </Tooltip>
        <Tooltip
          label={
            includesGroup
              ? "Remove grouping from every selected group"
              : "Select grouped layers to ungroup them"
          }
        >
          <button
            type="button"
            aria-label="Ungroup selected layers"
            disabled={!includesGroup}
            onClick={() => dispatch({ type: "ungroup-selection" })}
          >
            Ungroup
          </button>
        </Tooltip>
        {BOOLEAN_ACTIONS.map((action) => (
          <Tooltip key={action.operation} label={booleanAvailability.tooltip(action.operation)}>
            <button
              type="button"
              aria-label={`${action.label} selected shapes`}
              disabled={!booleanAvailability.enabled}
              onClick={() => onBooleanOperation(action.operation)}
            >
              {action.label}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

const BOOLEAN_ACTIONS: Array<{ operation: BooleanOp; label: string }> = [
  { operation: "union", label: "Union" },
  { operation: "subtract", label: "Subtract" },
  { operation: "intersect", label: "Intersect" },
  { operation: "xor", label: "Exclude" },
];

function resolveBooleanAvailability(layers: EditorLayer[]): {
  enabled: boolean;
  tooltip: (operation: BooleanOp) => string;
} {
  const enabled =
    layers.length >= 2 &&
    layers.every((layer) => layer.type === "shape" && layer.visible && !layer.locked);
  return {
    enabled,
    tooltip(operation) {
      if (enabled) {
        return operation === "subtract"
          ? "Subtract front Shapes from the backmost selected Shape"
          : `Replace selected Shapes with one ${operation} result`;
      }
      if (layers.length < 2) {
        return "Select at least two Shapes";
      }
      if (layers.some((layer) => layer.type !== "shape")) {
        return "Boolean operations require a Shape-only selection";
      }
      if (layers.some((layer) => !layer.visible)) {
        return "Show every selected Shape before applying a Boolean operation";
      }
      return "Unlock every selected Shape before applying a Boolean operation";
    },
  };
}

function SelectionContextMenu({
  point,
  layers,
  primaryLayerId,
  dispatch,
  onBooleanOperation,
  onClose,
}: {
  point: CanvasPoint;
  layers: EditorLayer[];
  primaryLayerId: string | null;
  dispatch: (action: EditorAction) => void;
  onBooleanOperation: (operation: BooleanOp) => void;
  onClose: () => void;
}) {
  const firstGroupId = layers[0]?.groupId;
  const isSingleGroup =
    firstGroupId !== undefined && layers.every((layer) => layer.groupId === firstGroupId);
  const includesGroup = layers.some((layer) => layer.groupId !== undefined);
  const booleanAvailability = resolveBooleanAvailability(layers);
  const invoke = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <div
      className="visual-editor-context-menu"
      role="menu"
      aria-label="Selection actions"
      style={{ left: point.x, top: point.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={layers.length < 2 || isSingleGroup}
        onClick={() => invoke(() => dispatch({ type: "group-selection" }))}
      >
        Group
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!includesGroup}
        onClick={() => invoke(() => dispatch({ type: "ungroup-selection" }))}
      >
        Ungroup
      </button>
      <hr className="visual-editor-context-separator" />
      {BOOLEAN_ACTIONS.map((action) => (
        <button
          key={action.operation}
          type="button"
          role="menuitem"
          title={booleanAvailability.tooltip(action.operation)}
          disabled={!booleanAvailability.enabled}
          onClick={() => invoke(() => onBooleanOperation(action.operation))}
        >
          {action.label}
        </button>
      ))}
      <hr className="visual-editor-context-separator" />
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        disabled={!primaryLayerId}
        onClick={() =>
          invoke(() => {
            if (primaryLayerId) {
              dispatch({ type: "delete-layer", layerId: primaryLayerId });
            }
          })
        }
      >
        Delete selection
      </button>
    </div>
  );
}

type FormatAvailability = { enabled: boolean; tooltip: string };
type RichTextCapabilities = {
  ruby: FormatAvailability;
  upright: FormatAvailability;
  tcy: FormatAvailability;
  accent: FormatAvailability;
  clear: FormatAvailability;
};
type RichSelectionContext = {
  selectedText: string;
  editableText: string;
  includesRuby: boolean;
  includesInline: boolean;
  vertical: boolean;
};

function unavailableFormat(tooltip: string): FormatAvailability {
  return { enabled: false, tooltip };
}

function resolveRichTextCapabilities(
  layer: EditorTextLayer,
  selection: EditorTextSelection | null,
): RichTextCapabilities {
  if (!selection || selection.layerId !== layer.id || selection.anchor === selection.focus) {
    const noSelection = unavailableFormat("Select text to use this action");
    return {
      ruby: noSelection,
      upright: noSelection,
      tcy: noSelection,
      accent: noSelection,
      clear: noSelection,
    };
  }

  const context = collectRichSelectionContext(layer, selection);
  return {
    ruby: rubyAvailability(context),
    upright: uprightAvailability(context),
    tcy: tcyAvailability(context),
    accent: accentAvailability(context),
    clear: clearAvailability(context),
  };
}

function collectRichSelectionContext(
  layer: EditorTextLayer,
  selection: EditorTextSelection,
): RichSelectionContext {
  const rangeStart = Math.min(selection.anchor, selection.focus);
  const rangeEnd = Math.max(selection.anchor, selection.focus);
  let cursor = 0;
  let selectedText = "";
  let editableText = "";
  let includesRuby = false;
  let includesInline = false;
  for (const run of layer.runs) {
    const runContent = run.kind === "ruby" ? run.base : run.text;
    const graphemes = splitEditorGraphemes(runContent);
    const overlapStart = Math.max(rangeStart, cursor);
    const overlapEnd = Math.min(rangeEnd, cursor + graphemes.length);
    if (overlapStart < overlapEnd) {
      const fragment = graphemes.slice(overlapStart - cursor, overlapEnd - cursor).join("");
      selectedText += fragment;
      if (run.kind === "ruby") {
        includesRuby = true;
      } else {
        editableText += fragment;
        includesInline ||= run.kind === "inline";
      }
    }
    cursor += graphemes.length;
  }
  return {
    selectedText,
    editableText,
    includesRuby,
    includesInline,
    vertical: layer.writingMode === "vertical-rl",
  };
}

function rubyAvailability(context: RichSelectionContext): FormatAvailability {
  if (context.includesRuby || context.includesInline) {
    return unavailableFormat(
      "Ruby cannot replace an existing Ruby or Inline run; clear that formatting first",
    );
  }
  return { enabled: true, tooltip: "Add a Ruby reading to the selected base text" };
}

function uprightAvailability(context: RichSelectionContext): FormatAvailability {
  if (!context.vertical) {
    return unavailableFormat("Upright is available for vertical text only");
  }
  if (!/[\p{Script=Latin}\p{Number}]/u.test(context.editableText)) {
    return unavailableFormat("Select Latin letters or numbers outside Ruby annotations");
  }
  return {
    enabled: true,
    tooltip: context.includesRuby
      ? "Keep eligible letters upright; existing Ruby annotations are preserved"
      : "Keep the selected Latin letters or numbers upright in vertical text",
  };
}

function tcyAvailability(context: RichSelectionContext): FormatAvailability {
  if (!context.vertical) {
    return unavailableFormat("TCY is available for vertical text only");
  }
  if (context.includesRuby) {
    return unavailableFormat("TCY cannot include Ruby annotations");
  }
  const graphemeCount = splitEditorGraphemes(context.selectedText).length;
  if (graphemeCount < 1 || graphemeCount > 4 || !/^[A-Za-z0-9]+$/.test(context.selectedText)) {
    return unavailableFormat("Select one to four Latin letters or digits for TCY");
  }
  return { enabled: true, tooltip: "Combine the selection into one horizontal unit" };
}

function accentAvailability(context: RichSelectionContext): FormatAvailability {
  if (!context.editableText) {
    return unavailableFormat("Select ordinary text outside Ruby annotations");
  }
  return {
    enabled: true,
    tooltip: context.includesRuby
      ? "Apply the accent to ordinary text; existing Ruby annotations are preserved"
      : "Apply the cyan inline accent color to the selection",
  };
}

function clearAvailability(context: RichSelectionContext): FormatAvailability {
  if (!context.includesRuby && !context.includesInline) {
    return unavailableFormat("The selection has no Ruby or inline formatting to remove");
  }
  return { enabled: true, tooltip: "Remove Ruby and inline formatting from the selection" };
}

function RichToolbar({
  layer,
  selection,
  selectionBounds,
  canvasWidth,
  canvasHeight,
  dispatch,
  onReturnFocus,
  onExit,
}: {
  layer: EditorLayer | undefined;
  selection: EditorTextSelection | null;
  selectionBounds: SelectionBounds | null;
  canvasWidth: number;
  canvasHeight: number;
  dispatch: (action: EditorAction) => void;
  onReturnFocus: () => void;
  onExit: () => void;
}) {
  const [rubyDraft, setRubyDraft] = useState<string | null>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 320, height: 36 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const rubyInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rubyDraft !== null) {
      rubyInputRef.current?.focus({ preventScroll: true });
    }
  }, [rubyDraft]);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) {
      return;
    }
    const updateToolbarSize = () => {
      const nextSize = { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
      setToolbarSize((currentSize) =>
        currentSize.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize,
      );
    };
    updateToolbarSize();
    const resizeObserver = new ResizeObserver(updateToolbarSize);
    resizeObserver.observe(toolbar);
    return () => resizeObserver.disconnect();
  }, []);
  if (!layer || layer.type !== "text" || !selectionBounds) {
    return null;
  }
  const capabilities = resolveRichTextCapabilities(layer, selection);
  const position = resolveToolbarPosition(selectionBounds, canvasWidth, canvasHeight, toolbarSize);
  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Selected text formatting"
      className={`visual-editor-rich-toolbar is-${position.placement}`}
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="visual-editor-rich-format-actions">
        {rubyDraft === null ? (
          <Tooltip label={capabilities.ruby.tooltip}>
            <button
              type="button"
              disabled={!capabilities.ruby.enabled}
              onClick={() => setRubyDraft("")}
            >
              Ruby
            </button>
          </Tooltip>
        ) : (
          <form
            className="visual-editor-ruby-form"
            onSubmit={(event) => {
              event.preventDefault();
              const reading = rubyDraft.trim();
              if (reading) {
                dispatch({ type: "apply-ruby", rubyText: reading });
                setRubyDraft(null);
                onReturnFocus();
              }
            }}
          >
            <input
              ref={rubyInputRef}
              aria-label="Ruby reading"
              value={rubyDraft}
              placeholder="Reading"
              onChange={(event) => setRubyDraft(event.target.value)}
            />
            <Tooltip label="Apply this reading to the selected text">
              <button type="submit" className="is-primary" disabled={!rubyDraft.trim()}>
                Apply
              </button>
            </Tooltip>
            <Tooltip label="Cancel Ruby editing">
              <button type="button" aria-label="Cancel Ruby" onClick={() => setRubyDraft(null)}>
                ×
              </button>
            </Tooltip>
          </form>
        )}
        <Tooltip label={capabilities.upright.tooltip}>
          <button
            type="button"
            disabled={!capabilities.upright.enabled}
            onClick={() => {
              dispatch({ type: "apply-inline", patch: { textOrientation: "upright" } });
              onReturnFocus();
            }}
          >
            Upright
          </button>
        </Tooltip>
        <Tooltip label={capabilities.tcy.tooltip}>
          <button
            type="button"
            disabled={!capabilities.tcy.enabled}
            onClick={() => {
              dispatch({ type: "apply-inline", patch: { textCombineUpright: "all" } });
              onReturnFocus();
            }}
          >
            TCY
          </button>
        </Tooltip>
        <Tooltip label={capabilities.accent.tooltip}>
          <button
            type="button"
            disabled={!capabilities.accent.enabled}
            onClick={() => {
              dispatch({ type: "apply-inline", patch: { color: "#38bdf8" } });
              onReturnFocus();
            }}
          >
            Accent
          </button>
        </Tooltip>
        <Tooltip label={capabilities.clear.tooltip}>
          <button
            type="button"
            className="is-clear"
            disabled={!capabilities.clear.enabled}
            onClick={() => {
              dispatch({ type: "clear-rich-format" });
              onReturnFocus();
            }}
          >
            Clear
          </button>
        </Tooltip>
      </div>
      <span className="visual-editor-rich-toolbar-separator" aria-hidden="true" />
      <Tooltip label="Finish text editing and return to Move layers" align="end">
        <button type="button" className="is-done" onClick={onExit}>
          Done
        </button>
      </Tooltip>
    </div>
  );
}

function applyDrag(
  drag: DragState,
  point: { x: number; y: number },
  state: EditorState,
  selectionMap: TextSelectionMap | undefined,
  dispatch: (action: EditorAction) => void,
) {
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  if (drag.mode === "text-select" && selectionMap && drag.anchor !== undefined) {
    const candidateNodeIds = Array.from(selectionMap.nodes.keys()).filter(
      (nodeId) => resolveLayerId(nodeId, state.present.document.layers) === drag.layer.id,
    );
    const hit = candidateNodeIds
      .map((nodeId) => resolveGlobalCaret(selectionMap, nodeId, point))
      .find((caret): caret is GlobalCaret => caret !== null);
    if (hit !== undefined) {
      dispatch({
        type: "set-text-selection",
        layerId: drag.layer.id,
        anchor: drag.anchor,
        focus: hit.offset,
        focusAffinity: hit.affinity,
      });
    }
    return;
  }
  if (!drag.changed && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
    return;
  }
  if (drag.mode === "move") {
    const canvas = state.present.document.canvas;
    const delta = resolveSelectionMoveDelta(drag.layers, canvas, dx, dy);
    if (delta.x === 0 && delta.y === 0) {
      return;
    }
    drag.changed = true;
    dispatch({
      type: "patch-layers",
      record: false,
      patches: drag.layers.map((layer) => ({
        layerId: layer.id,
        patch: {
          x: layer.x + delta.x,
          y: layer.y + delta.y,
        },
      })),
    });
    return;
  }
  drag.changed = true;
  if (drag.mode === "rotate") {
    if (drag.layers.length > 1 && drag.bounds && drag.startAngleDeg !== undefined) {
      const centerX = (drag.bounds.left + drag.bounds.right) / 2;
      const centerY = (drag.bounds.top + drag.bounds.bottom) / 2;
      const currentAngleDeg = radiansToDegrees(Math.atan2(point.y - centerY, point.x - centerX));
      const deltaDeg = normalizeAngleDelta(currentAngleDeg - drag.startAngleDeg);
      dispatch({
        type: "patch-layers",
        record: false,
        patches: rotateLayerSelection(
          drag.layers,
          drag.bounds,
          deltaDeg,
          state.present.document.canvas,
        ),
      });
      return;
    }
    const centerX = drag.layer.x + drag.layer.width / 2;
    const centerY = drag.layer.y + drag.layer.height / 2;
    const angle = (Math.atan2(point.y - centerY, point.x - centerX) * 180) / Math.PI + 90;
    dispatch({
      type: "patch-layer",
      layerId: drag.layer.id,
      record: false,
      patch: { rotateDeg: Math.round(angle) },
    });
    return;
  }
  if (drag.mode === "resize" && drag.handle) {
    if (drag.layers.length > 1 && drag.bounds) {
      dispatch({
        type: "patch-layers",
        record: false,
        patches: scaleLayerSelection(
          drag.layers,
          drag.bounds,
          drag.handle,
          point,
          state.present.document.canvas,
        ),
      });
      return;
    }
    const patch = resizeFrame(drag.layer, drag.handle, dx, dy);
    dispatch({ type: "patch-layer", layerId: drag.layer.id, record: false, patch });
  }
}

export function rotateLayerSelection(
  layers: EditorLayer[],
  bounds: SelectionBounds,
  deltaDeg: number,
  canvas: { width: number; height: number },
): Array<{ layerId: string; patch: Partial<EditorLayer> }> {
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const radians = (deltaDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const transformedLayers = layers.map((layer): EditorLayer => {
    const layerCenterX = layer.x + layer.width / 2;
    const layerCenterY = layer.y + layer.height / 2;
    const offsetX = layerCenterX - centerX;
    const offsetY = layerCenterY - centerY;
    const nextCenterX = centerX + offsetX * cosine - offsetY * sine;
    const nextCenterY = centerY + offsetX * sine + offsetY * cosine;
    return {
      ...layer,
      x: roundEditorValue(nextCenterX - layer.width / 2),
      y: roundEditorValue(nextCenterY - layer.height / 2),
      rotateDeg: roundEditorValue(normalizeAngle(layer.rotateDeg + deltaDeg)),
    };
  });
  return transformedLayerPatches(clampLayerSelection(transformedLayers, canvas));
}

export function scaleLayerSelection(
  layers: EditorLayer[],
  bounds: SelectionBounds,
  handle: ResizeHandle,
  point: CanvasPoint,
  canvas: { width: number; height: number },
): Array<{ layerId: string; patch: Partial<EditorLayer> }> {
  const corners = groupScaleCorners(bounds, handle);
  if (!corners) {
    return transformedLayerPatches(layers);
  }
  const vectorX = corners.dragged.x - corners.anchor.x;
  const vectorY = corners.dragged.y - corners.anchor.y;
  const vectorLengthSquared = vectorX * vectorX + vectorY * vectorY;
  if (vectorLengthSquared === 0) {
    return transformedLayerPatches(layers);
  }
  const rawScale =
    ((point.x - corners.anchor.x) * vectorX + (point.y - corners.anchor.y) * vectorY) /
    vectorLengthSquared;
  const minimumScale = Math.max(
    ...layers.flatMap((layer) => [MIN_LAYER_SIZE / layer.width, MIN_LAYER_SIZE / layer.height]),
  );
  const maximumScale = Math.min(
    canvas.width / Math.max(1, bounds.right - bounds.left),
    canvas.height / Math.max(1, bounds.bottom - bounds.top),
  );
  const scale = clamp(rawScale, minimumScale, Math.max(minimumScale, maximumScale));
  const transformedLayers = layers.map((layer): EditorLayer => {
    const layerCenterX = layer.x + layer.width / 2;
    const layerCenterY = layer.y + layer.height / 2;
    const width = roundEditorValue(layer.width * scale);
    const height = roundEditorValue(layer.height * scale);
    const nextCenterX = corners.anchor.x + (layerCenterX - corners.anchor.x) * scale;
    const nextCenterY = corners.anchor.y + (layerCenterY - corners.anchor.y) * scale;
    return {
      ...layer,
      x: roundEditorValue(nextCenterX - width / 2),
      y: roundEditorValue(nextCenterY - height / 2),
      width,
      height,
    };
  });
  return transformedLayerPatches(clampLayerSelection(transformedLayers, canvas));
}

function transformedLayerPatches(
  transformedLayers: EditorLayer[],
): Array<{ layerId: string; patch: Partial<EditorLayer> }> {
  return transformedLayers.map((layer) => {
    return {
      layerId: layer.id,
      patch: {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotateDeg: layer.rotateDeg,
      },
    };
  });
}

function clampLayerSelection(
  layers: EditorLayer[],
  canvas: { width: number; height: number },
): EditorLayer[] {
  const bounds = resolveLayerSelectionBounds(layers);
  if (!bounds) {
    return layers;
  }
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const translateX =
    width > canvas.width
      ? 0
      : bounds.left < 0
        ? -bounds.left
        : bounds.right > canvas.width
          ? canvas.width - bounds.right
          : 0;
  const translateY =
    height > canvas.height
      ? 0
      : bounds.top < 0
        ? -bounds.top
        : bounds.bottom > canvas.height
          ? canvas.height - bounds.bottom
          : 0;
  return layers.map((layer) => ({
    ...layer,
    x: roundEditorValue(layer.x + translateX),
    y: roundEditorValue(layer.y + translateY),
  }));
}

function groupScaleCorners(
  bounds: SelectionBounds,
  handle: ResizeHandle,
): { anchor: CanvasPoint; dragged: CanvasPoint } | null {
  const topLeft = { x: bounds.left, y: bounds.top };
  const topRight = { x: bounds.right, y: bounds.top };
  const bottomRight = { x: bounds.right, y: bounds.bottom };
  const bottomLeft = { x: bounds.left, y: bounds.bottom };
  switch (handle) {
    case "nw":
      return { anchor: bottomRight, dragged: topLeft };
    case "ne":
      return { anchor: bottomLeft, dragged: topRight };
    case "se":
      return { anchor: topLeft, dragged: bottomRight };
    case "sw":
      return { anchor: topRight, dragged: bottomLeft };
    case "n":
    case "e":
    case "s":
    case "w":
      return null;
  }
}

function normalizeAngle(angleDeg: number): number {
  return ((angleDeg % 360) + 360) % 360;
}

function normalizeAngleDelta(angleDeg: number): number {
  return ((angleDeg + 180) % 360) - 180;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function roundEditorValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resizeFrame(layer: EditorLayer, handle: ResizeHandle, dx: number, dy: number) {
  let { x, y, width, height } = layer;
  if (handle.includes("e")) {
    width = Math.max(MIN_LAYER_SIZE, layer.width + dx);
  }
  if (handle.includes("s")) {
    height = Math.max(MIN_LAYER_SIZE, layer.height + dy);
  }
  if (handle.includes("w")) {
    width = Math.max(MIN_LAYER_SIZE, layer.width - dx);
    x = layer.x + (layer.width - width);
  }
  if (handle.includes("n")) {
    height = Math.max(MIN_LAYER_SIZE, layer.height - dy);
    y = layer.y + (layer.height - height);
  }
  return { x, y, width, height };
}

export function resolvePointerLayerId(
  nodeId: string | null,
  point: CanvasPoint,
  selectedLayer: EditorLayer | undefined,
  layers: EditorLayer[],
): string | null {
  const renderedLayerId = resolveLayerId(nodeId, layers);
  const renderedLayerIndex = renderedLayerId
    ? layers.findIndex((layer) => layer.id === renderedLayerId)
    : -1;
  for (let index = layers.length - 1; index > renderedLayerIndex; index -= 1) {
    const layer = layers[index];
    if (layer?.type === "box" && layer.visible && isPointInsideLayerFrame(point, layer)) {
      return layer.id;
    }
  }
  if (renderedLayerId) {
    return renderedLayerId;
  }
  if (!selectedLayer) {
    return null;
  }
  return isPointInsideLayerFrame(point, selectedLayer) ? selectedLayer.id : null;
}

function isPointInsideLayerFrame(point: CanvasPoint, layer: EditorLayer): boolean {
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;
  const radians = (-layer.rotateDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const offsetX = point.x - centerX;
  const offsetY = point.y - centerY;
  const localX = centerX + offsetX * cosine - offsetY * sine;
  const localY = centerY + offsetX * sine + offsetY * cosine;
  return (
    localX >= layer.x &&
    localX <= layer.x + layer.width &&
    localY >= layer.y &&
    localY <= layer.y + layer.height
  );
}

function resolveTextSelectionStart(options: {
  layer: EditorLayer;
  nodeId: string | null;
  point: CanvasPoint;
  textEditMode: boolean;
  textSelectionMap: TextSelectionMap | undefined;
  layers: EditorLayer[];
  before: EditorPresent;
}): TextSelectionStart | null {
  const { layer, nodeId, point, textEditMode, textSelectionMap, layers, before } = options;
  if (layer.type !== "text" || !textEditMode || !textSelectionMap) {
    return null;
  }
  const selectionNodeId =
    (nodeId && textSelectionMap.nodes.has(nodeId) ? nodeId : undefined) ??
    Array.from(textSelectionMap.nodes.keys()).find(
      (candidateNodeId) => resolveLayerId(candidateNodeId, layers) === layer.id,
    );
  if (!selectionNodeId) {
    return null;
  }
  const caret = resolveGlobalCaret(textSelectionMap, selectionNodeId, point);
  if (!caret) {
    return null;
  }
  return {
    selection: {
      layerId: layer.id,
      anchor: caret.offset,
      focus: caret.offset,
      focusAffinity: caret.affinity,
    },
    drag: {
      mode: "text-select",
      before,
      layer,
      layers: [layer],
      startX: point.x,
      startY: point.y,
      anchor: caret.offset,
    },
  };
}

function resolveLayerId(nodeId: string | null, layers: EditorLayer[]): string | null {
  if (!nodeId) {
    return null;
  }
  return (
    layers.find(
      (layer) =>
        nodeId === layer.id ||
        nodeId.startsWith(`${layer.id}:`) ||
        nodeId.startsWith(`${layer.id}__flow__`),
    )?.id ?? null
  );
}

function resolveGlobalCaret(
  selectionMap: TextSelectionMap,
  nodeId: string,
  point: { x: number; y: number },
): GlobalCaret | null {
  const caret = findTextCaretAtPoint(selectionMap, nodeId, { svgX: point.x, svgY: point.y });
  if (!caret) {
    return null;
  }
  return {
    offset: flowSourceStart(nodeId) + caret.offset,
    affinity: caret.affinity,
  };
}

function flowSourceStart(nodeId: string): number {
  const match = /__flow__(\d+)__/.exec(nodeId);
  return match?.[1] ? Number(match[1]) : 0;
}

function resolveSelectionQuads(
  selectionMap: TextSelectionMap | undefined,
  state: EditorState,
): TextSelectionQuad[] {
  const selection = state.present.textSelection;
  if (!selectionMap || !selection) {
    return [];
  }
  const start = Math.min(selection.anchor, selection.focus);
  const end = Math.max(selection.anchor, selection.focus);
  return Array.from(selectionMap.nodes.keys()).flatMap((nodeId) => {
    if (resolveLayerId(nodeId, state.present.document.layers) !== selection.layerId) {
      return [];
    }
    const base = flowSourceStart(nodeId);
    return getTextRangeQuads(selectionMap, nodeId, { start: start - base, end: end - base });
  });
}

function resolveSelectionBounds(quads: TextSelectionQuad[]): SelectionBounds | null {
  if (quads.length === 0) {
    return null;
  }
  const points = quads.flatMap((quad) => quad.points);
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

export function resolveLayerSelectionBounds(layers: EditorLayer[]): SelectionBounds | null {
  if (layers.length === 0) {
    return null;
  }
  const points = layers.flatMap(resolveLayerQuad);
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

export function resolveSelectionMoveDelta(
  layers: EditorLayer[],
  canvas: { width: number; height: number },
  dx: number,
  dy: number,
): CanvasPoint {
  const bounds = resolveLayerSelectionBounds(layers);
  if (!bounds) {
    return { x: 0, y: 0 };
  }
  const selectionWidth = bounds.right - bounds.left;
  const selectionHeight = bounds.bottom - bounds.top;
  return {
    x: selectionWidth <= canvas.width ? clamp(dx, -bounds.left, canvas.width - bounds.right) : 0,
    y: selectionHeight <= canvas.height ? clamp(dy, -bounds.top, canvas.height - bounds.bottom) : 0,
  };
}

export function canMoveLayerSelection(layers: EditorLayer[]): boolean {
  return layers.length > 0 && layers.every((layer) => !layer.locked);
}

export function resolveMarqueeLayerIds(layers: EditorLayer[], bounds: SelectionBounds): string[] {
  return layers
    .filter((layer) => layer.visible && quadIntersectsBounds(resolveLayerQuad(layer), bounds))
    .map((layer) => layer.id);
}

function isSingleGroupSelection(layers: EditorLayer[]): boolean {
  const groupId = layers[0]?.groupId;
  return (
    groupId !== undefined && layers.length > 1 && layers.every((layer) => layer.groupId === groupId)
  );
}

function resolveLayerQuad(layer: EditorLayer): CanvasPoint[] {
  const corners = [
    { x: layer.x, y: layer.y },
    { x: layer.x + layer.width, y: layer.y },
    { x: layer.x + layer.width, y: layer.y + layer.height },
    { x: layer.x, y: layer.y + layer.height },
  ];
  if (layer.rotateDeg === 0) {
    return corners;
  }
  const radians = (layer.rotateDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;
  return corners.map((corner) => {
    const offsetX = corner.x - centerX;
    const offsetY = corner.y - centerY;
    return {
      x: centerX + offsetX * cosine - offsetY * sine,
      y: centerY + offsetX * sine + offsetY * cosine,
    };
  });
}

function quadIntersectsBounds(quad: CanvasPoint[], bounds: SelectionBounds): boolean {
  const rectangle = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ];
  if (quad.some((point) => pointInsideBounds(point, bounds))) {
    return true;
  }
  if (rectangle.some((point) => pointInsideConvexPolygon(point, quad))) {
    return true;
  }
  return quad.some((quadStart, index) => {
    const quadEnd = quad[(index + 1) % quad.length];
    if (!quadEnd) {
      return false;
    }
    return rectangle.some((rectangleStart, rectangleIndex) => {
      const rectangleEnd = rectangle[(rectangleIndex + 1) % rectangle.length];
      return rectangleEnd
        ? segmentsIntersect(quadStart, quadEnd, rectangleStart, rectangleEnd)
        : false;
    });
  });
}

function pointInsideBounds(point: CanvasPoint, bounds: SelectionBounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function pointInsideConvexPolygon(point: CanvasPoint, polygon: CanvasPoint[]): boolean {
  let direction = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) {
      continue;
    }
    const cross = crossProduct(start, end, point);
    if (Math.abs(cross) < Number.EPSILON) {
      continue;
    }
    const nextDirection = Math.sign(cross);
    if (direction !== 0 && nextDirection !== direction) {
      return false;
    }
    direction = nextDirection;
  }
  return true;
}

function segmentsIntersect(
  firstStart: CanvasPoint,
  firstEnd: CanvasPoint,
  secondStart: CanvasPoint,
  secondEnd: CanvasPoint,
): boolean {
  const firstSideStart = crossProduct(firstStart, firstEnd, secondStart);
  const firstSideEnd = crossProduct(firstStart, firstEnd, secondEnd);
  const secondSideStart = crossProduct(secondStart, secondEnd, firstStart);
  const secondSideEnd = crossProduct(secondStart, secondEnd, firstEnd);
  if (
    oppositeSides(firstSideStart, firstSideEnd) &&
    oppositeSides(secondSideStart, secondSideEnd)
  ) {
    return true;
  }
  return (
    (approximatelyZero(firstSideStart) && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (approximatelyZero(firstSideEnd) && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (approximatelyZero(secondSideStart) && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (approximatelyZero(secondSideEnd) && pointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

function crossProduct(start: CanvasPoint, end: CanvasPoint, point: CanvasPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function approximatelyZero(value: number): boolean {
  return Math.abs(value) <= 1e-9;
}

function oppositeSides(first: number, second: number): boolean {
  return (first > 1e-9 && second < -1e-9) || (first < -1e-9 && second > 1e-9);
}

function pointOnSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint): boolean {
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

function clampCanvasPoint(
  point: CanvasPoint,
  canvas: { width: number; height: number },
): CanvasPoint {
  return {
    x: clamp(point.x, 0, canvas.width),
    y: clamp(point.y, 0, canvas.height),
  };
}

function resolveToolbarPosition(
  selectionBounds: SelectionBounds,
  canvasWidth: number,
  canvasHeight: number,
  toolbarSize: { width: number; height: number },
): { left: number; top: number; placement: "above" | "below" } {
  const margin = 8;
  const selectionGap = 10;
  const centerX = (selectionBounds.left + selectionBounds.right) / 2;
  const maxLeft = Math.max(margin, canvasWidth - toolbarSize.width - margin);
  const left = clamp(centerX - toolbarSize.width / 2, margin, maxLeft);
  const aboveTop = selectionBounds.top - toolbarSize.height - selectionGap;
  if (aboveTop >= margin) {
    return { left, top: aboveTop, placement: "above" };
  }
  return {
    left,
    top: clamp(
      selectionBounds.bottom + selectionGap,
      margin,
      Math.max(margin, canvasHeight - toolbarSize.height - margin),
    ),
    placement: "below",
  };
}

function resolveCaretSegment(
  selectionMap: TextSelectionMap | undefined,
  state: EditorState,
): CaretSegment | null {
  const selection = state.present.textSelection;
  if (
    !selectionMap ||
    !state.present.textEditMode ||
    !selection ||
    selection.anchor !== selection.focus
  ) {
    return null;
  }

  const glyphs = Array.from(selectionMap.nodes.values()).flatMap((node) => {
    if (resolveLayerId(node.nodeId, state.present.document.layers) !== selection.layerId) {
      return [];
    }
    const sourceBase = flowSourceStart(node.nodeId);
    return node.glyphs
      .filter((glyph) => glyph.sourceRole !== "rubyAnnotation")
      .map((glyph) => ({
        node,
        glyph,
        sourceStart: sourceBase + glyph.sourceStart,
        sourceEnd: sourceBase + glyph.sourceEnd,
      }));
  });
  if (glyphs.length === 0) {
    return null;
  }

  const offset = selection.focus;
  const affinity = selection.focusAffinity ?? (offset === 0 ? "before" : "after");
  const matchingGlyph =
    affinity === "before"
      ? glyphs.find((entry) => entry.sourceStart === offset)
      : [...glyphs].reverse().find((entry) => entry.sourceEnd === offset);
  const fallbackGlyph =
    matchingGlyph ??
    (offset === 0
      ? glyphs[0]
      : ([...glyphs].reverse().find((entry) => entry.sourceEnd <= offset) ?? glyphs.at(-1)));
  if (!fallbackGlyph) {
    return null;
  }

  const useLeadingEdge = affinity === "before" && fallbackGlyph.sourceStart === offset;
  const [topLeft, topRight, bottomRight, bottomLeft] = fallbackGlyph.glyph.points;
  const [start, end] =
    fallbackGlyph.node.writingMode === "vertical-rl"
      ? useLeadingEdge
        ? [topLeft, topRight]
        : [bottomLeft, bottomRight]
      : useLeadingEdge
        ? [topLeft, bottomLeft]
        : [topRight, bottomRight];
  const nearbyCrossSizes = glyphs
    .filter(
      (entry) =>
        entry.node.nodeId === fallbackGlyph.node.nodeId &&
        entry.sourceStart <= offset + 8 &&
        entry.sourceEnd >= offset - 8,
    )
    .map((entry) => {
      const [entryTopLeft, entryTopRight, , entryBottomLeft] = entry.glyph.points;
      return fallbackGlyph.node.writingMode === "vertical-rl"
        ? pointDistance(entryTopLeft, entryTopRight)
        : pointDistance(entryTopLeft, entryBottomLeft);
    });
  const [adjustedStart, adjustedEnd] = resizeSegmentAroundCenter(
    start,
    end,
    Math.max(pointDistance(start, end), ...nearbyCrossSizes),
  );
  return {
    nodeId: fallbackGlyph.node.nodeId,
    offset,
    start: adjustedStart,
    end: adjustedEnd,
  };
}

function pointDistance(start: { x: number; y: number }, end: { x: number; y: number }): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function resizeSegmentAroundCenter(
  start: { x: number; y: number },
  end: { x: number; y: number },
  length: number,
): [{ x: number; y: number }, { x: number; y: number }] {
  const currentLength = pointDistance(start, end);
  if (currentLength === 0 || length <= currentLength) {
    return [start, end];
  }
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const halfX = ((end.x - start.x) / currentLength) * (length / 2);
  const halfY = ((end.y - start.y) / currentLength) * (length / 2);
  return [
    { x: centerX - halfX, y: centerY - halfY },
    { x: centerX + halfX, y: centerY + halfY },
  ];
}

function textEditorStyle(layer: EditorTextLayer): CSSProperties {
  return {
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    fontFamily: editorFontFamily(layer.font),
    fontSize: layer.fontSizePx,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacingPx,
    textAlign: layer.textAlign,
    color: layer.color,
    writingMode: layer.writingMode,
    textOrientation: layer.textOrientation,
    transform: `rotate(${layer.rotateDeg}deg)`,
  };
}

function editorFontFamily(fontAlias: string): string {
  if (fontAlias.startsWith("NotoSerifJP")) {
    return '"BoundSvg Editor Serif", serif';
  }
  if (fontAlias.startsWith("ZenMaruGothic")) {
    return '"BoundSvg Editor Rounded", sans-serif';
  }
  if (fontAlias.startsWith("Inter")) {
    return '"BoundSvg Editor Inter", sans-serif';
  }
  return '"BoundSvg Editor Sans", sans-serif';
}

function textareaSelection(textarea: HTMLTextAreaElement): { anchor: number; focus: number } {
  const start = utf16OffsetToGraphemeIndex(textarea.value, textarea.selectionStart);
  const end = utf16OffsetToGraphemeIndex(textarea.value, textarea.selectionEnd);
  return textarea.selectionDirection === "backward"
    ? { anchor: end, focus: start }
    : { anchor: start, focus: end };
}

function utf16OffsetToGraphemeIndex(text: string, offset: number): number {
  const graphemes = splitEditorGraphemes(text);
  let consumed = 0;
  for (let index = 0; index < graphemes.length; index += 1) {
    if (offset <= consumed) {
      return index;
    }
    consumed += graphemes[index]?.length ?? 0;
    if (offset < consumed) {
      return index + 1;
    }
  }
  return graphemes.length;
}

function graphemeIndexToUtf16Offset(text: string, index: number): number {
  return splitEditorGraphemes(text)
    .slice(0, index)
    .reduce((length, grapheme) => length + grapheme.length, 0);
}

function handleKeyDown(
  event: EditorKeyboardEvent,
  state: EditorState,
  dispatch: (action: EditorAction) => void,
) {
  if (handleHistoryShortcut(event, dispatch)) {
    return;
  }
  if (event.key === "Escape") {
    dispatch({ type: "set-text-edit", enabled: false });
    dispatch({ type: "clear-text-selection" });
    return;
  }
  const selectedLayers = state.present.document.layers.filter((candidate) =>
    state.present.selectedLayerIds.includes(candidate.id),
  );
  const primaryLayer = selectedLayers.find(
    (candidate) => candidate.id === state.present.selectedLayerId,
  );
  if (!primaryLayer || !canMoveLayerSelection(selectedLayers) || state.present.textEditMode) {
    return;
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    dispatch({ type: "delete-layer", layerId: primaryLayer.id });
    return;
  }
  const step = event.shiftKey ? 10 : 1;
  const delta = resolveArrowDelta(event.key, step);
  if (delta) {
    event.preventDefault();
    dispatch({
      type: "patch-layers",
      patches: selectedLayers.map((layer) => ({
        layerId: layer.id,
        patch: { x: layer.x + (delta.x ?? 0), y: layer.y + (delta.y ?? 0) },
      })),
    });
  }
}

function handleHistoryShortcut(
  event: EditorKeyboardEvent,
  dispatch: (action: EditorAction) => void,
): boolean {
  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") {
    return false;
  }
  event.preventDefault();
  dispatch({ type: key === "y" || event.shiftKey ? "redo" : "undo" });
  return true;
}

function isEditorShortcutInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea" ||
    target.isContentEditable
  );
}

function resolveArrowDelta(key: string, step: number): { x?: number; y?: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { x: -step };
    case "ArrowRight":
      return { x: step };
    case "ArrowUp":
      return { y: -step };
    case "ArrowDown":
      return { y: step };
    default:
      return null;
  }
}

function interactionStatus(
  interaction: ActiveInteraction | null,
  canvasMode: EditorState["canvasMode"],
  selectedLayer: EditorLayer | undefined,
  selectedLayerCount: number,
): string {
  if (interaction === "move") {
    return selectedLayerCount > 1
      ? `Moving ${selectedLayerCount} layers`
      : `Moving ${selectedLayer?.name ?? "layer"}`;
  }
  if (interaction === "resize") {
    return selectedLayerCount > 1
      ? `Scaling ${selectedLayerCount} grouped layers`
      : `Resizing ${selectedLayer?.name ?? "layer"}`;
  }
  if (interaction === "rotate") {
    return selectedLayerCount > 1
      ? `Rotating ${selectedLayerCount} grouped layers`
      : `Rotating ${selectedLayer?.name ?? "layer"}`;
  }
  if (interaction === "text-select") {
    return "Selecting text";
  }
  if (interaction === "range-select") {
    return "Selecting layers";
  }
  if (canvasMode === "text") {
    return "Editing text · Esc returns to Move layers";
  }
  return canvasMode === "range" ? "Select range mode" : "Move layers mode";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
