import { createPngObjectUrl, revokePngObjectUrl } from "@boundsvg/browser/png";
import { type Engine, type RecoverableError, toSceneDocument } from "@boundsvg/core";
import { generatePlainSvgComponent, generateReactComponent } from "@boundsvg/core/codegen";
import { analyzeSvg, buildHybridVNode, inlineExternalImages } from "@boundsvg/core/svg";
import { getElement } from "../../playground-shared/dom.js";
import { escapeHtml, updateCodePanel } from "./code-panel";
import { FONT_ALIAS } from "./config";
import { buildThirdPartyDemoVNode } from "./demo-vnode";
import { getAnalyzeOptions, getRenderOptions } from "./options";
import { cliState } from "./state";
import type { PresetDefinition } from "./types";

export async function resolvePresetSvg(preset: PresetDefinition): Promise<string> {
  if (preset.svg) {
    return preset.svg;
  }
  if (!preset.svgUrl) {
    throw new Error("Preset SVG source is missing");
  }
  const cached = cliState.presetSvgCache.get(preset.svgUrl);
  if (cached) {
    return cached;
  }

  const response = await fetch(preset.svgUrl);
  if (!response.ok) {
    throw new Error(`Failed to load preset SVG: ${response.status} ${response.statusText}`);
  }
  const rawSvg = await response.text();

  const baseDir = preset.svgUrl.replace(/[^/]+$/, "");
  const { svg } = await inlineExternalImages(rawSvg, async (href) => {
    if (/^https?:\/\//i.test(href)) {
      return null;
    }
    const url = baseDir + href;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const mime = response.headers.get("content-type") ?? "application/octet-stream";
    return { data, mime };
  });

  cliState.presetSvgCache.set(preset.svgUrl, svg);
  return svg;
}

function lockHeight(element: HTMLElement): void {
  element.style.minHeight = `${element.offsetHeight}px`;
}

function unlockHeight(element: HTMLElement): void {
  element.style.minHeight = "";
}

function renderPanelMessage(container: HTMLElement, text: string): void {
  container.innerHTML = `<span class="panel-message">${escapeHtml(text)}</span>`;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function runPipeline(
  engine: Engine,
  svgString: string,
  setStatus: (state: "ready" | "loading" | "error", text: string) => void,
): Promise<void> {
  const runToken = ++cliState.pipelineRunToken;
  const previewOutput = getElement("preview-output");
  const warningsOutput = getElement("warnings-output");

  lockHeight(previewOutput);

  if (!svgString.trim()) {
    renderPanelMessage(previewOutput, "No SVG input");
    warningsOutput.innerHTML = '<span class="no-warnings">No warnings</span>';
    cliState.cachedSvgString = "";
    cliState.cachedComponentCode = "";
    cliState.cachedSceneJson = "";
    cliState.cachedPngDataUrl = "";
    cliState.cachedRenderedTsx = "";
    cliState.cachedWarningCount = 0;
    cliState.cachedIR = null;
    updateCodePanel();
    setStatus("ready", "Engine ready");
    unlockHeight(previewOutput);
    return;
  }

  cliState.cachedPngDataUrl = "";
  cliState.cachedRenderedTsx = "";
  if (cliState.currentCodeTab === "png" || cliState.currentCodeTab === "tsx") {
    updateCodePanel();
  }

  const allWarnings: RecoverableError[] = [];

  try {
    setStatus("loading", "Analyzing SVG…");
    renderPanelMessage(previewOutput, "Analyzing…");
    warningsOutput.innerHTML = '<span class="no-warnings">Processing warnings…</span>';
    await nextPaint();
    if (runToken !== cliState.pipelineRunToken) {
      return;
    }

    const options = getAnalyzeOptions();
    const analysis = analyzeSvg(svgString, options);
    allWarnings.push(...analysis.warnings);

    const { vnode, warnings: buildWarnings } = buildHybridVNode(analysis, options);
    allWarnings.push(...buildWarnings);

    const renderOpts = getRenderOptions();
    const compiled = engine.compile(vnode, {
      textPathMode: renderOpts.textPathMode,
    });
    const baseRenderedSvg = engine.renderCompiledToSvg(compiled, {
      debug: renderOpts.debug,
    });
    let displayVNode = vnode;
    let displayCompiled = compiled;
    let renderedSvg = baseRenderedSvg;
    if (cliState.activePresetForPreview?.sourcePath) {
      const previewVNode = buildThirdPartyDemoVNode(
        baseRenderedSvg,
        cliState.activePresetForPreview,
        svgString,
      );
      displayVNode = previewVNode;
      displayCompiled = engine.compile(previewVNode, {
        textPathMode: renderOpts.textPathMode,
      });
      renderedSvg = engine.renderCompiledToSvg(displayCompiled, {
        debug: renderOpts.debug,
      });
    }
    if (runToken !== cliState.pipelineRunToken) {
      return;
    }
    cliState.cachedSvgString = renderedSvg;
    cliState.cachedIR = displayCompiled.ir;

    const defaultFont =
      (document.getElementById("opt-default-font") as HTMLInputElement).value || FONT_ALIAS;
    cliState.cachedComponentCode = generateReactComponent(displayVNode, {
      componentName: "SvgComponent",
      renderer: "boundsvg",
      fonts: [
        {
          alias: defaultFont,
          weight: 400,
          style: "normal",
          source: "/fonts/NotoSansJP-Regular.subset.woff2",
        },
      ],
    });
    cliState.cachedSceneJson = JSON.stringify(toSceneDocument(displayVNode), null, 2);

    const tsxComponentName = (cliState.activePresetForPreview?.key ?? "input")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("");
    cliState.cachedRenderedTsx = generatePlainSvgComponent(baseRenderedSvg, {
      componentName: tsxComponentName || "SvgComponent",
    });

    updateCodePanel();

    setStatus("loading", "Rasterizing PNG…");
    previewOutput.innerHTML = renderedSvg;
    await nextPaint();
    if (runToken !== cliState.pipelineRunToken) {
      return;
    }

    if (cliState.prevPngUrl) {
      revokePngObjectUrl(cliState.prevPngUrl);
      cliState.prevPngUrl = null;
    }
    const pngBytes = engine.renderCompiledToPng(displayCompiled, {
      debug: renderOpts.debug,
      scale: renderOpts.scale,
    });
    const url = createPngObjectUrl(pngBytes);
    cliState.prevPngUrl = url;
    cliState.cachedPngDataUrl = url;
    const img = document.createElement("img");
    img.alt = "Rendered preview";
    img.onload = () => {
      if (runToken !== cliState.pipelineRunToken) {
        revokePngObjectUrl(url);
        return;
      }
      previewOutput.replaceChildren(img);
      unlockHeight(previewOutput);
      updateCodePanel();
      setStatus("ready", "Engine ready");
    };
    img.onerror = () => {
      if (runToken !== cliState.pipelineRunToken) {
        return;
      }
      unlockHeight(previewOutput);
      setStatus("error", "PNG rasterization failed — showing SVG preview");
    };
    img.src = url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    previewOutput.innerHTML = `<span style="color:#ef4444;font-size:12px">${escapeHtml(msg)}</span>`;
    cliState.cachedSvgString = "";
    cliState.cachedComponentCode = "";
    cliState.cachedSceneJson = "";
    cliState.cachedPngDataUrl = "";
    cliState.cachedRenderedTsx = "";
    cliState.cachedIR = null;
    updateCodePanel();
    setStatus("error", "Render failed");
    unlockHeight(previewOutput);
  }

  cliState.cachedWarningCount = allWarnings.length;
  if (allWarnings.length > 0) {
    warningsOutput.innerHTML = allWarnings
      .map(
        (w) => `<div class="warning-entry">[${escapeHtml(w.code)}] ${escapeHtml(w.message)}</div>`,
      )
      .join("");
  } else {
    warningsOutput.innerHTML = '<span class="no-warnings">No warnings</span>';
  }
}
