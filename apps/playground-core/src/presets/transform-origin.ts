import { Box, Canvas, Flex, Text } from "@boundsvg/core";
import { FONT_ALIAS } from "../config";
import type { Preset } from "../types";

/** Content-sized Text rotated around its completed layout-box center. */
export const transformOriginPreset: Preset = {
  title: "Text Transform Origin",
  description:
    "Short and multiline Text use their own layout centers, including asymmetric padding.",
  source: `import { Box, Canvas, Flex, Text } from "@boundsvg/core";

const scene = Canvas({ width: 880, height: 420, background: "#101827" },
  Flex({ direction: "row", width: 880, height: 420, gap: 80, padding: 80, alignItems: "center", justifyContent: "center" },
    Box({ background: "#375574", borderWidth: 2, borderColor: "#8bc9e8" },
      Text({ font: "${FONT_ALIAS}", fontSizePx: 32, color: "#ffffff", padding: [12, 28, 20, 8],
        transformOrigin: "center", transform: { rotateDeg: -15 } }, "Short")),
    Box({ background: "#654579", borderWidth: 2, borderColor: "#dcb2ef" },
      Text({ font: "${FONT_ALIAS}", fontSizePx: 32, whiteSpace: "pre-wrap", color: "#ffffff", padding: [12, 28, 20, 8],
        transformOrigin: { x: 0.5, y: 0.5 }, transform: { rotateDeg: 15 } }, "Longer text\\nSecond line")),
  ),
);
const svg = engine.renderToSvg(scene);`,
  build: () =>
    Canvas(
      { width: 880, height: 420, background: "#101827" },
      Flex(
        {
          direction: "row",
          width: 880,
          height: 420,
          gap: 80,
          padding: 80,
          alignItems: "center",
          justifyContent: "center",
        },
        Box(
          { background: "#375574", borderWidth: 2, borderColor: "#8bc9e8" },
          Text(
            {
              font: FONT_ALIAS,
              fontSizePx: 32,
              color: "#ffffff",
              padding: [12, 28, 20, 8],
              transformOrigin: "center",
              transform: { rotateDeg: -15 },
            },
            "Short",
          ),
        ),
        Box(
          { background: "#654579", borderWidth: 2, borderColor: "#dcb2ef" },
          Text(
            {
              font: FONT_ALIAS,
              fontSizePx: 32,
              color: "#ffffff",
              whiteSpace: "pre-wrap",
              padding: [12, 28, 20, 8],
              transformOrigin: { x: 0.5, y: 0.5 },
              transform: { rotateDeg: 15 },
            },
            "Longer text\nSecond line",
          ),
        ),
      ),
    ),
};
