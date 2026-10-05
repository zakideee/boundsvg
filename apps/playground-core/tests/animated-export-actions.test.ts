import type { Engine } from "@boundsvg/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/presets/index", () => ({
  presets: {
    first: {
      title: "First",
      animationDurationMs: 100,
      build: () => ({ type: "Canvas", props: { width: 8, height: 8 }, children: [] }),
    },
    second: {
      title: "Second",
      animationDurationMs: 100,
      build: () => ({ type: "Canvas", props: { width: 8, height: 8 }, children: [] }),
    },
  },
}));
vi.mock("../src/state", () => ({
  coreState: { pngScale: 1 },
  resolveDebugOverlayConfig: () => undefined,
}));

/** Control one asynchronous encoding result in the actual button event flow. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("animated export buttons", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("admits one pending download, discards a switched source and recovers after a failure", async () => {
    const clicks = vi.fn();
    const remove = vi.fn();
    const urls = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const listeners: Array<() => void> = [];
    const button = {
      dataset: { export: "gif" },
      disabled: false,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.push(listener);
      },
    };
    const note = { textContent: "" };
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("document", {
      querySelectorAll: () => [button],
      getElementById: () => note,
      createElement: () => ({ href: "", download: "", click: clicks, remove }),
      body: { appendChild: () => undefined },
    });
    const first = deferred();
    const render = vi.fn(
      async (
        _source: unknown,
        _options: unknown,
        sink: { write: (bytes: Uint8Array) => void; finish: () => void },
      ) => {
        await first.promise;
        sink.write(Uint8Array.of(71, 73, 70, 1));
        sink.finish();
        return { format: "gif", frameCount: 2, bytesWritten: 4 };
      },
    );
    const engine = { renderToAnimatedGif: render } as unknown as Engine;
    const { initExportActions, setExportSource } = await import("../src/export-actions");
    const { presets } = await import("../src/presets/index");
    initExportActions();
    setExportSource(engine, "first", presets.first);
    listeners[0]?.();
    listeners[0]?.();
    expect(frames).toHaveLength(1);
    expect(button.disabled).toBe(true);
    frames.shift()?.(0);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    setExportSource(engine, "second", presets.second);
    listeners[0]?.();
    expect(button.disabled).toBe(true);
    first.resolve();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(urls).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();

    render.mockRejectedValueOnce(new Error("fixed export failure"));
    listeners[0]?.();
    frames.shift()?.(0);
    await vi.waitFor(() => expect(note.textContent).toBe("Export failed: fixed export failure"));
    expect(button.disabled).toBe(false);
    expect(urls).not.toHaveBeenCalled();
    listeners[0]?.();
    frames.shift()?.(0);
    await vi.waitFor(() => expect(clicks).toHaveBeenCalledOnce());
    expect(urls).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:export");
    expect(button.disabled).toBe(false);
    expect(remove).toHaveBeenCalledTimes(3);
  });
});
