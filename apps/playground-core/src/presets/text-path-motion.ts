import { Box, Canvas, type Engine, Flex, Path, Text, TextOnPath, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA, JETBRAINS_ALIAS } from "../config";
import type { Preset } from "../types";

type MotionFrame = {
  timeMs: number;
  d: string;
  startOffsetPx: number;
  label: string;
  color: string;
};

const UNIT_ANIMATION = {
  by: "cluster",
  animation: {
    keyframes: [
      { at: 0, opacity: 0.3, transform: { translateY: 8, scaleX: 0.9, scaleY: 0.9 } },
      { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
    ],
    durationMs: 500,
    easing: "ease-out",
    fill: "both",
  },
  delayStepMs: 18,
  order: "logical",
} as const;

const MOTION_FRAMES: readonly MotionFrame[] = [
  {
    timeMs: 0,
    d: "M16 110L264 110",
    startOffsetPx: 76,
    label: "straight",
    color: "#67e8f9",
  },
  {
    timeMs: 400,
    d: "M16 146C70 24 210 24 264 146",
    startOffsetPx: 142,
    label: "cubic",
    color: "#fde68a",
  },
  {
    timeMs: 800,
    d: "M264 120A124 68 0 0 0 16 120",
    startOffsetPx: 194,
    label: "reverse arc",
    color: "#a5f3fc",
  },
];

function motionContent(frame: MotionFrame, left: number, top: number, nodeId: string): VNode[] {
  return [
    Path({
      id: `${nodeId}-guide`,
      position: "absolute",
      left,
      top,
      d: frame.d,
      width: 280,
      height: 180,
      fill: "none",
      stroke: "#64748b",
      strokeWidth: 1,
      strokeDasharray: "5,5",
    }),
    TextOnPath(
      {
        id: nodeId,
        position: "absolute",
        left,
        top,
        d: frame.d,
        width: 280,
        height: 180,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 23,
        color: frame.color,
        startOffsetPx: frame.startOffsetPx,
        textAnchor: "middle",
        pathNormal: "right",
        pathOffsetPx: 4,
        pathOverflow: "error",
        textStroke: "#0f172a",
        textStrokeWidth: 2,
        animateUnits: UNIT_ANIMATION,
      },
      "字幕 Motion",
    ),
  ];
}

function previewScene(frame: MotionFrame): VNode {
  return Canvas(
    { width: 280, height: 180, background: "#102a43" },
    ...motionContent(frame, 0, 0, "materialized-path"),
  );
}

function measureSvgBytes(engine: Engine | undefined, frame: MotionFrame): number {
  if (!engine) {
    return 0;
  }
  const svg = engine.renderToSvg(previewScene(frame), {
    timeMs: frame.timeMs,
  });
  return new TextEncoder().encode(svg).byteLength;
}

function motionCard(frame: MotionFrame, svgBytes: number, left: number, index: number): VNode[] {
  return [
    Box({
      position: "absolute",
      left,
      top: 88,
      width: 280,
      height: 238,
      background: "#102a43",
      borderColor: "#1e3a5f",
      borderWidth: 1,
      borderRadius: 12,
    }),
    Text(
      {
        position: "absolute",
        left: left + 14,
        top: 102,
        width: 252,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 11,
        color: frame.color,
        wrap: "none",
      },
      `FRAME ${index + 1} · t=${frame.timeMs}ms · ${frame.label}`,
    ),
    ...motionContent(frame, left, 116, `materialized-path-frame-${index}`),
    Text(
      {
        position: "absolute",
        left: left + 14,
        top: 286,
        width: 252,
        font: JETBRAINS_ALIAS,
        fontSizePx: 10,
        color: "#cbd5e1",
        wrap: "none",
      },
      `startOffset ${frame.startOffsetPx} · ${svgBytes} SVG bytes`,
    ),
    Text(
      {
        position: "absolute",
        left: left + 14,
        top: 304,
        width: 252,
        font: FA,
        fontSizePx: 10,
        color: "#64748b",
        wrap: "none",
      },
      "geometry baked before render",
    ),
  ];
}

function buildTextPathMotion(engine?: Engine): VNode {
  return Canvas(
    { width: 960, height: 360, background: "#071827" },
    // A Flex centers the label instead of hand-placed offsets, so the text
    // stays inside the chip against the backdrop.
    Flex(
      {
        position: "absolute",
        left: 24,
        top: 20,
        width: 90,
        height: 28,
        justifyContent: "center",
        alignItems: "center",
        background: "#f97316",
        borderRadius: 14,
      },
      Text(
        {
          font: JETBRAINS_ALIAS,
          fontSizePx: 10,
          color: "#071827",
          wrap: "none",
        },
        "MATERIALIZED",
      ),
    ),
    Text(
      {
        position: "absolute",
        left: 118,
        top: 20,
        width: 420,
        font: FA,
        fontSizePx: 22,
        color: "#f8fafc",
        wrap: "none",
      },
      "Text Path Motion",
    ),
    Text(
      {
        position: "absolute",
        left: 24,
        top: 56,
        width: 900,
        font: FA,
        fontSizePx: 12,
        color: "#94a3b8",
        wrap: "none",
      },
      "Downstream state materializes d/startOffsetPx per frame; this is not a native layout animation channel.",
    ),
    ...MOTION_FRAMES.flatMap((frame, index) =>
      motionCard(frame, measureSvgBytes(engine, frame), 24 + index * 316, index),
    ),
  );
}

export const textPathMotionPreset: Preset = {
  animationDurationMs: 1000,
  title: "Materialized Text Path Motion",
  description:
    "Three downstream-materialized frames change d and startOffsetPx before rendering. The MATERIALIZED badge distinguishes state reconstruction from native opacity/transform animation.",
  source: `import { Canvas, TextOnPath } from "@boundsvg/core";

// Rebuild the scene with authored geometry at each frame.
function materializeTextPathFrame(timeMs: number) {
  const d = timeMs < 400
    ? "M16 110L264 110"
    : timeMs < 800
      ? "M16 146C70 24 210 24 264 146"
      : "M264 120A124 68 0 0 0 16 120";
  const startOffsetPx = timeMs < 400 ? 76 : timeMs < 800 ? 142 : 194;
  return Canvas(
    { width: 280, height: 180, background: "#102a43" },
    TextOnPath(
      {
        id: "materialized-path", d, width: 280, height: 180,
        font: "${FA}", fontSizePx: 23, color: "#67e8f9",
        startOffsetPx, textAnchor: "middle", pathOverflow: "error",
      },
      "字幕 Motion",
    ),
  );
}

const svgFrames = [0, 400, 800].map((timeMs) =>
  engine.renderToSvg(materializeTextPathFrame(timeMs), {
    timeMs,
  }),
);`,
  build: (engine) => buildTextPathMotion(engine),
};
