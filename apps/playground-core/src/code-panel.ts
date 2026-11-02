import { buildIRSourceIndex, type IRSourceIndex, type IRSourceRef } from "@boundsvg/core/scene";
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

/** Cached source occurrence → line range map for the current SVG source. */
let cachedSources: IRSourceIndex["sources"] | null = null;
let cachedLineMap: Map<number, NodeLineRange> | null = null;

/** Reverse map: line number → source ordinal (for code→SVG hover). */
let cachedLineToSourceMap: Map<number, number> | null = null;

/** Cleanup for code-line hover listeners. */
let codeHoverCleanup: (() => void) | null = null;

function buildLineToSourceMap(lineMap: Map<number, NodeLineRange>): Map<number, number> {
  const result = new Map<number, number>();
  for (const [sourceOrdinal, range] of lineMap) {
    for (let line = range.start; line <= range.end; line++) {
      // First source ordinal wins (innermost elements are added first by buildNodeLineMap)
      if (!result.has(line)) {
        result.set(line, sourceOrdinal);
      }
    }
  }
  return result;
}

function setupCodeLineHover(codeOutput: HTMLElement): () => void {
  const onMouseOver = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement).closest?.(".code-line") as HTMLElement | null;
    if (!target || !cachedLineToSourceMap || !cachedLineMap) {
      return;
    }
    const lineNum = Number(target.dataset.line);
    const sourceOrdinal = cachedLineToSourceMap.get(lineNum) ?? null;
    if (sourceOrdinal !== null) {
      const range = cachedLineMap.get(sourceOrdinal) ?? null;
      highlightCodeLines(codeOutput, range);
      coreState.inspectHandle?.highlight(cachedSources?.get(sourceOrdinal)?.source ?? null);
    } else {
      highlightCodeLines(codeOutput, null);
      coreState.inspectHandle?.highlight(null);
    }
  };

  const onMouseLeave = (): void => {
    highlightCodeLines(codeOutput, null);
    coreState.inspectHandle?.highlight(null);
  };

  codeOutput.addEventListener("mouseover", onMouseOver);
  codeOutput.addEventListener("mouseleave", onMouseLeave);

  return () => {
    codeOutput.removeEventListener("mouseover", onMouseOver);
    codeOutput.removeEventListener("mouseleave", onMouseLeave);
  };
}

/** Update source or SVG code and bind inspection to the current line map. */
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
    cachedLineToSourceMap = null;
  } else {
    const formatted = formatSvgCode(coreState.cachedSvgString);
    const sourceIndex = coreState.cachedIr ? buildIRSourceIndex(coreState.cachedIr) : null;
    cachedSources = sourceIndex?.sources ?? null;
    cachedLineMap = sourceIndex ? buildNodeLineMap(formatted, sourceIndex) : new Map();
    cachedLineToSourceMap = buildLineToSourceMap(cachedLineMap);
    const highlighted = Prism.highlight(formatted, getPrismGrammar("markup"), "markup");
    codeOutput.innerHTML = wrapInLineElements(highlighted);
    // Attach code→SVG hover listeners
    codeHoverCleanup = setupCodeLineHover(codeOutput);
  }
}

/**
 * Highlight SVG source lines corresponding to the given source occurrence.
 * Called by the inspect hover `onHoverChange` callback (SVG→code direction).
 */
export function highlightSvgSourceLine(source: IRSourceRef | null): void {
  if (coreState.currentCodeTab !== "svg" || !cachedLineMap) {
    return;
  }
  const codeOutput = getElement("code-output");
  const range = source ? (cachedLineMap.get(source.sourceIndex) ?? null) : null;
  highlightCodeLines(codeOutput, range);
}
