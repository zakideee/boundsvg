import { afterEach, describe, expect, it, vi } from "vitest";
import { MainRenderScheduler } from "../src/execution/main-render-scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("main render admission", () => {
  it("admits one task and 32 queued jobs, rejects overflow, and completes accepted jobs in FIFO order", async () => {
    vi.useFakeTimers();
    const scheduler = new MainRenderScheduler();
    const trace: number[] = [];
    const results = Array.from({ length: 64 }, (_, index) =>
      scheduler
        .enqueue(() => {
          trace.push(index);
          return index;
        }, new AbortController().signal)
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        ),
    );
    expect(trace).toEqual([]);
    await vi.runAllTimersAsync();
    const settled = await Promise.all(results);
    expect(trace).toEqual(Array.from({ length: 33 }, (_, index) => index));
    expect(settled.slice(0, 33)).toEqual(trace.map((value) => ({ value })));
    for (const overflow of settled.slice(33)) {
      expect(overflow).toMatchObject({
        error: { code: "RENDER_QUEUE_FULL", stage: "engine", context: { queueLimit: 32 } },
      });
    }
    scheduler.dispose();
  });

  it("removes only the aborted consumer and places its replacement behind other accepted jobs", async () => {
    vi.useFakeTimers();
    const scheduler = new MainRenderScheduler();
    const trace: string[] = [];
    const firstController = new AbortController();
    const first = scheduler
      .enqueue(() => trace.push("superseded"), firstController.signal)
      .catch(() => "aborted");
    const other = scheduler.enqueue(() => trace.push("other"), new AbortController().signal);
    firstController.abort();
    const replacement = scheduler.enqueue(
      () => trace.push("replacement"),
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await Promise.all([first, other, replacement]);
    expect(trace).toEqual(["other", "replacement"]);
    scheduler.dispose();
  });

  it("settles all local work on idempotent disposal without running queued computations", async () => {
    vi.useFakeTimers();
    const scheduler = new MainRenderScheduler();
    const compute = vi.fn();
    const pending = Array.from({ length: 3 }, () =>
      scheduler.enqueue(compute, new AbortController().signal).catch((error: unknown) => error),
    );
    scheduler.dispose();
    scheduler.dispose();
    await vi.runAllTimersAsync();
    expect(compute).not.toHaveBeenCalled();
    for (const error of await Promise.all(pending)) {
      expect(error).toMatchObject({ code: "ENGINE_DISPOSED" });
    }
    await expect(scheduler.enqueue(compute, new AbortController().signal)).rejects.toMatchObject({
      code: "ENGINE_DISPOSED",
    });
  });
});
