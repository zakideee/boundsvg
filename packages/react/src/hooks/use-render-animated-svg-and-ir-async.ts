import type { IR, RenderAnimatedSvgOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import { cloneRenderedIr } from "../execution/clone-rendered-ir.js";
import { mapRenderExecutionResult, type RenderExecutionOptions } from "../execution/types.js";
import { type RenderAdapter, useRenderExecution } from "./use-render-execution.js";
import type { UseRenderToSvgAndIrAsyncResult } from "./use-render-svg-and-ir-async.js";

const adapter: RenderAdapter<{ svg: string; ir: IR }, RenderAnimatedSvgOptions> = {
  main: (engine, scene, options) => engine.renderToAnimatedSvgAndIR(scene, options),
  worker: (engine, scene, { options, signal }) =>
    engine.renderToAnimatedSvgAndIR(scene, options, { signal }),
};

/** Render committed inputs through the Provider's main or Worker execution owner. */
export function useRenderToAnimatedSvgAndIrAsync(
  vnode: VNode | null,
  renderOptions: RenderAnimatedSvgOptions,
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
