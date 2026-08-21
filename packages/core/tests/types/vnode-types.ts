import {
  Box,
  type CanvasVNode,
  createElement,
  InlineRect,
  type StrokeScaling,
  Text,
  TextOnPath,
  type VNode,
} from "../../dist/index.js";

const text = createElement("Text", { font: "F", fontSizePx: 12, children: ["ok"] });
const textFromArgs = createElement("Text", { font: "F", fontSizePx: 12 }, "ok");
const canvas: CanvasVNode = createElement("Canvas", {
  width: 100,
  height: 100,
  children: [text],
});
const flexFromArgs = createElement("Flex", { direction: "row" }, textFromArgs);
void canvas;
void flexFromArgs;

const canvasStrokeScaling: StrokeScaling = "canvas";
void createElement("Flex", {
  borderWidth: 1,
  borderColor: "#000",
  strokeScaling: canvasStrokeScaling,
});
void createElement("Grid", { borderWidth: 1, borderColor: "#000", strokeScaling: "canvas" });
void createElement("Box", { borderWidth: 1, borderColor: "#000", strokeScaling: "transform" });

void createElement("Path", {
  d: "M0 0L1 1",
  width: 1,
  height: 1,
  stroke: "#000",
  strokeScaling: "canvas",
});
// @ts-expect-error canvas-stable stroke scaling is not a Text outline API
void createElement("Text", { font: "F", fontSizePx: 12, strokeScaling: "canvas" });
// @ts-expect-error reusable Shape paint is outside the canvas-stable stroke API
void createElement("Shape", { width: 1, height: 1, strokeScaling: "canvas" });
// @ts-expect-error reusable Symbol paint is outside the canvas-stable stroke API
void createElement("Symbol", { width: 1, height: 1, strokeScaling: "canvas" });

// @ts-expect-error childless nodes must reject spread children
createElement("Image", { src: "data:image/png;base64,AA==", width: 1, height: 1 }, "bad");

// Every raster format the rasterizer decodes has to be declarable, or a
// caller holding those bytes can only say so through a type assertion.
for (const mediaType of ["image/png", "image/jpeg", "image/gif", "image/webp"] as const) {
  void createElement("Image", { src: new Uint8Array([0]), mediaType, width: 1, height: 1 });
}
void createElement("Image", {
  src: '<svg xmlns="http://www.w3.org/2000/svg" />',
  mediaType: "image/svg+xml",
  width: 1,
  height: 1,
});

// @ts-expect-error a format the rasterizer cannot decode is not declarable
void createElement("Image", {
  src: new Uint8Array([0]),
  mediaType: "image/avif",
  width: 1,
  height: 1,
});

const manualVNode: VNode = {
  type: "Text",
  props: { font: "F", fontSizePx: 12 },
  children: ["ok"],
};
void manualVNode;

// @ts-expect-error unknown prop must be rejected
createElement("Text", { font: "F", fontSizePx: 12, notAProp: 1 });

// @ts-expect-error required font must not be omitted
createElement("Text", { fontSizePx: 12 });

// JSX-path children accept the broad VNode union (JSX expressions type as
// `VNode`); wrong child kinds are rejected by validate() at runtime.
createElement("Text", {
  font: "F",
  fontSizePx: 12,
  children: [createElement("Box", {})],
});

// The function-call API keeps the narrow static check on rest children.
// @ts-expect-error Text rest children must not accept Box
Text({ font: "F", fontSizePx: 12 }, Box({}));

const textOnPath = createElement(
  "TextOnPath",
  {
    d: "M0 0L100 0",
    width: 100,
    height: 20,
    font: "F",
    fontSizePx: 12,
    pathFit: "spacing",
    pathOverflow: "ellipsis",
  },
  "path",
  " text",
);
void textOnPath;

// @ts-expect-error TextOnPath accepts authored strings only
createElement("TextOnPath", {
  d: "M0 0L100 0",
  width: 100,
  height: 20,
  font: "F",
  fontSizePx: 12,
  children: [42],
});

const richTextOnPath = createElement("TextOnPath", {
  d: "M0 0L100 0",
  width: 100,
  height: 20,
  font: "F",
  fontSizePx: 12,
  children: [createElement("Inline", { fontWeight: 700 }, "rich")],
});
void richTextOnPath;

// JSX-path children accept the broad VNode union; validate() rejects the
// wrong kinds at runtime.
createElement("TextOnPath", {
  d: "M0 0L100 0",
  width: 100,
  height: 20,
  font: "F",
  fontSizePx: 12,
  children: [createElement("InlineBox", {}, "bad")],
});

const badPathChild = InlineRect({ inlineSizePx: 4, color: "#000000" });
// @ts-expect-error TextOnPath rest children must not accept InlineRect
TextOnPath({ d: "M0 0L100 0", width: 100, height: 20, font: "F", fontSizePx: 12 }, badPathChild);

const CardComponent = (props: { title: string }, ...children: Array<VNode | string>): VNode =>
  createElement("Box", {}, createElement("Text", { font: "F", fontSizePx: 12 }, props.title), [
    ...children,
  ]);
const fromComponent: VNode = createElement(CardComponent, { title: "t" }, text);
void fromComponent;

// @ts-expect-error function component props must be type-checked
createElement(CardComponent, { title: 1 });

// @ts-expect-error manual VNode must satisfy strict props
const invalidManualVNode: VNode = {
  type: "Text",
  props: { fontSizePx: 12 },
  children: [],
};
void invalidManualVNode;
