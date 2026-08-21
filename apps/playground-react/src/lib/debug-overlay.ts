import type { DebugOverlayConfig, DebugOverlayPart } from "@boundsvg/react";

export const BBOX_OVERLAY_OPTIONS: Array<{ value: DebugOverlayPart; label: string }> = [
  { value: "specified", label: "node bounds" },
  { value: "layout", label: "text lines" },
  { value: "actual", label: "glyph bounds" },
  { value: "baseline", label: "baselines" },
];

export function resolveDebugOverlayConfig(
  parts: readonly DebugOverlayPart[],
): false | DebugOverlayConfig {
  if (parts.length === 0) {
    return false;
  }
  return { parts };
}

export function formatBBoxOverlaySummary(parts: readonly DebugOverlayPart[]): string {
  if (parts.length === 0) {
    return "off";
  }
  const labels = new Map(BBOX_OVERLAY_OPTIONS.map((option) => [option.value, option.label]));
  return parts.map((part) => labels.get(part) ?? part).join(", ");
}
