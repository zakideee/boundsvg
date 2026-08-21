import { describe, expect, it } from "vitest";
import type { JsxFormatOptions } from "../../src/codegen/jsx-codegen.js";
import {
  collectUsedTypes,
  generateJsxSnippet,
  vnodeToJsxString,
} from "../../src/codegen/jsx-codegen.js";
import { createElement } from "../../src/vnode/create-element.js";

describe("vnodeToJsxString", () => {
  it("converts simple self-closing node", () => {
    const vnode = createElement("Text", { font: "Inter", fontSizePx: 16 }, "Hello");
    const jsx = vnodeToJsxString(vnode);
    expect(jsx).toContain("<Text");
    expect(jsx).toContain('font="Inter"');
    expect(jsx).toContain("fontSizePx={16}");
    expect(jsx).toContain("Hello");
  });

  it("handles node with no children as self-closing", () => {
    const vnode = createElement("Box", { width: 100, height: 50 });
    const jsx = vnodeToJsxString(vnode);
    expect(jsx).toContain("/>");
    expect(jsx).not.toContain("</Box>");
  });

  it("handles nested children", () => {
    const child = createElement("Text", { font: "Inter", fontSizePx: 16 }, "Child");
    const parent = createElement("Box", { width: 200 }, child);
    const jsx = vnodeToJsxString(parent);
    expect(jsx).toContain("<Box");
    expect(jsx).toContain("<Text");
    expect(jsx).toContain("</Box>");
  });

  it("applies indentation", () => {
    const vnode = createElement("Text", { font: "Inter", fontSizePx: 16 }, "Hello");
    const jsx = vnodeToJsxString(vnode, 2);
    expect(jsx.startsWith("    ")).toBe(true); // 2 * 2 spaces
  });

  it("formats many props on separate lines", () => {
    const vnode = createElement("Box", {
      width: 100,
      height: 50,
      background: "#fff",
      padding: 10,
    });
    const jsx = vnodeToJsxString(vnode);
    // More than 3 props → multi-line
    expect(jsx.split("\n").length).toBeGreaterThan(1);
  });

  it("handles boolean props", () => {
    const vnode = createElement("Canvas", { width: 100, height: 100, debug: true });
    const jsx = vnodeToJsxString(vnode);
    expect(jsx).toContain("debug");
  });

  it("handles array props", () => {
    const padding: [number, number, number, number] = [10, 20, 10, 20];
    const vnode = createElement("Box", { padding });
    const jsx = vnodeToJsxString(vnode);
    expect(jsx).toContain("padding={[10, 20, 10, 20]}");
  });

  it("truncates long data URLs", () => {
    const longUrl = `data:${"x".repeat(100)}`;
    const vnode = createElement("Image", {
      src: longUrl,
      width: 100,
      height: 100,
    });
    const jsx = vnodeToJsxString(vnode);
    expect(jsx).toContain("IMAGE_DATA_URL");
    expect(jsx).not.toContain(longUrl);
  });
});

describe("collectUsedTypes", () => {
  it("collects all types from a tree", () => {
    const text = createElement("Text", { font: "Inter", fontSizePx: 16 }, "Hello");
    const box = createElement("Box", { width: 200 }, text);
    const canvas = createElement("Canvas", { width: 400, height: 300 }, box);

    const types = collectUsedTypes(canvas);
    expect(types).toEqual(["Box", "Canvas", "Text"]);
  });

  it("deduplicates types", () => {
    const t1 = createElement("Text", { font: "Inter", fontSizePx: 16 }, "A");
    const t2 = createElement("Text", { font: "Inter", fontSizePx: 16 }, "B");
    const box = createElement("Box", {}, t1, t2);

    const types = collectUsedTypes(box);
    expect(types.filter((t) => t === "Text").length).toBe(1);
  });

  it("returns sorted types", () => {
    const svg = createElement("Svg", { content: "<svg/>", width: 100, height: 100 });
    const text = createElement("Text", { font: "Inter", fontSizePx: 16 }, "A");
    const box = createElement("Box", {}, svg, text);
    const canvas = createElement("Canvas", { width: 400, height: 300 }, box);

    const types = collectUsedTypes(canvas);
    expect(types).toEqual(["Box", "Canvas", "Svg", "Text"]);
  });
});

describe("generateJsxSnippet", () => {
  it("generates import statement with used types", () => {
    const text = createElement("Text", { font: "Inter", fontSizePx: 16 }, "Hello");
    const canvas = createElement("Canvas", { width: 400, height: 300 }, text);

    const snippet = generateJsxSnippet(canvas);
    expect(snippet).toContain('import { toVNode, Canvas, Text } from "@boundsvg/react"');
    expect(snippet).toContain("const vnode = toVNode(");
    expect(snippet).toContain("<Canvas");
    expect(snippet).toContain("<Text");
  });

  it("includes Inline in imports when inline spans exist", () => {
    const text = createElement(
      "Text",
      { font: "Inter", fontSizePx: 16 },
      "A",
      createElement("Inline", { color: "#f00" }, "B"),
    );
    const canvas = createElement("Canvas", { width: 400, height: 300 }, text);
    const snippet = generateJsxSnippet(canvas);
    expect(snippet).toContain("Inline");
    expect(snippet).toContain("<Inline");
  });

  it("includes Ruby and Rt in imports when ruby spans exist", () => {
    const text = createElement(
      "Text",
      { font: "Inter", fontSizePx: 16 },
      createElement("Ruby", {}, "東", createElement("Rt", {}, "とう")),
    );
    const canvas = createElement("Canvas", { width: 400, height: 300 }, text);
    const snippet = generateJsxSnippet(canvas);
    expect(snippet).toContain("Ruby");
    expect(snippet).toContain("Rt");
    expect(snippet).toContain("<Ruby");
    expect(snippet).toContain("<Rt");
  });
});

describe("vnodeToJsxString compact mode", () => {
  const COMPACT: JsxFormatOptions = { compact: true };

  it("packs multiple props on one line within max width", () => {
    const vnode = createElement("Flex", {
      direction: "column",
      justifyContent: "center",
      alignItems: "start",
      width: 960,
      height: 320,
      padding: 40,
      gap: 16,
    });
    const jsx = vnodeToJsxString(vnode, 0, COMPACT);
    const lines = jsx.split("\n");
    // 8 props: compact should use fewer lines than verbose (8 prop lines + 2 tag lines)
    expect(lines.length).toBeLessThan(10);
    // At least one line should contain multiple props
    const propLines = lines.filter(
      (l) => l.trim().startsWith("direction") || l.trim().startsWith("width"),
    );
    expect(propLines.some((l) => l.includes(" "))).toBe(true);
  });

  it("wraps lines when exceeding maxLineWidth", () => {
    const vnode = createElement("Box", {
      width: 100,
      height: 50,
      background: "#ffffff",
      padding: 10,
    });
    // Very narrow width forces more wrapping
    const narrow = vnodeToJsxString(vnode, 0, { compact: true, maxLineWidth: 30 });
    const wide = vnodeToJsxString(vnode, 0, { compact: true, maxLineWidth: 200 });
    // Narrow should have more lines than wide
    expect(narrow.split("\n").length).toBeGreaterThanOrEqual(wide.split("\n").length);
  });

  it("keeps <= 3 props on one line even in compact mode", () => {
    const vnode = createElement("Box", { width: 100, height: 50 });
    const jsx = vnodeToJsxString(vnode, 0, COMPACT);
    // 2 props → single line, same as verbose
    expect(jsx.split("\n").length).toBe(1);
  });

  it("propagates compact to nested children", () => {
    const child = createElement(
      "Text",
      {
        font: "Inter",
        fontSizePx: 16,
        color: "#fff",
        wrap: "char",
      },
      "Hello",
    );
    const parent = createElement("Box", { width: 200 }, child);
    const compactJsx = vnodeToJsxString(parent, 0, COMPACT);
    const verboseJsx = vnodeToJsxString(parent, 0);
    // Compact should be shorter than verbose for the nested child
    expect(compactJsx.split("\n").length).toBeLessThanOrEqual(verboseJsx.split("\n").length);
  });

  it("respects custom maxLineWidth", () => {
    const vnode = createElement("Flex", {
      direction: "column",
      justifyContent: "center",
      alignItems: "start",
      width: 960,
    });
    const wide = vnodeToJsxString(vnode, 0, { compact: true, maxLineWidth: 200 });
    // With very wide max, all 4 props should fit on one prop line
    const propLines = wide.split("\n").filter((l) => l.trim() !== "<Flex" && l.trim() !== "/>");
    expect(propLines.length).toBe(1);
  });

  it("handles self-closing nodes with compact", () => {
    const vnode = createElement("Box", {
      width: 100,
      height: 50,
      background: "#fff",
      padding: 10,
    });
    const jsx = vnodeToJsxString(vnode, 0, COMPACT);
    expect(jsx).toContain("/>");
    expect(jsx).not.toContain("</Box>");
  });

  it("handles text children with compact props", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP-woff2",
        fontSizePx: 58,
        color: "#f8fafc",
        wrap: "char",
        fit: "shrink",
        minFontSizePx: 24,
      },
      "Hello World",
    );
    const jsx = vnodeToJsxString(vnode, 0, COMPACT);
    expect(jsx).toContain("Hello World");
    expect(jsx).toContain("</Text>");
    // Should be more compact than verbose (6 props)
    const verboseJsx = vnodeToJsxString(vnode, 0);
    expect(jsx.split("\n").length).toBeLessThan(verboseJsx.split("\n").length);
  });
});
