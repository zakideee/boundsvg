import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 420;
const HEIGHT = 220;

function buildNativeStepEasingScene(): VNode {
  return createElement(
    "Canvas",
    { id: "nse-canvas", width: WIDTH, height: HEIGHT, background: "#f8fafc" },
    createElement(
      "Flex",
      {
        id: "nse-stage",
        direction: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        width: WIDTH,
        height: HEIGHT,
      },
      createElement(
        "Flex",
        { id: "nse-row", direction: "row", alignItems: "center", gap: 40 },
        createElement("Box", {
          id: "nse-keyword",
          width: 72,
          height: 72,
          borderRadius: 16,
          background: "#2563eb",
          animate: {
            keyframes: [
              { at: 0, opacity: 0.2 },
              { at: 0.5, opacity: 1 },
              { at: 1, opacity: 0.2 },
            ],
            durationMs: 1_000,
            easing: "step-start",
            fill: "both",
          },
        }),
        createElement("Box", {
          id: "nse-object",
          width: 72,
          height: 72,
          borderRadius: 36,
          background: "#e11d48",
          animate: {
            keyframes: [
              { at: 0, opacity: 0.15 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 1_000,
            easing: { type: "steps", count: 4, position: "jump-both" },
            fill: "both",
          },
        }),
      ),
      createElement(
        "Text",
        {
          id: "nse-label",
          font: FONT_LATIN,
          fontSizePx: 16,
          color: "#334155",
        },
        "keyword / typed steps",
      ),
    ),
  );
}

export const nativeStepEasingScene: ConformanceScene = {
  animatedSvg: true,
  id: "native-step-easing",
  build: buildNativeStepEasingScene,
  width: WIDTH,
  height: HEIGHT,
};
