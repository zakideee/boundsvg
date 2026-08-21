import { describe, expect, it } from "vitest";
import type { CliIo } from "../src/types.js";
import { watchAndRun } from "../src/watch.js";

function createTestIo(overrides: Partial<CliIo> = {}): CliIo & { stderr: string[] } {
  const stderr: string[] = [];
  return {
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

describe("watchAndRun", () => {
  it("performs initial run for all files", async () => {
    const processedFiles: string[] = [];
    let closeFn: (() => void) | undefined;

    const io = createTestIo({
      watchFiles: (_paths, _onChange) => {
        return {
          close: () => {
            closeFn?.();
          },
        };
      },
    });

    const watchPromise = watchAndRun(io, ["/a.svg", "/b.svg"], {
      runOnce: (path) => {
        processedFiles.push(path);
      },
      debounceMs: 10,
    });

    // Give the initial run a tick to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(processedFiles).toEqual(["/a.svg", "/b.svg"]);
    expect(io.stderr.join("")).toContain("Watching 2 file(s)");

    // Trigger SIGINT to stop
    process.emit("SIGINT" as NodeJS.Signals);

    const exitCode = await watchPromise;
    expect(exitCode).toBe(0);
  });

  it("calls runOnce when a file changes", async () => {
    const processedFiles: string[] = [];
    let changeCallback: ((path: string) => void) | undefined;

    const io = createTestIo({
      watchFiles: (_paths, onChange) => {
        changeCallback = onChange;
        return { close: () => {} };
      },
    });

    const watchPromise = watchAndRun(io, ["/a.svg"], {
      runOnce: (path) => {
        processedFiles.push(path);
      },
      debounceMs: 10,
    });

    // Wait for initial run
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate file change
    changeCallback?.("/a.svg");

    // Wait for change to be processed
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Initial run + change = 2 calls
    expect(processedFiles).toEqual(["/a.svg", "/a.svg"]);

    // Stop
    process.emit("SIGINT" as NodeJS.Signals);
    const exitCode = await watchPromise;
    expect(exitCode).toBe(0);
  });

  it("continues watching after errors in runOnce", async () => {
    let callCount = 0;

    const io = createTestIo({
      watchFiles: (_paths, _onChange) => {
        return { close: () => {} };
      },
    });

    const watchPromise = watchAndRun(io, ["/a.svg"], {
      runOnce: () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("test error");
        }
      },
      debounceMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Error was caught, callCount is still 1
    expect(callCount).toBe(1);
    expect(io.stderr.join("")).toContain("Error processing /a.svg: test error");

    process.emit("SIGINT" as NodeJS.Signals);
    const exitCode = await watchPromise;
    expect(exitCode).toBe(0);
  });
});
