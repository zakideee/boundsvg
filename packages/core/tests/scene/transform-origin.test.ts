import { describe, expect, it } from "vitest";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";

describe("scene transform origins", () => {
  it("reports the keyword-or-ratio expectation for an invalid structural type", () => {
    expect(() => fromSceneDocument({ type: "Box", children: [], transformOrigin: 5 })).toThrow(
      expect.objectContaining({
        code: "SCENE_DECODE_INVALID_VALUE",
        context: expect.objectContaining({ expected: "box-position" }),
      }),
    );
  });
  it("roundtrips and detaches explicit ratio objects in both directions", () => {
    const origin = { x: 0.3, y: 0.5 };
    const vnode = createElement("Box", {
      id: "box",
      transformOrigin: origin,
      transform: { rotateDeg: 90 },
    });
    const scene = toSceneDocument(vnode);
    expect(scene.type).toBe("Box");
    if (scene.type !== "Box") {
      throw new Error("Box required");
    }
    expect(scene.transformOrigin).toEqual(origin);
    expect(scene.transformOrigin).not.toBe(origin);
    const restored = fromSceneDocument(scene);
    if (restored.type !== "Box") {
      throw new Error("Box required");
    }
    expect(restored.props.transformOrigin).toEqual(origin);
    expect(restored.props.transformOrigin).not.toBe(scene.transformOrigin);
    origin.x = 1;
    expect(scene.transformOrigin).toEqual({ x: 0.3, y: 0.5 });
  });

  it("preserves keywords and origin-only inputs", () => {
    const scene = toSceneDocument(
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24, transformOrigin: "bottom right" },
        "text",
      ),
    );
    expect(scene).toMatchObject({ transformOrigin: "bottom right" });
    expect(scene).not.toHaveProperty("transform");
    expect(fromSceneDocument(scene).props).toMatchObject({ transformOrigin: "bottom right" });
  });

  it("copies validated own axes even when they are not enumerable", () => {
    const origin = { x: 0.3, y: 0.7 };
    Object.defineProperty(origin, "x", { enumerable: false });
    Object.defineProperty(origin, "y", { enumerable: false });
    const scene = toSceneDocument(createElement("Box", { transformOrigin: origin }));
    expect(scene).toMatchObject({ transformOrigin: { x: 0.3, y: 0.7 } });
    expect(fromSceneDocument(scene).props).toMatchObject({ transformOrigin: { x: 0.3, y: 0.7 } });
  });

  it.each([
    null,
    { x: 0 },
    { x: 0, y: 0, extra: 1 },
    [0, 0],
  ])("rejects malformed structural origin %j", (transformOrigin) => {
    expect(() => fromSceneDocument({ type: "Box", children: [], transformOrigin })).toThrow();
  });

  it.each([
    "left top",
    { x: 2, y: 0 },
    { x: Number.MIN_VALUE, y: 0 },
  ])("rejects semantic origin %j", (transformOrigin) => {
    expect(() =>
      fromSceneDocument({ type: "Box", children: [], id: "box", transformOrigin }),
    ).toThrow("transformOrigin");
  });

  it("rejects pixel-origin conflicts and unsupported VNode owners", () => {
    expect(() =>
      fromSceneDocument({
        type: "Box",
        children: [],
        transformOrigin: "center",
        transform: { originY: 0 },
      }),
    ).toThrow("cannot be combined");
    const canvas = {
      type: "Canvas",
      props: { width: 10, height: 10, transformOrigin: "center" },
      children: [],
    } as unknown as VNode;
    expect(() => toSceneDocument(canvas)).toThrow('does not support prop "transformOrigin"');
  });
});
