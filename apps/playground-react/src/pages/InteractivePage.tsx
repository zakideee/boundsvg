import type { IR } from "@boundsvg/core";
import { Box, Canvas, Flex, Path, Text, toVNode } from "@boundsvg/react";
import {
  InteractiveBoundSvg,
  type PointerEventInfo,
  type TextCopyMenuInfo,
} from "@boundsvg/react/interactive";
import { useBoundSvg } from "@boundsvg/react/provider";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { wrapInLineElements } from "../../../playground-shared/code-line-highlight.js";
import "../../../playground-shared/text-copy-menu.css";
import {
  buildNodeBBoxMap,
  EVENT_COLORS,
  EventEffectOverlay,
  FLASH_EVENTS,
} from "../../../playground-shared/event-effects.js";
import { formatSvgCode } from "../../../playground-shared/html-utils.js";
import { getPrismGrammar } from "../../../playground-shared/prism.js";
import { generateJsxSnippet } from "../lib/codegen";

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

type LogEntry = {
  id: number;
  time: string;
  event: string;
  nodeId: string;
  coords: string;
};

type ToastInfo = {
  message: string;
  left: number;
  top: number;
};

const MAX_LOG = 50;
const TOAST_OFFSET_PX = 12;
const TOAST_MAX_WIDTH_PX = 220;
const TOAST_ESTIMATED_HEIGHT_PX = 36;
const VIEWPORT_PADDING_PX = 16;

function now(): string {
  const date = new Date();
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Code snippet
// ---------------------------------------------------------------------------

const CODE_SNIPPET = `import {
  InteractiveBoundSvg,
  type PointerEventInfo,
} from "@boundsvg/react/interactive";
import { Flex, Box, Text } from "@boundsvg/react";

function Demo() {
  const handle = (info: PointerEventInfo) => {
    console.log(\`\${info.handlerName} at (\${info.svgX}, \${info.svgY})\`);
  };

  return (
    <InteractiveBoundSvg width={800} height={860} background="#1e1e1e">
      <Box id="card" background="#2d2d2d" borderRadius={12}
           padding={24} width={240} height={120}>
        <Text id="btn" font="NotoSansJP-woff2" fontSizePx={22}
              color="#38bdf8"
              onClick={handle}
              onDoubleClick={handle}
              onPointerDown={handle}
              onPointerUp={handle}
              onMouseEnter={handle}
              onMouseLeave={handle}>
          Click / Double-click / Press me!
        </Text>
      </Box>
    </InteractiveBoundSvg>
  );
}`;

// ---------------------------------------------------------------------------
// Static VNode for code generation (mirrors the interactive JSX shape)
// ---------------------------------------------------------------------------

function buildStaticVNode() {
  return toVNode(
    <Canvas width={800} height={580} background="#1e1e1e">
      <Flex direction="column" padding={32} gap={16} width={800} height={580}>
        <Flex direction="row" gap={16}>
          <Box background="#2d2d2d" borderRadius={12} padding={20} width={175} height={140}>
            <Flex direction="column" gap={8} width={135} height={100}>
              <Text font="NotoSansJP-woff2" fontSizePx={18} color="#38bdf8" wrap="char">
                Click
              </Text>
            </Flex>
          </Box>
          <Box background="#2d2d2d" borderRadius={12} padding={20} width={175} height={140}>
            <Flex direction="column" gap={8} width={135} height={100}>
              <Text font="NotoSansJP-woff2" fontSizePx={18} color="#a78bfa" wrap="char">
                Hover
              </Text>
            </Flex>
          </Box>
        </Flex>
      </Flex>
    </Canvas>,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewTab = "preview" | "svg" | "jsx" | "snippet";
type CodeLayout = "tab" | "panel";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InteractivePage() {
  const { engine, status } = useBoundSvg();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [copyMenu, setCopyMenu] = useState<TextCopyMenuInfo | null>(null);
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  const [, startTransition] = useTransition();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(0 as never);
  const mountedRef = useRef(false);
  const copyRequestGenerationRef = useRef(0);
  const idRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<EventEffectOverlay | null>(null);
  const hoverDisplayRef = useRef<HTMLElement>(null);

  const addLog = useCallback((event: string, info: PointerEventInfo) => {
    setLog((prev) => {
      const entry: LogEntry = {
        id: idRef.current++,
        time: now(),
        event,
        nodeId: info.nodeId,
        coords: `(${Math.round(info.svgX)}, ${Math.round(info.svgY)})`,
      };
      const next = [entry, ...prev];
      if (next.length > MAX_LOG) {
        next.length = MAX_LOG;
      }
      return next;
    });
  }, []);

  // Generic handler factory — logs + fires flash effect
  const handleEvent = useCallback(
    (event: string) => (info: PointerEventInfo) => {
      addLog(event, info);
      if (FLASH_EVENTS.has(event)) {
        overlayRef.current?.flashNode(info.nodeId, EVENT_COLORS[event] ?? "#fff");
      }
    },
    [addLog],
  );

  // Hover change — update DOM directly (no React re-render) + overlay glow
  const handleHoverChange = useCallback((nodeId: string | null) => {
    if (hoverDisplayRef.current) {
      hoverDisplayRef.current.textContent = nodeId ?? "none";
    }
    overlayRef.current?.setHoverGlow(nodeId);
  }, []);

  // Create overlay once, then update bboxMap on subsequent renders
  const handleRender = useCallback((ir: IR) => {
    const container = wrapperRef.current;
    if (!container) {
      return;
    }

    const bboxMap = buildNodeBBoxMap(ir);
    if (overlayRef.current) {
      overlayRef.current.updateBBoxMap(bboxMap);
    } else {
      overlayRef.current = new EventEffectOverlay({
        container,
        width: ir.width,
        height: ir.height,
        bboxMap,
      });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyRequestGenerationRef.current += 1;
      clearTimeout(toastTimerRef.current);
      overlayRef.current?.destroy();
      overlayRef.current = null;
    };
  }, []);

  // Text copy menu handlers
  const handleTextCopyMenu = useCallback((info: TextCopyMenuInfo) => {
    setCopyMenu(info);
  }, []);

  const handleCopyItem = useCallback(
    async (text: string, label: string) => {
      if (!copyMenu) {
        return;
      }
      const requestGeneration = ++copyRequestGenerationRef.current;
      const ok = await copyMenu.copyToClipboard(text);
      if (!mountedRef.current || copyRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      const viewportWidth =
        typeof window !== "undefined"
          ? window.innerWidth
          : TOAST_MAX_WIDTH_PX + VIEWPORT_PADDING_PX;
      const viewportHeight =
        typeof window !== "undefined"
          ? window.innerHeight
          : TOAST_ESTIMATED_HEIGHT_PX + VIEWPORT_PADDING_PX;
      const toastLeft = clamp(
        copyMenu.clientX + TOAST_OFFSET_PX,
        VIEWPORT_PADDING_PX,
        viewportWidth - TOAST_MAX_WIDTH_PX - VIEWPORT_PADDING_PX,
      );
      const toastTop = clamp(
        copyMenu.clientY + TOAST_OFFSET_PX,
        VIEWPORT_PADDING_PX,
        viewportHeight - TOAST_ESTIMATED_HEIGHT_PX - VIEWPORT_PADDING_PX,
      );
      setCopyMenu(null);
      clearTimeout(toastTimerRef.current);
      setToast({
        message: ok ? `Copied: ${label}` : "Copy failed",
        left: toastLeft,
        top: toastTop,
      });
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
      }, 1200);
    },
    [copyMenu],
  );

  // Dismiss menu on click outside or Escape
  useEffect(() => {
    if (!copyMenu) {
      return;
    }
    function handleDismiss(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key !== "Escape") {
        return;
      }
      setCopyMenu(null);
    }
    document.addEventListener("mousedown", handleDismiss);
    document.addEventListener("keydown", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleDismiss);
      document.removeEventListener("keydown", handleDismiss);
    };
  }, [copyMenu]);

  const codeHtml = useMemo(() => Prism.highlight(CODE_SNIPPET, getPrismGrammar("tsx"), "tsx"), []);

  const staticVNode = useMemo(() => buildStaticVNode(), []);
  const highlightedRenderedSvg = useMemo(() => {
    if (status !== "ready" || !engine) {
      return "";
    }
    try {
      const svg = engine.renderToSvg(staticVNode);
      const formatted = formatSvgCode(svg);
      return wrapInLineElements(Prism.highlight(formatted, getPrismGrammar("markup"), "markup"));
    } catch {
      return "";
    }
  }, [engine, status, staticVNode]);

  const showCode = viewTab !== "preview" && viewTab !== "svg";
  const activeCodeTab: "svg" | "jsx" | "snippet" =
    viewTab === "svg" || viewTab === "jsx" || viewTab === "snippet" ? viewTab : "jsx";

  const jsxSnippetCode = useMemo(() => generateJsxSnippet(staticVNode), [staticVNode]);
  const highlightedJsxSnippet = useMemo(
    () => Prism.highlight(jsxSnippetCode, getPrismGrammar("tsx"), "tsx"),
    [jsxSnippetCode],
  );

  return (
    <div className="split-layout">
      {/* Left panel — event log */}
      <aside className="panel controls-panel">
        <h3>Event Log</h3>

        <div style={{ marginBottom: 8, fontSize: 12, color: "var(--muted)" }}>
          Hover:{" "}
          <code ref={hoverDisplayRef} style={{ color: "var(--accent)" }}>
            none
          </code>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "scroll",
            padding: 8,
            fontSize: 11,
            fontFamily: "monospace",
            lineHeight: 1.6,
          }}
        >
          {log.length === 0 && (
            <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
              Interact with SVG elements to see the event log
            </p>
          )}
          {log.map((e) => (
            <div
              key={e.id}
              style={{
                display: "grid",
                gridTemplateColumns: "78px 85px 1fr auto",
                gap: "0 4px",
                borderBottom: "1px solid var(--line)",
                padding: "2px 0",
              }}
            >
              <span style={{ color: "var(--muted)" }}>{e.time}</span>
              <span style={{ color: EVENT_COLORS[e.event] ?? "var(--muted)" }}>{e.event}</span>
              <span style={{ color: "var(--accent)" }}>{e.nodeId}</span>
              <span style={{ color: "var(--muted)" }}>{e.coords}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLog([])}
          style={{
            marginTop: 8,
            padding: "4px 12px",
            fontSize: 12,
            background: "var(--panel-2)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      </aside>

      {/* Right panel — interactive SVG + code area */}
      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>Interactive Events</h3>
            <span>Click, hover, and right-click on SVG elements</span>
          </div>
          {codeLayout === "tab" && (
            <div className="preview-view-tabs">
              {(["preview", "svg", "jsx", "snippet"] as const).map((tab) => {
                const labels: Record<ViewTab, string> = {
                  preview: "Preview",
                  svg: "Rendered SVG",
                  jsx: "Generated JSX",
                  snippet: "Code Snippet",
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
          {viewTab === "svg" && codeLayout === "tab" ? (
            <div
              className="code-block"
              dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
            />
          ) : (
            <div className="preview-stage-wrap">
              <div className="preview-stage">
                <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
                  <InteractiveBoundSvg
                    width={800}
                    height={580}
                    background="#1e1e1e"
                    enableTextCopy
                    onTextCopyMenu={handleTextCopyMenu}
                    onHoverChange={handleHoverChange}
                    onRender={handleRender}
                    fallback={<p>Rendering…</p>}
                    errorFallback={(err) => (
                      <p style={{ color: "var(--error)" }}>Error: {err.message}</p>
                    )}
                  >
                    <Flex direction="column" padding={32} gap={16} width={800} height={580}>
                      {/* Row 1 — Click / Hover / ContextMenu */}
                      <Flex direction="row" gap={16}>
                        {/* Card 1 — click only */}
                        <Box
                          id="card-click"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onClick={handleEvent("click")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#38bdf8"
                              wrap="char"
                            >
                              Click
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              onClick only
                            </Text>
                          </Flex>
                        </Box>

                        {/* Card 2 — pointer enter/leave */}
                        <Box
                          id="card-hover"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onPointerEnter={handleEvent("pointerEnter")}
                          onPointerLeave={handleEvent("pointerLeave")}
                          onPointerOver={handleEvent("pointerOver")}
                          onPointerOut={handleEvent("pointerOut")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#a78bfa"
                              wrap="char"
                            >
                              Hover
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              pointer Enter/Leave/Over/Out
                            </Text>
                          </Flex>
                        </Box>

                        {/* Card 3 — context menu + dblclick */}
                        <Box
                          id="card-ctx"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onContextMenu={handleEvent("contextMenu")}
                          onDoubleClick={handleEvent("dblclick")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#fbbf24"
                              wrap="char"
                            >
                              Right / Dbl
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              contextMenu + doubleClick
                            </Text>
                          </Flex>
                        </Box>

                        {/* Card 4 — star path with geometry hit */}
                        <Box
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                        >
                          <Flex
                            direction="column"
                            gap={4}
                            width={135}
                            height={100}
                            alignItems="center"
                          >
                            <Path
                              id="star"
                              d="M43 0 L54 30 L85 30 L60 49 L68 81 L43 61 L17 81 L26 49 L0 30 L32 30 Z"
                              width={86}
                              height={82}
                              fill="#fbbf24"
                              onClick={handleEvent("click")}
                              onContextMenu={handleEvent("contextMenu")}
                            />
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="none"
                            >
                              Path hit-test
                            </Text>
                          </Flex>
                        </Box>
                      </Flex>

                      {/* Row 2 — Pointer Down/Up, Mouse Down/Up, Mouse Enter/Leave, Mouse Move */}
                      <Flex direction="row" gap={16}>
                        <Box
                          id="card-ptr"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onPointerDown={handleEvent("pointerDown")}
                          onPointerUp={handleEvent("pointerUp")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#f472b6"
                              wrap="char"
                            >
                              Press
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              pointerDown / pointerUp
                            </Text>
                          </Flex>
                        </Box>
                        <Box
                          id="card-mouse"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onMouseDown={handleEvent("mouseDown")}
                          onMouseUp={handleEvent("mouseUp")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#c084fc"
                              wrap="char"
                            >
                              Mouse
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              mouseDown / mouseUp
                            </Text>
                          </Flex>
                        </Box>
                        <Box
                          id="card-mouse-hover"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onMouseEnter={handleEvent("mouseEnter")}
                          onMouseLeave={handleEvent("mouseLeave")}
                          onMouseOver={handleEvent("mouseOver")}
                          onMouseOut={handleEvent("mouseOut")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#34d399"
                              wrap="char"
                            >
                              Mouse Hover
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              mouseEnter/Leave/Over/Out
                            </Text>
                          </Flex>
                        </Box>
                        <Box
                          id="card-mousemove"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onMouseMove={handleEvent("mouseMove")}
                          onPointerMove={handleEvent("pointerMove")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#64748b"
                              wrap="char"
                            >
                              Move
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              mouseMove + pointerMove (rAF)
                            </Text>
                          </Flex>
                        </Box>
                      </Flex>

                      {/* Row 3 — Touch events */}
                      <Flex direction="row" gap={16}>
                        <Box
                          id="card-touch"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onTouchStart={handleEvent("touchStart")}
                          onTouchEnd={handleEvent("touchEnd")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#ff6b6b"
                              wrap="char"
                            >
                              Touch
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              touchStart / touchEnd
                            </Text>
                          </Flex>
                        </Box>
                        <Box
                          id="card-touchmove"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                          onTouchMove={handleEvent("touchMove")}
                        >
                          <Flex direction="column" gap={8} width={135} height={100}>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={18}
                              color="#f9ca24"
                              wrap="char"
                            >
                              Touch Move
                            </Text>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="char"
                            >
                              touchMove (rAF throttled)
                            </Text>
                          </Flex>
                        </Box>
                        <Box
                          id="card-zindex"
                          background="#2d2d2d"
                          borderRadius={12}
                          padding={20}
                          width={175}
                          height={140}
                        >
                          <Flex direction="column" gap={4} width={135} height={100}>
                            <Box width={135} height={72}>
                              <Path
                                id="z-front"
                                zIndex={2}
                                d="M0 0H80V52H0Z"
                                width={80}
                                height={52}
                                fill="#2563eb"
                                position="absolute"
                                left={0}
                                top={0}
                                onClick={handleEvent("click")}
                              />
                              <Path
                                id="z-under"
                                zIndex={1}
                                d="M0 0H80V52H0Z"
                                width={80}
                                height={52}
                                fill="#f97316"
                                position="absolute"
                                left={40}
                                top={16}
                                onClick={handleEvent("click")}
                              />
                            </Box>
                            <Text
                              font="NotoSansJP-woff2"
                              fontSizePx={12}
                              color="#94a3b8"
                              wrap="none"
                            >
                              zIndex hit: click overlap
                            </Text>
                          </Flex>
                        </Box>
                      </Flex>

                      {/* Footer note */}
                      <Text font="NotoSansJP-woff2" fontSizePx={13} color="#475569" wrap="char">
                        20 event types: click, dblclick, contextMenu,
                        pointerDown/Up/Move/Enter/Leave/Over/Out,
                        mouseDown/Up/Move/Enter/Leave/Over/Out, touchStart/End/Move
                      </Text>
                    </Flex>
                  </InteractiveBoundSvg>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="code-area">
          {codeLayout === "panel" && (
            <div className="code-area-tabs">
              {(["svg", "jsx", "snippet"] as const).map((tab) => (
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
                      : "Code Snippet"}
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
              <code
                dangerouslySetInnerHTML={{
                  __html: activeCodeTab === "jsx" ? highlightedJsxSnippet : codeHtml,
                }}
              />
            </pre>
          )}
        </div>
      </section>

      {/* Text copy context menu */}
      {copyMenu && <CopyMenuPopup menu={copyMenu} onCopy={handleCopyItem} />}

      {/* Copy toast */}
      {toast && (
        <div
          className="text-copy-toast"
          data-visible="true"
          style={{ left: toast.left, top: toast.top }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function truncate(text: string, maxLen: number): string {
  const single = text.replace(/\n/g, " ");
  if (single.length <= maxLen) {
    return single;
  }
  return `${single.slice(0, maxLen)}...`;
}

// ---------------------------------------------------------------------------
// Text copy context menu (thin UI layer)
// ---------------------------------------------------------------------------

function CopyMenuPopup({
  menu,
  onCopy,
}: {
  menu: TextCopyMenuInfo;
  onCopy: (text: string, label: string) => Promise<void>;
}) {
  const { lineText, nodeText, ancestorText, allText } = menu;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: menu popup stops click-outside dismiss
    <div
      className="text-copy-menu"
      style={{ left: menu.clientX, top: menu.clientY }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {lineText && (
        <button
          type="button"
          className="text-copy-menu-item"
          onClick={() => void onCopy(lineText, "line")}
        >
          <span className="text-copy-menu-preview">Copy line: {truncate(lineText, 24)}</span>
        </button>
      )}
      {nodeText && (
        <button
          type="button"
          className="text-copy-menu-item"
          onClick={() => void onCopy(nodeText, "node")}
        >
          Copy text: {truncate(nodeText, 24)}
        </button>
      )}
      {ancestorText && (
        <>
          <div className="text-copy-menu-sep" />
          <button
            type="button"
            className="text-copy-menu-item"
            onClick={() => void onCopy(ancestorText, "parent")}
          >
            Copy parent text
          </button>
        </>
      )}
      <div className="text-copy-menu-sep" />
      <button
        type="button"
        className="text-copy-menu-item"
        onClick={() => void onCopy(allText, "all")}
      >
        Copy all text
      </button>
    </div>
  );
}
