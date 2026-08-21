import Prism from "prismjs";
import {
  highlightCodeLines,
  wrapInLineElements,
} from "../../playground-shared/code-line-highlight.js";
import { getElement } from "../../playground-shared/dom.js";
import { formatSvgCode } from "../../playground-shared/html-utils.js";
import { getPrismGrammar } from "../../playground-shared/prism.js";
import { buildNodeLineMap, type NodeLineRange } from "../../playground-shared/svg-line-map.js";
import { presets } from "./presets/index";
import { coreState } from "./state";

export { escapeHtml } from "../../playground-shared/html-utils.js";

/** Cached nodeId → line range map for the current SVG source. */
let cachedLineMap: Map<string, NodeLineRange> | null = null;

/** Reverse map: line number → nodeId (for code→SVG hover). */
let cachedLineToNodeMap: Map<number, string> | null = null;

/** Cleanup for code-line hover listeners. */
let codeHoverCleanup: (() => void) | null = null;

function buildLineToNodeMap(lineMap: Map<string, NodeLineRange>): Map<number, string> {
  const result = new Map<number, string>();
  for (const [nodeId, range] of lineMap) {
    for (let line = range.start; line <= range.end; line++) {
      // First nodeId wins (innermost elements are added first by buildNodeLineMap)
      if (!result.has(line)) {
        result.set(line, nodeId);
      }
    }
  }
  return result;
}

function setupCodeLineHover(codeOutput: HTMLElement): () => void {
  const onMouseOver = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement).closest?.(".code-line") as HTMLElement | null;
    if (!target || !cachedLineToNodeMap || !cachedLineMap) {
      return;
    }
    const lineNum = Number(target.dataset.line);
    const nodeId = cachedLineToNodeMap.get(lineNum) ?? null;
    if (nodeId) {
      const range = cachedLineMap.get(nodeId) ?? null;
      highlightCodeLines(codeOutput, range);
      coreState.inspectHighlight?.(nodeId);
    } else {
      highlightCodeLines(codeOutput, null);
      coreState.inspectHighlight?.(null);
    }
  };

  const onMouseLeave = (): void => {
    highlightCodeLines(codeOutput, null);
    coreState.inspectHighlight?.(null);
  };

  codeOutput.addEventListener("mouseover", onMouseOver);
  codeOutput.addEventListener("mouseleave", onMouseLeave);

  return () => {
    codeOutput.removeEventListener("mouseover", onMouseOver);
    codeOutput.removeEventListener("mouseleave", onMouseLeave);
  };
}

export function updateCodePanel(): void {
  // Clean up previous code hover listeners
  if (codeHoverCleanup) {
    codeHoverCleanup();
    codeHoverCleanup = null;
  }

  const codeOutput = getElement("code-output");
  const preset = presets[coreState.currentPresetKey];
  if (!preset) {
    return;
  }

  // Reset scroll position when switching presets/tabs
  codeOutput.scrollTop = 0;

  // Update tab active state
  document.querySelectorAll(".code-tab").forEach((tab) => {
    const tabElement = tab as HTMLElement;
    tabElement.classList.toggle("active", tabElement.dataset.tab === coreState.currentCodeTab);
  });

  if (coreState.currentCodeTab === "source") {
    codeOutput.innerHTML = Prism.highlight(
      preset.source,
      getPrismGrammar("typescript"),
      "typescript",
    );
    cachedLineMap = null;
    cachedLineToNodeMap = null;
  } else {
    const formatted = formatSvgCode(coreState.cachedSvgString);
    cachedLineMap = buildNodeLineMap(formatted);
    cachedLineToNodeMap = buildLineToNodeMap(cachedLineMap);
    const highlighted = Prism.highlight(formatted, getPrismGrammar("markup"), "markup");
    codeOutput.innerHTML = wrapInLineElements(highlighted);
    // Attach code→SVG hover listeners
    codeHoverCleanup = setupCodeLineHover(codeOutput);
  }
}

/**
 * Highlight SVG source lines corresponding to the given nodeId.
 * Called by the inspect hover `onHoverChange` callback (SVG→code direction).
 */
export function highlightSvgSourceLine(nodeId: string | null): void {
  if (coreState.currentCodeTab !== "svg" || !cachedLineMap) {
    return;
  }
  const codeOutput = getElement("code-output");
  const range = nodeId ? (cachedLineMap.get(nodeId) ?? null) : null;
  highlightCodeLines(codeOutput, range);
}
