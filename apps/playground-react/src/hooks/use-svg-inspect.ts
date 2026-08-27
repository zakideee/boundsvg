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

import { resolveHitTarget, translateSvgCoords } from "@boundsvg/browser";
import {
  buildInspectHitTestIndex,
  buildNodeTypeMap,
  type IR,
  inspectHitTestCandidates,
} from "@boundsvg/core/scene";
import type { Engine, RenderSvgOptions, VNode } from "@boundsvg/react";
import Prism from "prismjs";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  highlightCodeLines,
  wrapInLineElements,
} from "../../../playground-shared/code-line-highlight.js";
import { formatSvgCode } from "../../../playground-shared/html-utils.js";
import {
  type EventEffectOverlayDisplayOptions,
  type InspectHitTestFn,
  setupInspectHover,
} from "../../../playground-shared/inspect-hover.js";
import { getPrismGrammar } from "../../../playground-shared/prism.js";
import { buildNodeLineMap, type NodeLineRange } from "../../../playground-shared/svg-line-map.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHitTester(ir: IR): InspectHitTestFn {
  const index = buildInspectHitTestIndex(ir);
  const nodeTypeMap = buildNodeTypeMap(ir);
  return (svgEl, clientX, clientY) => {
    const coords = translateSvgCoords(svgEl, clientX, clientY);
    if (!coords) {
      return null;
    }
    const candidates = inspectHitTestCandidates(index, coords.x, coords.y);
    return resolveHitTarget(svgEl, candidates, nodeTypeMap, clientX, clientY);
  };
}

function buildLineToNodeMap(lineMap: Map<string, NodeLineRange>): Map<number, string> {
  const result = new Map<number, string>();
  for (const [nodeId, range] of lineMap) {
    for (let line = range.start; line <= range.end; line++) {
      if (!result.has(line)) {
        result.set(line, nodeId);
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
  nodeLineMap: Map<string, NodeLineRange> | null;
  lineToNodeMap: Map<number, string> | null;
};

const EMPTY_DATA: SvgRenderData = {
  highlightedSvg: "",
  ir: null,
  nodeLineMap: null,
  lineToNodeMap: null,
};

/** Format raw SVG string into highlighted, line-wrapped HTML for code display. */
function computeSvgRenderData(svgString: string, ir: IR): SvgRenderData {
  const formatted = formatSvgCode(svgString);
  const nodeLineMap = buildNodeLineMap(formatted);
  const lineToNodeMap = buildLineToNodeMap(nodeLineMap);
  const highlighted = Prism.highlight(formatted, getPrismGrammar("markup"), "markup");
  const highlightedSvg = wrapInLineElements(highlighted);
  return { highlightedSvg, ir, nodeLineMap, lineToNodeMap };
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
  const inspectHighlightRef = useRef<((nodeId: string | null) => void) | null>(null);

  // Track the current IR so the MutationObserver can detect stale closures.
  const currentIrRef = useRef<IR | null>(null);
  currentIrRef.current = data.ir;

  // ---- Inspect hover on preview container (SVG → code direction) ----
  // biome-ignore lint/correctness/useExhaustiveDependencies: codeEl intentionally read from closure so the overlay doesn't tear down/rebuild when only the code panel mounts.
  useEffect(() => {
    if (!previewEl || !data.ir) {
      inspectHighlightRef.current = null;
      return;
    }

    const ir = data.ir;
    const nodeLineMap = data.nodeLineMap;
    const hitTester = createHitTester(ir);

    const onHover = (nodeId: string | null): void => {
      if (!codeEl || !nodeLineMap) {
        return;
      }
      const range = nodeId ? (nodeLineMap.get(nodeId) ?? null) : null;
      highlightCodeLines(codeEl, range);
    };

    let currentHandle = setupInspectHover(previewEl, ir, hitTester, onHover, overlayDisplay);
    inspectHighlightRef.current = currentHandle.highlight;

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
        if (svg && !svg.dataset.effectWrapper) {
          currentHandle.cleanup();
          currentHandle = setupInspectHover(previewEl, ir, hitTester, onHover, overlayDisplay);
          inspectHighlightRef.current = currentHandle.highlight;
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
      inspectHighlightRef.current = null;
    };
  }, [previewEl, data.ir, data.nodeLineMap, overlayDisplay]);

  // ---- Code-line hover on code block (code → SVG direction) ----
  useEffect(() => {
    if (!codeEl || !data.nodeLineMap || !data.lineToNodeMap) {
      return;
    }

    const { nodeLineMap, lineToNodeMap } = data;

    const onMouseOver = (e: MouseEvent): void => {
      const target = (e.target as HTMLElement).closest?.(".code-line") as HTMLElement | null;
      if (!target) {
        return;
      }
      const lineNum = Number(target.dataset.line);
      const nodeId = lineToNodeMap.get(lineNum) ?? null;
      if (nodeId) {
        const range = nodeLineMap.get(nodeId) ?? null;
        highlightCodeLines(codeEl, range);
        inspectHighlightRef.current?.(nodeId);
      } else {
        highlightCodeLines(codeEl, null);
        inspectHighlightRef.current?.(null);
      }
    };

    const onMouseLeave = (): void => {
      highlightCodeLines(codeEl, null);
      inspectHighlightRef.current?.(null);
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
      const { svg, ir } = engine.renderToSvgAndIR(vnode, renderOptions);
      return computeSvgRenderData(svg, ir);
    } catch {
      return EMPTY_DATA;
    }
  }, [engine, status, vnode, renderOptions]);

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
