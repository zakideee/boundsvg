import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import type { BoxSceneNode } from "../../src/scene/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

function canvasWith(children: VNode[]): VNode {
  return createElement("Canvas", { width: 800, height: 600, meta: { scene: "test" } }, ...children);
}

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

describe("node metadata", () => {
  it("emits data-boundsvg-meta-* attributes in key-sorted order regardless of insertion order", () => {
    const a = canvasWith([
      createElement("Box", {
        id: "b",
        width: 100,
        height: 100,
        background: "#111111",
        meta: { zebra: "1", alpha: "2" },
      }),
    ]);
    const b = canvasWith([
      createElement("Box", {
        id: "b",
        width: 100,
        height: 100,
        background: "#111111",
        meta: { alpha: "2", zebra: "1" },
      }),
    ]);
    const svgA = engine.renderToSvg(a);
    const svgB = engine.renderToSvg(b);
    expect(svgA).toBe(svgB);
    expect(svgA).toContain('data-boundsvg-meta-alpha="2" data-boundsvg-meta-zebra="1"');
  });

  it("carries Canvas meta on the svg root element", () => {
    const svg = engine.renderToSvg(canvasWith([]));
    expect(svg).toMatch(/<svg [^>]*data-boundsvg-meta-scene="test"/);
  });

  it("escapes meta values", () => {
    const svg = engine.renderToSvg(
      canvasWith([
        createElement("Box", {
          id: "b",
          width: 100,
          height: 100,
          background: "#111111",
          meta: { note: 'a<b&"c' },
        }),
      ]),
    );
    expect(svg).toContain('data-boundsvg-meta-note="a&lt;b&amp;&quot;c"');
  });

  it("appears in the layered manifest keyed by nodeId", () => {
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 100 },
      createElement("Box", {
        id: "tag-target",
        layer: "content",
        width: 100,
        height: 50,
        background: "#222222",
        meta: { role: "cta" },
      }),
    );
    const result = engine.renderToLayeredSvg(vnode);
    const layer = result.layers.find((entry) => entry.id === "content");
    expect(layer?.nodeMeta?.["tag-target"]).toEqual({ role: "cta" });
    // per-layer SVGs flatten ancestor groups, so the attribute lives on the
    // combined output; the manifest is the per-layer contract for meta
    const combined = engine.renderToSvg(vnode);
    expect(combined).toContain('data-boundsvg-meta-role="cta"');
  });

  it("survives Shape expansion to the output", () => {
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 100 },
      createElement("Shape", {
        id: "badge",
        width: 100,
        height: 60,
        fill: "#123456",
        geometry: {
          viewBox: { width: 10, height: 6 },
          root: { kind: "path" as const, d: "M0 0H10V6H0Z" },
        },
        meta: { role: "badge" },
      }),
    );
    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain('data-boundsvg-meta-role="badge"');
  });

  it("round-trips through SceneDocument", () => {
    const vnode = createElement("Box", {
      id: "b",
      width: 10,
      height: 10,
      meta: { role: "cta", variant: "a" },
    });
    const scene = toSceneDocument(vnode) as BoxSceneNode;
    expect(scene.meta).toEqual({ role: "cta", variant: "a" });
    const restored = fromSceneDocument(scene);
    expect((restored.props as { meta?: Record<string, string> }).meta).toEqual({
      role: "cta",
      variant: "a",
    });
  });

  it("rejects invalid keys, oversize values, and too many keys", () => {
    const canvas = (meta: Record<string, string>) =>
      createElement(
        "Canvas",
        { width: 100, height: 100 },
        createElement("Box", { width: 10, height: 10, meta }),
      );
    expect(() => validate(canvas({ "Bad Key": "x" }))).toThrowError(/meta key/);
    expect(() => validate(canvas({ ok: "x".repeat(257) }))).toThrowError(/at most 256/);
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, "v"]));
    expect(() => validate(canvas(many))).toThrowError(/at most 16/);
    expect(() => validate(canvas({ fine: "value" }))).not.toThrow();
  });
});
