import { Box, Canvas, Path, Text, TextOnPath, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA, JETBRAINS_ALIAS } from "../config";
import type { Preset } from "../types";

type DecorationCard = {
  left: number;
  style: "dotted" | "dashed" | "wavy";
  color: string;
  text: string;
};

type FitCard = {
  id: string;
  left: number;
  title: string;
  text: string;
  d: string;
  pathFit: "none" | "spacing" | "scale" | "shrink";
  pathOverflow: "error" | "ellipsis";
  color: string;
};

const DECORATION_CARDS: readonly DecorationCard[] = [
  { left: 24, style: "dotted", color: "#67e8f9", text: "gyp 装飾" },
  { left: 336, style: "dashed", color: "#fde68a", text: "gyp 装飾" },
  { left: 648, style: "wavy", color: "#f0abfc", text: "gyp 装飾" },
];

const FIT_CARDS: readonly FitCard[] = [
  {
    id: "spacing",
    left: 24,
    title: "SPACING",
    text: "SPACE",
    d: "M12 76L204 76",
    pathFit: "spacing",
    pathOverflow: "error",
    color: "#67e8f9",
  },
  {
    id: "scale",
    left: 252,
    title: "SCALE",
    text: "SCALE",
    d: "M12 76L204 76",
    pathFit: "scale",
    pathOverflow: "error",
    color: "#a7f3d0",
  },
  {
    id: "shrink",
    left: 480,
    title: "SHRINK",
    text: "SHRINK WHEN NEEDED",
    d: "M12 76L204 76",
    pathFit: "shrink",
    pathOverflow: "error",
    color: "#fde68a",
  },
  {
    id: "ellipsis",
    left: 708,
    title: "ELLIPSIS",
    text: "ELLIPSIS PRESERVES SOURCE",
    d: "M12 76L170 76",
    pathFit: "none",
    pathOverflow: "ellipsis",
    color: "#fb923c",
  },
];

function decorationCard(card: DecorationCard): VNode[] {
  const title = card.style.toUpperCase();
  const textDecoration = (skipInk: "none" | "all") => ({
    line: "underline" as const,
    style: card.style,
    color: card.color,
    thicknessPx: 2,
    offsetPx: 2,
    skipInk,
  });

  return [
    Box({
      position: "absolute",
      left: card.left,
      top: 78,
      width: 288,
      height: 172,
      background: "#102a43",
      borderColor: "#1e3a5f",
      borderWidth: 1,
      borderRadius: 12,
    }),
    Text(
      {
        position: "absolute",
        left: card.left + 14,
        top: 92,
        width: 260,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 11,
        color: card.color,
        wrap: "none",
      },
      title,
    ),
    Text(
      {
        position: "absolute",
        left: card.left + 14,
        top: 116,
        width: 46,
        font: JETBRAINS_ALIAS,
        fontSizePx: 9,
        color: "#64748b",
        wrap: "none",
      },
      "NONE",
    ),
    Text(
      {
        id: `path-decoration-${card.style}-none`,
        position: "absolute",
        left: card.left + 64,
        top: 110,
        width: 208,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 22,
        color: "#f8fafc",
        wrap: "none",
        textDecoration: textDecoration("none"),
      },
      card.text,
    ),
    Text(
      {
        position: "absolute",
        left: card.left + 14,
        top: 184,
        width: 46,
        font: JETBRAINS_ALIAS,
        fontSizePx: 9,
        color: "#94a3b8",
        wrap: "none",
      },
      "ALL",
    ),
    Text(
      {
        id: `path-decoration-${card.style}-all`,
        position: "absolute",
        left: card.left + 64,
        top: 178,
        width: 208,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 22,
        color: "#f8fafc",
        wrap: "none",
        textDecoration: textDecoration("all"),
      },
      card.text,
    ),
  ];
}

function closedTraversal(): VNode[] {
  const d = "M20 46L408 46L408 130L20 130Z";
  return [
    Box({
      position: "absolute",
      left: 24,
      top: 270,
      width: 440,
      height: 192,
      background: "#111827",
      borderColor: "#334155",
      borderWidth: 1,
      borderRadius: 12,
    }),
    Text(
      {
        position: "absolute",
        left: 38,
        top: 284,
        width: 412,
        font: JETBRAINS_ALIAS,
        fontSizePx: 11,
        color: "#f0abfc",
        wrap: "none",
      },
      "AUTHORED CLOSED · DIRECTION / SIDE / SEAM",
    ),
    Path({
      id: "closed-path-guide",
      position: "absolute",
      left: 24,
      top: 300,
      d,
      width: 440,
      height: 150,
      fill: "none",
      stroke: "#64748b",
      strokeWidth: 1,
      strokeDasharray: "5,5",
    }),
    TextOnPath(
      {
        id: "closed-path-forward-left",
        position: "absolute",
        left: 24,
        top: 300,
        d,
        width: 440,
        height: 150,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 16,
        color: "#67e8f9",
        startOffsetPx: 180,
        textAnchor: "start",
        pathDirection: "forward",
        pathNormal: "left",
        pathOffsetPx: 8,
        pathOverflow: "error",
      },
      "FORWARD · LEFT",
    ),
    TextOnPath(
      {
        id: "closed-path-reverse-right-seam",
        position: "absolute",
        left: 24,
        top: 300,
        d,
        width: 440,
        height: 150,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 16,
        color: "#fde68a",
        // Places the seam between words so "SEAM" alone turns the corner;
        // a larger offset splits "RIGHT" across the 90 degree seam.
        startOffsetPx: 880,
        textAnchor: "middle",
        pathDirection: "reverse",
        pathNormal: "right",
        pathOffsetPx: 8,
        pathOverflow: "error",
      },
      "REVERSE · RIGHT · SEAM",
    ),
  ];
}

function capabilityBoundary(): VNode[] {
  const rows = [
    ["✓", "plain string TextOnPath"],
    ["✓", "authored closed path + fitting"],
    ["→", "Rich Text on Path: Inline + curved decoration"],
    ["—", "InlineBox · Ruby · vertical · bidi · native morph"],
  ] as const;

  return [
    Box({
      position: "absolute",
      left: 480,
      top: 270,
      width: 456,
      height: 192,
      background: "#111827",
      borderColor: "#334155",
      borderWidth: 1,
      borderRadius: 12,
    }),
    Text(
      {
        position: "absolute",
        left: 494,
        top: 284,
        width: 428,
        font: JETBRAINS_ALIAS,
        fontSizePx: 11,
        color: "#fb923c",
        wrap: "none",
      },
      "CAPABILITY BOUNDARY",
    ),
    ...rows.flatMap(([badge, text], index) => [
      Text(
        {
          position: "absolute",
          left: 498,
          top: 316 + index * 32,
          width: 32,
          font: JETBRAINS_ALIAS,
          fallback: [FA],
          fontSizePx: 12,
          color: index < 2 ? "#67e8f9" : index === 2 ? "#facc15" : "#64748b",
          wrap: "none",
        },
        badge,
      ),
      Text(
        {
          position: "absolute",
          left: 536,
          top: 314 + index * 32,
          width: 378,
          font: FA,
          fallback: [JETBRAINS_ALIAS],
          fontSizePx: 13,
          color: index === 3 ? "#64748b" : "#cbd5e1",
          wrap: "none",
        },
        text,
      ),
    ]),
  ];
}

function fitCard(card: FitCard): VNode[] {
  return [
    Box({
      position: "absolute",
      left: card.left,
      top: 484,
      width: 216,
      height: 190,
      background: "#102a43",
      borderColor: "#1e3a5f",
      borderWidth: 1,
      borderRadius: 12,
    }),
    Text(
      {
        position: "absolute",
        left: card.left + 12,
        top: 498,
        width: 192,
        font: JETBRAINS_ALIAS,
        fontSizePx: 11,
        color: card.color,
        wrap: "none",
      },
      card.title,
    ),
    Path({
      id: `path-fit-${card.id}-guide`,
      position: "absolute",
      left: card.left,
      top: 516,
      d: card.d,
      width: 216,
      height: 112,
      fill: "none",
      stroke: "#64748b",
      strokeWidth: 1,
      strokeDasharray: "4,4",
    }),
    TextOnPath(
      {
        id: `path-fit-${card.id}`,
        position: "absolute",
        left: card.left,
        top: 516,
        d: card.d,
        width: 216,
        height: 112,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: card.id === "shrink" || card.id === "ellipsis" ? 20 : 17,
        color: card.color,
        startOffsetPx: 0,
        textAnchor: "start",
        pathNormal: "right",
        pathOffsetPx: 4,
        pathFit: card.pathFit,
        pathOverflow: card.pathOverflow,
      },
      card.text,
    ),
    Text(
      {
        position: "absolute",
        left: card.left + 12,
        top: 640,
        width: 192,
        font: JETBRAINS_ALIAS,
        fontSizePx: 9,
        color: "#94a3b8",
        wrap: "none",
      },
      card.pathOverflow === "ellipsis"
        ? "display truncates · source stays"
        : `pathFit ${card.pathFit}`,
    ),
  ];
}

function buildTextMotionV2(): VNode {
  return Canvas(
    { width: 960, height: 710, background: "#071827" },
    Text(
      {
        position: "absolute",
        left: 24,
        top: 20,
        width: 560,
        font: FA,
        fontSizePx: 22,
        color: "#f8fafc",
        wrap: "none",
      },
      "Decoration & Path Fit",
    ),
    Text(
      {
        position: "absolute",
        left: 24,
        top: 48,
        width: 900,
        font: FA,
        fontSizePx: 12,
        color: "#94a3b8",
        wrap: "none",
      },
      "Resolved decoration geometry and deterministic plain-text path traversal share SVG / PNG output.",
    ),
    ...DECORATION_CARDS.flatMap(decorationCard),
    ...closedTraversal(),
    ...capabilityBoundary(),
    ...FIT_CARDS.flatMap(fitCard),
    Text(
      {
        position: "absolute",
        left: 24,
        top: 686,
        width: 912,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 9,
        color: "#64748b",
        wrap: "none",
      },
      "Rich Text on Path adds Inline and curved decoration; InlineBox, Ruby, vertical, bidi, and native path morph stay unsupported.",
    ),
  );
}

export const textMotionV2Preset: Preset = {
  title: "Decoration & Path Fit",
  description:
    "Dotted, dashed, and wavy skip-ink geometry plus closed reverse/right traversal, spacing/scale/shrink, ellipsis source identity, and explicit capability boundaries.",
  source: `import { Canvas, Text, TextOnPath } from "@boundsvg/core";

const vnode = Canvas(
  { width: 640, height: 260, background: "#071827" },
  Text(
    {
      font: "${FA}", fontSizePx: 28, color: "#f8fafc",
      textDecoration: {
        line: "underline", style: "wavy", skipInk: "all",
        color: "#f0abfc", thicknessPx: 2,
      },
    },
    "gyp 装飾",
  ),
  TextOnPath(
    {
      d: "M20 60L300 60L300 180L20 180Z",
      width: 320, height: 220,
      font: "${JETBRAINS_ALIAS}", fontSizePx: 20, color: "#67e8f9",
      pathDirection: "reverse", pathNormal: "right", pathOffsetPx: 8,
      startOffsetPx: 760, textAnchor: "middle",
      pathFit: "shrink", pathOverflow: "ellipsis",
    },
    "PLAIN TEXT ON AN AUTHORED CLOSED PATH",
  ),
);

const svg = engine.renderToSvg(vnode);
const png = engine.renderToPng(vnode);

// Rich Inline path text is shown by the Rich Text on Path sample.
// InlineBox/Ruby/vertical/bidi and native d/startOffset animation remain unsupported.`,
  build: buildTextMotionV2,
};
