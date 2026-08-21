import {
  Canvas,
  type DebugOverlayPart,
  Flex,
  Path,
  type RenderOptions,
  Text,
  toVNode,
  type VNode,
} from "@boundsvg/react";
import {
  type EventCallback,
  InteractiveBoundSvg,
  toInteractiveVNode,
  useInteractiveSvg,
  useTextCopy,
} from "@boundsvg/react/interactive";
import { type BoundSvgConfig, BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import { useRenderToPngAsync, useRenderToSvgAsync } from "@boundsvg/react/worker";
import Prism from "prismjs";
import { useCallback, useDeferredValue, useMemo, useState, useTransition } from "react";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import { getPrismGrammar } from "../../../playground-shared/prism.js";
import { BBoxOverlayField, SelectField } from "../components/fields";
import { RenderSurface } from "../components/RenderSurface";
import { useSvgInspect } from "../hooks/use-svg-inspect";
import { asset } from "../lib/asset";
import { generateJsxSnippet } from "../lib/codegen";
import { resolveDebugOverlayConfig } from "../lib/debug-overlay";
import type { RendererMode } from "../types";

// ---------------------------------------------------------------------------
// API view — extends RendererMode with interactive / text-copy demos
// ---------------------------------------------------------------------------

type ApiView = RendererMode | "interactive-hook" | "interactive-component" | "text-copy";

function isRendererMode(view: ApiView): view is RendererMode {
  return (
    view === "boundsvg" ||
    view === "svg-hook" ||
    view === "png-hook" ||
    view === "svg-async" ||
    view === "png-async"
  );
}

// ---------------------------------------------------------------------------
// Code snippets
// ---------------------------------------------------------------------------

const API_CODE_SNIPPETS: Record<ApiView, string> = {
  boundsvg: `import { BoundSvg } from "@boundsvg/react";

<BoundSvg vnode={vnode} renderOptions={{ debug: false }} />`,
  "svg-hook": `import { useRenderToSvg } from "@boundsvg/react";

const { svg, error, isReady } = useRenderToSvg(vnode, { debug: false });`,
  "png-hook": `import { useRenderToPng } from "@boundsvg/react/png";

const { dataUrl, error, isReady } = useRenderToPng(vnode, { scale: 2, textPathMode: "merged" });`,
  "svg-async": `import { useRenderToSvgAsync } from "@boundsvg/react/worker";

// Requires BoundSvgProvider with worker: { mode: "prefer" | "required" }
const { svg, error, isRendering, isReady } = useRenderToSvgAsync(vnode, { debug: false });`,
  "png-async": `import { useRenderToPngAsync } from "@boundsvg/react/worker";

// Requires BoundSvgProvider with worker: { mode: "prefer" | "required" }
const { dataUrl, png, error, isRendering, isReady } = useRenderToPngAsync(vnode, { scale: 2 });`,
  "interactive-hook": `import { useInteractiveSvg, type EventCallback } from "@boundsvg/react/interactive";

const handlers = new Map<string, EventCallback>([
  ["handleClick", (info) => console.log("clicked", info.nodeId)],
  ["handleHover", (info) => console.log("hover", info.nodeId)],
]);

const { svg, hoverNodeId, containerRef, isReady } = useInteractiveSvg(
  vnode,
  handlers,
  { showPointerCursor: true },
);

return (
  <div ref={containerRef} dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
);`,
  "interactive-component": `import { Canvas, Flex, Text } from "@boundsvg/react";
import { InteractiveBoundSvg } from "@boundsvg/react/interactive";

<InteractiveBoundSvg
  width={920}
  height={320}
  background="#252526"
  renderOptions={{ debug: false }}
  onHoverChange={(nodeId) => console.log("hover", nodeId)}
>
  <Flex direction="column" padding={32} gap={14}>
    <Text id="title" font="NotoSansJP-woff2" fontSizePx={44} color="#f9fafb"
          onClick="handleClick">
      Click or hover me
    </Text>
  </Flex>
</InteractiveBoundSvg>`,
  "text-copy": `import { useInteractiveSvg, useTextCopy } from "@boundsvg/react/interactive";

const { ir, textMap, svg, containerRef } = useInteractiveSvg(
  vnode,
  handlers,
  { enableTextCopy: true, onTextContextMenu: handleMenu },
);

const {
  copyNodeText,   // Copy text of a single node
  copyAllText,    // Copy all text in the canvas
  copyStatus,     // "idle" | "copied" | "failed"
} = useTextCopy(ir, textMap);

// Right-click on text → custom context menu
function handleMenu(hit) {
  copyNodeText(hit.nodeId);
}`,
};

// ---------------------------------------------------------------------------
// Shared demo VNode for standard render hooks
// ---------------------------------------------------------------------------

function buildApiShowcaseVNode(): VNode {
  return toVNode(
    <Canvas width={920} height={320} background="#252526">
      <Flex
        direction="column"
        justifyContent="center"
        alignItems="start"
        width={920}
        height={320}
        padding={32}
        gap={14}
      >
        <Text font="NotoSansJP-woff2" fontSizePx={44} color="#f9fafb" wrap="char">
          API Examples
        </Text>
        <Text font="NotoSansJP-woff2" fontSizePx={24} color="#cbd5e1" wrap="char">
          BoundSvg component / useRenderToSvg / useRenderToPng
        </Text>
        <Path d="M 0 20 H 420" width={420} height={20} stroke="#38bdf8" strokeWidth={3} />
      </Flex>
    </Canvas>,
  );
}

// ---------------------------------------------------------------------------
// Interactive VNode for useInteractiveSvg / InteractiveBoundSvg / useTextCopy
// ---------------------------------------------------------------------------

function buildInteractiveVNode(): { vnode: VNode; handlers: Map<string, EventCallback> } {
  const { vnode, handlers } = toInteractiveVNode(
    <Canvas width={920} height={320} background="#252526">
      <Flex
        direction="column"
        justifyContent="center"
        alignItems="start"
        width={920}
        height={320}
        padding={32}
        gap={14}
      >
        <Text
          id="title"
          font="NotoSansJP-woff2"
          fontSizePx={44}
          color="#f9fafb"
          width={856}
          wrap="none"
          onClick="handleTitleClick"
        >
          Interactive SVG — click or hover
        </Text>
        <Text
          id="subtitle"
          font="NotoSansJP-woff2"
          fontSizePx={24}
          color="#cbd5e1"
          wrap="char"
          onClick="handleSubtitleClick"
        >
          useInteractiveSvg / InteractiveBoundSvg / useTextCopy
        </Text>
        <Path d="M 0 20 H 420" width={420} height={20} stroke="#38bdf8" strokeWidth={3} />
      </Flex>
    </Canvas>,
  );
  return { vnode, handlers };
}

// ---------------------------------------------------------------------------
// Worker-based async surfaces
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

function AsyncRenderSurface({
  renderer,
  vnode,
  renderOptions,
}: {
  renderer: "svg-async" | "png-async";
  vnode: VNode | null;
  renderOptions?: RenderOptions;
}) {
  return (
    <BoundSvgProvider
      config={workerConfig}
      fallback={
        <div className="preview-stage">
          <p className="placeholder-text">Loading Worker and WASM...</p>
        </div>
      }
    >
      {renderer === "svg-async" ? (
        <SvgAsyncSurface vnode={vnode} renderOptions={renderOptions} />
      ) : (
        <PngAsyncSurface vnode={vnode} renderOptions={renderOptions} />
      )}
    </BoundSvgProvider>
  );
}

function SvgAsyncSurface({
  vnode,
  renderOptions,
}: {
  vnode: VNode | null;
  renderOptions?: RenderOptions;
}) {
  const { workerEngine, status, error: providerError } = useBoundSvg();
  const { svg, error, isRendering, isReady } = useRenderToSvgAsync(vnode, renderOptions);
  if (error) {
    return (
      <div className="preview-stage">
        <p className="error-text">Render failed: {error.message}</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="preview-stage">
        <p className="error-text">
          Initialization failed: {providerError?.message ?? "unknown error"}
        </p>
      </div>
    );
  }
  if (status === "ready" && !workerEngine && !isReady) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">
          Worker unavailable — fell back to main-thread engine.
          <br />
          Use sync hooks (useRenderToSvg) for main-thread rendering.
        </p>
      </div>
    );
  }
  if (!isReady || !svg) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">
          {isRendering ? "Rendering in Worker..." : "Waiting for Worker..."}
        </p>
      </div>
    );
  }
  return (
    <div className="preview-stage">
      <div className="rendered-content" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function PngAsyncSurface({
  vnode,
  renderOptions,
}: {
  vnode: VNode | null;
  renderOptions?: RenderOptions;
}) {
  const { workerEngine, status, error: providerError } = useBoundSvg();
  const { dataUrl, error, isRendering, isReady } = useRenderToPngAsync(vnode, renderOptions);
  if (error) {
    return (
      <div className="preview-stage">
        <p className="error-text">Render failed: {error.message}</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="preview-stage">
        <p className="error-text">
          Initialization failed: {providerError?.message ?? "unknown error"}
        </p>
      </div>
    );
  }
  if (status === "ready" && !workerEngine && !isReady) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">
          Worker unavailable — fell back to main-thread engine.
          <br />
          Use sync hooks (useRenderToPng) for main-thread rendering.
        </p>
      </div>
    );
  }
  if (!isReady || !dataUrl) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">
          {isRendering ? "Rendering in Worker..." : "Waiting for Worker..."}
        </p>
      </div>
    );
  }
  return (
    <div className="preview-stage">
      <img className="preview-image" src={dataUrl} alt="Worker PNG output" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interactive hook surface
// ---------------------------------------------------------------------------

function InteractiveHookSurface({
  vnode,
  handlers,
  renderOptions,
}: {
  vnode: VNode;
  handlers: Map<string, EventCallback>;
  renderOptions?: RenderOptions;
}) {
  const { svg, hoverNodeId, containerRef, error, isReady } = useInteractiveSvg(vnode, handlers, {
    renderOptions,
    showPointerCursor: true,
  });

  if (error) {
    return (
      <div className="preview-stage">
        <p className="error-text">Render failed: {error.message}</p>
      </div>
    );
  }
  if (!isReady || !svg) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">Rendering…</p>
      </div>
    );
  }
  return (
    <div className="preview-stage">
      <div
        ref={containerRef}
        className="rendered-content"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {hoverNodeId && (
        <p className="api-status-label">
          hoverNodeId: <code>{hoverNodeId}</code>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InteractiveBoundSvg component surface
// ---------------------------------------------------------------------------

function InteractiveComponentSurface({ renderOptions }: { renderOptions?: RenderOptions }) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="preview-stage">
      <InteractiveBoundSvg
        width={920}
        height={320}
        background="#252526"
        className="rendered-content"
        renderOptions={renderOptions}
        showPointerCursor
        onHoverChange={setHovered}
        fallback={<p className="placeholder-text">Rendering…</p>}
        errorFallback={(error: Error) => (
          <p className="error-text">Render failed: {error.message}</p>
        )}
      >
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="start"
          width={920}
          height={320}
          padding={32}
          gap={14}
        >
          <Text
            id="title"
            font="NotoSansJP-woff2"
            fontSizePx={44}
            color="#f9fafb"
            width={856}
            wrap="none"
            onClick="handleClick"
          >
            Interactive SVG — click or hover
          </Text>
          <Text
            id="subtitle"
            font="NotoSansJP-woff2"
            fontSizePx={24}
            color="#cbd5e1"
            wrap="char"
            onClick="handleClick"
          >
            InteractiveBoundSvg component demo
          </Text>
          <Path d="M 0 20 H 420" width={420} height={20} stroke="#38bdf8" strokeWidth={3} />
        </Flex>
      </InteractiveBoundSvg>
      {hovered && (
        <p className="api-status-label">
          hoverNodeId: <code>{hovered}</code>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text copy surface
// ---------------------------------------------------------------------------

function TextCopySurface({
  vnode,
  handlers,
  renderOptions,
}: {
  vnode: VNode;
  handlers: Map<string, EventCallback>;
  renderOptions?: RenderOptions;
}) {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const onTextContextMenu = useCallback((hit: { nodeId: string }) => {
    setCopiedText(hit.nodeId);
  }, []);

  const { svg, ir, textMap, containerRef, error, isReady } = useInteractiveSvg(vnode, handlers, {
    renderOptions,
    enableTextCopy: true,
    onTextContextMenu,
  });

  const { copyNodeText, copyAllText, copyStatus } = useTextCopy(ir, textMap);

  const handleCopyAll = useCallback(() => {
    copyAllText();
  }, [copyAllText]);

  const handleCopyNode = useCallback(() => {
    if (copiedText) {
      copyNodeText(copiedText);
    }
  }, [copiedText, copyNodeText]);

  if (error) {
    return (
      <div className="preview-stage">
        <p className="error-text">Render failed: {error.message}</p>
      </div>
    );
  }
  if (!isReady || !svg) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">Rendering…</p>
      </div>
    );
  }
  return (
    <div className="preview-stage">
      <div
        ref={containerRef}
        className="rendered-content"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="api-status-bar">
        <button type="button" className="api-copy-button" onClick={handleCopyAll}>
          Copy All Text
        </button>
        {copiedText && (
          <button type="button" className="api-copy-button" onClick={handleCopyNode}>
            Copy "{copiedText}"
          </button>
        )}
        <span className="api-copy-status">
          {copyStatus === "copied" ? "Copied!" : copyStatus === "failed" ? "Copy failed" : ""}
        </span>
        {copiedText && (
          <span className="api-status-label">
            Right-clicked: <code>{copiedText}</code>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ApiViewTab = "preview" | "svg" | "jsx" | "api-usage";
type CodeLayout = "tab" | "panel";

const API_VIEW_TAB_LABELS: Record<ApiViewTab, string> = {
  preview: "Preview",
  svg: "Rendered SVG",
  jsx: "Generated JSX",
  "api-usage": "API Usage",
};

type ApiPreviewSurfaceProps = {
  apiView: ApiView;
  viewTab: ApiViewTab;
  codeLayout: CodeLayout;
  highlightedRenderedSvg: string;
  deferredVNode: VNode;
  deferredRenderOptions: RenderOptions;
  interactiveData: ReturnType<typeof buildInteractiveVNode>;
  isPending: boolean;
  setPreviewEl: (element: HTMLDivElement | null) => void;
  setCodeEl: (element: HTMLDivElement | null) => void;
};

function ApiPreviewSurface({
  apiView,
  viewTab,
  codeLayout,
  highlightedRenderedSvg,
  deferredVNode,
  deferredRenderOptions,
  interactiveData,
  isPending,
  setPreviewEl,
  setCodeEl,
}: ApiPreviewSurfaceProps) {
  let content: React.ReactNode;
  if (viewTab === "svg" && codeLayout === "tab") {
    content = (
      <div
        ref={setCodeEl}
        className="code-block"
        dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
      />
    );
  } else {
    switch (apiView) {
      case "svg-async":
      case "png-async":
        content = (
          <AsyncRenderSurface
            renderer={apiView}
            vnode={deferredVNode}
            renderOptions={deferredRenderOptions}
          />
        );
        break;
      case "interactive-hook":
        content = (
          <InteractiveHookSurface
            vnode={interactiveData.vnode}
            handlers={interactiveData.handlers}
            renderOptions={deferredRenderOptions}
          />
        );
        break;
      case "interactive-component":
        content = <InteractiveComponentSurface renderOptions={deferredRenderOptions} />;
        break;
      case "text-copy":
        content = (
          <TextCopySurface
            vnode={interactiveData.vnode}
            handlers={interactiveData.handlers}
            renderOptions={deferredRenderOptions}
          />
        );
        break;
      default:
        content = (
          <RenderSurface
            renderer={apiView}
            vnode={deferredVNode}
            renderOptions={deferredRenderOptions}
            isPending={isPending}
          />
        );
    }
  }
  return (
    <div ref={setPreviewEl} className="preview-body">
      {content}
    </div>
  );
}

export function ApiExamplesPage() {
  const { engine, status } = useBoundSvg();
  const [apiView, setApiView] = useState<ApiView>("boundsvg");
  const [debugOverlayParts, setDebugOverlayParts] = useState<DebugOverlayPart[]>([]);
  const [isPending, startTransition] = useTransition();
  const [viewTab, setViewTab] = useState<ApiViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");

  const vnode = useMemo(() => buildApiShowcaseVNode(), []);
  const interactiveData = useMemo(() => buildInteractiveVNode(), []);
  const renderOptions = useMemo<RenderOptions>(
    () => ({ debug: resolveDebugOverlayConfig(debugOverlayParts) }),
    [debugOverlayParts],
  );

  const deferredVNode = useDeferredValue(vnode);
  const deferredRenderOptions = useDeferredValue(renderOptions);

  const activeVNode = isRendererMode(apiView) ? deferredVNode : interactiveData.vnode;

  // Rendered SVG tab + inspect hover
  const {
    highlightedSvg: highlightedRenderedSvg,
    setPreviewEl,
    setCodeEl,
  } = useSvgInspect(engine, status, activeVNode, renderOptions);

  const showCode = viewTab !== "preview" && viewTab !== "svg";
  const activeCodeTab: "svg" | "jsx" | "api-usage" =
    viewTab === "svg" || viewTab === "jsx" || viewTab === "api-usage" ? viewTab : "jsx";

  const jsxSnippetCode = useMemo(
    () => (activeVNode ? generateJsxSnippet(activeVNode) : ""),
    [activeVNode],
  );
  const highlightedJsxSnippet = useMemo(
    () => (jsxSnippetCode ? Prism.highlight(jsxSnippetCode, getPrismGrammar("tsx"), "tsx") : ""),
    [jsxSnippetCode],
  );
  const highlightedApiUsage = useMemo(
    () => Prism.highlight(API_CODE_SNIPPETS[apiView], getPrismGrammar("tsx"), "tsx"),
    [apiView],
  );

  return (
    <div className="split-layout">
      <aside className="panel controls-panel">
        <h3>API</h3>
        <SelectField
          id="api-view"
          label="View"
          value={apiView}
          onChange={(v) => startTransition(() => setApiView(v as ApiView))}
          options={[
            { value: "boundsvg", label: "BoundSvg component" },
            { value: "svg-hook", label: "useRenderToSvg" },
            { value: "png-hook", label: "useRenderToPng" },
            { value: "svg-async", label: "useRenderToSvgAsync (Worker)" },
            { value: "png-async", label: "useRenderToPngAsync (Worker)" },
            { value: "interactive-hook", label: "useInteractiveSvg" },
            { value: "interactive-component", label: "InteractiveBoundSvg" },
            { value: "text-copy", label: "useTextCopy" },
          ]}
        />
        <BBoxOverlayField
          id="api-debug"
          value={debugOverlayParts}
          onChange={(value) => startTransition(() => setDebugOverlayParts(value))}
        />
      </aside>

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>Live Preview</h3>
            <span>
              {isRendererMode(apiView)
                ? "The same VNode rendered through different API methods."
                : "Interactive features — hover and right-click on text."}
            </span>
          </div>
          {codeLayout === "tab" && (
            <div className="preview-view-tabs">
              {(["preview", "svg", "jsx", "api-usage"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`preview-view-tab ${viewTab === tab ? "active" : ""}`}
                  onClick={() => startTransition(() => setViewTab(tab))}
                >
                  {API_VIEW_TAB_LABELS[tab]}
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

        <ApiPreviewSurface
          apiView={apiView}
          viewTab={viewTab}
          codeLayout={codeLayout}
          highlightedRenderedSvg={highlightedRenderedSvg}
          deferredVNode={deferredVNode}
          deferredRenderOptions={deferredRenderOptions}
          interactiveData={interactiveData}
          isPending={isPending}
          setPreviewEl={setPreviewEl}
          setCodeEl={setCodeEl}
        />

        <div className="code-area">
          {codeLayout === "panel" && (
            <div className="code-area-tabs">
              {(["svg", "jsx", "api-usage"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`preview-view-tab ${activeCodeTab === tab ? "active" : ""}`}
                  onClick={() => startTransition(() => setViewTab(tab))}
                >
                  {tab === "svg" ? "Rendered SVG" : tab === "jsx" ? "Generated JSX" : "API Usage"}
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
                  __html: activeCodeTab === "jsx" ? highlightedJsxSnippet : highlightedApiUsage,
                }}
              />
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
