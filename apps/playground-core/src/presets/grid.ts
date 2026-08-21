import { Box, Canvas, Grid, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

export const gridPreset: Preset = {
  title: "Grid Layout",
  description: "Info cards using Grid + Box + Text.",
  source: `import { Box, Canvas, Grid, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 920, height: 420, background: "#161616" },
  Grid(
    { templateColumns: "2fr 1fr", templateRows: "1fr 1fr",
      rowGap: 20, columnGap: 12, width: 920, height: 420, padding: 24 },
    Box(
      { gridColumn: "1 / 2", gridRow: "1 / 3",
        background: "#2d2d2d", borderRadius: 16, padding: 20,
        boxShadow: "0 4 12 0 rgba(0,0,0,0.3)" },
      Text({ font: "${FA}", fontSizePx: 34, color: "#f8fafc", wrap: "char",
        flexBasis: 80, flexShrink: 0 },
        "Main Content"),
    ),
    Box(
      { gridColumn: "2 / 3", gridRow: "1 / 2",
        background: "#0f766e", borderRadius: 16, padding: 16 },
      Text({ font: "${FA}", fontSizePx: 24, color: "#ecfeff", wrap: "char" },
        "Stats A"),
    ),
    Box(
      { gridColumn: "2 / 3", gridRow: "2 / 3",
        background: "#7c2d12", borderRadius: 16, padding: 16,
        margin: [16, 0, 0, 0] },
      Text({ font: "${FA}", fontSizePx: 24, color: "#ffedd5", wrap: "char" },
        "Stats B"),
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 920, height: 420, background: "#161616" },
      Grid(
        {
          templateColumns: "2fr 1fr",
          templateRows: "1fr 1fr",
          rowGap: 20,
          columnGap: 12,
          width: 920,
          height: 420,
          padding: 24,
        },
        Box(
          {
            gridColumn: "1 / 2",
            gridRow: "1 / 3",
            background: "#2d2d2d",
            borderRadius: 16,
            padding: 20,
            boxShadow: "0 4 12 0 rgba(0,0,0,0.3)",
          },
          Text(
            {
              font: FA,
              fontSizePx: 34,
              color: "#f8fafc",
              wrap: "char",
              flexBasis: 80,
              flexShrink: 0,
            },
            "Main Content",
          ),
        ),
        Box(
          {
            gridColumn: "2 / 3",
            gridRow: "1 / 2",
            background: "#0f766e",
            borderRadius: 16,
            padding: 16,
          },
          Text({ font: FA, fontSizePx: 24, color: "#ecfeff", wrap: "char" }, "Stats A"),
        ),
        Box(
          {
            gridColumn: "2 / 3",
            gridRow: "2 / 3",
            background: "#7c2d12",
            borderRadius: 16,
            padding: 16,
            margin: [16, 0, 0, 0],
          },
          Text({ font: FA, fontSizePx: 24, color: "#ffedd5", wrap: "char" }, "Stats B"),
        ),
      ),
    ),
};
