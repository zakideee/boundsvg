import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { resolveTransformOrigin } from "../../src/position.js";
import { validateTransformProp } from "../../src/validate/visual-props.js";
import type { BoxPosition, VNode } from "../../src/vnode/types.js";

/** Smallest positive normal binary64 input ratio. */
const NORMAL_RATIO_MIN = 2 ** -1022;

describe("static transform origin authoring", () => {
  it.each([
    ["top left", 0, 0],
    ["top", 0.5, 0],
    ["top right", 1, 0],
    ["left", 0, 0.5],
    ["center", 0.5, 0.5],
    ["right", 1, 0.5],
    ["bottom left", 0, 1],
    ["bottom", 0.5, 1],
    ["bottom right", 1, 1],
  ] as const)("maps %s to its exact ratios", (keyword, ratioX, ratioY) => {
    expect(resolveTransformOrigin(keyword, { rotateDeg: 90 }, "node")).toEqual({
      x: ratioX,
      y: ratioY,
    });
  });

  it.each([
    0,
    -0,
    NORMAL_RATIO_MIN,
    NORMAL_RATIO_MIN + Number.MIN_VALUE,
    0.3,
    0.5,
    1 - Number.EPSILON / 2,
    1,
  ])("accepts in-domain ratio %s and detaches the returned object", (ratio) => {
    const position = { x: ratio, y: ratio };
    const resolved = resolveTransformOrigin(position, undefined, "node");
    expect(resolved).toEqual({ x: ratio === 0 ? 0 : ratio, y: ratio === 0 ? 0 : ratio });
    expect(resolved).not.toBe(position);
    expect(Object.is(resolved?.x, -0)).toBe(false);
  });

  it.each([
    null,
    false,
    0,
    [],
    "",
    "left top",
    "Center",
    " center",
    "30% 20%",
    "left 25%",
    "toString",
    {},
    { x: 0 },
    { x: 0, y: 0, extra: 1 },
    { x: "left", y: 0 },
    ...[
      -1,
      -Number.MIN_VALUE,
      Number.MIN_VALUE,
      NORMAL_RATIO_MIN - Number.MIN_VALUE,
      1 + Number.EPSILON,
      NaN,
      Infinity,
      -Infinity,
    ].flatMap((ratio) => [
      { x: ratio, y: 0 },
      { x: 0, y: ratio },
    ]),
  ])("rejects malformed or out-of-domain position %j", (position) => {
    expect(() => resolveTransformOrigin(position, undefined, "origin-node")).toThrow(FatalError);
    try {
      resolveTransformOrigin(position, undefined, "origin-node");
    } catch (error) {
      expect(error).toMatchObject({ code: "VALIDATION", stage: "validate", nodeId: "origin-node" });
    }
  });

  it("rejects extra non-enumerable and symbol own keys", () => {
    const hiddenKey = Object.defineProperty({ x: 0, y: 0 }, "extra", { value: 1 });
    const symbolKey = { x: 0, y: 0, [Symbol("extra")]: 1 };
    expect(() => resolveTransformOrigin(hiddenKey, undefined, "node")).toThrow("exactly");
    expect(() => resolveTransformOrigin(symbolKey, undefined, "node")).toThrow("exactly");
  });

  it.each([
    { originX: 0 },
    { originY: 0 },
    { originX: 12, originY: 8 },
  ])("rejects a relative origin combined with pixel origins %j", (transform) => {
    expect(() => resolveTransformOrigin("center", transform, "node")).toThrow("cannot be combined");
  });

  it("keeps missing origin absent and permits undefined pixel channels", () => {
    expect(resolveTransformOrigin(undefined, { originX: 4 }, "node")).toBeUndefined();
    expect(resolveTransformOrigin("center", { originX: undefined }, "node")).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it.each([
    "Flex",
    "Grid",
    "Box",
    "Text",
    "Image",
    "Path",
    "Svg",
    "Shape",
    "Symbol",
  ] as const)("accepts origin-only on %s", (type) => {
    const node = {
      type,
      props: { transformOrigin: "center" satisfies BoxPosition },
      children: [],
    } as unknown as VNode;
    expect(() => validateTransformProp(node, "node")).not.toThrow();
  });

  it.each([
    "Canvas",
    "Inline",
    "InlineBox",
    "InlineRect",
    "TextOnPath",
    "Ruby",
    "Rt",
  ] as const)("rejects origin-only on %s", (type) => {
    const node = { type, props: { transformOrigin: "center" }, children: [] } as unknown as VNode;
    expect(() => validateTransformProp(node, "node")).toThrow(
      'does not support prop "transformOrigin"',
    );
  });
});
