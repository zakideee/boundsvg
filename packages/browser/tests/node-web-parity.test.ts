import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { type AnimationSpec, createElement, Engine, type VNode } from "@boundsvg/core";
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
import scalarWebWasmInit, {
  BoundSvgEngine as ScalarWebBoundSvgEngine,
  wasm_schema_version as scalarWebSchemaVersion,
} from "../../../crates/boundsvg/pkg-web/scalar/boundsvg.js";

type LowLevelWasmModule = {
  BoundSvgEngine: new () => WasmEngineInstance;
  wasm_schema_version: () => number;
};

const require = createRequire(import.meta.url);
const nodeWasm = require(
  resolve(__dirname, "../../core/wasm-pkg/boundsvg.js"),
) as LowLevelWasmModule;
const scalarNodeWasm = require(
  resolve(__dirname, "../../core/wasm-pkg/scalar/boundsvg.js"),
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

function buildDocumentCutCubicScene(): VNode {
  return createElement(
    "Canvas",
    { width: 160, height: 80 },
    createElement("Box", {
      id: "cut-cubic-box",
      width: 40,
      height: 30,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, transform: { translateX: 0 } },
          { at: 1, transform: { translateX: 100 } },
        ],
        durationMs: 1_600,
        delayMs: -250,
        easing: [0, 13 / 9, 1, 0],
        iterations: 1,
        fill: "both",
      },
    }),
  );
}

function buildMixedClampCubicScene(): VNode {
  return createElement(
    "Canvas",
    { width: 160, height: 80 },
    createElement("Box", {
      id: "mixed-cubic-box",
      width: 40,
      height: 30,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0, transform: { translateX: 0 } },
          { at: 1, opacity: 1, transform: { translateX: 100 } },
        ],
        durationMs: 1_000,
        easing: [0, 2, 1, 1],
        iterations: 1,
        fill: "both",
      },
    }),
  );
}

type EndpointOwner = "node" | "textUnit";
type EndpointChannel = "opacity" | "transform";

function buildExactEndpointScene(
  owner: EndpointOwner,
  channel: EndpointChannel,
  seam: boolean,
): VNode {
  const valueA = 0.5;
  const valueB = valueA + Number.EPSILON / 2;
  const keyframe = (at: number, value: number) =>
    channel === "opacity" ? { at, opacity: value } : { at, transform: { translateX: value } };
  const animation: AnimationSpec = {
    keyframes: seam
      ? [keyframe(0, valueA), keyframe(1, valueB)]
      : [keyframe(0, valueA), keyframe(0.5, valueB), keyframe(1, valueB)],
    durationMs: seam ? 100 : 200,
    easing: "linear",
    iterations: seam ? "infinite" : 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: `${channel}-endpoint-node`,
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: `${channel}-endpoint-text`,
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
}

function buildSemanticIdentityScene(owner: EndpointOwner): VNode {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, transform: {} },
      {
        at: 1,
        transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 },
      },
    ],
    durationMs: 1_000,
    easing: "linear",
    iterations: 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "identity-transform-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "identity-transform-text",
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
}

function buildTinyTriangleScene(): VNode {
  return createElement(
    "Canvas",
    { width: 96, height: 48 },
    createElement("Box", {
      id: "tiny-triangle-node",
      width: 32,
      height: 20,
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 0.5, opacity: 1 },
          { at: 1, opacity: 0 },
        ],
        durationMs: 2e-300,
        easing: "linear",
        iterations: "infinite",
        fill: "both",
      },
    }),
  );
}

function buildDocumentEndStepCutScene(owner: EndpointOwner): VNode {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 1_000,
    easing: { type: "steps", count: 2, position: "jump-end" },
    iterations: "infinite",
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "document-end-step-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "document-end-step-text",
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
}

function buildLargeSourcePositionScene(
  owner: EndpointOwner,
  iterations: number | "infinite",
): VNode {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 1,
    delayMs: -(2 ** 52 + 1),
    easing: { type: "steps", count: 1, position: "jump-end" },
    iterations,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "large-source-position-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "large-source-position-text",
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
}

function buildOvershootCubicScene(
  owner: EndpointOwner,
  withTransform: boolean,
  clampTiming: {
    durationMs: number;
    delayMs?: number;
    easing: [number, number, number, number];
  } = { durationMs: 1_000, easing: [0.3, 2.3, 0.7, -0.2] },
): VNode {
  const animation: AnimationSpec = {
    keyframes: [
      {
        at: 0,
        opacity: 0,
        ...(withTransform ? { transform: { translateX: 7 } } : {}),
      },
      {
        at: 1,
        opacity: 1,
        ...(withTransform ? { transform: { translateX: 7 } } : {}),
      },
    ],
    durationMs: clampTiming.durationMs,
    ...(clampTiming.delayMs === undefined ? {} : { delayMs: clampTiming.delayMs }),
    easing: clampTiming.easing,
    iterations: 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "overshoot-cubic-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "overshoot-cubic-text",
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
}

function buildBoundaryProgramCutScene(
  owner: EndpointOwner,
  timing: { durationMs: number; delayMs: number; stepCount: number },
): VNode {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: timing.durationMs,
    delayMs: timing.delayMs,
    easing: { type: "steps", count: timing.stepCount, position: "jump-end" },
    iterations: 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "boundary-program-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "boundary-program-text",
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
}

function buildContinuousDecimalCubicScene(durationMs: number): VNode {
  return createElement(
    "Canvas",
    { width: 96, height: 48 },
    createElement("Box", {
      id: "continuous-decimal-cubic",
      width: 32,
      height: 20,
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 0.5, opacity: 0.5 },
          { at: 1, opacity: 0 },
        ],
        durationMs,
        easing: [0.3, 0.3, 0.7, 0.7],
        iterations: 4,
        fill: "both",
      },
    }),
  );
}

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected render to throw");
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
  let scalarNodeEngine: Engine;
  let webEngine: Engine;
  let scalarWebEngine: Engine;
  let timelineEngines: Engine[];

  beforeAll(async () => {
    const webWasmBytes = readFileSync(
      resolve(__dirname, "../../../crates/boundsvg/pkg-web/boundsvg_bg.wasm"),
    );
    const scalarWebWasmBytes = readFileSync(
      resolve(__dirname, "../../../crates/boundsvg/pkg-web/scalar/boundsvg_bg.wasm"),
    );
    await webWasmInit({ module_or_path: new WebAssembly.Module(webWasmBytes) });
    await scalarWebWasmInit({ module_or_path: new WebAssembly.Module(scalarWebWasmBytes) });
    nodeEngine = createLowLevelEngine(new nodeWasm.BoundSvgEngine());
    scalarNodeEngine = createLowLevelEngine(new scalarNodeWasm.BoundSvgEngine());
    webEngine = createLowLevelEngine(new WebBoundSvgEngine() as unknown as WasmEngineInstance);
    scalarWebEngine = createLowLevelEngine(
      new ScalarWebBoundSvgEngine() as unknown as WasmEngineInstance,
    );
    timelineEngines = [nodeEngine, scalarNodeEngine, webEngine, scalarWebEngine];
  });

  afterAll(() => {
    for (const engine of timelineEngines) {
      engine.dispose();
    }
  });

  it("reports the same DTO schema", () => {
    expect(nodeWasm.wasm_schema_version()).toBe(EXPECTED_WASM_SCHEMA_VERSION);
    expect(scalarNodeWasm.wasm_schema_version()).toBe(EXPECTED_WASM_SCHEMA_VERSION);
    expect(webSchemaVersion()).toBe(EXPECTED_WASM_SCHEMA_VERSION);
    expect(scalarWebSchemaVersion()).toBe(EXPECTED_WASM_SCHEMA_VERSION);
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
    const expectedSvg = nodeEngine.renderToAnimatedSvg(scene, options);
    const expectedSvgAndIr = nodeEngine.renderToAnimatedSvgAndIR(scene, options);
    const expectedCompiledSvg = nodeEngine.renderCompiledToAnimatedSvg(
      nodeEngine.compile(scene),
      options,
    );
    for (const engine of timelineEngines) {
      expect(engine.renderToAnimatedSvg(scene, options)).toBe(expectedSvg);
      expect(engine.renderToAnimatedSvgAndIR(scene, options)).toEqual(expectedSvgAndIr);
      expect(engine.renderCompiledToAnimatedSvg(engine.compile(scene), options)).toBe(
        expectedCompiledSvg,
      );
    }
  });

  it("rejects non-canonical document-cut extrema in every WASM artifact", () => {
    const scene = buildDocumentCutCubicScene();
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1_100, iterations: "infinite" as const },
      resourceIdPrefix: "cut-cubic-parity-",
      nodeIdMetadata: "omit" as const,
    };
    for (const engine of timelineEngines) {
      const compiled = engine.compile(scene);
      for (const render of [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        expect(captureThrown(render)).toMatchObject({
          code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
          context: { reason: "cubic-subcurve-unrepresentable", boundaryTimeMs: 1_100 },
        });
      }
    }
  });

  it("rejects mixed-channel clamped overshoot in every WASM artifact", () => {
    const scene = buildMixedClampCubicScene();
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1_000, iterations: "infinite" as const },
      resourceIdPrefix: "mixed-cubic-parity-",
      nodeIdMetadata: "omit" as const,
    };
    for (const engine of timelineEngines) {
      const compiled = engine.compile(scene);
      for (const render of [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        expect(captureThrown(render)).toMatchObject({
          code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
          context: {
            reason: "clamped-overshoot-cubic",
            migration: "Use playback mode independent for this animation track.",
          },
        });
      }
    }
  });

  it("preserves exact linear endpoints in every owner, channel, path, and WASM artifact", () => {
    const options = {
      playback: { mode: "timeline" as const, durationMs: 200, iterations: 0.5 },
    };

    for (const owner of ["node", "textUnit"] as const) {
      for (const channel of ["opacity", "transform"] as const) {
        const seamScene = buildExactEndpointScene(owner, channel, true);
        for (const engine of timelineEngines) {
          const compiled = engine.compile(seamScene);
          for (const render of [
            () => engine.renderToAnimatedSvg(seamScene, options),
            () => engine.renderToAnimatedSvgAndIR(seamScene, options),
            () => engine.renderCompiledToAnimatedSvg(compiled, options),
          ]) {
            expect(captureThrown(render)).toMatchObject({
              code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
              context: { reason: "zero-delta-jump", boundaryTimeMs: 100 },
            });
          }
        }

        const continuousScene = buildExactEndpointScene(owner, channel, false);
        const expected = nodeEngine.renderToAnimatedSvg(continuousScene, options);
        for (const engine of timelineEngines) {
          expect(engine.renderToAnimatedSvg(continuousScene, options)).toBe(expected);
          expect(engine.renderToAnimatedSvgAndIR(continuousScene, options).svg).toBe(expected);
          expect(engine.renderCompiledToAnimatedSvg(engine.compile(continuousScene), options)).toBe(
            expected,
          );
        }
      }
    }
  });

  it("treats sparse and explicit identity transforms as continuous in every WASM artifact", () => {
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1_000, iterations: 2 ** -21 },
    };

    for (const owner of ["node", "textUnit"] as const) {
      const scene = buildSemanticIdentityScene(owner);
      const expected = nodeEngine.renderToAnimatedSvg(scene, options);
      for (const engine of timelineEngines) {
        expect(engine.renderToAnimatedSvg(scene, options)).toBe(expected);
        expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(expected);
        expect(engine.renderCompiledToAnimatedSvg(engine.compile(scene), options)).toBe(expected);
      }
    }
  });

  it("preserves document-end step values in every WASM artifact", () => {
    for (const owner of ["node", "textUnit"] as const) {
      const scene = buildDocumentEndStepCutScene(owner);
      for (const timeMs of [0, 500]) {
        const options = {
          playback: { mode: "timeline" as const, durationMs: 500, iterations: 1 },
          timeMs,
        };
        const expected = nodeEngine.renderToAnimatedSvg(scene, options);
        expect(expected).toContain("100% { opacity: 0.5; }");
        for (const engine of timelineEngines) {
          expect(engine.renderToAnimatedSvg(scene, options)).toBe(expected);
          expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(expected);
          expect(engine.renderCompiledToAnimatedSvg(engine.compile(scene), options)).toBe(expected);
        }
      }
    }
  });

  it("accepts a passing compressed pair beyond the source-position guard in every WASM artifact", () => {
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1, iterations: "infinite" as const },
    };

    for (const owner of ["node", "textUnit"] as const) {
      const scene = buildLargeSourcePositionScene(owner, "infinite");
      const expected = nodeEngine.renderToAnimatedSvg(scene, options);
      expect(expected).toContain("0% { opacity: 0; }");
      expect(expected).toContain("100% { opacity: 0; }");
      for (const engine of timelineEngines) {
        expect(engine.renderToAnimatedSvg(scene, options)).toBe(expected);
        expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(expected);
        expect(engine.renderCompiledToAnimatedSvg(engine.compile(scene), options)).toBe(expected);
      }
    }
  });

  it("rejects finite source-end D-cuts that lose mapping precision in every WASM artifact", () => {
    const sourceStart = 2 ** 52 + 1;
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1, iterations: "infinite" as const },
      timeMs: 0.75,
    };

    for (const owner of ["node", "textUnit"] as const) {
      const scene = buildLargeSourcePositionScene(owner, sourceStart + 1);
      for (const engine of timelineEngines) {
        const compiled = engine.compile(scene);
        for (const render of [
          () => engine.renderToAnimatedSvg(scene, options),
          () => engine.renderToAnimatedSvgAndIR(scene, options),
          () => engine.renderCompiledToAnimatedSvg(compiled, options),
        ]) {
          expect(captureThrown(render)).toMatchObject({
            code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
            context: {
              kind: "separation",
              leftTimeMs: 0,
              rightTimeMs: 1,
            },
          });
        }
      }
    }
  });

  it("reports the first construction-guard pair in every WASM artifact", () => {
    const scene = buildTinyTriangleScene();
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1, iterations: "infinite" as const },
    };

    for (const engine of timelineEngines) {
      const compiled = engine.compile(scene);
      for (const render of [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        expect(captureThrown(render)).toMatchObject({
          code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
          context: {
            kind: "f32-order",
            leftTimeMs: 0,
            rightTimeMs: 1e-300,
          },
        });
      }
    }
  });

  it.each([
    1_234.567_8, 999.666, 3.3, 31_415.926_535,
  ])("accepts a continuous cubic with decimal duration %d in every WASM artifact", (durationMs) => {
    const scene = buildContinuousDecimalCubicScene(durationMs);
    const options = {
      playback: {
        mode: "timeline" as const,
        durationMs: 4 * durationMs,
        iterations: "infinite" as const,
      },
    };
    const expected = nodeEngine.renderToAnimatedSvg(scene, options);
    expect((expected.match(/^\s*\d+(?:\.\d+)?%\s*\{/gm) ?? []).length).toBe(9);

    for (const engine of timelineEngines) {
      expect(engine.renderToAnimatedSvg(scene, options)).toBe(expected);
      expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(expected);
      expect(engine.renderCompiledToAnimatedSvg(engine.compile(scene), options)).toBe(expected);
    }
  });

  it("rejects clamped overshoot in every owner, path, and WASM artifact", () => {
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1_000, iterations: 0.3952 },
    };

    for (const owner of ["node", "textUnit"] as const) {
      for (const withTransform of [false, true]) {
        const scene = buildOvershootCubicScene(owner, withTransform);
        for (const engine of timelineEngines) {
          const compiled = engine.compile(scene);
          for (const render of [
            () => engine.renderToAnimatedSvg(scene, options),
            () => engine.renderToAnimatedSvgAndIR(scene, options),
            () => engine.renderCompiledToAnimatedSvg(compiled, options),
          ]) {
            expect(captureThrown(render)).toMatchObject({
              code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
              context: {
                reason: "clamped-overshoot-cubic",
                migration: "Use playback mode independent for this animation track.",
              },
            });
          }
        }
      }
    }
  });

  it("rejects extreme clamped overshoot before precision in every WASM artifact", () => {
    const options = {
      playback: {
        mode: "timeline" as const,
        durationMs: 1_000_000,
        iterations: "infinite" as const,
      },
    };

    for (const owner of ["node", "textUnit"] as const) {
      for (const withTransform of [false, true]) {
        const scene = buildOvershootCubicScene(owner, withTransform, {
          durationMs: 1_000_000,
          easing: [0, -1e16, 1, 1e16],
        });
        for (const engine of timelineEngines) {
          const compiled = engine.compile(scene);
          for (const render of [
            () => engine.renderToAnimatedSvg(scene, options),
            () => engine.renderToAnimatedSvgAndIR(scene, options),
            () => engine.renderCompiledToAnimatedSvg(compiled, options),
          ]) {
            expect(captureThrown(render)).toMatchObject({
              code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
              context: { reason: "clamped-overshoot-cubic" },
            });
          }
        }
      }
    }
  });

  it("rejects canonical program cut singularities in every WASM artifact", () => {
    const options = {
      playback: {
        mode: "timeline" as const,
        durationMs: 1_000,
        iterations: "infinite" as const,
      },
    };

    for (const owner of ["node", "textUnit"] as const) {
      for (const timing of [
        {
          durationMs: 3,
          delayMs: -2.099_999_999_999_999_6,
          stepCount: 10,
        },
        {
          durationMs: 1,
          delayMs: 999.666_666_666_666_6,
          stepCount: 3,
        },
      ]) {
        const scene = buildBoundaryProgramCutScene(owner, timing);
        for (const engine of timelineEngines) {
          const compiled = engine.compile(scene);
          for (const render of [
            () => engine.renderToAnimatedSvg(scene, options),
            () => engine.renderToAnimatedSvgAndIR(scene, options),
            () => engine.renderCompiledToAnimatedSvg(compiled, options),
          ]) {
            expect(captureThrown(render)).toMatchObject({
              code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
              context: { kind: "separation" },
            });
          }
        }
      }
    }
  });

  it("returns the same timeline representability error and context", () => {
    const scene = buildSpringAnimatedScene();
    const options = {
      playback: { mode: "timeline" as const, durationMs: 1_000, iterations: "infinite" as const },
      timeMs: 100,
    };
    const errors = timelineEngines.flatMap((engine) => {
      const compiled = engine.compile(scene);
      return [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ].map((render) => {
        try {
          render();
        } catch (error) {
          return error;
        }
        throw new Error("Expected timeline representability error");
      });
    });
    expect(errors[0]).toMatchObject({
      code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
      context: {
        ownerKind: "node",
        ownerId: "spring-box",
        reason: "spring-easing",
        boundaryTimeMs: 0,
      },
    });
    for (const error of errors.slice(1)) {
      expect(error).toEqual(errors[0]);
    }
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
