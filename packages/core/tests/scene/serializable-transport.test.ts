import { describe, expect, it, vi } from "vitest";
import { assertSerializableSceneTransport } from "../../src/scene/serializable-transport.js";
import type { SceneNode } from "../../src/scene/types.js";

function validScene(): SceneNode {
  return {
    type: "Canvas",
    width: 320,
    height: 180,
    children: [
      {
        type: "Flex",
        direction: "row",
        gap: 8,
        children: [
          { type: "Box", width: 40, height: 30, children: [] },
          { type: "Box", width: 60, height: 30, children: [] },
        ],
      },
    ],
  };
}

function asScene(value: unknown): SceneNode {
  return value as SceneNode;
}

describe("assertSerializableSceneTransport", () => {
  it("accepts plain scenes, null-prototype records, and repeated non-cyclic references", () => {
    const shared = { type: "Box", width: 20, height: 20, children: [] };
    const scene = {
      type: "Canvas",
      width: 100,
      height: 100,
      meta: Object.assign(Object.create(null) as Record<string, string>, { fixture: "plain" }),
      children: [shared, shared],
    };

    expect(() => assertSerializableSceneTransport(asScene(scene), 0)).not.toThrow();
  });

  it("keeps Box and Path strokeScaling JSON-safe across direct SceneDocument transport", () => {
    const scene = validScene();
    const box = scene.children[0];
    if (box?.type !== "Flex" || box.children[0]?.type !== "Box") {
      throw new Error("Expected the fixture Box");
    }
    box.children[0].strokeScaling = "canvas";
    scene.children.push({
      type: "Path",
      d: "M0 0L10 10",
      width: 10,
      height: 10,
      strokeScaling: "canvas",
    });
    expect(() => assertSerializableSceneTransport(scene)).not.toThrow();
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });

  it("visits each fully validated node once in a deeply shared DAG", () => {
    let shared: Record<string, unknown> = { type: "Box", children: [] };
    for (let depth = 0; depth < 20; depth += 1) {
      shared = { type: "Box", left: shared, right: shared, children: [] };
    }
    const descriptorSpy = vi.spyOn(Object, "getOwnPropertyDescriptors");
    let descriptorCalls: number;
    try {
      assertSerializableSceneTransport(asScene(shared), 0);
      descriptorCalls = descriptorSpy.mock.calls.length;
    } finally {
      descriptorSpy.mockRestore();
    }

    expect(descriptorCalls).toBe(21);
  });

  it("still enforces maximum depth when a memoized subtree is reached more deeply", () => {
    let shared: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 100; depth += 1) {
      shared = { child: shared };
    }
    let deepReference: Record<string, unknown> = { shared };
    for (let depth = 0; depth < 160; depth += 1) {
      deepReference = { child: deepReference };
    }
    const scene = { type: "Canvas", width: 1, height: 1, shallow: shared, deepReference };

    expect(() => assertSerializableSceneTransport(asScene(scene), 0)).toThrow("nesting exceeds");
  });

  it.each([
    ["function", () => ({ ...validScene(), extra: () => undefined })],
    ["promise", () => ({ ...validScene(), extra: Promise.resolve(1) })],
    ["class instance", () => ({ ...validScene(), extra: new (class Fixture {})() })],
    ["date", () => ({ ...validScene(), extra: new Date(0) })],
    ["typed array", () => ({ ...validScene(), extra: new Uint8Array([1]) })],
    ["undefined", () => ({ ...validScene(), extra: undefined })],
    ["bigint", () => ({ ...validScene(), extra: 1n })],
    ["non-finite", () => ({ ...validScene(), extra: Number.NaN })],
  ])("rejects %s values recursively", (_label, createScene) => {
    expect(() => assertSerializableSceneTransport(asScene(createScene()), 3)).toThrowError(
      expect.objectContaining({
        code: "WORKER_MATERIALIZED_FRAME_NOT_SERIALIZABLE",
        context: expect.objectContaining({ frameIndex: 3 }),
      }),
    );
  });

  it("uses a direct-scene error contract when no frame index is supplied", () => {
    const scene = { ...validScene(), extra: () => undefined };

    expect(() => assertSerializableSceneTransport(asScene(scene))).toThrowError(
      expect.objectContaining({
        code: "SCENE_NOT_SERIALIZABLE",
        context: expect.objectContaining({ path: "scene.extra" }),
      }),
    );
  });

  it("rejects cyclic references", () => {
    const scene = validScene();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    Reflect.set(scene, "cycle", cycle);

    expect(() => assertSerializableSceneTransport(scene, 1)).toThrowError(
      expect.objectContaining({ code: "WORKER_MATERIALIZED_FRAME_NOT_SERIALIZABLE" }),
    );
  });

  it("rejects accessors, non-enumerable fields, and symbol keys", () => {
    const accessorScene = validScene();
    Object.defineProperty(accessorScene, "dynamic", {
      enumerable: true,
      get: () => 1,
    });
    expect(() => assertSerializableSceneTransport(accessorScene, 0)).toThrow("accessor");

    const hiddenScene = validScene();
    Object.defineProperty(hiddenScene, "hidden", { enumerable: false, value: 1 });
    expect(() => assertSerializableSceneTransport(hiddenScene, 0)).toThrow("non-enumerable");

    const symbolScene = validScene();
    Reflect.set(symbolScene, Symbol("hidden"), 1);
    expect(() => assertSerializableSceneTransport(symbolScene, 0)).toThrow("symbol-keyed");
  });

  it("wraps hostile transport inspection failures as a fatal validation error", () => {
    const scene = new Proxy(validScene(), {
      ownKeys: () => {
        throw new Error("hostile ownKeys");
      },
    });

    expect(() => assertSerializableSceneTransport(scene, 2)).toThrowError(
      expect.objectContaining({
        code: "WORKER_MATERIALIZED_FRAME_NOT_SERIALIZABLE",
        message: expect.stringContaining("hostile ownKeys"),
      }),
    );
  });

  it("rejects sparse arrays and arrays with ignored extra properties", () => {
    const sparseScene = validScene();
    sparseScene.children = new Array<SceneNode>(1);
    expect(() => assertSerializableSceneTransport(sparseScene, 0)).toThrow("sparse");

    const extraScene = validScene();
    Reflect.set(extraScene.children, "ignored", true);
    expect(() => assertSerializableSceneTransport(extraScene, 0)).toThrow("extra own");

    const accessorScene = validScene();
    Object.defineProperty(accessorScene.children, 0, {
      enumerable: true,
      get: () => validScene(),
    });
    expect(() => assertSerializableSceneTransport(accessorScene, 0)).toThrow("enumerable data");
  });

  it("rejects transport nesting beyond the explicit safety limit", () => {
    const scene = validScene();
    let nested: Record<string, unknown> = scene as unknown as Record<string, unknown>;
    for (let depth = 0; depth < 260; depth += 1) {
      const child: Record<string, unknown> = {};
      nested.deep = child;
      nested = child;
    }

    expect(() => assertSerializableSceneTransport(scene, 0)).toThrow("nesting exceeds");
  });
});
