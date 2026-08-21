import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN, FONT_MONO, FONT_SANS_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 560;
const HEIGHT = 315;

/**
 * Rich inline text: decorated Inline runs that wrap across lines, a nested
 * Inline inside a decorated run, an InlineBox chip, multiple span colors,
 * and a layered text stroke heading — the rich-text fragment and decoration
 * paths in one scene.
 */
function buildNativeRichInlineScene(): VNode {
  return createElement(
    "Canvas",
    { width: WIDTH, height: HEIGHT, background: "#1e1b4b", id: "nri-canvas" },
    createElement(
      "Flex",
      {
        id: "nri-root",
        direction: "column",
        width: WIDTH,
        height: HEIGHT,
        padding: [30, 38, 30, 38],
        gap: 18,
      },
      createElement(
        "Text",
        {
          id: "nri-heading",
          font: FONT_SANS_JP,
          fontSizePx: 32,
          color: "#fbbf24",
          language: "ja",
          textStrokes: [
            { color: "#312e81", widthPx: 6 },
            { color: "#c7d2fe", widthPx: 2 },
          ],
          textShadows: [{ dx: 0, dy: 3, blurPx: 0, color: "#0f0d2e" }],
        },
        "多層アウトライン見出し",
      ),
      createElement(
        "Box",
        {
          id: "nri-panel",
          background: "#312e81",
          borderRadius: 12,
          padding: [18, 22, 18, 22],
        },
        createElement(
          "Text",
          {
            id: "nri-body",
            font: FONT_SANS_JP,
            fontSizePx: 17,
            lineHeight: 1.9,
            color: "#e0e7ff",
            language: "ja",
            width: 440,
          },
          "装飾付きの",
          createElement(
            "Inline",
            {
              background: "#4c1d95",
              borderColor: "#a78bfa",
              borderWidth: 1,
              borderRadius: [4, 4, 4, 4],
              paddingInline: [5, 5],
              color: "#ddd6fe",
            },
            "インライン強調は",
            createElement("Inline", { color: "#f0abfc", letterSpacingPx: 2 }, "ネスト"),
            "しても",
          ),
          "行をまたいで安定し、",
          createElement(
            "InlineBox",
            {
              font: FONT_MONO,
              fontSizePx: 14,
              color: "#86efac",
              background: "#052e16",
              borderColor: "#166534",
              borderWidth: 1,
              borderRadius: 4,
              paddingInline: [6, 6],
            },
            "InlineBox",
          ),
          "は分割されない一体の箱として流れる。",
        ),
      ),
      createElement(
        "Text",
        { id: "nri-footer", font: FONT_LATIN, fontSizePx: 12, color: "#818cf8" },
        "rich inline fragments / decorations / nested spans",
      ),
    ),
  );
}

export const nativeRichInlineScene: ConformanceScene = {
  id: "native-rich-inline",
  build: buildNativeRichInlineScene,
  width: WIDTH,
  height: HEIGHT,
};
