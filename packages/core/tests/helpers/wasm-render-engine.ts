/**
 * Shared real-WASM engine setup for render-path tests.
 *
 * The render entry points always go through the WASM transports, so tests
 * that render (SVG / PNG / layered / IR) wire an engine to a real
 * `WasmEngineHandle`. A suite creates one handle in `beforeAll` (fixture
 * fonts registered once) and derives as many engines as it needs; option
 * overrides let individual tests swap in capturing mocks (`svgToPngFn`,
 * `validateLayeredSvgCompositionFn`, outline transports, …).
 *
 * Prerequisite: built WASM package — run `pnpm build:wasm` first.
 */

import { Engine, type EngineOptions } from "../../src/engine.js";
import type { IR } from "../../src/ir/types.js";
import { initNodeWasm } from "../../src/node.js";
import { createWasmEngineInstance, type WasmEngineHandle } from "../../src/wasm/index.js";
import {
  assertConformancePrerequisites,
  loadConformanceFonts,
} from "../conformance/conformance-engine.js";

/** Options JSON accepted by the WASM `emit_svg_from_ir` export. */
export type WasmEmitOptions = {
  scale?: number;
  debug?: boolean | { parts?: readonly string[] };
  resourceIdPrefix?: string;
  nodeIdMetadata?: "include" | "omit";
  textPathMode?: "merged" | "glyphs";
  showMissingGlyphs?: boolean;
  rasterizerCompat?: boolean;
  timeMs?: number;
  generator?: {
    name: string;
    version: string;
  };
};

export type WasmAnimatedEmitOptions = WasmEmitOptions & {
  playback: { mode: "independent" };
  reducedMotion?: "keep" | "pause";
};

/** Creates a WASM engine instance with the fixture fonts registered. */
export async function createFontedWasmHandle(): Promise<WasmEngineHandle> {
  assertConformancePrerequisites();
  await initNodeWasm();
  const handle = createWasmEngineInstance();
  for (const font of loadConformanceFonts()) {
    handle.registerFont(font.data, {
      alias: font.alias,
      weight: font.weight,
      style: font.style,
    });
  }
  return handle;
}

/**
 * Builds the EngineOptions wired to `handle`'s render transports. `overrides`
 * are spread last, so tests can replace any transport (or add mocks) while the
 * rest stays real. Exposed for the default-engine lifecycle tests that feed
 * these options straight into `render.init`.
 */
export function engineOptionsFromHandle(
  handle: WasmEngineHandle,
  overrides: Partial<EngineOptions> = {},
): EngineOptions {
  return {
    computeLayoutFn: handle.createComputeLayoutFn(),
    renderToIrFn: (inputJson, optionsJson) => handle.renderToIr(inputJson, optionsJson),
    compileLayoutTransitionFn: (...transportArgs) =>
      handle.compileLayoutTransition(...transportArgs),
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
    sampleAnimationStateFn: (irJson, timeMs) => handle.sampleAnimationState(irJson, timeMs),
    prepareSceneFn: (irJson, optionsJson) => handle.prepareScene(irJson, optionsJson),
    ...overrides,
  };
}

/**
 * Builds an Engine wired to `handle`'s render transports. `overrides` are
 * spread last, so tests can replace any transport (or add mocks) while the
 * rest stays real.
 */
export function createEngineFromHandle(
  handle: WasmEngineHandle,
  overrides: Partial<EngineOptions> = {},
): Engine {
  return new Engine(engineOptionsFromHandle(handle, overrides));
}

/**
 * Emits a hand-built IR through the WASM emitter. Mirrors the engine's
 * transport framing: warnings are not read by emission and class instances
 * do not survive JSON.stringify, so they are stripped from the payload.
 */
export function emitSvgFromIrViaHandle(
  handle: WasmEngineHandle,
  ir: IR,
  options: WasmEmitOptions = {},
): string {
  return handle.emitSvgFromIr(JSON.stringify({ ...ir, warnings: [] }), JSON.stringify(options));
}

/** Emits declarative animated SVG from hand-built IR through its dedicated export. */
export function emitAnimatedSvgFromIrViaHandle(
  handle: WasmEngineHandle,
  ir: IR,
  options: WasmAnimatedEmitOptions,
): string {
  return handle.emitAnimatedSvgFromIr(
    JSON.stringify({ ...ir, warnings: [] }),
    JSON.stringify(options),
  );
}
