import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const TINY_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function createAnimationFreeScene(): VNode {
  return createElement(
    "Canvas",
    { width: 320, height: 180, background: "#0f172a" },
    createElement(
      "Flex",
      { direction: "row", gap: 12, padding: [24, 24, 24, 24] },
      createElement("Box", {
        width: 96,
        height: 96,
        borderRadius: 16,
        background: "#38bdf8",
      }),
      createElement("Box", {
        width: 96,
        height: 96,
        borderRadius: 48,
        background: "#f43f5e",
      }),
    ),
  );
}

function createTextHeavyScene(): VNode {
  const text = "決定的なフレーム描画 Ligature office combining e\u0301 絵文字 🎬";
  return createElement(
    "Canvas",
    { width: 640, height: 480, background: "#f8fafc" },
    createElement(
      "Flex",
      {
        direction: "column",
        gap: 8,
        width: 640,
        height: 480,
        padding: [20, 24, 20, 24],
      },
      ...Array.from({ length: 10 }, (_, index) =>
        createElement(
          "Text",
          {
            id: `batch-text-${index}`,
            width: 592,
            font: "NotoSansJP",
            fallback: ["InterVariable"],
            fontSizePx: 18 + (index % 3) * 2,
            color: index % 2 === 0 ? "#0f172a" : "#334155",
            wrap: "char",
            maxLines: 2,
          },
          `${index + 1}. ${text}`,
        ),
      ),
    ),
  );
}

function createImageHeavyScene(): VNode {
  return createElement(
    "Canvas",
    { width: 480, height: 360, background: "#111827" },
    createElement(
      "Flex",
      {
        direction: "row",
        wrap: "wrap",
        gap: 8,
        width: 480,
        height: 360,
        padding: [16, 16, 16, 16],
      },
      ...Array.from({ length: 30 }, (_, index) =>
        createElement("Image", {
          id: `batch-image-${index}`,
          src: TINY_PNG_DATA_URI,
          width: 64,
          height: 56,
          borderRadius: index % 3,
          opacity: 0.55 + (index % 5) * 0.1,
          objectFit: "cover",
        }),
      ),
    ),
  );
}

function createAnimationHeavyScene(): VNode {
  return createElement(
    "Canvas",
    { width: 640, height: 360, background: "#020617" },
    createElement(
      "Flex",
      {
        direction: "row",
        wrap: "wrap",
        gap: 12,
        width: 640,
        height: 360,
        padding: [24, 24, 24, 24],
      },
      ...Array.from({ length: 24 }, (_, index) =>
        createElement("Box", {
          id: `batch-animated-${index}`,
          width: 84,
          height: 64,
          borderRadius: 12,
          background: index % 2 === 0 ? "#22d3ee" : "#a78bfa",
          animate: {
            keyframes: [
              {
                at: 0,
                opacity: 0.2,
                transform: {
                  translateX: -12 - (index % 4) * 3,
                  translateY: (index % 3) * 2,
                  rotateDeg: -8,
                  scaleX: 0.85,
                  scaleY: 0.85,
                },
              },
              {
                at: 0.5,
                opacity: 1,
                transform: {
                  translateX: 0,
                  translateY: -6,
                  rotateDeg: 0,
                  scaleX: 1.05,
                  scaleY: 1.05,
                },
              },
              {
                at: 1,
                opacity: 0.65,
                transform: {
                  translateX: 12 + (index % 4) * 3,
                  translateY: 0,
                  rotateDeg: 8,
                  scaleX: 0.92,
                  scaleY: 0.92,
                },
              },
            ],
            durationMs: 900 + (index % 5) * 100,
            delayMs: (index % 6) * 25,
            easing: index % 2 === 0 ? "ease-in-out" : "linear",
            fill: "both",
          },
        }),
      ),
    ),
  );
}

const PARITY_CASES: ReadonlyArray<{ name: string; build: () => VNode }> = [
  { name: "animation-free", build: createAnimationFreeScene },
  { name: "text-heavy", build: createTextHeavyScene },
  { name: "image-heavy", build: createImageHeavyScene },
  { name: "animation-heavy", build: createAnimationHeavyScene },
];

const CHECKPOINT_TIMES_MS = [600, 0, 1_400, 600] as const;
const PARITY_TEST_TIMEOUT_MS = 15_000;

describe("compiled animation frame parity", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    engine = createEngineFromHandle(handle, { svgToPngFn: handle.createSvgToPngFn() });
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it.each(PARITY_CASES)(
    "keeps $name SVG and PNG bytes equal to per-call rendering",
    ({ build }) => {
      const scene = build();
      const compiled = engine.compile(scene);

      for (const timeMs of CHECKPOINT_TIMES_MS) {
        const options = { timeMs };
        expect(engine.renderCompiledToSvg(compiled, options)).toBe(
          engine.renderToSvg(scene, options),
        );
        expect(engine.renderCompiledToPng(compiled, options)).toEqual(
          engine.renderToPng(scene, options),
        );
      }
    },
    PARITY_TEST_TIMEOUT_MS,
  );
});
