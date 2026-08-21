import { describe, expect, it } from "vitest";
import { Fragment, jsx, jsxs } from "../../src/vnode/jsx-runtime.js";
import type { VNode } from "../../src/vnode/types.js";

describe("jsx", () => {
  it("creates a VNode from type and props", () => {
    const node = jsx("Canvas", { width: 800, height: 600 });
    expect(node.type).toBe("Canvas");
    expect(node.props).toEqual({ width: 800, height: 600 });
    expect(node.children).toEqual([]);
  });

  it("passes key through", () => {
    const node = jsx("Box", { width: 100, height: 100 }, "my-key");
    expect(node.key).toBe("my-key");
  });

  it("handles children in props", () => {
    const child = jsx("Text", {
      font: "Arial",
      fontSizePx: 16,
      children: "Hello",
    });
    expect(child.children).toEqual(["Hello"]);
  });
});

describe("jsxs", () => {
  it("creates a VNode with multiple children in props", () => {
    const a = jsx("Box", { width: 10, height: 10 });
    const b = jsx("Box", { width: 20, height: 20 });
    const node = jsxs("Flex", {
      direction: "row",
      children: [a, b],
    });
    expect(node.children).toHaveLength(2);
    expect((node.children[0] as VNode).type).toBe("Box");
    expect((node.children[1] as VNode).type).toBe("Box");
  });

  it("passes key through", () => {
    const node = jsxs("Flex", { direction: "row", children: [] }, "list");
    expect(node.key).toBe("list");
  });
});

describe("Fragment", () => {
  it("is a symbol", () => {
    expect(typeof Fragment).toBe("symbol");
  });
});
