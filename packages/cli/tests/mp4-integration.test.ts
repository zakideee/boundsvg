import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExport } from "../src/export.js";
import { probeFfmpeg, resolveFfmpegCommand } from "../src/ffmpeg-locator.js";
import type { CliIo } from "../src/types.js";

/**
 * The one suite that runs a real ffmpeg.
 *
 * Everything else pins the argument list without executing it, which cannot
 * catch a flag ffmpeg rejects or an argument order it reads differently than
 * intended. Skipped where ffmpeg is absent — it is the user's to install, so a
 * machine without one is not a broken machine.
 */

const HAS_FFMPEG = probeFfmpeg(resolveFfmpegCommand());
const FONT_PATH = fileURLToPath(
  new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url),
);

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" width="61" height="33">
  <rect width="61" height="33" fill="#ffffff"/>
  <text x="4" y="20" font-family="NotoSansJP" font-size="12" fill="#111111">mp4</text>
</svg>
`;

function createTestIo(overrides: Partial<CliIo> = {}): CliIo & { stderr: string[] } {
  const stderr: string[] = [];
  return {
    argv: [],
    readTextFile: (path) => readFileSync(path, "utf8"),
    readBinaryFile: (path) => new Uint8Array(readFileSync(path)),
    // The encoded file goes out through CliIo like every other format, so the
    // test double has to actually write it for the assertions to see anything.
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
    writeTextFile: () => {},
    writeBinaryFile: (path, data) => writeFileSync(path, data),
    writeStdout: () => {},
    writeStderr: (message) => stderr.push(message),
    fileExists: () => true,
    readStdin: () => "",
    writeBinaryStdout: () => {},
    stdinIsTTY: true,
    watchFiles: () => ({ close: () => {} }),
    stderr,
    ...overrides,
  };
}

let workDir: string;
let inputPath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "boundsvg-mp4-"));
  inputPath = join(workDir, "scene.svg");
  writeFileSync(inputPath, SCENE);
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function exportArgs(outputPath: string, extra: string[], input = inputPath): string[] {
  return [
    "--input",
    input,
    "--output",
    outputPath,
    "--default-font",
    "NotoSansJP",
    "--font",
    `NotoSansJP:400:normal:${FONT_PATH}`,
    "--format",
    "mp4",
    ...extra,
  ];
}

describe.skipIf(!HAS_FFMPEG)("mp4 export through a real ffmpeg", () => {
  it("reports an encoder that consumed every frame and wrote nothing", async () => {
    // A stand-in that reads the whole stream and exits 0 without producing a
    // file. Reading the scratch path then fails, and that has to be reported as
    // an encoder failure rather than escaping as a raw ENOENT.
    const stubPath = join(workDir, "silent-ffmpeg");
    writeFileSync(stubPath, "#!/bin/sh\ncat > /dev/null\nexit 0\n");
    chmodSync(stubPath, 0o755);

    const previous = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = stubPath;
    try {
      const io = createTestIo();
      const exitCode = await runExport(
        io,
        exportArgs(join(workDir, "silent.mp4"), ["--duration-ms", "100"]),
      );

      expect(exitCode).toBe(1);
      expect(io.stderr.join("")).toContain("without writing a file");
      expect(io.stderr.join("")).not.toContain("ENOENT");
    } finally {
      if (previous === undefined) {
        delete process.env.FFMPEG_PATH;
      } else {
        process.env.FFMPEG_PATH = previous;
      }
    }
  });

  it("survives a destination directory it cannot create", async () => {
    // watch mode calls this writer fire-and-forget, so a throw escaping it
    // takes the watcher down rather than failing one export.
    const io = createTestIo({
      ensureDir: () => {
        throw new Error("ENOTDIR: not a directory");
      },
    });
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "nodir.mp4"), ["--duration-ms", "100"]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("Cannot write file");
    expect(io.stderr.join("")).not.toContain("ENOTDIR");
  });

  it("reports a destination it cannot write", async () => {
    const io = createTestIo({
      writeBinaryFile: () => {
        throw new Error("read-only volume");
      },
    });
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "unwritable.mp4"), ["--duration-ms", "100"]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("Cannot write file");
  });

  it("leaves an existing export untouched when a run fails", async () => {
    // A failed re-export must not take the previous good file with it.
    const outputPath = join(workDir, "keep.mp4");
    const io = createTestIo();
    await runExport(io, exportArgs(outputPath, ["--duration-ms", "100"]));
    const before = readFileSync(outputPath);
    expect(before.byteLength).toBeGreaterThan(0);

    const failing = createTestIo({
      writeBinaryFile: () => {
        throw new Error("write refused");
      },
    });
    const exitCode = await runExport(failing, exportArgs(outputPath, ["--duration-ms", "100"]));

    expect(exitCode).toBe(1);
    expect(readFileSync(outputPath)).toEqual(before);
  });

  it("forwards recoverable render warnings to stderr", async () => {
    // Exports used to report success while dropping glyphs with no trace.
    const missingGlyphPath = join(workDir, "missing-glyph.svg");
    writeFileSync(
      missingGlyphPath,
      `<svg xmlns="http://www.w3.org/2000/svg" width="61" height="33">
  <rect width="61" height="33" fill="#ffffff"/>
  <text x="4" y="20" font-family="NotoSansJP" font-size="12">\u2603</text>
</svg>
`,
    );
    const io = createTestIo();

    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "warned.mp4"), ["--duration-ms", "100"], missingGlyphPath),
    );

    expect(exitCode).toBe(0);
    expect(io.stderr.join("")).toContain("MISSING_GLYPH");
  });

  it("leaves the destination untouched under --dry-run", async () => {
    // ffmpeg writes the file itself, so a dry run has to keep it away from the
    // destination rather than trusting the writer not to.
    const outputPath = join(workDir, "dry.mp4");
    const io = createTestIo({ fileExists: () => false });

    const exitCode = await runExport(
      io,
      exportArgs(outputPath, ["--duration-ms", "100", "--dry-run"]),
    );

    expect(exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(false);
    expect(io.stderr.join("")).toContain("[new]");
  });

  it("creates nothing at the destination when the encode fails", async () => {
    const outputPath = join(workDir, "never.mp4");
    const io = createTestIo({
      writeBinaryFile: () => {
        throw new Error("write refused");
      },
    });

    const exitCode = await runExport(io, exportArgs(outputPath, ["--duration-ms", "100"]));

    expect(exitCode).toBe(1);
    expect(existsSync(outputPath)).toBe(false);
  });
});

describe("mp4 export flag validation", () => {
  it("requires a duration", async () => {
    const io = createTestIo();
    const exitCode = await runExport(io, exportArgs(join(workDir, "x.mp4"), []));

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("--duration-ms is required for mp4 export");
  });

  it("refuses a decimal frame rate no rational expresses", async () => {
    const io = createTestIo();
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "100", "--fps", "29.5"]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("--fps for mp4 must be");
  });

  it("refuses --iterations, which video has no play-count field", async () => {
    const io = createTestIo();
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "100", "--iterations", "3"]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("--iterations does not apply to mp4 export");
  });

  it("refuses a request past the frame ceiling", async () => {
    const io = createTestIo();
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "200000", "--fps", "60"]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("the limit is 3600");
  });

  it("refuses stdout output, which cannot be seeked for faststart", async () => {
    const io = createTestIo();
    const exitCode = await runExport(io, exportArgs("-", ["--duration-ms", "100"]));

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("mp4 export does not support stdout output");
  });

  it("refuses a bitrate that looks like a flag before it is even a number", async () => {
    // A leading dash is a flag, not a negative number, and the shared numeric
    // reader says so first.
    const io = createTestIo();
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "100", "--bitrate", "-1"]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("--bitrate needs a valid value");
  });

  it.each(["0", "1.5"])("refuses the unusable bitrate %s", async (bitrate) => {
    const io = createTestIo();
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "100", "--bitrate", bitrate]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("--bitrate must be a whole number");
  });

  it("refuses a bitrate above the ceiling", async () => {
    const io = createTestIo();
    const exitCode = await runExport(
      io,
      exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "100", "--bitrate", "50000001"]),
    );

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("between 1 and 50000000");
  });

  it.each([
    "gif",
    "animated-webp",
  ])("refuses --bitrate for %s, which has no bitrate control", async (format) => {
    // Accepting it and ignoring it would look like it took effect.
    const io = createTestIo();
    const exitCode = await runExport(io, [
      "--input",
      inputPath,
      "--output",
      join(workDir, `x.${format === "gif" ? "gif" : "webp"}`),
      "--default-font",
      "NotoSansJP",
      "--font",
      `NotoSansJP:400:normal:${FONT_PATH}`,
      "--format",
      format,
      "--duration-ms",
      "200",
      "--bitrate",
      "500",
    ]);

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain(`--bitrate does not apply to ${format} export`);
  });

  it("selects mp4 from an .mp4 output path without --format", async () => {
    // Otherwise the path quietly receives SVG text.
    const outputPath = join(workDir, "inferred.mp4");
    const io = createTestIo();
    const exitCode = await runExport(io, [
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--default-font",
      "NotoSansJP",
      "--font",
      `NotoSansJP:400:normal:${FONT_PATH}`,
      "--duration-ms",
      "100",
    ]);

    expect(exitCode).toBe(HAS_FFMPEG ? 0 : 1);
    if (HAS_FFMPEG) {
      expect(readFileSync(outputPath).subarray(4, 8).toString("latin1")).toBe("ftyp");
    }
  });

  it("names the failure code when ffmpeg is missing", async () => {
    const previous = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = join(workDir, "definitely-not-ffmpeg");
    try {
      const io = createTestIo();
      await runExport(io, exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "100"]));
      expect(io.stderr.join("")).toContain("FFMPEG_NOT_FOUND");
    } finally {
      if (previous === undefined) {
        delete process.env.FFMPEG_PATH;
      } else {
        process.env.FFMPEG_PATH = previous;
      }
    }
  });

  it("refuses --bitrate for a format that has no encoder to give it to", async () => {
    const io = createTestIo();
    const exitCode = await runExport(io, [
      "--input",
      inputPath,
      "--output",
      join(workDir, "x.png"),
      "--default-font",
      "NotoSansJP",
      "--font",
      `NotoSansJP:400:normal:${FONT_PATH}`,
      "--format",
      "png",
      "--bitrate",
      "500",
    ]);

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("--bitrate only applies to an animated --format");
  });

  it("keeps the rational --fps spelling out of gif, which never took one", async () => {
    // Order-independent: --fps is parsed before --format is known.
    const io = createTestIo();
    const exitCode = await runExport(io, [
      "--fps",
      "30/1",
      "--input",
      inputPath,
      "--output",
      join(workDir, "x.gif"),
      "--default-font",
      "NotoSansJP",
      "--font",
      `NotoSansJP:400:normal:${FONT_PATH}`,
      "--format",
      "gif",
      "--duration-ms",
      "200",
    ]);

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("--fps for gif must be a number");
  });

  it("reports a missing ffmpeg with installation guidance", async () => {
    // FFMPEG_PATH pointing at nothing is the same failure as having no ffmpeg,
    // and is the only way to reach that path on a machine that has one.
    const previous = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = join(workDir, "definitely-not-ffmpeg");
    try {
      const io = createTestIo();
      const exitCode = await runExport(
        io,
        exportArgs(join(workDir, "x.mp4"), ["--duration-ms", "100"]),
      );

      expect(exitCode).toBe(1);
      expect(io.stderr.join("")).toContain("ffmpeg not found");
      expect(io.stderr.join("")).toContain("brew install ffmpeg");
    } finally {
      if (previous === undefined) {
        delete process.env.FFMPEG_PATH;
      } else {
        process.env.FFMPEG_PATH = previous;
      }
    }
  });
});
