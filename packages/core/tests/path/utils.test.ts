import { describe, expect, it } from "vitest";
import { parsePathBounds, rotatePoint, transformPathData } from "../../src/path/utils.js";

describe("rotatePoint", () => {
  it("0 degrees returns same point", () => {
    const rotatedPoint = rotatePoint({ x: 10, y: 20 }, { x: 0, y: 0 }, 0);
    expect(rotatedPoint.x).toBeCloseTo(10);
    expect(rotatedPoint.y).toBeCloseTo(20);
  });

  it("90 degrees clockwise", () => {
    const rotatedPoint = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(rotatedPoint.x).toBeCloseTo(0);
    expect(rotatedPoint.y).toBeCloseTo(10);
  });

  it("180 degrees", () => {
    const rotatedPoint = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 180);
    expect(rotatedPoint.x).toBeCloseTo(-10);
    expect(rotatedPoint.y).toBeCloseTo(0);
  });

  it("rotating around center", () => {
    // (10, 5) rotated 90° around (5, 5) → (5, 10)
    const rotatedPoint = rotatePoint({ x: 10, y: 5 }, { x: 5, y: 5 }, 90);
    expect(rotatedPoint.x).toBeCloseTo(5);
    expect(rotatedPoint.y).toBeCloseTo(10);
  });

  it("rotating point onto itself (same as center)", () => {
    const rotatedPoint = rotatePoint({ x: 5, y: 5 }, { x: 5, y: 5 }, 45);
    expect(rotatedPoint.x).toBeCloseTo(5);
    expect(rotatedPoint.y).toBeCloseTo(5);
  });
});

describe("parsePathBounds", () => {
  it("returns null for empty string", () => {
    expect(parsePathBounds("")).toBeNull();
  });

  it("parses M command x-coordinates", () => {
    const result = parsePathBounds("M 10 20 L 30 40");
    expect(result).toEqual({ minX: 10, maxX: 30 });
  });

  it("includes Q control point x-coordinates", () => {
    const result = parsePathBounds("M 0 0 Q 50 10 20 30");
    expect(result).toEqual({ minX: 0, maxX: 50 });
  });

  it("includes C control point x-coordinates", () => {
    const result = parsePathBounds("M 0 0 C 100 10 -5 20 30 40");
    expect(result).toEqual({ minX: -5, maxX: 100 });
  });

  it("Z command is ignored without error", () => {
    const result = parsePathBounds("M 5 10 L 20 30 Z");
    expect(result).toEqual({ minX: 5, maxX: 20 });
  });

  it("returns null for unknown command", () => {
    expect(parsePathBounds("M 5 10 X 20 30")).toBeNull();
  });

  it("includes H and V segments in bounds", () => {
    const result = parsePathBounds("M 5 10 H 20 V 30");
    expect(result).toEqual({ minX: 5, maxX: 20 });
  });

  it("returns null for malformed coordinates", () => {
    expect(parsePathBounds("M abc def")).toBeNull();
  });
});

describe("transformPathData", () => {
  const identity = (x: number, y: number) => ({ x, y });
  const translate5 = (x: number, y: number) => ({ x: x + 5, y: y + 5 });

  it("returns original for empty string", () => {
    expect(transformPathData("", identity)).toBe("");
  });

  it("transforms M and L points", () => {
    const result = transformPathData("M 10 20 L 30 40", translate5);
    expect(result).toBe("M15,25L35,45");
  });

  it("transforms Q control and end points", () => {
    const result = transformPathData("M 0 0 Q 10 20 30 40", translate5);
    expect(result).toBe("M5,5Q15,25 35,45");
  });

  it("transforms C control and end points", () => {
    const result = transformPathData("M 0 0 C 10 20 30 40 50 60", translate5);
    expect(result).toBe("M5,5C15,25 35,45 55,65");
  });

  it("preserves Z command", () => {
    const result = transformPathData("M 0 0 L 10 0 L 10 10 Z", identity);
    expect(result).toBe("M0,0L10,0L10,10Z");
  });

  it("returns original for unknown command", () => {
    const original = "M 0 0 X 10 20";
    expect(transformPathData(original, translate5)).toBe(original);
  });

  it("formats -0 as 0", () => {
    const negate = (x: number, y: number) => ({ x: -x, y: -y });
    const result = transformPathData("M 0 0", negate);
    expect(result).toBe("M0,0");
  });

  it("converts H and V segments into transformed line segments", () => {
    const result = transformPathData("M 10 20 H 30 V 40 Z", translate5);
    expect(result).toBe("M15,25L35,25L35,45Z");
  });
});
