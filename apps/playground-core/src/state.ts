import type { DebugOverlayConfig, DebugOverlayPart } from "@boundsvg/core";

import type { InspectHoverHandle } from "../../playground-shared/inspect-hover.js";
import { DEFAULT_INSPECTION_FRAME_MODE } from "../../playground-shared/inspection-frame.js";

/** Current scene, output options, and inspection handle for the preset UI. */
export const coreState = {
  currentPresetKey: "",
  currentCodeTab: "source" as "source" | "svg",
  bboxOverlayParts: [] as DebugOverlayPart[],
  pngScale: 1,
  textPathMode: "merged" as "merged" | "glyphs",
  cachedSvgString: "",
  activeMouseCleanup: null as (() => void) | null,
  inspectionMode: DEFAULT_INSPECTION_FRAME_MODE,
  showInspectionOrigin: false,
  inspectHandle: null as InspectHoverHandle | null,
};

/** Select one of the two supported PNG export scales. */
export function sanitizePngScale(value: number): 1 | 2 {
  return value <= 1 ? 1 : 2;
}

/** Resolve output debug parts independently of hover inspection. */
export function resolveDebugOverlayConfig(): false | DebugOverlayConfig {
  if (coreState.bboxOverlayParts.length === 0) {
    return false;
  }
  return { parts: coreState.bboxOverlayParts };
}
