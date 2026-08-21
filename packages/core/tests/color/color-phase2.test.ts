import { describe, expect, it } from "vitest";
import { hslToRgb, parseColor } from "../../src/color.js";

describe("parseColor — CSS named colors", () => {
  it("parses 'red'", () => {
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("parses 'blue'", () => {
    expect(parseColor("blue")).toEqual({ r: 0, g: 0, b: 255, a: 1 });
  });

  it("parses 'green' (CSS green = #008000, not #00ff00)", () => {
    expect(parseColor("green")).toEqual({ r: 0, g: 128, b: 0, a: 1 });
  });

  it("parses 'white'", () => {
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("parses 'black'", () => {
    expect(parseColor("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("parses 'coral'", () => {
    expect(parseColor("coral")).toEqual({ r: 255, g: 127, b: 80, a: 1 });
  });

  it("parses 'rebeccapurple'", () => {
    expect(parseColor("rebeccapurple")).toEqual({ r: 102, g: 51, b: 153, a: 1 });
  });

  it("is case-insensitive", () => {
    expect(parseColor("Red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("RED")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("rEd")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("handles whitespace with color names", () => {
    expect(parseColor("  blue  ")).toEqual({ r: 0, g: 0, b: 255, a: 1 });
  });

  it("parses 'transparent' as rgba(0,0,0,0)", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("parses 'silver'", () => {
    expect(parseColor("silver")).toEqual({ r: 192, g: 192, b: 192, a: 1 });
  });

  it("parses 'navy'", () => {
    expect(parseColor("navy")).toEqual({ r: 0, g: 0, b: 128, a: 1 });
  });

  it("parses 'teal'", () => {
    expect(parseColor("teal")).toEqual({ r: 0, g: 128, b: 128, a: 1 });
  });

  it("rejects unknown color names", () => {
    expect(() => parseColor("notacolor")).toThrow("Invalid color format");
  });
});

describe("parseColor — hsl()", () => {
  it("parses pure red: hsl(0, 100%, 50%)", () => {
    const parsedColor = parseColor("hsl(0, 100%, 50%)");
    expect(parsedColor.r).toBe(255);
    expect(parsedColor.g).toBe(0);
    expect(parsedColor.b).toBe(0);
    expect(parsedColor.a).toBe(1);
  });

  it("parses pure green: hsl(120, 100%, 50%)", () => {
    const parsedColor = parseColor("hsl(120, 100%, 50%)");
    expect(parsedColor.r).toBe(0);
    expect(parsedColor.g).toBe(255);
    expect(parsedColor.b).toBe(0);
  });

  it("parses pure blue: hsl(240, 100%, 50%)", () => {
    const parsedColor = parseColor("hsl(240, 100%, 50%)");
    expect(parsedColor.r).toBe(0);
    expect(parsedColor.g).toBe(0);
    expect(parsedColor.b).toBe(255);
  });

  it("parses white: hsl(0, 0%, 100%)", () => {
    const parsedColor = parseColor("hsl(0, 0%, 100%)");
    expect(parsedColor.r).toBe(255);
    expect(parsedColor.g).toBe(255);
    expect(parsedColor.b).toBe(255);
  });

  it("parses black: hsl(0, 0%, 0%)", () => {
    const parsedColor = parseColor("hsl(0, 0%, 0%)");
    expect(parsedColor.r).toBe(0);
    expect(parsedColor.g).toBe(0);
    expect(parsedColor.b).toBe(0);
  });

  it("parses 50% gray: hsl(0, 0%, 50%)", () => {
    const parsedColor = parseColor("hsl(0, 0%, 50%)");
    expect(parsedColor.r).toBe(128);
    expect(parsedColor.g).toBe(128);
    expect(parsedColor.b).toBe(128);
  });

  it("rejects invalid saturation > 100%", () => {
    expect(() => parseColor("hsl(0, 150%, 50%)")).toThrow();
  });

  it("rejects invalid lightness > 100%", () => {
    expect(() => parseColor("hsl(0, 50%, 150%)")).toThrow();
  });
});

describe("parseColor — hsla()", () => {
  it("parses hsla(0, 100%, 50%, 0.5)", () => {
    const parsedColor = parseColor("hsla(0, 100%, 50%, 0.5)");
    expect(parsedColor.r).toBe(255);
    expect(parsedColor.g).toBe(0);
    expect(parsedColor.b).toBe(0);
    expect(parsedColor.a).toBe(0.5);
  });

  it("parses hsla with alpha 0", () => {
    const parsedColor = parseColor("hsla(120, 100%, 50%, 0)");
    expect(parsedColor.r).toBe(0);
    expect(parsedColor.g).toBe(255);
    expect(parsedColor.b).toBe(0);
    expect(parsedColor.a).toBe(0);
  });

  it("rejects alpha > 1", () => {
    expect(() => parseColor("hsla(0, 100%, 50%, 1.5)")).toThrow();
  });

  it("rejects alpha < 0", () => {
    expect(() => parseColor("hsla(0, 100%, 50%, -0.5)")).toThrow();
  });
});

describe("hslToRgb", () => {
  it("handles hue wrapping (negative)", () => {
    const a = hslToRgb(-60, 100, 50);
    const b = hslToRgb(300, 100, 50);
    expect(a).toEqual(b);
  });

  it("handles hue wrapping (> 360)", () => {
    const a = hslToRgb(420, 100, 50);
    const b = hslToRgb(60, 100, 50);
    expect(a).toEqual(b);
  });

  it("handles hue = 360 (wraps to 0)", () => {
    const a = hslToRgb(360, 100, 50);
    const b = hslToRgb(0, 100, 50);
    expect(a).toEqual(b);
  });
});

describe("parseColor — existing formats still work (regression)", () => {
  it("#RGB", () => {
    expect(parseColor("#F0A")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
  });

  it("#RRGGBB", () => {
    expect(parseColor("#FF00AA")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
  });

  it("rgb()", () => {
    expect(parseColor("rgb(255, 0, 170)")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
  });

  it("rgba()", () => {
    expect(parseColor("rgba(255, 0, 170, 0.8)")).toEqual({ r: 255, g: 0, b: 170, a: 0.8 });
  });
});
