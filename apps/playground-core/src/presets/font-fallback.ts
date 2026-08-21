import { Canvas, Flex, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA, JETBRAINS_ALIAS, MONASPACE_ALIAS } from "../config";
import type { Preset } from "../types";

export const fontFallbackPreset: Preset = {
  title: "Font Fallback",
  description:
    "Glyphs missing from a Latin-only font are resolved via the fallback chain to a CJK font.",
  source: `import { Canvas, Flex, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 920, height: 420, background: "#1e1e1e" },
  Flex(
    { direction: "column", justifyContent: "center", alignItems: "start",
      width: 920, height: 420, padding: 40, gap: 20 },
    Text(
      { font: "${FA}", fontSizePx: 14, color: "#64748b" },
      "Primary: JetBrains Mono → Fallback: Noto Sans JP",
    ),
    Text(
      { font: "${JETBRAINS_ALIAS}",
        fallback: ["${FA}", "monospace"],
        fontSizePx: 32, color: "#f8fafc", wrap: "char", lineHeight: 1.5 },
      "English glyphs from JetBrains Mono. 日本語グリフは Noto Sans JP から解決される。",
    ),
    Text(
      { font: "${FA}", fontSizePx: 14, color: "#64748b" },
      "Primary: Monaspace Neon → Fallback: Noto Sans JP",
    ),
    Text(
      { font: "${MONASPACE_ALIAS}",
        fallback: ["${FA}", "monospace"],
        fontSizePx: 32, color: "#a5f3fc", wrap: "char", lineHeight: 1.5 },
      "Latin from Monaspace. 混在テキストの fallback 確認。ABC123 と漢字カナ。",
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 920, height: 420, background: "#1e1e1e" },
      Flex(
        {
          direction: "column",
          justifyContent: "center",
          alignItems: "start",
          width: 920,
          height: 420,
          padding: 40,
          gap: 20,
        },
        Text(
          { font: FA, fontSizePx: 14, color: "#64748b" },
          "Primary: JetBrains Mono → Fallback: Noto Sans JP",
        ),
        Text(
          {
            font: JETBRAINS_ALIAS,
            fallback: [FA, "monospace"],
            fontSizePx: 32,
            color: "#f8fafc",
            wrap: "char",
            lineHeight: 1.5,
          },
          "English glyphs from JetBrains Mono. 日本語グリフは Noto Sans JP から解決される。",
        ),
        Text(
          { font: FA, fontSizePx: 14, color: "#64748b" },
          "Primary: Monaspace Neon → Fallback: Noto Sans JP",
        ),
        Text(
          {
            font: MONASPACE_ALIAS,
            fallback: [FA, "monospace"],
            fontSizePx: 32,
            color: "#a5f3fc",
            wrap: "char",
            lineHeight: 1.5,
          },
          "Latin from Monaspace. 混在テキストの fallback 確認。ABC123 と漢字カナ。",
        ),
      ),
    ),
};
