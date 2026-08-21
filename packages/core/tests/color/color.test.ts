import { describe, expect, it } from "vitest";
import { parseColor } from "../../src/color.js";
import { FatalError } from "../../src/errors.js";

describe("parseColor", () => {
  describe("#RGB", () => {
    it("parses #F0A", () => {
      expect(parseColor("#F0A")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
    });

    it("parses #000", () => {
      expect(parseColor("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    });
  });

  describe("#RRGGBB", () => {
    it("parses #FF00AA", () => {
      expect(parseColor("#FF00AA")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
    });

    it("parses #333333", () => {
      expect(parseColor("#333333")).toEqual({ r: 51, g: 51, b: 51, a: 1 });
    });
  });

  describe("#RRGGBBAA", () => {
    it("parses #FF00AACC", () => {
      const parsedColor = parseColor("#FF00AACC");
      expect(parsedColor.r).toBe(255);
      expect(parsedColor.g).toBe(0);
      expect(parsedColor.b).toBe(170);
      expect(parsedColor.a).toBeCloseTo(0.8, 1);
    });

    it("parses #00000000 (fully transparent)", () => {
      expect(parseColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it("parses #FFFFFFFF (fully opaque)", () => {
      expect(parseColor("#FFFFFFFF")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    });
  });

  describe("rgb()", () => {
    it("parses rgb(255, 0, 170)", () => {
      expect(parseColor("rgb(255, 0, 170)")).toEqual({
        r: 255,
        g: 0,
        b: 170,
        a: 1,
      });
    });

    it("handles no spaces", () => {
      expect(parseColor("rgb(0,0,0)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    });

    it("throws for out-of-range values", () => {
      expect(() => parseColor("rgb(256, 0, 0)")).toThrow();
    });
  });

  describe("rgba()", () => {
    it("parses rgba(255, 0, 170, 0.8)", () => {
      expect(parseColor("rgba(255, 0, 170, 0.8)")).toEqual({
        r: 255,
        g: 0,
        b: 170,
        a: 0.8,
      });
    });

    it("parses rgba with alpha 0", () => {
      expect(parseColor("rgba(0, 0, 0, 0)")).toEqual({
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      });
    });

    it("throws for alpha > 1", () => {
      expect(() => parseColor("rgba(0, 0, 0, 1.5)")).toThrow();
    });
  });

  describe("CSS color names", () => {
    it("accepts CSS color names", () => {
      expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    });

    it("accepts hsl()", () => {
      const parsedColor = parseColor("hsl(0, 100%, 50%)");
      expect(parsedColor.r).toBe(255);
      expect(parsedColor.g).toBe(0);
      expect(parsedColor.b).toBe(0);
    });
  });

  describe("invalid formats", () => {
    it("rejects empty string", () => {
      expect(() => parseColor("")).toThrow("Invalid color format");
    });

    it("rejects malformed hex", () => {
      expect(() => parseColor("#GG0000")).toThrow("Invalid color format");
    });

    it("rejects unknown names", () => {
      expect(() => parseColor("notacolor")).toThrow("Invalid color format");
    });

    it("attaches the caller-provided nodeId to the error", () => {
      try {
        parseColor("notacolor", { nodeId: "box-1" });
        expect.unreachable("parseColor should throw");
      } catch (error) {
        expect(error).toBeInstanceOf(FatalError);
        expect((error as FatalError).nodeId).toBe("box-1");
        expect((error as FatalError).stage).toBe("validate");
      }
    });

    it("attaches nodeId to range errors inside rgb()/hsl() parsing", () => {
      try {
        parseColor("rgb(300, 0, 0)", { nodeId: "box-2" });
        expect.unreachable("parseColor should throw");
      } catch (error) {
        expect((error as FatalError).nodeId).toBe("box-2");
      }
    });
  });

  it("trims whitespace", () => {
    expect(parseColor("  #ff0000  ")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });
});
