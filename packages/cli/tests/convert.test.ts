import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runConvert } from "../src/convert.js";
import type { CliIo } from "../src/types.js";

const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect x="0" y="0" width="240" height="120" fill="#101010" />
  <text x="24" y="68" font-size="32" fill="#ffffff">Hello</text>
</svg>`;

function createTestIo(
  overrides: Partial<CliIo> = {},
): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    argv: [],
    readTextFile: () => "",
    readBinaryFile: () => new Uint8Array(),
    ensureDir: () => {},
    writeTextFile: () => {},
    writeBinaryFile: () => {},
    writeStdout: (msg) => stdout.push(msg),
    writeStderr: (msg) => stderr.push(msg),
    fileExists: () => false,
    readStdin: () => "",
    writeBinaryStdout: () => {},
    stdinIsTTY: true,
    watchFiles: () => ({ close: () => {} }),
    stdout,
    stderr,
    ...overrides,
  };
}

function withTempDir(run: (tempDir: string) => void): void {
  const tempDir = mkdtempSync(join(tmpdir(), "boundsvg-convert-"));
  try {
    run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("runConvert", () => {
  it("returns 0 for --help", () => {
    const io = createTestIo();
    expect(runConvert(io, ["--help"])).toBe(0);
    expect(io.stderr.join("")).toContain("Usage:");
  });

  it("returns 1 for missing required args", () => {
    const io = createTestIo();
    expect(runConvert(io, [])).toBe(1);
    expect(io.stderr.join("")).toContain("Usage:");
  });

  it("reports file read errors via io.writeStderr", () => {
    const io = createTestIo({
      readTextFile: () => {
        throw new Error("ENOENT");
      },
    });
    const exitCode = runConvert(io, ["--input", "missing.svg", "--default-font", "NotoSansJP"]);
    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("Error: Cannot read file");
  });

  it("catches conversion errors and reports them", () => {
    const io = createTestIo({
      readTextFile: () => SIMPLE_SVG,
      writeTextFile: () => {
        throw new Error("EACCES");
      },
    });
    const exitCode = runConvert(io, ["--input", "card.svg", "--default-font", "NotoSansJP"]);
    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("Error: Cannot write file");
  });

  it("generates tsx and reports via io.writeStdout", () => {
    withTempDir((tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.tsx");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const io = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
        writeTextFile: (path, data) => writeFileSync(path, data, "utf-8"),
      });

      const exitCode = runConvert(io, [
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--default-font",
        "NotoSansJP",
      ]);
      expect(exitCode).toBe(0);
      expect(io.stdout.join("")).toContain(`Converted: ${resolve(outputPath)}`);

      const generated = readFileSync(outputPath, "utf-8");
      expect(generated).toContain("export default function Card");
    });
  });

  it("generates scene.json when format=scene", () => {
    withTempDir((tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.scene.json");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const io = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
        writeTextFile: (path, data) => writeFileSync(path, data, "utf-8"),
      });

      const exitCode = runConvert(io, [
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--default-font",
        "NotoSansJP",
        "--format",
        "scene",
      ]);
      expect(exitCode).toBe(0);

      const generated = readFileSync(outputPath, "utf-8");
      const scene = JSON.parse(generated);
      expect(scene.type).toBe("Canvas");
    });
  });

  it("converts scene.json to bound-component", () => {
    withTempDir((tempDir) => {
      // First create a scene.json from SVG
      const svgPath = join(tempDir, "card.svg");
      const scenePath = join(tempDir, "card.scene.json");
      writeFileSync(svgPath, SIMPLE_SVG, "utf-8");

      const io1 = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
        writeTextFile: (path, data) => writeFileSync(path, data, "utf-8"),
      });

      runConvert(io1, [
        "--input",
        svgPath,
        "--output",
        scenePath,
        "--default-font",
        "NotoSansJP",
        "--format",
        "scene",
      ]);

      // Then convert scene.json to bound-component
      const outputPath = join(tempDir, "card.tsx");

      const io2 = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
        writeTextFile: (path, data) => writeFileSync(path, data, "utf-8"),
      });

      const exitCode = runConvert(io2, [
        "--input",
        scenePath,
        "--output",
        outputPath,
        "--font-source",
        "NotoSansJP:400:normal:/fonts/NotoSansJP.woff2",
      ]);
      expect(exitCode).toBe(0);
      expect(io2.stdout.join("")).toContain(`Converted: ${resolve(outputPath)}`);

      const generated = readFileSync(outputPath, "utf-8");
      expect(generated).toContain("export default function Card");
      expect(generated).toContain("BoundSvgProvider");
    });
  });

  it("rejects scene-to-scene conversion", () => {
    withTempDir((tempDir) => {
      const scenePath = join(tempDir, "card.scene.json");
      writeFileSync(scenePath, JSON.stringify({ type: "Canvas", children: [] }), "utf-8");

      const io = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
        writeTextFile: (path, data) => writeFileSync(path, data, "utf-8"),
      });

      const exitCode = runConvert(io, [
        "--input",
        scenePath,
        "--output",
        join(tempDir, "out.scene.json"),
        "--format",
        "scene",
      ]);
      expect(exitCode).toBe(1);
      expect(io.stderr.join("")).toContain("Scene-to-Scene conversion is not supported");
    });
  });

  it("reports invalid JSON separately for scene input", () => {
    withTempDir((tempDir) => {
      const scenePath = join(tempDir, "card.scene.json");
      writeFileSync(scenePath, "{", "utf-8");

      const io = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
      });

      const exitCode = runConvert(io, [
        "--input",
        scenePath,
        "--output",
        join(tempDir, "card.tsx"),
        "--font-source",
        "NotoSansJP:400:normal:/fonts/NotoSansJP.woff2",
      ]);

      expect(exitCode).toBe(1);
      expect(io.stderr.join("")).toContain("Error: Invalid JSON in input");
    });
  });

  it("reports invalid scene structure separately for scene input", () => {
    withTempDir((tempDir) => {
      const scenePath = join(tempDir, "card.scene.json");
      writeFileSync(
        scenePath,
        JSON.stringify({
          type: "Canvas",
          width: 320,
          height: 180,
          children: [
            {
              type: "Text",
              font: "NotoSansJP",
              fontSizePx: 24,
              children: [{ type: "Canvas", width: 10, height: 10, children: [] }],
            },
          ],
        }),
        "utf-8",
      );

      const io = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
      });

      const exitCode = runConvert(io, [
        "--input",
        scenePath,
        "--output",
        join(tempDir, "card.tsx"),
        "--font-source",
        "NotoSansJP:400:normal:/fonts/NotoSansJP.woff2",
      ]);

      expect(exitCode).toBe(1);
      expect(io.stderr.join("")).toContain("Error: Invalid SceneDocument:");
    });
  });

  it("reports warnings count without --verbose", () => {
    const fixturesDir = resolve(__dirname, "../../core/tests/svg/fixtures");
    const inputPath = resolve(fixturesDir, "unsupported-props.svg");

    withTempDir((tempDir) => {
      const outputPath = join(tempDir, "card.tsx");

      const io = createTestIo({
        readTextFile: (path) => readFileSync(path, "utf-8"),
        writeTextFile: (path, data) => writeFileSync(path, data, "utf-8"),
      });

      runConvert(io, [
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--default-font",
        "NotoSansJP",
      ]);
      expect(io.stderr.join("")).toContain("warning(s) emitted");
    });
  });
});
