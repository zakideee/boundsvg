import { Canvas, type Engine, Shape, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

const STAMP_GEOMETRY = {
  viewBox: { width: 40, height: 40 },
  root: {
    kind: "group" as const,
    children: [
      {
        kind: "path" as const,
        nodeId: "seal",
        d: "M20 0C31.046 0 40 8.954 40 20C40 31.046 31.046 40 20 40C8.954 40 0 31.046 0 20C0 8.954 8.954 0 20 0Z",
      },
      {
        kind: "boolean" as const,
        nodeId: "star",
        op: "union" as const,
        children: [
          { kind: "path" as const, d: "M18 8H22V32H18Z" },
          { kind: "path" as const, d: "M8 18H32V22H8Z" },
        ],
      },
    ],
  },
};

const GRID = { columns: 5, rows: 2, size: 96, gap: 24, left: 60, top: 96 };

function buildStamps(uniformFill: boolean): VNode[] {
  const stamps: VNode[] = [];
  for (let row = 0; row < GRID.rows; row += 1) {
    for (let column = 0; column < GRID.columns; column += 1) {
      const index = row * GRID.columns + column;
      stamps.push(
        Shape({
          geometry: STAMP_GEOMETRY,
          width: GRID.size,
          height: GRID.size,
          fill: uniformFill ? "#0ea5e9" : `#0ea5${(30 + index * 5).toString(16).padStart(2, "0")}`,
          stroke: "#0c4a6e",
          strokeWidth: 2,
          position: "absolute",
          left: GRID.left + column * (GRID.size + GRID.gap),
          top: GRID.top + row * (GRID.size + GRID.gap),
        }),
      );
    }
  }
  return stamps;
}

function buildCanvas(children: VNode[], note: string): VNode {
  return Canvas(
    { width: 920, height: 360, background: "#1a1a1a" },
    Text(
      {
        font: FA,
        fontSizePx: 13,
        color: "#94a3b8",
        width: 820,
        wrap: "none",
        position: "absolute",
        left: GRID.left,
        top: 32,
      },
      note,
    ),
    ...children,
  );
}

function buildDefsSharingCanvas(engine?: Engine): VNode {
  let note = "10 identical stamps share one <defs> path per part and reference it with <use>";
  if (engine) {
    const sharedBytes = engine.renderToSvg(buildCanvas(buildStamps(true), "")).length;
    const uniqueBytes = engine.renderToSvg(buildCanvas(buildStamps(false), "")).length;
    const saved = Math.round((1 - sharedBytes / uniqueBytes) * 100);
    note = `10 identical stamps: ${sharedBytes.toLocaleString()} bytes with defs/use sharing vs ${uniqueBytes.toLocaleString()} bytes when every stamp is tinted uniquely (no sharing) - ${saved}% smaller`;
  }
  return buildCanvas(buildStamps(true), note);
}

export const defsSharingPreset: Preset = {
  title: "Defs Sharing",
  description:
    "Byte-identical shape parts (same path data and paint) hoist automatically into <defs> and render as <use> references - on by default, and a no-op when nothing repeats. The caption compares real output sizes for shared vs uniquely-tinted stamps; check the Rendered SVG source for the sp-* defs.",
  source: `import { Canvas, Shape } from "@boundsvg/core";

// Repetition is free: identical (d + paint) parts dedupe into <defs>.
const positions = [{ left: 60, top: 80 }, { left: 200, top: 80 }, { left: 340, top: 80 }];
const stamps = positions.map((p) =>
  Shape({ geometry: STAMP_GEOMETRY, width: 96, height: 96,
    fill: "#0ea5e9", stroke: "#0c4a6e", strokeWidth: 2,
    position: "absolute", ...p }),
);

const vnode = Canvas({ width: 920, height: 420, background: "#1a1a1a" }, ...stamps);
// Rendered SVG: <defs><path id="sp-…"/></defs> + <use href="#sp-…"/> per stamp.
const svg = engine.renderToSvg(vnode);`,
  build: (engine?: Engine) => buildDefsSharingCanvas(engine),
};
