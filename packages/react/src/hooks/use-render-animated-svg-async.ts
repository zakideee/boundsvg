import type { RenderAnimatedSvgOptions, VNode } from "@boundsvg/core";
import { mapRenderExecutionResult, type RenderExecutionOptions } from "../execution/types.js";
import { type RenderAdapter, useRenderExecution } from "./use-render-execution.js";
import type { UseRenderToSvgAsyncResult } from "./use-render-svg-async.js";

const adapter: RenderAdapter<string, RenderAnimatedSvgOptions> = {
  main: (engine, scene, options) => engine.renderToAnimatedSvg(scene, options),
  worker: (engine, scene, { options, signal }) =>
    engine.renderToAnimatedSvg(scene, options, { signal }),
};

/** Render committed inputs through the Provider's main or Worker execution owner. */
export function useRenderToAnimatedSvgAsync(
  vnode: VNode | null,
  renderOptions: RenderAnimatedSvgOptions,
  executionOptions?: RenderExecutionOptions,
): UseRenderToSvgAsyncResult {
  const result = useRenderExecution({ vnode, renderOptions, executionOptions, adapter });

  return mapRenderExecutionResult(result, (svg) => ({ svg }), { svg: null });
}
