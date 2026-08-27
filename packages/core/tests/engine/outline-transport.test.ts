import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EngineOptions } from "../../src/engine.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

type TransportCounts = {
  wasmCalls: number;
  sceneFullIrInputs: number;
  sceneFullIrOutputs: number;
  layerIrInputs: number;
};

function reset(counts: TransportCounts): void {
  counts.wasmCalls = 0;
  counts.sceneFullIrInputs = 0;
  counts.sceneFullIrOutputs = 0;
  counts.layerIrInputs = 0;
}

function outlineHeavyScene() {
  const line = "Outline ownership 日本語 fallback deterministic path ".repeat(12);
  return createElement(
    "Canvas",
    { width: 720, height: 420 },
    createElement(
      "Flex",
      { direction: "column", width: 680, height: 380 },
      ...Array.from({ length: 8 }, (_, index) =>
        createElement(
          "Text",
          {
            id: `outline-heavy-${index}`,
            font: "NotoSansJP",
            fontSizePx: 16,
            width: 680,
            wrap: "word",
          },
          line,
        ),
      ),
    ),
  );
}

function countingTransports(
  handle: WasmEngineHandle,
  counts: TransportCounts,
): Partial<EngineOptions> {
  const rasterizePng = handle.createSvgToPngFn();
  const encodeWebp = handle.createSvgToWebpFn();
  const encodeAnimatedWebp = handle.createSvgsToAnimatedWebpFn();
  const encodeAnimatedGif = handle.createSvgsToAnimatedGifFn();
  return {
    renderToIrFn: (inputJson, optionsJson) => {
      counts.wasmCalls += 1;
      const outputJson = handle.renderToIr(inputJson, optionsJson);
      counts.sceneFullIrOutputs += 1;
      return outputJson;
    },
    renderToSvgFn: (inputJson, optionsJson) => {
      counts.wasmCalls += 1;
      const outputJson = handle.renderToSvg(inputJson, optionsJson);
      const output: unknown = JSON.parse(outputJson);
      if (typeof output === "object" && output !== null && "ir" in output && output.ir !== null) {
        counts.sceneFullIrOutputs += 1;
      }
      return outputJson;
    },
    resolveIrFn: (irJson, optionsJson) => {
      counts.wasmCalls += 1;
      counts.sceneFullIrInputs += 1;
      const outputJson = handle.resolveIr(irJson, optionsJson);
      counts.sceneFullIrOutputs += 1;
      return outputJson;
    },
    preflightIrFn: (irJson) => {
      counts.wasmCalls += 1;
      counts.sceneFullIrInputs += 1;
      return handle.preflightIr(irJson);
    },
    preflightRasterSceneFn: (irJson, optionsJson) => {
      counts.wasmCalls += 1;
      counts.sceneFullIrInputs += 1;
      const scene = handle.preflightRasterScene(irJson, optionsJson);
      return {
        resolveAndEmitToSvg: () => {
          counts.wasmCalls += 1;
          return scene.resolveAndEmitToSvg();
        },
        resolveToIr: () => {
          counts.wasmCalls += 1;
          counts.sceneFullIrOutputs += 1;
          return scene.resolveToIr();
        },
        resolve: () => {
          counts.wasmCalls += 1;
          scene.resolve();
        },
        renderToSvg: (renderOptionsJson) => {
          counts.wasmCalls += 1;
          return scene.renderToSvg(renderOptionsJson);
        },
        dispose: () => scene.dispose(),
      };
    },
    resolveAndEmitSvgFromIrFn: (irJson, optionsJson) => {
      counts.wasmCalls += 1;
      counts.sceneFullIrInputs += 1;
      return handle.resolveAndEmitSvgFromIr(irJson, optionsJson);
    },
    prepareSceneFn: (irJson, optionsJson) => {
      counts.wasmCalls += 1;
      counts.sceneFullIrInputs += 1;
      const prepared = handle.prepareScene(irJson, optionsJson);
      return {
        renderToSvg: (renderOptionsJson) => {
          counts.wasmCalls += 1;
          return prepared.renderToSvg(renderOptionsJson);
        },
        dispose: () => prepared.dispose(),
      };
    },
    emitSvgFromIrFn: (irJson, optionsJson) => {
      counts.wasmCalls += 1;
      counts.layerIrInputs += 1;
      return handle.emitSvgFromIr(irJson, optionsJson);
    },
    svgToPngFn: (svg, options) => {
      counts.wasmCalls += 1;
      return rasterizePng(svg, options);
    },
    ...(encodeWebp && {
      svgToWebpFn: (svg, options) => {
        counts.wasmCalls += 1;
        return encodeWebp(svg, options);
      },
    }),
    ...(encodeAnimatedWebp && {
      svgsToAnimatedWebpFn: (input) => {
        counts.wasmCalls += 1;
        return encodeAnimatedWebp(input);
      },
    }),
    ...(encodeAnimatedGif && {
      svgsToAnimatedGifFn: (input) => {
        counts.wasmCalls += 1;
        return encodeAnimatedGif(input);
      },
    }),
  };
}

describe("outline ownership transport budget", () => {
  let handle: WasmEngineHandle;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
  });

  afterAll(() => {
    handle.dispose();
  });

  it("records native calls and full-IR transfers for every outline-bearing path", () => {
    const counts: TransportCounts = {
      wasmCalls: 0,
      sceneFullIrInputs: 0,
      sceneFullIrOutputs: 0,
      layerIrInputs: 0,
    };
    const engine = createEngineFromHandle(handle, countingTransports(handle, counts));
    const scene = outlineHeavyScene();

    engine.renderToSvg(scene);
    expect(counts).toEqual({
      wasmCalls: 1,
      sceneFullIrInputs: 0,
      sceneFullIrOutputs: 0,
      layerIrInputs: 0,
    });

    reset(counts);
    engine.renderToSvgAndIR(scene);
    expect(counts).toEqual({
      wasmCalls: 1,
      sceneFullIrInputs: 0,
      sceneFullIrOutputs: 1,
      layerIrInputs: 0,
    });

    const compiled = engine.compile(scene);
    reset(counts);
    engine.renderCompiledToSvg(compiled);
    expect(counts).toEqual({
      wasmCalls: 1,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 0,
      layerIrInputs: 0,
    });

    reset(counts);
    engine.renderToTextOutlines(scene);
    expect(counts).toEqual({
      wasmCalls: 2,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 2,
      layerIrInputs: 0,
    });

    reset(counts);
    const frames = [...engine.renderFrames(scene, { format: "svg", timesMs: [0, 100, 200] })];
    expect(frames).toHaveLength(3);
    expect(counts).toEqual({
      wasmCalls: 5,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 1,
      layerIrInputs: 0,
    });

    reset(counts);
    engine.renderToPng(scene);
    expect(counts).toEqual({
      wasmCalls: 4,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 1,
      layerIrInputs: 0,
    });

    const lightScene = createElement("Canvas", { width: 8, height: 8, background: "#2563eb" });
    reset(counts);
    engine.renderToWebp(lightScene);
    expect(counts).toEqual({
      wasmCalls: 4,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 1,
      layerIrInputs: 0,
    });

    reset(counts);
    expect([...engine.renderFrames(lightScene, { format: "png", timesMs: [0, 10] })]).toHaveLength(
      2,
    );
    expect(counts).toEqual({
      wasmCalls: 7,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 1,
      layerIrInputs: 0,
    });

    reset(counts);
    engine.renderToAnimatedWebp(lightScene, {
      iterations: "infinite",
      timesMs: [0, 10],
      frameDurationsMs: [10, 10],
    });
    expect(counts).toEqual({
      wasmCalls: 6,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 1,
      layerIrInputs: 0,
    });

    reset(counts);
    engine.renderToAnimatedGif(lightScene, {
      iterations: "infinite",
      timesMs: [0, 10],
      frameDurationsMs: [20, 20],
    });
    expect(counts).toEqual({
      wasmCalls: 6,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 1,
      layerIrInputs: 0,
    });

    reset(counts);
    engine.renderToLayeredPng(lightScene);
    expect(counts).toEqual({
      wasmCalls: 6,
      sceneFullIrInputs: 1,
      sceneFullIrOutputs: 2,
      layerIrInputs: 2,
    });
  }, 30_000);
});
