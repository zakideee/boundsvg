import { pngToDataUrl } from "@boundsvg/browser/png";
import type { LayeredPngOptions, LayeredPngResult, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import { useWorkerRender } from "./use-worker-render.js";

export type UseRenderToLayeredPngAsyncResult = {
  /** Rendered layered PNG result (null while not ready or on error) */
  result: LayeredPngResult | null;
  /** Layer PNG data URLs in the same order as `result.layers` (null while not ready or on error) */
  layerDataUrls: string[] | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether a Worker render is in-flight */
  isRendering: boolean;
  /** Whether a current result is available */
  isReady: boolean;
};

/**
 * Reactively render a VNode to layered PNG via the WorkerEngine.
 *
 * Uses `useEffect` + `useState` to handle the async Worker round-trip.
 * Each layer's PNG `Uint8Array` is transferred (zero-copy) from the Worker.
 * `layerDataUrls` is memoized for direct use as `<img src>` values.
 * Re-renders when the vnode reference or renderOptions change.
 * Must be used within a `<BoundSvgProvider>` with `worker` enabled.
 */
export function useRenderToLayeredPngAsync(
  vnode: VNode | null,
  renderOptions?: LayeredPngOptions,
): UseRenderToLayeredPngAsyncResult {
  const {
    data: result,
    error,
    isRendering,
    isReady,
  } = useWorkerRender<LayeredPngResult, LayeredPngOptions>({
    vnode,
    renderFn: (engine, scene, options) => engine.renderToLayeredPng(scene, options),
    renderOptions,
  });

  const layerDataUrls = useMemo(
    () => (result ? result.layers.map((layer) => pngToDataUrl(layer.png)) : null),
    [result],
  );

  return { result, layerDataUrls, error, isRendering, isReady };
}
