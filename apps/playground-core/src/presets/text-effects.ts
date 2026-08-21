import { Box, Canvas, Flex, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

// Flat composition: the canvas itself is the "video frame" (gradient
// backdrop) and every telop sits directly on it with absolute positions.
// Every Text has an explicit width (a width-less Text in an auto-height
// column inflates the measured layout), and the fit sample is centered
// structurally (fixed-size row Flex) so it stays centered at whatever font
// size fit:shrink chooses.

const CANVAS_W = 920;
const CANVAS_H = 420;

const BAR_LEFT = 96;
const BAR_TOP = 188;
const BAR_WIDTH = 728;
const BAR_HEIGHT = 64;
const BAR_PADDING_X = 24;

function label(text: string, left: number, top: number, width: number): VNode {
  return Text(
    {
      font: FA,
      fontSizePx: 12,
      color: "#e2e8f0",
      opacity: 0.85,
      width,
      wrap: "none",
      position: "absolute",
      left,
      top,
    },
    text,
  );
}

function buildTextEffectsCanvas() {
  return Canvas(
    { width: CANVAS_W, height: CANVAS_H, background: "#0b1120" },
    // Video-frame backdrop
    Box({
      position: "absolute",
      left: 0,
      top: 0,
      width: CANVAS_W,
      height: CANVAS_H,
      background: "linear-gradient(135deg, #3e5c76, #4a4e69)",
    }),
    Box({
      position: "absolute",
      left: 610,
      top: -80,
      width: 340,
      height: 340,
      borderRadius: 999,
      background: "#ffffff",
      opacity: 0.07,
    }),
    Box({
      position: "absolute",
      left: -70,
      top: 210,
      width: 300,
      height: 300,
      borderRadius: 999,
      background: "#0b1120",
      opacity: 0.18,
    }),

    // A/B: the same word straight on the footage - multi-layer vs single
    Text(
      {
        font: FA,
        fontSizePx: 58,
        color: "#facc15",
        width: 300,
        wrap: "none",
        position: "absolute",
        left: 96,
        top: 56,
        textStrokes: [
          { color: "#1e293b", widthPx: 16 },
          { color: "#ffffff", widthPx: 8 },
        ],
        textShadows: [{ dx: 4, dy: 5, blurPx: 6, color: "#000000" }],
      },
      "OUTLINE",
    ),
    label("textStrokes x2 + textShadows - edges hold on busy footage", 96, 132, 400),
    Text(
      {
        font: FA,
        fontSizePx: 58,
        color: "#facc15",
        width: 300,
        wrap: "none",
        position: "absolute",
        left: 520,
        top: 56,
        textStroke: "#1e293b",
        textStrokeWidth: 8,
      },
      "OUTLINE",
    ),
    label("single textStroke - flat by comparison", 520, 132, 300),

    // Fit bar: bright base with real padding; the text is centered by a
    // fixed-size row Flex, so it stays centered at the shrunk font size.
    Box(
      {
        position: "absolute",
        left: BAR_LEFT,
        top: BAR_TOP,
        width: BAR_WIDTH,
        height: BAR_HEIGHT,
        borderRadius: 12,
        background: "linear-gradient(90deg, #f8fafc, #cbd5f5)",
        boxShadow: "0 6 18 0 rgba(2, 6, 23, 0.35)",
        padding: [0, BAR_PADDING_X, 0, BAR_PADDING_X],
      },
      Flex(
        {
          direction: "row",
          width: BAR_WIDTH - BAR_PADDING_X * 2,
          height: BAR_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
        },
        Text(
          {
            font: FA,
            fontSizePx: 44,
            color: "#0f172a",
            width: BAR_WIDTH - BAR_PADDING_X * 2,
            fit: "shrink",
            wrap: "none",
          },
          "fit:shrink - strokes and shadows never change layout metrics",
        ),
      ),
    ),
    label("bright base bar + padding, text shrinks to fit", 96, 260, 320),

    // Lower third: breaking-news chip + baseless multi-layer headline
    Box({
      position: "absolute",
      left: 96,
      top: 312,
      width: 152,
      height: 52,
      borderRadius: 8,
      background: "linear-gradient(180deg, #ef4444, #b91c1c)",
      boxShadow: "0 4 12 0 rgba(2, 6, 23, 0.4)",
    }),
    Text(
      {
        font: FA,
        fontSizePx: 22,
        color: "#ffffff",
        width: 120,
        wrap: "none",
        position: "absolute",
        left: 118,
        top: 326,
        textStroke: "#7f1d1d",
        textStrokeWidth: 3,
      },
      "BREAKING",
    ),
    Text(
      {
        font: FA,
        fontSizePx: 40,
        color: "#ffffff",
        width: 560,
        fit: "shrink",
        wrap: "none",
        position: "absolute",
        left: 268,
        top: 316,
        textStrokes: [
          { color: "#0f172a", widthPx: 12 },
          { color: "#38bdf8", widthPx: 5 },
        ],
        textShadows: [{ dx: 3, dy: 4, blurPx: 5, color: "#000000" }],
      },
      "Field Report - Shibuya, Tokyo",
    ),
  );
}

export const textEffectsPreset: Preset = {
  title: "Text Effects",
  description:
    "Telop typography straight on a video-style backdrop: multi-layer outlines (textStrokes, index 0 = outermost) + drop shadows (textShadows) vs a single stroke, a bright base bar with fit:shrink, and a breaking-news lower third. Effects are paint-only - layout metrics never change.",
  source: `import { Box, Canvas, Text } from "@boundsvg/core";

// Telops sit directly on footage - multi-layer outlines keep them readable
// without a base bar. Index 0 of textStrokes is the OUTERMOST layer.
const vnode = Canvas(
  { width: 920, height: 420, background: "linear-gradient(135deg, #3e5c76, #4a4e69)" },
  Text({
    font: "${FA}", fontSizePx: 58, color: "#facc15",
    width: 300, wrap: "none", position: "absolute", left: 96, top: 56,
    textStrokes: [
      { color: "#1e293b", widthPx: 16 },  // outer outline
      { color: "#ffffff", widthPx: 8 },   // inner rim
    ],
    textShadows: [{ dx: 4, dy: 5, blurPx: 6, color: "#000000" }],
  }, "OUTLINE"),
  // Single-layer comparison: flat by contrast
  Text({
    font: "${FA}", fontSizePx: 58, color: "#facc15",
    width: 300, wrap: "none", position: "absolute", left: 520, top: 56,
    textStroke: "#1e293b", textStrokeWidth: 8,
  }, "OUTLINE"),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildTextEffectsCanvas(),
};
