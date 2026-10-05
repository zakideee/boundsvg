import {
  decodeSceneDocument,
  type Engine,
  fromSceneDocument,
  type OutputCommonOptions,
  type RasterEmissionOptions,
  type SceneNode,
  toSceneDocument,
  type VNode,
} from "@boundsvg/core";
import type { WorkerEngine } from "@boundsvg/worker";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MainRenderSchedulerContext } from "../execution/context.js";
import { snapshotRenderOptions } from "../execution/snapshot-render-options.js";
import type { RenderExecutionOptions, RenderExecutionResult } from "../execution/types.js";
import {
  resolveRenderRevision,
  validateRenderExecutionOptions,
} from "../utils/render-input-options.js";
import { useBoundSvg } from "./use-boundsvg.js";
import type { CapturedRenderNotifications } from "./use-commit-phase-render-notifications.js";
import { useResourceVersion } from "./use-resource-version.js";
import { useShallowRenderOptions } from "./use-shallow-render-options.js";

type CallbackOptions = Pick<OutputCommonOptions, "onWarning"> &
  Pick<RasterEmissionOptions, "onPngResolutionAdjusted">;

/** Pair main-thread and Worker render operations for one shared asynchronous hook result. */
export type RenderAdapter<Value, Options> = {
  main: (engine: Engine, scene: VNode, options: Options) => Value;
  worker: (
    engine: WorkerEngine,
    scene: SceneNode,
    request: { options: Options; signal: AbortSignal },
  ) => Promise<Value>;
  raster?: boolean;
};

type RenderCompletion<Value> = {
  input: object;
  owner: Engine | WorkerEngine | null;
  data: Value | null;
  outcome: "success" | "error";
  error: Error | null;
  notifications: CapturedRenderNotifications;
  delivered: boolean;
};

type RenderLifetime = {
  input: object | null;
  pending: (() => void) | null;
  isScheduled: boolean;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function mergeAsyncRenderOptions<Options extends CallbackOptions>(
  defaults: CallbackOptions | undefined,
  options: Options | undefined,
): Options {
  if (
    options !== undefined &&
    (options === null || typeof options !== "object" || Array.isArray(options))
  ) {
    return options;
  }
  return { ...defaults, ...options } as Options;
}

function captureOptions<Options extends CallbackOptions>(
  options: Options,
  notifications: CapturedRenderNotifications,
  control: { raster: boolean; canCollect: () => boolean },
): Options {
  const snapshot = snapshotRenderOptions(options);
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    snapshot.onWarning = (warning) => {
      if (control.canCollect()) {
        notifications.events.push({ type: "warning", warning });
      }
    };
    if (control.raster) {
      snapshot.onPngResolutionAdjusted = (warning) => {
        if (control.canCollect()) {
          notifications.events.push({ type: "pngResolutionAdjusted", warning });
        }
      };
    }
  }
  return snapshot;
}

/** Execute only committed inputs, coalescing each hook's unsent work in one microtask. */
export function useRenderExecution<Value, Options extends CallbackOptions>({
  vnode,
  renderOptions,
  executionOptions,
  adapter,
}: {
  vnode: VNode | null;
  renderOptions?: Options;
  executionOptions?: RenderExecutionOptions;
  adapter: RenderAdapter<Value, Options>;
}): RenderExecutionResult<{ data: Value }> {
  validateRenderExecutionOptions(executionOptions);
  const revision = resolveRenderRevision(executionOptions?.revision);
  const retainPreviousResult = executionOptions?.retainPreviousResult ?? true;
  const {
    engine,
    workerEngine,
    status,
    error: providerError,
    defaultCommonOptions,
  } = useBoundSvg();
  const scheduler = useContext(MainRenderSchedulerContext);
  const resourceVersion = useResourceVersion(engine);
  const stableOptions = useShallowRenderOptions(renderOptions);
  const stableDefaults = useShallowRenderOptions(defaultCommonOptions);
  const owner = workerEngine ?? engine;
  const execution = workerEngine ? "worker" : engine ? "main" : null;
  const input = useMemo(
    () => ({
      vnode,
      stableOptions,
      stableDefaults,
      revision,
      resourceVersion,
      owner,
      scheduler,
      status,
      providerError,
    }),
    [
      vnode,
      stableOptions,
      stableDefaults,
      revision,
      resourceVersion,
      owner,
      scheduler,
      status,
      providerError,
    ],
  );
  const callbacks = useRef({ ...defaultCommonOptions, ...renderOptions, ...executionOptions });
  useLayoutEffect(() => {
    callbacks.current = { ...defaultCommonOptions, ...renderOptions, ...executionOptions };
  });
  const lifetime = useRef<RenderLifetime>({ input: null, pending: null, isScheduled: false });
  const [hasCommitted, setHasCommitted] = useState(false);
  const [completion, setCompletion] = useState<RenderCompletion<Value> | null>(null);

  useLayoutEffect(() => {
    setHasCommitted(true);
    const currentLifetime = lifetime.current;
    currentLifetime.input = input;
    const controller = new AbortController();
    const notifications: CapturedRenderNotifications = { events: [] };
    let hasSettled = false;
    const canAdopt = () => currentLifetime.input === input && !controller.signal.aborted;
    const settle = (outcome: { data: Value; error: null } | { data: null; error: Error }) => {
      if (!canAdopt()) {
        return;
      }
      hasSettled = true;
      setCompletion((previous) => ({
        input,
        owner,
        data: outcome.error
          ? callbacks.current.retainPreviousResult !== false && previous?.owner === owner
            ? previous.data
            : null
          : outcome.data,
        outcome: outcome.error ? "error" : "success",
        error: outcome.error,
        notifications,
        delivered: false,
      }));
    };
    if (input.vnode === null) {
      setCompletion(null);
    } else if (input.status === "error" && input.providerError) {
      settle({ data: null, error: input.providerError });
    } else if (input.status !== "ready" || !owner) {
      setCompletion(null);
    } else {
      // Input identity already projects rendering; replacing retained state would commit it twice.
      setCompletion((previous) =>
        callbacks.current.retainPreviousResult !== false && previous?.owner === owner
          ? previous
          : null,
      );
      try {
        const sceneDocument = toSceneDocument(input.vnode);
        // Core can consume the detached VNode without decoding the same document a second time.
        const snapshot = workerEngine
          ? {
              execution: "worker" as const,
              engine: workerEngine,
              scene: decodeSceneDocument(sceneDocument),
            }
          : { execution: "main" as const, scene: fromSceneDocument(sceneDocument) };
        const mergedOptions = mergeAsyncRenderOptions(input.stableDefaults, input.stableOptions);
        const options = captureOptions(mergedOptions, notifications, {
          raster: adapter.raster ?? false,
          canCollect: () => canAdopt() && !hasSettled,
        });
        currentLifetime.pending = () => {
          if (!canAdopt()) {
            return;
          }
          try {
            const operation =
              snapshot.execution === "worker"
                ? adapter.worker(snapshot.engine, snapshot.scene, {
                    options,
                    signal: controller.signal,
                  })
                : scheduler?.enqueue(() => {
                    if (
                      engine &&
                      typeof input.resourceVersion === "number" &&
                      engine.resourceVersion !== input.resourceVersion
                    ) {
                      controller.abort();
                      throw controller.signal.reason;
                    }
                    return adapter.main(engine as Engine, snapshot.scene, options);
                  }, controller.signal);
            if (!operation) {
              throw new Error("Main render scheduler is unavailable");
            }
            operation.then(
              (data) => settle({ data, error: null }),
              (error: unknown) => settle({ data: null, error: asError(error) }),
            );
          } catch (error: unknown) {
            settle({ data: null, error: asError(error) });
          }
        };
      } catch (error: unknown) {
        settle({ data: null, error: asError(error) });
      }
      if (!currentLifetime.isScheduled && currentLifetime.pending) {
        currentLifetime.isScheduled = true;
        queueMicrotask(() => {
          currentLifetime.isScheduled = false;
          const pending = currentLifetime.pending;
          currentLifetime.pending = null;
          pending?.();
        });
      }
    }
    return () => {
      currentLifetime.input = null;
      currentLifetime.pending = null;
      controller.abort();
      notifications.events.length = 0;
    };
  }, [input, owner, workerEngine, engine, scheduler, adapter]);

  useLayoutEffect(() => {
    if (!retainPreviousResult) {
      setCompletion((previous) =>
        previous && previous.outcome !== "success" && previous.data !== null
          ? { ...previous, data: null }
          : previous,
      );
    }
  }, [retainPreviousResult]);

  useEffect(() => {
    if (!completion || completion.input !== lifetime.current.input || completion.delivered) {
      return;
    }
    completion.delivered = true;
    let callbackFailure: unknown;
    let hasCallbackFailure = false;
    const deliver = (callback: () => void) => {
      try {
        callback();
      } catch (error: unknown) {
        if (!hasCallbackFailure) {
          callbackFailure = error;
          hasCallbackFailure = true;
        }
      }
    };
    for (const event of completion.notifications.events) {
      deliver(() => {
        if (event.type === "warning") {
          callbacks.current.onWarning?.(event.warning);
        } else {
          callbacks.current.onPngResolutionAdjusted?.(event.warning);
        }
      });
    }
    completion.notifications.events.length = 0;
    if (completion.error) {
      const renderError = completion.error;
      deliver(() => callbacks.current.onError?.(renderError));
    }
    if (hasCallbackFailure) {
      throw callbackFailure;
    }
  }, [completion]);

  if (!hasCommitted || vnode === null || status === "idle" || status === "loading") {
    return {
      status: "idle",
      execution: null,
      data: null,
      error: null,
      isRendering: false,
      isReady: false,
      isStale: false,
    };
  }
  if (status === "error" && providerError) {
    return {
      status: "error",
      execution: null,
      data: null,
      error: providerError,
      isRendering: false,
      isReady: false,
      isStale: false,
    };
  }
  if (!owner || !execution) {
    return {
      status: "idle",
      execution: null,
      data: null,
      error: null,
      isRendering: false,
      isReady: false,
      isStale: false,
    };
  }
  if (completion?.input === input && completion.outcome === "success" && completion.data !== null) {
    return {
      status: "success",
      execution,
      data: completion.data,
      error: null,
      isRendering: false,
      isReady: true,
      isStale: false,
    };
  }
  const previousData = retainPreviousResult && completion?.owner === owner ? completion.data : null;
  const renderError = completion?.input === input ? completion.error : null;
  const pendingState = renderError
    ? { status: "error" as const, error: renderError, isRendering: false as const }
    : { status: "rendering" as const, error: null, isRendering: true as const };
  return previousData === null
    ? { ...pendingState, execution, data: null, isReady: false, isStale: false }
    : { ...pendingState, execution, data: previousData, isReady: false, isStale: true };
}
