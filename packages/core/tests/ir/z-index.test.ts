import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { hitTest } from "../../src/ir/hit-test.js";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import type { BoxSceneNode } from "../../src/scene/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

function box(id: string, zIndex: number | undefined, at: { x: number; y: number }): VNode {
  return createElement("Box", {
    id,
    width: 100,
    height: 100,
    background: "#111111",
    position: "absolute",
    left: at.x,
    top: at.y,
    ...(zIndex === undefined ? {} : { zIndex }),
  });
}

function canvasWith(children: VNode[]): VNode {
  return createElement("Canvas", { width: 800, height: 600 }, ...children);
}

function bgOrder(drawOrder: readonly string[], ids: string[]): string[] {
  const wanted = new Set(ids.map((id) => `${id}:bg`));
  return drawOrder.filter((nodeId) => wanted.has(nodeId));
}

describe("zIndex paint ordering", () => {
  it("orders siblings by ascending zIndex", () => {
    const ir = engine.renderToIR(
      canvasWith([
        box("a", 2, { x: 0, y: 0 }),
        box("b", 0, { x: 10, y: 0 }),
        box("c", 1, { x: 20, y: 0 }),
      ]),
    );
    expect(bgOrder(ir.drawOrder, ["a", "b", "c"])).toEqual(["b:bg", "c:bg", "a:bg"]);
  });

  it("keeps source order for equal zIndex (stable)", () => {
    const ir = engine.renderToIR(
      canvasWith([
        box("a", 1, { x: 0, y: 0 }),
        box("b", undefined, { x: 10, y: 0 }),
        box("c", 1, { x: 20, y: 0 }),
      ]),
    );
    // undefined = 0 paints first; ties a/c keep source order
    expect(bgOrder(ir.drawOrder, ["a", "b", "c"])).toEqual(["b:bg", "a:bg", "c:bg"]);
  });

  it("paints negative zIndex below zero siblings but above the parent background", () => {
    const parent = createElement(
      "Box",
      { id: "parent", width: 400, height: 200, background: "#222222" },
      box("neg", -1, { x: 0, y: 0 }),
      box("zero", undefined, { x: 10, y: 0 }),
    );
    const ir = engine.renderToIR(canvasWith([parent]));
    const order = ir.drawOrder;
    expect(order.indexOf("parent:bg")).toBeLessThan(order.indexOf("neg:bg"));
    expect(order.indexOf("neg:bg")).toBeLessThan(order.indexOf("zero:bg"));
  });

  it("does not reorder across parents (no stacking contexts)", () => {
    const parentA = createElement(
      "Box",
      { id: "pa", width: 200, height: 200, background: "#333333" },
      box("inner", 100, { x: 0, y: 0 }),
    );
    const parentB = createElement("Box", {
      id: "pb",
      zIndex: 1,
      width: 200,
      height: 200,
      background: "#444444",
      position: "absolute",
      left: 50,
      top: 0,
    });
    const ir = engine.renderToIR(canvasWith([parentA, parentB]));
    // inner has zIndex 100 but stays inside parentA, which paints before parentB
    expect(ir.drawOrder.indexOf("inner:bg")).toBeLessThan(ir.drawOrder.indexOf("pb:bg"));
  });

  it("does not change auto-generated node IDs when zIndex reorders painting", () => {
    const twoBoxes = (z: [number | undefined, number | undefined]) =>
      canvasWith([
        createElement("Box", {
          width: 100,
          height: 100,
          background: "#111111",
          position: "absolute",
          left: 0,
          top: 0,
          ...(z[0] === undefined ? {} : { zIndex: z[0] }),
        }),
        createElement("Box", {
          width: 100,
          height: 100,
          background: "#222222",
          position: "absolute",
          left: 10,
          top: 0,
          ...(z[1] === undefined ? {} : { zIndex: z[1] }),
        }),
      ]);
    const plain = engine.renderToIR(twoBoxes([undefined, undefined]));
    const flipped = engine.renderToIR(twoBoxes([5, 1]));
    expect(new Set(flipped.drawOrder)).toEqual(new Set(plain.drawOrder));
  });

  it("hit-test returns the zIndex-topmost sibling", () => {
    // hit-test only returns semantic leaf nodes (bg/border are skipped), so
    // use overlapping Path leaves rather than background Boxes.
    const path = (id: string, zIndex: number): VNode =>
      createElement("Path", {
        id,
        d: "M0 0H100V100H0Z",
        width: 100,
        height: 100,
        fill: "#123456",
        zIndex,
        position: "absolute",
        left: 0,
        top: 0,
      });
    const ir = engine.renderToIR(canvasWith([path("top", 5), path("under", 0)]));
    expect(hitTest(ir, 50, 50)).toBe("top");
  });
});

describe("zIndex scene round-trip and validation", () => {
  it("round-trips zIndex through SceneDocument", () => {
    const vnode = createElement("Box", { id: "b", width: 10, height: 10, zIndex: 3 });
    const scene = toSceneDocument(vnode) as BoxSceneNode;
    expect(scene.zIndex).toBe(3);
    const restored = fromSceneDocument(scene);
    expect((restored.props as { zIndex?: number }).zIndex).toBe(3);
  });

  it("rejects non-integer zIndex", () => {
    const canvas = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", { width: 10, height: 10, zIndex: 1.5 }),
    );
    expect(() => validate(canvas)).toThrowError(/zIndex must be an integer/);
  });
});
