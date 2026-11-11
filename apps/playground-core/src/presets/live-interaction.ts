import { Box, Canvas, Path, Text } from "@boundsvg/core";
import type { Preset } from "../types";

/** Font alias loaded by both playgrounds, independent of their asset URL setup. */
const FONT_ALIAS = "NotoSansJP-woff2";

/** The same authored motion is used by the JSX live-interaction counterpart. */
const MOTION = {
  keyframes: [
    { at: 0, transform: { translateX: 0, scaleX: 1 } },
    { at: 0.5, transform: { translateX: 80, scaleX: 0 } },
    { at: 1, transform: { translateX: 0, scaleX: 1 } },
  ],
  durationMs: 2400,
  iterations: "infinite",
  easing: "linear",
} as const;
/** All three sources use the same input callbacks through the shared controller. */
const HANDLERS = {
  onPointerEnter: "live-enter",
  onPointerLeave: "live-leave",
  onClick: "live-click",
};

/** Current native paint and semantic Frames, mirrored in the React playground. */
export const liveInteractionPreset: Preset = {
  title: "Live paint and Frames",
  description:
    "Keep the pointer still. Paint follows the native stack; rectangular Frames use current endpoint poses and strict clip/viewport interiors. The midpoint has zero Frame width. External individual transforms/3D and clip/mask/style mutations are outside the Frame guarantee.",
  animationDurationMs: 2400,
  source: `import { Box, Canvas, Path, Text, type Engine } from "@boundsvg/core";
import { buildIRSourceIndex, buildTextMap } from "@boundsvg/core/scene";
import {
  bindIRToSvg,
  createSvgInteractionController,
  type EventCallback,
} from "@boundsvg/browser/events";

/** Mount with an Engine configured for NotoSansJP-woff2; the caller owns that Engine. */
export function mountLiveInteraction(engine: Engine): () => void {
  const MOTION = {
    keyframes: [
      { at: 0, transform: { translateX: 0, scaleX: 1 } },
      { at: 0.5, transform: { translateX: 80, scaleX: 0 } },
      { at: 1, transform: { translateX: 0, scaleX: 1 } },
    ],
    durationMs: 2400,
    iterations: "infinite",
    easing: "linear",
  } as const;
  const HANDLERS = {
    onPointerEnter: "live-enter",
    onPointerLeave: "live-leave",
    onClick: "live-click",
  };
  const vnode = Canvas(
    { width: 780, height: 220, background: "#101827" },
    Text(
      {
        position: "absolute",
        left: 20,
        top: 12,
        font: "NotoSansJP-woff2",
        fontSizePx: 16,
        color: "white",
      },
      "Stationary pointer: native paint / Frame / rounded BoxClip",
    ),
    Path({
      id: "live-paint",
      position: "absolute",
      left: 20,
      top: 60,
      width: 120,
      height: 70,
      d: "M28 0H92Q120 0 120 28V42Q120 70 92 70H28Q0 70 0 42V28Q0 0 28 0Z",
      fill: "#38bdf8",
      animate: MOTION,
      ...HANDLERS,
    }),
    Box(
      {
        id: "live-frame",
        position: "absolute",
        left: 270,
        top: 60,
        width: 120,
        height: 70,
        borderRadius: 28,
        animate: MOTION,
        ...HANDLERS,
      },
      Text({ font: "NotoSansJP-woff2", fontSizePx: 18, color: "#a78bfa" }, "Frame"),
    ),
    Box(
      {
        id: "live-clip",
        position: "absolute",
        left: 520,
        top: 60,
        width: 120,
        height: 70,
        borderRadius: 28,
        overflow: "clip",
        animate: MOTION,
        ...HANDLERS,
      },
      Text({ font: "NotoSansJP-woff2", fontSizePx: 18, color: "#34d399" }, "BoxClip"),
    ),
    Text(
      {
        position: "absolute",
        left: 20,
        top: 160,
        width: 740,
        font: "NotoSansJP-woff2",
        fontSizePx: 13,
        color: "#cbd5e1",
      },
      "Frame corners are rectangular unless clipped. External individual transforms/3D and clip/mask/pointer-events/visibility/display changes are outside Frame support.",
    ),
  );

  const { svg, ir } = engine.renderToAnimatedSvgAndIR(vnode, {
    nodeIdMetadata: "include",
    playback: { mode: "independent" },
  });
  const container = document.createElement("div");
  container.innerHTML = svg;
  const root = container.querySelector("svg");
  if (!root) {
    throw new Error("Expected rendered SVG");
  }
  document.body.append(container);
  const index = buildIRSourceIndex(ir);
  const logEvent: EventCallback = (info) => console.log(info.handlerName, info.nodeId, info.point);
  const handlers = new Map<string, EventCallback>([
    ["live-enter", logEvent],
    ["live-leave", logEvent],
    ["live-click", logEvent],
  ]);
  const controller = createSvgInteractionController(container);
  controller.setScene({
    binding: bindIRToSvg(root, index),
    renderMode: "animated",
    handlers,
    textMap: buildTextMap(index),
    onHoverState: (hover) => console.log(hover),
  });
  return () => {
    controller.dispose();
    container.remove();
  };
}
`,
  build: () =>
    Canvas(
      { width: 780, height: 220, background: "#101827" },
      Text(
        {
          position: "absolute",
          left: 20,
          top: 12,
          font: FONT_ALIAS,
          fontSizePx: 16,
          color: "white",
        },
        "Stationary pointer: native paint / Frame / rounded BoxClip",
      ),
      Path({
        id: "live-paint",
        position: "absolute",
        left: 20,
        top: 60,
        width: 120,
        height: 70,
        d: "M28 0H92Q120 0 120 28V42Q120 70 92 70H28Q0 70 0 42V28Q0 0 28 0Z",
        fill: "#38bdf8",
        animate: MOTION,
        ...HANDLERS,
      }),
      Box(
        {
          id: "live-frame",
          position: "absolute",
          left: 270,
          top: 60,
          width: 120,
          height: 70,
          borderRadius: 28,
          animate: MOTION,
          ...HANDLERS,
        },
        Text({ font: FONT_ALIAS, fontSizePx: 18, color: "#a78bfa" }, "Frame"),
      ),
      Box(
        {
          id: "live-clip",
          position: "absolute",
          left: 520,
          top: 60,
          width: 120,
          height: 70,
          borderRadius: 28,
          overflow: "clip",
          animate: MOTION,
          ...HANDLERS,
        },
        Text({ font: FONT_ALIAS, fontSizePx: 18, color: "#34d399" }, "BoxClip"),
      ),
      Text(
        {
          position: "absolute",
          left: 20,
          top: 160,
          width: 740,
          font: FONT_ALIAS,
          fontSizePx: 13,
          color: "#cbd5e1",
        },
        "Frame corners are rectangular unless clipped. External individual transforms/3D and clip/mask/pointer-events/visibility/display changes are outside Frame support.",
      ),
    ),
};
