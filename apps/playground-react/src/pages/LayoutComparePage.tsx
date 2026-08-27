import { BoundSvg, type RenderSvgOptions } from "@boundsvg/react";
import { BoundSvgDebugOverlay } from "@boundsvg/react/debug";
import { type InspectionBBox, useBoundSvgInspection } from "@boundsvg/react/inspect";
import { useBoundSvg } from "@boundsvg/react/provider";
import Prism from "prismjs";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import { getPrismGrammar } from "../../../playground-shared/prism.js";
import { Section, useCloseDetailsOnOutsidePointer } from "../components/fields";
import { useMobileViewer, useResetPreviewForMobile } from "../hooks/use-mobile-viewer";
import { useSvgInspect } from "../hooks/use-svg-inspect";
import { formatMarkup, generateJsxSnippet } from "../lib/codegen";
import {
  MEASURE_KINDS,
  type MeasuredRect,
  MeasureLabels,
  measureHtmlDescendants,
} from "../lib/measure";
import { COMPARE_PATTERN_BY_ID, COMPARE_PATTERNS } from "./compare-patterns/index";

type CompareViewTab = "preview" | "jsx" | "svg" | "html";
type CodeLayout = "tab" | "panel";
type CompareOverlayPart = "svg-box" | "svg-text" | "html-box" | "html-text";

const COMPARE_OVERLAY_OPTIONS: Array<{ value: CompareOverlayPart; label: string }> = [
  { value: "svg-box", label: "SVG boxes" },
  { value: "svg-text", label: "SVG text" },
  { value: "html-box", label: "HTML boxes" },
  { value: "html-text", label: "HTML text" },
];

function useElementContentWidth(): [
  setElement: (element: HTMLDivElement | null) => void,
  contentWidth: number | null,
] {
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const setElement = useCallback((element: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!element) {
      return;
    }
    const updateContentWidth = () => {
      const style = getComputedStyle(element);
      const nextContentWidth = Math.max(
        0,
        element.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
      );
      setContentWidth((currentWidth) =>
        currentWidth === nextContentWidth ? currentWidth : nextContentWidth,
      );
    };
    updateContentWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const resizeObserver = new ResizeObserver(updateContentWidth);
    resizeObserver.observe(element);
    resizeObserverRef.current = resizeObserver;
  }, []);
  return [setElement, contentWidth];
}

function resolveCompareScale(
  mobileViewer: boolean,
  contentWidth: number | null,
  canvasWidth: number,
): number {
  if (!mobileViewer || contentWidth === null || contentWidth <= 0) {
    return 1;
  }
  return Math.min(1, contentWidth / canvasWidth);
}

export function LayoutComparePage() {
  const { engine, status } = useBoundSvg();
  const mobileViewer = useMobileViewer();
  const firstPattern = COMPARE_PATTERNS[0];
  if (!firstPattern) {
    throw new Error("COMPARE_PATTERNS must have at least one entry");
  }
  const [patternId, setPatternId] = useState(firstPattern.id);
  const [overlayParts, setOverlayParts] = useState<CompareOverlayPart[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<CompareViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  useResetPreviewForMobile(mobileViewer, setViewTab, setCodeLayout);
  const [setCompareStageElement, compareContentWidth] = useElementContentWidth();

  const [isPending, startTransition] = useTransition();

  const pattern = COMPARE_PATTERN_BY_ID.get(patternId) ?? firstPattern;
  const compareScale = resolveCompareScale(mobileViewer, compareContentWidth, pattern.canvasWidth);
  const compareViewportStyle = {
    width: pattern.canvasWidth * compareScale,
    height: pattern.canvasHeight * compareScale,
  };
  const compareLogicalSurfaceStyle = {
    width: pattern.canvasWidth,
    height: pattern.canvasHeight,
    transform: `scale(${compareScale})`,
  };
  const vnode = useMemo(() => pattern.buildVNode(), [pattern]);
  const renderOptions = useMemo<RenderSvgOptions>(() => ({ debug: false }), []);
  const selectedOverlayParts = useMemo(() => new Set(overlayParts), [overlayParts]);
  const showSvgOverlay =
    selectedOverlayParts.has("svg-box") || selectedOverlayParts.has("svg-text");
  const showHtmlBoxOverlay = selectedOverlayParts.has("html-box");
  const showHtmlTextOverlay = selectedOverlayParts.has("html-text");
  const showHtmlOverlay = showHtmlBoxOverlay || showHtmlTextOverlay;
  const htmlHiddenKinds = useMemo(
    () =>
      new Set<string>(
        MEASURE_KINDS.filter(
          (measureKind) => !selectedOverlayParts.has(getCompareHtmlOverlayPart(measureKind.kind)),
        ).map((measureKind) => measureKind.kind),
      ),
    [selectedOverlayParts],
  );

  const deferredVNode = useDeferredValue(vnode);
  const deferredRenderOptions = useDeferredValue(renderOptions);

  const jsxCode = useMemo(() => generateJsxSnippet(vnode), [vnode]);

  // Inspect hover: bidirectional SVG↔code highlight (replaces useRenderToSvg for SVG tab)
  const {
    highlightedSvg: highlightedRenderedSvg,
    setPreviewEl: setInspectPreviewEl,
    setCodeEl: setInspectCodeEl,
  } = useSvgInspect(engine, status, deferredVNode, deferredRenderOptions);
  const { inspection: svgInspection, error: svgInspectionError } = useBoundSvgInspection(
    showSvgOverlay ? deferredVNode : null,
    deferredRenderOptions,
  );

  const htmlSurfaceRef = useRef<HTMLDivElement>(null);
  const [htmlRects, setHtmlRects] = useState<MeasuredRect[]>([]);
  const [capturedHtml, setCapturedHtml] = useState("");

  const visibleSvgBBoxes = useMemo(
    () =>
      svgInspection?.bboxes.filter((bbox) =>
        selectedOverlayParts.has(getCompareSvgOverlayPart(bbox)),
      ) ?? [],
    [svgInspection, selectedOverlayParts],
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (htmlSurfaceRef.current) {
        setCapturedHtml(htmlSurfaceRef.current.innerHTML);
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const selectPattern = useCallback((id: string) => {
    startTransition(() => {
      setPatternId(id);
      setHoveredNodeId(null);
      setSelectedNodeId(null);
    });
  }, []);

  useEffect(() => {
    if (!showHtmlOverlay) {
      setHtmlRects([]);
      return;
    }
    const id = requestAnimationFrame(() => {
      if (htmlSurfaceRef.current) {
        setHtmlRects(measureHtmlDescendants(htmlSurfaceRef.current));
      }
    });
    return () => cancelAnimationFrame(id);
  }, [showHtmlOverlay]);

  useEffect(() => {
    if (!showSvgOverlay) {
      setHoveredNodeId(null);
      setSelectedNodeId(null);
    }
  }, [showSvgOverlay]);

  useEffect(() => {
    if (
      selectedNodeId != null &&
      !visibleSvgBBoxes.some((bbox) => bbox.nodeId === selectedNodeId)
    ) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, visibleSvgBBoxes]);

  const categoryLabel = (category: string) => (category === "composite" ? "flex / grid" : category);

  return (
    <div className="playground-layout">
      <aside className="panel controls-panel">
        <Section title="Pattern" defaultOpen>
          {mobileViewer ? (
            <label className="mobile-sample-select">
              <span>Sample</span>
              <select value={patternId} onChange={(event) => selectPattern(event.target.value)}>
                {COMPARE_PATTERNS.map((pattern) => (
                  <option key={pattern.id} value={pattern.id}>
                    {pattern.title} — {categoryLabel(pattern.category)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="stack-list">
              {COMPARE_PATTERNS.map((pattern) => {
                const active = pattern.id === patternId;
                return (
                  <button
                    key={pattern.id}
                    type="button"
                    className={`template-button ${active ? "active" : ""}`}
                    data-playground-locator-level="sample"
                    data-playground-locator-segment={`Sample: ${pattern.title} [${pattern.id}]`}
                    onClick={() => selectPattern(pattern.id)}
                  >
                    <div className="pattern-title-row">
                      <strong>{pattern.title}</strong>
                      <span className="pattern-category">{categoryLabel(pattern.category)}</span>
                    </div>
                    <span>{pattern.description}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      </aside>

      <aside className="panel controls-panel mobile-viewer-secondary">
        <Section title="Options" defaultOpen>
          <CompareBBoxOverlayField
            id="compare-debug"
            value={overlayParts}
            onChange={(value) => startTransition(() => setOverlayParts(value))}
          />
          {showSvgOverlay && (
            <div className="nested-options">
              <div className="debug-node-list">
                <div className="debug-node-list-header">
                  <span>Render tree BBoxes</span>
                  <span>{visibleSvgBBoxes.length}</span>
                </div>
                {svgInspectionError && (
                  <p className="error-text">Inspection failed: {svgInspectionError.message}</p>
                )}
                {!svgInspectionError && visibleSvgBBoxes.length === 0 && (
                  <p className="placeholder-text">No visible SVG bboxes.</p>
                )}
                {visibleSvgBBoxes.map((bbox) => {
                  const active = bbox.nodeId === selectedNodeId || bbox.nodeId === hoveredNodeId;
                  return (
                    <button
                      key={`${bbox.nodeId}:${bbox.depth}`}
                      type="button"
                      className={`debug-node-list-item${active ? " active" : ""}`}
                      onMouseEnter={() => setHoveredNodeId(bbox.nodeId)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onFocus={() => setHoveredNodeId(bbox.nodeId)}
                      onBlur={() => setHoveredNodeId(null)}
                      onClick={() =>
                        setSelectedNodeId((currentNodeId) =>
                          currentNodeId === bbox.nodeId ? null : bbox.nodeId,
                        )
                      }
                    >
                      <span className="debug-node-id">{bbox.nodeId}</span>
                      <span className="debug-node-meta">{formatInspectionBBox(bbox)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Section>
      </aside>

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${viewTab !== "preview" ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>{pattern.title}</h3>
            <span>{pattern.description}</span>
          </div>
          {codeLayout === "tab" && (
            <div className="preview-view-tabs">
              {(["preview", "jsx", "svg", "html"] as const).map((tab) => {
                const labels: Record<CompareViewTab, string> = {
                  preview: "Preview",
                  jsx: "Generated JSX",
                  svg: "Rendered SVG",
                  html: "HTML Reference",
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

        <div className="preview-body">
          <div
            ref={setCompareStageElement}
            className={`compare-stage${isPending ? " is-pending" : ""}`}
            style={{ "--compare-canvas-w": `${pattern.canvasWidth}px` } as React.CSSProperties}
          >
            <div className="compare-pane">
              <div className="compare-pane-label">BoundSvg</div>
              <div className="compare-pane-surface-viewport" style={compareViewportStyle}>
                <div
                  ref={setInspectPreviewEl}
                  className="compare-pane-surface-wrap"
                  style={compareLogicalSurfaceStyle}
                >
                  <BoundSvg
                    vnode={deferredVNode}
                    className="rendered-content"
                    renderOptions={deferredRenderOptions}
                    fallback={<p className="placeholder-text">Rendering…</p>}
                    errorFallback={(error) => (
                      <p className="error-text">Render failed: {error.message}</p>
                    )}
                  />
                  {showSvgOverlay && (
                    <BoundSvgDebugOverlay
                      inspection={svgInspection}
                      labelMode="summary"
                      filter={(bbox) => selectedOverlayParts.has(getCompareSvgOverlayPart(bbox))}
                      selectedNodeId={selectedNodeId}
                      highlightedNodeIds={hoveredNodeId != null ? [hoveredNodeId] : []}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="compare-pane">
              <div className="compare-pane-label">HTML / CSS</div>
              <div className="compare-pane-surface-viewport" style={compareViewportStyle}>
                <div className="compare-pane-surface-wrap" style={compareLogicalSurfaceStyle}>
                  <div
                    ref={htmlSurfaceRef}
                    className={`compare-html-surface${showHtmlBoxOverlay ? " debug" : ""}`}
                    style={{ width: pattern.canvasWidth, height: pattern.canvasHeight }}
                  >
                    {pattern.buildHtml()}
                  </div>
                  {showHtmlOverlay && (
                    <MeasureLabels rects={htmlRects} hiddenKinds={htmlHiddenKinds} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="code-area">
          {codeLayout === "panel" && (
            <div className="code-area-tabs">
              {(["jsx", "svg", "html"] as const).map((tab) => {
                const labels = {
                  jsx: "Generated JSX",
                  svg: "Rendered SVG",
                  html: "HTML Reference",
                };
                const active = viewTab === "preview" ? tab === "jsx" : viewTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    className={`preview-view-tab ${active ? "active" : ""}`}
                    onClick={() => startTransition(() => setViewTab(tab))}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
          )}
          {(() => {
            const activeTab = viewTab === "preview" ? "jsx" : viewTab;
            if (activeTab === "svg") {
              return (
                <div
                  ref={setInspectCodeEl}
                  className="code-block code-block-full"
                  dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
                />
              );
            }
            return (
              <pre className="code-block code-block-full">
                <code
                  dangerouslySetInnerHTML={{
                    __html: Prism.highlight(
                      activeTab === "jsx" ? jsxCode : formatMarkup(capturedHtml),
                      activeTab === "jsx" ? getPrismGrammar("tsx") : getPrismGrammar("markup"),
                      activeTab === "jsx" ? "tsx" : "markup",
                    ),
                  }}
                />
              </pre>
            );
          })()}
        </div>
      </section>
    </div>
  );
}

function CompareBBoxOverlayField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: readonly CompareOverlayPart[];
  onChange: (value: CompareOverlayPart[]) => void;
}) {
  const detailsRef = useCloseDetailsOnOutsidePointer();
  const selected = new Set(value);
  const togglePart = (part: CompareOverlayPart, checked: boolean): void => {
    const next = new Set(value);
    if (checked) {
      next.add(part);
    } else {
      next.delete(part);
    }
    onChange(
      COMPARE_OVERLAY_OPTIONS.map((option) => option.value).filter((entry) => next.has(entry)),
    );
  };

  return (
    <div className="control-group control-group-bbox">
      <div className="control-head">
        <span>BBox Overlay</span>
      </div>
      <details ref={detailsRef} className="bbox-overlay-menu">
        <summary id={id}>{`BBox Overlay: ${formatCompareOverlaySummary(value)}`}</summary>
        <fieldset className="bbox-overlay-options" aria-labelledby={id}>
          {COMPARE_OVERLAY_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.has(option.value)}
                onChange={(event) => togglePart(option.value, event.target.checked)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      </details>
    </div>
  );
}

function formatCompareOverlaySummary(parts: readonly CompareOverlayPart[]): string {
  if (parts.length === 0) {
    return "off";
  }
  const labels = new Map(COMPARE_OVERLAY_OPTIONS.map((option) => [option.value, option.label]));
  return parts.map((part) => labels.get(part) ?? part).join(", ");
}

function getCompareHtmlOverlayPart(kind: MeasuredRect["kind"]): CompareOverlayPart {
  return kind === "text" ? "html-text" : "html-box";
}

function getCompareSvgOverlayPart(bbox: InspectionBBox): CompareOverlayPart {
  return getInspectionKind(bbox) === "text" ? "svg-text" : "svg-box";
}

function getInspectionKind(bbox: InspectionBBox): MeasuredRect["kind"] {
  return bbox.type === "text" ? "text" : "box";
}

function formatInspectionBBox(bbox: InspectionBBox): string {
  const drawLabel = bbox.drawIndex == null ? "#-" : `#${bbox.drawIndex}`;
  return `${bbox.type} ${formatDebugNumber(bbox.w)}x${formatDebugNumber(
    bbox.h,
  )} @ ${formatDebugNumber(bbox.x)},${formatDebugNumber(bbox.y)} d${bbox.depth} ${drawLabel}`;
}

function formatDebugNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1).replace(/\.0$/, "");
}
