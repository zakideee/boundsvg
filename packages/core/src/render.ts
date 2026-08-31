import {
  type CompiledScene,
  type CompileOptions,
  createEngine,
  createEngineAsync,
  type EmitAnimatedSvgOptions,
  type EmitPngOptions,
  type EmitSvgOptions,
  type Engine,
  type EngineInput,
  type EngineOptions,
  type Frame,
  type LayeredPngOptions,
  type LayeredSvgOptions,
  type LayoutRenderOptions,
  type RenderAnimatedGifOptions,
  type RenderAnimatedSvgOptions,
  type RenderAnimatedWebpOptions,
  type RenderCompiledAnimatedGifOptions,
  type RenderCompiledAnimatedWebpOptions,
  type RenderCompiledFramesOptions,
  type RenderFramesOptions,
  type RenderIrOptions,
  type RenderPngOptions,
  type RenderSvgOptions,
  type RenderTextOutlinesOptions,
  type RenderWebpOptions,
} from "./engine.js";
import { FatalError } from "./errors.js";
import type { IR } from "./ir/types.js";
import type { LayeredPngResult, LayeredSvgResult } from "./layered-svg.js";
import type { LayoutResult } from "./layout/types.js";
import type { LayoutTransitionInput } from "./layout-transition.js";
import type { TextOutlineNode } from "./text/types.js";

// ---------------------------------------------------------------------------
// Default engine with lazy init
// ---------------------------------------------------------------------------

let defaultEngine: Engine | null = null;
let defaultEngineInitPromise: Promise<void> | null = null;
let defaultEngineGeneration = 0;

/**
 * Initialize the default engine synchronously (with mock/provided WASM bindings).
 *
 * Call this explicitly before rendering to control initialization timing.
 * If not called, renderToSvg/renderToPng will throw.
 */
export function init(options: EngineOptions): void {
  if (defaultEngine) {
    return; // Already initialized — skip (no double init)
  }
  defaultEngine = createEngine(options);
}

/**
 * Initialize the default engine with real WASM (async).
 * Loads the WASM module, registers fonts, and configures the engine.
 * If dispose() cancels an in-flight initialization, this Promise settles after
 * releasing the completed Engine without publishing it as the default.
 */
export async function initAsync(options?: {
  fonts?: Array<{
    alias: string;
    weight?: number;
    style?: "normal" | "italic";
    data: Uint8Array;
  }>;
}): Promise<void> {
  if (defaultEngine) {
    return;
  }
  if (defaultEngineInitPromise) {
    await defaultEngineInitPromise;
    return;
  }

  const initializationGeneration = defaultEngineGeneration;
  const initializationPromise = (async () => {
    const initializedEngine = await createEngineAsync(options ?? {});
    if (initializationGeneration !== defaultEngineGeneration || defaultEngine) {
      initializedEngine.dispose();
      return;
    }
    defaultEngine = initializedEngine;
  })();
  defaultEngineInitPromise = initializationPromise;

  try {
    await initializationPromise;
  } finally {
    if (defaultEngineInitPromise === initializationPromise) {
      defaultEngineInitPromise = null;
    }
  }
}

/**
 * Check if the default engine is initialized.
 */
export function isInitialized(): boolean {
  return defaultEngine !== null;
}

/**
 * Get the default engine (throws if not initialized).
 */
function getEngine(): Engine {
  if (!defaultEngine) {
    throw new FatalError(
      "ENGINE_NOT_INIT",
      "Engine not initialized. Call init() or initAsync() before rendering.",
      { stage: "engine" },
    );
  }
  return defaultEngine;
}

// ---------------------------------------------------------------------------
// Top-level render functions
// ---------------------------------------------------------------------------

/**
 * Render a VNode/SceneNode tree to SVG string using the default engine.
 */
export function renderToSvg(input: EngineInput, options?: RenderSvgOptions): string {
  return getEngine().renderToSvg(input, options);
}

export function renderToSvgAndIR(
  input: EngineInput,
  options?: RenderSvgOptions,
): { svg: string; ir: IR } {
  return getEngine().renderToSvgAndIR(input, options);
}

export function renderToAnimatedSvg(input: EngineInput, options: RenderAnimatedSvgOptions): string {
  return getEngine().renderToAnimatedSvg(input, options);
}

export function renderToAnimatedSvgAndIR(
  input: EngineInput,
  options: RenderAnimatedSvgOptions,
): { svg: string; ir: IR } {
  return getEngine().renderToAnimatedSvgAndIR(input, options);
}

export function renderToLayeredSvg(
  input: EngineInput,
  options?: LayeredSvgOptions,
): LayeredSvgResult {
  return getEngine().renderToLayeredSvg(input, options);
}

export function renderToLayeredPng(
  input: EngineInput,
  options?: LayeredPngOptions,
): LayeredPngResult {
  return getEngine().renderToLayeredPng(input, options);
}

export function compileScene(input: EngineInput, options?: CompileOptions): CompiledScene {
  return getEngine().compile(input, options);
}

/** Compile two compatible layout states into one ordinary compiled scene. */
export function compileLayoutTransition(
  input: LayoutTransitionInput,
  options?: CompileOptions,
): CompiledScene {
  return getEngine().compileLayoutTransition(input, options);
}

/** Return a detached inspection snapshot from a default-engine artifact. */
export function snapshotCompiledIR(compiled: CompiledScene): IR {
  return getEngine().snapshotCompiledIR(compiled);
}

export function renderCompiledToSvg(compiled: CompiledScene, options?: EmitSvgOptions): string {
  return getEngine().renderCompiledToSvg(compiled, options);
}

export function renderCompiledToAnimatedSvg(
  compiled: CompiledScene,
  options: EmitAnimatedSvgOptions,
): string {
  return getEngine().renderCompiledToAnimatedSvg(compiled, options);
}

export function renderCompiledToPng(compiled: CompiledScene, options?: EmitPngOptions): Uint8Array {
  return getEngine().renderCompiledToPng(compiled, options);
}

export function renderFrames(input: EngineInput, options: RenderFramesOptions): Iterable<Frame> {
  return getEngine().renderFrames(input, options);
}

/**
 * Render an already compiled immutable scene at explicit times. The returned
 * iterator is single-use and releases its prepared native state
 * on completion, early return, failure, or default-engine disposal.
 */
export function renderCompiledFrames(
  compiled: CompiledScene,
  options: RenderCompiledFramesOptions,
): Iterable<Frame> {
  return getEngine().renderCompiledFrames(compiled, options);
}

/**
 * Render an already compiled immutable animation to animated lossless WebP
 * using the default engine. The compiled scene is not recompiled.
 */
export function renderCompiledToAnimatedWebp(
  compiled: CompiledScene,
  options: RenderCompiledAnimatedWebpOptions,
): Uint8Array {
  return getEngine().renderCompiledToAnimatedWebp(compiled, options);
}

/**
 * Render an already compiled immutable animation to animated GIF using the
 * default engine. The compiled scene is not recompiled.
 */
export function renderCompiledToAnimatedGif(
  compiled: CompiledScene,
  options: RenderCompiledAnimatedGifOptions,
): Uint8Array {
  return getEngine().renderCompiledToAnimatedGif(compiled, options);
}

/**
 * Render a VNode/SceneNode tree to PNG using the default engine.
 */
export function renderToPng(input: EngineInput, options?: RenderPngOptions): Uint8Array {
  return getEngine().renderToPng(input, options);
}

/**
 * Render a VNode/SceneNode tree to a lossless WebP using the default engine.
 */
export function renderToWebp(input: EngineInput, options?: RenderWebpOptions): Uint8Array {
  return getEngine().renderToWebp(input, options);
}

/**
 * Render a declarative animation to an animated lossless WebP using the
 * default engine.
 */
export function renderToAnimatedWebp(
  input: EngineInput,
  options: RenderAnimatedWebpOptions,
): Uint8Array {
  return getEngine().renderToAnimatedWebp(input, options);
}

/**
 * Render a declarative animation to an animated GIF using the default engine.
 */
export function renderToAnimatedGif(
  input: EngineInput,
  options: RenderAnimatedGifOptions,
): Uint8Array {
  return getEngine().renderToAnimatedGif(input, options);
}

export function renderToTextOutlines(
  input: EngineInput,
  options?: RenderTextOutlinesOptions,
): TextOutlineNode[] {
  return getEngine().renderToTextOutlines(input, options);
}

/**
 * Render a VNode/SceneNode tree to its pre-animation layout tree.
 */
export function renderToLayoutTree(
  input: EngineInput,
  options?: LayoutRenderOptions,
): LayoutResult {
  return getEngine().renderToLayoutTree(input, options);
}

/**
 * Render a VNode/SceneNode tree to IR using the default engine.
 */
export function renderToIR(input: EngineInput, options?: RenderIrOptions): IR {
  return getEngine().renderToIR(input, options);
}

/**
 * Perform a hit test on an IR.
 */
export function hitTestOnIR(ir: IR, x: number, y: number): string | null {
  return getEngine().hitTest(ir, x, y);
}

/**
 * Dispose the default engine.
 */
export function dispose(): void {
  defaultEngineGeneration += 1;
  defaultEngineInitPromise = null;
  if (defaultEngine) {
    defaultEngine.dispose();
    defaultEngine = null;
  }
}
