import { Canvas, Flex, Text, toVNode, type VNode } from "@boundsvg/react";
import { type BoundSvgConfig, BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import { useRenderToPngAsync, useRenderToSvgAndIrAsync } from "@boundsvg/react/worker";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import { useMemo, useState, useTransition } from "react";
import { getPrismGrammar } from "../../../playground-shared/prism.js";
import { useSvgInspectFromData } from "../hooks/use-svg-inspect";
import { asset } from "../lib/asset";
import { generateFullComponent, generateJsxSnippet } from "../lib/codegen";

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
// Demo VNode
// ---------------------------------------------------------------------------

function buildDemoVNode(): VNode {
  return toVNode(
    <Canvas width={640} height={240} background="#1e1e1e">
      <Flex
        direction="column"
        justifyContent="center"
        alignItems="center"
        width={640}
        height={240}
        gap={12}
      >
        <Text font="NotoSansJP-woff2" fontSizePx={32} color="#f8fafc" wrap="none">
          Worker Rendering
        </Text>
        <Text font="NotoSansJP-woff2" fontSizePx={18} color="#94a3b8" wrap="char">
          Off-main-thread WASM via useRenderToSvgAsync / useRenderToPngAsync
        </Text>
      </Flex>
    </Canvas>,
  );
}

// ---------------------------------------------------------------------------
// Content — renders inside Worker-enabled BoundSvgProvider
// ---------------------------------------------------------------------------

type ViewTab = "preview" | "svg" | "jsx" | "component";
type CodeLayout = "tab" | "panel";

type SvgAndIrAsyncResult = ReturnType<typeof useRenderToSvgAndIrAsync>;
type PngAsyncResult = ReturnType<typeof useRenderToPngAsync>;

type WorkerStatusPanelProps = {
  status: string;
  providerError: Error | null;
  workerEngineActive: boolean;
  svgAndIrResult: SvgAndIrAsyncResult;
  pngResult: PngAsyncResult;
};

function WorkerStatusPanel({
  status,
  providerError,
  workerEngineActive,
  svgAndIrResult,
  pngResult,
}: WorkerStatusPanelProps) {
  return (
    <aside className="panel controls-panel">
      <h3>Provider Status</h3>
      <div className="status-table">
        <div className="status-row">
          <span className="status-label">Status</span>
          <code className="status-value">{status}</code>
        </div>
        <div className="status-row">
          <span className="status-label">Worker Engine</span>
          <code className="status-value">{workerEngineActive ? "active" : "none"}</code>
        </div>
        {providerError && (
          <div className="status-row">
            <span className="status-label">Error</span>
            <code className="status-value error-text">{providerError.message}</code>
          </div>
        )}
      </div>

      <h3>SVG + IR (async)</h3>
      <div className="status-table">
        <div className="status-row">
          <span className="status-label">isReady</span>
          <code className="status-value">{String(svgAndIrResult.isReady)}</code>
        </div>
        <div className="status-row">
          <span className="status-label">isRendering</span>
          <code className="status-value">{String(svgAndIrResult.isRendering)}</code>
        </div>
        <div className="status-row">
          <span className="status-label">IR</span>
          <code className="status-value">{svgAndIrResult.ir ? "available" : "none"}</code>
        </div>
        {svgAndIrResult.error && (
          <div className="status-row">
            <span className="status-label">Error</span>
            <code className="status-value error-text">{svgAndIrResult.error.message}</code>
          </div>
        )}
      </div>

      <h3>PNG (async)</h3>
      <div className="status-table">
        <div className="status-row">
          <span className="status-label">isReady</span>
          <code className="status-value">{String(pngResult.isReady)}</code>
        </div>
        <div className="status-row">
          <span className="status-label">isRendering</span>
          <code className="status-value">{String(pngResult.isRendering)}</code>
        </div>
        <div className="status-row">
          <span className="status-label">Byte length</span>
          <code className="status-value">{pngResult.png?.byteLength ?? 0}</code>
        </div>
        {pngResult.error && (
          <div className="status-row">
            <span className="status-label">Error</span>
            <code className="status-value error-text">{pngResult.error.message}</code>
          </div>
        )}
      </div>
    </aside>
  );
}

type WorkerOutputPreviewProps = {
  viewTab: ViewTab;
  codeLayout: CodeLayout;
  highlightedRenderedSvg: string;
  svgAndIrResult: SvgAndIrAsyncResult;
  pngResult: PngAsyncResult;
  setPreviewEl: (element: HTMLDivElement | null) => void;
  setCodeEl: (element: HTMLDivElement | null) => void;
};

function WorkerOutputPreview({
  viewTab,
  codeLayout,
  highlightedRenderedSvg,
  svgAndIrResult,
  pngResult,
  setPreviewEl,
  setCodeEl,
}: WorkerOutputPreviewProps) {
  if (viewTab === "svg" && codeLayout === "tab") {
    return (
      <div className="preview-body">
        <div
          ref={setCodeEl}
          className="code-block"
          dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
        />
      </div>
    );
  }
  return (
    <div className="preview-body">
      <div className="preview-meta-inline">
        <h3>SVG Output</h3>
        <span>Rendered via Worker + useRenderToSvgAsync</span>
      </div>
      {svgAndIrResult.svg ? (
        <div ref={setPreviewEl} className="preview-stage">
          <div
            className="rendered-content"
            dangerouslySetInnerHTML={{ __html: svgAndIrResult.svg }}
          />
        </div>
      ) : (
        <div className="preview-stage">
          <p className="placeholder-text">
            {svgAndIrResult.isRendering ? "Rendering in Worker…" : "Waiting for Worker…"}
          </p>
        </div>
      )}

      <div className="preview-meta-inline" style={{ marginTop: 24 }}>
        <h3>PNG Output</h3>
        <span>Rendered via Worker + useRenderToPngAsync</span>
      </div>
      {pngResult.dataUrl ? (
        <div className="preview-stage">
          <img className="preview-image" src={pngResult.dataUrl} alt="Worker PNG output" />
        </div>
      ) : (
        <div className="preview-stage">
          <p className="placeholder-text">
            {pngResult.isRendering ? "Rendering in Worker…" : "Waiting for Worker…"}
          </p>
        </div>
      )}
    </div>
  );
}

function WorkerAsyncContent() {
  const { status, error: providerError, workerEngine } = useBoundSvg();
  const vnode = useMemo(() => buildDemoVNode(), []);
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  const [, startTransition] = useTransition();

  const svgAndIrResult = useRenderToSvgAndIrAsync(vnode);
  const pngResult = useRenderToPngAsync(vnode);

  // Inspect hover via Worker-produced SVG + IR
  const {
    highlightedSvg: highlightedRenderedSvg,
    setPreviewEl,
    setCodeEl,
  } = useSvgInspectFromData(svgAndIrResult.svg, svgAndIrResult.ir);

  const showCode = viewTab !== "preview" && viewTab !== "svg";
  const activeCodeTab: "svg" | "jsx" | "component" =
    viewTab === "svg" || viewTab === "jsx" || viewTab === "component" ? viewTab : "jsx";

  const jsxSnippetCode = useMemo(() => generateJsxSnippet(vnode), [vnode]);
  const fullComponentCode = useMemo(() => generateFullComponent(vnode, "svg-async"), [vnode]);
  const highlightedJsxSnippet = useMemo(
    () => Prism.highlight(jsxSnippetCode, getPrismGrammar("tsx"), "tsx"),
    [jsxSnippetCode],
  );
  const highlightedFullComponent = useMemo(
    () => Prism.highlight(fullComponentCode, getPrismGrammar("tsx"), "tsx"),
    [fullComponentCode],
  );

  return (
    <div className="split-layout">
      <WorkerStatusPanel
        status={status}
        providerError={providerError}
        workerEngineActive={workerEngine !== null}
        svgAndIrResult={svgAndIrResult}
        pngResult={pngResult}
      />

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>Worker Rendering</h3>
            <span>Off-main-thread WASM via useRenderToSvgAsync / useRenderToPngAsync</span>
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

        <WorkerOutputPreview
          viewTab={viewTab}
          codeLayout={codeLayout}
          highlightedRenderedSvg={highlightedRenderedSvg}
          svgAndIrResult={svgAndIrResult}
          pngResult={pngResult}
          setPreviewEl={setPreviewEl}
          setCodeEl={setCodeEl}
        />

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

// ---------------------------------------------------------------------------
// Page — wraps content in a Worker-enabled provider
// ---------------------------------------------------------------------------

export function WorkerAsyncPage() {
  return (
    <BoundSvgProvider
      config={workerConfig}
      fallback={
        <div className="preview-stage">
          <p className="placeholder-text">Loading Worker & WASM…</p>
        </div>
      }
    >
      <WorkerAsyncContent />
    </BoundSvgProvider>
  );
}
