import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_SANS_JP, FONT_SERIF_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 360;
const HEIGHT = 480;

/**
 * Vertical Japanese typesetting: vertical-rl writing mode, ruby annotation,
 * tate-chu-yoko digits (textCombineUpright), a kinsoku-triggering sentence,
 * and hanging punctuation — the full Japanese IR/emit path in one scene.
 */
function buildNativeVerticalRubyScene(): VNode {
  return createElement(
    "Canvas",
    { width: WIDTH, height: HEIGHT, background: "#fcfaf5", id: "nv-canvas" },
    createElement(
      "Flex",
      {
        id: "nv-root",
        direction: "row",
        justifyContent: "space-between",
        width: WIDTH,
        height: HEIGHT,
        padding: [36, 40, 36, 40],
      },
      // vertical-rl reads right to left, so the caption column comes first
      // (left edge) and the body text sits on the right.
      createElement(
        "Flex",
        { id: "nv-caption-column", direction: "column", justifyContent: "end" },
        createElement(
          "Text",
          {
            id: "nv-caption",
            font: FONT_SANS_JP,
            fontSizePx: 13,
            color: "#a8a29e",
            language: "ja",
            writingMode: "vertical-rl",
            height: 160,
          },
          "縦組・ルビ・縦中横",
        ),
      ),
      createElement(
        "Text",
        {
          id: "nv-body",
          font: FONT_SERIF_JP,
          fontSizePx: 22,
          lineHeight: 2.0,
          color: "#292524",
          language: "ja",
          writingMode: "vertical-rl",
          height: 400,
          hangingPunctuation: true,
        },
        "「秋は",
        createElement("Ruby", {}, "夕暮", createElement("Rt", {}, "ゆうぐ")),
        "れ。」夕日のさして、山の",
        createElement("Ruby", {}, "端", createElement("Rt", {}, "は")),
        "いと近うなりたるに、",
        createElement("Inline", { textCombineUpright: "all" }, "26"),
        "年の空もまた美しい。",
      ),
    ),
  );
}

export const nativeVerticalRubyScene: ConformanceScene = {
  id: "native-vertical-ruby",
  build: buildNativeVerticalRubyScene,
  width: WIDTH,
  height: HEIGHT,
};
