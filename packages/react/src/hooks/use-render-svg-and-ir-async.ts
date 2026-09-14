import type { IR, RenderSvgOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import { cloneRenderedIr } from "../execution/clone-rendered-ir.js";
import {
  mapRenderExecutionResult,
  type RenderExecutionOptions,
  type RenderExecutionResult,
} from "../execution/types.js";
import { type RenderAdapter, useRenderExecution } from "./use-render-execution.js";
export type UseRenderToSvgAndIrAsyncResult = RenderExecutionResult<{ svg: string; ir: IR }>;

const adapter: RenderAdapter<{ svg: string; ir: IR }, RenderSvgOptions> = {
  main: (engine, scene, options) => engine.renderToSvgAndIR(scene, options),
  worker: (engine, scene, { options, signal }) =>
    engine.renderToSvgAndIR(scene, options, { signal }),
};

/** Render committed inputs through the Provider's main or Worker execution owner. */
export function useRenderToSvgAndIrAsync(
  vnode: VNode | null,
  renderOptions?: RenderSvgOptions,
  executionOptions?: RenderExecutionOptions,
): UseRenderToSvgAndIrAsyncResult {
  const result = useRenderExecution({ vnode, renderOptions, executionOptions, adapter });

  const ir = useMemo(
    () => (result.data === null ? null : cloneRenderedIr(result.data.ir)),
    [result.data],
  );
  return mapRenderExecutionResult(result, (result) => ({ svg: result.svg, ir: ir as IR }), {
    svg: null,
    ir: null,
  });
}
