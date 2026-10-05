import type { LayeredSvgOptions, LayeredSvgResult, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import {
  mapRenderExecutionResult,
  type RenderExecutionOptions,
  type RenderExecutionResult,
} from "../execution/types.js";
import { type RenderAdapter, useRenderExecution } from "./use-render-execution.js";
/** Generation state with layered SVG output, including retained-result status. */
export type UseRenderToLayeredSvgAsyncResult = RenderExecutionResult<{ result: LayeredSvgResult }>;

/** Main-engine and worker dispatch for asynchronous layered svg rendering. */
const adapter: RenderAdapter<LayeredSvgResult, LayeredSvgOptions> = {
  main: (engine, scene, options) => engine.renderToLayeredSvg(scene, options),
  worker: (engine, scene, { options, signal }) =>
    engine.renderToLayeredSvg(scene, options, { signal }),
};

/** Render committed inputs through the Provider's main or Worker execution owner. */
export function useRenderToLayeredSvgAsync(
  vnode: VNode | null,
  renderOptions?: LayeredSvgOptions,
  executionOptions?: RenderExecutionOptions,
): UseRenderToLayeredSvgAsyncResult {
  const result = useRenderExecution({ vnode, renderOptions, executionOptions, adapter });

  const layeredResult = useMemo(
    () => (result.data === null ? null : structuredClone(result.data)),
    [result.data],
  );
  return mapRenderExecutionResult(result, () => ({ result: layeredResult as LayeredSvgResult }), {
    result: null,
  });
}
