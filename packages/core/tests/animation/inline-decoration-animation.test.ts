import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { Canvas, Inline, InlineBox, Text, validate } from "../../src/index.js";
import type { CanvasSceneNode } from "../../src/scene/types.js";
import type { AnimationSpec } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const FADE: AnimationSpec = {
  keyframes: [
    { at: 0, opacity: 0 },
    { at: 1, opacity: 1 },
  ],
  durationMs: 200,
  delayMs: 400,
  fill: "both",
};

function decoratedScene() {
  return Canvas(
    { width: 400, height: 120 },
    Text(
      { font: "NotoSansJP", fontSizePx: 20, width: 360 },
      "ab ",
      Inline({ background: "#112233", paddingInline: [4, 4], animate: FADE }, "chip"),
      " ",
      InlineBox({ background: "#445566", paddingInline: [4, 4], animate: FADE }, "box"),
    ),
  );
}

/** Opacity attributes of the groups wrapping animated `:ibox` decoration rects. */
function iboxGroupOpacities(svg: string): string[] {
  return [...svg.matchAll(/<g[^>]*:ibox\d+"[^>]*>/g)].map(
    (match) => /opacity="([^"]*)"/.exec(match[0])?.[1] ?? "1",
  );
}

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  engine.dispose();
  handle.dispose();
});

describe("Inline / InlineBox decoration animation", () => {
  it("accepts animate on decorated Inline and InlineBox", () => {
    expect(() => validate(decoratedScene())).not.toThrow();
  });

  it("rejects animate without a decoration prop", () => {
    const inlineOnly = Canvas(
      { width: 100, height: 40 },
      Text({ font: "NotoSansJP", fontSizePx: 12 }, Inline({ animate: FADE }, "x")),
    );
    expect(() => validate(inlineOnly)).toThrow(/Inline "animate" targets decoration fragments/);
    const boxOnly = Canvas(
      { width: 100, height: 40 },
      Text({ font: "NotoSansJP", fontSizePx: 12 }, InlineBox({ animate: FADE }, "x")),
    );
    expect(() => validate(boxOnly)).toThrow(/InlineBox "animate" targets the decoration fragment/);
  });

  it("hides both decoration fragments before their delay in static sampling", () => {
    const svg = engine.renderToSvg(decoratedScene(), { timeMs: 0 });
    const opacities = iboxGroupOpacities(svg);
    expect(opacities).toHaveLength(2);
    expect(opacities).toEqual(["0", "0"]);
  });

  it("shows both decoration fragments after the animation settles", () => {
    const svg = engine.renderToSvg(decoratedScene(), { timeMs: 1_000 });
    const opacities = iboxGroupOpacities(svg);
    expect(opacities).toHaveLength(2);
    expect(opacities.every((value) => Number(value) === 1)).toBe(true);
  });

  it("emits declarative animations for both decoration fragments", () => {
    const svg = engine.renderToAnimatedSvg(decoratedScene(), {
      playback: { mode: "independent" },
      resourceIdPrefix: "deco-anim",
    });
    expect(iboxGroupOpacities(svg)).toHaveLength(2);
    expect(svg).toContain("@keyframes");
  });

  it("keeps unanimated decorations free of wrapper groups", () => {
    const plain = Canvas(
      { width: 400, height: 120 },
      Text(
        { font: "NotoSansJP", fontSizePx: 20, width: 360 },
        Inline({ background: "#112233" }, "chip"),
        InlineBox({ background: "#445566" }, "box"),
      ),
    );
    const svg = engine.renderToSvg(plain, { timeMs: 0 });
    expect(iboxGroupOpacities(svg)).toHaveLength(0);
    expect(svg).toContain("#112233");
    expect(svg).toContain("#445566");
  });
});

describe("Shape node animation", () => {
  // Shape (and Symbol, which shares ShapeBaseProps and the node-animation
  // path) predates this suite; this pins the support so a regression cannot
  // pass silently.
  it("samples Shape animate across its delay", () => {
    const shapeEngine = createEngineFromHandle(handle, {
      geometries: [
        {
          id: "anim-rect",
          doc: { viewBox: { width: 20, height: 10 }, root: { kind: "path", d: "M0 0H20V10H0Z" } },
        },
      ],
    });
    try {
      const scene = {
        type: "Canvas",
        width: 120,
        height: 60,
        children: [
          {
            type: "Shape",
            geometryId: "anim-rect",
            width: 80,
            height: 30,
            fill: "#2563eb",
            animate: FADE,
          },
        ],
      } as CanvasSceneNode;
      const before = shapeEngine.renderToSvg(scene, { timeMs: 0 });
      const settled = shapeEngine.renderToSvg(scene, { timeMs: 1_000 });
      expect(before).toContain('opacity="0"');
      expect(settled).not.toContain('opacity="0"');
    } finally {
      shapeEngine.dispose();
    }
  });
});
