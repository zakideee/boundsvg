import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 480;
const HEIGHT = 270;

/** A native boundsvg scene covering opacity and canonical transform tracks. */
function buildNativeAnimatedScene(): VNode {
  return createElement(
    "Canvas",
    { id: "na-canvas", width: WIDTH, height: HEIGHT, background: "#eef2ff" },
    createElement(
      "Flex",
      {
        id: "na-stage",
        direction: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        width: WIDTH,
        height: HEIGHT,
      },
      createElement(
        "Flex",
        { id: "na-row", direction: "row", alignItems: "center", gap: 48 },
        createElement(
          "Box",
          {
            id: "na-card",
            width: 112,
            height: 112,
            borderRadius: 24,
            background: "#4f46e5",
            animate: {
              keyframes: [
                {
                  at: 0,
                  opacity: 0.35,
                  transform: {
                    translateX: -28,
                    scaleX: 0.82,
                    scaleY: 0.82,
                    rotateDeg: -10,
                  },
                },
                {
                  at: 0.5,
                  opacity: 1,
                  transform: {
                    translateX: 0,
                    scaleX: 1.08,
                    scaleY: 1.08,
                    rotateDeg: 0,
                  },
                },
                {
                  at: 1,
                  opacity: 0.7,
                  transform: {
                    translateX: 28,
                    scaleX: 0.9,
                    scaleY: 0.9,
                    rotateDeg: 10,
                  },
                },
              ],
              durationMs: 1200,
              easing: [0.42, 0, 0.58, 1],
              fill: "both",
            },
          },
          createElement("Box", {
            id: "na-card-core",
            width: 40,
            height: 40,
            margin: [36, 36, 36, 36],
            borderRadius: 20,
            background: "#c7d2fe",
          }),
        ),
        createElement("Box", {
          id: "na-pulse",
          width: 72,
          height: 72,
          borderRadius: 36,
          background: "#f43f5e",
          animate: {
            keyframes: [
              { at: 0, opacity: 0.2 },
              { at: 0.5, opacity: 1 },
              { at: 1, opacity: 0.2 },
            ],
            durationMs: 1200,
            easing: "linear",
            fill: "both",
          },
        }),
      ),
      createElement(
        "Text",
        {
          id: "na-label",
          font: FONT_LATIN,
          fontSizePx: 16,
          color: "#312e81",
        },
        "declarative / sampled",
      ),
    ),
  );
}

export const nativeAnimatedScene: ConformanceScene = {
  id: "native-animated",
  build: buildNativeAnimatedScene,
  width: WIDTH,
  height: HEIGHT,
};
