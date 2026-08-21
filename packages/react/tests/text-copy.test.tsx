// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type UseTextCopyResult, useTextCopy } from "../src/hooks/use-text-copy.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountTextCopy(): Promise<{
  current: () => UseTextCopyResult;
  unmount: () => Promise<void>;
}> {
  let textCopyResult: UseTextCopyResult | null = null;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe() {
    textCopyResult = useTextCopy(null, null);
    return null;
  }

  await act(async () => {
    root.render(<Probe />);
  });

  return {
    current: () => {
      if (!textCopyResult) {
        throw new TypeError("text copy hook did not mount");
      }
      return textCopyResult;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("useTextCopy clipboard fallback lifecycle", () => {
  it("does not create status state or a timer after unmount during clipboard await", async () => {
    const clipboard = deferred();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(() => clipboard.promise) },
    });
    const hook = await mountTextCopy();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const copyPromise = hook.current().copyToClipboard("late copy");

    await hook.unmount();
    clipboard.resolve();
    await copyPromise;

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("lets only the latest clipboard request create status feedback", async () => {
    const firstClipboard = deferred();
    const secondClipboard = deferred();
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => firstClipboard.promise)
      .mockImplementationOnce(() => secondClipboard.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const hook = await mountTextCopy();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const firstCopy = hook.current().copyToClipboard("first");
    const secondCopy = hook.current().copyToClipboard("second");

    await act(async () => {
      secondClipboard.resolve();
      await secondCopy;
    });
    await act(async () => {
      firstClipboard.resolve();
      await firstCopy;
    });

    expect(hook.current().copyStatus).toBe("copied");
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it("copies through the fallback and removes its transient textarea", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const hook = await mountTextCopy();

    let copied = false;
    await act(async () => {
      copied = await hook.current().copyToClipboard("copy me");
    });

    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(hook.current().copyStatus).toBe("copied");
    await hook.unmount();
  });

  it("removes the transient textarea when the fallback throws", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("copy command failed");
      }),
    });
    const hook = await mountTextCopy();

    let copied = true;
    await act(async () => {
      copied = await hook.current().copyToClipboard("copy me");
    });

    expect(copied).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
    expect(hook.current().copyStatus).toBe("failed");
    await hook.unmount();
  });
});
