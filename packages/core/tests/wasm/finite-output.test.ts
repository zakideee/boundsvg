import { afterAll, beforeAll, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

it("preserves finite animation inputs and reports sampled output overflow through Core", () => {
  const engine = createEngineFromHandle(handle);
  const scene = createElement(
    "Canvas",
    { width: 10, height: 10 },
    createElement("Box", {
      id: "subject",
      width: 10,
      height: 10,
      background: "black",
      animate: {
        durationMs: 100,
        easing: "linear",
        fill: "both",
        keyframes: [
          { at: 0, transform: { translateX: -Number.MAX_VALUE } },
          { at: 1, transform: { translateX: Number.MAX_VALUE } },
        ],
      },
    }),
  );
  expect(() => engine.compile(scene)).not.toThrow();
  expect(() => engine.sampleAnimationState(scene, 50)).toThrowError(
    expect.objectContaining({
      code: "WASM_NON_FINITE_OUTPUT",
      message: "WASM output contains a non-finite number.",
      stage: "wasm",
      context: { operation: "sample_animation_state", field: "e" },
    }),
  );
  expect(() => engine.sampleAnimationState(scene, 50)).toThrow(FatalError);
});
