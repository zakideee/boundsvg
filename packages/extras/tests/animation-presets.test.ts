import { Box, Canvas, FatalError, validate } from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import {
  fadeInAnimation,
  fadeOutAnimation,
  popInAnimation,
  rotateInAnimation,
  scaleInAnimation,
  sequenceAnimations,
  slideInAnimation,
  staggerAnimations,
} from "../src/index.js";

const ALL_PRESETS = {
  fadeIn: fadeInAnimation(),
  fadeOut: fadeOutAnimation(),
  slideIn: slideInAnimation(),
  scaleIn: scaleInAnimation(),
  rotateIn: rotateInAnimation(),
  popIn: popInAnimation(),
};

describe("animation presets", () => {
  it("produces stable specs for the default options", () => {
    expect(ALL_PRESETS).toMatchInlineSnapshot(`
      {
        "fadeIn": {
          "delayMs": 0,
          "durationMs": 400,
          "easing": "ease-out",
          "fill": "both",
          "keyframes": [
            {
              "at": 0,
              "opacity": 0,
            },
            {
              "at": 1,
              "opacity": 1,
            },
          ],
        },
        "fadeOut": {
          "delayMs": 0,
          "durationMs": 400,
          "easing": "ease-out",
          "fill": "both",
          "keyframes": [
            {
              "at": 0,
              "opacity": 1,
            },
            {
              "at": 1,
              "opacity": 0,
            },
          ],
        },
        "popIn": {
          "delayMs": 0,
          "durationMs": 700,
          "easing": {
            "damping": 14,
            "stiffness": 170,
            "type": "spring",
          },
          "fill": "both",
          "keyframes": [
            {
              "at": 0,
              "opacity": 0,
              "transform": {
                "scaleX": 0.8,
                "scaleY": 0.8,
              },
            },
            {
              "at": 1,
              "opacity": 1,
              "transform": {
                "scaleX": 1,
                "scaleY": 1,
              },
            },
          ],
        },
        "rotateIn": {
          "delayMs": 0,
          "durationMs": 400,
          "easing": "ease-out",
          "fill": "both",
          "keyframes": [
            {
              "at": 0,
              "opacity": 0,
              "transform": {
                "rotateDeg": -8,
              },
            },
            {
              "at": 1,
              "opacity": 1,
              "transform": {
                "rotateDeg": 0,
              },
            },
          ],
        },
        "scaleIn": {
          "delayMs": 0,
          "durationMs": 400,
          "easing": "ease-out",
          "fill": "both",
          "keyframes": [
            {
              "at": 0,
              "opacity": 0,
              "transform": {
                "scaleX": 0.8,
                "scaleY": 0.8,
              },
            },
            {
              "at": 1,
              "opacity": 1,
              "transform": {
                "scaleX": 1,
                "scaleY": 1,
              },
            },
          ],
        },
        "slideIn": {
          "delayMs": 0,
          "durationMs": 400,
          "easing": "ease-out",
          "fill": "both",
          "keyframes": [
            {
              "at": 0,
              "opacity": 0,
              "transform": {
                "translateX": 0,
                "translateY": 24,
              },
            },
            {
              "at": 1,
              "opacity": 1,
              "transform": {
                "translateX": 0,
                "translateY": 0,
              },
            },
          ],
        },
      }
    `);
  });

  it("accepts every preset through the core validator", () => {
    // The presets are only useful if the engine takes them, so run the real
    // validator rather than asserting on shape alone.
    for (const [name, animation] of Object.entries(ALL_PRESETS)) {
      const scene = Canvas(
        { width: 100, height: 100 },
        Box({ id: name, width: 40, height: 40, background: "#2563eb", animate: animation }),
      );
      expect(() => validate(scene), name).not.toThrow();
    }
  });

  it("overrides duration, delay, and easing on any preset", () => {
    const spec = fadeInAnimation({ durationMs: 120, delayMs: 30, easing: "linear" });

    expect(spec.durationMs).toBe(120);
    expect(spec.delayMs).toBe(30);
    expect(spec.easing).toBe("linear");
  });

  it("maps each slide direction to a single translated axis", () => {
    const offsets = (["left", "right", "top", "bottom"] as const).map((from) => {
      const transform = slideInAnimation({ from, distancePx: 30 }).keyframes[0]?.transform;
      return [transform?.translateX, transform?.translateY];
    });

    expect(offsets).toEqual([
      [-30, 0],
      [30, 0],
      [0, -30],
      [0, 30],
    ]);
  });

  it("gives popIn a spring long enough to settle", () => {
    const spec = popInAnimation();

    expect(spec.easing).toEqual({ type: "spring", stiffness: 170, damping: 14 });
    // zeta is about 0.54, so the decay rate is about 7/s. Below roughly 660ms
    // the spring has not settled and snaps to the final keyframe.
    expect(spec.durationMs).toBeGreaterThanOrEqual(660);
  });

  it("omits mass from popIn unless asked, so the engine default applies", () => {
    expect(popInAnimation().easing).not.toHaveProperty("mass");
    expect(popInAnimation({ mass: 2 }).easing).toMatchObject({ mass: 2 });
  });
});

describe("staggerAnimations", () => {
  it("offsets each copy by a fixed interval", () => {
    const specs = staggerAnimations(fadeInAnimation(), { count: 4, intervalMs: 80 });

    expect(specs).toHaveLength(4);
    expect(specs.map((spec) => spec.delayMs)).toEqual([0, 80, 160, 240]);
  });

  it("adds the start delay and the base spec's own delay", () => {
    const specs = staggerAnimations(fadeInAnimation({ delayMs: 25 }), {
      count: 3,
      intervalMs: 50,
      startDelayMs: 100,
    });

    expect(specs.map((spec) => spec.delayMs)).toEqual([125, 175, 225]);
  });

  it("returns an empty list for a count of zero", () => {
    expect(staggerAnimations(fadeInAnimation(), { count: 0, intervalMs: 50 })).toEqual([]);
  });

  it("keeps every other field of the base spec", () => {
    const base = slideInAnimation({ durationMs: 250, easing: "linear" });
    const [first] = staggerAnimations(base, { count: 2, intervalMs: 10 });

    expect(first).toMatchObject({
      durationMs: 250,
      easing: "linear",
      keyframes: base.keyframes,
    });
  });

  it.each([
    { count: -1, intervalMs: 10 },
    { count: 1.5, intervalMs: 10 },
    { count: 2, intervalMs: Number.NaN },
  ])("rejects invalid stagger options (%o)", (options) => {
    expect(() => staggerAnimations(fadeInAnimation(), options)).toThrow(FatalError);
  });
});

describe("sequenceAnimations", () => {
  it("starts each spec when the previous one finishes", () => {
    const specs = sequenceAnimations([
      fadeInAnimation({ durationMs: 100 }),
      fadeOutAnimation({ durationMs: 200 }),
      scaleInAnimation({ durationMs: 50 }),
    ]);

    expect(specs.map((spec) => spec.delayMs)).toEqual([0, 100, 300]);
  });

  it("inserts a gap between consecutive specs", () => {
    const specs = sequenceAnimations(
      [fadeInAnimation({ durationMs: 100 }), fadeOutAnimation({ durationMs: 100 })],
      { gapMs: 40 },
    );

    expect(specs.map((spec) => spec.delayMs)).toEqual([0, 140]);
  });

  it("accumulates a spec's own delay into the following start time", () => {
    const specs = sequenceAnimations([
      fadeInAnimation({ durationMs: 100, delayMs: 30 }),
      fadeOutAnimation({ durationMs: 100 }),
    ]);

    expect(specs.map((spec) => spec.delayMs)).toEqual([30, 130]);
  });

  it("multiplies the duration by a finite iteration count", () => {
    const specs = sequenceAnimations([
      { ...fadeInAnimation({ durationMs: 100 }), iterations: 3 },
      fadeOutAnimation({ durationMs: 100 }),
    ]);

    expect(specs.map((spec) => spec.delayMs)).toEqual([0, 300]);
  });

  it("rejects an endless spec that something else has to follow", () => {
    let caught: unknown;
    try {
      sequenceAnimations([{ ...fadeInAnimation(), iterations: "infinite" }, fadeOutAnimation()]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FatalError);
    expect((caught as FatalError).code).toBe("ANIMATION_SEQUENCE_INFINITE");
  });

  it("allows the last spec to run forever, since nothing follows it", () => {
    const specs = sequenceAnimations([
      fadeInAnimation({ durationMs: 100 }),
      { ...fadeOutAnimation(), iterations: "infinite" },
    ]);

    expect(specs.map((spec) => spec.delayMs)).toEqual([0, 100]);
    expect(specs[1]?.iterations).toBe("infinite");
  });

  it("returns an empty list for no specs", () => {
    expect(sequenceAnimations([])).toEqual([]);
  });
});
