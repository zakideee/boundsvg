import { Box, Canvas, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

const CANVAS_W = 320;
const CANVAS_H = 180;

export const layeredPreset: Preset = {
  title: "Layered",
  description:
    "renderToLayeredSvg / renderToLayeredPng — hover the Stacked views to see layers shift diagonally.",
  source: `import { Box, Canvas, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 320, height: 180 },
  Box({ layer: "background", position: "absolute",
    top: 0, left: 0, width: 320, height: 180,
    background: "#1e293b" }),
  Box({ layer: "panel", position: "absolute",
    top: 48, left: 40, width: 240, height: 84,
    background: "#6366f1", borderRadius: 18 }),
  Text({ layer: "text", position: "absolute",
    top: 70, left: 108,
    font: "${FA}", fontSizePx: 28, color: "#f9fafb" },
    "Layered"),
);

const svgResult = engine.renderToLayeredSvg(vnode);
const pngResult = engine.renderToLayeredPng(vnode);`,
  build: () =>
    Canvas(
      { width: CANVAS_W, height: CANVAS_H },
      Box({
        layer: "background",
        position: "absolute",
        top: 0,
        left: 0,
        width: CANVAS_W,
        height: CANVAS_H,
        background: "#1e293b",
      }),
      Box({
        layer: "panel",
        position: "absolute",
        top: 48,
        left: 40,
        width: 240,
        height: 84,
        background: "#6366f1",
        borderRadius: 18,
      }),
      Text(
        {
          layer: "text",
          position: "absolute",
          top: 70,
          left: 108,
          font: FA,
          fontSizePx: 28,
          color: "#f9fafb",
        },
        "Layered",
      ),
    ),
};
