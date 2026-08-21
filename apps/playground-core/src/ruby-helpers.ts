import { Box, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "./config";
import type { RubyFrag } from "./types";

/** Ruby spans for the caption section. */
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

function rubyInsets(ruby: RubyFrag["ruby"]): {
  top: number;
  bottom: number;
  gap: number;
  over: boolean;
  fontSize: number;
} {
  if (!ruby) {
    return { top: 0, bottom: 0, gap: 0, over: true, fontSize: 7 };
  }
  const fontSize = ruby.style.fontSizePx;
  const gap = ruby.gapPx;
  const over = ruby.position !== "under";
  return { top: over ? fontSize + gap : 0, bottom: over ? 0 : fontSize + gap, gap, over, fontSize };
}

/** Render flow fragments with ruby support. */
export function renderRubyFlowFragments(
  children: VNode[],
  result: { lines: Array<{ fragments: Array<Record<string, unknown>> }> },
  fontSize: number,
  lineHeight: number,
  color: string,
  offsetX: number,
  offsetY: number,
): void {
  const lhPx = fontSize * lineHeight;
  for (const line of result.lines) {
    for (const frag of line.fragments as RubyFrag[]) {
      const fragFs = frag.style?.fontSizePx ?? fontSize;
      const fragColor = frag.style?.color ?? color;
      const rubyInset = rubyInsets(frag.ruby);
      const fragAscent = fragFs * 0.8;
      const yShift = (frag.baselineOffset ?? fragAscent) - fragAscent;

      const fragChildren: VNode[] = [
        Box(
          { position: "absolute", left: 0, top: rubyInset.top },
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
      ];
      if (frag.ruby) {
        fragChildren.unshift(
          Box(
            {
              position: "absolute",
              left: 0,
              top: rubyInset.over ? 0 : rubyInset.top + lhPx + rubyInset.gap,
            },
            Text(
              {
                font: FA,
                fontSizePx: rubyInset.fontSize,
                color: frag.ruby.style.color ?? "#94a3b8",
              },
              frag.ruby.text,
            ),
          ),
        );
      }
      children.push(
        Box(
          {
            position: "absolute",
            left: frag.x + offsetX,
            top: frag.y - rubyInset.top + yShift + offsetY,
            width: frag.availableInlineSizePx,
            height: rubyInset.top + lhPx + rubyInset.bottom,
            overflow: "clip",
          },
          ...fragChildren,
        ),
      );
    }
  }
}
