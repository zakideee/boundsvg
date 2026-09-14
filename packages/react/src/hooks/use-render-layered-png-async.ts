import { pngToDataUrl } from "@boundsvg/browser/png";
import type { LayeredPngOptions, LayeredPngResult, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import {
  mapRenderExecutionResult,
  type RenderExecutionOptions,
  type RenderExecutionResult,
} from "../execution/types.js";
import { type RenderAdapter, useRenderExecution } from "./use-render-execution.js";
export type UseRenderToLayeredPngAsyncResult = RenderExecutionResult<{
  result: LayeredPngResult;
  layerDataUrls: string[];
}>;

const adapter: RenderAdapter<LayeredPngResult, LayeredPngOptions> = {
  main: (engine, scene, options) => engine.renderToLayeredPng(scene, options),
  worker: (engine, scene, { options, signal }) =>
    engine.renderToLayeredPng(scene, options, { signal }),
  raster: true,
};

/** Render committed inputs through the Provider's main or Worker execution owner. */
export function useRenderToLayeredPngAsync(
  vnode: VNode | null,
  renderOptions?: LayeredPngOptions,
  executionOptions?: RenderExecutionOptions,
): UseRenderToLayeredPngAsyncResult {
  const result = useRenderExecution({ vnode, renderOptions, executionOptions, adapter });
  const layerDataUrls = useMemo(
    () =>
      result.data === null ? null : result.data.layers.map((layer) => pngToDataUrl(layer.png)),
    [result.data],
  );
  return mapRenderExecutionResult(
    result,
    (layered) => ({
      result: structuredClone(layered),
      layerDataUrls: [...(layerDataUrls as string[])],
    }),
    { result: null, layerDataUrls: null },
  );
}
