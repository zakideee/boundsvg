import type { Engine, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import type { RenderInputOptions } from "../types.js";
import { resolveRenderRevision } from "../utils/render-input-options.js";
import { useResourceVersion } from "./use-resource-version.js";
import { useStructurallyStableValue } from "./use-structurally-stable-value.js";

/** Keep a synchronous input's reuse scoped to its explicit and resource generations. */
export function useRenderInput(
  vnode: VNode | null,
  engine: Engine | null,
  inputOptions?: RenderInputOptions,
) {
  const revision = resolveRenderRevision(inputOptions?.revision);
  const resourceVersion = useResourceVersion(engine);
  const stableVNode = useStructurallyStableValue(vnode);
  return useMemo(
    () => ({ vnode: stableVNode, revision, resourceVersion }),
    [stableVNode, revision, resourceVersion],
  );
}
