import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec } from "../../src/vnode/types.js";

const VALID_ANIMATION: AnimationSpec = {
  keyframes: [
    { at: 0, opacity: 0, transform: { translateX: 0, scaleX: 1 } },
    { at: 1, opacity: 1, transform: { translateX: 40, scaleX: 1.2 } },
  ],
  durationMs: 500,
  delayMs: -20,
  easing: [0.25, 0.1, 0.25, 1],
  iterations: 2.5,
  fill: "both",
};

function scene(animation: AnimationSpec) {
  return createElement(
    "Canvas",
    { width: 100, height: 100 },
    createElement("Box", { id: "animated", width: 20, height: 20, animate: animation }),
  );
}

function captureAnimationError(animation: AnimationSpec): FatalError {
  try {
    validate(scene(animation));
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("Expected validation to reject the animation");
}

describe("AnimationSpec validation", () => {
  it("accepts the complete v1 opacity/transform subset", () => {
    expect(() => validate(scene(VALID_ANIMATION))).not.toThrow();
  });

  it.each([
    "step-start",
    "step-end",
    { type: "steps", count: 1 },
    { type: "steps", count: 2, position: "jump-start" },
    { type: "steps", count: 2, position: "jump-end" },
    { type: "steps", count: 2, position: "jump-none" },
    { type: "steps", count: 2, position: "jump-both" },
    { type: "steps", count: 5 },
    { type: "steps", count: 1e21 },
  ] as const)("accepts typed step easing %#", (easing) => {
    expect(() => validate(scene({ ...VALID_ANIMATION, easing }))).not.toThrow();
  });

  it.each([
    ["positive duration", { ...VALID_ANIMATION, durationMs: 0 }],
    [
      "strictly increasing offsets",
      {
        ...VALID_ANIMATION,
        keyframes: [
          { at: 0.5, opacity: 0 },
          { at: 0.5, opacity: 1 },
        ],
      },
    ],
    [
      "complete target tracks",
      {
        ...VALID_ANIMATION,
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, transform: {} },
        ],
      },
    ],
    ["known easing", { ...VALID_ANIMATION, easing: "steps(2)" }],
    ["step aliases", { ...VALID_ANIMATION, easing: "start" }],
    ["positive step count", { ...VALID_ANIMATION, easing: { type: "steps", count: 0 } }],
    ["finite step count", { ...VALID_ANIMATION, easing: { type: "steps", count: Number.NaN } }],
    [
      "finite step count",
      { ...VALID_ANIMATION, easing: { type: "steps", count: Number.POSITIVE_INFINITY } },
    ],
    ["integer step count", { ...VALID_ANIMATION, easing: { type: "steps", count: 1.5 } }],
    [
      "jump-none step count",
      {
        ...VALID_ANIMATION,
        easing: { type: "steps", count: 1, position: "jump-none" },
      },
    ],
    [
      "known step position",
      { ...VALID_ANIMATION, easing: { type: "steps", count: 2, position: "end" } },
    ],
    [
      "string step position",
      { ...VALID_ANIMATION, easing: { type: "steps", count: 2, position: null } },
    ],
    ["steps discriminator", { ...VALID_ANIMATION, easing: { type: "step", count: 2 } }],
    ["steps object keys", { ...VALID_ANIMATION, easing: { type: "steps", count: 2, extra: true } }],
    [
      "fixed center origin",
      {
        ...VALID_ANIMATION,
        keyframes: [
          { at: 0, transform: { originX: 10 } },
          { at: 1, transform: { originX: 20 } },
        ],
      },
    ],
  ] as const)("rejects a spec without %s", (_label, invalidAnimation) => {
    const error = captureAnimationError(invalidAnimation as unknown as AnimationSpec);
    expect(error.code).toBe("ANIMATION_INVALID_SPEC");
    expect(error.stage).toBe("validate");
    expect(error.nodeId).toBe("animated");
  });
});

describe("Text animateUnits validation", () => {
  function textScene(animateUnits: unknown) {
    return createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement(
        "Text",
        {
          id: "animated-text",
          font: "TestFont",
          fontSizePx: 20,
          animateUnits,
        } as never,
        "text",
      ),
    );
  }

  it("accepts the JSON-serializable cluster and line contract", () => {
    expect(() =>
      validate(
        textScene({
          by: "cluster",
          animation: VALID_ANIMATION,
          delayStepMs: 40,
          order: "visual",
          ruby: "separate",
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    { by: "grapheme", animation: VALID_ANIMATION },
    { by: "line", animation: VALID_ANIMATION, delayStepMs: -1 },
    { by: "line", animation: VALID_ANIMATION, delayStepMs: Number.NaN },
    { by: "line", animation: VALID_ANIMATION, order: "source" },
    { by: "line", animation: VALID_ANIMATION, ruby: "annotation" },
    { by: "line", animation: VALID_ANIMATION, callback: () => 1 },
    { by: "line", animation: { ...VALID_ANIMATION, durationMs: 0 } },
  ])("rejects malformed unit semantics %#", (animateUnits) => {
    expect(() => validate(textScene(animateUnits))).toThrowError(
      expect.objectContaining({
        code: "ANIMATION_INVALID_SPEC",
        stage: "validate",
        nodeId: "animated-text",
      }),
    );
  });
});
