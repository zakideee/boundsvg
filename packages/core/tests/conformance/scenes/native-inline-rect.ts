import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN, FONT_SANS_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 520;
const HEIGHT = 320;

function buildNativeInlineRectScene(): VNode {
  return createElement(
    "Canvas",
    { id: "nir-canvas", width: WIDTH, height: HEIGHT, background: "#f8fafc" },
    createElement(
      "Flex",
      {
        id: "nir-stage",
        direction: "column",
        gap: 18,
        padding: 24,
        width: WIDTH,
        height: HEIGHT,
      },
      createElement(
        "Text",
        { id: "nir-title", font: FONT_LATIN, fontSizePx: 22, color: "#0f172a" },
        "InlineRect / typing primitives",
      ),
      createElement(
        "Box",
        {
          id: "nir-horizontal-card",
          width: 472,
          height: 92,
          padding: 16,
          background: "#e2e8f0",
          borderRadius: 12,
        },
        createElement(
          "Text",
          {
            id: "nir-horizontal",
            font: FONT_LATIN,
            fontSizePx: 28,
            lineHeightPx: 40,
            color: "#111827",
          },
          createElement("InlineRect", {
            inlineSizePx: 28,
            advancePx: 30,
            color: "#bfdbfe",
            borderRadiusPx: 4,
            paintOrder: "behind",
          }),
          "typed",
          createElement("InlineRect", {
            inlineSizePx: 3,
            color: "#2563eb",
            animate: {
              keyframes: [
                { at: 0, opacity: 0.2 },
                { at: 1, opacity: 1 },
              ],
              durationMs: 1_000,
              easing: { type: "steps", count: 2, position: "jump-end" },
              fill: "both",
            },
          }),
          "  block",
          createElement("InlineRect", {
            inlineSizePx: 18,
            advancePx: 20,
            color: "#f59e0b",
            opacity: 0.5,
          }),
          "  underline",
          createElement("InlineRect", {
            inlineSizePx: 24,
            blockSizePx: 3,
            blockAlign: "end",
            color: "#ef4444",
          }),
        ),
      ),
      createElement(
        "Flex",
        { id: "nir-lower-row", direction: "row", gap: 18, height: 118 },
        createElement(
          "Box",
          {
            id: "nir-empty-card",
            width: 300,
            height: 118,
            padding: 16,
            background: "#0f172a",
            borderRadius: 12,
          },
          createElement(
            "Text",
            { id: "nir-empty-label", font: FONT_LATIN, fontSizePx: 13, color: "#94a3b8" },
            "empty Text + caret",
          ),
          createElement(
            "Text",
            {
              id: "nir-empty",
              font: FONT_LATIN,
              fontSizePx: 32,
              lineHeightPx: 44,
              color: "#f8fafc",
            },
            createElement("InlineRect", {
              inlineSizePx: 3,
              color: "#f8fafc",
              borderRadiusPx: 2,
            }),
          ),
        ),
        createElement(
          "Box",
          {
            id: "nir-vertical-card",
            width: 154,
            height: 118,
            padding: 14,
            background: "#dcfce7",
            borderRadius: 12,
          },
          createElement(
            "Text",
            {
              id: "nir-vertical",
              font: FONT_SANS_JP,
              fontSizePx: 24,
              lineHeightPx: 36,
              writingMode: "vertical-rl",
              textOrientation: "upright",
              height: 90,
              color: "#14532d",
            },
            "縦",
            createElement("InlineRect", {
              inlineSizePx: 18,
              blockSizePx: 4,
              blockAlign: "end",
              advancePx: 20,
              color: "#16a34a",
              borderRadiusPx: 2,
            }),
            "書",
          ),
        ),
      ),
    ),
  );
}

export const nativeInlineRectScene: ConformanceScene = {
  id: "native-inline-rect",
  build: buildNativeInlineRectScene,
  width: WIDTH,
  height: HEIGHT,
  renderOptions: { timeMs: 500 },
};
