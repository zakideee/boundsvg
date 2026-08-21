import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN, FONT_SANS_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 560;
const HEIGHT = 315;

function buildNativeTextDecorationScene(): VNode {
  return createElement(
    "Canvas",
    { width: WIDTH, height: HEIGHT, background: "#0f172a", id: "ntd-canvas" },
    createElement(
      "Flex",
      {
        id: "ntd-root",
        direction: "column",
        width: WIDTH,
        height: HEIGHT,
        padding: [24, 32, 24, 32],
        gap: 13,
      },
      createElement(
        "Text",
        { id: "ntd-heading", font: FONT_LATIN, fontSizePx: 18, color: "#94a3b8" },
        "resolved text decoration geometry",
      ),
      createElement(
        "Flex",
        {
          id: "ntd-panel",
          direction: "column",
          gap: 8,
          background: "#1e293b",
          borderRadius: 12,
          padding: [17, 20, 17, 20],
        },
        createElement(
          "Text",
          {
            id: "ntd-mixed",
            font: FONT_SANS_JP,
            fontSizePx: 27,
            lineHeight: 1.35,
            color: "#e2e8f0",
            language: "ja",
            textDecoration: {
              line: "underline",
              style: "double",
              color: "#38bdf8",
              thicknessPx: 1.5,
            },
          },
          "混植 ",
          createElement("Inline", { font: FONT_LATIN, color: "#f8fafc" }, "Metrics fi"),
          " 日本語",
        ),
        createElement(
          "Text",
          {
            id: "ntd-order",
            font: FONT_LATIN,
            fontSizePx: 20,
            color: "#f8fafc",
            textDecoration: {
              line: ["line-through", "underline", "overline"],
              style: "dashed",
              color: "#fbbf24",
              thicknessPx: 1.5,
              skipInk: "all",
            },
            textStrokes: [
              { color: "#020617", widthPx: 5 },
              { color: "#c4b5fd", widthPx: 1.5 },
            ],
            textShadows: [{ dx: 2, dy: 2, blurPx: 1, color: "#020617" }],
          },
          "under / over / strike",
        ),
        createElement(
          "Text",
          {
            id: "ntd-scope",
            font: FONT_SANS_JP,
            fontSizePx: 19,
            color: "#cbd5e1",
            language: "ja",
            textDecoration: {
              line: "underline",
              style: "dotted",
              color: "#4ade80",
              skipInk: "all",
            },
          },
          "継承 ",
          createElement("Inline", { textDecoration: "none", color: "#fb7185" }, "停止"),
          " 再開",
        ),
        createElement(
          "Flex",
          { id: "ntd-edge-cases", direction: "row", gap: 12, height: 68 },
          createElement(
            "Text",
            {
              id: "ntd-wrap-ruby",
              font: FONT_SANS_JP,
              fontSizePx: 15,
              lineHeight: 1.25,
              width: 364,
              height: 68,
              color: "#e2e8f0",
              language: "ja",
              wrap: "char",
              textDecoration: { line: "underline", color: "#fb7185" },
            },
            "折返し範囲は行ごとの線として解決 折返し範囲は行ごとの線として解決 ",
            createElement(
              "Ruby",
              {},
              "漢",
              createElement(
                "Rt",
                { textDecoration: { line: "overline", color: "#a78bfa" } },
                "かん",
              ),
            ),
          ),
          createElement(
            "Text",
            {
              id: "ntd-vertical",
              font: FONT_SANS_JP,
              fontSizePx: 16,
              lineHeight: 1.15,
              width: 80,
              height: 68,
              color: "#f8fafc",
              language: "ja",
              writingMode: "vertical-rl",
              textOrientation: "upright",
              textDecoration: {
                line: ["underline", "overline", "line-through"],
                style: "wavy",
                color: "#4ade80",
                thicknessPx: 1,
                skipInk: "all",
              },
            },
            "縦書",
            createElement("Inline", { textCombineUpright: "all" }, "25"),
            "装飾",
          ),
        ),
      ),
      createElement(
        "Text",
        { id: "ntd-footer", font: FONT_LATIN, fontSizePx: 12, color: "#64748b" },
        "font metrics / inheritance / wrap / ruby / vertical",
      ),
    ),
  );
}

export const nativeTextDecorationScene: ConformanceScene = {
  id: "native-text-decoration",
  build: buildNativeTextDecorationScene,
  width: WIDTH,
  height: HEIGHT,
};
