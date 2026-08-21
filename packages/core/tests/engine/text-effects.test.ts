import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import type { TextSceneNode } from "../../src/scene/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "../wasm/test-prerequisites.js";

const FONT = "NotoSansJP";
let engine: Engine;

beforeAll(async () => {
  assertWasmPkgAvailable();
  await initNodeWasm();
  engine = await createEngineAsync({
    fonts: [{ alias: FONT, weight: 400, style: "normal", data: loadSubsetFont() }],
  });
});

function telop(textProps: Record<string, unknown>): VNode {
  return createElement(
    "Canvas",
    { width: 400, height: 120, background: "#1a1a1a" },
    createElement(
      "Text",
      {
        id: "telop",
        font: FONT,
        fontSizePx: 40,
        color: "#ffffff",
        ...textProps,
      },
      "縁取り",
    ),
  );
}

describe("multi-layer text stroke and shadow", () => {
  it("emits shadow, then strokes outermost-first, then fill", () => {
    const svg = engine.renderToSvg(
      telop({
        textStrokes: [
          { color: "#000000", widthPx: 12 },
          { color: "#e11d48", widthPx: 6 },
        ],
        textShadows: [{ dx: 3, dy: 3, blurPx: 4, color: "#000000" }],
      }),
    );

    // Shadow filter def + reference
    expect(svg).toContain("<feDropShadow");
    const filterRef = svg.match(/filter="url\(#([^"]+)\)"/);
    expect(filterRef).not.toBeNull();
    expect(svg).toContain(`<filter id="${filterRef?.[1]}"`);

    // Order: shadow group < outer stroke < inner stroke < plain fill path
    const shadowIndex = svg.indexOf('filter="url(#');
    const outerIndex = svg.indexOf('stroke="#000000" stroke-width="12"');
    const innerIndex = svg.indexOf('stroke="#e11d48" stroke-width="6"');
    expect(shadowIndex).toBeGreaterThan(-1);
    expect(outerIndex).toBeGreaterThan(shadowIndex);
    expect(innerIndex).toBeGreaterThan(outerIndex);
    const fillIndex = svg.indexOf('fill="#ffffff"', innerIndex);
    expect(fillIndex).toBeGreaterThan(innerIndex);

    // Stroke layers do not fill
    expect(svg).toMatch(/fill="none" stroke="#000000" stroke-width="12"/);
    // Layer defaults are round joins/caps
    expect(svg).toMatch(/stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/);
    // The legacy single-group form is not used
    expect(svg).not.toContain('paint-order="stroke"');
  });

  it("keeps the legacy single-group form for scalar textStroke", () => {
    const svg = engine.renderToSvg(telop({ textStroke: "#000000", textStrokeWidth: 4 }));
    expect(svg).toContain('paint-order="stroke"');
    expect(svg).not.toContain('fill="none" stroke=');
  });

  it("treats scalar textStroke as one layer when textShadows are present", () => {
    const svg = engine.renderToSvg(
      telop({
        textStroke: "#000000",
        textStrokeWidth: 4,
        textShadows: [{ dx: 2, dy: 2, color: "#000000" }],
      }),
    );
    expect(svg).not.toContain('paint-order="stroke"');
    expect(svg).toContain('fill="none" stroke="#000000" stroke-width="4"');
    expect(svg).toContain("<feDropShadow");
  });

  it("is deterministic", () => {
    const vnode = () =>
      telop({
        textStrokes: [{ color: "#000000", widthPx: 8 }],
        textShadows: [{ dx: 2, dy: 2, blurPx: 3, color: "#0f172a" }],
      });
    expect(engine.renderToSvg(vnode())).toBe(engine.renderToSvg(vnode()));
  });

  it("renders shadows into PNG output (resvg supports feDropShadow)", () => {
    const withShadow = engine.renderToPng(
      telop({ textShadows: [{ dx: 6, dy: 6, blurPx: 6, color: "#ff0000" }] }),
    );
    const withoutShadow = engine.renderToPng(telop({}));
    expect(withShadow.length).toBeGreaterThan(0);
    expect(Buffer.from(withShadow).equals(Buffer.from(withoutShadow))).toBe(false);
  });

  it("round-trips through SceneDocument", () => {
    const vnode = createElement(
      "Text",
      {
        font: FONT,
        fontSizePx: 20,
        textStrokes: [{ color: "#111111", widthPx: 3, linejoin: "bevel" }],
        textShadows: [{ dx: 1, dy: 2, blurPx: 3, color: "#222222" }],
      },
      "t",
    );
    const scene = toSceneDocument(vnode) as TextSceneNode;
    expect(scene.textStrokes?.[0]?.widthPx).toBe(3);
    expect(scene.textShadows?.[0]?.blurPx).toBe(3);
    const restored = fromSceneDocument(scene);
    expect((restored.props as { textStrokes?: unknown[] }).textStrokes).toHaveLength(1);
  });
});

describe("text effects validation", () => {
  it("rejects textStrokes combined with scalar textStroke", () => {
    expect(() =>
      validate(telop({ textStroke: "#000", textStrokes: [{ color: "#000000", widthPx: 2 }] })),
    ).toThrowError(/mutually exclusive/);
  });

  it("rejects more than the layer limit", () => {
    const layers = Array.from({ length: 9 }, () => ({ color: "#000000", widthPx: 1 }));
    expect(() => validate(telop({ textStrokes: layers }))).toThrowError(/at most 8/);
  });

  it("rejects non-positive stroke width", () => {
    expect(() => validate(telop({ textStrokes: [{ color: "#000000", widthPx: 0 }] }))).toThrowError(
      /positive and finite/,
    );
  });

  it("rejects negative shadow blur", () => {
    expect(() =>
      validate(telop({ textShadows: [{ dx: 0, dy: 0, blurPx: -1, color: "#000000" }] })),
    ).toThrowError(/non-negative/);
  });
});
