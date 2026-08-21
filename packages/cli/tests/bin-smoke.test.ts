import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression: the distributed `boundsvg` bin exited 0 with no output for
 * every invocation. tsup code-splitting moved the "am I being executed
 * directly?" check into a shared chunk, so its `import.meta.url` never
 * matched `process.argv[1]` and `runCli()` was never called. These tests
 * spawn the BUILT bin — a unit test through `runCli()` cannot catch this.
 */
const binPath = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/bin.js");
const testFontPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf",
);
const builtBinMissing = !existsSync(binPath);

if (process.env.CI !== undefined && builtBinMissing) {
  throw new Error("CI must build @boundsvg/cli before the built bin smoke test");
}

describe.skipIf(builtBinMissing)("built bin smoke", () => {
  it("prints usage and exits 0 for --help", () => {
    // Usage goes to stderr (stdout is reserved for export payloads).
    const result = spawnSync(process.execPath, [binPath, "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Usage: boundsvg");
  });

  it("fails loudly for a missing input file", () => {
    const result = spawnSync(
      process.execPath,
      [
        binPath,
        "export",
        "--input",
        "/nonexistent/scene.json",
        "--output",
        "-",
        "--font",
        `NotoSansJP:400:normal:${testFontPath}`,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Cannot read file "/nonexistent/scene.json"');
  });
});

describe("render warning delivery", () => {
  it("writes MISSING_GLYPH warnings to stderr during export", async () => {
    // Render warnings were silently discarded on every CLI export path:
    // a scene with an unrenderable glyph exported "successfully" with
    // zero stderr output, even under --verbose.
    const {
      mkdtempSync,
      rmSync,
      writeFileSync,
      readFileSync,
      mkdirSync,
      existsSync: exists,
    } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { runExport } = await import("../src/export.js");

    const tempDir = mkdtempSync(join(tmpdir(), "boundsvg-warn-"));
    try {
      const scenePath = join(tempDir, "scene.json");
      writeFileSync(
        scenePath,
        JSON.stringify({
          type: "Canvas",
          width: 200,
          height: 80,
          children: [
            {
              type: "Text",
              id: "warn-text",
              font: "NotoSansJP",
              fontSizePx: 24,
              children: ["絵文字🎉"],
            },
          ],
        }),
      );
      const outputPath = join(tempDir, "out.svg");
      const stderr: string[] = [];
      const io = {
        argv: [],
        readTextFile: (path: string) => readFileSync(path, "utf8"),
        readBinaryFile: (path: string) => new Uint8Array(readFileSync(path)),
        ensureDir: (path: string) => {
          mkdirSync(path, { recursive: true });
        },
        writeTextFile: (path: string, content: string) => {
          writeFileSync(path, content);
        },
        writeBinaryFile: (path: string, content: Uint8Array) => {
          writeFileSync(path, content);
        },
        writeStdout: () => {},
        writeStderr: (message: string) => {
          stderr.push(message);
        },
        fileExists: (path: string) => exists(path),
        readStdin: () => "",
        writeBinaryStdout: () => {},
        stdinIsTTY: true,
        watchFiles: () => ({ close: () => {} }),
      };

      const exitCode = await runExport(io, [
        "--input",
        scenePath,
        "--output",
        outputPath,
        "--font",
        `NotoSansJP:400:normal:${testFontPath}`,
        "--format",
        "svg",
      ]);

      expect(exitCode).toBe(0);
      expect(stderr.join("")).toContain("MISSING_GLYPH");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
