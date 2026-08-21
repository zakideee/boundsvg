import type { GeometryDoc } from "../../../src/shape/types.js";
import { createElement } from "../../../src/vnode/create-element.js";
import type { VNode } from "../../../src/vnode/types.js";
import { FONT_LATIN, FONT_SANS_JP } from "./assets.js";
import type { ConformanceScene } from "./types.js";

const WIDTH = 600;
const HEIGHT = 315;

/** Three-part arrow whose parts stay addressable via emitPartIds. */
const ARROW_GEOMETRY: GeometryDoc = {
  viewBox: { width: 100, height: 20 },
  root: {
    kind: "group",
    children: [
      { kind: "path", nodeId: "tail", d: "M0 8H10V12H0Z" },
      { kind: "path", nodeId: "shaft", d: "M10 8H70V12H10Z" },
      { kind: "path", nodeId: "head", d: "M70 4L100 10L70 16Z" },
    ],
  },
};

/**
 * Layered export target: layer assignments across background/content/badge,
 * pointer handlers on interactive nodes (HandlersRef), an emitPartIds Shape
 * with per-part paint, and a z-index island of overlapping boxes.
 */
function buildNativeLayeredPartsScene(): VNode {
  return createElement(
    "Canvas",
    { width: WIDTH, height: HEIGHT, background: "#f8fafc", id: "nlp-canvas" },
    createElement(
      "Flex",
      {
        id: "nlp-root",
        direction: "column",
        width: WIDTH,
        height: HEIGHT,
        padding: [30, 38, 30, 38],
        justifyContent: "space-between",
      },
      createElement("Box", {
        id: "nlp-bg",
        layer: "background",
        position: "absolute",
        top: 0,
        left: 0,
        width: WIDTH,
        height: 110,
        background: "linear-gradient(180deg, #e0e7ff, #f8fafc)",
      }),
      createElement(
        "Flex",
        { id: "nlp-header", layer: "content", direction: "column", gap: 8 },
        createElement(
          "Text",
          {
            id: "nlp-title",
            layer: "content",
            font: FONT_SANS_JP,
            fontSizePx: 30,
            color: "#1e1b4b",
            language: "ja",
            onClick: "handleTitleClick",
          },
          "レイヤー分割と部品出力",
        ),
        createElement(
          "Text",
          {
            id: "nlp-subtitle",
            layer: "content",
            font: FONT_LATIN,
            fontSizePx: 14,
            color: "#6366f1",
          },
          "layered manifest / part ids / z-index islands",
        ),
      ),
      createElement(
        "Flex",
        { id: "nlp-middle", direction: "row", alignItems: "center", gap: 24 },
        createElement("Shape", {
          id: "nlp-arrow",
          layer: "badge",
          geometry: ARROW_GEOMETRY,
          width: 180,
          height: 36,
          fill: "#6366f1",
          emitPartIds: true,
          partPaint: {
            head: { fill: "#4338ca" },
            tail: { fill: "#a5b4fc" },
          },
          onClick: "handleArrowClick",
          onPointerEnter: "handleArrowEnter",
        }),
        createElement(
          "Flex",
          { id: "nlp-z-island", direction: "row" },
          createElement("Box", {
            id: "nlp-z-back",
            zIndex: 1,
            width: 64,
            height: 64,
            borderRadius: 12,
            background: "#c7d2fe",
            onClick: "handleZBackClick",
          }),
          createElement("Box", {
            id: "nlp-z-front",
            zIndex: 3,
            width: 64,
            height: 64,
            borderRadius: 12,
            background: "#4f46e5",
            margin: [16, 0, 0, -32],
            onClick: "handleZFrontClick",
          }),
          createElement("Box", {
            id: "nlp-z-middle",
            zIndex: 2,
            width: 64,
            height: 64,
            borderRadius: 12,
            background: "#818cf8",
            margin: [32, 0, 0, -32],
            onClick: "handleZMiddleClick",
          }),
        ),
      ),
      createElement(
        "Flex",
        {
          id: "nlp-cta",
          layer: "content",
          direction: "row",
          justifyContent: "end",
        },
        createElement(
          "Box",
          {
            id: "nlp-cta-button",
            background: "#1e1b4b",
            borderRadius: 8,
            padding: [8, 20, 8, 20],
            onClick: "handleCtaClick",
            onPointerEnter: "handleCtaEnter",
            onPointerLeave: "handleCtaLeave",
          },
          createElement(
            "Text",
            { font: FONT_LATIN, fontSizePx: 14, color: "#e0e7ff" },
            "Export layers",
          ),
        ),
      ),
    ),
  );
}

export const nativeLayeredPartsScene: ConformanceScene = {
  id: "native-layered-parts",
  build: buildNativeLayeredPartsScene,
  width: WIDTH,
  height: HEIGHT,
};
