import { Box, Canvas, Flex, Text } from "@boundsvg/core";
import { CJK_VARFONT_ALIAS, VARFONT_ALIAS } from "../config";
import type { Preset } from "../types";

export const variableFontPreset: Preset = {
  title: "Variable Font",
  description:
    "Weight variation axis on Inter and Noto Sans CJK JP variable fonts. Same font file, different weights.",
  source: `import { Box, Canvas, Flex, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 920, height: 480, background: "#1e1e1e" },
  Flex(
    {
      direction: "column", justifyContent: "center", alignItems: "start",
      width: 920, height: 480, padding: 40, gap: 16,
    },
    Text(
      { font: "${VARFONT_ALIAS}", fontSizePx: 14, color: "#64748b" },
      "Inter Variable — wght axis",
    ),
    Text(
      { font: "${VARFONT_ALIAS}", fontSizePx: 40, color: "#f8fafc",
        fontVariationSettings: "'wght' 300", wrap: "char" },
      "Light 300 — The quick brown fox",
    ),
    Text(
      { font: "${VARFONT_ALIAS}", fontSizePx: 40, color: "#f8fafc",
        fontVariationSettings: "'wght' 700", wrap: "char" },
      "Bold 700 — The quick brown fox",
    ),
    Text(
      { font: "${VARFONT_ALIAS}", fontSizePx: 40, color: "#f8fafc",
        fontVariationSettings: "'wght' 900", wrap: "char" },
      "Black 900 — The quick brown fox",
    ),
    Box({ height: 8 }),
    Text(
      { font: "${CJK_VARFONT_ALIAS}", fontSizePx: 14, color: "#64748b" },
      "Noto Sans CJK JP Variable — wght axis",
    ),
    Text(
      { font: "${CJK_VARFONT_ALIAS}", fontSizePx: 36, color: "#a5f3fc",
        fontVariationSettings: "'wght' 300", wrap: "char" },
      "Light 300 — 日本語バリアブルフォント",
    ),
    Text(
      { font: "${CJK_VARFONT_ALIAS}", fontSizePx: 36, color: "#a5f3fc",
        fontVariationSettings: "'wght' 700", wrap: "char" },
      "Bold 700 — 日本語バリアブルフォント",
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 920, height: 480, background: "#1e1e1e" },
      Flex(
        {
          direction: "column",
          justifyContent: "center",
          alignItems: "start",
          width: 920,
          height: 480,
          padding: 40,
          gap: 16,
        },
        Text(
          { font: VARFONT_ALIAS, fontSizePx: 14, color: "#64748b" },
          "Inter Variable — wght axis",
        ),
        Text(
          {
            font: VARFONT_ALIAS,
            fontSizePx: 40,
            color: "#f8fafc",
            fontVariationSettings: "'wght' 300",
            wrap: "char",
          },
          "Light 300 — The quick brown fox",
        ),
        Text(
          {
            font: VARFONT_ALIAS,
            fontSizePx: 40,
            color: "#f8fafc",
            fontVariationSettings: "'wght' 700",
            wrap: "char",
          },
          "Bold 700 — The quick brown fox",
        ),
        Text(
          {
            font: VARFONT_ALIAS,
            fontSizePx: 40,
            color: "#f8fafc",
            fontVariationSettings: "'wght' 900",
            wrap: "char",
          },
          "Black 900 — The quick brown fox",
        ),
        Box({ height: 8 }),
        Text(
          { font: CJK_VARFONT_ALIAS, fontSizePx: 14, color: "#64748b" },
          "Noto Sans CJK JP Variable — wght axis",
        ),
        Text(
          {
            font: CJK_VARFONT_ALIAS,
            fontSizePx: 36,
            color: "#a5f3fc",
            fontVariationSettings: "'wght' 300",
            wrap: "char",
          },
          "Light 300 — 日本語バリアブルフォント",
        ),
        Text(
          {
            font: CJK_VARFONT_ALIAS,
            fontSizePx: 36,
            color: "#a5f3fc",
            fontVariationSettings: "'wght' 700",
            wrap: "char",
          },
          "Bold 700 — 日本語バリアブルフォント",
        ),
      ),
    ),
};
