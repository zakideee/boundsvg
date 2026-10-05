import type { FileHandle } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnimatedRasterFileSink } from "../src/animation-file.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open), rename: vi.fn(original.rename) };
});

/** Real filesystem operations used beneath fault injection and during test cleanup. */
const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
/** Temporary directories owned by these tests until cleanup after each case. */
const directories: string[] = [];
let handle: FileHandle;
let destination: string;

beforeEach(async () => {
  vi.mocked(filesystem.open).mockReset().mockImplementation(original.open);
  vi.mocked(filesystem.rename).mockReset().mockImplementation(original.rename);
  const directory = await original.mkdtemp(join(tmpdir(), "animated-file-failure-"));
  directories.push(directory);
  destination = join(directory, "output.gif");
  await original.writeFile(destination, "previous");
  vi.mocked(filesystem.open).mockImplementationOnce(async (path, flags, mode) => {
    handle = await original.open(path, flags, mode);
    return handle;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => original.rm(path, { recursive: true })));
});

describe("animated file commit failure boundaries", () => {
  it("retries short writes at exact append and patch positions before chmod, close and rename", async () => {
    const sink = await createAnimatedRasterFileSink(destination);
    const write = handle.write.bind(handle);
    const positions: number[] = [];
    vi.spyOn(handle, "write").mockImplementation(async (buffer, offset, length, position) => {
      expect(typeof buffer).not.toBe("string");
      const chunk = buffer as Uint8Array;
      positions.push(position as number);
      return write(chunk, offset as number, Math.min(length as number, 3), position);
    });
    const order: string[] = [];
    const chmod = handle.chmod.bind(handle);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "chmod").mockImplementation(async (mode) => {
      order.push("chmod");
      await chmod(mode);
    });
    vi.spyOn(handle, "close").mockImplementation(async () => {
      order.push("close");
      await close();
    });
    vi.mocked(filesystem.rename).mockImplementationOnce(async (temporaryPath, destinationPath) => {
      order.push("rename");
      await original.rename(temporaryPath, destinationPath);
    });
    await sink.write(Uint8Array.of(82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80));
    await sink.patch(4, Uint8Array.of(4, 0, 0, 0));
    await sink.finish();
    expect(positions).toEqual([0, 3, 6, 9, 4, 7]);
    expect(order).toEqual(["chmod", "close", "rename"]);
    expect([...(await original.readFile(destination))]).toEqual([
      82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80,
    ]);
  });

  it.each([
    "write",
    "chmod",
    "close",
  ] as const)("keeps the original and removes its temp after %s failure", async (operation) => {
    const sink = await createAnimatedRasterFileSink(destination);
    const failure = new Error(`injected ${operation}`);
    if (operation === "write") {
      vi.spyOn(handle, "write").mockRejectedValueOnce(failure);
      await expect(sink.write(Uint8Array.of(71, 73, 70))).rejects.toMatchObject({
        code: "ANIMATED_RASTER_SINK_FAILED",
        context: { operation: "write" },
        cause: failure,
      });
    } else {
      await sink.write(Uint8Array.of(71, 73, 70));
      if (operation === "chmod") {
        vi.spyOn(handle, "chmod").mockRejectedValueOnce(failure);
      } else {
        vi.spyOn(handle, "close").mockRejectedValueOnce(failure);
      }
      await expect(sink.finish()).rejects.toMatchObject({
        code: "ANIMATED_RASTER_SINK_FAILED",
        context: { operation: "finish" },
        cause: failure,
      });
    }
    expect(await original.readFile(destination, "utf8")).toBe("previous");
    expect(filesystem.rename).not.toHaveBeenCalled();
    await sink.abort("failed operation");
    expect(await original.readdir(join(destination, ".."))).toEqual(["output.gif"]);
  });

  it("waits for pending rename and preserves its successfully committed destination after abort", async () => {
    const sink = await createAnimatedRasterFileSink(destination);
    await sink.write(Uint8Array.of(71, 73, 70));
    let release: (() => void) | undefined;
    let reached: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entering = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.mocked(filesystem.rename).mockImplementationOnce(async (temporaryPath, destinationPath) => {
      reached?.();
      await pending;
      await original.rename(temporaryPath, destinationPath);
    });
    const finishing = sink.finish();
    await entering;
    let isAbortSettled = false;
    const aborting = sink.abort("deadline").then(() => {
      isAbortSettled = true;
    });
    await Promise.resolve();
    expect(isAbortSettled).toBe(false);
    expect(await original.readFile(destination, "utf8")).toBe("previous");
    release?.();
    await finishing;
    await aborting;
    expect(await original.readFile(destination, "utf8")).toBe("GIF");
    expect(await original.readdir(join(destination, ".."))).toEqual(["output.gif"]);
    await sink.abort("repeated cleanup");
    expect(await original.readFile(destination, "utf8")).toBe("GIF");
  });
});
