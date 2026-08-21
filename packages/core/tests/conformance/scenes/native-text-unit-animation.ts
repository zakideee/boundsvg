import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_SANS_JP, FONT_SERIF_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 560;
const HEIGHT = 340;

const UNIT_KEYFRAMES = [
  {
    at: 0,
    opacity: 0.2,
    transform: { translateY: 14, scaleX: 0.78, scaleY: 0.78, rotateDeg: -6 },
  },
  {
    at: 1,
    opacity: 1,
    transform: { translateY: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 },
  },
] as const;

/** Text paint-unit sampling across horizontal ruby and vertical line units. */
function buildNativeTextUnitAnimationScene(): VNode {
  return createElement(
    "Canvas",
    { id: "ntua-canvas", width: WIDTH, height: HEIGHT, background: "#071827" },
    createElement(
      "Flex",
      {
        id: "ntua-root",
        direction: "column",
        width: WIDTH,
        height: HEIGHT,
        padding: [28, 34, 28, 34],
        gap: 20,
      },
      createElement(
        "Text",
        {
          id: "ntua-heading",
          font: FONT_SANS_JP,
          fontSizePx: 15,
          color: "#67e8f9",
          letterSpacingPx: 2,
        },
        "TEXT PAINT UNITS / STATIC SAMPLE",
      ),
      createElement(
        "Flex",
        {
          id: "ntua-stage",
          direction: "row",
          justifyContent: "space-between",
          width: 492,
          height: 230,
        },
        createElement(
          "Box",
          {
            id: "ntua-horizontal-panel",
            width: 350,
            height: 190,
            padding: [24, 22, 24, 22],
            background: "#102a43",
            borderRadius: 16,
          },
          createElement(
            "Text",
            {
              id: "ntua-horizontal",
              font: FONT_SANS_JP,
              fontSizePx: 32,
              lineHeight: 1.65,
              color: "#f8fafc",
              language: "ja",
              width: 306,
              wrap: "char",
              textShadows: [
                { dx: 3, dy: 4, blurPx: 0, color: "#020617" },
                { dx: -1, dy: 1, blurPx: 0, color: "#0e7490" },
              ],
              textStrokes: [
                { color: "#0891b2", widthPx: 4 },
                { color: "#cffafe", widthPx: 1 },
              ],
              animateUnits: {
                by: "cluster",
                animation: {
                  keyframes: UNIT_KEYFRAMES,
                  durationMs: 700,
                  easing: "ease-out",
                  fill: "both",
                },
                delayStepMs: 45,
                order: "logical",
                ruby: "separate",
              },
            },
            createElement("Ruby", {}, "秋", createElement("Rt", { fontSizePx: 13 }, "あき")),
            "から動く文字。",
          ),
        ),
        createElement(
          "Box",
          {
            id: "ntua-vertical-panel",
            width: 104,
            height: 230,
            padding: [16, 18, 16, 18],
            background: "#164e63",
            borderRadius: 16,
          },
          createElement(
            "Text",
            {
              id: "ntua-vertical",
              font: FONT_SERIF_JP,
              fontSizePx: 24,
              lineHeight: 1.6,
              color: "#ecfeff",
              language: "ja",
              writingMode: "vertical-rl",
              height: 198,
              wrap: "char",
              animateUnits: {
                by: "line",
                animation: {
                  keyframes: [
                    { at: 0, opacity: 0.25, transform: { translateX: 12 } },
                    { at: 1, opacity: 1, transform: { translateX: 0 } },
                  ],
                  durationMs: 600,
                  easing: "linear",
                  fill: "both",
                },
                delayStepMs: 90,
                order: "visual",
              },
            },
            "一行ずつ現れる縦書き。",
          ),
        ),
      ),
    ),
  );
}

export const nativeTextUnitAnimationScene: ConformanceScene = {
  id: "native-text-unit-animation",
  build: buildNativeTextUnitAnimationScene,
  width: WIDTH,
  height: HEIGHT,
  renderOptions: { animation: "static", timeMs: 350 },
};
