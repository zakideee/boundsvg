// Covers the boxShadow prop grammar used by validation (the Rust IR builder
// applies the same grammar when rendering).

import { describe, expect, it } from "vitest";
import { parseBoxShadow } from "../../src/validate/box-shadow.js";

describe("parseBoxShadow", () => {
  it("returns undefined for empty string", () => {
    expect(parseBoxShadow("")).toBeUndefined();
    expect(parseBoxShadow("  ")).toBeUndefined();
  });

  it("returns undefined for fewer than 2 numeric values", () => {
    expect(parseBoxShadow("10 #f00")).toBeUndefined();
    expect(parseBoxShadow("abc")).toBeUndefined();
  });

  it("parses 2 values with default blur/spread/color", () => {
    const result = parseBoxShadow("10 20");
    expect(result).toEqual({ dx: 10, dy: 20, blur: 0, spread: 0, color: "rgba(0,0,0,0.3)" });
  });

  it("parses 3 values (blur, no spread)", () => {
    const result = parseBoxShadow("10 20 5 #ff0000");
    expect(result).toEqual({ dx: 10, dy: 20, blur: 5, spread: 0, color: "#ff0000" });
  });

  it("parses 4 values with color", () => {
    const result = parseBoxShadow("0 4 8 2 rgba(0,0,0,0.5)");
    expect(result).toEqual({ dx: 0, dy: 4, blur: 8, spread: 2, color: "rgba(0,0,0,0.5)" });
  });

  it("handles negative offsets", () => {
    const result = parseBoxShadow("-5 -10 2 #000");
    expect(result).toEqual({ dx: -5, dy: -10, blur: 2, spread: 0, color: "#000" });
  });

  it("handles float values", () => {
    const result = parseBoxShadow("1.5 2.5 0.5");
    expect(result).toEqual({ dx: 1.5, dy: 2.5, blur: 0.5, spread: 0, color: "rgba(0,0,0,0.3)" });
  });

  it("accepts finite CSS-number syntax and rejects a negative blur", () => {
    expect(parseBoxShadow(".5 -.5 1e1 -2 #000")).toEqual({
      dx: 0.5,
      dy: -0.5,
      blur: 10,
      spread: -2,
      color: "#000",
    });
    expect(parseBoxShadow("0 0 -1 #000")).toBeUndefined();
    expect(parseBoxShadow("1e999 0 #000")).toBeUndefined();
  });
});
