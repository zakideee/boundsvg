import { resolveHitTarget, translateSvgCoords } from "@boundsvg/browser";
import {
  buildInspectHitTestIndex,
  buildNodeTypeMap,
  type IR,
  inspectHitTestCandidates,
} from "@boundsvg/core/scene";
import Prism from "prismjs";
import {
  highlightCodeLines,
  wrapInLineElements,
} from "../../playground-shared/code-line-highlight.js";
import { getElement } from "../../playground-shared/dom.js";
import { escapeHtml, formatSvgCode } from "../../playground-shared/html-utils.js";
import { type InspectHitTestFn, setupInspectHover } from "../../playground-shared/inspect-hover.js";
import { getPrismGrammar } from "../../playground-shared/prism.js";
import { buildNodeLineMap, type NodeLineRange } from "../../playground-shared/svg-line-map.js";
import { FONT_ALIAS } from "./config";
import { cliState } from "./state";

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

export { escapeHtml };

export function updateSvgInputHighlight(svg: string): void {
  const highlightElement = document.querySelector("#svg-input-highlight code");
  if (!highlightElement) {
    return;
  }
  if (svg) {
    highlightElement.innerHTML = Prism.highlight(svg, getPrismGrammar("markup"), "markup");
  } else {
    highlightElement.innerHTML = '<span style="color:var(--muted)">No SVG input</span>';
  }
}

function getCliSharedOptions(): {
  defaultFont: string;
  fontMapRaw: string;
  wrap: string;
  fit: string;
  textPathMode: string;
  inputFile: string;
} {
  const defaultFont =
    (document.getElementById("opt-default-font") as HTMLInputElement).value || FONT_ALIAS;
  const fontMapRaw = (document.getElementById("opt-font-map") as HTMLInputElement).value.trim();
  const wrap = (document.getElementById("opt-wrap") as HTMLSelectElement).value;
  const fit = (document.getElementById("opt-fit") as HTMLSelectElement).value;
  const textPathMode = (document.getElementById("opt-text-rendering") as HTMLSelectElement).value;
  const presetKey = cliState.activePresetForPreview?.key ?? "input";
  const inputFile = `${presetKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.svg`;
  return { defaultFont, fontMapRaw, wrap, fit, textPathMode, inputFile };
}

function appendFontMapArgs(parts: string[], fontMapRaw: string): void {
  if (!fontMapRaw) {
    return;
  }
  for (const pair of fontMapRaw.split(",")) {
    const [cssName, alias] = pair.split(":").map((part) => part.trim());
    if (cssName && alias) {
      parts.push(`--font-map "${cssName}=${alias}"`);
    }
  }
}

function buildTerminalShell(
  highlighted: string,
  outputLines: string[],
  noteLines: string[],
): string {
  return `<div class="cli-terminal">
  <div class="cli-terminal-titlebar">
    <span class="cli-terminal-dot red"></span>
    <span class="cli-terminal-dot yellow"></span>
    <span class="cli-terminal-dot green"></span>
  </div>
  <div><span class="cli-terminal-prompt">$ </span>${highlighted}</div>
  <div class="cli-terminal-output">${outputLines.join("\n")}</div>
  <div class="cli-terminal-note">${noteLines.join("\n")}</div>
</div>`;
}

// ---------------------------------------------------------------------------
// Shared utilities for CLI terminal panel rendering
// ---------------------------------------------------------------------------

type CliCommandConfig = {
  command: "convert" | "export";
  inputFile: string;
  defaultFont: string;
  fontMapRaw: string;
  formatFlag?: string;
  fontSourceLine?: string;
  extraParts?: string[];
  includeTextPathMode?: boolean;
  wrap: string;
  fit: string;
  textPathMode: string;
};

function assembleCliParts(config: CliCommandConfig): string[] {
  const parts = [
    `boundsvg ${config.command}`,
    `--input ${config.inputFile}`,
    `--default-font ${config.defaultFont}`,
  ];
  if (config.fontSourceLine) {
    parts.push(config.fontSourceLine);
  }
  if (config.formatFlag) {
    parts.push(config.formatFlag);
  }
  if (config.extraParts) {
    parts.push(...config.extraParts);
  }
  appendFontMapArgs(parts, config.fontMapRaw);
  if (config.wrap !== "word") {
    parts.push(`--wrap ${config.wrap}`);
  }
  if (config.fit !== "shrink") {
    parts.push(`--fit ${config.fit}`);
  }
  if (config.includeTextPathMode !== false && config.textPathMode !== "merged") {
    parts.push(`--text-path-mode ${config.textPathMode}`);
  }
  return parts;
}

function highlightAndRenderShell(config: {
  parts: string[];
  outputVerb: "Converted" | "Exported";
  outputFile: string;
  noteLines: string[];
}): string {
  const cmd = config.parts.join(" \\\n  ");
  const highlighted = Prism.highlight(cmd, getPrismGrammar("bash"), "bash");
  const outputLines = [
    `<span class="success">${config.outputVerb}: ${escapeHtml(config.outputFile)}</span>`,
  ];
  if (cliState.cachedWarningCount > 0) {
    outputLines.push(
      `<span class="warn">${cliState.cachedWarningCount} warning(s) emitted. Use --verbose to see details.</span>`,
    );
  }
  return buildTerminalShell(highlighted, outputLines, config.noteLines);
}

// ---------------------------------------------------------------------------
// Tab-specific terminal builders (thin wrappers)
// ---------------------------------------------------------------------------

function buildCodegenTerminalHtml(): string {
  const { defaultFont, fontMapRaw, wrap, fit, textPathMode, inputFile } = getCliSharedOptions();
  const outputFile = inputFile.replace(/\.svg$/i, ".tsx");
  const componentName = (cliState.activePresetForPreview?.key ?? "input")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");

  const parts = assembleCliParts({
    command: "convert",
    inputFile,
    defaultFont,
    fontMapRaw,
    wrap,
    fit,
    textPathMode,
  });

  return highlightAndRenderShell({
    parts,
    outputVerb: "Converted",
    outputFile,
    noteLines: [
      `Output file contains a React component named "${escapeHtml(componentName)}" (or the --name value).`,
      `Use --format scene to output a SceneDocument JSON file instead.`,
      `To control renderer options, use --renderer png-hook --png-scale N --text-path-mode MODE.`,
    ],
  });
}

function buildSceneTerminalHtml(): string {
  const { defaultFont, fontMapRaw, wrap, fit, inputFile } = getCliSharedOptions();
  const outputFile = inputFile.replace(/\.svg$/i, ".scene.json");

  const parts = assembleCliParts({
    command: "convert",
    inputFile,
    defaultFont,
    fontMapRaw,
    wrap,
    fit,
    textPathMode: "",
    formatFlag: "--format scene",
    includeTextPathMode: false,
  });

  return highlightAndRenderShell({
    parts,
    outputVerb: "Converted",
    outputFile,
    noteLines: [
      `SceneDocument is a typed JSON representation of the VNode tree.`,
      `Convert back to component: boundsvg convert --input ${escapeHtml(outputFile)}`,
      `Export to static output: boundsvg export --input ${escapeHtml(outputFile)} --font ...`,
    ],
  });
}

function buildRenderTerminalHtml(): string {
  const { defaultFont, fontMapRaw, wrap, fit, textPathMode, inputFile } = getCliSharedOptions();
  const outputFile = inputFile.replace(/\.svg$/i, ".rendered.svg");

  const parts = assembleCliParts({
    command: "export",
    inputFile,
    defaultFont,
    fontMapRaw,
    wrap,
    fit,
    textPathMode,
    fontSourceLine: `--font ${defaultFont}:400:normal:./fonts/${defaultFont}.woff2`,
    formatFlag: "--format svg",
  });

  return highlightAndRenderShell({
    parts,
    outputVerb: "Exported",
    outputFile,
    noteLines: [
      `Use --format png --scale N to output PNG instead.`,
      `SceneDocument JSON can also be used as input: boundsvg export --input card.scene.json --font ...`,
    ],
  });
}

function buildPngRenderTerminalHtml(): string {
  const { defaultFont, fontMapRaw, wrap, fit, textPathMode, inputFile } = getCliSharedOptions();
  const scaleRaw = Number((document.getElementById("opt-png-scale") as HTMLSelectElement).value);
  const pngScale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 2;
  const outputFile = inputFile.replace(/\.svg$/i, ".png");

  const parts = assembleCliParts({
    command: "export",
    inputFile,
    defaultFont,
    fontMapRaw,
    wrap,
    fit,
    textPathMode,
    fontSourceLine: `--font ${defaultFont}:400:normal:./fonts/${defaultFont}.woff2`,
    formatFlag: "--format png",
    extraParts: [`--scale ${pngScale}`],
  });

  return highlightAndRenderShell({
    parts,
    outputVerb: "Exported",
    outputFile,
    noteLines: [
      `Use --scale to control output resolution (default: 2).`,
      `Use --format svg to output SVG instead.`,
    ],
  });
}

function buildRenderTsxTerminalHtml(): string {
  const { defaultFont, fontMapRaw, wrap, fit, textPathMode, inputFile } = getCliSharedOptions();
  const outputFile = inputFile.replace(/\.svg$/i, ".tsx");

  const parts = assembleCliParts({
    command: "export",
    inputFile,
    defaultFont,
    fontMapRaw,
    wrap,
    fit,
    textPathMode,
    fontSourceLine: `--font ${defaultFont}:400:normal:./fonts/${defaultFont}.woff2`,
    formatFlag: "--format static-component",
  });

  return highlightAndRenderShell({
    parts,
    outputVerb: "Exported",
    outputFile,
    noteLines: [
      `Output is a plain React component with zero @boundsvg runtime dependency.`,
      `Text is baked as glyph &lt;path&gt; outlines. Use --name to set the component name.`,
    ],
  });
}

function updateCliPanel(): void {
  const cliPanel = getElement("cli-panel");
  if (cliState.currentCodeTab === "svg") {
    cliPanel.innerHTML = buildRenderTerminalHtml();
  } else if (cliState.currentCodeTab === "png") {
    cliPanel.innerHTML = buildPngRenderTerminalHtml();
  } else if (cliState.currentCodeTab === "tsx") {
    cliPanel.innerHTML = buildRenderTsxTerminalHtml();
  } else if (cliState.currentCodeTab === "scene") {
    cliPanel.innerHTML = buildSceneTerminalHtml();
  } else {
    cliPanel.innerHTML = buildCodegenTerminalHtml();
  }
}

// ---------------------------------------------------------------------------
// SVG source line map cache
// ---------------------------------------------------------------------------

let cachedLineMap: Map<string, NodeLineRange> | null = null;

/** Reverse map: line number → nodeId (for code→SVG hover). */
let cachedLineToNodeMap: Map<number, string> | null = null;

/** Cleanup for code-line hover listeners. */
let codeHoverCleanup: (() => void) | null = null;

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
      cliState.inspectHighlight?.(nodeId);
    } else {
      highlightCodeLines(codeOutput, null);
      cliState.inspectHighlight?.(null);
    }
  };

  const onMouseLeave = (): void => {
    highlightCodeLines(codeOutput, null);
    cliState.inspectHighlight?.(null);
  };

  codeOutput.addEventListener("mouseover", onMouseOver);
  codeOutput.addEventListener("mouseleave", onMouseLeave);

  return () => {
    codeOutput.removeEventListener("mouseover", onMouseOver);
    codeOutput.removeEventListener("mouseleave", onMouseLeave);
  };
}

function renderCodeTabContent(codeOutput: HTMLElement): void {
  const noOutput = '<span style="color:var(--muted)">No output</span>';

  switch (cliState.currentCodeTab) {
    case "component":
      cachedLineMap = null;
      cachedLineToNodeMap = null;
      codeOutput.innerHTML = cliState.cachedComponentCode
        ? Prism.highlight(cliState.cachedComponentCode, getPrismGrammar("typescript"), "typescript")
        : noOutput;
      break;
    case "scene":
      cachedLineMap = null;
      cachedLineToNodeMap = null;
      codeOutput.innerHTML = cliState.cachedSceneJson
        ? Prism.highlight(cliState.cachedSceneJson, getPrismGrammar("typescript"), "json")
        : noOutput;
      break;
    case "svg": {
      if (cliState.cachedSvgString) {
        const formatted = formatSvgCode(cliState.cachedSvgString);
        cachedLineMap = buildNodeLineMap(formatted);
        cachedLineToNodeMap = buildLineToNodeMap(cachedLineMap);
        const highlighted = Prism.highlight(formatted, getPrismGrammar("markup"), "markup");
        codeOutput.innerHTML = wrapInLineElements(highlighted);
        codeHoverCleanup = setupCodeLineHover(codeOutput);
      } else {
        cachedLineMap = null;
        cachedLineToNodeMap = null;
        codeOutput.innerHTML = noOutput;
      }
      break;
    }
    case "tsx":
      cachedLineMap = null;
      cachedLineToNodeMap = null;
      codeOutput.innerHTML = cliState.cachedRenderedTsx
        ? Prism.highlight(cliState.cachedRenderedTsx, getPrismGrammar("typescript"), "typescript")
        : noOutput;
      break;
    case "png": {
      cachedLineMap = null;
      cachedLineToNodeMap = null;
      if (cliState.cachedPngDataUrl) {
        codeOutput.innerHTML = `<img src="${cliState.cachedPngDataUrl}" alt="Rendered PNG" style="max-width:100%;height:auto;display:block;margin:0 auto;" />`;
      } else {
        const svgInput = document.getElementById("svg-input") as HTMLTextAreaElement;
        const hasInput = svgInput && svgInput.value.trim().length > 0;
        codeOutput.innerHTML = hasInput
          ? '<span style="color:var(--muted)">Rendering…</span>'
          : noOutput;
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Inspect hover for SVG tab preview
// ---------------------------------------------------------------------------

function updatePreviewForSvgTab(): void {
  // Clean up previous inspect hover
  if (cliState.activeInspectCleanup) {
    cliState.activeInspectCleanup();
    cliState.activeInspectCleanup = null;
  }

  const previewOutput = getElement("preview-output");

  if (cliState.currentCodeTab === "svg" && cliState.cachedSvgString && cliState.cachedIR) {
    // Show SVG preview instead of PNG for hover support
    previewOutput.innerHTML = cliState.cachedSvgString;
    const handle = setupInspectHover(
      previewOutput,
      cliState.cachedIR,
      createHitTester(cliState.cachedIR),
      highlightSvgSourceLine,
    );
    cliState.activeInspectCleanup = () => {
      handle.cleanup();
      cliState.inspectHighlight = null;
    };
    cliState.inspectHighlight = handle.highlight;
  } else if (cliState.cachedPngDataUrl) {
    // Restore PNG preview
    const existingImg = previewOutput.querySelector("img");
    if (!existingImg) {
      previewOutput.innerHTML = `<img src="${cliState.cachedPngDataUrl}" alt="Rendered preview" />`;
    }
  }
}

function highlightSvgSourceLine(nodeId: string | null): void {
  if (cliState.currentCodeTab !== "svg" || !cachedLineMap) {
    return;
  }
  const codeOutput = getElement("code-output");
  const range = nodeId ? (cachedLineMap.get(nodeId) ?? null) : null;
  highlightCodeLines(codeOutput, range);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function updateCodePanel(): void {
  // Clean up previous code hover listeners
  if (codeHoverCleanup) {
    codeHoverCleanup();
    codeHoverCleanup = null;
  }

  const codeOutput = getElement("code-output");

  document.querySelectorAll(".code-tab").forEach((tab) => {
    const tabElement = tab as HTMLElement;
    tabElement.classList.toggle("active", tabElement.dataset.tab === cliState.currentCodeTab);
  });

  renderCodeTabContent(codeOutput);
  updateCliPanel();
  updatePreviewForSvgTab();
}
