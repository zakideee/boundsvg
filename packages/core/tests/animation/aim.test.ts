import { describe, expect, it } from "vitest";
import { aimTransform, clampAimCenter, fitZoom } from "../../src/aim.js";

const VIEWPORT = { width: 1920, height: 1080 };

describe("fitZoom", () => {
  it("caps at maxZoom for small subjects and at the fit for large ones", () => {
    const small = { x: 0, y: 0, width: 200, height: 100 };
    expect(fitZoom(small, VIEWPORT, { maxZoom: 1.8, padPx: 56 })).toBe(1.8);
    const wide = { x: 0, y: 0, width: 1700, height: 100 };
    expect(fitZoom(wide, VIEWPORT, { maxZoom: 1.8, padPx: 56 })).toBeCloseTo(1920 / 1812, 6);
  });

  it("drops to or below 1 when the padded subject cannot fit", () => {
    const oversized = { x: 0, y: 0, width: 1900, height: 100 };
    expect(fitZoom(oversized, VIEWPORT, { maxZoom: 2, padPx: 56 })).toBeLessThan(1);
  });
});

describe("clampAimCenter", () => {
  it("keeps the zoomed frame inside the viewport", () => {
    const zoom = 2;
    // Frame is 960×540 around the center: centers may roam 480..1440 / 270..810.
    expect(clampAimCenter({ x: 0, y: 0 }, VIEWPORT, zoom)).toEqual({ x: 480, y: 270 });
    expect(clampAimCenter({ x: 5_000, y: 5_000 }, VIEWPORT, zoom)).toEqual({ x: 1440, y: 810 });
    expect(clampAimCenter({ x: 960, y: 540 }, VIEWPORT, zoom)).toEqual({ x: 960, y: 540 });
  });
});

describe("aimTransform", () => {
  it("maps the aimed center onto the viewport center through the bbox-center scale", () => {
    const zoom = 1.6;
    const center = { x: 700, y: 300 };
    const transform = aimTransform(center, VIEWPORT, zoom);
    // The animation pipeline scales about the wrapper's bbox center C:
    // p ↦ t + C + k(p − C). The aimed center must land on C.
    const c = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const mapped = {
      x: (transform.translateX ?? 0) + c.x + zoom * (center.x - c.x),
      y: (transform.translateY ?? 0) + c.y + zoom * (center.y - c.y),
    };
    expect(mapped.x).toBeCloseTo(c.x, 6);
    expect(mapped.y).toBeCloseTo(c.y, 6);
  });

  it("returns the identity at or below zoom 1", () => {
    expect(aimTransform({ x: 10, y: 10 }, VIEWPORT, 1)).toEqual({
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
    });
  });
});
