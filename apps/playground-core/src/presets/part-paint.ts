import { Canvas, Shape, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

const BADGE_GEOMETRY = {
  viewBox: { width: 300, height: 200 },
  root: {
    kind: "group" as const,
    nodeId: "badge",
    children: [
      {
        kind: "path" as const,
        nodeId: "bg",
        d: "M20 0H280C291 0 300 9 300 20V180C300 191 291 200 280 200H20C9 200 0 191 0 180V20C0 9 9 0 20 0Z",
      },
      {
        kind: "boolean" as const,
        nodeId: "ribbon",
        op: "union" as const,
        children: [
          { kind: "path" as const, d: "M20 80H160V120H20Z" },
          { kind: "path" as const, d: "M140 70H280V110H140Z" },
        ],
      },
      { kind: "path" as const, nodeId: "gem", d: "M240 20H280V60H240Z" },
    ],
  },
};

const TILE = { width: 260, height: 174 };
const STATES: Array<{
  label: string;
  partPaint?: Record<string, { fill?: string; stroke?: string; strokeWidth?: number }>;
}> = [
  { label: "normal" },
  { label: "hover", partPaint: { ribbon: { fill: "#f59e0b" } } },
  {
    label: "active",
    partPaint: {
      ribbon: { fill: "#f97316" },
      gem: { fill: "#facc15", stroke: "#fde68a", strokeWidth: 3 },
    },
  },
];

function buildPartPaintCanvas(): VNode {
  const children: VNode[] = [];
  STATES.forEach((state, index) => {
    const left = 40 + index * (TILE.width + 30);
    children.push(
      Shape({
        geometry: BADGE_GEOMETRY,
        width: TILE.width,
        height: TILE.height,
        fill: "#1e3a5f",
        stroke: "#38bdf8",
        strokeWidth: 2,
        ...(state.partPaint ? { partPaint: state.partPaint } : {}),
        position: "absolute",
        left,
        top: 84,
      }),
      Text(
        {
          font: FA,
          fontSizePx: 15,
          color: "#e2e8f0",
          width: TILE.width,
          wrap: "none",
          position: "absolute",
          left,
          top: 276,
        },
        state.label,
      ),
    );
  });
  children.push(
    Text(
      {
        font: FA,
        fontSizePx: 13,
        color: "#94a3b8",
        width: 800,
        wrap: "none",
        position: "absolute",
        left: 40,
        top: 32,
      },
      "One geometry, three states: partPaint overrides merge over the base paint per part",
    ),
  );
  return Canvas({ width: 920, height: 330, background: "#1a1a1a" }, ...children);
}

export const partPaintPreset: Preset = {
  title: "Part Paint",
  description:
    "State-variant assets from one geometry: partPaint overrides individual parts (merged over the base paint - unset fields inherit) without duplicating the GeometryDoc. The hover state recolors only the ribbon; active also lights up the gem with its own stroke.",
  source: `import { Canvas, Shape } from "@boundsvg/core";

// Same GeometryDoc, three states - override only what changes per part.
const baseProps = { geometry: BADGE_GEOMETRY, width: 260, height: 180,
  fill: "#1e3a5f", stroke: "#38bdf8", strokeWidth: 2 };
const normal = Shape({ ...baseProps });
const hover  = Shape({ ...baseProps, partPaint: { ribbon: { fill: "#f59e0b" } } });
const active = Shape({ ...baseProps, partPaint: {
  ribbon: { fill: "#f97316" },
  gem:    { fill: "#facc15", stroke: "#fde68a", strokeWidth: 3 },
} });

const vnode = Canvas({ width: 920, height: 420, background: "#1a1a1a" }, normal, hover, active);
const svg = engine.renderToSvg(vnode);`,
  build: () => buildPartPaintCanvas(),
};
