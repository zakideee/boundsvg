import { Box, Canvas, Inline, Path, Text, TextOnPath, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA, JETBRAINS_ALIAS } from "../config";
import type { Preset } from "../types";

type A2Frame = {
  id: string;
  label: string;
  left: number;
  d: string;
  startOffsetPx: number;
  direction: "forward" | "reverse";
  normal: "left" | "right";
  fit: "none" | "spacing" | "shrink";
  color: string;
  children: Array<string | VNode>;
};

const UNIT_ANIMATION = {
  by: "cluster",
  animation: {
    keyframes: [
      { at: 0, opacity: 0.35, transform: { translateY: 7, scaleX: 0.92, scaleY: 0.92 } },
      { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
    ],
    durationMs: 520,
    easing: "ease-out",
    fill: "both",
  },
  delayStepMs: 22,
  order: "logical",
} as const;

const IDENTITY_TEXT = "Shaping fidelity 日本語";

const A2_FRAMES: readonly A2Frame[] = [
  {
    id: "0",
    label: "MATERIALIZED · CONTENT",
    left: 40,
    d: "M12 92L260 92",
    startOffsetPx: 124,
    direction: "forward",
    normal: "left",
    fit: "none",
    color: "#67e8f9",
    children: ["RICH ", Inline({ color: "#fde68a" }, "STATE")],
  },
  {
    id: "1",
    label: "MATERIALIZED · STYLE / D",
    left: 344,
    d: "M12 112C70 20 202 20 260 112",
    startOffsetPx: 144,
    direction: "forward",
    normal: "left",
    fit: "spacing",
    color: "#a7f3d0",
    children: [Inline({ font: JETBRAINS_ALIAS, color: "#f0abfc" }, "PATH"), " 状態"],
  },
  {
    id: "2",
    label: "MATERIALIZED · DIRECTION / FIT",
    left: 648,
    d: "M260 104A124 70 0 0 0 12 104",
    startOffsetPx: 176,
    direction: "reverse",
    normal: "right",
    fit: "shrink",
    color: "#fb923c",
    children: ["REVERSE ", Inline({ color: "#fde68a" }, "縮小 FRAME")],
  },
];

function label(text: string, left: number, top: number, width: number, color: string): VNode {
  return Text(
    {
      position: "absolute",
      left,
      top,
      width,
      font: JETBRAINS_ALIAS,
      fallback: [FA],
      fontSizePx: 10,
      color,
      wrap: "none",
    },
    text,
  );
}

function identityCard(): VNode[] {
  const d = "M12 82C92 18 308 18 388 82";
  const common = {
    top: 116,
    width: 400,
    height: 108,
    d,
    font: FA,
    fallback: [JETBRAINS_ALIAS],
    fontSizePx: 22,
    color: "#e2e8f0",
    startOffsetPx: 200,
    textAnchor: "middle" as const,
    pathOverflow: "error" as const,
    animateUnits: UNIT_ANIMATION,
  };

  return [
    Box({
      position: "absolute",
      left: 24,
      top: 82,
      width: 976,
      height: 152,
      background: "#111827",
      borderColor: "#334155",
      borderWidth: 1,
      borderRadius: 12,
    }),
    label("PLAIN STRING", 40, 96, 400, "#67e8f9"),
    label("SINGLE INLINE · SAME SHAPING / UNITMAP", 496, 96, 420, "#f0abfc"),
    Path({
      position: "absolute",
      left: 40,
      top: 116,
      width: 400,
      height: 108,
      d,
      fill: "none",
      stroke: "#475569",
      strokeWidth: 1,
      strokeDasharray: "4,4",
    }),
    TextOnPath(
      { ...common, id: "path-identity-plain", left: 40, position: "absolute" },
      IDENTITY_TEXT,
    ),
    Path({
      position: "absolute",
      left: 496,
      top: 116,
      width: 400,
      height: 108,
      d,
      fill: "none",
      stroke: "#475569",
      strokeWidth: 1,
      strokeDasharray: "4,4",
    }),
    TextOnPath(
      { ...common, id: "path-identity-inline", left: 496, position: "absolute" },
      Inline({}, IDENTITY_TEXT),
    ),
  ];
}

function richPaintCard(): VNode[] {
  const d = "M16 158C88 34 350 34 422 158";
  return [
    Box({
      position: "absolute",
      left: 24,
      top: 252,
      width: 440,
      height: 214,
      background: "#102a43",
      borderColor: "#1e3a5f",
      borderWidth: 1,
      borderRadius: 12,
    }),
    label("MIXED FONT · COLOR · EFFECT LAYERS", 40, 268, 408, "#67e8f9"),
    Path({
      position: "absolute",
      left: 24,
      top: 286,
      width: 440,
      height: 170,
      d,
      fill: "none",
      stroke: "#475569",
      strokeWidth: 1,
      strokeDasharray: "5,5",
    }),
    TextOnPath(
      {
        id: "rich-path-mixed",
        position: "absolute",
        left: 24,
        top: 286,
        width: 440,
        height: 170,
        d,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 24,
        color: "#e2e8f0",
        startOffsetPx: 220,
        textAnchor: "middle",
        pathOverflow: "error",
        textShadows: [{ dx: 2, dy: 2, blurPx: 0, color: "#020617" }],
      },
      "Rich ",
      Inline(
        {
          font: JETBRAINS_ALIAS,
          color: "#fde68a",
          textStrokes: [{ color: "#92400e", widthPx: 2 }],
        },
        "PATH",
      ),
      Inline({ color: "#f0abfc" }, " 日本語"),
    ),
    label("one logical text · layer-first paint", 40, 438, 408, "#94a3b8"),
  ];
}

function curvedDecorationCard(): VNode[] {
  // `scale` fits the whole cluster sequence to the full path length, so the text
  // must be long enough to keep the inline scale near 1. Short text on a
  // card-sized closed path would demand a double-digit scale, which blows the
  // glyphs out of the card and makes curved skip-ink cost hundreds of ms.
  const d = "M30 120C120 44 380 44 470 120L470 26L30 26Z";
  return [
    Box({
      position: "absolute",
      left: 480,
      top: 252,
      width: 536,
      height: 214,
      background: "#111827",
      borderColor: "#334155",
      borderWidth: 1,
      borderRadius: 12,
    }),
    label("CLOSED · REVERSE / RIGHT · SCALE · SKIP INK", 496, 268, 424, "#fb923c"),
    Path({
      position: "absolute",
      left: 494,
      top: 292,
      width: 512,
      height: 150,
      d,
      fill: "none",
      stroke: "#475569",
      strokeWidth: 1,
      strokeDasharray: "5,5",
    }),
    TextOnPath(
      {
        id: "rich-path-decorated-closed",
        position: "absolute",
        left: 494,
        top: 292,
        width: 512,
        height: 150,
        d,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 28,
        color: "#67e8f9",
        startOffsetPx: 260,
        textAnchor: "middle",
        pathDirection: "reverse",
        pathNormal: "right",
        pathOffsetPx: 5,
        pathFit: "scale",
        pathOverflow: "error",
        textDecoration: {
          line: "underline",
          style: "dashed",
          skipInk: "all",
          color: "#67e8f9",
          thicknessPx: 2,
          offsetPx: -9,
        },
      },
      "CLOSED REVERSE RIGHT NORMAL ",
      Inline(
        {
          fontWeight: 700,
          fontSizePx: 36,
          color: "#f0abfc",
          textStrokes: [{ color: "#9f1239", widthPx: 2 }],
          textShadows: [{ dx: 1, dy: 2, blurPx: 0, color: "#4c0519" }],
          textDecoration: {
            line: "underline",
            style: "wavy",
            skipInk: "all",
            color: "#f0abfc",
            thicknessPx: 2,
            offsetPx: -11,
          },
        },
        "曲線",
      ),
      Inline({ color: "#fde68a", textDecoration: "none" }, " SCALE FIT SKIP INK PATH Z"),
    ),
    label("decoration owns path-distance phase", 496, 438, 424, "#94a3b8"),
  ];
}

function a2Frame(frame: A2Frame): VNode[] {
  return [
    Box({
      position: "absolute",
      left: frame.left,
      top: 520,
      width: 272,
      height: 164,
      background: "#0f2942",
      borderColor: "#1e3a5f",
      borderWidth: 1,
      borderRadius: 10,
    }),
    label(frame.label, frame.left + 12, 534, 248, frame.color),
    Path({
      position: "absolute",
      left: frame.left,
      top: 552,
      width: 272,
      height: 124,
      d: frame.d,
      fill: "none",
      stroke: "#475569",
      strokeWidth: 1,
      strokeDasharray: "4,4",
    }),
    TextOnPath(
      {
        id: `materialized-path-frame-${frame.id}`,
        position: "absolute",
        left: frame.left,
        top: 552,
        width: 272,
        height: 124,
        d: frame.d,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 17,
        color: frame.color,
        startOffsetPx: frame.startOffsetPx,
        textAnchor: "middle",
        pathDirection: frame.direction,
        pathNormal: frame.normal,
        pathFit: frame.fit,
        pathOverflow: "error",
        animateUnits: UNIT_ANIMATION,
      },
      ...frame.children,
    ),
  ];
}

function buildTextMotionV3(): VNode {
  return Canvas(
    { width: 1024, height: 740, background: "#071827" },
    Text(
      {
        position: "absolute",
        left: 24,
        top: 20,
        width: 700,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 22,
        color: "#f8fafc",
        wrap: "none",
      },
      "Rich Text on Path",
    ),
    Text(
      {
        position: "absolute",
        left: 24,
        top: 50,
        width: 976,
        font: FA,
        fallback: [JETBRAINS_ALIAS],
        fontSizePx: 12,
        color: "#94a3b8",
        wrap: "none",
      },
      "Inline shaping, paint ranges, curved decoration, UnitMap animation, and materialized states.",
    ),
    ...identityCard(),
    ...richPaintCard(),
    ...curvedDecorationCard(),
    label("POST-LAYOUT UNIT PAINT INSIDE EACH MATERIALIZED FRAME", 40, 494, 880, "#a7f3d0"),
    ...A2_FRAMES.flatMap(a2Frame),
    Text(
      {
        position: "absolute",
        left: 24,
        top: 708,
        width: 976,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 9,
        color: "#64748b",
        wrap: "none",
      },
      "Unsupported on path: InlineBox · InlineRect · Ruby · vertical · bidi · native path morph. Materialized scenes rebuild content/style/d/fit.",
    ),
  );
}

export const textMotionV3Preset: Preset = {
  animationDurationMs: 1200,
  title: "Rich Text on Path",
  description:
    "Plain/single-Inline identity, mixed font and paint ranges, curved skip-ink decoration, closed fitting, decoration-free unit animation, and downstream-materialized checkpoints.",
  source: `import { Canvas, Inline, TextOnPath } from "@boundsvg/core";

const vnode = Canvas(
  { width: 640, height: 280, background: "#071827" },
  TextOnPath(
    {
      d: "M20 210C120 20 520 20 620 210",
      width: 640, height: 260,
      font: "${FA}", fallback: ["${JETBRAINS_ALIAS}"], fontSizePx: 28,
      pathFit: "shrink", pathOverflow: "error",
      textDecoration: {
        line: "underline", style: "wavy", skipInk: "all",
        color: "#f0abfc", thicknessPx: 2,
      },
    },
    "Rich ",
    Inline({ font: "${JETBRAINS_ALIAS}", color: "#fde68a" }, "PATH"),
    Inline({ color: "#67e8f9" }, " 日本語"),
  ),
);

const svg = engine.renderToSvg(vnode);
const png = engine.renderToPng(vnode);

// animateUnits requires effective decoration to be absent.
// Content/style/d/direction/fit changes use materialized scenes, not native path morphs.`,
  build: buildTextMotionV3,
};
