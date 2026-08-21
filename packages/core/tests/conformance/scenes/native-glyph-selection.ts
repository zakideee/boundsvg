import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN, FONT_MONO, FONT_SANS_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 560;
const HEIGHT = 315;

/**
 * Glyph-level path output: rendered with textPathMode="glyphs" so every
 * IRNode.glyphPaths entry carries per-glyph source metadata (sourceStart /
 * sourceEnd / sourceRole). The ruby run provides rubyBase / rubyAnnotation
 * roles; the plain runs provide content roles.
 */
function buildNativeGlyphSelectionScene(): VNode {
  return createElement(
    "Canvas",
    { width: WIDTH, height: HEIGHT, background: "#ffffff", id: "ngs-canvas" },
    createElement(
      "Flex",
      {
        id: "ngs-root",
        direction: "column",
        width: WIDTH,
        height: HEIGHT,
        padding: [30, 38, 30, 38],
        gap: 16,
      },
      createElement(
        "Text",
        {
          id: "ngs-latin",
          font: FONT_LATIN,
          fontSizePx: 28,
          color: "#0f172a",
        },
        "Glyph selection",
      ),
      createElement(
        "Text",
        {
          id: "ngs-ruby",
          font: FONT_SANS_JP,
          fontSizePx: 24,
          color: "#1e293b",
          language: "ja",
          width: 484,
        },
        "選択可能な",
        createElement("Ruby", {}, "文字列", createElement("Rt", {}, "もじれつ")),
        "を保持する。",
      ),
      createElement(
        "Text",
        {
          id: "ngs-mixed",
          font: FONT_SANS_JP,
          fontSizePx: 18,
          color: "#475569",
          language: "ja",
          width: 484,
        },
        "各グリフが元テキストの位置情報を持つ。",
      ),
      createElement(
        "Text",
        { id: "ngs-mono", font: FONT_MONO, fontSizePx: 14, color: "#64748b" },
        "sourceStart / sourceEnd / sourceRole",
      ),
    ),
  );
}

export const nativeGlyphSelectionScene: ConformanceScene = {
  id: "native-glyph-selection",
  build: buildNativeGlyphSelectionScene,
  width: WIDTH,
  height: HEIGHT,
  renderOptions: { textPathMode: "glyphs" },
};
