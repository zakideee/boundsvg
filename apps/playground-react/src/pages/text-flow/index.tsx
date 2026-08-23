import type { DebugOverlayPart, VNode } from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import { useCallback, useMemo, useState, useTransition } from "react";
import { getPrismGrammar } from "../../../../playground-shared/prism.js";
import { BBoxOverlayField, Section } from "../../components/fields";
import { useMobileViewer, useResetPreviewForMobile } from "../../hooks/use-mobile-viewer";
import { useSvgInspect } from "../../hooks/use-svg-inspect";
import { generateFullComponent, generateJsxSnippet } from "../../lib/codegen";
import { FlowCanvas } from "./FlowCanvas";
import {
  applyFlowDrag,
  applyFlowRichDrag,
  hitTestFlowObstacles,
  hitTestFlowRichObstacles,
  INITIAL_FLOW_OBSTACLES,
  INITIAL_FLOW_RICH_OBSTACLES,
} from "./obstacle-types";
import { buildFlowRichVNode, buildTextFlowVNode } from "./vnode-builders";

type FlowPreset = "text-flow" | "flow-rich";
type ViewTab = "preview" | "svg" | "jsx" | "component";
type CodeLayout = "tab" | "panel";

const PRESETS: { key: FlowPreset; label: string; description: string }[] = [
  {
    key: "text-flow",
    label: "Text Flow",
    description:
      "Horizontal text uses the top row; vertical-rl text uses the bottom row. Drag obstacles to reflow.",
  },
  {
    key: "flow-rich",
    label: "Flow Rich, Vertical & Ruby",
    description:
      "Rich text and ruby share the top row; vertical-rl columns use the full bottom row. Drag obstacles to reflow.",
  },
];

function FlowPresetControl({
  mobileViewer,
  preset,
  onChange,
}: {
  mobileViewer: boolean;
  preset: FlowPreset;
  onChange: (preset: FlowPreset) => void;
}) {
  if (mobileViewer) {
    return (
      <label className="mobile-sample-select">
        <span>Sample</span>
        <select value={preset} onChange={(event) => onChange(event.target.value as FlowPreset)}>
          {PRESETS.map((presetOption) => (
            <option key={presetOption.key} value={presetOption.key}>
              {presetOption.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="stack-list">
      {PRESETS.map((presetOption) => (
        <button
          key={presetOption.key}
          type="button"
          className={`template-button ${preset === presetOption.key ? "active" : ""}`}
          data-playground-locator-level="sample"
          data-playground-locator-segment={`Sample: ${presetOption.label} [${presetOption.key}]`}
          onClick={() => onChange(presetOption.key)}
        >
          <strong>{presetOption.label}</strong>
          <span>{presetOption.description}</span>
        </button>
      ))}
    </div>
  );
}

export function TextFlowPage() {
  const { engine, status } = useBoundSvg();
  const mobileViewer = useMobileViewer();
  const [preset, setPreset] = useState<FlowPreset>("text-flow");
  const [debugOverlayParts, setDebugOverlayParts] = useState<DebugOverlayPart[]>([]);
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  useResetPreviewForMobile(mobileViewer, setViewTab, setCodeLayout);
  const [currentVNode, setCurrentVNode] = useState<VNode | null>(null);
  const [, startTransition] = useTransition();

  const activePreset = PRESETS.find((presetOption) => presetOption.key === preset) ?? PRESETS[0];

  const handleVNodeChange = useCallback((vnode: VNode | null) => {
    setCurrentVNode(vnode);
  }, []);

  const showCode = viewTab !== "preview" && viewTab !== "svg";
  const activeCodeTab: "svg" | "jsx" | "component" =
    viewTab === "svg" || viewTab === "jsx" || viewTab === "component" ? viewTab : "jsx";

  const inspectRenderOptions = useMemo(
    () => ({ debug: false, textPathMode: "merged" }) as const,
    [],
  );
  const {
    highlightedSvg: highlightedRenderedSvg,
    setPreviewEl,
    setCodeEl,
  } = useSvgInspect(engine, status, currentVNode, inspectRenderOptions);

  const jsxSnippetCode = useMemo(
    () => (currentVNode ? generateJsxSnippet(currentVNode) : ""),
    [currentVNode],
  );
  const fullComponentCode = useMemo(
    () => (currentVNode ? generateFullComponent(currentVNode, "svg-hook") : ""),
    [currentVNode],
  );
  const highlightedJsxSnippet = useMemo(
    () => (jsxSnippetCode ? Prism.highlight(jsxSnippetCode, getPrismGrammar("tsx"), "tsx") : ""),
    [jsxSnippetCode],
  );
  const highlightedFullComponent = useMemo(
    () =>
      fullComponentCode ? Prism.highlight(fullComponentCode, getPrismGrammar("tsx"), "tsx") : "",
    [fullComponentCode],
  );

  return (
    <div className="split-layout">
      <aside className="panel controls-panel">
        <Section title="Preset" defaultOpen>
          <FlowPresetControl mobileViewer={mobileViewer} preset={preset} onChange={setPreset} />
        </Section>

        <Section title="Render" defaultOpen className="mobile-viewer-secondary">
          <BBoxOverlayField
            id="flow-debug"
            value={debugOverlayParts}
            onChange={setDebugOverlayParts}
          />
        </Section>
      </aside>

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>{activePreset?.label}</h3>
            <span>{activePreset?.description}</span>
          </div>
          {codeLayout === "tab" && (
            <div className="preview-view-tabs">
              {(["preview", "svg", "jsx", "component"] as const).map((tab) => {
                const labels: Record<ViewTab, string> = {
                  preview: "Preview",
                  svg: "Rendered SVG",
                  jsx: "Generated JSX",
                  component: "React Component",
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

        <div ref={setPreviewEl} className="preview-body">
          {viewTab === "svg" && codeLayout === "tab" ? (
            <div
              ref={codeLayout === "tab" ? setCodeEl : undefined}
              className="code-block"
              dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
            />
          ) : (
            <>
              {preset === "text-flow" && (
                <FlowCanvas
                  initialObstacles={INITIAL_FLOW_OBSTACLES}
                  hitTest={hitTestFlowObstacles}
                  applyDrag={applyFlowDrag}
                  buildVNode={buildTextFlowVNode}
                  debugOverlayParts={debugOverlayParts}
                  onVNodeChange={handleVNodeChange}
                />
              )}
              {preset === "flow-rich" && (
                <FlowCanvas
                  initialObstacles={INITIAL_FLOW_RICH_OBSTACLES}
                  hitTest={hitTestFlowRichObstacles}
                  applyDrag={applyFlowRichDrag}
                  buildVNode={buildFlowRichVNode}
                  debugOverlayParts={debugOverlayParts}
                  onVNodeChange={handleVNodeChange}
                />
              )}
            </>
          )}
        </div>

        <div className="code-area">
          {codeLayout === "panel" && (
            <div className="code-area-tabs">
              {(["svg", "jsx", "component"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`preview-view-tab ${activeCodeTab === tab ? "active" : ""}`}
                  onClick={() => startTransition(() => setViewTab(tab))}
                >
                  {tab === "svg"
                    ? "Rendered SVG"
                    : tab === "jsx"
                      ? "Generated JSX"
                      : "React Component"}
                </button>
              ))}
            </div>
          )}
          {activeCodeTab === "svg" ? (
            <div
              ref={codeLayout === "panel" ? setCodeEl : undefined}
              className="code-block code-block-full"
              dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
            />
          ) : (
            <pre className="code-block code-block-full">
              <code
                dangerouslySetInnerHTML={{
                  __html:
                    activeCodeTab === "jsx" ? highlightedJsxSnippet : highlightedFullComponent,
                }}
              />
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
