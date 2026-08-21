import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasVNode, FlexVNode, TextOnPathVNode, TextVNode } from "@boundsvg/react";
import {
  applyTemplateOverrides,
  extractTemplateDefaults,
} from "../src/pages/template-overrides.ts";

function createTemplateVNode(): CanvasVNode {
  const text: TextVNode = {
    type: "Text",
    props: {
      font: "NotoSansJP-woff2",
      fontSizePx: 24,
      minFontSizePx: 16,
      color: "#ffffff",
    },
    children: ["Hello"],
  };

  const textOnPath: TextOnPathVNode = {
    type: "TextOnPath",
    props: {
      d: "M 0 160 L 960 160",
      width: 960,
      height: 320,
      font: "NotoSansJP-woff2",
      fontSizePx: 20,
      color: "#ffffff",
    },
    children: ["Along the path"],
  };

  const flex: FlexVNode = {
    type: "Flex",
    props: {
      direction: "column",
      width: 960,
      height: 320,
    },
    children: [text, textOnPath],
  };

  return {
    type: "Canvas",
    props: {
      width: 960,
      height: 320,
      background: "#111111",
    },
    children: [flex],
  };
}

test("extractTemplateDefaults reads Canvas defaults", () => {
  const defaults = extractTemplateDefaults(createTemplateVNode());

  assert.equal(defaults.canvasWidth, 960);
  assert.equal(defaults.canvasHeight, 320);
  assert.equal(defaults.background, "#111111");
  assert.equal(defaults.fontSizeScale, 1);
});

test("applyTemplateOverrides updates canvas, layout, and text props", () => {
  const overridden = applyTemplateOverrides(createTemplateVNode(), {
    canvasWidth: 1200,
    canvasHeight: 400,
    background: "#222222",
    fontSizeScale: 1.5,
    textColor: "#ffcc00",
    lineHeight: 1.8,
    renderer: "boundsvg",
    pngScale: 2,
    textPathMode: "glyphs",
    debugOverlayParts: ["specified"],
  });

  assert.equal(overridden.type, "Canvas");
  assert.equal(overridden.props.width, 1200);
  assert.equal(overridden.props.height, 400);
  assert.equal(overridden.props.background, "#222222");

  const layout = overridden.children[0];
  assert.ok(layout);
  if (typeof layout === "string") {
    throw new Error("Expected Flex child");
  }
  assert.equal(layout.type, "Flex");
  assert.equal(layout.props.width, 1200);
  assert.equal(layout.props.height, 400);

  const text = layout.children[0];
  assert.ok(text);
  if (typeof text === "string") {
    throw new Error("Expected Text child");
  }
  assert.equal(text.type, "Text");
  assert.equal(text.props.fontSizePx, 36);
  assert.equal(text.props.minFontSizePx, 24);
  assert.equal(text.props.color, "#ffcc00");
  assert.equal(text.props.lineHeight, 1.8);

  const textOnPath = layout.children[1];
  assert.ok(textOnPath);
  if (typeof textOnPath === "string") {
    throw new Error("Expected TextOnPath child");
  }
  assert.equal(textOnPath.type, "TextOnPath");
  assert.equal(textOnPath.props.width, 1200);
  assert.equal(textOnPath.props.height, 400);
  assert.equal(textOnPath.props.fontSizePx, 30);
  assert.equal(textOnPath.props.color, "#ffcc00");
  assert.deepEqual(textOnPath.children, ["Along the path"]);
});
