import { describe, expect, it } from "vitest";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";

describe("createElement", () => {
  it("creates a Canvas VNode with props and no children", () => {
    const node = createElement("Canvas", { width: 1280, height: 720 });
    expect(node.type).toBe("Canvas");
    expect(node.props).toEqual({ width: 1280, height: 720 });
    expect(node.children).toEqual([]);
    expect(node.key).toBeUndefined();
  });

  it("creates a VNode with spread children", () => {
    const child = createElement("Box", { width: 100, height: 100 });
    const node = createElement("Flex", { direction: "row" }, child);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as VNode).type).toBe("Box");
  });

  it("creates a Text VNode with string children", () => {
    const node = createElement(
      "Text",
      { font: "NotoSansJP", fontSizePx: 16 },
      "Hello",
      " ",
      "World",
    );
    expect(node.children).toEqual(["Hello", " ", "World"]);
  });

  it("flattens nested children arrays", () => {
    const a = createElement("Box", { width: 10, height: 10 });
    const b = createElement("Box", { width: 20, height: 20 });
    const node = createElement("Flex", null, [a, [b]]);
    expect(node.children).toHaveLength(2);
  });

  it("filters out null, undefined, and boolean children", () => {
    const child = createElement("Box", { width: 10, height: 10 });
    const node = createElement("Flex", null, null, undefined, false, true, child);
    expect(node.children).toHaveLength(1);
  });

  it("converts number children to strings", () => {
    const node = createElement("Text", { font: "Arial", fontSizePx: 16 }, 42);
    expect(node.children).toEqual(["42"]);
  });

  it("extracts key from props", () => {
    const node = createElement("Box", {
      key: "header",
      width: 100,
      height: 100,
    });
    expect(node.key).toBe("header");
    expect(node.props).not.toHaveProperty("key");
  });

  it("handles null props", () => {
    const node = createElement("Box", null);
    expect(node.props).toEqual({});
    expect(node.children).toEqual([]);
  });

  it("uses props.children when no spread children", () => {
    const child = createElement("Box", { width: 10, height: 10 });
    const node = createElement("Flex", {
      direction: "row",
      children: [child],
    });
    expect(node.children).toHaveLength(1);
    // children should not appear in props
    expect(node.props).not.toHaveProperty("children");
  });

  it("prefers spread children over props.children", () => {
    const a = createElement("Box", { width: 10, height: 10 });
    const b = createElement("Box", { width: 20, height: 20 });
    const node = createElement("Flex", { direction: "row", children: [b] }, a);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as VNode).props).toEqual({
      width: 10,
      height: 10,
    });
  });
});
