import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli as runCliRaw } from "../src/index.js";

const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect x="0" y="0" width="240" height="120" fill="#101010" />
  <text x="24" y="68" font-size="32" fill="#ffffff">Hello</text>
</svg>`;

const FONT_PATH = fileURLToPath(
  new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url),
);

function runCli(overrides: Parameters<typeof runCliRaw>[0] = {}) {
  return runCliRaw({
    writeStdout: () => {},
    writeStderr: () => {},
    ...overrides,
  });
}

/**
 * Walk the GIF block structure, collecting Graphic Control Extension delays in
 * centiseconds and the Netscape loop count. A raw signature scan would also
 * match inside LZW image data.
 */
function readGifBlocks(gif: Buffer): { delaysCs: number[]; loopCount: number | undefined } {
  const skipSubBlocks = (start: number): number => {
    let cursor = start;
    while (cursor < gif.length) {
      const size = gif[cursor] ?? 0;
      cursor += 1 + size;
      if (size === 0) {
        break;
      }
    }
    return cursor;
  };

  const delaysCs: number[] = [];
  let loopCount: number | undefined;
  let offset = 13;
  const globalFlags = gif[10] ?? 0;
  if ((globalFlags & 0x80) !== 0) {
    offset += 3 * 2 ** ((globalFlags & 0x07) + 1);
  }
  while (offset < gif.length) {
    const marker = gif[offset];
    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      const label = gif[offset + 1];
      if (label === 0xf9) {
        delaysCs.push(gif.readUInt16LE(offset + 4));
      }
      if (
        label === 0xff &&
        gif.subarray(offset + 3, offset + 14).toString("ascii") === "NETSCAPE2.0"
      ) {
        // identifier (11) + sub-block size (1) + 0x01 (1) -> loop u16
        loopCount = gif.readUInt16LE(offset + 16);
      }
      offset = skipSubBlocks(offset + 2);
      continue;
    }
    if (marker === 0x2c) {
      const localFlags = gif[offset + 9] ?? 0;
      let imageOffset = offset + 10;
      if ((localFlags & 0x80) !== 0) {
        imageOffset += 3 * 2 ** ((localFlags & 0x07) + 1);
      }
      offset = skipSubBlocks(imageOffset + 1);
      continue;
    }
    break;
  }
  return { delaysCs, loopCount };
}

function readGifFrameDelaysCs(gif: Buffer): number[] {
  return readGifBlocks(gif).delaysCs;
}

function readGifLoopCount(gif: Buffer): number | undefined {
  return readGifBlocks(gif).loopCount;
}

/** Count ANMF chunks by walking the RIFF chunk list. */
function countAnmfChunks(webp: Buffer): number {
  let count = 0;
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const chunkId = webp.subarray(offset, offset + 4).toString("ascii");
    const payloadLength = webp.readUInt32LE(offset + 4);
    if (chunkId === "ANMF") {
      count += 1;
    }
    offset += 8 + payloadLength + (payloadLength % 2);
  }
  return count;
}

function withTempDir(run: (tempDir: string) => void): void {
  const tempDir = mkdtempSync(join(tmpdir(), "boundsvg-cli-"));
  try {
    run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function withTempDirAsync(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "boundsvg-cli-"));
  try {
    await run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function resolveResult(result: number | Promise<number>): Promise<number> {
  if (result instanceof Promise) {
    return result;
  }
  return result;
}

describe("CLI entrypoint integration", () => {
  it("returns zero when help is requested", async () => {
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", "--help"],
      }),
    );
    expect(exitCode).toBe(0);
  });

  it("returns zero when convert help is requested", async () => {
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", "convert", "--help"],
      }),
    );
    expect(exitCode).toBe(0);
  });

  it("returns zero when export help is requested", async () => {
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", "export", "--help"],
      }),
    );
    expect(exitCode).toBe(0);
  });

  it.each([
    "convert",
    "export",
    "inspect",
    "doctor",
  ])("returns zero when %s short help is requested", async (subcommand) => {
    const stderr: string[] = [];
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", subcommand, "-h"],
        writeStderr: (message) => stderr.push(message),
      }),
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain(`Usage: boundsvg ${subcommand}`);
  });

  it("routes doctor through real node WASM checks", async () => {
    const stdout: string[] = [];
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", "doctor"],
        writeStdout: (message) => stdout.push(message),
      }),
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("ok wasm: node WASM initialized");
    expect(stdout.join("")).toContain("ok png-scale:");
    expect(stdout.join("")).toContain("ok worker:");
  });

  it("returns non-zero for unknown subcommand", async () => {
    const stderr: string[] = [];
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", "unknown"],
        writeStderr: (message) => stderr.push(message),
      }),
    );
    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Unknown command: unknown");
  });

  it("routes convert subcommand and writes component output", async () => {
    withTempDir((tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.tsx");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = runCli({
        argv: [
          "node",
          "boundsvg",
          "convert",
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--default-font",
          "NotoSansJP",
        ],
        writeStdout: (message) => stdout.push(message),
        writeStderr: (message) => stderr.push(message),
      });

      // convert is synchronous
      expect(exitCode).toBe(0);
      expect(stdout.join("")).toContain(`Converted: ${resolve(outputPath)}`);

      const generated = readFileSync(outputPath, "utf-8");
      expect(generated).toContain("export default function Card");
      expect(generated).toContain("BoundSvgProvider");
      expect(stderr.join("")).not.toContain("Error:");
    });
  });

  it("accepts convert -d as the dynamic-text alias", async () => {
    withTempDir((tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "dynamic-card.tsx");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const exitCode = runCli({
        argv: [
          "node",
          "boundsvg",
          "convert",
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--default-font",
          "NotoSansJP",
          "-d",
          "0:title:Fallback",
        ],
      });

      expect(exitCode).toBe(0);
      const generated = readFileSync(outputPath, "utf-8");
      expect(generated).toContain("title?: string;");
      expect(generated).toContain('const title = props.title ?? "Fallback";');
      expect(generated).toContain("{title}");
      expect(generated).not.toContain("{props.title}");
    });
  });

  it("emits parseable JSON through inspect --output-format", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const stdout: string[] = [];

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "inspect",
            "--input",
            inputPath,
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--output-format",
            "json",
          ],
          writeStdout: (message) => stdout.push(message),
        }),
      );

      expect(exitCode).toBe(0);
      const inspection = JSON.parse(stdout.join(""));
      expect(inspection.stats).toMatchObject({ width: 240, height: 120 });
      expect(inspection.stats.nodeCount).toBeGreaterThan(0);
      expect(inspection.nodeIds.valid).toBe(true);
    });
  });

  it("emits identical inspection content through export --inspect and --report", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.rendered.svg");
      const reportPath = join(tempDir, "card.report.json");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const stderr: string[] = [];

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            outputPath,
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--format",
            "svg",
            "--inspect",
            "--report",
            reportPath,
          ],
          writeStderr: (message) => stderr.push(message),
        }),
      );

      expect(exitCode).toBe(0);
      expect(readFileSync(outputPath, "utf-8")).toContain("<svg");
      const report = readFileSync(reportPath, "utf-8");
      expect(JSON.parse(report).stats).toMatchObject({ width: 240, height: 120 });
      expect(stderr.join("").trim()).toBe(report.trim());
    });
  });

  it("applies export --scale to the rasterized PNG resolution", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.png");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            outputPath,
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--format",
            "png",
            "--scale",
            "3",
          ],
        }),
      );

      expect(exitCode).toBe(0);
      const png = readFileSync(outputPath);
      // IHDR is the first chunk: 8-byte signature + 8-byte chunk header,
      // then width and height as big-endian u32.
      expect(png.readUInt32BE(16)).toBe(240 * 3);
      expect(png.readUInt32BE(20)).toBe(120 * 3);
    });
  });

  it("exports a lossless still WebP", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.webp");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            outputPath,
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--format",
            "webp",
            "--scale",
            "1",
          ],
        }),
      );

      expect(exitCode).toBe(0);
      const webp = readFileSync(outputPath);
      expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(webp.subarray(12, 16).toString("ascii")).toBe("VP8L");
    });
  });

  it("exports an animated WebP and requires --duration-ms", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.webp");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const baseArgs = [
        "node",
        "boundsvg",
        "export",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--default-font",
        "NotoSansJP",
        "--font",
        `NotoSansJP:400:normal:${FONT_PATH}`,
        "--format",
        "animated-webp",
        "--scale",
        "1",
      ];

      const missingDuration: string[] = [];
      const missingExitCode = await resolveResult(
        runCli({ argv: baseArgs, writeStderr: (message) => missingDuration.push(message) }),
      );
      expect(missingExitCode).toBe(1);
      expect(missingDuration.join("")).toContain("--duration-ms is required");

      const exitCode = await resolveResult(
        runCli({ argv: [...baseArgs, "--duration-ms", "300", "--fps", "10"] }),
      );
      expect(exitCode).toBe(0);
      const webp = readFileSync(outputPath);
      // Extended container: an animated file leads with VP8X, not VP8L.
      expect(webp.subarray(12, 16).toString("ascii")).toBe("VP8X");
      expect(webp.subarray(30, 34).toString("ascii")).toBe("ANIM");
      // 300 ms at 10 fps is three frames — this is what pins --fps to the
      // encoder rather than only to the parsed options.
      expect(countAnmfChunks(webp)).toBe(3);
      // ANIM payload bytes 4-5 are the loop count; the chunk starts at 30.
      expect(webp.readUInt16LE(42)).toBe(0);
    });
  });

  it("writes real WebP bytes for a .webp output path without --format", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.webp");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            outputPath,
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--scale",
            "1",
          ],
        }),
      );

      expect(exitCode).toBe(0);
      const webp = readFileSync(outputPath);
      expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(webp.subarray(12, 16).toString("ascii")).toBe("VP8L");
    });
  });

  it("keeps --input=<file> out of stdin mode", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.webp");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      // Every flag in its `=value` form, with stdin not a TTY: the export must
      // still read the named file rather than switching to stdin and rendering
      // an empty canvas.
      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            `--input=${inputPath}`,
            `--output=${outputPath}`,
            "--default-font=NotoSansJP",
            `--font=NotoSansJP:400:normal:${FONT_PATH}`,
            "--format=webp",
            "--scale=1",
          ],
          stdinIsTTY: false,
          readStdin: () => "",
        }),
      );

      expect(exitCode).toBe(0);
      const webp = readFileSync(outputPath);
      expect(webp.subarray(12, 16).toString("ascii")).toBe("VP8L");
      // A 240x120 input; an empty stdin canvas would be 800x600.
      expect((webp.readUInt32LE(21) & 0x3fff) + 1).toBe(240);
    });
  });

  it("rejects a value on a boolean flag", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const stderr: string[] = [];

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            `--input=${inputPath}`,
            `--output=${join(tempDir, "card.svg")}`,
            "--default-font=NotoSansJP",
            `--font=NotoSansJP:400:normal:${FONT_PATH}`,
            "--dry-run=false",
          ],
          writeStderr: (message) => stderr.push(message),
        }),
      );

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain("--dry-run does not take a value");
    });
  });

  it("rejects an out-of-range --scale before initializing the engine", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const stderr: string[] = [];

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            join(tempDir, "card.webp"),
            "--default-font",
            "NotoSansJP",
            // A nonexistent font: if the scale check moved after engine setup,
            // the font failure would surface first.
            "--font",
            "NotoSansJP:400:normal:/nonexistent/font.ttf",
            "--format",
            "webp",
            "--scale",
            "9",
          ],
          writeStderr: (message) => stderr.push(message),
        }),
      );

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain("--scale must be a whole number between 1 and 4");
    });
  });

  it("passes --loop through to the animated WebP container", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.webp");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            outputPath,
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--format",
            "animated-webp",
            "--duration-ms",
            "200",
            "--fps",
            "10",
            "--loop",
            "3",
            "--scale",
            "1",
          ],
        }),
      );

      expect(exitCode).toBe(0);
      expect(readFileSync(outputPath).readUInt16LE(42)).toBe(3);
    });
  });

  it("applies --scale to WebP output", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.webp");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            outputPath,
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--format",
            "webp",
            "--scale",
            "3",
          ],
        }),
      );

      expect(exitCode).toBe(0);
      const webp = readFileSync(outputPath);
      // VP8L header: 0x2f signature at byte 20, then 14-bit width-1 LSB-first.
      expect(webp[20]).toBe(0x2f);
      expect((webp.readUInt32LE(21) & 0x3fff) + 1).toBe(240 * 3);
    });
  });

  it("exports an animated GIF and requires --duration-ms", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.gif");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const baseArgs = [
        "node",
        "boundsvg",
        "export",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--default-font",
        "NotoSansJP",
        "--font",
        `NotoSansJP:400:normal:${FONT_PATH}`,
        "--format",
        "gif",
        "--scale",
        "1",
      ];

      const missingDuration: string[] = [];
      const missingExitCode = await resolveResult(
        runCli({ argv: baseArgs, writeStderr: (message) => missingDuration.push(message) }),
      );
      expect(missingExitCode).toBe(1);
      expect(missingDuration.join("")).toContain("--duration-ms is required for gif export");

      const exitCode = await resolveResult(
        runCli({ argv: [...baseArgs, "--duration-ms", "300", "--fps", "10", "--loop", "2"] }),
      );
      expect(exitCode).toBe(0);
      const gif = readFileSync(outputPath);
      expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");
      // Logical screen size, two little-endian u16 after the signature.
      expect(gif.readUInt16LE(6)).toBe(240);
      expect(gif.readUInt16LE(8)).toBe(120);
      // Three 100 ms frames: one Graphic Control Extension each at 10 cs, and
      // the --loop the command passed must reach the Netscape block.
      expect(readGifFrameDelaysCs(gif)).toEqual([10, 10, 10]);
      expect(readGifLoopCount(gif)).toBe(2);
    });
  });

  it("rejects animation flags outside animated-webp export", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      for (const [flag, value] of [
        ["--fps", "10"],
        ["--loop", "2"],
        ["--duration-ms", "300"],
      ]) {
        const stderr: string[] = [];
        const exitCode = await resolveResult(
          runCli({
            argv: [
              "node",
              "boundsvg",
              "export",
              "--input",
              inputPath,
              "--output",
              join(tempDir, "card.png"),
              "--default-font",
              "NotoSansJP",
              "--font",
              `NotoSansJP:400:normal:${FONT_PATH}`,
              "--format",
              "png",
              flag ?? "",
              value ?? "",
            ],
            writeStderr: (message) => stderr.push(message),
          }),
        );
        expect(exitCode, flag).toBe(1);
        expect(stderr.join(""), flag).toContain(`${flag} only applies to an animated --format`);
      }
    });
  });

  it("rejects an out-of-range --fps before initializing the engine", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const stderr: string[] = [];

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            join(tempDir, "card.webp"),
            "--default-font",
            "NotoSansJP",
            "--font",
            "NotoSansJP:400:normal:/nonexistent/font.ttf",
            "--format",
            "animated-webp",
            "--duration-ms",
            "300",
            "--fps",
            "120",
          ],
          writeStderr: (message) => stderr.push(message),
        }),
      );

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain("--fps must be between 1 and 60");
    });
  });

  it("rejects --duration-ms outside animated-webp export", async () => {
    await withTempDirAsync(async (tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");
      const stderr: string[] = [];

      const exitCode = await resolveResult(
        runCli({
          argv: [
            "node",
            "boundsvg",
            "export",
            "--input",
            inputPath,
            "--output",
            join(tempDir, "card.webp"),
            "--default-font",
            "NotoSansJP",
            "--font",
            `NotoSansJP:400:normal:${FONT_PATH}`,
            "--format",
            "webp",
            "--duration-ms",
            "300",
          ],
          writeStderr: (message) => stderr.push(message),
        }),
      );

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain("--duration-ms only applies to");
    });
  });

  it("convert --format scene writes SceneDocument JSON", async () => {
    withTempDir((tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "card.scene.json");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const stdout: string[] = [];
      const exitCode = runCli({
        argv: [
          "node",
          "boundsvg",
          "convert",
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--default-font",
          "NotoSansJP",
          "--format",
          "scene",
        ],
        writeStdout: (message) => stdout.push(message),
      });

      expect(exitCode).toBe(0);
      expect(stdout.join("")).toContain(`Converted: ${resolve(outputPath)}`);

      const generated = readFileSync(outputPath, "utf-8");
      const scene = JSON.parse(generated);
      expect(scene.type).toBe("Canvas");
    });
  });

  it("returns non-zero when convert input file is missing", async () => {
    withTempDir((tempDir) => {
      const inputPath = join(tempDir, "missing.svg");
      const outputPath = join(tempDir, "card.tsx");

      const stderr: string[] = [];
      const exitCode = runCli({
        argv: [
          "node",
          "boundsvg",
          "convert",
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--default-font",
          "NotoSansJP",
        ],
        writeStderr: (message) => stderr.push(message),
      });

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain(`Error: Cannot read file "${resolve(inputPath)}"`);
    });
  });

  it("convert missing args reports error via io.writeStderr", async () => {
    const stderr: string[] = [];
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", "convert", "--input", "test.svg"],
        writeStderr: (message) => stderr.push(message),
      }),
    );

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Error: --default-font is required for SVG input");
  });

  it("converts scene.json to bound-component via convert subcommand", async () => {
    withTempDir((tempDir) => {
      // First create a scene.json
      const svgPath = join(tempDir, "card.svg");
      const scenePath = join(tempDir, "card.scene.json");
      writeFileSync(svgPath, SIMPLE_SVG, "utf-8");

      runCli({
        argv: [
          "node",
          "boundsvg",
          "convert",
          "--input",
          svgPath,
          "--output",
          scenePath,
          "--default-font",
          "NotoSansJP",
          "--format",
          "scene",
        ],
      });

      // Then convert scene.json to bound-component
      const outputPath = join(tempDir, "card.tsx");
      const stdout: string[] = [];
      const exitCode = runCli({
        argv: [
          "node",
          "boundsvg",
          "convert",
          "--input",
          scenePath,
          "--output",
          outputPath,
          "--font-source",
          "NotoSansJP:400:normal:/fonts/NotoSansJP.woff2",
        ],
        writeStdout: (message) => stdout.push(message),
      });

      expect(exitCode).toBe(0);
      expect(stdout.join("")).toContain(`Converted: ${resolve(outputPath)}`);

      const generated = readFileSync(outputPath, "utf-8");
      expect(generated).toContain("export default function Card");
      expect(generated).toContain("BoundSvgProvider");
    });
  });

  it("export missing args reports error via io.writeStderr", async () => {
    const stderr: string[] = [];
    const exitCode = await resolveResult(
      runCli({
        argv: ["node", "boundsvg", "export", "--input", "test.svg"],
        writeStderr: (message) => stderr.push(message),
      }),
    );

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Error: --default-font is required for SVG input");
  });

  it("returns non-zero when convert output path is not writable", async () => {
    withTempDir((tempDir) => {
      const inputPath = join(tempDir, "card.svg");
      const outputPath = join(tempDir, "missing-dir", "card.tsx");
      writeFileSync(inputPath, SIMPLE_SVG, "utf-8");

      const stderr: string[] = [];
      const exitCode = runCli({
        argv: [
          "node",
          "boundsvg",
          "convert",
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--default-font",
          "NotoSansJP",
        ],
        writeStderr: (message) => stderr.push(message),
      });

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain(`Error: Cannot write file "${resolve(outputPath)}"`);
    });
  });
});
