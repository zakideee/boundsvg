import { type Engine, FatalError } from "@boundsvg/core";
import { useCallback, useSyncExternalStore } from "react";

/** Observe an Engine's resource generation without subscribing during render. */
export function useResourceVersion(engine: Engine | null): number | "disposed" | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!engine) {
        return () => undefined;
      }
      try {
        return engine.subscribeResourceChanges(listener);
      } catch (error: unknown) {
        if (error instanceof FatalError && error.code === "ENGINE_DISPOSED") {
          return () => undefined;
        }
        throw error;
      }
    },
    [engine],
  );
  const getSnapshot = useCallback(() => {
    if (!engine) {
      return null;
    }
    try {
      return engine.resourceVersion;
    } catch (error: unknown) {
      if (error instanceof FatalError && error.code === "ENGINE_DISPOSED") {
        return "disposed" as const;
      }
      throw error;
    }
  }, [engine]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
