import { Box, Canvas, Path, Text, TextOnPath, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA, JETBRAINS_ALIAS } from "../config";
import type { Preset } from "../types";

type PathCard = {
  id: string;
  left: number;
  title: string;
  d: string;
  text: string;
  startOffsetPx: number;
  textAnchor: "start" | "middle" | "end";
  pathNormal: "left" | "right";
  pathOffsetPx: number;
  color: string;
  effects?: boolean;
};

const CARDS: readonly PathCard[] = [
  {
    id: "straight",
    left: 24,
    title: "STRAIGHT · LATIN",
    d: "M14 92L266 92",
    text: "START OFFSET",
    startOffsetPx: 28,
    textAnchor: "start",
    pathNormal: "right",
    pathOffsetPx: 8,
    color: "#67e8f9",
  },
  {
    id: "cubic",
    left: 340,
    title: "CUBIC · EFFECTS",
    d: "M14 126C72 28 208 28 266 126",
    text: "CURVED TYPE",
    startOffsetPx: 140,
    textAnchor: "middle",
    pathNormal: "right",
    pathOffsetPx: 5,
    color: "#f8fafc",
    effects: true,
  },
  {
    id: "arc",
    left: 656,
    title: "ARC · 日本語",
    d: "M14 118A126 62 0 0 1 266 118",
    text: "円弧の日本語",
    startOffsetPx: 252,
    textAnchor: "end",
    pathNormal: "left",
    pathOffsetPx: 5,
    color: "#fde68a",
  },
];

function pathCard(card: PathCard): VNode[] {
  return [
    Box({
      position: "absolute",
      left: card.left,
      top: 70,
      width: 280,
      height: 226,
      background: "#102a43",
      borderColor: "#1e3a5f",
      borderWidth: 1,
      borderRadius: 12,
    }),
    Text(
      {
        position: "absolute",
        left: card.left + 14,
        top: 84,
        width: 252,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 11,
        color: "#94a3b8",
        wrap: "none",
      },
      card.title,
    ),
    Path({
      id: `path-basics-${card.id}-guide`,
      position: "absolute",
      left: card.left,
      top: 96,
      d: card.d,
      width: 280,
      height: 150,
      fill: "none",
      stroke: "#64748b",
      strokeWidth: 1,
      strokeDasharray: "5,5",
    }),
    TextOnPath(
      {
        id: `path-basics-${card.id}`,
        position: "absolute",
        left: card.left,
        top: 96,
        d: card.d,
        width: 280,
        height: 150,
        font: card.id === "straight" ? JETBRAINS_ALIAS : FA,
        fallback: [FA],
        fontSizePx: card.id === "arc" ? 22 : 21,
        color: card.color,
        startOffsetPx: card.startOffsetPx,
        textAnchor: card.textAnchor,
        pathNormal: card.pathNormal,
        pathOffsetPx: card.pathOffsetPx,
        pathOverflow: "error",
        ...(card.effects
          ? {
              textShadows: [{ dx: 3, dy: 4, blurPx: 0, color: "#020617" }],
              textStrokes: [
                { color: "#0e7490", widthPx: 5 },
                { color: "#ffffff", widthPx: 2 },
              ],
            }
          : {}),
      },
      card.text,
    ),
    Text(
      {
        position: "absolute",
        left: card.left + 14,
        top: 250,
        width: 252,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 10,
        color: "#cbd5e1",
        wrap: "none",
      },
      `offset ${card.startOffsetPx} · anchor ${card.textAnchor}`,
    ),
    Text(
      {
        position: "absolute",
        left: card.left + 14,
        top: 268,
        width: 252,
        font: JETBRAINS_ALIAS,
        fontSizePx: 10,
        color: "#64748b",
        wrap: "none",
      },
      `normal ${card.pathNormal} · pathOffset ${card.pathOffsetPx}`,
    ),
  ];
}

function overflowExample(): VNode[] {
  const d = "M18 94L894 94";
  return [
    Box({
      position: "absolute",
      left: 24,
      top: 322,
      width: 912,
      height: 190,
      background: "#111827",
      borderColor: "#334155",
      borderWidth: 1,
      borderRadius: 12,
    }),
    Text(
      {
        position: "absolute",
        left: 42,
        top: 338,
        width: 860,
        font: JETBRAINS_ALIAS,
        fontSizePx: 11,
        color: "#f97316",
        wrap: "none",
      },
      "PATH OVERFLOW · hidden omits off-path ink · error throws TEXT_PATH_OVERFLOW",
    ),
    Path({
      position: "absolute",
      left: 24,
      top: 350,
      d,
      width: 912,
      height: 140,
      fill: "none",
      stroke: "#64748b",
      strokeWidth: 1,
      strokeDasharray: "5,5",
    }),
    TextOnPath(
      {
        id: "path-basics-overflow-hidden",
        position: "absolute",
        left: 24,
        top: 350,
        d,
        width: 912,
        height: 140,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 25,
        color: "#fb923c",
        startOffsetPx: -54,
        textAnchor: "start",
        pathOverflow: "hidden",
      },
      "LEADING GLYPHS ARE HIDDEN BUT LOGICAL TEXT REMAINS",
    ),
    Text(
      {
        position: "absolute",
        left: 42,
        top: 478,
        width: 860,
        font: FA,
        fontSizePx: 11,
        color: "#94a3b8",
        wrap: "none",
      },
      "The guide path is node-local; the explicit width/height frame does not scale it.",
    ),
  ];
}

function buildTextOnPathBasics(): VNode {
  return Canvas(
    { width: 960, height: 540, background: "#071827" },
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
      "Text on Path Basics",
    ),
    Text(
      {
        position: "absolute",
        left: 24,
        top: 48,
        width: 820,
        font: FA,
        fontSizePx: 12,
        color: "#94a3b8",
        wrap: "none",
      },
      "Handwritten guides show local path geometry; glyph outlines are shared by SVG and PNG.",
    ),
    ...CARDS.flatMap(pathCard),
    ...overflowExample(),
  );
}

export const textOnPathBasicsPreset: Preset = {
  title: "Text on Path Basics",
  description:
    "Straight, cubic, arc, Latin, Japanese, effects, anchor/path offset/normal side, and hidden/error overflow semantics using handwritten local guide paths.",
  source: `import { Canvas, Path, TextOnPath } from "@boundsvg/core";

const d = "M20 150C100 20 340 20 420 150";
const vnode = Canvas(
  { width: 440, height: 190, background: "#071827" },
  Path({ d, width: 440, height: 190, fill: "none", stroke: "#64748b" }),
  TextOnPath(
    {
      d, width: 440, height: 190,
      font: "${FA}", fontSizePx: 28, color: "#f8fafc",
      startOffsetPx: 220, textAnchor: "middle",
      pathNormal: "right", pathOffsetPx: 6,
      pathOverflow: "hidden",
      textStrokes: [{ color: "#0e7490", widthPx: 4 }],
      textShadows: [{ dx: 3, dy: 4, blurPx: 0, color: "#020617" }],
    },
    "曲線 TextOnPath",
  ),
);

const svg = engine.renderToSvg(vnode);

// Switching the same off-path midpoint to error is explicit and fatal.
const errorVNode = TextOnPath(
  { d: "M0 40L80 40", width: 80, height: 80, font: "${FA}", fontSizePx: 24,
    startOffsetPx: -100, pathOverflow: "error" },
  "overflow",
);`,
  build: buildTextOnPathBasics,
};
