import { Canvas, Flex, Inline, Text } from "@boundsvg/core";
import { FONT_ALIAS } from "../config";
import type { Preset } from "../types";

/** A shared paint frame on a skewed card with independent border and outline. */
export const designExpressionsPreset: Preset = {
  title: "Gradient + Skew + Border",
  description: "A fitted card with four border edges, an outer dashed frame, and gradient text.",
  source: `import { Canvas, Flex, Inline, Text } from "@boundsvg/core";

const scene = Canvas({ width: 920, height: 420, background: "#101827" },
  Flex({ width: 920, height: 420, padding: 64, justifyContent: "center" },
    Flex({ direction: "column", gap: 16, padding: 28, background: "#1d2942",
      borderWidth: [12, 6, 18, 6], borderColor: "#45577b", borderRadius: 28,
      outline: { stroke: "#a6b8f0", strokeWidth: 2, strokeDasharray: "10,6" },
      overflow: "clip", transform: { skewXDeg: -8 }, boxShadow: "8 8 10 0 #00000066" },
      Text({ font: "${FONT_ALIAS}", fontSizePx: 48, color: "linear-gradient(90deg, #9f88ff, #55dfff)",
        textStrokes: [{ color: "#101827", widthPx: 2 }], textShadows: [{ dx: 2, dy: 3, blurPx: 2, color: "#00000099" }] },
        "One shared ", Inline({ color: "radial-gradient(#fff4d1, #ff8eb4)" }, "paint frame")),
      Text({ font: "${FONT_ALIAS}", fontSizePx: 20, color: "#d5def2", wrap: "word" },
        "The border reserves space. The dashed outline follows this card's automatic size."),
    ),
  ),
);
const svg = engine.renderToSvg(scene);`,
  build: () =>
    Canvas(
      { width: 920, height: 420, background: "#101827" },
      Flex(
        { width: 920, height: 420, padding: 64, justifyContent: "center" },
        Flex(
          {
            direction: "column",
            gap: 16,
            padding: 28,
            background: "#1d2942",
            borderWidth: [12, 6, 18, 6],
            borderColor: "#45577b",
            borderRadius: 28,
            outline: { stroke: "#a6b8f0", strokeWidth: 2, strokeDasharray: "10,6" },
            overflow: "clip",
            transform: { skewXDeg: -8 },
            boxShadow: "8 8 10 0 #00000066",
          },
          Text(
            {
              font: FONT_ALIAS,
              fontSizePx: 48,
              color: "linear-gradient(90deg, #9f88ff, #55dfff)",
              textStrokes: [{ color: "#101827", widthPx: 2 }],
              textShadows: [{ dx: 2, dy: 3, blurPx: 2, color: "#00000099" }],
            },
            "One shared ",
            Inline({ color: "radial-gradient(#fff4d1, #ff8eb4)" }, "paint frame"),
          ),
          Text(
            { font: FONT_ALIAS, fontSizePx: 20, color: "#d5def2", wrap: "word" },
            "The border reserves space. The dashed outline follows this card's automatic size.",
          ),
        ),
      ),
    ),
};
