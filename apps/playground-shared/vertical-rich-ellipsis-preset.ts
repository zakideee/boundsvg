import { Box, Canvas, Flex, Inline, InlineBox, Rt, Ruby, Text, type VNode } from "@boundsvg/core";

/** Font alias registered by both playground runtimes. */
const FONT_ALIAS = "NotoSansJP-woff2";

/** Metadata shared by the core and React playground selectors. */
export const verticalRichEllipsisPresetMetadata = {
  key: "vertical-rich-ellipsis",
  label: "Vertical Rich Ellipsis",
  description:
    "Vertical rich text keeps ruby, inline styling, and atomic inline content while maxLines ends the final column with an ellipsis.",
} as const;

/** Minimal standalone source displayed by the core playground. */
export const VERTICAL_RICH_ELLIPSIS_SOURCE = `import {
  Box,
  Canvas,
  Inline,
  InlineBox,
  Rt,
  Ruby,
  Text,
} from "@boundsvg/core";

const vnode = Canvas(
  { width: 640, height: 360, background: "#0f172a" },
  Box(
    { position: "absolute", left: 404, top: 104, width: 72, height: 214 },
    Text(
      {
        id: "vertical-rich-ellipsis-text",
        font: "${FONT_ALIAS}",
        fontSizePx: 24,
        color: "#f8fafc",
        language: "ja",
        writingMode: "vertical-rl",
        width: 72,
        height: 214,
        maxLines: 2,
        ellipsis: true,
      },
      "縦書き",
      Ruby({}, "東京", Rt({ fontSizePx: 12, color: "#fbbf24" }, "とうきょう")),
      InlineBox(
        {
          background: "#164e63",
          color: "#67e8f9",
          paddingInline: [3, 3],
          borderRadius: 3,
        },
        "注",
      ),
      Inline({ color: "#fca5a5", background: "#7f1d1d" }, "の省略表示"),
      "を検証する長い文章です。リッチな子要素を保ったまま最後の列を省略します。",
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`;

/** Builds the vertical rich-text ellipsis scene used by both playgrounds. */
export function buildVerticalRichEllipsisVNode(): VNode {
  return Canvas(
    { width: 640, height: 360, background: "#0f172a" },
    Box({
      position: "absolute",
      left: 20,
      top: 20,
      width: 600,
      height: 320,
      background: "#111827",
      borderColor: "#334155",
      borderWidth: 1,
      borderRadius: 16,
    }),
    Box(
      { position: "absolute", left: 46, top: 42, width: 548, height: 26 },
      Text(
        { font: FONT_ALIAS, fontSizePx: 20, color: "#f8fafc", wrap: "none" },
        "Vertical rich text",
      ),
    ),
    Box(
      { position: "absolute", left: 46, top: 92, width: 232, height: 52 },
      Text(
        { font: FONT_ALIAS, fontSizePx: 15, color: "#cbd5e1", wrap: "char" },
        "2列で打ち切り、最後の列を…で終了",
      ),
    ),
    Flex(
      {
        position: "absolute",
        left: 46,
        top: 164,
        width: 102,
        height: 32,
        background: "#78350f",
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
      },
      Text({ font: FONT_ALIAS, fontSizePx: 13, color: "#fde68a", wrap: "none" }, "Ruby / Rt"),
    ),
    Flex(
      {
        position: "absolute",
        left: 158,
        top: 164,
        width: 104,
        height: 32,
        background: "#7f1d1d",
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
      },
      Text({ font: FONT_ALIAS, fontSizePx: 13, color: "#fecaca", wrap: "none" }, "Inline style"),
    ),
    Flex(
      {
        position: "absolute",
        left: 46,
        top: 206,
        width: 216,
        height: 32,
        background: "#164e63",
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
      },
      Text(
        { font: FONT_ALIAS, fontSizePx: 13, color: "#a5f3fc", wrap: "none" },
        "InlineBox stays atomic",
      ),
    ),
    Box(
      { position: "absolute", left: 46, top: 266, width: 232, height: 42 },
      Text(
        { font: FONT_ALIAS, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
        "maxLines=2 · ellipsis=true · vertical-rl",
      ),
    ),
    Box({
      position: "absolute",
      left: 318,
      top: 82,
      width: 244,
      height: 246,
      background: "#0f172a",
      borderColor: "#475569",
      borderWidth: 1,
      borderRadius: 10,
    }),
    Box(
      { position: "absolute", left: 404, top: 104, width: 72, height: 214 },
      Text(
        {
          id: "vertical-rich-ellipsis-text",
          font: FONT_ALIAS,
          fontSizePx: 24,
          color: "#f8fafc",
          language: "ja",
          writingMode: "vertical-rl",
          width: 72,
          height: 214,
          maxLines: 2,
          ellipsis: true,
        },
        "縦書き",
        Ruby({}, "東京", Rt({ fontSizePx: 12, color: "#fbbf24" }, "とうきょう")),
        InlineBox(
          {
            background: "#164e63",
            color: "#67e8f9",
            paddingInline: [3, 3],
            borderRadius: 3,
          },
          "注",
        ),
        Inline({ color: "#fca5a5", background: "#7f1d1d" }, "の省略表示"),
        "を検証する長い文章です。リッチな子要素を保ったまま最後の列を省略します。",
      ),
    ),
  );
}
