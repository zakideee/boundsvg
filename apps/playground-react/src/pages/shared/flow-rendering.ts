import { Box, Text, type VNode } from "@boundsvg/core";
import type { TextFlowFragment } from "@boundsvg/core/wasm";

/** Injected font alias used by the flow scene examples. */
export const FA = "NotoSansJP-woff2";

/** Format a measured dimension for a preview caption. */
export function formatPx(value: number): string {
  return `${value.toFixed(1)}px`;
}

/** Show recoverable measurement warnings alongside the preview. */
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

/** Approximate a plain-text measurement preview; Ruby scenes render authored content directly. */
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

/** Authored caption spans shared by measurement and the Text/Ruby scene. */
export const CAPTION_RUBY_SPANS = [
  { text: "春", rubyText: "はる", rubyFontSizePx: 7 },
  { text: "はあけぼの。" },
  { text: "白", rubyText: "しろ", rubyFontSizePx: 7 },
  { text: "くなりゆく" },
  { text: "山際", rubyText: "やまぎわ", rubyFontSizePx: 7 },
  { text: "、" },
  { text: "紫", rubyText: "むらさき", rubyFontSizePx: 7, color: "#a78bfa" },
  { text: "だちたる" },
  { text: "雲", rubyText: "くも", rubyFontSizePx: 7 },
  { text: "の" },
  { text: "細", rubyText: "ほそ", rubyFontSizePx: 7 },
  { text: "くたなびきたる。" },
  { text: "夏", rubyText: "なつ", rubyFontSizePx: 7 },
  { text: "は" },
  { text: "夜", rubyText: "よる", rubyFontSizePx: 7 },
  { text: "。" },
];

/** Render styled flow fragments with per-fragment font size, color, and baseline shift. */
export function renderStyledFlowFragments(
  children: VNode[],
  result: { lines: Array<{ fragments: Array<Record<string, unknown>> }> },
  defaultFs: number,
  defaultLh: number,
  defaultColor: string,
  offsetX = 0,
  offsetY = 0,
): void {
  const lhPx = defaultFs * defaultLh;
  for (const line of result.lines) {
    for (const frag of line.fragments as TextFlowFragment[]) {
      const fragFs = frag.style?.fontSizePx ?? defaultFs;
      const fragColor = frag.style?.color ?? defaultColor;
      const fragAscent = fragFs * 0.8;
      const yShift = (frag.baselineOffset ?? fragAscent) - fragAscent;
      children.push(
        Box(
          {
            position: "absolute",
            left: frag.x + offsetX,
            top: frag.y + yShift + offsetY,
            width: frag.availableInlineSizePx,
            height: lhPx,
            overflow: "clip",
          },
          Text(
            {
              font: FA,
              fontSizePx: fragFs,
              color: fragColor,
              language: "ja",
              wrap: "none",
              lineHeight: 1,
            },
            frag.text,
          ),
        ),
      );
    }
  }
}

/** Render vertical flow fragments using column width (fontSize * lineHeight) for the box width. */
export function renderVerticalColumnFragments(
  children: VNode[],
  result: { lines: Array<{ fragments: Array<Record<string, unknown>> }> },
  fontSize: number,
  lineHeight: number,
  color: string,
  offsetX = 0,
  offsetY = 0,
): void {
  const colW = fontSize * lineHeight;
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
            width: colW,
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
              writingMode: "vertical-rl",
              lineHeight: 1,
            },
            frag.text,
          ),
        ),
      );
    }
  }
}
