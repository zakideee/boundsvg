/** @jsxImportSource react */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useRenderAsset } from "../src/assets.js";
import { BoundSvgContext } from "../src/context.js";
import { useInteractiveSvg } from "../src/hooks/use-interactive-svg.js";
import { useRenderToPng } from "../src/hooks/use-render-png.js";
import { useRenderToSvg } from "../src/hooks/use-render-svg.js";
import type { BoundSvgContextValue } from "../src/types.js";
import { makeWorkerEngineMock } from "./test-doubles.js";

/**
 * Regression: once the Worker initializes the provider sets `engine` to null while `status` stays
 * "ready", so every main-thread-only hook returned `isReady: false` with
 * `error: null` — the component rendered nothing and reported no problem.
 */
const vnode = { type: "Canvas", props: { width: 100, height: 50 }, children: [] } as never;

function workerModeContext(): BoundSvgContextValue {
  return {
    engine: null,
    workerEngine: makeWorkerEngineMock({}),
    status: "ready",
    error: null,
  } as BoundSvgContextValue;
}

function mainThreadLoadingContext(): BoundSvgContextValue {
  return {
    engine: null,
    workerEngine: null,
    status: "loading",
    error: null,
  } as BoundSvgContextValue;
}

function captureHookErrors(context: BoundSvgContextValue): Record<string, Error | null> {
  const captured: Record<string, Error | null> = {};

  function Probe() {
    captured.useRenderToSvg = useRenderToSvg(vnode).error;
    captured.useRenderToPng = useRenderToPng(vnode).error;
    captured.useRenderAsset = useRenderAsset(vnode).error;
    captured.useInteractiveSvg = useInteractiveSvg(vnode, {}).error;
    return null;
  }

  renderToString(
    <BoundSvgContext.Provider value={context}>
      <Probe />
    </BoundSvgContext.Provider>,
  );
  return captured;
}

describe("main-thread-only hooks in Worker mode", () => {
  it("surfaces an error instead of silently rendering nothing", () => {
    const errors = captureHookErrors(workerModeContext());

    for (const [hookName, error] of Object.entries(errors)) {
      expect(error, `${hookName} must report why it cannot run`).not.toBeNull();
      expect(error?.message).toContain("Worker mode");
      expect(error?.message).toContain(hookName);
    }
  });

  it("stays quiet while the engine is still loading", () => {
    // Not-ready-yet is a normal transient state, not an error.
    const errors = captureHookErrors(mainThreadLoadingContext());

    for (const error of Object.values(errors)) {
      expect(error).toBeNull();
    }
  });
});
