import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Built executable used to check process dispatch and complete output payloads. */
const binPath = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/bin.js");
/** Fixture font supplied explicitly so rendering does not depend on host fonts. */
const testFontPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf",
);
/** Local runs may lack a build; CI must always exercise the built executable. */
const builtBinMissing = !existsSync(binPath);

if (process.env.CI !== undefined && builtBinMissing) {
  throw new Error("CI must build @boundsvg/cli before the built bin smoke test");
}

describe.skipIf(builtBinMissing)("built bin smoke", () => {
  it("prints usage and exits 0 for --help", () => {
    // Usage goes to stderr (stdout is reserved for export payloads).
    const commandResult = spawnSync(process.execPath, [binPath, "--help"], {
      encoding: "utf8",
    });
    expect(commandResult.status).toBe(0);
    expect(commandResult.stdout).toBe("");
    expect(commandResult.stderr.match(/Usage: boundsvg <command>/g)).toHaveLength(1);
  });

  it("prints convert help once from the real executable path", () => {
    const commandResult = spawnSync(process.execPath, [binPath, "convert", "--help"], {
      encoding: "utf8",
    });
    expect(commandResult.status).toBe(0);
    expect(commandResult.stdout).toBe("");
    expect(commandResult.stderr.match(/Usage: boundsvg convert/g)).toHaveLength(1);
  });

  it("converts and exports one payload per invocation", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "boundsvg-bin-dispatch-"));
    try {
      const inputPath = join(temporaryDirectory, "square.svg");
      writeFileSync(
        inputPath,
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
      );
      const converted = spawnSync(
        process.execPath,
        [binPath, "convert", "-i", inputPath, "-o", "-", "--default-font", "NotoSansJP"],
        { encoding: "utf8" },
      );
      expect(converted.status).toBe(0);
      expect(converted.stderr).toBe("");
      expect(converted.stdout.match(/export default function Square\(\)/g)).toHaveLength(1);
      const exported = spawnSync(
        process.execPath,
        [
          binPath,
          "export",
          "-i",
          inputPath,
          "-o",
          "-",
          "--format",
          "svg",
          "--default-font",
          "NotoSansJP",
          "--font",
          `NotoSansJP:400:normal:${testFontPath}`,
        ],
        { encoding: "utf8" },
      );
      expect(exported.status).toBe(0);
      expect(exported.stderr).toBe("");
      expect(exported.stdout.match(/<svg xmlns=/g)).toHaveLength(1);
      expect(exported.stdout).toContain('fill="red"');
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it.each(["index", "animation"])("imports %s without dispatching CLI-like arguments", (entry) => {
    const libraryPath = resolve(dirname(binPath), `${entry}.js`);
    const imported = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `process.argv = [process.execPath, ${JSON.stringify(libraryPath)}, '--help']; await import(${JSON.stringify(libraryPath)});`,
      ],
      { encoding: "utf8" },
    );
    expect(imported.status).toBe(0);
    expect(imported.stdout).toBe("");
    expect(imported.stderr).toBe("");
  });

  it("consumes stdin once and writes one conversion payload", () => {
    const converted = spawnSync(
      process.execPath,
      [
        binPath,
        "convert",
        "-i",
        "-",
        "-o",
        "-",
        "--default-font",
        "NotoSansJP",
        "--name",
        "Square",
      ],
      {
        encoding: "utf8",
        input:
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
      },
    );
    expect(converted.status).toBe(0);
    expect(converted.stderr).toBe("");
    expect(converted.stdout.match(/export default function Square\(\)/g)).toHaveLength(1);
  });

  it("fails loudly for a missing input file", () => {
    const commandResult = spawnSync(
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

    expect(commandResult.status).toBe(1);
    expect(
      commandResult.stderr.match(/Cannot read file "\/nonexistent\/scene.json"/g),
    ).toHaveLength(1);
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
      expect(stderr.join("")).toContain('Font "NotoSansJP" is missing glyphs for: U+1F389 (🎉)');
      expect(readFileSync(outputPath, "utf8")).toContain("<svg");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
