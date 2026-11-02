/**
 * Bidirectional inspect-hover sync between rendered SVG preview and code panel.
 *
 * - SVG preview hover → BBOX overlay + code-line highlight
 * - Code-line hover → BBOX overlay in preview
 *
 * Provides two hooks:
 * - `useSvgInspect` — for pages with a main-thread Engine (computes SVG + IR internally)
 * - `useSvgInspectFromData` — for Worker pages (accepts pre-computed SVG + IR)
 */

import { bindIRToSvg, resolveHitTarget, translateSvgCoords } from "@boundsvg/browser";
import {
  buildInspectHitTestIndex,
  buildIRSourceIndex,
  type IR,
  type IRSourceRef,
} from "@boundsvg/core/scene";
import type { Engine, RenderAnimatedSvgOptions, RenderSvgOptions, VNode } from "@boundsvg/react";
import Prism from "prismjs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  highlightCodeLines,
  wrapInLineElements,
} from "../../../playground-shared/code-line-highlight.js";
import { formatSvgCode } from "../../../playground-shared/html-utils.js";
import {
  type EventEffectOverlayDisplayOptions,
  type InspectHitTestFn,
  type InspectHoverHandle,
  setupInspectHover,
} from "../../../playground-shared/inspect-hover.js";
import { getPrismGrammar } from "../../../playground-shared/prism.js";
import { buildNodeLineMap, type NodeLineRange } from "../../../playground-shared/svg-line-map.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHitTester(ir: IR): InspectHitTestFn {
  const index = buildInspectHitTestIndex(ir);
  let binding: ReturnType<typeof bindIRToSvg> | null = null;
  return (svgEl, clientX, clientY) => {
    const coords = translateSvgCoords(svgEl, clientX, clientY);
    if (!coords) {
      return null;
    }
    const candidates = index.queryCandidates(coords.x, coords.y);
    if (binding?.root !== svgEl) {
      binding = bindIRToSvg(svgEl, index.sourceIndex);
    }
    return resolveHitTarget(binding, candidates, clientX, clientY);
  };
}

function buildLineToSourceMap(lineMap: Map<number, NodeLineRange>): Map<number, number> {
  const result = new Map<number, number>();
  for (const [sourceOrdinal, range] of lineMap) {
    for (let line = range.start; line <= range.end; line++) {
      if (!result.has(line)) {
        result.set(line, sourceOrdinal);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Render data (SVG + IR + line maps)
// ---------------------------------------------------------------------------

type SvgRenderData = {
  highlightedSvg: string;
  ir: IR | null;
  nodeLineMap: Map<number, NodeLineRange> | null;
  lineToSourceMap: Map<number, number> | null;
  sources: ReturnType<typeof buildIRSourceIndex>["sources"] | null;
};

/** Empty inspection state while render artifacts are unavailable. */
const EMPTY_DATA: SvgRenderData = {
  highlightedSvg: "",
  ir: null,
  nodeLineMap: null,
  lineToSourceMap: null,
  sources: null,
};

/** Format raw SVG string into highlighted, line-wrapped HTML for code display. */
function computeSvgRenderData(svgString: string, ir: IR): SvgRenderData {
  const formatted = formatSvgCode(svgString);
  const sourceIndex = buildIRSourceIndex(ir);
  const nodeLineMap = buildNodeLineMap(formatted, sourceIndex);
  const lineToSourceMap = buildLineToSourceMap(nodeLineMap);
  const highlighted = Prism.highlight(formatted, getPrismGrammar("markup"), "markup");
  const highlightedSvg = wrapInLineElements(highlighted);
  return { highlightedSvg, ir, nodeLineMap, lineToSourceMap, sources: sourceIndex.sources };
}

// ---------------------------------------------------------------------------
// Shared inspect-hover setup hook
// ---------------------------------------------------------------------------

type InspectHoverResult = {
  setPreviewEl: (element: HTMLDivElement | null) => void;
  setCodeEl: (element: HTMLDivElement | null) => void;
};

/**
 * Internal hook that wires up bidirectional inspect-hover between preview
 * and code panels. Shared by `useSvgInspect` and `useSvgInspectFromData`.
 */
function useInspectHover(
  data: SvgRenderData,
  overlayDisplay?: EventEffectOverlayDisplayOptions,
): InspectHoverResult {
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null);
  const [codeEl, setCodeEl] = useState<HTMLDivElement | null>(null);
  const inspectHandleRef = useRef<InspectHoverHandle | null>(null);
  const displayRef = useRef(overlayDisplay);
  useEffect(() => {
    displayRef.current = overlayDisplay;
    inspectHandleRef.current?.updateDisplay(overlayDisplay);
  }, [overlayDisplay]);

  // Track the current IR so the MutationObserver can detect stale closures.
  const currentIrRef = useRef<IR | null>(null);
  useLayoutEffect(() => {
    currentIrRef.current = data.ir;
  }, [data.ir]);

  // ---- Inspect hover on preview container (SVG → code direction) ----
  useEffect(() => {
    if (!previewEl || !data.ir) {
      inspectHandleRef.current = null;
      return;
    }

    const ir = data.ir;
    const nodeLineMap = data.nodeLineMap;
    const hitTester = createHitTester(ir);

    const onHover = (source: IRSourceRef | null): void => {
      if (!codeEl || !nodeLineMap) {
        return;
      }
      const range = source ? (nodeLineMap.get(source.sourceIndex) ?? null) : null;
      highlightCodeLines(codeEl, range);
    };

    let currentHandle = setupInspectHover(previewEl, ir, hitTester, onHover, displayRef.current);
    inspectHandleRef.current = currentHandle;

    // React may replace the SVG element inside the container (e.g. when
    // dangerouslySetInnerHTML re-commits during reconciliation). Watch
    // for childList mutations and re-attach the overlay when a fresh
    // SVG appears (one without the data-effect-wrapper flag set by
    // EventEffectOverlay).
    //
    // Guard: skip re-attachment when the captured `ir` no longer matches
    // `currentIrRef` — that means a new render has produced fresh data
    // and the useEffect will re-run momentarily.
    //
    // Debounce: batch rapid mutations (overlay setup itself triggers
    // several childList changes) into a single rAF to avoid redundant work.
    let rafId: number | null = null;

    const observer = new MutationObserver(() => {
      if (rafId != null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (ir !== currentIrRef.current) {
          return;
        }
        const svg = previewEl.querySelector("svg");
        if (!svg) {
          if (inspectHandleRef.current) {
            currentHandle.cleanup();
            inspectHandleRef.current = null;
          }
          return;
        }
        if (!svg.dataset.effectWrapper) {
          currentHandle.cleanup();
          currentHandle = setupInspectHover(previewEl, ir, hitTester, onHover, displayRef.current);
          inspectHandleRef.current = currentHandle;
        }
      });
    });
    observer.observe(previewEl, { childList: true, subtree: true });

    return () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
      observer.disconnect();
      currentHandle.cleanup();
      inspectHandleRef.current = null;
    };
  }, [previewEl, codeEl, data.ir, data.nodeLineMap]);

  // ---- Code-line hover on code block (code → SVG direction) ----
  useEffect(() => {
    if (!codeEl || !data.nodeLineMap || !data.lineToSourceMap) {
      return;
    }

    const { nodeLineMap, lineToSourceMap } = data;

    const onMouseOver = (e: MouseEvent): void => {
      const target = (e.target as HTMLElement).closest?.(".code-line") as HTMLElement | null;
      if (!target) {
        return;
      }
      const lineNum = Number(target.dataset.line);
      const sourceOrdinal = lineToSourceMap.get(lineNum) ?? null;
      if (sourceOrdinal !== null) {
        const range = nodeLineMap.get(sourceOrdinal) ?? null;
        highlightCodeLines(codeEl, range);
        inspectHandleRef.current?.highlight(data.sources?.get(sourceOrdinal)?.source ?? null);
      } else {
        highlightCodeLines(codeEl, null);
        inspectHandleRef.current?.highlight(null);
      }
    };

    const onMouseLeave = (): void => {
      highlightCodeLines(codeEl, null);
      inspectHandleRef.current?.highlight(null);
    };

    codeEl.addEventListener("mouseover", onMouseOver);
    codeEl.addEventListener("mouseleave", onMouseLeave);

    return () => {
      codeEl.removeEventListener("mouseover", onMouseOver);
      codeEl.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [codeEl, data]);

  return { setPreviewEl, setCodeEl };
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/**
 * Compute highlighted SVG code and set up bidirectional inspect-hover sync.
 * For pages with a main-thread Engine that can render synchronously.
 *
 * Returns:
 * - `highlightedSvg` — Prism-highlighted, line-wrapped SVG for display
 * - `setPreviewEl` — callback ref for the preview container (BBOX overlay target)
 * - `setCodeEl` — callback ref for the SVG code block (line-hover target)
 */
export function useSvgInspect(
  engine: Engine | null,
  status: string,
  vnode: VNode | null,
  renderOptions?: RenderSvgOptions,
  overlayDisplay?: EventEffectOverlayDisplayOptions,
  animatedSvgOptions?: RenderAnimatedSvgOptions,
): {
  highlightedSvg: string;
  setPreviewEl: (element: HTMLDivElement | null) => void;
  setCodeEl: (element: HTMLDivElement | null) => void;
} {
  const data = useMemo<SvgRenderData>(() => {
    if (status !== "ready" || !engine || !vnode) {
      return EMPTY_DATA;
    }
    try {
      // Static SVG+IR rejects animated scenes without an explicit timeMs;
      // scenes that declare animation go through the animated entry point so
      // the inspected SVG matches the live declarative preview.
      const animated = /"animate(Units)?":/.test(JSON.stringify(vnode));
      const { svg, ir } = animated
        ? engine.renderToAnimatedSvgAndIR(vnode, {
            ...renderOptions,
            ...(animatedSvgOptions ?? { playback: { mode: "independent" } }),
          })
        : engine.renderToSvgAndIR(vnode, renderOptions);
      return computeSvgRenderData(svg, ir);
    } catch {
      return EMPTY_DATA;
    }
  }, [engine, status, vnode, renderOptions, animatedSvgOptions]);

  const { setPreviewEl, setCodeEl } = useInspectHover(data, overlayDisplay);

  return {
    highlightedSvg: data.highlightedSvg,
    setPreviewEl,
    setCodeEl,
  };
}

/**
 * Set up bidirectional inspect-hover sync from pre-computed SVG + IR.
 * For Worker pages where SVG and IR are produced asynchronously.
 *
 * Returns:
 * - `highlightedSvg` — Prism-highlighted, line-wrapped SVG for display
 * - `setPreviewEl` — callback ref for the preview container (BBOX overlay target)
 * - `setCodeEl` — callback ref for the SVG code block (line-hover target)
 */
export function useSvgInspectFromData(
  svgString: string | null,
  ir: IR | null,
  overlayDisplay?: EventEffectOverlayDisplayOptions,
): {
  highlightedSvg: string;
  setPreviewEl: (element: HTMLDivElement | null) => void;
  setCodeEl: (element: HTMLDivElement | null) => void;
} {
  const data = useMemo<SvgRenderData>(() => {
    if (!svgString || !ir) {
      return EMPTY_DATA;
    }
    try {
      return computeSvgRenderData(svgString, ir);
    } catch {
      return EMPTY_DATA;
    }
  }, [svgString, ir]);

  const { setPreviewEl, setCodeEl } = useInspectHover(data, overlayDisplay);

  return {
    highlightedSvg: data.highlightedSvg,
    setPreviewEl,
    setCodeEl,
  };
}
