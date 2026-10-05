import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnimatedRasterFileSink,
  createAnimatedRasterSpool,
} from "../src/animation-storage.js";

class BrowserFile {
  bytes = new Uint8Array([1, 2, 3]);
  pending = new Uint8Array(0);
  abort = vi.fn(async () => {
    this.pending = new Uint8Array(0);
  });
  close = vi.fn(async () => {
    this.bytes = this.pending;
  });
  write = vi.fn(async (command: { type: string; position: number; data: Uint8Array }) => {
    const size = Math.max(this.pending.length, command.position + command.data.length);
    const output = new Uint8Array(size);
    output.set(this.pending);
    output.set(command.data, command.position);
    this.pending = output;
  });
  createWritable = vi.fn(
    async () =>
      ({
        write: this.write,
        close: this.close,
        abort: this.abort,
      }) as unknown as FileSystemWritableFileStream,
  );
  getFile = vi.fn(async () => new File([this.bytes], "output"));
  handle(): FileSystemFileHandle {
    return this as unknown as FileSystemFileHandle;
  }
}

class BrowserDirectory {
  files = new Map<string, BrowserFile>();
  getFileHandle = vi.fn(async (name: string, options?: { create?: boolean }) => {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = new BrowserFile();
      this.files.set(name, file);
    }
    if (!file) {
      throw new DOMException("Missing file", "NotFoundError");
    }
    return file.handle();
  });
  removeEntry = vi.fn(async (name: string) => {
    this.files.delete(name);
  });
  handle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser caller storage", () => {
  it("opens once without existing data, patches positions and commits only on close", async () => {
    const file = new BrowserFile();
    const destination = await createAnimatedRasterFileSink(file.handle());
    expect(file.createWritable).toHaveBeenCalledExactlyOnceWith({ keepExistingData: false });
    await destination.write(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]));
    await destination.patch(4, Uint8Array.of(4, 0, 0, 0));
    expect([...file.bytes]).toEqual([1, 2, 3]);
    await destination.finish();
    expect([...file.bytes]).toEqual([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    await destination.abort("late cancel");
    expect(file.abort).not.toHaveBeenCalled();
  });

  it("does not abort a close that later commits successfully", async () => {
    const file = new BrowserFile();
    let finish!: () => void;
    file.close.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      file.bytes = file.pending;
    });
    const destination = await createAnimatedRasterFileSink(file.handle());
    await destination.write(Uint8Array.of(71, 73, 70));
    const closing = destination.finish();
    await vi.waitFor(() => expect(file.close).toHaveBeenCalledOnce());
    const cancelling = destination.abort("deadline");
    finish();
    await closing;
    await cancelling;
    expect([...file.bytes]).toEqual([71, 73, 70]);
    expect(file.abort).not.toHaveBeenCalled();
  });

  it("keeps caller file contents on write failure and cancels only the opened stream", async () => {
    const file = new BrowserFile();
    file.write.mockRejectedValueOnce(new DOMException("Quota", "QuotaExceededError"));
    const destination = await createAnimatedRasterFileSink(file.handle());
    await expect(destination.write(Uint8Array.of(71, 73, 70))).rejects.toMatchObject({
      code: "ANIMATED_RASTER_SINK_FAILED",
      context: { format: "gif", operation: "write" },
    });
    await destination.abort("write failure");
    await destination.abort("repeat");
    expect([...file.bytes]).toEqual([1, 2, 3]);
    expect(file.abort).toHaveBeenCalledOnce();
  });

  it("reports unavailable capability and permission without selecting a collector", async () => {
    await expect(createAnimatedRasterFileSink({} as FileSystemFileHandle)).rejects.toMatchObject({
      code: "ANIMATED_RASTER_SINK_UNAVAILABLE",
      context: { reason: "unsupported" },
    });
    const file = new BrowserFile();
    file.createWritable.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    await expect(createAnimatedRasterFileSink(file.handle())).rejects.toMatchObject({
      code: "ANIMATED_RASTER_SINK_UNAVAILABLE",
      context: { reason: "permission" },
    });
  });

  it("reads a completed patchable spool in bounded slices and retries failed deletion", async () => {
    const directory = new BrowserDirectory();
    const spool = await createAnimatedRasterSpool(directory.handle());
    const bytes = new Uint8Array(65_539).fill(42);
    await spool.sink.write(bytes);
    await spool.sink.patch(4, Uint8Array.of(1, 2, 3, 4));
    await expect(spool.read(0, 1)).rejects.toMatchObject({ code: "ANIMATED_RASTER_SINK_FAILED" });
    await spool.sink.finish();
    const first = await spool.read(0, 65_536);
    expect(first).toHaveLength(65_536);
    expect([...first.subarray(4, 8)]).toEqual([1, 2, 3, 4]);
    expect(await spool.read(65_536, 65_536)).toEqual(Uint8Array.of(42, 42, 42));
    expect(await spool.read(65_539, 1)).toHaveLength(0);
    await expect(spool.read(0, 65_537)).rejects.toMatchObject({
      code: "ANIMATED_RASTER_SINK_FAILED",
    });
    directory.removeEntry.mockRejectedValueOnce(new DOMException("Storage", "UnknownError"));
    await expect(spool.dispose()).rejects.toMatchObject({ code: "ANIMATED_RASTER_SINK_FAILED" });
    expect(directory.files.size).toBe(1);
    await spool.dispose();
    await spool.dispose();
    expect(directory.files.size).toBe(0);
    expect(directory.removeEntry).toHaveBeenCalledTimes(2);
  });

  it("never removes an existing entry when its chosen temporary name collides", async () => {
    const directory = new BrowserDirectory();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000000",
    );
    const name = "animated-00000000-0000-4000-8000-000000000000.tmp";
    directory.files.set(name, new BrowserFile());
    await expect(createAnimatedRasterSpool(directory.handle())).rejects.toMatchObject({
      code: "ANIMATED_RASTER_SINK_FAILED",
    });
    expect(directory.removeEntry).not.toHaveBeenCalled();
    expect(directory.files.has(name)).toBe(true);
  });
});
