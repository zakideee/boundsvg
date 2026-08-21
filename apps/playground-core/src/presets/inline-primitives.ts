import { Canvas, Flex, Inline, InlineBox, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA, JETBRAINS_ALIAS } from "../config";
import type { Preset } from "../types";

export const inlinePrimitivesPreset: Preset = {
  title: "Inline Primitives",
  description:
    "Inline style overrides, atomic InlineBox decoration, and vertical text behavior in one comparison.",
  source: `import { Canvas, Flex, Inline, InlineBox, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 600, height: 520, background: "#1a1a1a" },
  Flex(
    { direction: "row", width: 600, height: 520, padding: 18, gap: 14 },
    Flex(
      {
        direction: "column", width: 124, height: 484,
        background: "#1e1e1e", borderRadius: 10, padding: 14, gap: 8,
      },
      Text(
        { font: "${FA}", fontSizePx: 11, color: "#64748b", wrap: "char" },
        "Vertical + Inline",
      ),
      Text(
        {
          font: "${FA}", fontSizePx: 26, color: "#fef3c7",
          writingMode: "vertical-rl", lineHeight: 1.28,
          wrap: "char", language: "ja", flexGrow: 1,
        },
        "西暦",
        Inline({ textCombineUpright: "all", color: "#fca5a5" }, "2026"),
        "年の",
        Inline({ textOrientation: "upright", color: "#93c5fd", letterSpacingPx: 2 }, "API"),
        "設計を縦組みで確認します。",
      ),
    ),
    Flex(
      { direction: "column", width: 426, gap: 12 },
      Flex(
        { direction: "row", gap: 12 },
        Flex(
          {
            direction: "column", width: 207,
            background: "#1e1e1e", borderRadius: 10, padding: 14, gap: 8,
          },
          Text(
            { font: "${FA}", fontSizePx: 11, color: "#64748b", wrap: "char" },
            "Inline — style override only",
          ),
          Text(
            { font: "${FA}", fontSizePx: 18, color: "#e2e8f0", wrap: "char", lineHeight: 1.55 },
            "Version ",
            Inline({ color: "#fca5a5", fontWeight: 700 }, "beta"),
            " uses the ",
            Inline({ font: "${JETBRAINS_ALIAS}", color: "#c4b5fd", fontSizePx: 18, letterSpacingPx: 1 }, "API"),
            " endpoint with code ",
            Inline({ color: "#fde68a" }, "WARN"),
            ".",
          ),
        ),
        Flex(
          {
            direction: "column", width: 207,
            background: "#1e1e1e", borderRadius: 10, padding: 14, gap: 8,
          },
          Text(
            { font: "${FA}", fontSizePx: 11, color: "#64748b", wrap: "char" },
            "InlineBox — decoration + atomic",
          ),
          Text(
            { font: "${FA}", fontSizePx: 18, color: "#e2e8f0", wrap: "char", lineHeight: 1.55 },
            "Version ",
            InlineBox(
              { background: "#7f1d1d", paddingInline: [6, 6], borderRadius: 4, color: "#fca5a5" },
              "beta",
            ),
            " uses the ",
            InlineBox(
              { font: "${JETBRAINS_ALIAS}", background: "#1e1b4b", paddingInline: [6, 6], borderRadius: 4, color: "#c4b5fd", fontSizePx: 18 },
              "API",
            ),
            " endpoint with code ",
            InlineBox(
              { background: "#422006", paddingInline: [6, 6], borderRadius: 4, color: "#fde68a" },
              "WARN",
            ),
            ".",
          ),
        ),
      ),
      Flex(
        { direction: "row", gap: 12 },
        Flex(
          {
            direction: "column", width: 207,
            background: "#1e1e1e", borderRadius: 10, padding: 14, gap: 8,
          },
          Text(
            { font: "${FA}", fontSizePx: 11, color: "#64748b", wrap: "char" },
            "Inline wraps mid-token",
          ),
          Text(
            { font: "${FA}", fontSizePx: 17, color: "#94a3b8", wrap: "char", lineHeight: 1.6 },
            "Prefix ",
            Inline({ color: "#a5f3fc", fontWeight: 700 }, "inline-token-can-break"),
            " suffix.",
          ),
        ),
        Flex(
          {
            direction: "column", width: 207,
            background: "#1e1e1e", borderRadius: 10, padding: 14, gap: 8,
          },
          Text(
            { font: "${FA}", fontSizePx: 11, color: "#64748b", wrap: "char" },
            "InlineBox stays atomic",
          ),
          Text(
            { font: "${FA}", fontSizePx: 17, color: "#94a3b8", wrap: "char", lineHeight: 1.6 },
            "Prefix ",
            InlineBox(
              { background: "#164e63", paddingInline: [6, 6], borderRadius: 4, color: "#a5f3fc" },
              "atomic-inlinebox-token",
            ),
            " suffix.",
          ),
        ),
      ),
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 600, height: 520, background: "#1a1a1a" },
      Flex(
        { direction: "row", width: 600, height: 520, padding: 18, gap: 14 },
        Flex(
          {
            direction: "column",
            width: 124,
            height: 484,
            background: "#1e1e1e",
            borderRadius: 10,
            padding: 14,
            gap: 8,
          },
          Text({ font: FA, fontSizePx: 11, color: "#64748b", wrap: "char" }, "Vertical + Inline"),
          Text(
            {
              font: FA,
              fontSizePx: 26,
              color: "#fef3c7",
              writingMode: "vertical-rl",
              lineHeight: 1.28,
              wrap: "char",
              language: "ja",
              flexGrow: 1,
            },
            "西暦",
            Inline({ textCombineUpright: "all", color: "#fca5a5" }, "2026"),
            "年の",
            Inline({ textOrientation: "upright", color: "#93c5fd", letterSpacingPx: 2 }, "API"),
            "設計を縦組みで確認します。",
          ),
        ),
        Flex(
          { direction: "column", width: 426, gap: 12 },
          Flex(
            { direction: "row", gap: 12 },
            Flex(
              {
                direction: "column",
                width: 207,
                background: "#1e1e1e",
                borderRadius: 10,
                padding: 14,
                gap: 8,
              },
              Text(
                { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char" },
                "Inline — style override only",
              ),
              Text(
                {
                  font: FA,
                  fontSizePx: 18,
                  color: "#e2e8f0",
                  wrap: "char",
                  lineHeight: 1.55,
                },
                "Version ",
                Inline({ color: "#fca5a5", fontWeight: 700 }, "beta"),
                " uses the ",
                Inline(
                  {
                    font: JETBRAINS_ALIAS,
                    color: "#c4b5fd",
                    fontSizePx: 18,
                    letterSpacingPx: 1,
                  },
                  "API",
                ),
                " endpoint with code ",
                Inline({ color: "#fde68a" }, "WARN"),
                ".",
              ),
            ),
            Flex(
              {
                direction: "column",
                width: 207,
                background: "#1e1e1e",
                borderRadius: 10,
                padding: 14,
                gap: 8,
              },
              Text(
                { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char" },
                "InlineBox — decoration + atomic",
              ),
              Text(
                {
                  font: FA,
                  fontSizePx: 18,
                  color: "#e2e8f0",
                  wrap: "char",
                  lineHeight: 1.55,
                },
                "Version ",
                InlineBox(
                  {
                    background: "#7f1d1d",
                    paddingInline: [6, 6],
                    borderRadius: 4,
                    color: "#fca5a5",
                  },
                  "beta",
                ),
                " uses the ",
                InlineBox(
                  {
                    font: JETBRAINS_ALIAS,
                    background: "#1e1b4b",
                    paddingInline: [6, 6],
                    borderRadius: 4,
                    color: "#c4b5fd",
                    fontSizePx: 18,
                  },
                  "API",
                ),
                " endpoint with code ",
                InlineBox(
                  {
                    background: "#422006",
                    paddingInline: [6, 6],
                    borderRadius: 4,
                    color: "#fde68a",
                  },
                  "WARN",
                ),
                ".",
              ),
            ),
          ),
          Flex(
            { direction: "row", gap: 12 },
            Flex(
              {
                direction: "column",
                width: 207,
                background: "#1e1e1e",
                borderRadius: 10,
                padding: 14,
                gap: 8,
              },
              Text(
                { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char" },
                "Inline wraps mid-token",
              ),
              Text(
                {
                  font: FA,
                  fontSizePx: 17,
                  color: "#94a3b8",
                  wrap: "char",
                  lineHeight: 1.6,
                },
                "Prefix ",
                Inline({ color: "#a5f3fc", fontWeight: 700 }, "inline-token-can-break"),
                " suffix.",
              ),
            ),
            Flex(
              {
                direction: "column",
                width: 207,
                background: "#1e1e1e",
                borderRadius: 10,
                padding: 14,
                gap: 8,
              },
              Text(
                { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char" },
                "InlineBox stays atomic",
              ),
              Text(
                {
                  font: FA,
                  fontSizePx: 17,
                  color: "#94a3b8",
                  wrap: "char",
                  lineHeight: 1.6,
                },
                "Prefix ",
                InlineBox(
                  {
                    background: "#164e63",
                    paddingInline: [6, 6],
                    borderRadius: 4,
                    color: "#a5f3fc",
                  },
                  "atomic-inlinebox-token",
                ),
                " suffix.",
              ),
            ),
          ),
        ),
      ),
    ),
};
