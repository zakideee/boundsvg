import { Box, Canvas, Flex, Inline, InlineBox, Rt, Ruby, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import { formatPx } from "../flow-helpers";
import type { Preset } from "../types";

export const measurementsPreset: Preset = {
  title: "Measurements",
  description:
    "measureTextBlock and measureIntrinsicInlineSize for horizontal, vertical, and rich text vertical modes.",
  source: `const verticalBlock = engine.measureTextBlock({
  text: "春はあけぼの。やうやう白くなりゆく山ぎは。",
  fontFamily: "${FA}",
  fontSizePx: 18,
  lineHeight: 1.45,
  language: "ja",
  wrap: "char",
  writingMode: "vertical-rl",
  textOrientation: "upright",
  maxHeight: 120,
});

const intrinsic = engine.measureIntrinsicInlineSize({
  text: "",
  fontFamily: "${FA}",
  fontSizePx: 18,
  writingMode: "vertical-rl",
  textOrientation: "upright",
  richText: [
    {
      kind: "ruby",
      style: {
        font: "${FA}",
        fontWeight: 400,
        fontStyle: "normal",
        color: "#f8fafc",
        fontSizePx: 18,
        lineHeight: 1.45,
        letterSpacingPx: 0,
        textOrientation: "upright",
      },
      base: [{ kind: "text", text: "春" }],
      rt: [{ kind: "span", text: "はる", style: { font: "${FA}", fontWeight: 400, fontStyle: "normal", color: "#fca5a5", fontSizePx: 9, lineHeight: 1, letterSpacingPx: 0, textOrientation: "upright" } }],
    },
    { kind: "combine", text: "2026", style: { font: "${FA}", fontWeight: 400, fontStyle: "normal", color: "#93c5fd", fontSizePx: 18, lineHeight: 1.45, letterSpacingPx: 0, textOrientation: "upright" } },
  ],
});`,
  build: (engine?) => {
    const canvasWidth = 960;
    const canvasHeight = 420;
    if (!engine) {
      return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" });
    }

    const sample = "春はあけぼの。やうやう白くなりゆく山ぎは。";
    const horizontalBlock = engine.measureTextBlock({
      text: sample,
      fontFamily: FA,
      fontSizePx: 18,
      lineHeight: 1.45,
      language: "ja",
      wrap: "char",
      maxWidth: 220,
    });
    const verticalBlock = engine.measureTextBlock({
      text: sample,
      fontFamily: FA,
      fontSizePx: 18,
      lineHeight: 1.45,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxHeight: 120,
    });
    const horizontalIntrinsic = engine.measureIntrinsicInlineSize({
      text: sample,
      fontFamily: FA,
      fontSizePx: 18,
      lineHeight: 1.45,
      language: "ja",
    });
    const verticalIntrinsic = engine.measureIntrinsicInlineSize({
      text: sample,
      fontFamily: FA,
      fontSizePx: 18,
      lineHeight: 1.45,
      language: "ja",
      writingMode: "vertical-rl",
      textOrientation: "upright",
    });
    const richStyle = {
      font: FA,
      fontWeight: 400,
      fontStyle: "normal" as const,
      color: "#f8fafc",
      fontSizePx: 18,
      lineHeight: 1.45,
      letterSpacingPx: 0,
      textOrientation: "upright" as const,
    };
    const richIntrinsicNodes = [
      {
        kind: "ruby" as const,
        style: richStyle,
        base: [{ kind: "text" as const, text: "春" }],
        rt: [{ kind: "span" as const, text: "はる", style: { ...richStyle, fontSizePx: 9 } }],
      },
      {
        kind: "text" as const,
        text: "は",
      },
      {
        kind: "combine" as const,
        text: "2026",
        style: { ...richStyle, color: "#93c5fd" },
      },
      {
        kind: "decoratedSpan" as const,
        style: { ...richStyle, color: "#fde68a" },
        children: [{ kind: "text" as const, text: "年" }],
        background: "#2d2d2d",
        borderColor: "#93c5fd",
        borderWidth: 1,
        borderRadius: [6, 6, 6, 6] as [number, number, number, number],
        paddingInline: [4, 4] as [number, number],
      },
      {
        kind: "text" as const,
        text: "の設計です。",
      },
    ];
    const richVerticalIntrinsic = engine.measureIntrinsicInlineSize({
      text: "",
      fontFamily: FA,
      fontSizePx: 18,
      lineHeight: 1.45,
      language: "ja",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      richText: richIntrinsicNodes,
    });
    const richPreview = engine.shrinkwrapText({
      text: "",
      fontFamily: FA,
      fontSizePx: 18,
      lineHeight: 1.45,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxWidth: 96,
      maxHeight: 220,
      minHeight: 48,
      richText: richIntrinsicNodes,
    });
    const richPreviewWidth =
      richPreview.status === "satisfied" ? (richPreview.usedWidth ?? 96) : 96;
    const richPreviewHeight =
      richPreview.status === "satisfied"
        ? (richPreview.chosenHeightPx ?? 220)
        : Math.min(richVerticalIntrinsic.maxContentInlineSize, 220);

    const children: VNode[] = [];
    children.push(
      Box(
        { position: "absolute", left: 24, top: 12 },
        Text({ font: FA, fontSizePx: 12, color: "#94a3b8" }, "measureTextBlock horizontal"),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 338, top: 12, width: 268 },
        Text(
          { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "none" },
          "measureTextBlock vertical-rl",
        ),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 652, top: 12, width: 270 },
        Text(
          { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "none" },
          "measureIntrinsicInlineSize",
        ),
      ),
    );
    children.push(
      Box({
        position: "absolute",
        left: 320,
        top: 28,
        width: 1,
        height: canvasHeight - 48,
        background: "#2d2d2d",
      }),
    );
    children.push(
      Box({
        position: "absolute",
        left: 634,
        top: 28,
        width: 1,
        height: canvasHeight - 48,
        background: "#2d2d2d",
      }),
    );

    children.push(
      Box(
        {
          position: "absolute",
          left: 24,
          top: 44,
          width: horizontalBlock.usedWidth + 16,
          height: horizontalBlock.usedHeight + 16,
          background: "#252526",
          borderColor: "#475569",
          borderWidth: 1,
          borderRadius: 12,
        },
        Flex(
          {
            direction: "row",
            width: horizontalBlock.usedWidth + 16,
            height: horizontalBlock.usedHeight + 16,
            padding: [8, 8, 8, 8],
          },
          Text(
            {
              font: FA,
              fontSizePx: 18,
              color: "#f8fafc",
              lineHeight: 1.45,
              wrap: "char",
              language: "ja",
              flexGrow: 1,
              preferredFrame: { w: horizontalBlock.usedWidth },
            },
            sample,
          ),
        ),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 24, top: 150 },
        Text(
          { font: FA, fontSizePx: 12, color: "#cbd5e1", wrap: "char" },
          `${formatPx(horizontalBlock.usedWidth)} × ${formatPx(horizontalBlock.usedHeight)} / ${horizontalBlock.lineCount} lines`,
        ),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 24, top: 172, width: 268 },
        Text(
          { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char", lineHeight: 1.5 },
          "Horizontal measurement uses maxWidth as the inline constraint and returns the resulting physical width and height.",
        ),
      ),
    );
    children.push(
      Box(
        {
          position: "absolute",
          left: 448 - (verticalBlock.usedWidth + 16) / 2,
          top: 44,
          width: verticalBlock.usedWidth + 16,
          height: verticalBlock.usedHeight + 16,
          background: "#252526",
          borderColor: "#475569",
          borderWidth: 1,
          borderRadius: 12,
        },
        Flex(
          {
            direction: "row",
            width: verticalBlock.usedWidth + 16,
            height: verticalBlock.usedHeight + 16,
            padding: [8, 8, 8, 8],
          },
          Text(
            {
              font: FA,
              fontSizePx: 18,
              color: "#fde68a",
              lineHeight: 1.45,
              wrap: "char",
              language: "ja",
              writingMode: "vertical-rl",
              textOrientation: "upright",
              flexGrow: 1,
              preferredFrame: { h: verticalBlock.usedHeight },
            },
            sample,
          ),
        ),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 338, top: 194, width: 268 },
        Text(
          { font: FA, fontSizePx: 12, color: "#cbd5e1", wrap: "none" },
          `${formatPx(verticalBlock.usedWidth)} × ${formatPx(verticalBlock.usedHeight)} / ${verticalBlock.lineCount} columns`,
        ),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 338, top: 216, width: 268 },
        Text(
          { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char", lineHeight: 1.5 },
          "Vertical measurement uses maxHeight as the inline constraint and continues into additional columns instead of reporting overflow.",
        ),
      ),
    );

    children.push(
      Box(
        { position: "absolute", left: 652, top: 44, width: 270 },
        Flex(
          { direction: "column", width: 270, gap: 10 },
          Text(
            { font: FA, fontSizePx: 12, color: "#f8fafc" },
            `plain horizontal: min ${formatPx(horizontalIntrinsic.minContentInlineSize)} / max ${formatPx(horizontalIntrinsic.maxContentInlineSize)}`,
          ),
          Text(
            { font: FA, fontSizePx: 12, color: "#fde68a" },
            `plain vertical: min ${formatPx(verticalIntrinsic.minContentInlineSize)} / max ${formatPx(verticalIntrinsic.maxContentInlineSize)}`,
          ),
          Text(
            { font: FA, fontSizePx: 12, color: "#93c5fd", wrap: "char" },
            `rich vertical: min ${formatPx(richVerticalIntrinsic.minContentInlineSize)} / max ${formatPx(richVerticalIntrinsic.maxContentInlineSize)}`,
          ),
          Box(
            {
              width: richPreviewWidth + 16,
              height: richPreviewHeight + 16,
              background: "#252526",
              borderColor: "#475569",
              borderWidth: 1,
              borderRadius: 12,
            },
            Flex(
              {
                direction: "row",
                width: richPreviewWidth + 16,
                height: richPreviewHeight + 16,
                padding: [8, 8, 8, 8],
              },
              Text(
                {
                  font: FA,
                  fontSizePx: 18,
                  color: "#f8fafc",
                  writingMode: "vertical-rl",
                  textOrientation: "upright",
                  lineHeight: 1.45,
                  wrap: "char",
                  language: "ja",
                  flexGrow: 1,
                  preferredFrame: { h: richPreviewHeight },
                },
                Ruby(
                  { rubyPosition: "over", rubyAlign: "center" },
                  "春",
                  Rt({ fontSizePx: 9, color: "#fca5a5" }, "はる"),
                ),
                "は",
                Inline({ textCombineUpright: "all", color: "#93c5fd" }, "2026"),
                InlineBox(
                  {
                    paddingInline: [4, 4],
                    background: "#2d2d2d",
                    borderColor: "#93c5fd",
                    borderWidth: 1,
                    borderRadius: 6,
                    color: "#fde68a",
                  },
                  "年",
                ),
                "の設計です。",
              ),
            ),
          ),
          Text(
            { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char", lineHeight: 1.5 },
            "Compare the same min/max inline-size contract across horizontal text, vertical text, and vertical rich text.",
          ),
        ),
      ),
    );

    return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" }, ...children);
  },
};
