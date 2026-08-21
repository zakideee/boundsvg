import type { TextDecoration } from "../../../src/text/types.js";
import { createElement } from "../../../src/vnode/create-element.js";
import type { AnimationSpec, VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN, FONT_SANS_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 680;
const HEIGHT = 540;
const FRAME_WIDTH = 632;
const FRAME_HEIGHT = 100;

const UNIT_ANIMATION: AnimationSpec = {
  keyframes: [
    {
      at: 0,
      opacity: 0.2,
      transform: { translateY: 10, rotateDeg: -7, scaleX: 0.82, scaleY: 0.82 },
    },
    {
      at: 1,
      opacity: 1,
      transform: { translateY: 0, rotateDeg: 0, scaleX: 1, scaleY: 1 },
    },
  ],
  durationMs: 700,
  easing: "ease-out",
  fill: "both",
};

type PathRow = {
  id: string;
  top: number;
  d: string;
  textD?: string;
  text: string;
  children?: Array<string | VNode>;
  font: string;
  color: string;
  animated?: boolean;
  startOffsetPx?: number;
  textAnchor?: "start" | "middle" | "end";
  pathDirection?: "forward" | "reverse";
  pathNormal?: "left" | "right";
  pathOffsetPx?: number;
  pathFit?: "none" | "spacing" | "scale" | "shrink";
  pathOverflow?: "hidden" | "error" | "ellipsis";
  textDecoration?: TextDecoration;
  richEffects?: boolean;
};

const ROWS: readonly PathRow[] = [
  {
    id: "cubic",
    top: 72,
    d: "M16 82C150 4 482 4 616 82",
    text: "CURVED TYPE / 曲線",
    children: [
      "CURVED TYPE / ",
      createElement(
        "Inline",
        {
          font: FONT_SANS_JP,
          fontSizePx: 31,
          color: "#fb7185",
          textStrokes: [{ color: "#9f1239", widthPx: 2 }],
          textShadows: [{ dx: 2, dy: 2, color: "#4c051980" }],
          textDecoration: {
            line: "underline",
            style: "wavy",
            color: "#fda4af",
            thicknessPx: 2,
            skipInk: "all",
          },
        },
        "曲線",
      ),
    ],
    font: FONT_LATIN,
    color: "#f8fafc",
    pathFit: "spacing",
    textDecoration: {
      line: "underline",
      style: "dashed",
      color: "#fb7185",
      thicknessPx: 2,
      skipInk: "all",
    },
    richEffects: true,
  },
  {
    id: "arc",
    top: 184,
    d: "M16 82A300 62 0 0 1 616 82",
    text: "円弧に沿う日本語 SHRINK FITTING ROUTE 日本語組版",
    children: [
      "円弧に沿う日本語 ",
      createElement(
        "Inline",
        { font: FONT_LATIN, color: "#fef3c7", letterSpacingPx: 1 },
        "SHRINK FITTING ROUTE",
      ),
      createElement("Inline", { fontSizePx: 31, color: "#fde047" }, " 日本語組版"),
    ],
    font: FONT_SANS_JP,
    color: "#fde68a",
    pathFit: "shrink",
    textDecoration: {
      line: "underline",
      style: "double",
      color: "#38bdf8",
      thicknessPx: 2,
      skipInk: "none",
    },
  },
  {
    id: "reverse",
    top: 296,
    d: "M32 72L600 72L600 28L32 28Z",
    text: "逆向き REVERSE",
    font: FONT_SANS_JP,
    color: "#a5f3fc",
    animated: true,
    pathDirection: "reverse",
    pathFit: "scale",
  },
  {
    id: "ellipsis",
    top: 408,
    d: "M16 58L240 58",
    text: "ELLIPSIS は元の文章と論理単位を保持する",
    font: FONT_SANS_JP,
    color: "#fda4af",
    animated: true,
    startOffsetPx: 0,
    textAnchor: "start",
    pathNormal: "left",
    pathOffsetPx: 0,
    pathOverflow: "ellipsis",
  },
];

function buildPathRow(row: PathRow): VNode[] {
  return [
    createElement("Box", {
      id: `ntop-${row.id}-panel`,
      position: "absolute",
      left: 24,
      top: row.top,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      borderRadius: 14,
      background: row.id === "reverse" ? "#164e63" : "#102a43",
    }),
    createElement("Path", {
      id: `ntop-${row.id}-guide`,
      position: "absolute",
      left: 24,
      top: row.top,
      d: row.d,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fill: "none",
      stroke: "#64748b",
      strokeWidth: 1,
      strokeDasharray: "5,5",
    }),
    createElement(
      "TextOnPath",
      {
        id: `ntop-${row.id}`,
        position: "absolute",
        left: 24,
        top: row.top,
        d: row.textD ?? row.d,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        font: row.font,
        fallback: [FONT_SANS_JP],
        fontSizePx: 27,
        color: row.color,
        startOffsetPx: row.startOffsetPx ?? 316,
        textAnchor: row.textAnchor ?? "middle",
        pathDirection: row.pathDirection ?? "forward",
        pathNormal: row.pathNormal ?? "right",
        pathOffsetPx: row.pathOffsetPx ?? 5,
        pathFit: row.pathFit,
        pathOverflow: row.pathOverflow ?? "error",
        textDecoration: row.textDecoration,
        ...(row.richEffects
          ? {
              textShadows: [{ dx: 2, dy: 2, blurPx: 0, color: "#020617" }],
              textStrokes: [{ color: "#164e63", widthPx: 2 }],
            }
          : {}),
        ...(row.animated
          ? {
              textShadows: [{ dx: 3, dy: 4, blurPx: 0, color: "#020617" }],
              textStrokes: [{ color: "#0891b2", widthPx: 3 }],
              animateUnits: {
                by: "cluster" as const,
                animation: UNIT_ANIMATION,
                delayStepMs: 35,
                order: "logical" as const,
              },
            }
          : {}),
      },
      ...(row.children ?? [row.text]),
    ),
  ];
}

function buildNativeTextOnPathScene(): VNode {
  return createElement(
    "Canvas",
    { id: "ntop-canvas", width: WIDTH, height: HEIGHT, background: "#071827" },
    createElement(
      "Text",
      {
        id: "ntop-heading",
        position: "absolute",
        left: 30,
        top: 24,
        font: FONT_LATIN,
        fontSizePx: 15,
        letterSpacingPx: 2,
        color: "#67e8f9",
      },
      "TEXT ON PATH / STATIC UNIT SAMPLE",
    ),
    ...ROWS.flatMap(buildPathRow),
  );
}

export const nativeTextOnPathScene: ConformanceScene = {
  id: "native-text-on-path",
  build: buildNativeTextOnPathScene,
  width: WIDTH,
  height: HEIGHT,
  renderOptions: { animation: "static", timeMs: 350 },
};
