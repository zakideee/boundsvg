import { describe, expect, it, vi } from "vitest";
import { runExportWatch } from "../src/export.js";
import type { CliIo } from "../src/types.js";

function createTestIo(overrides: Partial<CliIo> = {}): CliIo & { stderr: string[] } {
  const stderr: string[] = [];
  return {
    openAnimatedRasterSink: async () => ({
      write: () => undefined,
      patch: () => undefined,
      finish: () => undefined,
      abort: () => undefined,
    }),
    getFileByteLength: () => 0,
    argv: [],
    readTextFile: () => "",
    readBinaryFile: () => new Uint8Array(),
    ensureDir: () => {},
    writeTextFile: () => {},
    writeBinaryFile: () => {},
    writeStdout: () => {},
    writeStderr: (msg) => stderr.push(msg),
    fileExists: () => false,
    readStdin: () => "",
    writeBinaryStdout: () => {},
    stdinIsTTY: true,
    watchFiles: (_paths, _onChange) => ({ close: () => {} }),
    stderr,
    ...overrides,
  };
}

describe("export watch serialization", () => {
  it("serializes async exports and coalesces repeated changes per path", async () => {
    let change: ((path: string) => void) | undefined;
    let finish: (() => void) | undefined;
    let active = 0;
    const processed: string[] = [];
    const io = createTestIo({
      watchFiles: (_paths, onChange) => {
        change = onChange;
        return { close: () => undefined };
      },
    });
    const watchPromise = runExportWatch(io, ["/a.svg", "/b.svg"], async (path) => {
      active += 1;
      expect(active).toBe(1);
      processed.push(path);
      if (processed.length === 1) {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      active -= 1;
      return 0;
    });
    change?.("/a.svg");
    change?.("/a.svg");
    change?.("/b.svg");
    change?.("/b.svg");
    expect(processed).toEqual(["/a.svg"]);
    finish?.();
    await vi.waitFor(() => expect(processed).toEqual(["/a.svg", "/b.svg", "/a.svg"]));
    process.emit("SIGINT" as NodeJS.Signals);
    await expect(watchPromise).resolves.toBe(0);
  });

  it("awaits an active export on SIGINT and drops queued changes", async () => {
    let finish: (() => void) | undefined;
    const processed: string[] = [];
    const watchPromise = runExportWatch(createTestIo(), ["/a.svg", "/b.svg"], (path) => {
      processed.push(path);
      return new Promise<number>((resolve) => {
        finish = () => resolve(0);
      });
    });
    let settled = false;
    void watchPromise.then(() => {
      settled = true;
    });
    process.emit("SIGINT" as NodeJS.Signals);
    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();
    await expect(watchPromise).resolves.toBe(0);
    expect(processed).toEqual(["/a.svg"]);
  });
});
