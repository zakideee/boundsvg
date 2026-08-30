import type { RenderAnimatedSvgOptions, VNode } from "@boundsvg/core";
import type { UseRenderToSvgAsyncResult } from "./use-render-svg-async.js";
import { useWorkerRender } from "./use-worker-render.js";

/** Reactively render authored animation tracks via the WorkerEngine. */
export function useRenderToAnimatedSvgAsync(
  vnode: VNode | null,
  renderOptions: RenderAnimatedSvgOptions,
): UseRenderToSvgAsyncResult {
  const {
    data: svg,
    error,
    isRendering,
    isReady,
  } = useWorkerRender<string, RenderAnimatedSvgOptions>({
    vnode,
    renderFn: (engine, scene, options) => engine.renderToAnimatedSvg(scene, options),
    renderOptions,
  });

  return { svg, error, isRendering, isReady };
}
