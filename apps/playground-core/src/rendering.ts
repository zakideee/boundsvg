import { resolveHitTarget, translateSvgCoords } from "@boundsvg/browser";
import { createPngObjectUrl } from "@boundsvg/browser/png";
import type { Engine } from "@boundsvg/core";
import {
  buildHandlerMap,
  buildHitTestIndex,
  buildInspectHitTestIndex,
  buildNodeTypeMap,
  type IR,
  inspectHitTestCandidates,
} from "@boundsvg/core/scene";
import { getElement } from "../../playground-shared/dom.js";
import { escapeHtml } from "../../playground-shared/html-utils.js";
import {
  type EventEffectOverlayDisplayOptions,
  type InspectHitTestFn,
  setupInspectHover,
} from "../../playground-shared/inspect-hover.js";
import { highlightSvgSourceLine, updateCodePanel } from "./code-panel";
import { setupFlowDrag } from "./drag";
import { setExportSource } from "./export-actions";
import { setupMouseEvents } from "./mouse-events";
import { presets } from "./presets/index";
import { coreState, resolveDebugOverlayConfig } from "./state";
import type { Preset } from "./types";

function resolveOverlayDisplay(key: string): EventEffectOverlayDisplayOptions {
  if (key === "transform") {
    return { mode: "all", showOrigin: true };
  }
  return { mode: "layout", showOrigin: false };
}

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

function setupFlowDragWithInspect(
  container: HTMLElement,
  presetKey: string,
  engine: Engine,
  initialIr: IR,
  display: EventEffectOverlayDisplayOptions,
): () => void {
  let handle = setupInspectHover(
    container,
    initialIr,
    createHitTester(initialIr),
    highlightSvgSourceLine,
    display,
  );
  coreState.inspectHighlight = handle.highlight;

  const onPostRender = (ir: IR): void => {
    // Old overlay/listeners were destroyed by innerHTML; set up fresh ones.
    handle = setupInspectHover(container, ir, createHitTester(ir), highlightSvgSourceLine, display);
    coreState.inspectHighlight = handle.highlight;
  };

  const dragCleanup = setupFlowDrag(container, presetKey, engine, onPostRender);

  return () => {
    handle.cleanup();
    dragCleanup();
    coreState.inspectHighlight = null;
  };
}

export function renderPreset(engine: Engine, key: string): void {
  const preset = presets[key];
  if (!preset) {
    return;
  }

  // Clean up previous mouse event listeners
  if (coreState.activeMouseCleanup) {
    coreState.activeMouseCleanup();
    coreState.activeMouseCleanup = null;
  }

  if (key === "layered") {
    renderLayeredPreset(engine, preset);
    return;
  }

  coreState.currentPresetKey = key;
  const vnode = preset.build(engine);
  const options = {
    debug: resolveDebugOverlayConfig(),
    textPathMode: coreState.textPathMode,
    showMissingGlyphs: true,
  };
  const svgOptions = { ...options, nodeIdMetadata: "include" as const };
  const svgOutput = getElement("svg-output");
  const eventLogPanel = getElement("event-log");

  // Always get IR for inspect-hover support
  const { svg, ir } =
    preset.animationDurationMs === undefined
      ? engine.renderToSvgAndIR(vnode, svgOptions)
      : engine.renderToAnimatedSvgAndIR(vnode, {
          ...svgOptions,
          playback: { mode: "independent" },
        });
  coreState.cachedSvgString = svg;
  svgOutput.innerHTML = svg;

  if (key === "mouse") {
    // Build spatial index and handler map
    const index = buildHitTestIndex(ir);
    const handlerMap = buildHandlerMap(ir);

    // Setup event listeners (includes its own overlay + hover glow)
    coreState.activeMouseCleanup = setupMouseEvents(svgOutput, ir, index, handlerMap);

    // Show event log panel
    eventLogPanel.style.display = "block";
  } else {
    // Hide event log panel
    eventLogPanel.style.display = "none";

    const display = resolveOverlayDisplay(key);
    if (key === "text-flow" || key === "flow-rich") {
      // Flow presets: drag + inspect hover with drag-aware reconstruction
      coreState.activeMouseCleanup = setupFlowDragWithInspect(svgOutput, key, engine, ir, display);
    } else {
      // All other presets: inspect hover with SVG source sync
      const handle = setupInspectHover(
        svgOutput,
        ir,
        createHitTester(ir),
        highlightSvgSourceLine,
        display,
      );
      coreState.inspectHighlight = handle.highlight;
      coreState.activeMouseCleanup = () => {
        handle.cleanup();
        coreState.inspectHighlight = null;
      };
    }
  }

  // PNG
  const pngOutput = getElement("png-output");
  const pngOpts = {
    ...options,
    ...(coreState.pngScale > 1 && { scale: coreState.pngScale }),
    ...(preset.animationDurationMs !== undefined && { timeMs: 0 }),
  };
  const pngBytes = engine.renderToPng(vnode, pngOpts);
  const url = createPngObjectUrl(pngBytes);
  pngOutput.innerHTML = "";
  const img = document.createElement("img");
  img.src = url;
  img.alt = preset.title;
  pngOutput.appendChild(img);

  setExportSource(engine, key, preset);

  // Active button
  document.querySelectorAll(".preset-nav button").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-key") === key);
  });

  // Description
  getElement("preset-desc").textContent = preset.description;

  // Code
  updateCodePanel();
}

function renderLayeredPreset(engine: Engine, preset: Preset): void {
  coreState.currentPresetKey = "layered";
  coreState.inspectHighlight = null;

  const vnode = preset.build(engine);
  const options = {
    debug: resolveDebugOverlayConfig(),
    textPathMode: coreState.textPathMode,
    showMissingGlyphs: true,
  };
  const pngOpts = coreState.pngScale > 1 ? { ...options, scale: coreState.pngScale } : options;

  const { svg: singleSvg, ir: singleIr } = engine.renderToSvgAndIR(vnode, options);
  const singlePngBytes = engine.renderToPng(vnode, pngOpts);
  const layeredSvg = engine.renderToLayeredSvg(vnode, options);
  const layeredPng = engine.renderToLayeredPng(vnode, pngOpts);
  coreState.cachedSvgString = singleSvg;

  const sortedSvgLayers = [...layeredSvg.layers].sort((a, b) => a.paintOrder - b.paintOrder);
  const sortedPngLayers = [...layeredPng.layers].sort((a, b) => a.paintOrder - b.paintOrder);
  const singlePngUrl = createPngObjectUrl(singlePngBytes);
  const layerPngUrls = sortedPngLayers.map((layer) => createPngObjectUrl(layer.png));

  const svgStackSize = `width:${layeredSvg.width}px;height:${layeredSvg.height}px;`;
  const pngStackSize = `width:${layeredPng.width}px;height:${layeredPng.height}px;`;

  setExportSource(engine, "layered", preset);

  const svgOutput = getElement("svg-output");
  svgOutput.innerHTML = `
    <div class="layered-output-row">
      <div class="layered-cell">
        <h4>Single SVG</h4>
        <div class="layered-cell-body" id="layered-single-svg" style="${svgStackSize}">${singleSvg}</div>
      </div>
      <div class="layered-cell">
        <h4>Stacked SVG</h4>
        <div class="layered-stack" style="${svgStackSize}">
          ${sortedSvgLayers
            .map(
              (layer, i) =>
                `<div class="layered-stack-item" style="--layered-i:${i};" title="${escapeHtml(layer.id)}">${layer.svg}</div>`,
            )
            .join("")}
        </div>
      </div>
    </div>`;

  // Inspect hover on the Single SVG cell (layout bbox). Stacked SVG keeps
  // its own CSS-only diagonal shift interaction.
  const singleCell = getElement("layered-single-svg");
  const inspectHandle = setupInspectHover(
    singleCell,
    singleIr,
    createHitTester(singleIr),
    highlightSvgSourceLine,
    resolveOverlayDisplay("layered"),
  );
  coreState.inspectHighlight = inspectHandle.highlight;
  coreState.activeMouseCleanup = () => {
    inspectHandle.cleanup();
    coreState.inspectHighlight = null;
  };

  const pngOutput = getElement("png-output");
  pngOutput.innerHTML = `
    <div class="layered-output-row">
      <div class="layered-cell">
        <h4>Single PNG</h4>
        <div class="layered-cell-body" style="${pngStackSize}">
          <img alt="${escapeHtml(preset.title)}" src="${singlePngUrl}" />
        </div>
      </div>
      <div class="layered-cell">
        <h4>Stacked PNG</h4>
        <div class="layered-stack" style="${pngStackSize}">
          ${sortedPngLayers
            .map(
              (layer, i) =>
                `<img class="layered-stack-item" style="--layered-i:${i};" alt="" title="${escapeHtml(layer.id)}" src="${layerPngUrls[i]}" />`,
            )
            .join("")}
        </div>
      </div>
    </div>`;

  getElement("event-log").style.display = "none";

  document.querySelectorAll(".preset-nav button").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-key") === "layered");
  });
  getElement("preset-desc").textContent = preset.description;

  updateCodePanel();
}
