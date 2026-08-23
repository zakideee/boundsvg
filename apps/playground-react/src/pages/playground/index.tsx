import { createPngObjectUrl, revokePngObjectUrl } from "@boundsvg/browser/png";
import { MAX_TEXT_EFFECT_LAYERS } from "@boundsvg/core";
import { NodeInspectorPanel } from "@boundsvg/react/debug";
import { useBoundSvgInspection } from "@boundsvg/react/inspect";
import { useBoundSvg } from "@boundsvg/react/provider";
import type { BooleanOp } from "@boundsvg/shape";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useState } from "react";
import {
  CheckField,
  ColorField,
  FeatureSettingsField,
  NumberField,
  Section,
  SelectField,
  TextAreaField,
} from "../../components/fields";
import { Tooltip } from "../../components/Tooltip";
import { useMobileViewer } from "../../hooks/use-mobile-viewer";
import { generateFullComponent, generateJsxSnippet } from "../../lib/codegen";
import { FONT_DEFS, fontAlias, type RendererMode } from "../../types";
import { type EditorArtifacts, EditorCanvas } from "./EditorCanvas";
import { buildEditorVNode } from "./editor-builder";
import {
  createInitialEditorState,
  type EditorBoxLayer,
  type EditorDocument,
  type EditorLayer,
  type EditorShapeLayer,
  type EditorTextLayer,
  type EditorTextRun,
  layerText,
} from "./editor-model";
import { EDITOR_PRESETS } from "./editor-presets";
import { type EditorAction, editorReducer } from "./editor-reducer";

type OutputTab = "svg" | "jsx" | "component";

export function PlaygroundPage() {
  const { engine, status } = useBoundSvg();
  const mobileViewer = useMobileViewer();
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialEditorState);
  const [artifacts, setArtifacts] = useState<EditorArtifacts>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [outputTab, setOutputTab] = useState<OutputTab>("jsx");
  const [rendererMode, setRendererMode] = useState<RendererMode>("boundsvg");
  const [operationWarning, setOperationWarning] = useState<string | null>(null);

  const buildResult = useMemo(
    () => (engine ? buildEditorVNode(engine, state.present.document) : null),
    [engine, state.present.document],
  );
  const inspection = useBoundSvgInspection(buildResult?.vnode ?? null, {
    textPathMode: "glyphs",
  });
  const selectedLayer = state.present.document.layers.find(
    (layer) => layer.id === state.present.selectedLayerId,
  );
  const selectedLayers = state.present.document.layers.filter((layer) =>
    state.present.selectedLayerIds.includes(layer.id),
  );
  const canvasWidth = state.present.document.canvas.width;
  const canvasHeight = state.present.document.canvas.height;

  useLayoutEffect(() => {
    if (mobileViewer && state.outputOpen) {
      dispatch({ type: "set-output-open", open: false });
    }
  }, [mobileViewer, state.outputOpen]);

  useEffect(() => {
    if (!mobileViewer) {
      return;
    }
    const fitCanvasToPhone = () => {
      const availableWidth = Math.max(240, window.innerWidth - 44);
      const availableHeight = Math.max(180, window.innerHeight * 0.55);
      dispatch({
        type: "set-zoom",
        zoom: Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight),
      });
    };
    fitCanvasToPhone();
    window.addEventListener("resize", fitCanvasToPhone);
    return () => window.removeEventListener("resize", fitCanvasToPhone);
  }, [canvasHeight, canvasWidth, mobileViewer]);
  const handleArtifacts = useCallback((next: EditorArtifacts) => setArtifacts(next), []);
  const applyBooleanOperation = useCallback(
    (operation: BooleanOp) => {
      if (!engine) {
        return;
      }
      const action = { type: "apply-shape-boolean", operation } as const;
      const candidateState = editorReducer(state, action);
      if (candidateState === state) {
        return;
      }
      try {
        const candidate = buildEditorVNode(engine, candidateState.present.document);
        engine.renderToSvgAndIR(candidate.vnode, { textPathMode: "glyphs" });
        setOperationWarning(null);
        dispatch(action);
      } catch (error) {
        setOperationWarning(
          `Boolean operation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [engine, state],
  );

  if (status !== "ready" || !engine || !buildResult) {
    return <div className="screen-center">Loading editor…</div>;
  }

  const jsx = generateJsxSnippet(buildResult.vnode);
  const component = generateFullComponent(buildResult.vnode, rendererMode);

  return (
    <div className={`visual-editor-shell${state.outputOpen ? " output-open" : ""}`}>
      <EditorToolbar
        state={state}
        dispatch={dispatch}
        onExportSvg={() => exportSvg(artifacts?.svg ?? "")}
        onExportPng={() => exportPng(engine, buildResult.vnode, state.present.document)}
      />

      <div className="visual-editor-workspace">
        <LayerPanel
          layers={state.present.document.layers}
          selectedLayerId={state.present.selectedLayerId}
          selectedLayerIds={state.present.selectedLayerIds}
          dispatch={dispatch}
        />

        <main className="panel visual-editor-canvas-panel">
          <EditorCanvas
            engine={engine}
            vnode={buildResult.vnode}
            state={state}
            dispatch={dispatch}
            onArtifacts={handleArtifacts}
            showDebug={showDebug}
            onBooleanOperation={applyBooleanOperation}
            mobileViewer={mobileViewer}
          />
        </main>

        <InspectorPanel
          document={state.present.document}
          layer={selectedLayer}
          selectedLayers={selectedLayers}
          dispatch={dispatch}
          showDebug={showDebug}
          setShowDebug={setShowDebug}
          warnings={[
            ...buildResult.warnings,
            ...(operationWarning
              ? [{ code: "EDITOR_BOOLEAN_ERROR", message: operationWarning }]
              : []),
          ]}
          inspection={inspection.inspection}
        />
      </div>

      <OutputDrawer
        open={state.outputOpen}
        tab={outputTab}
        setTab={setOutputTab}
        rendererMode={rendererMode}
        setRendererMode={setRendererMode}
        svg={artifacts?.svg ?? ""}
        jsx={jsx}
        component={component}
        onClose={() => dispatch({ type: "set-output-open", open: false })}
      />
    </div>
  );
}

function EditorToolbar({
  state,
  dispatch,
  onExportSvg,
  onExportPng,
}: {
  state: ReturnType<typeof createInitialEditorState>;
  dispatch: (action: EditorAction) => void;
  onExportSvg: () => void;
  onExportPng: () => void;
}) {
  const selectedId = state.present.selectedLayerId;
  const selectedCount = state.present.selectedLayerIds.length;
  return (
    <div className="panel visual-editor-toolbar">
      <div className="visual-editor-toolbar-group">
        <strong>Controls Editor</strong>
        <SelectField
          id="editor-preset"
          label="Sample"
          value=""
          onChange={(value) => {
            const preset = EDITOR_PRESETS.find((candidate) => candidate.id === value);
            if (preset) {
              dispatch({ type: "replace-document", document: preset.document });
            }
          }}
          options={[
            { value: "", label: "Choose a practical sample…" },
            ...EDITOR_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
          ]}
        />
      </div>
      <div className="visual-editor-toolbar-group visual-editor-tool-cluster">
        <EditorToolButton
          label="Add Text"
          icon="add-text"
          onClick={() => dispatch({ type: "add-layer", layerType: "text" })}
        />
        <EditorToolButton
          label="Add Box"
          icon="add-box"
          onClick={() => dispatch({ type: "add-layer", layerType: "box" })}
        />
        <EditorToolButton
          label="Add Shape"
          icon="add-shape"
          onClick={() => dispatch({ type: "add-layer", layerType: "shape" })}
        />
      </div>
      <div className="visual-editor-toolbar-group visual-editor-tool-cluster">
        <EditorToolButton
          label="Undo"
          icon="undo"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: "undo" })}
        />
        <EditorToolButton
          label="Redo"
          icon="redo"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: "redo" })}
        />
      </div>
      <div className="visual-editor-toolbar-group visual-editor-tool-cluster">
        <EditorToolButton
          label="Duplicate layer"
          icon="duplicate"
          disabled={!selectedId || selectedCount !== 1}
          onClick={() => selectedId && dispatch({ type: "duplicate-layer", layerId: selectedId })}
        />
        <EditorToolButton
          label="Delete layer"
          icon="delete"
          className="is-danger"
          disabled={!selectedId || selectedCount === 0}
          onClick={() => selectedId && dispatch({ type: "delete-layer", layerId: selectedId })}
        />
      </div>
      <div className="visual-editor-toolbar-group visual-editor-tool-cluster">
        <EditorToolButton
          label="Zoom out"
          icon="zoom-out"
          onClick={() => dispatch({ type: "set-zoom", zoom: state.zoom - 0.1 })}
        />
        <EditorToolButton
          label="Fit Canvas"
          icon="fit"
          onClick={() => dispatch({ type: "set-zoom", zoom: 0.8 })}
        />
        <EditorToolButton
          label="Zoom in"
          icon="zoom-in"
          onClick={() => dispatch({ type: "set-zoom", zoom: state.zoom + 0.1 })}
        />
      </div>
      <div className="visual-editor-toolbar-group compact-buttons toolbar-actions">
        <button type="button" onClick={onExportSvg}>
          SVG
        </button>
        <button type="button" onClick={onExportPng}>
          PNG 2×
        </button>
        <Tooltip label={state.outputOpen ? "Hide source" : "Show source"} align="end">
          <button
            type="button"
            className="layout-toggle-btn visual-editor-source-toggle"
            aria-label={state.outputOpen ? "Hide source" : "Show source"}
            aria-pressed={state.outputOpen}
            onClick={() => dispatch({ type: "set-output-open", open: !state.outputOpen })}
          >
            <EditorIcon name={state.outputOpen ? "preview" : "code"} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

type EditorIconName =
  | "add-text"
  | "add-box"
  | "add-shape"
  | "undo"
  | "redo"
  | "duplicate"
  | "delete"
  | "zoom-out"
  | "fit"
  | "zoom-in"
  | "code"
  | "preview"
  | "visible"
  | "hidden"
  | "locked"
  | "unlocked";

function EditorToolButton({
  label,
  icon,
  className,
  disabled,
  onClick,
}: {
  label: string;
  icon: EditorIconName;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={`visual-editor-tool-button${className ? ` ${className}` : ""}`}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <EditorIcon name={icon} />
      </button>
    </Tooltip>
  );
}

function EditorIcon({ name }: { name: EditorIconName }) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.6,
  };
  return (
    <svg className="visual-editor-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
      {name === "add-text" && (
        <>
          <path {...commonProps} d="M2.5 4h9M7 4v11M4.5 15h5" />
          <path {...commonProps} d="M15 8v7M11.5 11.5h7" />
        </>
      )}
      {name === "add-box" && (
        <>
          <rect {...commonProps} x="2.5" y="3" width="10" height="10" rx="1.5" />
          <path {...commonProps} d="M15.5 9v7M12 12.5h7" />
        </>
      )}
      {name === "add-shape" && (
        <>
          <circle {...commonProps} cx="7.5" cy="8" r="5" />
          <path {...commonProps} d="M15.5 9v7M12 12.5h7" />
        </>
      )}
      {name === "undo" && (
        <>
          <path {...commonProps} d="M8 5 3.5 9 8 13" />
          <path {...commonProps} d="M4 9h7.5a5 5 0 0 1 5 5" />
        </>
      )}
      {name === "redo" && (
        <>
          <path {...commonProps} d="m12 5 4.5 4-4.5 4" />
          <path {...commonProps} d="M16 9H8.5a5 5 0 0 0-5 5" />
        </>
      )}
      {name === "duplicate" && (
        <>
          <rect {...commonProps} x="3" y="6" width="10" height="10" rx="1.5" />
          <path
            {...commonProps}
            d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3H15a2 2 0 0 1 2 2v6.5a1.5 1.5 0 0 1-1.5 1.5H13"
          />
        </>
      )}
      {name === "delete" && (
        <path {...commonProps} d="M3.5 5.5h13M8 3h4M6 5.5l.7 11h6.6l.7-11M8.5 8.5v5M11.5 8.5v5" />
      )}
      {name === "zoom-out" && <path {...commonProps} d="M4 10h12" />}
      {name === "zoom-in" && <path {...commonProps} d="M4 10h12M10 4v12" />}
      {name === "fit" && (
        <path {...commonProps} d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 10h6" />
      )}
      {name === "code" && (
        <>
          <path {...commonProps} d="m8 4-4 6 4 6" />
          <path {...commonProps} d="m12 4 4 6-4 6" />
        </>
      )}
      {name === "preview" && (
        <>
          <rect {...commonProps} x="3" y="4" width="14" height="12" rx="1.5" />
          <path {...commonProps} d="M3 8h14" />
        </>
      )}
      {name === "visible" && (
        <>
          <path {...commonProps} d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5Z" />
          <circle {...commonProps} cx="10" cy="10" r="2.2" />
        </>
      )}
      {name === "hidden" && (
        <path
          {...commonProps}
          d="M3 3l14 14M7.2 5.5A8 8 0 0 1 10 5c4.7 0 7.5 5 7.5 5a11 11 0 0 1-2.1 2.7M12.8 14.5A8 8 0 0 1 10 15c-4.7 0-7.5-5-7.5-5a11 11 0 0 1 2.1-2.7"
        />
      )}
      {name === "locked" && (
        <>
          <rect {...commonProps} x="4.5" y="8.5" width="11" height="8" rx="1.5" />
          <path {...commonProps} d="M7 8.5V6a3 3 0 0 1 6 0v2.5M10 12v2" />
        </>
      )}
      {name === "unlocked" && (
        <>
          <rect {...commonProps} x="4.5" y="8.5" width="11" height="8" rx="1.5" />
          <path {...commonProps} d="M7 8.5V6a3 3 0 0 1 5.7-1.3M10 12v2" />
        </>
      )}
    </svg>
  );
}

function LayerPanel({
  layers,
  selectedLayerId,
  selectedLayerIds,
  dispatch,
}: {
  layers: EditorLayer[];
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  dispatch: (action: EditorAction) => void;
}) {
  return (
    <aside className="panel controls-panel visual-editor-sidebar visual-editor-layers">
      <div className="visual-editor-panel-title">
        <h3>Layers</h3>
        <span>
          {selectedLayerIds.length > 1 ? `${selectedLayerIds.length} selected` : "back → front"}
        </span>
      </div>
      <div className="visual-editor-layer-list">
        {buildLayerPanelEntries(layers).map((entry) =>
          entry.kind === "group" ? (
            <LayerGroup
              key={entry.groupId}
              groupId={entry.groupId}
              layers={entry.layers}
              selectedLayerId={selectedLayerId}
              selectedLayerIds={selectedLayerIds}
              dispatch={dispatch}
            />
          ) : (
            <LayerRow
              key={entry.layer.id}
              layer={entry.layer}
              selectedLayerId={selectedLayerId}
              selectedLayerIds={selectedLayerIds}
              dispatch={dispatch}
            />
          ),
        )}
      </div>
      {selectedLayerId && selectedLayerIds.length === 1 && (
        <div className="layer-order-actions compact-buttons">
          <button
            type="button"
            onClick={() =>
              dispatch({ type: "move-layer-order", layerId: selectedLayerId, direction: 1 })
            }
          >
            Bring forward
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({ type: "move-layer-order", layerId: selectedLayerId, direction: -1 })
            }
          >
            Send back
          </button>
        </div>
      )}
      <div className="visual-editor-samples">
        <h4 className="visual-editor-subheading">Samples</h4>
        <div className="stack-list">
          {EDITOR_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="template-button"
              onClick={() => dispatch({ type: "replace-document", document: preset.document })}
            >
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

type LayerPanelEntry =
  | { kind: "layer"; layer: EditorLayer }
  | { kind: "group"; groupId: string; layers: EditorLayer[] };

function buildLayerPanelEntries(layers: EditorLayer[]): LayerPanelEntry[] {
  const frontToBack = [...layers].reverse();
  const emittedGroupIds = new Set<string>();
  return frontToBack.flatMap((layer): LayerPanelEntry[] => {
    if (!layer.groupId) {
      return [{ kind: "layer", layer }];
    }
    if (emittedGroupIds.has(layer.groupId)) {
      return [];
    }
    emittedGroupIds.add(layer.groupId);
    return [
      {
        kind: "group",
        groupId: layer.groupId,
        layers: frontToBack.filter((candidate) => candidate.groupId === layer.groupId),
      },
    ];
  });
}

function LayerGroup({
  groupId,
  layers,
  selectedLayerId,
  selectedLayerIds,
  dispatch,
}: {
  groupId: string;
  layers: EditorLayer[];
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  dispatch: (action: EditorAction) => void;
}) {
  const groupSelected = layers.every((layer) => selectedLayerIds.includes(layer.id));
  const groupVisible = layers.every((layer) => layer.visible);
  const groupLocked = layers.some((layer) => layer.locked);
  const primaryLayer = layers.find((layer) => layer.id === selectedLayerId) ?? layers[0];
  if (!primaryLayer) {
    return null;
  }
  return (
    <section
      className={`visual-editor-layer-group${groupSelected ? " is-selected" : ""}`}
      aria-label={`Group with ${layers.length} layers`}
    >
      <div className="visual-editor-layer-group-header">
        <button
          type="button"
          className="visual-editor-layer-select"
          aria-pressed={groupSelected}
          onClick={() => dispatch({ type: "select", layerId: primaryLayer.id })}
        >
          <span className="layer-type layer-group">G</span>
          <span className="layer-name">Group</span>
          <span className="layer-group-count">{layers.length}</span>
        </button>
        <Tooltip label={groupVisible ? "Hide group" : "Show group"} align="end">
          <button
            type="button"
            className="visual-editor-layer-toggle"
            aria-label={groupVisible ? "Hide group" : "Show group"}
            onClick={() =>
              dispatch({
                type: "patch-layers",
                patches: layers.map((layer) => ({
                  layerId: layer.id,
                  patch: { visible: !groupVisible },
                })),
              })
            }
          >
            <EditorIcon name={groupVisible ? "visible" : "hidden"} />
          </button>
        </Tooltip>
        <Tooltip label={groupLocked ? "Unlock group" : "Lock group"} align="end">
          <button
            type="button"
            className="visual-editor-layer-toggle"
            aria-label={groupLocked ? "Unlock group" : "Lock group"}
            onClick={() =>
              dispatch({
                type: "patch-layers",
                patches: layers.map((layer) => ({
                  layerId: layer.id,
                  patch: { locked: !groupLocked },
                })),
              })
            }
          >
            <EditorIcon name={groupLocked ? "locked" : "unlocked"} />
          </button>
        </Tooltip>
      </div>
      <div className="visual-editor-layer-group-children" data-group-id={groupId}>
        {layers.map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            selectedLayerId={selectedLayerId}
            selectedLayerIds={selectedLayerIds}
            dispatch={dispatch}
            nested
          />
        ))}
      </div>
    </section>
  );
}

function LayerRow({
  layer,
  selectedLayerId,
  selectedLayerIds,
  dispatch,
  nested = false,
}: {
  layer: EditorLayer;
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  dispatch: (action: EditorAction) => void;
  nested?: boolean;
}) {
  return (
    <div
      className={`visual-editor-layer${selectedLayerIds.includes(layer.id) ? " is-selected" : ""}${selectedLayerId === layer.id ? " active" : ""}${nested ? " is-grouped is-group-member" : ""}`}
    >
      <button
        type="button"
        className="visual-editor-layer-select"
        aria-pressed={selectedLayerIds.includes(layer.id)}
        onClick={(event) =>
          dispatch({ type: "select", layerId: layer.id, additive: event.shiftKey })
        }
      >
        <span className={`layer-type layer-${layer.type}`}>
          {layer.type.slice(0, 1).toUpperCase()}
        </span>
        <span className="layer-name">{layer.name}</span>
      </button>
      <Tooltip label={layer.visible ? "Hide layer" : "Show layer"} align="end">
        <button
          type="button"
          className="visual-editor-layer-toggle"
          aria-label={layer.visible ? "Hide layer" : "Show layer"}
          onClick={() =>
            dispatch({
              type: "patch-layer",
              layerId: layer.id,
              patch: { visible: !layer.visible },
            })
          }
        >
          <EditorIcon name={layer.visible ? "visible" : "hidden"} />
        </button>
      </Tooltip>
      <Tooltip label={layer.locked ? "Unlock layer" : "Lock layer"} align="end">
        <button
          type="button"
          className="visual-editor-layer-toggle"
          aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
          onClick={() =>
            dispatch({
              type: "patch-layer",
              layerId: layer.id,
              patch: { locked: !layer.locked },
            })
          }
        >
          <EditorIcon name={layer.locked ? "locked" : "unlocked"} />
        </button>
      </Tooltip>
    </div>
  );
}

function InspectorPanel({
  document,
  layer,
  selectedLayers,
  dispatch,
  showDebug,
  setShowDebug,
  warnings,
  inspection,
}: {
  document: EditorDocument;
  layer: EditorLayer | undefined;
  selectedLayers: EditorLayer[];
  dispatch: (action: EditorAction) => void;
  showDebug: boolean;
  setShowDebug: (show: boolean) => void;
  warnings: Array<{ code?: string; message?: string }>;
  inspection: ReturnType<typeof useBoundSvgInspection>["inspection"];
}) {
  return (
    <aside className="panel controls-panel visual-editor-sidebar visual-editor-inspector">
      <div className="visual-editor-panel-title">
        <h3>Inspector</h3>
        <span>
          {selectedLayers.length > 1
            ? `${selectedLayers.length} layers · primary ${layer?.type ?? "none"}`
            : (layer?.type ?? "Canvas")}
        </span>
      </div>
      {selectedLayers.length > 1 && (
        <div className="visual-editor-selection-summary">
          <strong>{selectedLayers.length} layers selected</strong>
          <span>
            {selectedLayers[0]?.groupId &&
            selectedLayers.every((selected) => selected.groupId === selectedLayers[0]?.groupId)
              ? "One group"
              : "Mixed selection"}
          </span>
          <small>
            {selectedLayers[0]?.groupId &&
            selectedLayers.every((selected) => selected.groupId === selectedLayers[0]?.groupId)
              ? "Move, proportional resize, and rotation are shared."
              : "Move is shared. Group layers to resize or rotate them together."}
          </small>
        </div>
      )}
      <CanvasSection document={document} layer={layer} dispatch={dispatch} />
      {layer && <LayoutSection layer={layer} dispatch={dispatch} />}
      {layer?.type === "text" && (
        <TextSections document={document} layer={layer} dispatch={dispatch} />
      )}
      {layer && layer.type !== "text" && (
        <ObstacleFlowSection document={document} layer={layer} dispatch={dispatch} />
      )}
      {layer?.type === "box" && <BoxSection layer={layer} dispatch={dispatch} />}
      {layer?.type === "shape" && <ShapeSection layer={layer} dispatch={dispatch} />}
      <Section title="Debug" defaultOpen={false}>
        <CheckField
          id="editor-debug"
          label="BBox overlay"
          checked={showDebug}
          onChange={setShowDebug}
        />
        <div className="editor-debug-stats">
          <span>nodes {inspection?.stats.nodeCount ?? 0}</span>
          <span>text {inspection?.stats.textNodeCount ?? 0}</span>
          <span>warnings {warnings.length + (inspection?.warnings.length ?? 0)}</span>
        </div>
        {warnings.map((warning, index) => (
          <p key={`${warning.code}:${index}`} className="editor-warning">
            {warning.code ?? "warning"}: {warning.message}
          </p>
        ))}
        <NodeInspectorPanel
          className="editor-node-inspector"
          inspection={inspection}
          selectedNodeId={layer?.id ?? null}
        />
      </Section>
    </aside>
  );
}

function CanvasSection({
  document,
  layer,
  dispatch,
}: {
  document: EditorDocument;
  layer: EditorLayer | undefined;
  dispatch: (action: EditorAction) => void;
}) {
  const patchCanvas = (patch: Partial<EditorDocument["canvas"]>) =>
    dispatch({ type: "patch-canvas", patch });
  return (
    <Section title="Canvas" defaultOpen>
      <div className="compact-row">
        <NumberField
          id="editor-canvas-width"
          label="Width"
          value={document.canvas.width}
          min={240}
          max={1920}
          step={10}
          unit="px"
          onChange={(width) => patchCanvas({ width, followWritingMode: false })}
        />
        <NumberField
          id="editor-canvas-height"
          label="Height"
          value={document.canvas.height}
          min={240}
          max={1920}
          step={10}
          unit="px"
          onChange={(height) => patchCanvas({ height, followWritingMode: false })}
        />
      </div>
      <ColorField
        id="editor-canvas-bg"
        label="Background"
        value={document.canvas.background}
        onChange={(background) => patchCanvas({ background })}
      />
      <div className="compact-row">
        <CheckField
          id="editor-size-lock"
          label="Size lock"
          checked={document.canvas.sizeLocked}
          onChange={(sizeLocked) => patchCanvas({ sizeLocked })}
        />
        <CheckField
          id="editor-follow-writing"
          label="Follow writing mode"
          checked={document.canvas.followWritingMode}
          onChange={(followWritingMode) => patchCanvas({ followWritingMode })}
        />
      </div>
      {layer?.type === "text" && !document.canvas.sizeLocked && (
        <button
          type="button"
          className="export-button"
          onClick={() => adaptCanvasToWritingMode(document, layer, dispatch)}
        >
          Adapt Canvas for {layer.writingMode === "vertical-rl" ? "vertical" : "horizontal"} text
        </button>
      )}
      {layer && isLayerOutsideCanvas(document, layer) && (
        <>
          <p className="editor-warning">The selected layer extends beyond the Canvas.</p>
          <button
            type="button"
            className="export-button"
            onClick={() => fitLayerInsideCanvas(document, layer, dispatch)}
          >
            Fit selected layer inside Canvas
          </button>
        </>
      )}
    </Section>
  );
}

function LayoutSection({
  layer,
  dispatch,
}: {
  layer: EditorLayer;
  dispatch: (action: EditorAction) => void;
}) {
  const patch = (value: Partial<EditorLayer>) =>
    dispatch({ type: "patch-layer", layerId: layer.id, patch: value });
  return (
    <Section title="Layout" defaultOpen>
      <div className="compact-row">
        <NumberField
          id="editor-x"
          label="X"
          value={layer.x}
          min={-2000}
          max={2000}
          unit="px"
          onChange={(x) => patch({ x })}
        />
        <NumberField
          id="editor-y"
          label="Y"
          value={layer.y}
          min={-2000}
          max={2000}
          unit="px"
          onChange={(y) => patch({ y })}
        />
      </div>
      <div className="compact-row">
        <NumberField
          id="editor-layer-width"
          label="Width"
          value={layer.width}
          min={20}
          max={1920}
          unit="px"
          onChange={(width) => patch({ width })}
        />
        <NumberField
          id="editor-layer-height"
          label="Height"
          value={layer.height}
          min={20}
          max={1920}
          unit="px"
          onChange={(height) => patch({ height })}
        />
      </div>
      <div className="compact-row">
        <NumberField
          id="editor-opacity"
          label="Opacity"
          value={layer.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) => patch({ opacity })}
        />
        <NumberField
          id="editor-rotate"
          label="Rotate"
          value={layer.rotateDeg}
          min={-360}
          max={360}
          unit="°"
          onChange={(rotateDeg) => patch({ rotateDeg })}
        />
      </div>
    </Section>
  );
}

function TextSections({
  document,
  layer,
  dispatch,
}: {
  document: EditorDocument;
  layer: EditorTextLayer;
  dispatch: (action: EditorAction) => void;
}) {
  const patch = (value: Partial<EditorTextLayer>) =>
    dispatch({ type: "patch-layer", layerId: layer.id, patch: value });
  const fontOptions = FONT_DEFS.map((fontDef) => ({
    value: fontAlias(fontDef.alias, fontDef.axes ? "ttf" : "woff2"),
    label: fontDef.label,
  }));
  return (
    <>
      <Section title="Text" defaultOpen>
        <TextAreaField
          id="editor-text-content"
          label="Plain content (replaces rich runs)"
          value={layerText(layer)}
          onChange={(text) => patch({ runs: [{ id: `${layer.id}-plain`, kind: "text", text }] })}
        />
        <SelectField
          id="editor-font"
          label="Font"
          value={layer.font}
          options={fontOptions}
          onChange={(font) => patch({ font })}
        />
        <div className="compact-row">
          <NumberField
            id="editor-font-size"
            label="Font size"
            value={layer.fontSizePx}
            min={6}
            max={240}
            unit="px"
            onChange={(fontSizePx) => patch({ fontSizePx })}
          />
          <NumberField
            id="editor-line-height"
            label="Line height"
            value={layer.lineHeight}
            min={0.8}
            max={3}
            step={0.05}
            onChange={(lineHeight) => patch({ lineHeight })}
          />
        </div>
        <ColorField
          id="editor-text-color"
          label="Color"
          value={layer.color}
          onChange={(color) => patch({ color })}
        />
        <div className="compact-row">
          <SelectField
            id="editor-writing-mode"
            label="Writing"
            value={layer.writingMode}
            options={[
              { value: "horizontal-tb", label: "horizontal-tb" },
              { value: "vertical-rl", label: "vertical-rl" },
            ]}
            onChange={(value) =>
              dispatch({
                type: "set-writing-mode",
                layerId: layer.id,
                writingMode: value as EditorTextLayer["writingMode"],
              })
            }
          />
          <SelectField
            id="editor-text-orientation"
            label="Orientation"
            value={layer.textOrientation}
            options={[
              { value: "mixed", label: "mixed" },
              { value: "upright", label: "upright" },
            ]}
            onChange={(value) =>
              patch({ textOrientation: value as EditorTextLayer["textOrientation"] })
            }
          />
        </div>
        <div className="compact-row">
          <SelectField
            id="editor-wrap"
            label="Wrap"
            value={layer.wrap}
            options={[
              { value: "char", label: "char" },
              { value: "word", label: "word" },
              { value: "none", label: "none" },
            ]}
            onChange={(value) => patch({ wrap: value as EditorTextLayer["wrap"] })}
          />
          <SelectField
            id="editor-fit"
            label="Fit"
            value={layer.fit}
            options={[
              { value: "none", label: "none" },
              { value: "shrink", label: "shrink" },
              { value: "grow", label: "grow" },
            ]}
            onChange={(value) => patch({ fit: value as EditorTextLayer["fit"] })}
          />
        </div>
        <div className="compact-row">
          <NumberField
            id="editor-letter-spacing"
            label="Letter spacing"
            value={layer.letterSpacingPx}
            min={-8}
            max={30}
            step={0.5}
            unit="px"
            onChange={(letterSpacingPx) => patch({ letterSpacingPx })}
          />
          <NumberField
            id="editor-max-lines"
            label="Max lines"
            value={layer.maxLines}
            min={0}
            max={30}
            onChange={(maxLines) => patch({ maxLines })}
          />
        </div>
        <div className="compact-row">
          <CheckField
            id="editor-ellipsis"
            label="Ellipsis"
            checked={layer.ellipsis}
            onChange={(ellipsis) => patch({ ellipsis })}
          />
          <CheckField
            id="editor-hanging"
            label="Hanging punctuation"
            checked={layer.hangingPunctuation}
            onChange={(hangingPunctuation) => patch({ hangingPunctuation })}
          />
        </div>
        <FeatureSettingsField
          value={layer.fontFeatureSettings}
          supportedFeatures={
            FONT_DEFS.find((fontDef) => layer.font.startsWith(fontDef.alias))?.features
          }
          onChange={(fontFeatureSettings) => patch({ fontFeatureSettings })}
        />
      </Section>
      <RichTextSection layer={layer} patch={patch} />
      <FlowSection document={document} layer={layer} patch={patch} />
      <EffectsSection layer={layer} patch={patch} />
    </>
  );
}

function RichTextSection({
  layer,
  patch,
}: {
  layer: EditorTextLayer;
  patch: (value: Partial<EditorTextLayer>) => void;
}) {
  const updateRun = (id: string, value: Partial<EditorTextRun>) =>
    patch({
      runs: layer.runs.map((run) =>
        run.id === id ? ({ ...run, ...value } as EditorTextRun) : run,
      ),
    });
  return (
    <Section title="Rich Text" defaultOpen>
      <p className="hint">
        Double-click Text, drag glyphs, then use the floating toolbar. The run tree stays editable
        here.
      </p>
      <div className="editor-run-list">
        {layer.runs.map((run, index) => (
          <div key={run.id} className={`editor-run editor-run-${run.kind}`}>
            <div className="editor-run-head">
              <strong>
                {index + 1}. {run.kind}
              </strong>
              <span>{run.kind === "ruby" ? run.base : run.text}</span>
            </div>
            {run.kind === "ruby" && (
              <>
                <div className="compact-row">
                  <TextAreaField
                    id={`${run.id}-base`}
                    label="Base"
                    value={run.base}
                    onChange={(base) => updateRun(run.id, { base })}
                  />
                  <TextAreaField
                    id={`${run.id}-ruby`}
                    label="Ruby"
                    value={run.rubyText}
                    onChange={(rubyText) => updateRun(run.id, { rubyText })}
                  />
                </div>
                <TextAreaField
                  id={`${run.id}-ruby2`}
                  label="Second Rt level"
                  value={run.extraRubyText ?? ""}
                  onChange={(extraRubyText) => updateRun(run.id, { extraRubyText })}
                />
                <div className="compact-row">
                  <SelectField
                    id={`${run.id}-position`}
                    label="Position"
                    value={run.rubyPosition}
                    options={["over", "under", "alternate", "inter-character"].map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={(rubyPosition) =>
                      updateRun(run.id, { rubyPosition: rubyPosition as typeof run.rubyPosition })
                    }
                  />
                  <SelectField
                    id={`${run.id}-align`}
                    label="Align"
                    value={run.rubyAlign}
                    options={["start", "center", "space-between", "space-around"].map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={(rubyAlign) =>
                      updateRun(run.id, { rubyAlign: rubyAlign as typeof run.rubyAlign })
                    }
                  />
                </div>
              </>
            )}
            {run.kind === "inline" && (
              <div className="compact-row">
                <ColorField
                  id={`${run.id}-color`}
                  label="Inline color"
                  value={run.color ?? layer.color}
                  onChange={(color) => updateRun(run.id, { color })}
                />
                <SelectField
                  id={`${run.id}-tcy`}
                  label="TCY"
                  value={run.textCombineUpright ?? "none"}
                  options={[
                    { value: "none", label: "none" },
                    { value: "all", label: "all" },
                  ]}
                  onChange={(textCombineUpright) =>
                    updateRun(run.id, { textCombineUpright: textCombineUpright as "none" | "all" })
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function FlowSection({
  document,
  layer,
  patch,
}: {
  document: EditorDocument;
  layer: EditorTextLayer;
  patch: (value: Partial<EditorTextLayer>) => void;
}) {
  const candidates = document.layers.filter(
    (candidate) => candidate.id !== layer.id && candidate.type !== "text",
  );
  return (
    <Section title="Flow Around" defaultOpen={layer.flowBindings.length > 0}>
      <p className="hint">Choose the Box and Shape layers this Text should avoid.</p>
      {candidates.length === 0 ? (
        <p className="hint">Add a Box or Shape to use it as an exclusion.</p>
      ) : (
        candidates.map((candidate) => {
          const binding = layer.flowBindings.find((item) => item.layerId === candidate.id);
          return (
            <div key={candidate.id} className="editor-flow-binding">
              <CheckField
                id={`flow-${candidate.id}`}
                label={candidate.name}
                checked={Boolean(binding)}
                onChange={(enabled) =>
                  patch({
                    flowBindings: enabled
                      ? [...layer.flowBindings, { layerId: candidate.id, marginPx: 12 }]
                      : layer.flowBindings.filter((item) => item.layerId !== candidate.id),
                  })
                }
              />
              {binding && (
                <NumberField
                  id={`flow-margin-${candidate.id}`}
                  label="Margin"
                  value={binding.marginPx}
                  min={0}
                  max={100}
                  unit="px"
                  onChange={(marginPx) =>
                    patch({
                      flowBindings: layer.flowBindings.map((item) =>
                        item.layerId === candidate.id ? { ...item, marginPx } : item,
                      ),
                    })
                  }
                />
              )}
            </div>
          );
        })
      )}
    </Section>
  );
}

function ObstacleFlowSection({
  document,
  layer,
  dispatch,
}: {
  document: EditorDocument;
  layer: EditorBoxLayer | EditorShapeLayer;
  dispatch: (action: EditorAction) => void;
}) {
  const textLayers = document.layers.filter(
    (candidate): candidate is EditorTextLayer => candidate.type === "text",
  );
  const linkedCount = textLayers.filter((textLayer) =>
    textLayer.flowBindings.some((binding) => binding.layerId === layer.id),
  ).length;
  const patchTextLayer = (
    textLayer: EditorTextLayer,
    flowBindings: EditorTextLayer["flowBindings"],
  ): void =>
    dispatch({
      type: "patch-layer",
      layerId: textLayer.id,
      patch: { flowBindings },
    });

  return (
    <Section title="Flow Relationships" defaultOpen>
      <p className="hint">
        Use this {layer.type === "shape" ? "Shape" : "Box"} as an obstacle for selected Text layers.
        Linked to {linkedCount} of {textLayers.length}.
      </p>
      {!layer.visible && (
        <p className="editor-warning">Hidden obstacles stay linked but do not affect layout.</p>
      )}
      {textLayers.length === 0 ? (
        <p className="hint">Add a Text layer to create a flow relationship.</p>
      ) : (
        textLayers.map((textLayer) => {
          const binding = textLayer.flowBindings.find((item) => item.layerId === layer.id);
          return (
            <div key={textLayer.id} className="editor-flow-binding">
              <CheckField
                id={`obstacle-flow-${layer.id}-${textLayer.id}`}
                label={textLayer.name}
                checked={Boolean(binding)}
                onChange={(enabled) =>
                  patchTextLayer(
                    textLayer,
                    enabled
                      ? [...textLayer.flowBindings, { layerId: layer.id, marginPx: 12 }]
                      : textLayer.flowBindings.filter((item) => item.layerId !== layer.id),
                  )
                }
              />
              {binding && (
                <NumberField
                  id={`obstacle-margin-${layer.id}-${textLayer.id}`}
                  label="Wrap margin"
                  value={binding.marginPx}
                  min={0}
                  max={100}
                  unit="px"
                  onChange={(marginPx) =>
                    patchTextLayer(
                      textLayer,
                      textLayer.flowBindings.map((item) =>
                        item.layerId === layer.id ? { ...item, marginPx } : item,
                      ),
                    )
                  }
                />
              )}
            </div>
          );
        })
      )}
    </Section>
  );
}

function EffectsSection({
  layer,
  patch,
}: {
  layer: EditorTextLayer;
  patch: (value: Partial<EditorTextLayer>) => void;
}) {
  return (
    <Section title="Text Effects" defaultOpen={layer.strokes.length + layer.shadows.length > 0}>
      <div className="editor-effect-head">
        <strong>Strokes</strong>
        <button
          type="button"
          disabled={layer.strokes.length >= MAX_TEXT_EFFECT_LAYERS}
          onClick={() => patch({ strokes: [...layer.strokes, { color: "#0f172a", widthPx: 8 }] })}
        >
          ＋
        </button>
      </div>
      {layer.strokes.map((stroke, index) => (
        <div key={`stroke-${index}`} className="editor-effect-row editor-stroke-row">
          <ColorField
            id={`stroke-color-${index}`}
            label={`Stroke ${index + 1}`}
            value={stroke.color}
            onChange={(color) =>
              patch({
                strokes: layer.strokes.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, color } : item,
                ),
              })
            }
          />
          <NumberField
            id={`stroke-width-${index}`}
            label="Width"
            value={stroke.widthPx}
            min={0}
            max={40}
            unit="px"
            onChange={(widthPx) =>
              patch({
                strokes: layer.strokes.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, widthPx } : item,
                ),
              })
            }
          />
          <Tooltip label={`Remove Stroke ${index + 1}`} align="end">
            <button
              type="button"
              className="editor-effect-remove"
              aria-label={`Remove Stroke ${index + 1}`}
              onClick={() =>
                patch({ strokes: layer.strokes.filter((_, itemIndex) => itemIndex !== index) })
              }
            >
              <EditorIcon name="delete" />
            </button>
          </Tooltip>
        </div>
      ))}
      <div className="editor-effect-head">
        <strong>Shadows</strong>
        <button
          type="button"
          disabled={layer.shadows.length >= MAX_TEXT_EFFECT_LAYERS}
          onClick={() =>
            patch({ shadows: [...layer.shadows, { dx: 5, dy: 6, blurPx: 8, color: "#000000" }] })
          }
        >
          ＋
        </button>
      </div>
      {layer.shadows.map((shadow, index) => (
        <div key={`shadow-${index}`} className="editor-shadow-row">
          <ColorField
            id={`shadow-color-${index}`}
            label={`Shadow ${index + 1}`}
            value={shadow.color}
            onChange={(color) =>
              patch({
                shadows: layer.shadows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, color } : item,
                ),
              })
            }
          />
          <div className="compact-row">
            <NumberField
              id={`shadow-x-${index}`}
              label="X"
              value={shadow.dx}
              min={-40}
              max={40}
              unit="px"
              onChange={(dx) =>
                patch({
                  shadows: layer.shadows.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, dx } : item,
                  ),
                })
              }
            />
            <NumberField
              id={`shadow-y-${index}`}
              label="Y"
              value={shadow.dy}
              min={-40}
              max={40}
              unit="px"
              onChange={(dy) =>
                patch({
                  shadows: layer.shadows.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, dy } : item,
                  ),
                })
              }
            />
          </div>
          <Tooltip label={`Remove Shadow ${index + 1}`} align="end">
            <button
              type="button"
              className="editor-effect-remove"
              aria-label={`Remove Shadow ${index + 1}`}
              onClick={() =>
                patch({ shadows: layer.shadows.filter((_, itemIndex) => itemIndex !== index) })
              }
            >
              <EditorIcon name="delete" />
            </button>
          </Tooltip>
        </div>
      ))}
    </Section>
  );
}

function BoxSection({
  layer,
  dispatch,
}: {
  layer: EditorBoxLayer;
  dispatch: (action: EditorAction) => void;
}) {
  const patch = (value: Partial<EditorBoxLayer>) =>
    dispatch({ type: "patch-layer", layerId: layer.id, patch: value });
  return (
    <Section title="Box Paint" defaultOpen>
      <ColorField
        id="editor-box-background"
        label="Background"
        value={solidColorFallback(layer.background)}
        onChange={(background) => patch({ background })}
      />
      <div className="compact-row">
        <ColorField
          id="editor-box-border"
          label="Border"
          value={layer.borderColor}
          onChange={(borderColor) => patch({ borderColor })}
        />
        <NumberField
          id="editor-box-border-width"
          label="Width"
          value={layer.borderWidth}
          min={0}
          max={30}
          unit="px"
          onChange={(borderWidth) => patch({ borderWidth })}
        />
      </div>
      <NumberField
        id="editor-box-radius"
        label="Radius"
        value={layer.borderRadius}
        min={0}
        max={300}
        unit="px"
        onChange={(borderRadius) => patch({ borderRadius })}
      />
      <SelectField
        id="editor-box-gradient"
        label="Fill preset"
        value={layer.background.startsWith("linear-gradient") ? "gradient" : "solid"}
        options={[
          { value: "solid", label: "Solid" },
          { value: "gradient", label: "Linear gradient" },
        ]}
        onChange={(value) =>
          patch({
            background:
              value === "gradient"
                ? "linear-gradient(135deg, #0ea5e9, #7c3aed)"
                : solidColorFallback(layer.background),
          })
        }
      />
    </Section>
  );
}

function ShapeSection({
  layer,
  dispatch,
}: {
  layer: EditorShapeLayer;
  dispatch: (action: EditorAction) => void;
}) {
  const patch = (value: Partial<EditorShapeLayer>) =>
    dispatch({ type: "patch-layer", layerId: layer.id, patch: value });
  return (
    <Section title="Shape" defaultOpen>
      <SelectField
        id="editor-shape-kind"
        label="Geometry"
        value={layer.shapeKind}
        options={["circle", "pill", "notch", "callout"].map((value) => ({ value, label: value }))}
        onChange={(shapeKind) => patch({ shapeKind: shapeKind as EditorShapeLayer["shapeKind"] })}
      />
      <ColorField
        id="editor-shape-fill"
        label="Fill"
        value={layer.fill}
        onChange={(fill) => patch({ fill })}
      />
      <div className="compact-row">
        <ColorField
          id="editor-shape-stroke"
          label="Stroke"
          value={layer.stroke}
          onChange={(stroke) => patch({ stroke })}
        />
        <NumberField
          id="editor-shape-stroke-width"
          label="Width"
          value={layer.strokeWidth}
          min={0}
          max={30}
          unit="px"
          onChange={(strokeWidth) => patch({ strokeWidth })}
        />
      </div>
    </Section>
  );
}

function OutputDrawer({
  open,
  tab,
  setTab,
  rendererMode,
  setRendererMode,
  svg,
  jsx,
  component,
  onClose,
}: {
  open: boolean;
  tab: OutputTab;
  setTab: (tab: OutputTab) => void;
  rendererMode: RendererMode;
  setRendererMode: (mode: RendererMode) => void;
  svg: string;
  jsx: string;
  component: string;
  onClose: () => void;
}) {
  const code = tab === "svg" ? svg : tab === "jsx" ? jsx : component;
  return (
    <section
      className={`panel visual-editor-output${open ? " is-open" : ""}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="visual-editor-output-head">
        <div className="preview-view-tabs">
          <button type="button" className="preview-view-tab" onClick={onClose}>
            Preview
          </button>
          {(["svg", "jsx", "component"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`preview-view-tab${tab === value ? " active" : ""}`}
              onClick={() => setTab(value)}
            >
              {value === "svg"
                ? "Rendered SVG"
                : value === "jsx"
                  ? "Generated JSX"
                  : "React Component"}
            </button>
          ))}
        </div>
        <label className="visual-editor-renderer-select">
          <span>API</span>
          <select
            value={rendererMode}
            onChange={(event) => setRendererMode(event.target.value as RendererMode)}
          >
            <option value="boundsvg">BoundSvg component</option>
            <option value="svg-hook">useRenderToSvg</option>
            <option value="png-hook">useRenderToPng</option>
          </select>
        </label>
      </div>
      <pre className="code-block code-block-full">
        <code>{code}</code>
      </pre>
    </section>
  );
}

function adaptCanvasToWritingMode(
  document: EditorDocument,
  layer: EditorTextLayer,
  dispatch: (action: EditorAction) => void,
) {
  const next = structuredClone(document);
  if (layer.writingMode === "vertical-rl") {
    next.canvas.width = 640;
    next.canvas.height = 960;
  } else {
    next.canvas.width = 960;
    next.canvas.height = 540;
  }
  next.canvas.followWritingMode = false;
  for (const candidate of next.layers) {
    candidate.x = Math.min(candidate.x, Math.max(0, next.canvas.width - candidate.width));
    candidate.y = Math.min(candidate.y, Math.max(0, next.canvas.height - candidate.height));
  }
  dispatch({ type: "replace-document", document: next, selectedLayerId: layer.id });
}

function isLayerOutsideCanvas(document: EditorDocument, layer: EditorLayer): boolean {
  return (
    layer.x < 0 ||
    layer.y < 0 ||
    layer.x + layer.width > document.canvas.width ||
    layer.y + layer.height > document.canvas.height
  );
}

function fitLayerInsideCanvas(
  document: EditorDocument,
  layer: EditorLayer,
  dispatch: (action: EditorAction) => void,
) {
  const width = Math.min(layer.width, document.canvas.width);
  const height = Math.min(layer.height, document.canvas.height);
  dispatch({
    type: "patch-layer",
    layerId: layer.id,
    patch: {
      x: Math.min(Math.max(0, layer.x), document.canvas.width - width),
      y: Math.min(Math.max(0, layer.y), document.canvas.height - height),
      width,
      height,
    },
  });
}

function solidColorFallback(background: string): string {
  return background.startsWith("#") ? background : "#1e3a5f";
}

function exportSvg(svg: string) {
  if (!svg) {
    return;
  }
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  downloadUrl(url, "boundsvg-editor.svg");
  URL.revokeObjectURL(url);
}

function exportPng(
  engine: NonNullable<ReturnType<typeof useBoundSvg>["engine"]>,
  vnode: Parameters<typeof generateJsxSnippet>[0],
  document: EditorDocument,
) {
  const png = engine.renderToPng(vnode, { scale: 2, rasterBackground: document.canvas.background });
  const url = createPngObjectUrl(png);
  downloadUrl(url, `boundsvg-editor-${document.canvas.width}x${document.canvas.height}@2x.png`);
  revokePngObjectUrl(url);
}

function downloadUrl(url: string, fileName: string) {
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
}
