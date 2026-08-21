import type {
  DebugOverlayConfig,
  DebugOverlayPart,
  LayerEntry,
  LayeredCompositionValidationResult,
  LayerPngEntry,
  LayerWarning,
  VNode,
} from "@boundsvg/core";
import { type BoundSvgConfig, BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import {
  useRenderToLayeredPngAsync,
  useRenderToLayeredSvgAsync,
  useRenderToPngAsync,
  useRenderToSvgAndIrAsync,
} from "@boundsvg/react/worker";
import Prism from "prismjs";
import { buildNodeBBoxMap } from "../../../../playground-shared/event-effects.js";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { EventEffectOverlayDisplayOptions } from "../../../../playground-shared/inspect-hover.js";
import { getPrismGrammar } from "../../../../playground-shared/prism.js";
import { BBoxOverlayField } from "../../components/fields";
import { useSvgInspectFromData } from "../../hooks/use-svg-inspect";
import { asset } from "../../lib/asset";
import { generateJsxSnippet } from "../../lib/codegen";
import { resolveDebugOverlayConfig } from "../../lib/debug-overlay";
import { buildLayeredFixtures } from "./fixtures";

type OverlayMode = NonNullable<EventEffectOverlayDisplayOptions["mode"]>;

const OVERLAY_MODE_OPTIONS: Array<{ value: OverlayMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "layout", label: "Layout bbox" },
  { value: "transform", label: "Transform box" },
  { value: "visual", label: "Visual bounds" },
  { value: "all", label: "All" },
];

// ---------------------------------------------------------------------------
// Worker-enabled config (separate from the main app's non-Worker provider)
// ---------------------------------------------------------------------------

const workerConfig: BoundSvgConfig = {
  fonts: [
    {
      alias: "NotoSansJP-woff2",
      weight: 400,
      style: "normal",
      source: asset("/fonts/NotoSansJP-Regular.subset.woff2"),
    },
  ],
  worker: { mode: "prefer" },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Format = "svg" | "png";
type ViewTab = "preview" | "rendered" | "jsx" | "manifest";
type CodeLayout = "tab" | "panel";

const CODE_TAB_LABELS: Record<Exclude<ViewTab, "preview">, string> = {
  rendered: "Rendered SVG",
  jsx: "Generated JSX",
  manifest: "Manifest JSON",
};

const LAYER_GAP_PX = 60;

function layerKey(layer: { id: string; paintOrder: number }): string {
  return `${layer.id}-${layer.paintOrder}`;
}

/**
 * Gate a hook's data on "it was produced for the currently active vnode".
 *
 * The shared worker hooks keep stale `data` during re-renders (the field is
 * only replaced once the new promise resolves). When users flip between preset
 * + format in rapid succession, a format whose hook hasn't finished rendering
 * the new preset would briefly display the previous preset's result. This
 * helper stores the last *settled* result together with the vnode that
 * produced it, and returns `null` whenever the current vnode doesn't match —
 * so the consumer shows a "Rendering…" placeholder instead of stale data.
 */
function useStableResult<T>(data: T | null, isRendering: boolean, vnode: VNode | null): T | null {
  const [entry, setEntry] = useState<{ data: T; vnode: VNode | null } | null>(null);

  useEffect(() => {
    if (!isRendering && data !== null) {
      setEntry((prev) =>
        prev !== null && prev.data === data && prev.vnode === vnode ? prev : { data, vnode },
      );
    }
  }, [isRendering, data, vnode]);

  if (entry === null) {
    return null;
  }
  return entry.vnode === vnode ? entry.data : null;
}

/**
 * Bundle the four async worker renders plus their "stable-for-current-vnode"
 * gating. Extracted into its own hook to keep `LayeredContent` under biome's
 * cognitive-complexity ceiling.
 */
function useLayeredRenders(
  vnode: VNode | null,
  opts: { validate: boolean; debug: false | DebugOverlayConfig },
) {
  const { validate, debug } = opts;
  const layeredOptions = useMemo(
    () => (validate ? { debug, validateComposition: { enabled: true } } : { debug }),
    [validate, debug],
  );

  const singleSvg = useRenderToSvgAndIrAsync(vnode);
  const singlePng = useRenderToPngAsync(vnode);
  const layeredSvg = useRenderToLayeredSvgAsync(vnode, layeredOptions);
  const layeredPng = useRenderToLayeredPngAsync(vnode, layeredOptions);

  const stableSingleSvg = useStableResult(singleSvg.svg, singleSvg.isRendering, vnode);
  const stableSingleIr = useStableResult(singleSvg.ir, singleSvg.isRendering, vnode);
  const stableSinglePngDataUrl = useStableResult(singlePng.dataUrl, singlePng.isRendering, vnode);
  const stableLayeredSvg = useStableResult(layeredSvg.result, layeredSvg.isRendering, vnode);
  const stableLayeredPng = useStableResult(layeredPng.result, layeredPng.isRendering, vnode);
  const stableLayerDataUrls = useStableResult(
    layeredPng.layerDataUrls,
    layeredPng.isRendering,
    vnode,
  );

  return {
    singleSvgStatus: {
      isRendering: singleSvg.isRendering,
      error: singleSvg.error,
      svg: stableSingleSvg,
      ir: stableSingleIr,
    },
    singlePngStatus: {
      isRendering: singlePng.isRendering,
      error: singlePng.error,
      dataUrl: stableSinglePngDataUrl,
    },
    layeredSvgStatus: {
      isRendering: layeredSvg.isRendering,
      error: layeredSvg.error,
      result: stableLayeredSvg,
    },
    layeredPngStatus: {
      isRendering: layeredPng.isRendering,
      error: layeredPng.error,
      result: stableLayeredPng,
      layerDataUrls: stableLayerDataUrls,
    },
  };
}

type LayerListEntry = { key: string; id: string; paintOrder: number };

type LayerListProps = {
  layers: LayerListEntry[];
  hidden: Record<string, boolean>;
  focusKey: string | null;
  isRendering: boolean;
  onFocusChange: (key: string | null) => void;
  onToggleHidden: (key: string) => void;
};

function LayerList({
  layers,
  hidden,
  focusKey,
  isRendering,
  onFocusChange,
  onToggleHidden,
}: LayerListProps) {
  if (layers.length === 0) {
    return (
      <p className="layered-hint-text">
        {isRendering ? "Rendering in Worker…" : "Waiting for Worker…"}
      </p>
    );
  }
  return (
    <ul className="layered-layer-list">
      {layers.map((layer, index) => {
        const isHidden = !!hidden[layer.key];
        const isFocused = focusKey === layer.key;
        return (
          <li
            key={layer.key}
            className={`layered-layer-row ${isFocused ? "is-focused" : ""}`}
            onMouseEnter={() => onFocusChange(layer.key)}
            onMouseLeave={() => onFocusChange(null)}
          >
            <label className="layered-layer-check">
              <input
                type="checkbox"
                checked={!isHidden}
                onChange={() => onToggleHidden(layer.key)}
              />
              <span className="layered-layer-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="layered-layer-id">{layer.id}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

type LayerStatusTableProps = {
  status: string;
  workerActive: boolean;
  format: Format;
  layeredSvgResult: ReturnType<typeof useRenderToLayeredSvgAsync>["result"];
  compositionValidation: LayeredCompositionValidationResult | undefined;
  providerError: Error | null;
  renders: ReturnType<typeof useLayeredRenders>;
};

function LayerStatusTable({
  status,
  workerActive,
  format,
  layeredSvgResult,
  compositionValidation,
  providerError,
  renders,
}: LayerStatusTableProps) {
  const { singleSvgStatus, singlePngStatus, layeredSvgStatus, layeredPngStatus } = renders;
  return (
    <div className="status-table">
      <StatusRow label="Provider" value={status} />
      <StatusRow label="Worker" value={workerActive ? "active" : "none"} />
      <StatusRow
        label="Layers"
        value={layeredSvgResult ? String(layeredSvgResult.layers.length) : "—"}
      />
      {compositionValidation && (
        <StatusRow
          label="Validation"
          value={compositionValidation.status}
          valueClassName={compositionValidation.status === "mismatched" ? "error-text" : undefined}
        />
      )}
      {providerError && (
        <StatusRow label="Init" value={providerError.message} valueClassName="error-text" />
      )}
      {singleSvgStatus.error && format === "svg" && (
        <StatusRow
          label="Render"
          value={singleSvgStatus.error.message}
          valueClassName="error-text"
        />
      )}
      {singlePngStatus.error && format === "png" && (
        <StatusRow
          label="Render"
          value={singlePngStatus.error.message}
          valueClassName="error-text"
        />
      )}
      {layeredSvgStatus.error && format === "svg" && (
        <StatusRow
          label="Layered"
          value={layeredSvgStatus.error.message}
          valueClassName="error-text"
        />
      )}
      {layeredPngStatus.error && format === "png" && (
        <StatusRow
          label="Layered"
          value={layeredPngStatus.error.message}
          valueClassName="error-text"
        />
      )}
    </div>
  );
}

type LayeredPreviewBodyProps = {
  format: Format;
  stableSingleSvg: string | null;
  stableSinglePngDataUrl: string | null;
  currentSingleIsRendering: boolean;
  setPreviewEl: (element: HTMLDivElement | null) => void;
  layeredSvgResult: ReturnType<typeof useRenderToLayeredSvgAsync>["result"];
  layeredPngResult: ReturnType<typeof useRenderToLayeredPngAsync>["result"];
  stableLayerDataUrls: string[] | null;
  tilt: boolean;
  hidden: Record<string, boolean>;
  focusKey: string | null;
  onFocusChange: (key: string | null) => void;
  currentLayeredIsRendering: boolean;
};

function LayeredPreviewBody({
  format,
  stableSingleSvg,
  stableSinglePngDataUrl,
  currentSingleIsRendering,
  setPreviewEl,
  layeredSvgResult,
  layeredPngResult,
  stableLayerDataUrls,
  tilt,
  hidden,
  focusKey,
  onFocusChange,
  currentLayeredIsRendering,
}: LayeredPreviewBodyProps) {
  return (
    <div className="preview-body">
      <div className="preview-meta-inline">
        <h3>Single {format.toUpperCase()}</h3>
        <span>Full composite from {format === "svg" ? "renderToSvg" : "renderToPng"}</span>
      </div>
      {format === "svg" && stableSingleSvg ? (
        <div ref={setPreviewEl} className="preview-stage">
          <div className="rendered-content" dangerouslySetInnerHTML={{ __html: stableSingleSvg }} />
        </div>
      ) : (
        <div className="preview-stage">
          {format === "png" && stableSinglePngDataUrl ? (
            <div className="rendered-content">
              <img className="preview-image" src={stableSinglePngDataUrl} alt="Single PNG output" />
            </div>
          ) : (
            <p className="placeholder-text">
              {currentSingleIsRendering ? "Rendering in Worker…" : "Waiting for Worker…"}
            </p>
          )}
        </div>
      )}

      <div className="preview-meta-inline" style={{ marginTop: 24 }}>
        <h3>Layered (stacked)</h3>
        <span>
          {format === "svg" ? "renderToLayeredSvg" : "renderToLayeredPng"} — hover a layer to
          isolate it
        </span>
      </div>
      <div className="preview-stage">
        <LayeredStage
          format={format}
          svgResult={layeredSvgResult}
          pngResult={layeredPngResult}
          layerDataUrls={stableLayerDataUrls}
          tilt={tilt}
          hidden={hidden}
          focusKey={focusKey}
          onFocusChange={onFocusChange}
          isRendering={currentLayeredIsRendering}
        />
      </div>
    </div>
  );
}

type LayeredCodeAreaProps = {
  codeLayout: CodeLayout;
  activeCodeTab: Exclude<ViewTab, "preview">;
  highlightedSvgSource: string;
  highlightedJsxSource: string;
  highlightedManifest: string;
  setCodeEl: (element: HTMLDivElement | null) => void;
  onSelectTab: (tab: Exclude<ViewTab, "preview">) => void;
};

function LayeredCodeArea({
  codeLayout,
  activeCodeTab,
  highlightedSvgSource,
  highlightedJsxSource,
  highlightedManifest,
  setCodeEl,
  onSelectTab,
}: LayeredCodeAreaProps) {
  return (
    <div className="code-area">
      {codeLayout === "panel" && (
        <div className="code-area-tabs">
          {(Object.keys(CODE_TAB_LABELS) as Array<keyof typeof CODE_TAB_LABELS>).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`preview-view-tab ${activeCodeTab === tab ? "active" : ""}`}
              onClick={() => onSelectTab(tab)}
            >
              {CODE_TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}
      {activeCodeTab === "manifest" && (
        <p className="code-note">
          Each <code>layers[].bbox</code> is pre-transform: ancestor transforms are re-applied at
          paint time only.
        </p>
      )}
      {activeCodeTab === "rendered" ? (
        <div
          ref={setCodeEl}
          className="code-block code-block-full"
          dangerouslySetInnerHTML={{ __html: highlightedSvgSource }}
        />
      ) : (
        <pre className="code-block code-block-full">
          <code
            dangerouslySetInnerHTML={{
              __html: activeCodeTab === "jsx" ? highlightedJsxSource : highlightedManifest,
            }}
          />
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function LayeredContent() {
  const { status, error: providerError, workerEngine } = useBoundSvg();
  const fixtures = useMemo(() => buildLayeredFixtures(), []);
  const [presetId, setPresetId] = useState(fixtures[0]?.id ?? "");
  const fixture = fixtures.find((fixtureItem) => fixtureItem.id === presetId) ?? fixtures[0];

  const [format, setFormat] = useState<Format>("svg");
  const [validate, setValidate] = useState(false);
  const [debugOverlayParts, setDebugOverlayParts] = useState<DebugOverlayPart[]>([]);
  const [tilt, setTilt] = useState(true);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("layout");
  const [showOrigin, setShowOrigin] = useState(false);

  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  const [, startTransition] = useTransition();

  const vnode = fixture?.vnode ?? null;
  const debug = useMemo(() => resolveDebugOverlayConfig(debugOverlayParts), [debugOverlayParts]);

  // Async renders (Worker). `stable*` fields are null until the currently
  // active vnode's render settles — this prevents preset/format toggles from
  // flashing the previous preset's result.
  const { singleSvgStatus, singlePngStatus, layeredSvgStatus, layeredPngStatus } =
    useLayeredRenders(vnode, { validate, debug });
  const renders = { singleSvgStatus, singlePngStatus, layeredSvgStatus, layeredPngStatus };
  const stableSingleSvg = singleSvgStatus.svg;
  const stableSingleIr = singleSvgStatus.ir;
  const stableSinglePngDataUrl = singlePngStatus.dataUrl;
  const layeredSvgResult = layeredSvgStatus.result;
  const layeredPngResult = layeredPngStatus.result;
  const stableLayerDataUrls = layeredPngStatus.layerDataUrls;

  // Bidirectional inspect-hover sync between the Single SVG preview and the
  // Rendered SVG code panel (BBOX overlay ↔ code-line highlight). Requires
  // a stable SVG + IR pair from the Worker.
  const overlayDisplay = useMemo<EventEffectOverlayDisplayOptions>(
    () => ({ mode: overlayMode, showOrigin }),
    [overlayMode, showOrigin],
  );
  const fixtureHasOrigins = useMemo(() => {
    if (!stableSingleIr) {
      return false;
    }
    return [...buildNodeBBoxMap(stableSingleIr).values()].some((bbox) => bbox.origin != null);
  }, [stableSingleIr]);
  const {
    highlightedSvg: highlightedSvgSource,
    setPreviewEl,
    setCodeEl,
  } = useSvgInspectFromData(stableSingleSvg, stableSingleIr, overlayDisplay);
  const layerKeys = useMemo(() => {
    const source = layeredSvgResult?.layers ?? [];
    return source.map((layer) => ({
      key: layerKey(layer),
      id: layer.id,
      paintOrder: layer.paintOrder,
    }));
  }, [layeredSvgResult]);

  const handleLayerFocus = useCallback((key: string | null) => {
    setFocusKey(key);
  }, []);
  const toggleLayerHidden = useCallback((key: string) => {
    setHidden((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ----- code / sources -----
  // `highlightedSvgSource` comes from `useSvgInspectFromData` above (already
  // Prism-highlighted and wrapped in per-line `<div>`s for hover sync).
  const jsxSource = useMemo(() => (vnode ? generateJsxSnippet(vnode) : ""), [vnode]);
  const manifestSource = useMemo(() => {
    const manifest =
      format === "svg" ? layeredSvgResult?.manifest : (layeredPngResult?.manifest ?? null);
    return manifest ? JSON.stringify(manifest, null, 2) : "";
  }, [format, layeredSvgResult, layeredPngResult]);

  const highlightedJsxSource = useMemo(
    () => (jsxSource ? Prism.highlight(jsxSource, getPrismGrammar("tsx"), "tsx") : ""),
    [jsxSource],
  );
  const highlightedManifest = useMemo(
    () => (manifestSource ? Prism.highlight(manifestSource, getPrismGrammar("json"), "json") : ""),
    [manifestSource],
  );

  const showCode = viewTab !== "preview";
  const activeCodeTab: Exclude<ViewTab, "preview"> =
    viewTab === "preview" ? "rendered" : (viewTab as Exclude<ViewTab, "preview">);

  const compositionValidation =
    format === "svg"
      ? layeredSvgResult?.compositionValidation
      : layeredPngResult?.compositionValidation;
  const layersForWarnings = layeredSvgResult?.layers ?? [];
  const currentLayeredIsRendering =
    format === "svg" ? layeredSvgStatus.isRendering : layeredPngStatus.isRendering;
  const currentSingleIsRendering =
    format === "svg" ? singleSvgStatus.isRendering : singlePngStatus.isRendering;

  return (
    <div className="split-layout">
      <aside className="panel controls-panel">
        <h3>Preset</h3>
        <label className="layered-control-row">
          <span className="layered-control-label">Scene</span>
          <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
            {fixtures.map((def) => (
              <option key={def.id} value={def.id}>
                {def.label}
              </option>
            ))}
          </select>
        </label>
        {fixture && <p className="layered-fixture-desc">{fixture.description}</p>}

        <h3>Toggles</h3>
        <label className="layered-toggle">
          <input
            type="checkbox"
            checked={validate}
            onChange={(event) => setValidate(event.target.checked)}
          />
          <span>Composition validation</span>
        </label>
        <BBoxOverlayField
          id="layered-debug"
          value={debugOverlayParts}
          onChange={setDebugOverlayParts}
        />
        <label className="layered-toggle">
          <input
            type="checkbox"
            checked={tilt}
            onChange={(event) => setTilt(event.target.checked)}
          />
          <span>3D stack view</span>
        </label>

        <h3>Overlay</h3>
        <label className="layered-control-row">
          <span className="layered-control-label">Mode</span>
          <select
            value={overlayMode}
            onChange={(event) => setOverlayMode(event.target.value as OverlayMode)}
          >
            {OVERLAY_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="layered-toggle">
          <input
            type="checkbox"
            checked={showOrigin}
            onChange={(event) => setShowOrigin(event.target.checked)}
          />
          <span>Show origin anchor</span>
        </label>
        {showOrigin && !fixtureHasOrigins && (
          <p className="layered-hint-text">
            This fixture has no transformed nodes - pick "Transform ancestor" to see origin anchors.
          </p>
        )}
        <p className="layered-fixture-desc">
          Slate dashed = layout / Cyan = transform / Pink corners = visual / Amber = origin
        </p>

        <h3>Layers</h3>
        <LayerList
          layers={layerKeys}
          hidden={hidden}
          focusKey={focusKey}
          isRendering={currentLayeredIsRendering}
          onFocusChange={handleLayerFocus}
          onToggleHidden={toggleLayerHidden}
        />

        <h3>Status</h3>
        <LayerStatusTable
          status={status}
          workerActive={workerEngine !== null}
          format={format}
          layeredSvgResult={layeredSvgResult}
          compositionValidation={compositionValidation}
          providerError={providerError}
          renders={renders}
        />

        <WarningsPanel layers={layersForWarnings} />
        {compositionValidation && <CompositionValidationPanel validation={compositionValidation} />}
      </aside>

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>Layered Export</h3>
            <span>
              Visualize how <code>renderToLayeredSvg</code> splits a scene by the <code>layer</code>{" "}
              prop
            </span>
          </div>
          <div className="layered-format-toggle">
            {(["svg", "png"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`layered-format-option ${format === value ? "active" : ""}`}
                onClick={() => startTransition(() => setFormat(value))}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
          {codeLayout === "tab" && (
            <div className="preview-view-tabs">
              <button
                type="button"
                className={`preview-view-tab ${viewTab === "preview" ? "active" : ""}`}
                onClick={() => startTransition(() => setViewTab("preview"))}
              >
                Preview
              </button>
              {(Object.keys(CODE_TAB_LABELS) as Array<keyof typeof CODE_TAB_LABELS>).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`preview-view-tab ${viewTab === tab ? "active" : ""}`}
                  onClick={() => startTransition(() => setViewTab(tab))}
                >
                  {CODE_TAB_LABELS[tab]}
                </button>
              ))}
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

        <LayeredPreviewBody
          format={format}
          stableSingleSvg={stableSingleSvg}
          stableSinglePngDataUrl={stableSinglePngDataUrl}
          currentSingleIsRendering={currentSingleIsRendering}
          setPreviewEl={setPreviewEl}
          layeredSvgResult={layeredSvgResult}
          layeredPngResult={layeredPngResult}
          stableLayerDataUrls={stableLayerDataUrls}
          tilt={tilt}
          hidden={hidden}
          focusKey={focusKey}
          onFocusChange={handleLayerFocus}
          currentLayeredIsRendering={currentLayeredIsRendering}
        />

        <LayeredCodeArea
          codeLayout={codeLayout}
          activeCodeTab={activeCodeTab}
          highlightedSvgSource={highlightedSvgSource}
          highlightedJsxSource={highlightedJsxSource}
          highlightedManifest={highlightedManifest}
          setCodeEl={setCodeEl}
          onSelectTab={(tab) => startTransition(() => setViewTab(tab))}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function LayeredStage({
  format,
  svgResult,
  pngResult,
  layerDataUrls,
  tilt,
  hidden,
  focusKey,
  onFocusChange,
  isRendering,
}: {
  format: Format;
  svgResult: ReturnType<typeof useRenderToLayeredSvgAsync>["result"];
  pngResult: ReturnType<typeof useRenderToLayeredPngAsync>["result"];
  layerDataUrls: string[] | null;
  tilt: boolean;
  hidden: Record<string, boolean>;
  focusKey: string | null;
  onFocusChange: (key: string | null) => void;
  isRendering: boolean;
}) {
  if (format === "svg") {
    if (!svgResult) {
      return (
        <p className="placeholder-text">
          {isRendering ? "Rendering in Worker…" : "Waiting for Worker…"}
        </p>
      );
    }
    return (
      <Layered3DStage
        width={svgResult.width}
        height={svgResult.height}
        layers={svgResult.layers}
        tilt={tilt}
        hidden={hidden}
        focusKey={focusKey}
        onFocusChange={onFocusChange}
        renderLayer={(layer) => (
          <div className="layered-3d-canvas" dangerouslySetInnerHTML={{ __html: layer.svg }} />
        )}
      />
    );
  }

  if (!pngResult || !layerDataUrls) {
    return (
      <p className="placeholder-text">
        {isRendering ? "Rendering in Worker…" : "Waiting for Worker…"}
      </p>
    );
  }

  const displayWidth = pngResult.width;
  const displayHeight = pngResult.height;
  return (
    <Layered3DStage
      width={displayWidth}
      height={displayHeight}
      layers={pngResult.layers}
      tilt={tilt}
      hidden={hidden}
      focusKey={focusKey}
      onFocusChange={onFocusChange}
      renderLayer={(_layer, index) => (
        <img
          className="layered-3d-canvas layered-3d-canvas-img"
          src={layerDataUrls[index] ?? ""}
          alt=""
          draggable={false}
        />
      )}
    />
  );
}

function Layered3DStage<T extends { id: string; paintOrder: number }>({
  width,
  height,
  layers,
  tilt,
  hidden,
  focusKey,
  onFocusChange,
  renderLayer,
}: {
  width: number;
  height: number;
  layers: readonly T[];
  tilt: boolean;
  hidden: Record<string, boolean>;
  focusKey: string | null;
  onFocusChange: (key: string | null) => void;
  renderLayer: (layer: T, index: number) => React.ReactNode;
}) {
  const sorted = useMemo(() => [...layers].sort((a, b) => a.paintOrder - b.paintOrder), [layers]);
  const hasFocus = focusKey != null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: onMouseLeave only resets hover state; keyboard users interact via sidebar rows
    <div
      className={`layered-3d-viewport ${tilt ? "is-tilted" : ""}`}
      onMouseLeave={() => onFocusChange(null)}
    >
      <div
        className="layered-3d-stage"
        style={{
          width,
          height,
        }}
      >
        {sorted.map((layer, index) => {
          const key = layerKey(layer);
          const isHidden = !!hidden[key];
          const isFocused = focusKey === key;
          const zOffset = tilt ? index * LAYER_GAP_PX : 0;
          const opacity = isHidden ? 0 : hasFocus ? (isFocused ? 1 : 0.22) : 1;
          return (
            // biome-ignore lint/a11y/useSemanticElements: layer panel is decorative; keyboard focus lives in the sidebar layer list
            <div
              key={key}
              className={`layered-3d-layer ${isFocused ? "is-focused" : ""} ${isHidden ? "is-hidden" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`Layer ${layer.id}`}
              aria-pressed={isFocused}
              onMouseEnter={() => onFocusChange(key)}
              onFocus={() => onFocusChange(key)}
              onBlur={() => onFocusChange(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onFocusChange(isFocused ? null : key);
                }
              }}
              style={{
                width,
                height,
                transform: `translateZ(${zOffset}px)`,
                opacity,
              }}
            >
              {renderLayer(layer, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="status-row">
      <span className="status-label">{label}</span>
      <code className={`status-value ${valueClassName ?? ""}`}>{value}</code>
    </div>
  );
}

function WarningsPanel({ layers }: { layers: LayerEntry[] | LayerPngEntry[] }) {
  const allWarnings = layers.flatMap((layer) =>
    layer.warnings.map((warning) => ({ layerId: layer.id, warning })),
  );
  if (allWarnings.length === 0) {
    return (
      <>
        <h3>Warnings</h3>
        <p className="layered-hint-text">No warnings.</p>
      </>
    );
  }
  return (
    <>
      <h3>Warnings ({allWarnings.length})</h3>
      <ul className="layered-warnings">
        {allWarnings.map(({ layerId, warning }, index) => (
          <li key={`${layerId}-${index}`}>
            <code>{warning.code}</code>
            <span className="layered-warning-detail">{describeWarning(warning)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function CompositionValidationPanel({
  validation,
}: {
  validation: LayeredCompositionValidationResult;
}) {
  return (
    <>
      <h3>Composition Validation</h3>
      <div className="status-table">
        <StatusRow label="Status" value={validation.status} />
        <StatusRow label="Different pixels" value={String(validation.differentPixels)} />
        <StatusRow label="Ratio" value={validation.differenceRatio.toFixed(6)} />
        <StatusRow label="Canvas" value={`${validation.width} × ${validation.height}`} />
      </div>
    </>
  );
}

function describeWarning(warning: LayerWarning): string {
  switch (warning.code) {
    case "CROSSES_COMPOSITING_ISLAND":
      return `node ${warning.nodeId} → island ${warning.islandRootNodeId}`;
    case "PARENT_OPACITY_PREVENTED_SPLIT":
      return `node ${warning.nodeId} under parent ${warning.parentNodeId}`;
    case "CLIP_FORCED_ATOMIC":
      return `node ${warning.nodeId} clip`;
    case "BOX_SHADOW_FORCED_ATOMIC":
      return `node ${warning.nodeId} box shadow`;
    case "SVG_SUBTREE_FORCED_ATOMIC":
      return `node ${warning.nodeId} Svg subtree`;
    default: {
      const exhaustive: never = warning;
      return JSON.stringify(exhaustive);
    }
  }
}

// ---------------------------------------------------------------------------
// Page — wraps content in a Worker-enabled provider
// ---------------------------------------------------------------------------

export function LayeredPage() {
  return (
    <BoundSvgProvider
      config={workerConfig}
      fallback={
        <div className="preview-stage">
          <p className="placeholder-text">Loading Worker &amp; WASM…</p>
        </div>
      }
    >
      <LayeredContent />
    </BoundSvgProvider>
  );
}
