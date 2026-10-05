import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createAnimatedRasterStdoutSink } from "../src/animation-stdout.js";

function stream(write: (chunk: Uint8Array, callback: (error?: Error | null) => void) => boolean) {
  const emitter = new EventEmitter();
  const fake = Object.assign(emitter, { write: vi.fn(write), destroy: vi.fn(), end: vi.fn() });
  return { fake, writable: fake as unknown as Writable };
}

describe("animated stdout ownership", () => {
  it("waits for callback and drain and handles a synchronous callback with an earlier drain", async () => {
    const { fake, writable } = stream((_chunk, callback) => {
      callback();
      fake.emit("drain");
      return false;
    });
    const sink = createAnimatedRasterStdoutSink(writable, "gif");
    await sink.write(Uint8Array.of(1));
    await sink.finish();
    expect(fake.listenerCount("drain")).toBe(0);
    expect(fake.listenerCount("error")).toBe(0);
    expect(fake.end).not.toHaveBeenCalled();
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("requires drain even after a successful write callback", async () => {
    let callback: (() => void) | undefined;
    const { fake, writable } = stream((_chunk, done) => {
      callback = done;
      return false;
    });
    const sink = createAnimatedRasterStdoutSink(writable, "gif");
    let settled = false;
    const pending = Promise.resolve(sink.write(Uint8Array.of(1))).then(() => {
      settled = true;
    });
    callback?.();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(settled).toBe(false);
    fake.emit("drain");
    await pending;
    await sink.finish();
  });

  it("captures deferred errors after callback and closes a pending drain wait", async () => {
    const cause = new Error("deferred output failure");
    const { fake, writable } = stream((_chunk, callback) => {
      callback();
      process.nextTick(() => {
        fake.emit("error", cause);
      });
      return false;
    });
    const sink = createAnimatedRasterStdoutSink(writable, "gif");
    await expect(sink.write(Uint8Array.of(1))).rejects.toMatchObject({
      code: "ANIMATED_RASTER_SINK_FAILED",
      cause,
    });
    await sink.abort(cause);
    expect(fake.listenerCount("drain")).toBe(0);
    expect(fake.listenerCount("error")).toBe(0);
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("captures errors after a successful callback with no required drain", async () => {
    const cause = new Error("nextTick error");
    const { fake, writable } = stream((_chunk, callback) => {
      callback();
      process.nextTick(() => {
        fake.emit("error", cause);
      });
      return true;
    });
    const sink = createAnimatedRasterStdoutSink(writable, "gif");
    await expect(sink.write(Uint8Array.of(1))).rejects.toMatchObject({ cause });
    await sink.abort(cause);
  });

  it("removes only its own listeners", async () => {
    const { fake, writable } = stream((_chunk, callback) => {
      callback();
      return true;
    });
    const existing = vi.fn();
    fake.on("error", existing);
    const sink = createAnimatedRasterStdoutSink(writable, "gif");
    await sink.write(Uint8Array.of(1));
    await sink.finish();
    expect(fake.listeners("error")).toEqual([existing]);
  });
});
