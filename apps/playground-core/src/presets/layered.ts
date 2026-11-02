import { Box, Canvas, Text } from "@boundsvg/core";
import { FONT_ALIAS } from "../config";
import type { Preset } from "../types";

/** Logical canvas width shared by all layer documents. */
const CANVAS_WIDTH = 320;
/** Logical canvas height shared by all layer documents. */
const CANVAS_HEIGHT = 180;

/** Demonstrate three inline layers with distinct clip, gradient and shadow resources. */
export const layeredPreset: Preset = {
  title: "Layered",
  description:
    "renderToLayeredSvg / renderToLayeredPng — hover the Stacked views to see layers shift diagonally.",
  source: `import { Box, Canvas, Text, createResourceIdPrefix } from "@boundsvg/core";

const vnode = Canvas(
  { width: 320, height: 180 },
  Box({ layer: "background", position: "absolute",
    top: 0, left: 0, width: 320, height: 180,
    background: "linear-gradient(90deg, #1e293b, #334155)", overflow: "clip", borderRadius: 8, boxShadow: "0 2 6 rgba(15,23,42,0.2)" }),
  Box({ layer: "panel", position: "absolute",
    top: 48, left: 40, width: 240, height: 84,
    background: "linear-gradient(0deg, #6366f1, #a855f7)", borderRadius: 18, overflow: "clip", boxShadow: "0 6 10 rgba(15,23,42,0.4)" }),
  Text({ layer: "text", position: "absolute",
    top: 70, left: 108,
    font: "${FONT_ALIAS}", fontSizePx: 28, color: "#f9fafb" },
    "Layered"),
);

const singleSvg = engine.renderToSvg(vnode, {
  resourceIdPrefix: createResourceIdPrefix("example-single"),
});
const svgResult = engine.renderToLayeredSvg(vnode, {
  resourceIdPrefix: createResourceIdPrefix("example-stack"),
});
const pngResult = engine.renderToLayeredPng(vnode);`,
  build: () =>
    Canvas(
      { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      Box({
        layer: "background",
        position: "absolute",
        top: 0,
        left: 0,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        background: "linear-gradient(90deg, #1e293b, #334155)",
        overflow: "clip",
        borderRadius: 8,
        boxShadow: "0 2 6 rgba(15,23,42,0.2)",
      }),
      Box({
        layer: "panel",
        position: "absolute",
        top: 48,
        left: 40,
        width: 240,
        height: 84,
        background: "linear-gradient(0deg, #6366f1, #a855f7)",
        borderRadius: 18,
        overflow: "clip",
        boxShadow: "0 6 10 rgba(15,23,42,0.4)",
      }),
      Text(
        {
          layer: "text",
          position: "absolute",
          top: 70,
          left: 108,
          font: FONT_ALIAS,
          fontSizePx: 28,
          color: "#f9fafb",
        },
        "Layered",
      ),
    ),
};
