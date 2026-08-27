import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 420;
const HEIGHT = 220;

/**
 * Pins the CSS `linear()` expansion of spring easing through the real WASM
 * emit path. The closed form uses `exp`/`sin`/`cos`, so a native-only unit test
 * would not catch a drift in the shipped wasm32 build.
 */
function buildNativeSpringEasingScene(): VNode {
  return createElement(
    "Canvas",
    { id: "nspr-canvas", width: WIDTH, height: HEIGHT, background: "#f8fafc" },
    createElement(
      "Flex",
      {
        id: "nspr-stage",
        direction: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        width: WIDTH,
        height: HEIGHT,
      },
      createElement(
        "Flex",
        { id: "nspr-row", direction: "row", alignItems: "center", gap: 40 },
        createElement("Box", {
          id: "nspr-underdamped",
          width: 72,
          height: 72,
          borderRadius: 16,
          background: "#2563eb",
          animate: {
            keyframes: [
              { at: 0, opacity: 0.15, transform: { scaleX: 0.8, scaleY: 0.8 } },
              { at: 1, opacity: 1, transform: { scaleX: 1, scaleY: 1 } },
            ],
            durationMs: 700,
            easing: { type: "spring", stiffness: 170, damping: 14 },
            fill: "both",
          },
        }),
        createElement("Box", {
          id: "nspr-critical",
          width: 72,
          height: 72,
          borderRadius: 36,
          background: "#e11d48",
          animate: {
            keyframes: [
              { at: 0, opacity: 0.15 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 700,
            // damping = 2 * sqrt(stiffness * mass) is exactly critical.
            easing: { type: "spring", stiffness: 100, damping: 20, mass: 1 },
            fill: "both",
          },
        }),
        createElement("Box", {
          id: "nspr-overdamped",
          width: 72,
          height: 72,
          borderRadius: 8,
          background: "#0f766e",
          animate: {
            keyframes: [
              { at: 0, opacity: 0.15 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 700,
            easing: { type: "spring", stiffness: 100, damping: 40, mass: 1 },
            fill: "both",
          },
        }),
      ),
      createElement(
        "Text",
        {
          id: "nspr-label",
          font: FONT_LATIN,
          fontSizePx: 16,
          color: "#334155",
        },
        "spring: under / critical / over",
      ),
    ),
  );
}

export const nativeSpringEasingScene: ConformanceScene = {
  animatedSvg: true,
  id: "native-spring-easing",
  build: buildNativeSpringEasingScene,
  width: WIDTH,
  height: HEIGHT,
  // Sampling at 0 would pin nothing: p(0) is 0 for every spring, so the still
  // would be identical with linear easing. At 250 of 700 the three regimes
  // resolve to 1.118 / 0.713 / 0.449, and the underdamped box is past its
  // target, so the still also covers overshoot.
  //
  // timeMs only, not animation: "static" — PNG samples statically either way,
  // and forcing static would drop the <style> block that carries the linear()
  // expansion out of the SVG snapshot.
  renderOptions: { timeMs: 250 },
};
