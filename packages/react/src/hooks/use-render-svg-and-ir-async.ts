import type { IR, RenderOptions, VNode } from "@boundsvg/core";
import { useWorkerRender } from "./use-worker-render.js";

export type UseRenderToSvgAndIrAsyncResult = {
  /** Rendered SVG string (null while not ready or on error) */
  svg: string | null;
  /** Intermediate Representation tree (null while not ready or on error) */
  ir: IR | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether a Worker render is in-flight */
  isRendering: boolean;
  /** Whether a current result is available */
  isReady: boolean;
};

/**
 * Reactively render a VNode to SVG + IR via the WorkerEngine.
 *
 * Returns both the SVG string and the IR tree, enabling inspect-hover
 * overlays on the main thread without a synchronous Engine instance.
 * Re-renders when the vnode reference or renderOptions change.
 * Must be used within a `<BoundSvgProvider>` with `worker` enabled.
 */
export function useRenderToSvgAndIrAsync(
  vnode: VNode | null,
  renderOptions?: RenderOptions,
): UseRenderToSvgAndIrAsyncResult {
  const { data, error, isRendering, isReady } = useWorkerRender({
    vnode,
    renderFn: (engine, scene, options) => engine.renderToSvgAndIR(scene, options),
    renderOptions,
  });

  return {
    svg: data?.svg ?? null,
    ir: data?.ir ?? null,
    error,
    isRendering,
    isReady,
  };
}
