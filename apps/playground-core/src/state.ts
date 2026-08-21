import type { DebugOverlayConfig, DebugOverlayPart } from "@boundsvg/core";

export const coreState = {
  currentPresetKey: "",
  currentCodeTab: "source" as "source" | "svg",
  bboxOverlayParts: [] as DebugOverlayPart[],
  pngScale: 1,
  textPathMode: "merged" as "merged" | "glyphs",
  cachedSvgString: "",
  activeMouseCleanup: null as (() => void) | null,
  inspectHighlight: null as ((nodeId: string | null) => void) | null,
};

export function sanitizePngScale(value: number): 1 | 2 {
  return value <= 1 ? 1 : 2;
}

export function resolveDebugOverlayConfig(): false | DebugOverlayConfig {
  if (coreState.bboxOverlayParts.length === 0) {
    return false;
  }
  return { parts: coreState.bboxOverlayParts };
}
