import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import type {
  CanvasSceneNode,
  SceneNode,
  TextOnPathSceneNode,
  TextSceneNode,
} from "../../src/scene/types.js";
import { isSceneNode } from "../../src/scene/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { CanvasVNode, RtVNode, RubyVNode, VNode } from "../../src/vnode/types.js";

function expectCanvasVNode(vnode: VNode): CanvasVNode {
  expect(vnode.type).toBe("Canvas");
  if (vnode.type !== "Canvas") {
    throw new Error("Expected Canvas VNode");
  }
  return vnode;
}

function expectChildVNode(child: VNode["children"][number] | undefined): VNode {
  expect(child).toBeDefined();
  if (!child || typeof child === "string") {
    throw new Error("Expected VNode child");
  }
  return child;
}

describe("toSceneDocument", () => {
  it("preserves canvas-stable stroke props for Flex, Grid, Box, and Path", () => {
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Flex", { id: "flex", strokeScaling: "canvas" }),
      createElement("Grid", { id: "grid", strokeScaling: "canvas" }),
      createElement("Box", { id: "box", strokeScaling: "canvas" }),
      createElement("Path", {
        id: "path",
        d: "M0 0L10 10",
        width: 10,
        height: 10,
        strokeScaling: "canvas",
      }),
    );
    const scene = toSceneDocument(vnode);
    if (scene.type !== "Canvas") {
      throw new Error("Expected Canvas scene node");
    }
    expect(scene.children.map((child) => Reflect.get(child, "strokeScaling"))).toEqual([
      "canvas",
      "canvas",
      "canvas",
      "canvas",
    ]);
    const restored = expectCanvasVNode(fromSceneDocument(scene));
    expect(
      restored.children.map((child) => Reflect.get(expectChildVNode(child).props, "strokeScaling")),
    ).toEqual(["canvas", "canvas", "canvas", "canvas"]);
  });

  it("converts a simple Canvas VNode", () => {
    const vnode = createElement("Canvas", { width: 800, height: 600 });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Canvas");
    const canvas = scene as CanvasSceneNode;
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.children).toEqual([]);
  });

  it("preserves Canvas language in round-trip", () => {
    const vnode = createElement("Canvas", { width: 800, height: 600, language: "ja" });
    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    expect(scene.language).toBe("ja");

    const restored = fromSceneDocument(scene);
    const restoredCanvas = expectCanvasVNode(restored);
    expect(restoredCanvas.props.language).toBe("ja");
  });

  it("omits Canvas language when not specified", () => {
    const vnode = createElement("Canvas", { width: 800, height: 600 });
    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    expect(scene.language).toBeUndefined();
  });

  it("converts nested Flex/Box/Text structure", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 200 },
      createElement(
        "Flex",
        { direction: "row", gap: 8 },
        createElement("Text", { font: "Arial", fontSizePx: 16, color: "#000" }, "Hello"),
      ),
    );
    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]!.type).toBe("Flex");
    const flex = scene.children[0]! as SceneNode & { type: "Flex"; children: SceneNode[] };
    expect(flex.children.length).toBe(1);
    const text = flex.children[0]! as TextSceneNode;
    expect(text.type).toBe("Text");
    expect(text.font).toBe("Arial");
    expect(text.fontSizePx).toBe(16);
    expect(text.children).toEqual(["Hello"]);
  });

  it("preserves Text layout size props in round-trip", () => {
    const vnode = createElement(
      "Text",
      {
        font: "Arial",
        fontSizePx: 16,
        width: 300,
        height: 40,
        minWidth: 120,
        maxHeight: 80,
        fitMaxProbes: 77,
      },
      "Hello",
    );

    const scene = toSceneDocument(vnode) as TextSceneNode;
    expect(scene.width).toBe(300);
    expect(scene.height).toBe(40);
    expect(scene.minWidth).toBe(120);
    expect(scene.maxHeight).toBe(80);
    expect(scene.fitMaxProbes).toBe(77);

    const restored = fromSceneDocument(scene);
    expect(restored.props.width).toBe(300);
    expect(restored.props.height).toBe(40);
    expect(restored.props.minWidth).toBe(120);
    expect(restored.props.maxHeight).toBe(80);
    expect(restored.props.fitMaxProbes).toBe(77);
  });

  it("preserves Text unit animation semantics in JSON scene round-trip", () => {
    const vnode = createElement(
      "Text",
      {
        font: "Arial",
        fontSizePx: 16,
        animateUnits: {
          by: "cluster",
          animation: {
            keyframes: [
              { at: 0, opacity: 0 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 300,
            fill: "both",
          },
          delayStepMs: 30,
          order: "visual",
          ruby: "separate",
        },
      },
      "Hello",
    );

    const scene = toSceneDocument(vnode) as TextSceneNode;
    expect(JSON.parse(JSON.stringify(scene)).animateUnits).toEqual(scene.animateUnits);
    expect(fromSceneDocument(scene).props.animateUnits).toEqual(scene.animateUnits);
  });

  it("preserves TextOnPath as a dedicated JSON scene node", () => {
    const vnode = createElement(
      "TextOnPath",
      {
        id: "title-arc",
        d: "M 20 100 C 100 20 220 20 300 100",
        width: 320,
        height: 140,
        font: "NotoSansJP",
        fontSizePx: 36,
        startOffsetPx: 160,
        textAnchor: "middle",
        pathDirection: "reverse",
        pathNormal: "right",
        pathOffsetPx: 8,
        pathFit: "spacing",
        pathOverflow: "hidden",
        textDecoration: {
          line: "underline",
          style: "wavy",
          skipInk: "all",
        },
      },
      "曲線上の",
      "文字",
    );

    const scene = toSceneDocument(vnode) as TextOnPathSceneNode;
    expect(scene).toEqual({
      type: "TextOnPath",
      id: "title-arc",
      d: "M 20 100 C 100 20 220 20 300 100",
      width: 320,
      height: 140,
      font: "NotoSansJP",
      fontSizePx: 36,
      startOffsetPx: 160,
      textAnchor: "middle",
      pathDirection: "reverse",
      pathNormal: "right",
      pathOffsetPx: 8,
      pathFit: "spacing",
      pathOverflow: "hidden",
      textDecoration: {
        line: "underline",
        style: "wavy",
        skipInk: "all",
      },
      children: ["曲線上の", "文字"],
    });
    expect(toSceneDocument(fromSceneDocument(scene))).toEqual(scene);
  });

  it("round-trips recursive shaping and paint TextOnPath Inline children", () => {
    const vnode = createElement(
      "TextOnPath",
      {
        d: "M0 20L300 20",
        width: 300,
        height: 40,
        font: "F",
        fontSizePx: 16,
        textDecoration: { line: "underline", color: "#0ea5e9" },
      },
      "a",
      createElement(
        "Inline",
        {
          fontWeight: 700,
          language: "en",
          color: "#f00",
          textStrokes: [{ color: "#fff", widthPx: 2 }],
          textDecoration: { line: "overline", style: "dashed" },
        },
        "b",
        createElement("Inline", { fontStyle: "italic", textStrokes: [], textShadows: [] }, "c"),
      ),
    );
    const scene = toSceneDocument(vnode) as TextOnPathSceneNode;
    expect(scene.children).toEqual([
      "a",
      {
        type: "Inline",
        fontWeight: 700,
        language: "en",
        color: "#f00",
        textStrokes: [{ color: "#fff", widthPx: 2 }],
        textDecoration: { line: "overline", style: "dashed" },
        children: [
          "b",
          {
            type: "Inline",
            fontStyle: "italic",
            textStrokes: [],
            textShadows: [],
            children: ["c"],
          },
        ],
      },
    ]);
    expect(toSceneDocument(fromSceneDocument(scene))).toEqual(scene);

    const invalidScene = {
      ...scene,
      children: [{ type: "Inline", background: "#000", children: ["bad"] }],
    } as unknown as TextOnPathSceneNode;
    expect(() => fromSceneDocument(invalidScene)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_INLINE_PROP_UNSUPPORTED" }),
    );

    const removedPlainShape = { ...scene, children: "legacy" } as unknown as TextOnPathSceneNode;
    expect(() => fromSceneDocument(removedPlainShape)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }),
    );
  });

  it("rejects the removed signed normal offset in VNode and Scene transports", () => {
    const base = {
      type: "TextOnPath",
      d: "M0 0L100 0",
      width: 100,
      height: 20,
      font: "F",
      fontSizePx: 12,
      children: ["legacy"],
      normalOffsetPx: -4,
    } as unknown as TextOnPathSceneNode;
    expect(() => fromSceneDocument(base)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_INVALID" }),
    );

    const vnode = {
      ...createElement(
        "TextOnPath",
        {
          d: "M0 0L100 0",
          width: 100,
          height: 20,
          font: "F",
          fontSizePx: 12,
        },
        "legacy",
      ),
      props: {
        d: "M0 0L100 0",
        width: 100,
        height: 20,
        font: "F",
        fontSizePx: 12,
        normalOffsetPx: -4,
      },
    } as unknown as VNode;
    expect(() => toSceneDocument(vnode)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_INVALID" }),
    );
  });

  it("rejects unsupported TextOnPath rich children instead of stringifying them", () => {
    const malformed = {
      ...createElement("TextOnPath", {
        d: "M0 0L100 0",
        width: 100,
        height: 20,
        font: "F",
        fontSizePx: 12,
      }),
      children: [createElement("InlineBox", {}, "bad")],
    } as unknown as VNode;

    expect(() => toSceneDocument(malformed)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }),
    );
  });

  it("preserves textDecoration on Text, Inline, InlineBox, and Rt", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 24,
        textDecoration: {
          line: ["underline", "line-through"],
          color: "#ef4444",
          style: "double",
          thicknessPx: 2,
          offsetPx: 1,
          skipInk: "all",
        },
      },
      createElement("Inline", { textDecoration: "none" }, "A"),
      createElement("InlineBox", { textDecoration: { line: "overline", color: "#22c55e" } }, "B"),
      createElement(
        "Ruby",
        {},
        "漢",
        createElement("Rt", { textDecoration: { line: "underline" } }, "かん"),
      ),
    );

    const scene = toSceneDocument(vnode) as TextSceneNode;
    expect(scene.textDecoration).toEqual(vnode.props.textDecoration);
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
    const restored = fromSceneDocument(scene);
    expect(toSceneDocument(restored)).toEqual(scene);
  });

  it("preserves all InlineRect props in JSON scene round-trip", () => {
    const vnode = createElement(
      "Text",
      { id: "typing", font: "NotoSansJP", fontSizePx: 32 },
      createElement("InlineRect", {
        inlineSizePx: 12,
        blockSizePx: 3,
        advancePx: 12,
        blockAlign: "end",
        color: "#2563eb",
        borderRadiusPx: 2,
        opacity: 0.45,
        paintOrder: "behind",
        animate: {
          keyframes: [
            { at: 0, opacity: 0 },
            { at: 1, opacity: 1 },
          ],
          durationMs: 500,
          easing: { type: "steps", count: 1, position: "jump-end" },
        },
      }),
    );

    const scene = toSceneDocument(vnode) as TextSceneNode;
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
    const rect = scene.children[0];
    expect(rect).toEqual(
      expect.objectContaining({
        type: "InlineRect",
        inlineSizePx: 12,
        blockSizePx: 3,
        advancePx: 12,
        blockAlign: "end",
        color: "#2563eb",
        borderRadiusPx: 2,
        opacity: 0.45,
        paintOrder: "behind",
      }),
    );
    expect(toSceneDocument(fromSceneDocument(scene))).toEqual(scene);
  });

  it("preserves all event handlers in round-trip", () => {
    const handlers = {
      onClick: "click",
      onDoubleClick: "double",
      onContextMenu: "context",
      onPointerDown: "pointer-down",
      onPointerUp: "pointer-up",
      onPointerCancel: "pointer-cancel",
      onPointerMove: "pointer-move",
      onPointerEnter: "pointer-enter",
      onPointerLeave: "pointer-leave",
      onPointerOver: "pointer-over",
      onPointerOut: "pointer-out",
      onMouseDown: "mouse-down",
      onMouseUp: "mouse-up",
      onMouseMove: "mouse-move",
      onMouseEnter: "mouse-enter",
      onMouseLeave: "mouse-leave",
      onMouseOver: "mouse-over",
      onMouseOut: "mouse-out",
      onTouchStart: "touch-start",
      onTouchEnd: "touch-end",
      onTouchMove: "touch-move",
    };
    const entries = Object.entries(handlers) as Array<[keyof typeof handlers, string]>;
    const vnode = createElement("Box", { ...handlers });

    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Box");
    if (scene.type !== "Box") {
      throw new Error("Expected Box scene node");
    }
    for (const [key, value] of entries) {
      expect(scene[key]).toBe(value);
    }

    const restored = fromSceneDocument(scene);
    expect(restored.type).toBe("Box");
    if (restored.type !== "Box") {
      throw new Error("Expected Box VNode");
    }
    for (const [key, value] of entries) {
      expect(restored.props[key]).toBe(value);
    }
  });

  it("preserves Inline decoration props in round-trip", () => {
    const inlineProps = {
      paddingInline: [2, 4] as [number, number],
      background: "#f8fafc",
      borderColor: "#0f172a",
      borderWidth: 1,
      borderRadius: [1, 2, 3, 4] as [number, number, number, number],
    };
    const vnode = createElement(
      "Text",
      { font: "Arial", fontSizePx: 16 },
      createElement("Inline", inlineProps, "Hello"),
    );

    const scene = toSceneDocument(vnode) as TextSceneNode;
    const sceneInline = scene.children[0];
    expect(typeof sceneInline).not.toBe("string");
    if (typeof sceneInline === "string" || sceneInline.type !== "Inline") {
      throw new Error("Expected Inline scene child");
    }
    expect(sceneInline.paddingInline).toEqual(inlineProps.paddingInline);
    expect(sceneInline.background).toBe(inlineProps.background);
    expect(sceneInline.borderColor).toBe(inlineProps.borderColor);
    expect(sceneInline.borderWidth).toBe(inlineProps.borderWidth);
    expect(sceneInline.borderRadius).toEqual(inlineProps.borderRadius);

    const restored = fromSceneDocument(scene);
    expect(restored.type).toBe("Text");
    if (restored.type !== "Text") {
      throw new Error("Expected Text VNode");
    }
    const restoredInline = restored.children[0];
    expect(typeof restoredInline).not.toBe("string");
    if (typeof restoredInline === "string" || restoredInline.type !== "Inline") {
      throw new Error("Expected Inline VNode child");
    }
    expect(restoredInline.props.paddingInline).toEqual(inlineProps.paddingInline);
    expect(restoredInline.props.background).toBe(inlineProps.background);
    expect(restoredInline.props.borderColor).toBe(inlineProps.borderColor);
    expect(restoredInline.props.borderWidth).toBe(inlineProps.borderWidth);
    expect(restoredInline.props.borderRadius).toEqual(inlineProps.borderRadius);
  });

  it("converts Image Uint8Array src to base64 data URI", () => {
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const vnode = createElement("Image", {
      src: pngData,
      mediaType: "image/png",
      width: 100,
      height: 50,
    });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Image");
    const img = scene as SceneNode & { type: "Image"; src: string };
    expect(img.src).toMatch(/^data:image\/png;base64,/);
  });

  it("rejects Image Uint8Array without mediaType instead of dropping the bytes", () => {
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const vnode = createElement("Image", {
      src: pngData,
      width: 100,
      height: 50,
    });
    // Returning src: "" here used to report success while silently
    // discarding the image bytes, making the document unable to round-trip.
    expect(() => toSceneDocument(vnode)).toThrow(/mediaType/);
  });

  it("preserves Image string src as-is", () => {
    const dataUri = "data:image/png;base64,AAAA";
    const vnode = createElement("Image", {
      src: dataUri,
      width: 100,
      height: 50,
    });
    const scene = toSceneDocument(vnode);
    const img = scene as SceneNode & { type: "Image"; src: string };
    expect(img.src).toBe(dataUri);
  });

  it("converts Path node", () => {
    const vnode = createElement("Path", {
      d: "M0 0L10 10",
      width: 10,
      height: 10,
      fill: "#ff0000",
    });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Path");
    const path = scene as SceneNode & { type: "Path" };
    expect(path.d).toBe("M0 0L10 10");
    expect(path.fill).toBe("#ff0000");
  });

  it("converts Svg node", () => {
    const vnode = createElement("Svg", {
      content: '<rect width="10" height="10"/>',
      width: 10,
      height: 10,
    });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Svg");
  });

  it("converts Shape node", () => {
    const vnode = createElement("Shape", {
      geometry: {
        viewBox: { width: 10, height: 10 },
        root: { kind: "path", d: "M0 0H10V10Z" },
      },
      width: 10,
      height: 10,
    });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Shape");
  });

  it("converts Symbol node", () => {
    const vnode = createElement("Symbol", {
      symbol: {
        geometry: {
          viewBox: { width: 10, height: 10 },
          root: { kind: "path", d: "M0 0H10V10Z" },
        },
      },
      width: 10,
      height: 10,
    });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Symbol");
  });

  it("converts Grid node with template props", () => {
    const vnode = createElement("Grid", {
      templateColumns: "1fr 2fr",
      templateRows: "auto",
      gap: 4,
    });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Grid");
    const grid = scene as SceneNode & { type: "Grid" };
    expect(grid.templateColumns).toBe("1fr 2fr");
    expect(grid.gap).toBe(4);
  });

  it("preserves id on nodes", () => {
    const vnode = createElement("Canvas", { width: 100, height: 100, id: "root" });
    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    expect(scene.id).toBe("root");
  });

  it("preserves layer on supported nodes", () => {
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement(
        "Flex",
        { id: "row", layer: "textBox" },
        createElement("Text", { id: "label", font: "Arial", fontSizePx: 16, layer: "text" }, "x"),
      ),
    );
    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    const flex = scene.children[0];
    expect(flex?.type).toBe("Flex");
    if (!flex || flex.type !== "Flex") {
      throw new Error("Expected Flex scene node");
    }
    expect(flex.layer).toBe("textBox");
    const text = flex.children[0];
    expect(text?.type).toBe("Text");
    if (!text || text.type !== "Text") {
      throw new Error("Expected Text scene node");
    }
    expect(text.layer).toBe("text");
  });

  it("preserves transform on supported nodes in round-trip", () => {
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", {
        id: "panel",
        width: 40,
        height: 20,
        transform: {
          translateX: 12,
          rotateDeg: 15,
          originX: 20,
          originY: 10,
        },
      }),
    );

    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    const box = scene.children[0];
    expect(box?.type).toBe("Box");
    if (!box || box.type !== "Box") {
      throw new Error("Expected Box scene node");
    }
    expect(box.transform).toEqual({
      translateX: 12,
      rotateDeg: 15,
      originX: 20,
      originY: 10,
    });

    const restored = fromSceneDocument(scene);
    const restoredCanvas = expectCanvasVNode(restored);
    const restoredBox = expectChildVNode(restoredCanvas.children[0]);
    expect(restoredBox.type).toBe("Box");
    expect(restoredBox.props.transform).toEqual(box.transform);
  });

  it("throws SCENE_INVALID_TRANSFORM for non-finite transform values", () => {
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", {
        id: "panel",
        width: 40,
        height: 20,
        transform: {
          rotateDeg: Number.NaN,
        },
      }),
    );

    expect(() => toSceneDocument(vnode)).toThrow(FatalError);
    try {
      toSceneDocument(vnode);
    } catch (error) {
      expect((error as FatalError).code).toBe("SCENE_INVALID_TRANSFORM");
    }
  });

  it("preserves declarative animation specs in round-trip", () => {
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", {
        id: "animated-panel",
        width: 40,
        height: 20,
        animate: {
          keyframes: [
            { at: 0, opacity: 0, transform: { translateY: 8 } },
            { at: 1, opacity: 1, transform: { translateY: 0 } },
          ],
          durationMs: 400,
          easing: "ease-out",
          fill: "both",
        },
      }),
    );

    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    const box = scene.children[0];
    expect(box?.type).toBe("Box");
    if (!box || box.type !== "Box") {
      throw new Error("Expected animated Box scene node");
    }
    expect(box.animate?.durationMs).toBe(400);
    expect(box.animate?.keyframes).toHaveLength(2);

    const restored = expectCanvasVNode(fromSceneDocument(scene));
    const restoredBox = expectChildVNode(restored.children[0]);
    expect(restoredBox.props.animate).toEqual(box.animate);
  });

  it("preserves typed step easing in round-trip", () => {
    const easing = { type: "steps", count: 4, position: "jump-both" } as const;
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", {
        id: "stepped-panel",
        width: 40,
        height: 20,
        animate: {
          keyframes: [
            { at: 0, opacity: 0 },
            { at: 1, opacity: 1 },
          ],
          durationMs: 400,
          easing,
          fill: "both",
        },
      }),
    );

    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    const box = scene.children[0];
    expect(box?.type).toBe("Box");
    if (!box || box.type !== "Box") {
      throw new Error("Expected stepped Box scene node");
    }
    expect(box.animate?.easing).toEqual(easing);

    const restored = expectCanvasVNode(fromSceneDocument(scene));
    const restoredBox = expectChildVNode(restored.children[0]);
    expect(restoredBox.props.animate).toEqual(box.animate);
  });

  it("omits undefined optional fields", () => {
    const vnode = createElement("Canvas", { width: 100, height: 100 });
    const scene = toSceneDocument(vnode) as CanvasSceneNode;
    expect("background" in scene).toBe(false);
    expect("debug" in scene).toBe(false);
  });

  it("converts Inline children in Text", () => {
    const vnode = createElement(
      "Text",
      { font: "Arial", fontSizePx: 14 },
      "before ",
      createElement("Inline", { color: "#ff0000" }, "red"),
      " after",
    );
    const scene = toSceneDocument(vnode) as TextSceneNode;
    expect(scene.children.length).toBe(3);
    expect(scene.children[0]).toBe("before ");
    const inline = scene.children[1] as SceneNode & { type: "Inline" };
    expect(inline.type).toBe("Inline");
    expect(inline.color).toBe("#ff0000");
    expect(inline.children).toEqual(["red"]);
    expect(scene.children[2]).toBe(" after");
  });

  it("converts Ruby children in Text", () => {
    const vnode = createElement(
      "Text",
      { font: "Arial", fontSizePx: 14 },
      "東",
      createElement(
        "Ruby",
        {
          rubyPosition: "alternate",
          rubyAlign: "space-between",
          rubyGapPx: -1,
          rubyOffsetPx: 2,
          rubyLineSizing: "css",
        },
        "京",
        createElement("Rt", { lineHeight: 1 }, "きょう"),
        createElement("Rt", { lineHeight: 1 }, "Tokyo"),
      ),
      "都",
    );
    const scene = toSceneDocument(vnode) as TextSceneNode;
    expect(scene.children.length).toBe(3);
    const ruby = scene.children[1] as SceneNode & {
      type: "Ruby";
      rubyPosition?: string;
      rubyAlign?: string;
      rubyGapPx?: number;
      rubyOffsetPx?: number;
      rubyLineSizing?: string;
    };
    expect(ruby.type).toBe("Ruby");
    expect(ruby.rubyPosition).toBe("alternate");
    expect(ruby.rubyAlign).toBe("space-between");
    expect(ruby.rubyGapPx).toBe(-1);
    expect(ruby.rubyOffsetPx).toBe(2);
    expect(ruby.rubyLineSizing).toBe("css");
    expect(ruby.children[0]).toBe("京");
    const rt = ruby.children[1] as SceneNode & { type: "Rt" };
    expect(rt.type).toBe("Rt");
    expect(rt.lineHeight).toBe(1);
    expect(rt.children).toEqual(["きょう"]);
    const secondRt = ruby.children[2] as SceneNode & { type: "Rt" };
    expect(secondRt.type).toBe("Rt");
    expect(secondRt.children).toEqual(["Tokyo"]);
  });

  it("throws on non-Inline child inside Text", () => {
    // @ts-expect-error intentional invalid runtime validation case
    const vnode = createElement(
      "Text",
      { font: "Arial", fontSizePx: 14 },
      "ok ",
      createElement("Box", { width: 10, height: 10 }),
    );
    expect(() => toSceneDocument(vnode)).toThrow(FatalError);
    try {
      toSceneDocument(vnode);
    } catch (error) {
      expect((error as FatalError).code).toBe("SCENE_INVALID_TEXT_CHILD");
    }
  });

  it("throws on unknown VNode type", () => {
    // Forge a VNode with an unsupported type
    const bad = { type: "Unknown", props: {}, children: [] } as unknown as VNode;
    expect(() => toSceneDocument(bad)).toThrow(FatalError);
    try {
      toSceneDocument(bad);
    } catch (error) {
      expect((error as FatalError).code).toBe("SCENE_UNKNOWN_TYPE");
      expect((error as FatalError).stage).toBe("validate");
    }
  });
});

describe("fromSceneDocument", () => {
  it("converts SceneNode back to VNode", () => {
    const scene: CanvasSceneNode = {
      type: "Canvas",
      width: 800,
      height: 600,
      children: [],
    };
    const vnode = expectCanvasVNode(fromSceneDocument(scene));
    expect(vnode.props.width).toBe(800);
    expect(vnode.props.height).toBe(600);
    expect(vnode.children).toEqual([]);
  });

  it("converts nested SceneNodes back to VNode tree", () => {
    const scene: CanvasSceneNode = {
      type: "Canvas",
      width: 400,
      height: 200,
      children: [
        {
          type: "Text",
          font: "Noto",
          fontSizePx: 24,
          children: ["Hello"],
        },
      ],
    };
    const vnode = expectCanvasVNode(fromSceneDocument(scene));
    expect(vnode.children.length).toBe(1);
    const text = expectChildVNode(vnode.children[0]);
    expect(text.type).toBe("Text");
    if (text.type !== "Text") {
      throw new Error("Expected Text child");
    }
    expect(text.props.font).toBe("Noto");
    expect(text.children).toEqual(["Hello"]);
  });

  it("round-trips layer on supported nodes", () => {
    const scene: CanvasSceneNode = {
      type: "Canvas",
      width: 400,
      height: 200,
      children: [
        {
          type: "Box",
          id: "panel",
          layer: "textBox",
          width: 200,
          height: 80,
          background: "#111111",
          children: [],
        },
      ],
    };
    const vnode = expectCanvasVNode(fromSceneDocument(scene));
    const box = expectChildVNode(vnode.children[0]);
    expect(box.type).toBe("Box");
    if (box.type !== "Box") {
      throw new Error("Expected Box child");
    }
    expect(box.props.layer).toBe("textBox");
  });

  it("round-trips Ruby scene nodes back to VNode tree", () => {
    const scene: CanvasSceneNode = {
      type: "Canvas",
      width: 400,
      height: 200,
      children: [
        {
          type: "Text",
          font: "Noto",
          fontSizePx: 24,
          children: [
            "東",
            {
              type: "Ruby",
              rubyPosition: "alternate",
              rubyAlign: "space-around",
              rubyGapPx: -1,
              rubyOffsetPx: 2,
              rubyLineSizing: "css",
              children: [
                "京",
                { type: "Rt", lineHeight: 1.1, children: ["きょう"] },
                { type: "Rt", lineHeight: 1, children: ["Tokyo"] },
              ],
            },
            "都",
          ],
        },
      ],
    };
    const vnode = expectCanvasVNode(fromSceneDocument(scene));
    const text = expectChildVNode(vnode.children[0]);
    expect(text.type).toBe("Text");
    if (text.type !== "Text") {
      throw new Error("Expected Text child");
    }
    const ruby = expectChildVNode(text.children[1]) as RubyVNode;
    expect(ruby.type).toBe("Ruby");
    expect(ruby.props.rubyPosition).toBe("alternate");
    expect(ruby.props.rubyAlign).toBe("space-around");
    expect(ruby.props.rubyGapPx).toBe(-1);
    expect(ruby.props.rubyOffsetPx).toBe(2);
    expect(ruby.props.rubyLineSizing).toBe("css");
    const rt = expectChildVNode(ruby.children[1]) as RtVNode;
    expect(rt.type).toBe("Rt");
    expect(rt.props.lineHeight).toBe(1.1);
    expect(rt.children).toEqual(["きょう"]);
    const secondRt = expectChildVNode(ruby.children[2]) as RtVNode;
    expect(secondRt.type).toBe("Rt");
    expect(secondRt.children).toEqual(["Tokyo"]);
  });
});

describe("round-trip", () => {
  it("VNode → SceneNode → VNode preserves structure", () => {
    const original = createElement(
      "Canvas",
      { width: 200, height: 100, id: "canvas" },
      createElement(
        "Flex",
        { direction: "column", gap: 4 },
        createElement("Text", { font: "Arial", fontSizePx: 16, color: "#333" }, "Test text"),
      ),
    );

    const scene = toSceneDocument(original);
    const roundTripped = expectCanvasVNode(fromSceneDocument(scene));

    expect(roundTripped.type).toBe(original.type);
    expect(roundTripped.props.width).toBe(original.props.width);
    expect(roundTripped.props.height).toBe(original.props.height);
    expect(roundTripped.props.id).toBe(original.props.id);
    expect(roundTripped.children.length).toBe(original.children.length);
  });
});

describe("isSceneNode", () => {
  it("returns true for SceneNode", () => {
    const scene: CanvasSceneNode = { type: "Canvas", width: 100, height: 100, children: [] };
    expect(isSceneNode(scene)).toBe(true);
  });

  it("returns false for VNode (has props field)", () => {
    const vnode = createElement("Canvas", { width: 100, height: 100 });
    expect(isSceneNode(vnode)).toBe(false);
  });

  it("returns false for null/undefined/string", () => {
    expect(isSceneNode(null)).toBe(false);
    expect(isSceneNode(undefined)).toBe(false);
    expect(isSceneNode("Canvas")).toBe(false);
  });
});
