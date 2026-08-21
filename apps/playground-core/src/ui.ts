import type { DebugOverlayPart, Engine } from "@boundsvg/core";
import { getElement } from "../../playground-shared/dom.js";
import { installPlaygroundLocatorCopy } from "../../playground-shared/locator-copy.js";
import { updateCodePanel } from "./code-panel";
import { DEFAULT_PRESET_KEY, PRESET_GROUPS, type PresetGroupDef } from "./presets/groups";
import { presets } from "./presets/index";
import { renderPreset } from "./rendering";
import { coreState, sanitizePngScale } from "./state";

function readBBoxOverlayParts(selector: string): DebugOverlayPart[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(selector))
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
    installPlaygroundLocatorCopy({ playground: "playground-core" });
  }
  // Preset navigation: category row + presets of the active category.
  // Each category remembers its last selected preset.
  const categoriesContainer = getElement("preset-categories");
  const presetsContainer = getElement("presets");
  const lastSelectedByGroup = new Map<string, string>();

  const renderPresetRow = (group: PresetGroupDef): void => {
    presetsContainer.innerHTML = "";
    for (const presetKey of group.presetKeys) {
      const preset = presets[presetKey];
      if (!preset) {
        continue;
      }
      const btn = document.createElement("button");
      btn.textContent = preset.title;
      btn.title = preset.description;
      btn.setAttribute("data-key", presetKey);
      btn.setAttribute("data-playground-locator-level", "sample");
      btn.setAttribute("data-playground-locator-segment", `Sample: ${preset.title} [${presetKey}]`);
      btn.addEventListener("click", () => selectPreset(group, presetKey));
      presetsContainer.appendChild(btn);
    }
  };

  const selectPreset = (group: PresetGroupDef, presetKey: string): void => {
    lastSelectedByGroup.set(group.key, presetKey);
    categoriesContainer.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-group") === group.key);
    });
    renderPresetRow(group);
    renderPreset(engine, presetKey);
  };

  for (const group of PRESET_GROUPS) {
    const btn = document.createElement("button");
    btn.textContent = group.label;
    btn.setAttribute("data-group", group.key);
    btn.setAttribute("data-playground-locator-level", "category");
    btn.setAttribute("data-playground-locator-segment", `Category: ${group.label} [${group.key}]`);
    btn.addEventListener("click", () => {
      const presetKey = lastSelectedByGroup.get(group.key) ?? group.presetKeys[0] ?? "";
      selectPreset(group, presetKey);
    });
    categoriesContainer.appendChild(btn);
  }

  // BBox overlay parts
  const bboxOverlaySelector = 'input[name="bbox-overlay-part"]';
  const bboxOverlaySummary = document.getElementById("bbox-overlay-summary") as HTMLElement;
  const syncBBoxOverlayParts = (): void => {
    coreState.bboxOverlayParts = readBBoxOverlayParts(bboxOverlaySelector);
    bboxOverlaySummary.textContent = formatBBoxOverlaySummary(coreState.bboxOverlayParts);
  };
  syncBBoxOverlayParts();
  document.querySelectorAll<HTMLInputElement>(bboxOverlaySelector).forEach((input) => {
    input.addEventListener("change", () => {
      syncBBoxOverlayParts();
      renderPreset(engine, coreState.currentPresetKey);
    });
  });
  const bboxOverlayMenu = bboxOverlaySummary.closest("details");
  document.addEventListener("pointerdown", (event) => {
    if (
      bboxOverlayMenu?.open &&
      event.target instanceof Node &&
      !bboxOverlayMenu.contains(event.target)
    ) {
      bboxOverlayMenu.open = false;
    }
  });

  // PNG scale
  const pngScaleSelect = document.getElementById("png-scale") as HTMLSelectElement;
  coreState.pngScale = sanitizePngScale(Number(pngScaleSelect.value) || 1);
  pngScaleSelect.addEventListener("change", () => {
    coreState.pngScale = sanitizePngScale(Number(pngScaleSelect.value) || 1);
    renderPreset(engine, coreState.currentPresetKey);
  });

  // Text rendering mode
  const textRenderingSelect = document.getElementById("text-rendering") as HTMLSelectElement;
  textRenderingSelect.addEventListener("change", () => {
    coreState.textPathMode = textRenderingSelect.value as "merged" | "glyphs";
    renderPreset(engine, coreState.currentPresetKey);
  });

  // Event log clear button
  getElement("event-log-clear").addEventListener("click", () => {
    getElement("event-log-entries").innerHTML = "";
  });

  // Code tabs
  document.querySelectorAll(".code-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      coreState.currentCodeTab = (tab as HTMLElement).dataset.tab as "source" | "svg";
      updateCodePanel();
    });
  });

  // Status
  getElement("status-dot").classList.add("ready");
  getElement("status-text").textContent = "Engine ready";

  // Render the default preset with its category active
  const defaultGroup =
    PRESET_GROUPS.find((group) => group.presetKeys.includes(DEFAULT_PRESET_KEY)) ??
    PRESET_GROUPS[0];
  if (defaultGroup) {
    selectPreset(defaultGroup, DEFAULT_PRESET_KEY);
  }
}
