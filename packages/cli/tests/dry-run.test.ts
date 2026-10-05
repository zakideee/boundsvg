import { describe, expect, it } from "vitest";
import {
  reportDryRun,
  reportDryRunAnimatedRaster,
  reportDryRunBinary,
  reportDryRunDirectory,
} from "../src/dry-run.js";
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
    watchFiles: () => ({ close: () => {} }),
    stderr,
    ...overrides,
  };
}

describe("reportDryRun", () => {
  it("reports [new] when file does not exist", () => {
    const io = createTestIo({ fileExists: () => false });
    reportDryRun(io, "/out/card.tsx", "const x = 1;\n");

    const output = io.stderr.join("");
    expect(output).toContain("[new] /out/card.tsx");
    expect(output).toContain("+ const x = 1;");
  });

  it("reports [new] with preview limited to 10 lines", () => {
    const io = createTestIo({ fileExists: () => false });
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    reportDryRun(io, "/out/card.tsx", lines);

    const output = io.stderr.join("");
    expect(output).toContain("[new] /out/card.tsx");
    expect(output).toContain("+ line 0");
    expect(output).toContain("+ line 9");
    expect(output).toContain("... (10 more lines)");
  });

  it("reports [unchanged] when content matches", () => {
    const content = "const x = 1;\n";
    const io = createTestIo({
      fileExists: () => true,
      readTextFile: () => content,
    });
    reportDryRun(io, "/out/card.tsx", content);

    const output = io.stderr.join("");
    expect(output).toContain("[unchanged] /out/card.tsx");
  });

  it("reports [overwrite] with diff when content differs", () => {
    const io = createTestIo({
      fileExists: () => true,
      readTextFile: () => "const x = 1;\nconst y = 2;\n",
    });
    reportDryRun(io, "/out/card.tsx", "const x = 1;\nconst y = 3;\n");

    const output = io.stderr.join("");
    expect(output).toContain("[overwrite] /out/card.tsx");
    expect(output).toContain("-const y = 2;");
    expect(output).toContain("+const y = 3;");
  });

  it("treats unreadable file as [new]", () => {
    const io = createTestIo({
      fileExists: () => true,
      readTextFile: () => {
        throw new Error("EACCES");
      },
    });
    reportDryRun(io, "/out/card.tsx", "code\n");

    const output = io.stderr.join("");
    expect(output).toContain("[new] /out/card.tsx");
  });
});

describe("reportDryRunBinary", () => {
  it("reports [new] with size when file does not exist", () => {
    const io = createTestIo({ fileExists: () => false });
    reportDryRunBinary(io, "/out/card.png", new Uint8Array(2048));

    const output = io.stderr.join("");
    expect(output).toContain("[new] /out/card.png (2.0KB)");
  });

  it("reports [overwrite] with old→new size", () => {
    const io = createTestIo({
      fileExists: () => true,
      readBinaryFile: () => new Uint8Array(1024),
    });
    reportDryRunBinary(io, "/out/card.png", new Uint8Array(3072));

    const output = io.stderr.join("");
    expect(output).toContain("[overwrite] /out/card.png (1.0KB → 3.0KB)");
  });

  it("treats unreadable file as [new]", () => {
    const io = createTestIo({
      fileExists: () => true,
      readBinaryFile: () => {
        throw new Error("EACCES");
      },
    });
    reportDryRunBinary(io, "/out/card.png", new Uint8Array(1024));

    const output = io.stderr.join("");
    expect(output).toContain("[new] /out/card.png (1.0KB)");
  });
});

describe("reportDryRunDirectory", () => {
  it("reports directory targets for layered outputs", () => {
    const io = createTestIo();
    reportDryRunDirectory(io, "/out/card.layers");

    expect(io.stderr.join("")).toContain("[directory] /out/card.layers");
  });
});

describe("reportDryRunAnimatedRaster", () => {
  it("reports stat lengths without reading or materializing either output", () => {
    const io = createTestIo({
      fileExists: () => true,
      getFileByteLength: () => 1024,
      readBinaryFile: () => {
        throw new Error("whole-file read is forbidden in this path");
      },
    });
    reportDryRunAnimatedRaster(io, "/out/animation.gif", 3072);
    expect(io.stderr.join("")).toContain("[overwrite] /out/animation.gif (1.0KB → 3.0KB)");
  });

  it("handles stat failures and rejects unsafe candidate sizes", () => {
    const io = createTestIo({ fileExists: () => true, getFileByteLength: () => NaN });
    reportDryRunAnimatedRaster(io, "/out/animation.gif", 1024);
    expect(io.stderr.join("")).toContain("[new] /out/animation.gif (1.0KB)");
    expect(() =>
      reportDryRunAnimatedRaster(io, "/out/animation.gif", Number.MAX_SAFE_INTEGER + 1),
    ).toThrow();
  });
});
