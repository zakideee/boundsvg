import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSvgDimensions, parseSvgViewBox, scanSvgElements } from "../../src/svg/scanner.js";

const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf-8");

describe("scanSvgElements", () => {
  it("scans elements from simple-text SVG", () => {
    const svg = fixture("simple-text.svg");
    const elements = scanSvgElements(svg);

    expect(elements.length).toBeGreaterThan(0);

    const svgEl = elements.find((e) => e.tagName === "svg");
    expect(svgEl).toBeDefined();

    const textEl = elements.find((e) => e.tagName === "text");
    expect(textEl).toBeDefined();
    expect(textEl!.innerContent).toContain("Hello World");
    expect(textEl!.selfClosing).toBe(false);
  });

  it("handles self-closing tags", () => {
    const svg =
      '<svg><rect x="10" y="20" width="100" height="50" /><circle cx="50" cy="50" r="25" /></svg>';
    const elements = scanSvgElements(svg);

    const rect = elements.find((e) => e.tagName === "rect");
    expect(rect).toBeDefined();
    expect(rect!.selfClosing).toBe(true);
    expect(rect!.attributes.x).toBe("10");
    expect(rect!.attributes.width).toBe("100");

    const circle = elements.find((e) => e.tagName === "circle");
    expect(circle).toBeDefined();
    expect(circle!.selfClosing).toBe(true);
    expect(circle!.attributes.cx).toBe("50");
  });

  it("tracks depth for nested elements", () => {
    const svg = '<svg><g><rect width="100" height="50" /><text>Hello</text></g></svg>';
    const elements = scanSvgElements(svg);

    const svgEl = elements.find((e) => e.tagName === "svg");
    expect(svgEl!.depth).toBe(0);

    const g = elements.find((e) => e.tagName === "g");
    expect(g!.depth).toBe(1);

    const rect = elements.find((e) => e.tagName === "rect");
    expect(rect!.depth).toBe(2);

    const text = elements.find((e) => e.tagName === "text");
    expect(text!.depth).toBe(2);
  });

  it("scans multi-text SVG", () => {
    const svg = fixture("multi-text.svg");
    const elements = scanSvgElements(svg);

    const textEls = elements.filter((e) => e.tagName === "text");
    expect(textEls.length).toBe(3);
  });

  it("scans complex layout with defs", () => {
    const svg = fixture("complex-layout.svg");
    const elements = scanSvgElements(svg);

    const tagNames = elements.map((e) => e.tagName);
    expect(tagNames).toContain("defs");
    expect(tagNames).toContain("linearGradient");
    expect(tagNames).toContain("circle");
    expect(tagNames).toContain("path");
    expect(tagNames).toContain("text");
  });

  it("handles empty SVG", () => {
    const elements = scanSvgElements('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    // Only the <svg> element
    expect(elements.length).toBe(1);
    expect(elements[0]!.tagName).toBe("svg");
  });

  it("preserves attribute values", () => {
    const svg = `<svg><text x="20" y="50" font-family="Noto Sans JP" font-size="24">Hi</text></svg>`;
    const elements = scanSvgElements(svg);
    const text = elements.find((e) => e.tagName === "text");
    expect(text!.attributes["font-family"]).toBe("Noto Sans JP");
    expect(text!.attributes["font-size"]).toBe("24");
  });
});

describe("parseSvgViewBox", () => {
  it("parses standard viewBox", () => {
    const vb = parseSvgViewBox('<svg viewBox="0 0 400 200">');
    expect(vb).toEqual({ minX: 0, minY: 0, width: 400, height: 200 });
  });

  it("parses viewBox with non-zero origin", () => {
    const vb = parseSvgViewBox('<svg viewBox="10 20 300 150">');
    expect(vb).toEqual({ minX: 10, minY: 20, width: 300, height: 150 });
  });

  it("parses comma-separated viewBox", () => {
    const vb = parseSvgViewBox('<svg viewBox="0,0,400,200">');
    expect(vb).toEqual({ minX: 0, minY: 0, width: 400, height: 200 });
  });

  it("returns undefined for missing viewBox", () => {
    expect(parseSvgViewBox('<svg width="400" height="200">')).toBeUndefined();
  });

  it("returns undefined for invalid viewBox", () => {
    expect(parseSvgViewBox('<svg viewBox="invalid">')).toBeUndefined();
  });

  it("returns undefined for non-SVG content", () => {
    expect(parseSvgViewBox("<div>not svg</div>")).toBeUndefined();
  });
});

describe("parseSvgDimensions", () => {
  it("parses width and height", () => {
    const dims = parseSvgDimensions('<svg width="400" height="200">');
    expect(dims).toEqual({ width: 400, height: 200 });
  });

  it("parses dimensions with px suffix", () => {
    const dims = parseSvgDimensions('<svg width="400px" height="200px">');
    expect(dims).toEqual({ width: 400, height: 200 });
  });

  it("returns partial when only width present", () => {
    const dims = parseSvgDimensions('<svg width="400">');
    expect(dims.width).toBe(400);
    expect(dims.height).toBeUndefined();
  });

  it("returns empty for no dimensions", () => {
    const dims = parseSvgDimensions('<svg viewBox="0 0 400 200">');
    expect(dims.width).toBeUndefined();
    expect(dims.height).toBeUndefined();
  });
});
