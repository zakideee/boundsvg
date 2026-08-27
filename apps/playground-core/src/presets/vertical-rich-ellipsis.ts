import { Canvas, Flex, Inline, InlineBox, Rt, Ruby, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

/** Demonstrate vertical rich-text ellipsis across authored inline boundaries. */
export const verticalRichEllipsisPreset: Preset = {
  title: "Vertical Rich Ellipsis",
  description:
    "A three-column vertical rich-text frame. Ellipsis preserves grapheme, ruby, atomic inline, nested decoration, and source-style boundaries.",
  source: `import { Canvas, Flex, Inline, InlineBox, Rt, Ruby, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 720, height: 400, background: "#111827" },
  Flex(
    {
      direction: "row",
      alignItems: "center",
      width: 720,
      height: 400,
      padding: [32, 40, 32, 40],
      gap: 32,
    },
    Flex(
      { direction: "column", width: 280, gap: 12 },
      Text(
        { font: "${FA}", fontSizePx: 14, color: "#60a5fa", wrap: "none" },
        "VERTICAL RICH TEXT",
      ),
      Text(
        { font: "${FA}", fontSizePx: 28, color: "#f8fafc", wrap: "char" },
        "三列で安全に省略",
      ),
      Text(
        { font: "${FA}", fontSizePx: 14, color: "#94a3b8", wrap: "char", lineHeight: 1.55 },
        "ルビや原子的なインラインを分断せず、装飾された最長の合法な接頭辞を選びます。",
      ),
    ),
    Flex(
      {
        direction: "row",
        justifyContent: "center",
        alignItems: "center",
        width: 328,
        height: 336,
        padding: 18,
        background: "#1e293b",
        borderWidth: 1,
        borderColor: "#334155",
        borderRadius: 18,
        overflow: "clip",
      },
      Text(
        {
          font: "${FA}",
          fontSizePx: 24,
          color: "#e2e8f0",
          writingMode: "vertical-rl",
          wrap: "char",
          language: "ja",
          lineHeight: 1.35,
          maxLines: 3,
          ellipsis: true,
          width: 278,
          height: 286,
        },
        "縦組みの",
        Inline({ color: "#7dd3fc", fontWeight: 700 }, "リッチ"),
        "文章は",
        Ruby(
          { rubyPosition: "over", rubyAlign: "center" },
          "境界",
          Rt({ fontSizePx: 10, lineHeight: 1, color: "#fda4af" }, "きょうかい"),
        ),
        "と",
        InlineBox(
          {
            background: "#164e63",
            paddingInline: [4, 4],
            borderRadius: 4,
            color: "#a5f3fc",
          },
          "原子",
        ),
        "を保ち、",
        Inline(
          {
            color: "#fde68a",
            textDecoration: { line: "underline", color: "#f59e0b", thicknessPx: 2 },
          },
          Inline({ fontWeight: 700 }, "最長の合法な接頭辞を選んで表示します。"),
          "省略された末尾の装飾や警告は採用されません。",
        ),
      ),
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 720, height: 400, background: "#111827" },
      Flex(
        {
          direction: "row",
          alignItems: "center",
          width: 720,
          height: 400,
          padding: [32, 40, 32, 40],
          gap: 32,
        },
        Flex(
          { direction: "column", width: 280, gap: 12 },
          Text({ font: FA, fontSizePx: 14, color: "#60a5fa", wrap: "none" }, "VERTICAL RICH TEXT"),
          Text({ font: FA, fontSizePx: 28, color: "#f8fafc", wrap: "char" }, "三列で安全に省略"),
          Text(
            {
              font: FA,
              fontSizePx: 14,
              color: "#94a3b8",
              wrap: "char",
              lineHeight: 1.55,
            },
            "ルビや原子的なインラインを分断せず、装飾された最長の合法な接頭辞を選びます。",
          ),
        ),
        Flex(
          {
            direction: "row",
            justifyContent: "center",
            alignItems: "center",
            width: 328,
            height: 336,
            padding: 18,
            background: "#1e293b",
            borderWidth: 1,
            borderColor: "#334155",
            borderRadius: 18,
            overflow: "clip",
          },
          Text(
            {
              font: FA,
              fontSizePx: 24,
              color: "#e2e8f0",
              writingMode: "vertical-rl",
              wrap: "char",
              language: "ja",
              lineHeight: 1.35,
              maxLines: 3,
              ellipsis: true,
              width: 278,
              height: 286,
            },
            "縦組みの",
            Inline({ color: "#7dd3fc", fontWeight: 700 }, "リッチ"),
            "文章は",
            Ruby(
              { rubyPosition: "over", rubyAlign: "center" },
              "境界",
              Rt({ fontSizePx: 10, lineHeight: 1, color: "#fda4af" }, "きょうかい"),
            ),
            "と",
            InlineBox(
              {
                background: "#164e63",
                paddingInline: [4, 4],
                borderRadius: 4,
                color: "#a5f3fc",
              },
              "原子",
            ),
            "を保ち、",
            Inline(
              {
                color: "#fde68a",
                textDecoration: {
                  line: "underline",
                  color: "#f59e0b",
                  thicknessPx: 2,
                },
              },
              Inline({ fontWeight: 700 }, "最長の合法な接頭辞を選んで表示します。"),
              "省略された末尾の装飾や警告は採用されません。",
            ),
          ),
        ),
      ),
    ),
};
