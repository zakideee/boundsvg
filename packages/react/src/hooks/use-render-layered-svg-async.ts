import type { LayeredSvgOptions, LayeredSvgResult, VNode } from "@boundsvg/core";
import { useWorkerRender } from "./use-worker-render.js";

export type UseRenderToLayeredSvgAsyncResult = {
  /** Rendered layered SVG result (null while not ready or on error) */
  result: LayeredSvgResult | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether a Worker render is in-flight */
  isRendering: boolean;
  /** Whether a current result is available */
  isReady: boolean;
};

/**
 * Reactively render a VNode to layered SVG via the WorkerEngine.
 *
 * Uses `useEffect` + `useState` to handle the async Worker round-trip.
 * Re-renders when the vnode reference or renderOptions change.
 * Must be used within a `<BoundSvgProvider>` with `worker` enabled.
 */
export function useRenderToLayeredSvgAsync(
  vnode: VNode | null,
  renderOptions?: LayeredSvgOptions,
): UseRenderToLayeredSvgAsyncResult {
  const {
    data: result,
    error,
    isRendering,
    isReady,
  } = useWorkerRender<LayeredSvgResult, LayeredSvgOptions>({
    vnode,
    renderFn: (engine, scene, options) => engine.renderToLayeredSvg(scene, options),
    renderOptions,
  });

  return { result, error, isRendering, isReady };
}
