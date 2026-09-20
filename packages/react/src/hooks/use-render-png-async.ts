import { pngToDataUrl } from "@boundsvg/browser/png";
import type { RenderPngOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import {
  mapRenderExecutionResult,
  type RenderExecutionOptions,
  type RenderExecutionResult,
} from "../execution/types.js";
import { type RenderAdapter, useRenderExecution } from "./use-render-execution.js";
export type UseRenderToPngAsyncResult = RenderExecutionResult<{ png: Uint8Array; dataUrl: string }>;

const adapter: RenderAdapter<Uint8Array, RenderPngOptions> = {
  main: (engine, scene, options) => engine.renderToPng(scene, options),
  worker: (engine, scene, { options, signal }) => engine.renderToPng(scene, options, { signal }),
  raster: true,
};

/** Render committed inputs through the Provider's main or Worker execution owner. */
export function useRenderToPngAsync(
  vnode: VNode | null,
  renderOptions?: RenderPngOptions,
  executionOptions?: RenderExecutionOptions,
): UseRenderToPngAsyncResult {
  const result = useRenderExecution({ vnode, renderOptions, executionOptions, adapter });
  const dataUrl = useMemo(
    () => (result.data === null ? null : pngToDataUrl(result.data)),
    [result.data],
  );
  return mapRenderExecutionResult(
    result,
    (png) => ({ png: png.slice(), dataUrl: dataUrl as string }),
    { png: null, dataUrl: null },
  );
}
