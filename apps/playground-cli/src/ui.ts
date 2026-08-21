import type { DebugOverlayPart, Engine } from "@boundsvg/core";
import { getElement } from "../../playground-shared/dom.js";
import { installPlaygroundLocatorCopy } from "../../playground-shared/locator-copy.js";
import { escapeHtml, updateCodePanel, updateSvgInputHighlight } from "./code-panel";
import { PRESET_GROUPS } from "./config";
import { resolvePresetSvg, runPipeline } from "./pipeline";
import { cliState } from "./state";
import type { PresetDefinition, PresetGroupDefinition, PresetSourceDefinition } from "./types";

function readBBoxOverlayParts(): DebugOverlayPart[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="opt-bbox-part"]'))
    .filter((input) => input.checked)
    .map((input) => input.value as DebugOverlayPart);
}

function formatBBoxOverlaySummary(parts: readonly DebugOverlayPart[]): string {
  if (parts.length === 0) {
    return "BBox Overlay: off";
  }
  const labels: Record<DebugOverlayPart, string> = {
    specified: "node",
    layout: "lines",
    actual: "glyph",
    baseline: "baseline",
  };
  return `BBox Overlay: ${parts.map((part) => labels[part]).join(", ")}`;
}

export function buildUI(engine: Engine): void {
  if (import.meta.env.DEV) {
    installPlaygroundLocatorCopy({ playground: "playground-cli" });
  }
  const svgInput = getElement<HTMLTextAreaElement>("svg-input");
  const presetGroupContainer = getElement("preset-groups");
  const presetSourceContainer = getElement("preset-sources");
  const presetsContainer = getElement("presets");
  const sourceMeta = getElement("source-meta");
  const statusDot = getElement("status-dot");
  const statusText = getElement("status-text");
  const previewOutput = getElement("preview-output");
  const warningsOutput = getElement("warnings-output");
  let presetLoadToken = 0;
  let activeGroupKey = PRESET_GROUPS[0]?.key ?? "";
  let activeSourceKey = PRESET_GROUPS[0]?.sources[0]?.key ?? "";
  let activePresetKey = PRESET_GROUPS[0]?.sources[0]?.presets[0]?.key ?? "";

  const setStatus = (state: "ready" | "loading" | "error", text: string) => {
    statusDot.classList.remove("ready", "loading", "error");
    statusDot.classList.add(state);
    statusText.textContent = text;
  };

  const setActiveButton = (selector: string, key: string) => {
    document.querySelectorAll(selector).forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-key") === key);
    });
  };

  const getGroup = (groupKey: string): PresetGroupDefinition | undefined =>
    PRESET_GROUPS.find((group) => group.key === groupKey);

  const getSource = (
    group: PresetGroupDefinition | undefined,
    sourceKey: string,
  ): PresetSourceDefinition | undefined =>
    group?.sources.find((source) => source.key === sourceKey);

  const getPreset = (
    source: PresetSourceDefinition | undefined,
    presetKey: string,
  ): PresetDefinition | undefined => source?.presets.find((preset) => preset.key === presetKey);

  const renderSourceMeta = (preset?: PresetDefinition) => {
    if (!preset || !preset.sourcePath) {
      sourceMeta.innerHTML = [
        '<span class="source-meta-tag">Built-in</span>',
        '<span class="source-meta-empty">Third-party metadata is shown only for imported presets</span>',
      ].join("");
      return;
    }

    const sourceLabel = preset.sourceLabel ?? "Third-party SVG";
    const license = preset.license ?? "Unknown";
    const sourcePath = preset.sourcePath;
    const fileName = sourcePath.split("/").at(-1) ?? sourcePath;

    sourceMeta.innerHTML = [
      `<span class="source-meta-tag">${escapeHtml(sourceLabel)}</span>`,
      `<span class="source-meta-item"><strong>File:</strong> ${escapeHtml(fileName)}</span>`,
      `<span class="source-meta-item"><strong>Path:</strong> ${escapeHtml(sourcePath)}</span>`,
      `<span class="source-meta-item"><strong>License:</strong> ${escapeHtml(license)}</span>`,
    ]
      .filter(Boolean)
      .join("");
  };

  const applyPreset = async (preset: PresetDefinition) => {
    const token = ++presetLoadToken;
    setActiveButton(".preset-group-nav button", activeGroupKey);
    setActiveButton(".preset-source-nav button", activeSourceKey);
    setActiveButton(".preset-nav button", activePresetKey);
    cliState.activePresetForPreview = preset;
    renderSourceMeta(preset);
    setStatus("loading", `Loading preset: ${preset.title}`);
    try {
      const svg = await resolvePresetSvg(preset);
      if (token !== presetLoadToken) {
        return;
      }
      svgInput.value = svg;
      updateSvgInputHighlight(svg);
      await runPipeline(engine, svg, setStatus);
    } catch (error) {
      if (token !== presetLoadToken) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      svgInput.value = "";
      updateSvgInputHighlight("");
      previewOutput.innerHTML = `<span style="color:#ef4444;font-size:12px">${escapeHtml(message)}</span>`;
      warningsOutput.innerHTML = `<div class="warning-entry">[PRESET_LOAD_ERROR] ${escapeHtml(message)}</div>`;
      cliState.cachedSvgString = "";
      cliState.cachedComponentCode = "";
      updateCodePanel();
      setStatus("error", "Preset load failed");
    }
  };

  const renderPresetButtons = (source: PresetSourceDefinition | undefined) => {
    presetsContainer.innerHTML = "";
    for (const preset of source?.presets ?? []) {
      const btn = document.createElement("button");
      btn.textContent = preset.title;
      btn.setAttribute("data-key", preset.key);
      btn.setAttribute("data-playground-locator-level", "sample");
      btn.setAttribute(
        "data-playground-locator-segment",
        `Sample: ${preset.title} [${preset.key}]`,
      );
      btn.addEventListener("click", () => {
        activePresetKey = preset.key;
        void applyPreset(preset);
      });
      presetsContainer.appendChild(btn);
    }
    setActiveButton(".preset-nav button", activePresetKey);
  };

  const renderSourceButtons = (group: PresetGroupDefinition | undefined) => {
    presetSourceContainer.innerHTML = "";
    for (const source of group?.sources ?? []) {
      const btn = document.createElement("button");
      btn.textContent = source.title;
      btn.setAttribute("data-key", source.key);
      btn.setAttribute("data-playground-locator-level", "source");
      btn.setAttribute(
        "data-playground-locator-segment",
        `Source: ${source.title} [${source.key}]`,
      );
      btn.addEventListener("click", () => {
        activeSourceKey = source.key;
        activePresetKey = source.presets[0]?.key ?? "";
        renderPresetButtons(source);
        const nextPreset = getPreset(source, activePresetKey);
        if (nextPreset) {
          void applyPreset(nextPreset);
        }
      });
      presetSourceContainer.appendChild(btn);
    }
    setActiveButton(".preset-source-nav button", activeSourceKey);
  };

  const renderGroupButtons = () => {
    presetGroupContainer.innerHTML = "";
    for (const group of PRESET_GROUPS) {
      const btn = document.createElement("button");
      btn.textContent = group.title;
      btn.setAttribute("data-key", group.key);
      btn.setAttribute("data-playground-locator-level", "category");
      btn.setAttribute(
        "data-playground-locator-segment",
        `Category: ${group.title} [${group.key}]`,
      );
      btn.addEventListener("click", () => {
        activeGroupKey = group.key;
        activeSourceKey = group.sources[0]?.key ?? "";
        const source = getSource(group, activeSourceKey);
        activePresetKey = source?.presets[0]?.key ?? "";
        renderSourceButtons(group);
        renderPresetButtons(source);
        const nextPreset = getPreset(source, activePresetKey);
        if (nextPreset) {
          void applyPreset(nextPreset);
        }
      });
      presetGroupContainer.appendChild(btn);
    }
    setActiveButton(".preset-group-nav button", activeGroupKey);
  };

  renderGroupButtons();
  const initialGroup = getGroup(activeGroupKey);
  renderSourceButtons(initialGroup);
  const initialSource = getSource(initialGroup, activeSourceKey);
  renderPresetButtons(initialSource);

  svgInput.addEventListener("input", () => {
    if (cliState.debounceTimer) {
      clearTimeout(cliState.debounceTimer);
    }
    cliState.debounceTimer = setTimeout(() => {
      setActiveButton(".preset-nav button", "");
      cliState.activePresetForPreview = null;
      renderSourceMeta();
      void runPipeline(engine, svgInput.value, setStatus);
    }, 300);
  });

  const rerun = () => {
    void runPipeline(engine, svgInput.value, setStatus);
  };
  getElement("opt-default-font").addEventListener("change", rerun);
  getElement("opt-font-map").addEventListener("change", rerun);
  getElement("opt-wrap").addEventListener("change", rerun);
  getElement("opt-fit").addEventListener("change", rerun);
  const bboxOverlaySummary = getElement("opt-bbox-summary");
  const syncBBoxOverlaySummary = (): void => {
    bboxOverlaySummary.textContent = formatBBoxOverlaySummary(readBBoxOverlayParts());
  };
  syncBBoxOverlaySummary();
  document.querySelectorAll<HTMLInputElement>('input[name="opt-bbox-part"]').forEach((input) => {
    input.addEventListener("change", () => {
      syncBBoxOverlaySummary();
      rerun();
    });
  });
  getElement("opt-png-scale").addEventListener("change", rerun);
  getElement("opt-text-rendering").addEventListener("change", rerun);

  document.querySelectorAll(".code-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      cliState.currentCodeTab = (tab as HTMLElement).dataset.tab as typeof cliState.currentCodeTab;
      updateCodePanel();
    });
  });

  const viewPanes = {
    input: getElement("view-input"),
    preview: getElement("view-preview"),
    warnings: getElement("view-warnings"),
  };
  for (const tab of document.querySelectorAll(".view-tab")) {
    tab.addEventListener("click", () => {
      const view = (tab as HTMLElement).dataset.view as keyof typeof viewPanes;
      for (const tabElement of document.querySelectorAll(".view-tab")) {
        tabElement.classList.remove("active");
      }
      tab.classList.add("active");
      for (const [key, pane] of Object.entries(viewPanes)) {
        pane.style.display = key === view ? "" : "none";
      }
    });
  }

  setStatus("ready", "Engine ready");

  const firstPreset = getPreset(initialSource, activePresetKey);
  if (firstPreset) {
    void applyPreset(firstPreset);
  } else {
    renderSourceMeta();
  }
}
