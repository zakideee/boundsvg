import type { RenderOptions, VNode } from "@boundsvg/core";
import { useWorkerRender } from "./use-worker-render.js";

export type UseRenderToSvgAsyncResult = {
  /** Rendered SVG string (null while not ready or on error) */
  svg: string | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether a Worker render is in-flight */
  isRendering: boolean;
  /** Whether a current result is available */
  isReady: boolean;
};

/**
 * Reactively render a VNode to SVG via the WorkerEngine.
 *
 * Uses `useEffect` + `useState` to handle the async Worker round-trip.
 * Re-renders when the vnode reference or renderOptions change.
 * Must be used within a `<BoundSvgProvider>` with `worker` enabled.
 */
export function useRenderToSvgAsync(
  vnode: VNode | null,
  renderOptions?: RenderOptions,
): UseRenderToSvgAsyncResult {
  const {
    data: svg,
    error,
    isRendering,
    isReady,
  } = useWorkerRender({
    vnode,
    renderFn: (engine, scene, options) => engine.renderToSvg(scene, options),
    renderOptions,
  });

  return { svg, error, isRendering, isReady };
}
