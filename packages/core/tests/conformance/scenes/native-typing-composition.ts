import { createElement } from "../../../src/vnode/create-element.js";
import type { AnimationSpec, VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN, FONT_MONO, FONT_SANS_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 680;
const HEIGHT = 500;

const CARET_BLINK: AnimationSpec = {
  keyframes: [
    { at: 0, opacity: 1 },
    { at: 1, opacity: 0 },
  ],
  durationMs: 500,
  easing: { type: "steps", count: 2, position: "jump-none" },
  iterations: "infinite",
  fill: "both",
};

function createCaret(color: string): VNode {
  return createElement("InlineRect", {
    inlineSizePx: 2,
    color,
    animate: CARET_BLINK,
  });
}

function createImeRow(
  id: string,
  label: string,
  committed: string,
  active: string,
  converted = false,
): VNode {
  return createElement(
    "Flex",
    { id: `${id}-row`, direction: "row", gap: 12, height: 25, alignItems: "center" },
    createElement(
      "Text",
      { id: `${id}-label`, font: FONT_LATIN, fontSizePx: 11, color: "#94a3b8", width: 72 },
      label,
    ),
    createElement(
      "Text",
      {
        id,
        font: FONT_SANS_JP,
        fontSizePx: 20,
        lineHeightPx: 25,
        color: "#e2e8f0",
        width: 500,
      },
      committed,
      ...(active
        ? [
            createElement(
              "Inline",
              {
                textDecoration: {
                  line: "underline",
                  style: converted ? "double" : "solid",
                  color: converted ? "#c084fc" : "#60a5fa",
                  thicknessPx: 1.5,
                },
              },
              active,
            ),
          ]
        : []),
      createCaret("#f8fafc"),
    ),
  );
}

function buildNativeTypingCompositionScene(): VNode {
  return createElement(
    "Canvas",
    { id: "ntc-canvas", width: WIDTH, height: HEIGHT, background: "#020617" },
    createElement(
      "Flex",
      {
        id: "ntc-root",
        direction: "column",
        width: WIDTH,
        height: HEIGHT,
        padding: 24,
        gap: 12,
      },
      createElement(
        "Text",
        { id: "ntc-heading", font: FONT_LATIN, fontSizePx: 18, color: "#cbd5e1" },
        "Typing / composition materialized states",
      ),
      createElement(
        "Box",
        {
          id: "ntc-terminal-card",
          width: 632,
          height: 92,
          padding: 12,
          background: "#0f172a",
          borderRadius: 10,
        },
        createElement(
          "Text",
          { id: "ntc-terminal-label", font: FONT_LATIN, fontSizePx: 10, color: "#64748b" },
          "TERMINAL / newline + wrap + zero-advance caret",
        ),
        createElement(
          "Text",
          {
            id: "ntc-terminal",
            font: FONT_MONO,
            fallback: [FONT_SANS_JP],
            fontSizePx: 18,
            lineHeightPx: 25,
            width: 355,
            height: 58,
            wrap: "char",
            whiteSpace: "pre-wrap",
            color: "#d1fae5",
          },
          "$ pnpm test\nPASS typing composition parity ",
          createCaret("#22c55e"),
        ),
      ),
      createElement(
        "Box",
        {
          id: "ntc-ime-card",
          width: 632,
          height: 132,
          padding: 10,
          background: "#111827",
          borderRadius: 10,
        },
        createImeRow("ntc-ime-committed", "committed", "入力: ", ""),
        createImeRow("ntc-ime-hiragana", "hiragana", "入力: ", "きょう"),
        createImeRow("ntc-ime-converted", "converted", "入力: ", "今日", true),
        createImeRow("ntc-ime-commit", "commit", "入力: 今日", ""),
      ),
      createElement(
        "Flex",
        { id: "ntc-lower", direction: "row", gap: 12, height: 178 },
        createElement(
          "Box",
          {
            id: "ntc-vertical-card",
            width: 205,
            height: 178,
            padding: 12,
            background: "#eff6ff",
            borderRadius: 10,
          },
          createElement(
            "Text",
            { id: "ntc-vertical-label", font: FONT_LATIN, fontSizePx: 10, color: "#64748b" },
            "VERTICAL COMPOSITION",
          ),
          createElement(
            "Text",
            {
              id: "ntc-vertical",
              font: FONT_SANS_JP,
              fontSizePx: 24,
              lineHeightPx: 34,
              width: 155,
              height: 135,
              writingMode: "vertical-rl",
              textOrientation: "upright",
              wrap: "char",
              color: "#172554",
            },
            "確定",
            createElement(
              "Inline",
              {
                textDecoration: {
                  line: "underline",
                  color: "#2563eb",
                  thicknessPx: 2,
                },
              },
              "へんかん",
            ),
            createElement("InlineRect", {
              inlineSizePx: 16,
              blockSizePx: 3,
              blockAlign: "end",
              color: "#2563eb",
              animate: CARET_BLINK,
            }),
          ),
        ),
        createElement(
          "Box",
          {
            id: "ntc-cluster-card",
            width: 415,
            height: 178,
            padding: 14,
            background: "#f8fafc",
            borderRadius: 10,
          },
          createElement(
            "Text",
            { id: "ntc-cluster-label", font: FONT_LATIN, fontSizePx: 10, color: "#64748b" },
            "DECORATION-ONLY CLUSTER BOUNDARIES",
          ),
          createElement(
            "Text",
            {
              id: "ntc-cluster-plain",
              font: FONT_LATIN,
              fallback: [FONT_SANS_JP],
              fontSizePx: 34,
              fontFeatureSettings: '"liga" 1',
              language: "en",
              color: "#111827",
            },
            "fi e\u0301",
          ),
          createElement(
            "Text",
            {
              id: "ntc-cluster-decorated",
              font: FONT_LATIN,
              fallback: [FONT_SANS_JP],
              fontSizePx: 34,
              fontFeatureSettings: '"liga" 1',
              language: "en",
              color: "#111827",
            },
            "f",
            createElement(
              "Inline",
              { textDecoration: { line: "underline", color: "#ef4444", thicknessPx: 2 } },
              "i",
            ),
            " e",
            createElement(
              "Inline",
              { textDecoration: { line: "underline", color: "#ef4444", thicknessPx: 2 } },
              "\u0301",
            ),
          ),
        ),
      ),
    ),
  );
}

export const nativeTypingCompositionScene: ConformanceScene = {
  animatedSvg: true,
  id: "native-typing-composition",
  build: buildNativeTypingCompositionScene,
  width: WIDTH,
  height: HEIGHT,
  renderOptions: { timeMs: 250 },
};
