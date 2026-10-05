import type { RenderSvgOptions, VNode } from "@boundsvg/core";
import {
  mapRenderExecutionResult,
  type RenderExecutionOptions,
  type RenderExecutionResult,
} from "../execution/types.js";
import { type RenderAdapter, useRenderExecution } from "./use-render-execution.js";
/** Generation state with SVG output, including retained-result status. */
export type UseRenderToSvgAsyncResult = RenderExecutionResult<{ svg: string }>;

/** Main-engine and worker dispatch for asynchronous svg rendering. */
const adapter: RenderAdapter<string, RenderSvgOptions> = {
  main: (engine, scene, options) => engine.renderToSvg(scene, options),
  worker: (engine, scene, { options, signal }) => engine.renderToSvg(scene, options, { signal }),
};

/** Render committed inputs through the Provider's main or Worker execution owner. */
export function useRenderToSvgAsync(
  vnode: VNode | null,
  renderOptions?: RenderSvgOptions,
  executionOptions?: RenderExecutionOptions,
): UseRenderToSvgAsyncResult {
  const result = useRenderExecution({ vnode, renderOptions, executionOptions, adapter });

  return mapRenderExecutionResult(result, (svg) => ({ svg }), { svg: null });
}
