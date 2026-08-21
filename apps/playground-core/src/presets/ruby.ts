import { Box, Canvas, Flex, Rt, Ruby, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

export const rubyPreset: Preset = {
  title: "Ruby Layout",
  description:
    "Over and under ruby annotations in horizontal/vertical layouts with constrained multi-char wrap.",
  source: `import { Box, Canvas, Flex, Rt, Ruby, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 920, height: 540, background: "#222222" },
  Flex(
    { direction: "row", width: 700, height: 540, padding: 24, gap: 24 },
    Flex({ direction: "column", flexGrow: 1, gap: 16 },
      Text({ font: "${FA}", fontSizePx: 38, color: "#f8fafc", wrap: "char", lineHeight: 1.45 },
        "東",
        Ruby({ rubyPosition: "over", rubyAlign: "center", rubyOffsetPx: 0 }, "京", Rt({ fontSizePx: 15, color: "#fca5a5" }, "きょう")),
        "都と",
        Ruby({ rubyPosition: "under", rubyOffsetPx: 0 }, "大", Rt({ fontSizePx: 15, color: "#93c5fd" }, "おお")),
        "阪を巡る散歩",
      ),
      Box({ width: 400 },
        Text({ font: "${FA}", fontSizePx: 16, color: "#94a3b8", wrap: "char", lineHeight: 1.6 },
          "横組み・縦組みの over / under、gap/offset の微調整、読みと英訳を上下に分ける alternate ruby を確認できます。",
        ),
      ),
      Flex(
        {
          direction: "column",
          width: 340,
          gap: 8,
          padding: 14,
          background: "#1e1e1e",
          borderRadius: 14,
        },
        Text({ font: "${FA}", fontSizePx: 13, color: "#64748b", wrap: "char" },
          "Alternate ruby with translation.",
        ),
        Flex({ direction: "row", width: 312 },
          Text(
            {
              font: "${FA}",
              fontSizePx: 24,
              color: "#dbeafe",
              wrap: "char",
              lineHeight: 1.55,
              flexGrow: 1,
              fit: "shrink",
              preferredFrame: { w: 250 },
            },
            "週末は",
            Ruby(
              { rubyPosition: "alternate", rubyAlign: "center", rubyOffsetPx: 0 },
              "東京",
              Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "とうきょう"),
              Rt({ fontSizePx: 10, lineHeight: 1, color: "#93c5fd" }, "Tokyo"),
            ),
            Ruby(
              { rubyPosition: "alternate", rubyAlign: "center", rubyOffsetPx: 0 },
              "大学",
              Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "だいがく"),
              Rt({ fontSizePx: 10, lineHeight: 1, color: "#93c5fd" }, "University"),
            ),
            "の案内を巡ります。",
          ),
        ),
      ),
      Flex(
        {
          direction: "column",
          width: 340,
          gap: 8,
          padding: 12,
          background: "#18181b",
          borderRadius: 8,
        },
        Text({ font: "${FA}", fontSizePx: 13, color: "#64748b", wrap: "none" },
          "rubyLineSizing stable / default css.",
        ),
        Flex({ direction: "row", width: 316, gap: 12 },
          Box({ position: "relative", width: 152, height: 96, background: "#111827", borderRadius: 8 },
            Text({ position: "absolute", top: 8, left: 8, font: "${FA}", fontSizePx: 12, color: "#94a3b8", wrap: "none" }, "stable"),
            Text({ position: "absolute", top: 28, left: 8, font: "${FA}", fontSizePx: 24, color: "#f8fafc", lineHeight: 1.25 },
              Ruby(
                { rubyPosition: "over", rubyAlign: "center", rubyLineSizing: "stable" },
                "京都",
                Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "きょうと"),
              ),
              "へ",
            ),
          ),
          Box({ position: "relative", width: 152, height: 96, background: "#111827", borderRadius: 8 },
            Text({ position: "absolute", top: 8, left: 8, font: "${FA}", fontSizePx: 12, color: "#94a3b8", wrap: "none" }, "default css"),
            Text({ position: "absolute", top: 42, left: 8, font: "${FA}", fontSizePx: 24, color: "#f8fafc", lineHeight: 1.25 },
              Ruby(
                { rubyPosition: "over", rubyAlign: "center" },
                "京都",
                Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "きょうと"),
              ),
              "へ",
            ),
          ),
        ),
      ),
    ),
    Flex(
      {
        direction: "column",
        width: 208,
        height: 412,
        gap: 12,
        padding: 14,
        background: "#1e1e1e",
        borderRadius: 14,
      },
      Text({ font: "${FA}", fontSizePx: 13, color: "#64748b", wrap: "char" },
        "Vertical rubyPosition over / under with constrained multi-character wrap.",
      ),
      Flex({ direction: "row", width: 180, height: 334 },
        Text(
          {
            font: "${FA}",
            fontSizePx: 28,
            color: "#fde68a",
            writingMode: "vertical-rl",
            lineHeight: 1.35,
            wrap: "char",
            language: "ja",
            flexGrow: 1,
            preferredFrame: { h: 334 },
          },
          Ruby(
            { rubyPosition: "over", rubyAlign: "space-around" },
            "古都散策",
            Rt({ fontSizePx: 11, lineHeight: 1, color: "#fca5a5" }, "ことさんさく"),
          ),
          "では",
          Ruby(
            { rubyPosition: "under", rubyAlign: "space-between" },
            "都案内",
            Rt({ fontSizePx: 11, lineHeight: 1, color: "#93c5fd" }, "みやこあんない"),
          ),
          "を片手に巡ります。",
        ),
      ),
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 920, height: 540, background: "#222222" },
      Flex(
        { direction: "row", width: 700, height: 540, padding: 24, gap: 24 },
        Flex(
          { direction: "column", flexGrow: 1, gap: 16 },
          Text(
            { font: FA, fontSizePx: 38, color: "#f8fafc", wrap: "char", lineHeight: 1.45 },
            "東",
            Ruby(
              { rubyPosition: "over", rubyAlign: "center", rubyOffsetPx: 0 },
              "京",
              Rt({ fontSizePx: 15, color: "#fca5a5" }, "きょう"),
            ),
            "都と",
            Ruby(
              { rubyPosition: "under", rubyOffsetPx: 0 },
              "大",
              Rt({ fontSizePx: 15, color: "#93c5fd" }, "おお"),
            ),
            "阪を巡る散歩",
          ),
          Box(
            { width: 400 },
            Text(
              { font: FA, fontSizePx: 16, color: "#94a3b8", wrap: "char", lineHeight: 1.6 },
              "横組み・縦組みの over / under、gap/offset の微調整、読みと英訳を上下に分ける alternate ruby を確認できます。",
            ),
          ),
          Flex(
            {
              direction: "column",
              width: 340,
              gap: 8,
              padding: 14,
              background: "#1e1e1e",
              borderRadius: 14,
            },
            Text(
              { font: FA, fontSizePx: 13, color: "#64748b", wrap: "char" },
              "Alternate ruby with translation.",
            ),
            Flex(
              { direction: "row", width: 312 },
              Text(
                {
                  font: FA,
                  fontSizePx: 24,
                  color: "#dbeafe",
                  wrap: "char",
                  lineHeight: 1.55,
                  flexGrow: 1,
                  fit: "shrink",
                  preferredFrame: { w: 250 },
                },
                "週末は",
                Ruby(
                  { rubyPosition: "alternate", rubyAlign: "center", rubyOffsetPx: 0 },
                  "東京",
                  Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "とうきょう"),
                  Rt({ fontSizePx: 10, lineHeight: 1, color: "#93c5fd" }, "Tokyo"),
                ),
                Ruby(
                  { rubyPosition: "alternate", rubyAlign: "center", rubyOffsetPx: 0 },
                  "大学",
                  Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "だいがく"),
                  Rt({ fontSizePx: 10, lineHeight: 1, color: "#93c5fd" }, "University"),
                ),
                "の案内を巡ります。",
              ),
            ),
          ),
          Flex(
            {
              direction: "column",
              width: 340,
              gap: 8,
              padding: 12,
              background: "#18181b",
              borderRadius: 8,
            },
            Text(
              { font: FA, fontSizePx: 13, color: "#64748b", wrap: "none" },
              "rubyLineSizing stable / default css.",
            ),
            Flex(
              { direction: "row", width: 316, gap: 12 },
              Box(
                {
                  position: "relative",
                  width: 152,
                  height: 96,
                  background: "#111827",
                  borderRadius: 8,
                },
                Text(
                  {
                    position: "absolute",
                    top: 8,
                    left: 8,
                    font: FA,
                    fontSizePx: 12,
                    color: "#94a3b8",
                    wrap: "none",
                  },
                  "stable",
                ),
                Text(
                  {
                    position: "absolute",
                    top: 28,
                    left: 8,
                    font: FA,
                    fontSizePx: 24,
                    color: "#f8fafc",
                    lineHeight: 1.25,
                  },
                  Ruby(
                    { rubyPosition: "over", rubyAlign: "center", rubyLineSizing: "stable" },
                    "京都",
                    Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "きょうと"),
                  ),
                  "へ",
                ),
              ),
              Box(
                {
                  position: "relative",
                  width: 152,
                  height: 96,
                  background: "#111827",
                  borderRadius: 8,
                },
                Text(
                  {
                    position: "absolute",
                    top: 8,
                    left: 8,
                    font: FA,
                    fontSizePx: 12,
                    color: "#94a3b8",
                    wrap: "none",
                  },
                  "default css",
                ),
                Text(
                  {
                    position: "absolute",
                    top: 42,
                    left: 8,
                    font: FA,
                    fontSizePx: 24,
                    color: "#f8fafc",
                    lineHeight: 1.25,
                  },
                  Ruby(
                    { rubyPosition: "over", rubyAlign: "center" },
                    "京都",
                    Rt({ fontSizePx: 10, lineHeight: 1, color: "#fca5a5" }, "きょうと"),
                  ),
                  "へ",
                ),
              ),
            ),
          ),
        ),
        Flex(
          {
            direction: "column",
            width: 208,
            height: 412,
            gap: 12,
            padding: 14,
            background: "#1e1e1e",
            borderRadius: 14,
          },
          Text(
            { font: FA, fontSizePx: 13, color: "#64748b", wrap: "char" },
            "Vertical rubyPosition over / under with constrained multi-character wrap.",
          ),
          Flex(
            { direction: "row", width: 180, height: 334 },
            Text(
              {
                font: FA,
                fontSizePx: 28,
                color: "#fde68a",
                writingMode: "vertical-rl",
                lineHeight: 1.35,
                wrap: "char",
                language: "ja",
                flexGrow: 1,
                preferredFrame: { h: 334 },
              },
              Ruby(
                { rubyPosition: "over", rubyAlign: "space-around" },
                "古都散策",
                Rt({ fontSizePx: 11, lineHeight: 1, color: "#fca5a5" }, "ことさんさく"),
              ),
              "では",
              Ruby(
                { rubyPosition: "under", rubyAlign: "space-between" },
                "都案内",
                Rt({ fontSizePx: 11, lineHeight: 1, color: "#93c5fd" }, "みやこあんない"),
              ),
              "を片手に巡ります。",
            ),
          ),
        ),
      ),
    ),
};
