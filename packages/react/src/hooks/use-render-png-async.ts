import { pngToDataUrl } from "@boundsvg/browser/png";
import type { RenderPngOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import { useWorkerRender } from "./use-worker-render.js";

export type UseRenderToPngAsyncResult = {
  /** Rendered PNG as Uint8Array (null while not ready or on error) */
  png: Uint8Array | null;
  /** PNG as data URL for use in <img src> (null while not ready or on error) */
  dataUrl: string | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether a Worker render is in-flight */
  isRendering: boolean;
  /** Whether a current result is available */
  isReady: boolean;
};

/**
 * Reactively render a VNode to PNG via the WorkerEngine.
 *
 * Uses `useEffect` + `useState` to handle the async Worker round-trip.
 * The PNG `Uint8Array` is transferred (zero-copy) from the Worker.
 * Re-renders when the vnode reference or renderOptions change.
 * Must be used within a `<BoundSvgProvider>` with `worker` enabled.
 */
export function useRenderToPngAsync(
  vnode: VNode | null,
  renderOptions?: RenderPngOptions,
): UseRenderToPngAsyncResult {
  const {
    data: png,
    error,
    isRendering,
    isReady,
  } = useWorkerRender<Uint8Array, RenderPngOptions>({
    vnode,
    renderFn: (engine, scene, options) => engine.renderToPng(scene, options),
    renderOptions,
  });

  const dataUrl = useMemo(() => (png ? pngToDataUrl(png) : null), [png]);

  return { png, dataUrl, error, isRendering, isReady };
}
