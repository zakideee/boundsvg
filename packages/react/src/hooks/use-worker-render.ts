import type { OutputCommonOptions, RasterEmissionOptions, SceneNode, VNode } from "@boundsvg/core";
import { toSceneDocument } from "@boundsvg/core";
import type { WorkerEngine } from "@boundsvg/worker";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BoundSvgDefaultCommonOptions } from "../types.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./use-structurally-stable-value.js";

export type UseWorkerRenderResult<T> = {
  data: T | null;
  error: Error | null;
  isRendering: boolean;
  isReady: boolean;
};

type RenderFn<T, O> = (engine: WorkerEngine, scene: SceneNode, options: O) => Promise<T>;

type UseWorkerRenderParams<T, O> = {
  vnode: VNode | null;
  renderFn: RenderFn<T, O>;
  renderOptions?: O;
};

type SettledInput<O> = {
  workerEngine: WorkerEngine;
  vnode: VNode;
  renderOptions: O | undefined;
  defaultCommonOptions: BoundSvgDefaultCommonOptions | undefined;
};

type RenderOptionCallbacks = {
  onWarning?: OutputCommonOptions["onWarning"];
  onPngResolutionAdjusted?: RasterEmissionOptions["onPngResolutionAdjusted"];
};

// WorkerEngine forwards these callbacks before its render Promise settles, so
// they need the same request-lifetime guard as the Promise handlers below.
function guardRenderOptionCallbacks<O extends object>(options: O, shouldDeliver: () => boolean): O {
  const callbackOptions = options as O & RenderOptionCallbacks;
  const guardedOptions = { ...options } as O & RenderOptionCallbacks;
  const onWarning = callbackOptions.onWarning;
  const onPngResolutionAdjusted = callbackOptions.onPngResolutionAdjusted;
  if (onWarning) {
    guardedOptions.onWarning = (warning) => {
      if (shouldDeliver()) {
        onWarning(warning);
      }
    };
  }
  if (onPngResolutionAdjusted) {
    guardedOptions.onPngResolutionAdjusted = (warning) => {
      if (shouldDeliver()) {
        onPngResolutionAdjusted(warning);
      }
    };
  }
  return guardedOptions;
}

/**
 * Internal shared hook for async Worker rendering.
 *
 * Handles the full lifecycle: VNode → SceneDocument → Worker round-trip,
 * with cancellation, error handling, and status tracking.
 * Only the latest render result is applied — stale results from superseded
 * effects are discarded.
 *
 * @internal Not exported from the package — used by useRenderToSvgAsync / useRenderToPngAsync.
 */
export function useWorkerRender<T, O extends object>({
  vnode,
  renderFn,
  renderOptions,
}: UseWorkerRenderParams<T, O>): UseWorkerRenderResult<T> {
  const { workerEngine, status, defaultCommonOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableRenderOptions = useStructurallyStableRenderOptions(renderOptions);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);

  const renderFnRef = useRef(renderFn);
  useLayoutEffect(() => {
    renderFnRef.current = renderFn;
  }, [renderFn]);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [settledInput, setSettledInput] = useState<SettledInput<O> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !workerEngine || !stableVNode) {
      setData(null);
      setError(null);
      setIsRendering(false);
      setSettledInput(null);
      return;
    }

    const currentInput: SettledInput<O> = {
      workerEngine,
      vnode: stableVNode,
      renderOptions: stableRenderOptions,
      defaultCommonOptions: stableDefaultCommonOptions,
    };

    let scene: SceneNode;
    try {
      scene = toSceneDocument(stableVNode);
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setData(null);
      setIsRendering(false);
      setSettledInput(currentInput);
      return;
    }

    let stale = false;
    const requestId = ++requestIdRef.current;
    setIsRendering(true);

    const mergedOptions = guardRenderOptionCallbacks(
      { ...stableDefaultCommonOptions, ...stableRenderOptions } as O,
      () => mountedRef.current && !stale && requestIdRef.current === requestId,
    );

    renderFnRef
      .current(workerEngine, scene, mergedOptions)
      .then((result) => {
        if (mountedRef.current && !stale && requestIdRef.current === requestId) {
          setData(result);
          setError(null);
          setSettledInput(currentInput);
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current && !stale && requestIdRef.current === requestId) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setData(null);
          setSettledInput(currentInput);
        }
      })
      .finally(() => {
        if (mountedRef.current && requestIdRef.current === requestId) {
          setIsRendering(false);
        }
      });

    return () => {
      stale = true;
    };
  }, [workerEngine, status, stableVNode, stableRenderOptions, stableDefaultCommonOptions]);

  // Never expose a settled result under a different render-input identity.
  const hasRenderableInput = status === "ready" && workerEngine !== null && stableVNode !== null;
  const hasCurrentResult =
    hasRenderableInput &&
    settledInput?.workerEngine === workerEngine &&
    settledInput.vnode === stableVNode &&
    settledInput.renderOptions === stableRenderOptions &&
    settledInput.defaultCommonOptions === stableDefaultCommonOptions;
  const visibleData = hasCurrentResult ? data : null;

  return {
    data: visibleData,
    error: hasCurrentResult ? error : null,
    isRendering: hasRenderableInput ? isRendering || !hasCurrentResult : false,
    isReady: visibleData !== null,
  };
}
