import { Box, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "./config";

/** Log flow layout warnings to console and return VNode for UI display. */
export function renderFlowWarnings(
  warnings: Array<{ code?: string; message?: string }> | undefined,
  x: number,
  y: number,
  label = "Rendering fallback active — see console",
): VNode[] {
  if (!warnings || warnings.length === 0) {
    return [];
  }
  for (const w of warnings) {
    console.warn(`[boundsvg] ${w.code}: ${w.message}`);
  }
  return [
    Box(
      {
        position: "absolute",
        left: x,
        top: y,
        width: 236,
        height: 14,
        padding: [1, 4, 1, 4],
        background: "#1a1a1a",
        borderColor: "#a16207",
        borderWidth: 1,
        borderRadius: 3,
      },
      Text({ font: FA, fontSizePx: 10, color: "#f59e0b", wrap: "none" }, label),
    ),
  ];
}

/** Render a flow layout result's fragments as absolute-positioned Box+Text nodes. */
export function renderFlowFragments(
  children: VNode[],
  result: { lines: Array<{ fragments: Array<Record<string, unknown>> }> },
  fontSize: number,
  lineHeight: number,
  color: string,
  offsetX = 0,
  offsetY = 0,
): void {
  const lhPx = fontSize * lineHeight;
  for (const line of result.lines) {
    for (const frag of line.fragments as Array<{
      text: string;
      x: number;
      y: number;
      availableInlineSizePx: number;
    }>) {
      children.push(
        Box(
          {
            position: "absolute",
            left: frag.x + offsetX,
            top: frag.y + offsetY,
            width: frag.availableInlineSizePx,
            height: lhPx,
            overflow: "clip",
          },
          Text(
            { font: FA, fontSizePx: fontSize, color, language: "ja", wrap: "none", lineHeight: 1 },
            frag.text,
          ),
        ),
      );
    }
  }
}

/**
 * Render vertical flow fragments as absolute-positioned Box+Text nodes.
 *
 * This is a **preview helper** that approximates fragment placement.
 * The box dimensions use column cross-axis size (fontSize * lineHeight) for width and
 * the region inline extent (frag.availableInlineSizePx) for height.
 */
export function renderVerticalFlowFragments(
  children: VNode[],
  result: { lines: Array<{ fragments: Array<Record<string, unknown>> }> },
  fontSize: number,
  lineHeight: number,
  color: string,
  offsetX = 0,
  offsetY = 0,
): void {
  const columnCrossSizePx = fontSize * lineHeight;
  for (const line of result.lines) {
    for (const frag of line.fragments as Array<{
      text: string;
      x: number;
      y: number;
      availableInlineSizePx: number;
    }>) {
      children.push(
        Box(
          {
            position: "absolute",
            left: frag.x + offsetX,
            top: frag.y + offsetY,
            width: columnCrossSizePx,
            height: frag.availableInlineSizePx,
            overflow: "clip",
          },
          Text(
            {
              font: FA,
              fontSizePx: fontSize,
              color,
              language: "ja",
              wrap: "none",
              lineHeight: 1,
              writingMode: "vertical-rl",
              textOrientation: "upright",
            },
            frag.text,
          ),
        ),
      );
    }
  }
}

export function formatPx(value: number): string {
  return `${value.toFixed(1)}px`;
}
