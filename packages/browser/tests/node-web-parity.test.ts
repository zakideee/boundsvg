import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement, Engine, type VNode } from "@boundsvg/core";
import {
  EXPECTED_WASM_SCHEMA_VERSION,
  WasmEngineHandle,
  type WasmEngineInstance,
} from "@boundsvg/core/wasm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import webWasmInit, {
  BoundSvgEngine as WebBoundSvgEngine,
  wasm_schema_version as webSchemaVersion,
} from "../../../crates/boundsvg/pkg-web/boundsvg.js";

type LowLevelWasmModule = {
  BoundSvgEngine: new () => WasmEngineInstance;
  wasm_schema_version: () => number;
};

const require = createRequire(import.meta.url);
const nodeWasm = require(
  resolve(__dirname, "../../core/wasm-pkg/boundsvg.js"),
) as LowLevelWasmModule;
const fontBytes = readFileSync(
  resolve(__dirname, "../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"),
);

function createLowLevelEngine(instance: WasmEngineInstance): Engine {
  const handle = new WasmEngineHandle(instance);
  const engine = new Engine({
    computeLayoutFn: handle.createComputeLayoutFn(),
    renderToIrFn: (inputJson, optionsJson) => handle.renderToIr(inputJson, optionsJson),
    renderToSvgFn: (inputJson, optionsJson) => handle.renderToSvg(inputJson, optionsJson),
    renderToAnimatedSvgFn: (inputJson, optionsJson) =>
      handle.renderToAnimatedSvg(inputJson, optionsJson),
    emitSvgFromIrFn: (irJson, optionsJson) => handle.emitSvgFromIr(irJson, optionsJson),
    emitAnimatedSvgFromIrFn: (irJson, optionsJson) =>
      handle.emitAnimatedSvgFromIr(irJson, optionsJson),
    resolveIrFn: (irJson, optionsJson) => handle.resolveIr(irJson, optionsJson),
    preflightIrFn: (irJson) => handle.preflightIr(irJson),
    preflightRasterSceneFn: (irJson, optionsJson) =>
      handle.preflightRasterScene(irJson, optionsJson),
    resolveAndEmitSvgFromIrFn: (irJson, optionsJson) =>
      handle.resolveAndEmitSvgFromIr(irJson, optionsJson),
    resolveAndEmitAnimatedSvgFromIrFn: (irJson, optionsJson) =>
      handle.resolveAndEmitAnimatedSvgFromIr(irJson, optionsJson),
    prepareSceneFn: (irJson, optionsJson) => handle.prepareScene(irJson, optionsJson),
    registerFontFn: (font) =>
      handle.registerFont(font.data, {
        alias: font.alias,
        weight: font.weight,
        style: font.style,
      }),
    svgToPngFn: handle.createSvgToPngFn(),
    svgToWebpFn: handle.createSvgToWebpFn(),
    layoutTextFlowFn: (input) => handle.layoutTextFlow(input),
    layoutTextFlowWithExclusionsFn: (input) => handle.layoutTextFlowWithExclusions(input),
    measureTextBlockFn: (input) => handle.measureTextBlock(input),
    shrinkwrapTextFn: (input) => handle.shrinkwrapText(input),
    shrinkwrapFlowFn: (input) => handle.shrinkwrapFlow(input),
    measureIntrinsicInlineSizeFn: (input) => handle.measureIntrinsicInlineSize(input),
    wasmHandle: handle,
  });
  engine.registerFonts([
    {
      alias: "NotoSansJP",
      weight: 400,
      style: "normal",
      data: new Uint8Array(fontBytes),
    },
  ]);
  return engine;
}

function buildScene(): VNode {
  return createElement(
    "Canvas",
    { width: 240, height: 140, background: "#ffffff" },
    createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 20,
        lineHeightPx: 30,
        width: 180,
        color: "#172554",
      },
      "Node/Web の代表比較",
    ),
  );
}

function buildAnimatedScene(): VNode {
  return createElement(
    "Canvas",
    { width: 120, height: 80 },
    createElement("Box", {
      id: "animated-box",
      width: 40,
      height: 30,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0.2 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 600,
      },
    }),
  );
}

function buildTimelineAnimatedScene(): VNode {
  return createElement(
    "Canvas",
    { width: 120, height: 80 },
    createElement("Box", {
      id: "timeline-box",
      width: 40,
      height: 30,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0.2 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 600,
        iterations: 1,
        fill: "none",
      },
    }),
  );
}

function buildSpringAnimatedScene(): VNode {
  return createElement(
    "Canvas",
    { width: 120, height: 80 },
    createElement("Box", {
      id: "spring-box",
      width: 40,
      height: 30,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0.2 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 600,
        easing: { type: "spring" },
      },
    }),
  );
}

describe("nodejs/web WASM public parity", () => {
  let nodeEngine: Engine;
  let webEngine: Engine;

  beforeAll(async () => {
    const webWasmBytes = readFileSync(
      resolve(__dirname, "../../../crates/boundsvg/pkg-web/boundsvg_bg.wasm"),
    );
    await webWasmInit({ module_or_path: new WebAssembly.Module(webWasmBytes) });
    nodeEngine = createLowLevelEngine(new nodeWasm.BoundSvgEngine());
    webEngine = createLowLevelEngine(new WebBoundSvgEngine() as unknown as WasmEngineInstance);
  });

  afterAll(() => {
    nodeEngine.dispose();
    webEngine.dispose();
  });

  it("reports the same DTO schema", () => {
    expect(nodeWasm.wasm_schema_version()).toBe(EXPECTED_WASM_SCHEMA_VERSION);
    expect(webSchemaVersion()).toBe(EXPECTED_WASM_SCHEMA_VERSION);
  });

  it("renders representative SVG, IR, and PNG bytes identically", () => {
    const scene = buildScene();
    expect(webEngine.renderToSvg(scene)).toBe(nodeEngine.renderToSvg(scene));
    expect(webEngine.renderToSvgAndIR(scene)).toEqual(nodeEngine.renderToSvgAndIR(scene));
    expect(webEngine.renderToPng(scene)).toEqual(nodeEngine.renderToPng(scene));
  });

  it("renders representative WebP bytes identically", () => {
    const scene = buildScene();
    const webWebp = webEngine.renderToWebp(scene);
    expect(webWebp.subarray(12, 16)).toEqual(new TextEncoder().encode("VP8L"));
    expect(webWebp).toEqual(nodeEngine.renderToWebp(scene));
  });

  it("renders independent animated SVG and IR bytes identically", () => {
    const scene = buildAnimatedScene();
    const options = {
      playback: { mode: "independent" as const },
      resourceIdPrefix: "parity-",
      nodeIdMetadata: "omit" as const,
    };
    expect(webEngine.renderToAnimatedSvg(scene, options)).toBe(
      nodeEngine.renderToAnimatedSvg(scene, options),
    );
    expect(webEngine.renderToAnimatedSvgAndIR(scene, options)).toEqual(
      nodeEngine.renderToAnimatedSvgAndIR(scene, options),
    );
  });

  it("renders timeline animated SVG and IR bytes identically", () => {
    const scene = buildTimelineAnimatedScene();
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1_000, iterations: 2.25 },
      timeMs: 1_100,
      resourceIdPrefix: "timeline-parity-",
      nodeIdMetadata: "omit" as const,
    };
    expect(webEngine.renderToAnimatedSvg(scene, options)).toBe(
      nodeEngine.renderToAnimatedSvg(scene, options),
    );
    expect(webEngine.renderToAnimatedSvgAndIR(scene, options)).toEqual(
      nodeEngine.renderToAnimatedSvgAndIR(scene, options),
    );
  });

  it("returns the same timeline representability error and context", () => {
    const scene = buildSpringAnimatedScene();
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1_000, iterations: "infinite" as const },
      timeMs: 100,
    };
    let nodeError: unknown;
    let webError: unknown;
    try {
      nodeEngine.renderToAnimatedSvg(scene, options);
    } catch (error) {
      nodeError = error;
    }
    try {
      webEngine.renderToAnimatedSvg(scene, options);
    } catch (error) {
      webError = error;
    }
    expect(webError).toMatchObject({
      code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
      context: {
        ownerKind: "node",
        ownerId: "spring-box",
        reason: "spring-easing",
        boundaryTimeMs: 0,
      },
    });
    expect(webError).toEqual(nodeError);
  });

  it("returns the same static-animation sampling error", () => {
    const scene = buildAnimatedScene();
    let nodeError: unknown;
    let webError: unknown;
    try {
      nodeEngine.renderToSvg(scene);
    } catch (error) {
      nodeError = error;
    }
    try {
      webEngine.renderToSvg(scene);
    } catch (error) {
      webError = error;
    }
    expect(webError).toMatchObject({ code: "STATIC_ANIMATION_TIME_REQUIRED" });
    expect(webError).toEqual(nodeError);
  });

  it("returns the same representative measurement result", () => {
    const input = {
      text: "日本語組版の経路比較です。",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeightPx: 30,
      maxWidth: 160,
      language: "ja" as const,
      wrap: "char" as const,
    };
    expect(webEngine.measureTextBlock(input)).toEqual(nodeEngine.measureTextBlock(input));
  });
});
