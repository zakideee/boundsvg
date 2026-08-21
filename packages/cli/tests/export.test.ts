import { describe, expect, it } from "vitest";
import { runExport } from "../src/export.js";
import type { CliIo } from "../src/types.js";

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
    writeStderr: (message) => stderr.push(message),
    fileExists: () => false,
    readStdin: () => "",
    writeBinaryStdout: () => {},
    stdinIsTTY: true,
    watchFiles: () => ({ close: () => {} }),
    stderr,
    ...overrides,
  };
}

describe("runExport", () => {
  it("rejects layered-svg stdout output before engine initialization", async () => {
    const io = createTestIo();

    const exitCode = await runExport(io, [
      "--input",
      "card.svg",
      "--output",
      "-",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "layered-svg",
    ]);

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("layered-svg export does not support stdout output");
  });

  it("rejects layered-png stdout output before engine initialization", async () => {
    const io = createTestIo();

    const exitCode = await runExport(io, [
      "--input",
      "card.svg",
      "--output",
      "-",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "layered-png",
    ]);

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("layered-png export does not support stdout output");
  });
});
