import { createPngObjectUrl, revokePngObjectUrl } from "@boundsvg/browser/png";
import type { VNode } from "@boundsvg/core";
import type { IRNode } from "@boundsvg/core/scene";
import { useRenderToSvg } from "@boundsvg/react";
import { type EventCallback, useInteractiveSvg } from "@boundsvg/react/interactive";
import { useRenderToPng } from "@boundsvg/react/png";
import { BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import { Provider as JotaiProvider, useAtom, useAtomValue, useSetAtom } from "jotai";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { wrapInLineElements } from "../../../playground-shared/code-line-highlight.js";
import { formatSvgCode } from "../../../playground-shared/html-utils.js";
import { getPrismGrammar } from "../../../playground-shared/prism.js";
import { ColorField, NumberField, Section, SelectField, TextAreaField } from "../components/fields";
import {
  type AssetRenderCacheEntry,
  assetRenderCacheAtom,
  assetStatesAtom,
  compositionPlacementsAtom,
  EDITOR_ASSET_IDS,
  type EditorAssetId,
  type EditorAssetState,
  exportScaleAtom,
  patchAssetStateAtom,
  patchCompositionPlacementAtom,
  selectedAssetIdAtom,
  setAssetRenderCacheEntryAtom,
} from "../editor/atoms";
import {
  ASSET_PROVIDER_CONFIGS,
  buildAssetVNode,
  buildCompositionVNode,
  COMPOSITION_CANVAS,
  COMPOSITION_PROVIDER_CONFIG,
  EDITOR_FONT_OPTIONS,
} from "../editor/builders";
import { useMobileViewer, useResetPreviewForMobile } from "../hooks/use-mobile-viewer";
import { generateJsxSnippet } from "../lib/codegen";

const ASSET_LABELS: Record<EditorAssetId, string> = {
  headline: "Headline",
  badge: "Badge",
  stamp: "Stamp",
};

const EXPORT_SCALE_OPTIONS = [
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "3", label: "3x" },
  { value: "4", label: "4x" },
] as const;

type DragState = {
  assetId: EditorAssetId;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPlacement(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: clamp(x, 0, Math.max(0, COMPOSITION_CANVAS.width - width)),
    y: clamp(y, 0, Math.max(0, COMPOSITION_CANVAS.height - height)),
  };
}

function downloadPng(bytes: Uint8Array, fileName: string): void {
  const url = createPngObjectUrl(bytes);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  revokePngObjectUrl(url);
}

function findLeafNodeById(node: IRNode, nodeId: string): IRNode | null {
  let match: IRNode | null = node.nodeId === nodeId && node.type !== "group" ? node : null;
  if (node.type === "group" && node.children) {
    for (const child of node.children) {
      const nested = findLeafNodeById(child, nodeId);
      if (nested) {
        match = nested;
      }
    }
  }
  return match;
}

function renderStatus(cache: AssetRenderCacheEntry): string {
  if (cache.error) {
    return "error";
  }
  if (cache.isReady && cache.svg && cache.png) {
    return "ready";
  }
  return "rendering";
}

function selectionStyle(node: IRNode | null, width: number, height: number): CSSProperties | null {
  if (!node || width <= 0 || height <= 0) {
    return null;
  }
  const scaleX = width / COMPOSITION_CANVAS.width;
  const scaleY = height / COMPOSITION_CANVAS.height;
  return {
    left: `${node.bbox.x * scaleX}px`,
    top: `${node.bbox.y * scaleY}px`,
    width: `${node.bbox.w * scaleX}px`,
    height: `${node.bbox.h * scaleY}px`,
  };
}

export function MultiSvgEditorPage() {
  return (
    <JotaiProvider>
      <MultiSvgEditorScreen />
    </JotaiProvider>
  );
}

function MultiSvgEditorScreen() {
  const mobileViewer = useMobileViewer();
  const assetStates = useAtomValue(assetStatesAtom);
  const placements = useAtomValue(compositionPlacementsAtom);
  const patchPlacement = useSetAtom(patchCompositionPlacementAtom);

  useEffect(() => {
    for (const assetId of EDITOR_ASSET_IDS) {
      const asset = assetStates[assetId];
      const placement = placements[assetId];
      const width = asset.canvasWidth;
      const height = asset.canvasHeight;
      const nextPosition = clampPlacement(placement.x, placement.y, width, height);
      if (
        placement.width !== width ||
        placement.height !== height ||
        placement.x !== nextPosition.x ||
        placement.y !== nextPosition.y
      ) {
        patchPlacement({
          id: assetId,
          patch: {
            width,
            height,
            x: nextPosition.x,
            y: nextPosition.y,
          },
        });
      }
    }
  }, [assetStates, placements, patchPlacement]);

  return (
    <div className="editor-page">
      <div className="editor-layout">
        <EditorControlsPanel mobileViewer={mobileViewer} />
        <AssetPreviewPanel />
        <CompositionPanel />
      </div>
    </div>
  );
}

function EditorControlsPanel({ mobileViewer }: { mobileViewer: boolean }) {
  const assetStates = useAtomValue(assetStatesAtom);
  const renderCache = useAtomValue(assetRenderCacheAtom);
  const placements = useAtomValue(compositionPlacementsAtom);
  const [selectedAssetId, setSelectedAssetId] = useAtom(selectedAssetIdAtom);
  const [exportScale, setExportScale] = useAtom(exportScaleAtom);
  const patchAssetState = useSetAtom(patchAssetStateAtom);
  const patchPlacement = useSetAtom(patchCompositionPlacementAtom);

  useEffect(() => {
    if (mobileViewer && exportScale > 2) {
      setExportScale(2);
    }
  }, [exportScale, mobileViewer, setExportScale]);

  const activeAssetId = selectedAssetId ?? "headline";
  const activeAsset = assetStates[activeAssetId];
  const activePlacement = placements[activeAssetId];
  const activeCache = renderCache[activeAssetId];

  return (
    <aside className="panel controls-panel">
      <Section title="Assets" defaultOpen>
        <div className="asset-chip-row">
          {EDITOR_ASSET_IDS.map((assetId) => {
            const cache = renderCache[assetId];
            const status = renderStatus(cache);
            return (
              <button
                key={assetId}
                type="button"
                className={`asset-chip${activeAssetId === assetId ? " active" : ""}`}
                onClick={() => setSelectedAssetId(assetId)}
              >
                <span>{ASSET_LABELS[assetId]}</span>
                <span className={`asset-chip-status ${status}`} />
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Content" defaultOpen>
        <TextAreaField
          id="editor-text"
          label="Text"
          value={activeAsset.text}
          onChange={(value) => patchAssetState({ id: activeAssetId, patch: { text: value } })}
        />
        <SelectField
          id="editor-font"
          label="Font"
          value={activeAsset.fontKey}
          options={EDITOR_FONT_OPTIONS}
          onChange={(value) =>
            patchAssetState({
              id: activeAssetId,
              patch: { fontKey: value as (typeof EDITOR_FONT_OPTIONS)[number]["value"] },
            })
          }
        />
      </Section>

      <Section title="Style" defaultOpen={false}>
        <ColorField
          id="editor-bg"
          label="Background"
          value={activeAsset.backgroundColor}
          onChange={(value) =>
            patchAssetState({ id: activeAssetId, patch: { backgroundColor: value } })
          }
        />
        <ColorField
          id="editor-accent"
          label="Accent"
          value={activeAsset.accentColor}
          onChange={(value) =>
            patchAssetState({ id: activeAssetId, patch: { accentColor: value } })
          }
        />
        <ColorField
          id="editor-text-color"
          label="Text"
          value={activeAsset.textColor}
          onChange={(value) => patchAssetState({ id: activeAssetId, patch: { textColor: value } })}
        />
      </Section>

      <Section title="Canvas Size" defaultOpen={false}>
        <div className="compact-row">
          <NumberField
            id="editor-width"
            label="Width"
            value={activeAsset.canvasWidth}
            min={180}
            max={560}
            step={10}
            unit="px"
            onChange={(value) =>
              patchAssetState({ id: activeAssetId, patch: { canvasWidth: value } })
            }
          />
          <NumberField
            id="editor-height"
            label="Height"
            value={activeAsset.canvasHeight}
            min={100}
            max={320}
            step={10}
            unit="px"
            onChange={(value) =>
              patchAssetState({ id: activeAssetId, patch: { canvasHeight: value } })
            }
          />
        </div>
      </Section>

      <Section title="Placement" defaultOpen={false}>
        <div className="compact-row">
          <NumberField
            id="placement-x"
            label="X"
            value={activePlacement.x}
            min={0}
            max={COMPOSITION_CANVAS.width}
            step={4}
            unit="px"
            onChange={(value) =>
              patchPlacement({
                id: activeAssetId,
                patch: clampPlacement(
                  value,
                  activePlacement.y,
                  activePlacement.width,
                  activePlacement.height,
                ),
              })
            }
          />
          <NumberField
            id="placement-y"
            label="Y"
            value={activePlacement.y}
            min={0}
            max={COMPOSITION_CANVAS.height}
            step={4}
            unit="px"
            onChange={(value) =>
              patchPlacement({
                id: activeAssetId,
                patch: clampPlacement(
                  activePlacement.x,
                  value,
                  activePlacement.width,
                  activePlacement.height,
                ),
              })
            }
          />
        </div>
      </Section>

      <Section title="Export" defaultOpen={!mobileViewer}>
        <SelectField
          id="editor-export-scale"
          label="Whole PNG Scale"
          value={String(exportScale)}
          options={EXPORT_SCALE_OPTIONS.filter(
            (option) => !mobileViewer || Number(option.value) <= 2,
          ).map((option) => ({ value: option.value, label: option.label }))}
          onChange={(value) => setExportScale(Number(value))}
        />
        <div className="editor-inline-note">
          Selected asset ready: <strong>{activeCache.isReady ? "yes" : "no"}</strong>
        </div>
      </Section>
    </aside>
  );
}

function AssetPreviewPanel() {
  return (
    <section className="panel controls-panel mobile-viewer-secondary">
      <div className="editor-panel-head">
        <div>
          <h3>Isolated Asset Previews</h3>
        </div>
      </div>
      <div className="asset-preview-list">
        {EDITOR_ASSET_IDS.map((assetId) => (
          <AssetPreviewCard key={assetId} assetId={assetId} />
        ))}
      </div>
    </section>
  );
}

function AssetPreviewCard({ assetId }: { assetId: EditorAssetId }) {
  const assetStates = useAtomValue(assetStatesAtom);
  const [selectedAssetId, setSelectedAssetId] = useAtom(selectedAssetIdAtom);
  const providerConfig = ASSET_PROVIDER_CONFIGS[assetId];
  const isSelected = selectedAssetId === assetId;

  return (
    // biome-ignore lint/a11y/useSemanticElements: card wraps nested buttons so <button> is not valid
    <div
      className={`asset-preview-card${isSelected ? " active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => setSelectedAssetId(assetId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSelectedAssetId(assetId);
        }
      }}
    >
      <div className="asset-preview-card-head">
        <div>
          <strong>{ASSET_LABELS[assetId]}</strong>
          <span>
            {assetStates[assetId].canvasWidth}x{assetStates[assetId].canvasHeight}px
          </span>
        </div>
      </div>

      {/* Each asset gets its own provider so the engine instance and font registry remain isolated. */}
      <BoundSvgProvider
        config={providerConfig}
        fallback={
          <div className="asset-preview-stage">
            <p className="placeholder-text">Loading engine…</p>
          </div>
        }
      >
        <AssetPreviewCardInner assetId={assetId} state={assetStates[assetId]} />
      </BoundSvgProvider>
    </div>
  );
}

function AssetPreviewCardInner({
  assetId,
  state,
}: {
  assetId: EditorAssetId;
  state: EditorAssetState;
}) {
  const renderCache = useAtomValue(assetRenderCacheAtom)[assetId];
  const setRenderCacheEntry = useSetAtom(setAssetRenderCacheEntryAtom);
  const vnode = useMemo(() => buildAssetVNode(assetId, state), [assetId, state]);
  const pngOptions = useMemo(() => ({ scale: 2 }), []);
  const { svg, error, isReady } = useRenderToSvg(vnode);
  const { png, dataUrl } = useRenderToPng(vnode, pngOptions);

  useEffect(() => {
    // Persist only plain render outputs in Jotai so the composition stage can reuse
    // them without storing engine-specific objects inside the global state graph.
    setRenderCacheEntry({
      id: assetId,
      entry: {
        svg,
        png,
        dataUrl,
        isReady: isReady && svg !== null && png !== null,
        error: error?.message ?? null,
        canvasSize: {
          width: state.canvasWidth,
          height: state.canvasHeight,
        },
      },
    });
  }, [
    assetId,
    dataUrl,
    error,
    isReady,
    png,
    setRenderCacheEntry,
    state.canvasHeight,
    state.canvasWidth,
    svg,
  ]);

  return (
    <>
      <div className="asset-preview-stage">
        {error ? (
          <p className="error-text">Render failed: {error.message}</p>
        ) : svg ? (
          <div className="asset-preview-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="placeholder-text">Rendering asset...</p>
        )}
      </div>

      <div className="asset-preview-meta">
        <span className={`asset-status-pill ${renderStatus(renderCache)}`}>
          {renderStatus(renderCache)}
        </span>
        <span>{renderCache.png?.byteLength ?? 0} bytes</span>
        <button
          type="button"
          className="export-button"
          disabled={!renderCache.png}
          onClick={() => {
            if (!renderCache.png) {
              return;
            }
            downloadPng(renderCache.png, `boundsvg-${assetId}@2x.png`);
          }}
        >
          Export PNG
        </button>
      </div>
    </>
  );
}

type EditorViewTab = "preview" | "svg" | "jsx";
type EditorCodeLayout = "tab" | "panel";

function CompositionPanel() {
  return (
    <BoundSvgProvider
      config={COMPOSITION_PROVIDER_CONFIG}
      fallback={
        <section className="panel preview-panel">
          <div className="preview-stage">
            <p className="placeholder-text">Loading composition engine...</p>
          </div>
        </section>
      }
    >
      <CompositionPanelInner />
    </BoundSvgProvider>
  );
}

type CompositionPreviewBodyProps = {
  viewTab: EditorViewTab;
  codeLayout: EditorCodeLayout;
  highlightedRenderedSvg: string;
  selectedAssetId: EditorAssetId | null;
  hoverNodeId: string | null;
  isDragging: boolean;
  error: Error | null;
  isReady: boolean;
  svg: string | null;
  bindContainerRef: (node: HTMLDivElement | null) => void;
  overlayStyle: CSSProperties | null;
  startDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  selectedNode: IRNode | null;
  exportError: string | null;
};

function formatSelectedBbox(selectedNode: IRNode | null): string {
  if (!selectedNode) {
    return "none";
  }
  const { x, y, w, h } = selectedNode.bbox;
  return `${Math.round(x)}, ${Math.round(y)} / ${Math.round(w)}x${Math.round(h)}`;
}

function CompositionPreviewBody({
  viewTab,
  codeLayout,
  highlightedRenderedSvg,
  selectedAssetId,
  hoverNodeId,
  isDragging,
  error,
  isReady,
  svg,
  bindContainerRef,
  overlayStyle,
  startDrag,
  selectedNode,
  exportError,
}: CompositionPreviewBodyProps) {
  if (viewTab === "svg" && codeLayout === "tab") {
    return (
      <div className="preview-body">
        <div className="code-block" dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }} />
      </div>
    );
  }
  return (
    <div className="preview-body">
      <div className="editor-composition-info">
        <span>Selected: {selectedAssetId ?? "none"}</span>
        <span className="copy-hover">Hover: {hoverNodeId ?? "none"}</span>
        <span>Mode: {isDragging ? "dragging" : "idle"}</span>
      </div>

      <div className="preview-stage">
        {error ? (
          <p className="error-text">Composition render failed: {error.message}</p>
        ) : !isReady || !svg ? (
          <p className="placeholder-text">Rendering composition…</p>
        ) : (
          <div className="editor-canvas-shell">
            <div
              ref={bindContainerRef}
              className="editor-canvas-content rendered-content"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            {overlayStyle && selectedAssetId ? (
              <div className="editor-selection-overlay" style={overlayStyle}>
                <div className="editor-sel-corner tl" />
                <div className="editor-sel-corner br" />
                <div className="editor-sel-anchor textRect" />
                <div className="editor-sel-anchor bl" />
                <div
                  className="editor-selection-drag"
                  role="presentation"
                  onPointerDown={startDrag}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="editor-composition-meta">
        <div>
          <strong>Canvas</strong>
          <span>
            {COMPOSITION_CANVAS.width} x {COMPOSITION_CANVAS.height}px
          </span>
        </div>
        <div>
          <strong>Selected bbox</strong>
          <span>{formatSelectedBbox(selectedNode)}</span>
        </div>
        {exportError ? (
          <div>
            <strong>Error</strong>
            <span className="error-text">{exportError}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompositionPanelInner() {
  const { engine, status } = useBoundSvg();
  const mobileViewer = useMobileViewer();
  const renderCache = useAtomValue(assetRenderCacheAtom);
  const placements = useAtomValue(compositionPlacementsAtom);
  const [selectedAssetId, setSelectedAssetId] = useAtom(selectedAssetIdAtom);
  const exportScale = useAtomValue(exportScaleAtom);
  const patchPlacement = useSetAtom(patchCompositionPlacementAtom);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [viewTab, setViewTab] = useState<EditorViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<EditorCodeLayout>("tab");
  useResetPreviewForMobile(mobileViewer, setViewTab, setCodeLayout);
  const [, startTransition] = useTransition();

  const handlerIds = useMemo(
    () => ({
      headline: "editor:headline:pointerdown",
      badge: "editor:badge:pointerdown",
      stamp: "editor:stamp:pointerdown",
    }),
    [],
  );

  // Ref so the handler closure always reads the latest placements without
  // recreating the handler map on every placement change.
  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  const startDragForAsset = useCallback(
    (assetId: EditorAssetId, clientX: number, clientY: number) => {
      if (!contentRef.current) {
        return;
      }
      const placement = placementsRef.current[assetId];
      const width = contentRef.current.clientWidth;
      const height = contentRef.current.clientHeight;
      if (width <= 0 || height <= 0) {
        return;
      }

      setIsDragging(true);
      document.body.style.userSelect = "none";
      dragRef.current = {
        assetId,
        startClientX: clientX,
        startClientY: clientY,
        originX: placement.x,
        originY: placement.y,
        width: placement.width,
        height: placement.height,
        scaleX: COMPOSITION_CANVAS.width / width,
        scaleY: COMPOSITION_CANVAS.height / height,
      };
    },
    [],
  );

  const handlers = useMemo(
    (): Map<string, EventCallback> =>
      new Map(
        EDITOR_ASSET_IDS.map((assetId) => [
          handlerIds[assetId],
          (info: { nativeEvent: PointerEvent | MouseEvent | TouchEvent }) => {
            setSelectedAssetId(assetId);
            const evt = info.nativeEvent;
            if ("clientX" in evt) {
              evt.preventDefault();
              startDragForAsset(assetId, evt.clientX, evt.clientY);
            }
          },
        ]),
      ),
    [handlerIds, setSelectedAssetId, startDragForAsset],
  );

  const vnode = useMemo<VNode>(
    () => buildCompositionVNode(renderCache, placements, selectedAssetId, handlerIds),
    [handlerIds, placements, renderCache, selectedAssetId],
  );

  const { svg, ir, error, hoverNodeId, isReady, containerRef } = useInteractiveSvg(vnode, handlers);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const nextPlacementRef = useRef<{ id: EditorAssetId; x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);

  const bindContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      containerRef(node);
      if (node) {
        setContainerSize({
          width: node.clientWidth,
          height: node.clientHeight,
        });
      }
    },
    [containerRef],
  );

  useEffect(() => {
    const node = contentRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setContainerSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const selectedNode = useMemo(
    () => (selectedAssetId && ir ? findLeafNodeById(ir.root, selectedAssetId) : null),
    [ir, selectedAssetId],
  );

  const overlayStyle = useMemo(
    () => selectionStyle(selectedNode, containerSize.width, containerSize.height),
    [containerSize.height, containerSize.width, selectedNode],
  );

  const flushDrag = useCallback(() => {
    rafRef.current = 0;
    const next = nextPlacementRef.current;
    if (!next) {
      return;
    }
    patchPlacement({
      id: next.id,
      patch: {
        x: next.x,
        y: next.y,
      },
    });
  }, [patchPlacement]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }

      const deltaX = (event.clientX - drag.startClientX) * drag.scaleX;
      const deltaY = (event.clientY - drag.startClientY) * drag.scaleY;
      const clamped = clampPlacement(
        drag.originX + deltaX,
        drag.originY + deltaY,
        drag.width,
        drag.height,
      );
      nextPlacementRef.current = {
        id: drag.assetId,
        x: clamped.x,
        y: clamped.y,
      };

      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(flushDrag);
      }
    }

    function finishDrag() {
      if (!dragRef.current) {
        return;
      }
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (nextPlacementRef.current) {
        patchPlacement({
          id: nextPlacementRef.current.id,
          patch: {
            x: nextPlacementRef.current.x,
            y: nextPlacementRef.current.y,
          },
        });
      }
      dragRef.current = null;
      nextPlacementRef.current = null;
      setIsDragging(false);
      document.body.style.userSelect = "";
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishDrag);
    document.addEventListener("pointercancel", finishDrag);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishDrag);
      document.removeEventListener("pointercancel", finishDrag);
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
      }
      document.body.style.userSelect = "";
    };
  }, [flushDrag, patchPlacement]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!selectedAssetId) {
        return;
      }
      event.preventDefault();
      startDragForAsset(selectedAssetId, event.clientX, event.clientY);
    },
    [selectedAssetId, startDragForAsset],
  );

  const handleExport = useCallback(() => {
    if (!engine) {
      return;
    }
    try {
      setIsExporting(true);
      const png = engine.renderToPng(vnode, { scale: exportScale });
      downloadPng(png, `boundsvg-composition@${exportScale}x.png`);
      setExportError(null);
    } catch (renderError) {
      setExportError(renderError instanceof Error ? renderError.message : String(renderError));
    } finally {
      setIsExporting(false);
    }
  }, [engine, exportScale, vnode]);

  const highlightedRenderedSvg = useMemo(() => {
    if (status !== "ready" || !engine) {
      return "";
    }
    try {
      const renderedSvg = engine.renderToSvg(vnode);
      const formatted = formatSvgCode(renderedSvg);
      return wrapInLineElements(Prism.highlight(formatted, getPrismGrammar("markup"), "markup"));
    } catch {
      return "";
    }
  }, [engine, status, vnode]);

  const showCode = viewTab !== "preview" && viewTab !== "svg";
  const activeCodeTab: "svg" | "jsx" = viewTab === "svg" || viewTab === "jsx" ? viewTab : "jsx";

  const jsxSnippetCode = useMemo(() => generateJsxSnippet(vnode), [vnode]);
  const highlightedJsxSnippet = useMemo(
    () => Prism.highlight(jsxSnippetCode, getPrismGrammar("tsx"), "tsx"),
    [jsxSnippetCode],
  );

  return (
    <section
      className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
    >
      <div className="preview-header editor-composition-header">
        <div className="preview-header-meta">
          <h3>Main Composition</h3>
          <span className="copy-hover">Drag an embedded SVG to move it.</span>
          <span className="copy-touch">Tap an asset to inspect the composed result.</span>
        </div>
        {codeLayout === "tab" && (
          <div className="preview-view-tabs">
            {(["preview", "svg", "jsx"] as const).map((tab) => {
              const labels: Record<EditorViewTab, string> = {
                preview: "Preview",
                svg: "Rendered SVG",
                jsx: "Generated JSX",
              };
              return (
                <button
                  key={tab}
                  type="button"
                  className={`preview-view-tab ${viewTab === tab ? "active" : ""}`}
                  onClick={() => startTransition(() => setViewTab(tab))}
                >
                  {labels[tab]}
                </button>
              );
            })}
          </div>
        )}
        <div className="editor-composition-actions">
          <button
            type="button"
            className="export-button editor-composition-export"
            title={`Export composition as PNG at ${exportScale}x scale`}
            disabled={status !== "ready" || !engine || isExporting}
            onClick={handleExport}
          >
            {isExporting
              ? "Exporting…"
              : mobileViewer
                ? `PNG · ${exportScale}×`
                : `Export PNG (${exportScale}x)`}
          </button>
          <button
            type="button"
            className="layout-toggle-btn"
            title={codeLayout === "tab" ? "Split view" : "Tab view"}
            onClick={() =>
              startTransition(() =>
                setCodeLayout((layoutMode) => (layoutMode === "tab" ? "panel" : "tab")),
              )
            }
          >
            {codeLayout === "tab" ? (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="1.5" y="1.5" width="11" height="6" rx="1" />
                <rect x="1.5" y="9" width="11" height="3.5" rx="1" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="1.5" y="1.5" width="11" height="11" rx="1" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <CompositionPreviewBody
        viewTab={viewTab}
        codeLayout={codeLayout}
        highlightedRenderedSvg={highlightedRenderedSvg}
        selectedAssetId={selectedAssetId}
        hoverNodeId={hoverNodeId}
        isDragging={isDragging}
        error={error}
        isReady={isReady}
        svg={svg}
        bindContainerRef={bindContainerRef}
        overlayStyle={overlayStyle}
        startDrag={startDrag}
        selectedNode={selectedNode}
        exportError={exportError}
      />

      <div className="code-area">
        {codeLayout === "panel" && (
          <div className="code-area-tabs">
            {(["svg", "jsx"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`preview-view-tab ${activeCodeTab === tab ? "active" : ""}`}
                onClick={() => startTransition(() => setViewTab(tab))}
              >
                {tab === "svg" ? "Rendered SVG" : "Generated JSX"}
              </button>
            ))}
          </div>
        )}
        {activeCodeTab === "svg" ? (
          <div
            className="code-block code-block-full"
            dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
          />
        ) : (
          <pre className="code-block code-block-full">
            <code dangerouslySetInnerHTML={{ __html: highlightedJsxSnippet }} />
          </pre>
        )}
      </div>
    </section>
  );
}
