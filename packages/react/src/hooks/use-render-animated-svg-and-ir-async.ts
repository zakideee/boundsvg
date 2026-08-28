import type { IR, RenderAnimatedSvgOptions, VNode } from "@boundsvg/core";
import type { UseRenderToSvgAndIrAsyncResult } from "./use-render-svg-and-ir-async.js";
import { useWorkerRender } from "./use-worker-render.js";

/** Render declarative animated SVG and its IR via the WorkerEngine. */
export function useRenderToAnimatedSvgAndIrAsync(
  vnode: VNode | null,
  renderOptions: RenderAnimatedSvgOptions,
): UseRenderToSvgAndIrAsyncResult {
  const { data, error, isRendering, isReady } = useWorkerRender<
    { svg: string; ir: IR },
    RenderAnimatedSvgOptions
  >({
    vnode,
    renderFn: (engine, scene, options) => engine.renderToAnimatedSvgAndIR(scene, options),
    renderOptions,
  });

  return {
    svg: data?.svg ?? null,
    ir: data?.ir ?? null,
    error,
    isRendering,
    isReady,
  };
}
