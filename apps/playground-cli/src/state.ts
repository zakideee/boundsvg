import type { IR } from "@boundsvg/core/scene";
import type { CodeTab, PresetDefinition } from "./types";

export const cliState = {
  currentCodeTab: "component" as CodeTab,
  cachedSvgString: "",
  cachedComponentCode: "",
  cachedSceneJson: "",
  cachedPngDataUrl: "",
  cachedRenderedTsx: "",
  cachedWarningCount: 0,
  cachedIR: null as IR | null,
  debounceTimer: null as ReturnType<typeof setTimeout> | null,
  presetSvgCache: new Map<string, string>(),
  pipelineRunToken: 0,
  activePresetForPreview: null as PresetDefinition | null,
  prevPngUrl: null as string | null,
  activeInspectCleanup: null as (() => void) | null,
  inspectHighlight: null as ((nodeId: string | null) => void) | null,
};
