import { Box, Canvas, Flex, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

export const transformPreset: Preset = {
  title: "Transform",
  description: "Translate / rotate / scale applied at paint time on sibling boxes.",
  source: `import { Box, Canvas, Flex, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 560, height: 240, background: "#0f172a" },
  Flex(
    { direction: "row", width: 560, height: 240,
      justifyContent: "center", alignItems: "center", gap: 32 },
    Box({ width: 120, height: 120, background: "#6366f1", borderRadius: 16,
      transform: { translateX: 12, translateY: -8 } }),
    Box({ width: 120, height: 120, background: "#f97316", borderRadius: 16,
      transform: { rotateDeg: 20, originX: 60, originY: 60 } }),
    Box({ width: 120, height: 120, background: "#14b8a6", borderRadius: 16,
      transform: { scaleX: 1.1, scaleY: 0.85, originX: 60, originY: 60 } }),
    Text({ font: "${FA}", fontSizePx: 16, color: "#94a3b8",
      position: "absolute", top: 204, left: 24 },
      "translate / rotate / scale — paint-only, layout bbox unchanged"),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 560, height: 240, background: "#0f172a" },
      Flex(
        {
          direction: "row",
          width: 560,
          height: 240,
          justifyContent: "center",
          alignItems: "center",
          gap: 32,
        },
        Box({
          width: 120,
          height: 120,
          background: "#6366f1",
          borderRadius: 16,
          transform: { translateX: 12, translateY: -8 },
        }),
        Box({
          width: 120,
          height: 120,
          background: "#f97316",
          borderRadius: 16,
          transform: { rotateDeg: 20, originX: 60, originY: 60 },
        }),
        Box({
          width: 120,
          height: 120,
          background: "#14b8a6",
          borderRadius: 16,
          transform: { scaleX: 1.1, scaleY: 0.85, originX: 60, originY: 60 },
        }),
        Text(
          {
            font: FA,
            fontSizePx: 16,
            color: "#94a3b8",
            position: "absolute",
            top: 204,
            left: 24,
          },
          "translate / rotate / scale — paint-only, layout bbox unchanged",
        ),
      ),
    ),
};
