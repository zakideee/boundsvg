import { describe, expect, it } from "vitest";
import {
  Box,
  Canvas,
  Flex,
  Image,
  Inline,
  InlineRect,
  Shape,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: matches VNodeType "Symbol"
  Symbol,
  Text,
  TextOnPath,
} from "../../src/vnode/components.js";
import type { VNode } from "../../src/vnode/types.js";

describe("Canvas", () => {
  it("creates a Canvas VNode", () => {
    const node = Canvas({ width: 1280, height: 720 });
    expect(node.type).toBe("Canvas");
    expect(node.props).toMatchObject({ width: 1280, height: 720 });
  });
});

describe("Flex", () => {
  it("creates a Flex VNode with children", () => {
    const child = Box({ width: 100, height: 100 });
    const node = Flex({ direction: "row" }, child);
    expect(node.type).toBe("Flex");
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as VNode).type).toBe("Box");
  });
});

describe("Box", () => {
  it("creates a Box VNode", () => {
    const node = Box({ width: 200, height: 150, background: "#ff0000" });
    expect(node.type).toBe("Box");
    expect(node.props).toMatchObject({
      width: 200,
      height: 150,
      background: "#ff0000",
    });
  });
});

describe("Text", () => {
  it("creates a Text VNode with string children", () => {
    const node = Text({ font: "NotoSansJP", fontSizePx: 24, color: "#333333" }, "テロップテスト");
    expect(node.type).toBe("Text");
    expect(node.children).toEqual(["テロップテスト"]);
  });
});

describe("TextOnPath", () => {
  it("creates a dedicated leaf VNode and preserves adjacent strings", () => {
    const node = TextOnPath(
      { d: "M0 0L100 0", width: 100, height: 20, font: "NotoSansJP", fontSizePx: 16 },
      "path ",
      "text",
    );
    expect(node.type).toBe("TextOnPath");
    expect(node.children).toEqual(["path ", "text"]);
  });
});

describe("Inline", () => {
  it("creates an Inline VNode with string children", () => {
    const node = Inline({ color: "#ff0000" }, "token");
    expect(node.type).toBe("Inline");
    expect(node.children).toEqual(["token"]);
  });
});

describe("InlineRect", () => {
  it("creates a childless InlineRect VNode", () => {
    const node = InlineRect({
      inlineSizePx: 2,
      blockSizePx: "line",
      color: "#111827",
      paintOrder: "front",
    });
    expect(node.type).toBe("InlineRect");
    expect(node.props).toMatchObject({ inlineSizePx: 2, color: "#111827" });
    expect(node.children).toEqual([]);
  });
});

describe("Image", () => {
  it("creates an Image VNode with no children", () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const node = Image({
      src: data,
      mediaType: "image/png",
      width: 200,
      height: 100,
    });
    expect(node.type).toBe("Image");
    expect(node.children).toEqual([]);
  });
});

describe("Shape", () => {
  it("creates a Shape VNode with no children", () => {
    const node = Shape({
      geometry: {
        viewBox: { width: 10, height: 10 },
        root: { kind: "path", d: "M0 0H10V10Z" },
      },
      width: 40,
      height: 40,
    });
    expect(node.type).toBe("Shape");
    expect(node.children).toEqual([]);
  });
});

describe("Symbol", () => {
  it("creates a Symbol VNode with no children", () => {
    const node = Symbol({
      symbol: {
        geometry: {
          viewBox: { width: 10, height: 10 },
          root: { kind: "path", d: "M0 0H10V10Z" },
        },
      },
      width: 40,
      height: 40,
    });
    expect(node.type).toBe("Symbol");
    expect(node.children).toEqual([]);
  });
});
