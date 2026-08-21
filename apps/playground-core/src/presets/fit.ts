import { Canvas, Flex, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

export const fitPreset: Preset = {
  title: "Fit + Stroke",
  description: "Auto-shrinking text with ellipsis and text stroke outline.",
  source: `import { Box, Canvas, Flex, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 920, height: 320, background: "#1a1a1a" },
  Flex(
    { direction: "column", width: 920, height: 320, padding: 20 },
    Flex(
      { direction: "column", justifyContent: "center", alignItems: "center",
        flexGrow: 1, padding: 24, background: "#252526",
        borderWidth: 1, borderColor: "#474747", borderRadius: 16,
        strokeDasharray: "8,4", strokeLinecap: "round",
        overflow: "clip" },
      Text(
        { font: "${FA}", fontSizePx: 64, minFontSizePx: 18,
          fit: "shrink", wrap: "char", maxLines: 2, ellipsis: true,
          lineHeight: 1.15, color: "#e2e8f0", textAlign: "center",
          textStroke: "#f59e0b", textStrokeWidth: 2 },
        "This is an example of a very long title. Even when the text exceeds the available area, it automatically shrinks to fit, adding an ellipsis if needed.",
      ),
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 920, height: 320, background: "#1a1a1a" },
      Flex(
        { direction: "column", width: 920, height: 320, padding: 20 },
        Flex(
          {
            direction: "column",
            justifyContent: "center",
            alignItems: "center",
            flexGrow: 1,
            padding: 24,
            background: "#252526",
            borderWidth: 1,
            borderColor: "#474747",
            borderRadius: 16,
            strokeDasharray: "8,4",
            strokeLinecap: "round",
            overflow: "clip",
          },
          Text(
            {
              font: FA,
              fontSizePx: 64,
              minFontSizePx: 18,
              fit: "shrink",
              wrap: "char",
              maxLines: 2,
              ellipsis: true,
              lineHeight: 1.15,
              color: "#e2e8f0",
              textAlign: "center",
              textStroke: "#f59e0b",
              textStrokeWidth: 2,
            },
            "This is an example of a very long title. Even when the text exceeds the available area, it automatically shrinks to fit, adding an ellipsis if needed.",
          ),
        ),
      ),
    ),
};
