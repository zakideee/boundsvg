import { readFileSync } from "node:fs";
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

  it("reports the stable text-layout code and message from the render observer", async () => {
    const io = createTestIo({
      readBinaryFile: () =>
        new Uint8Array(
          readFileSync(
            new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url),
          ),
        ),
      readTextFile: () =>
        JSON.stringify({
          type: "Canvas",
          width: 100,
          height: 50,
          children: [
            {
              type: "Text",
              id: "missing-text",
              font: "Missing",
              fontSizePx: 16,
              children: ["abc"],
            },
          ],
        }),
    });

    const exitCode = await runExport(io, [
      "--input",
      "missing.scene.json",
      "--output",
      "-",
      "--format",
      "svg",
      "--font",
      "NotoSansJP:400:normal:fixture.ttf",
    ]);

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain(
      "Error: SVG rendering failed: [TEXT_FONT_UNAVAILABLE] No requested font is available for text layout.",
    );
  });

  it("reports the stable Shape code and message from the render observer", async () => {
    const io = createTestIo({
      readBinaryFile: () =>
        new Uint8Array(
          readFileSync(
            new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url),
          ),
        ),
      readTextFile: () =>
        JSON.stringify({
          type: "Canvas",
          width: 100,
          height: 50,
          children: [
            {
              type: "Shape",
              id: "invalid-shape",
              width: 50,
              height: 50,
              geometry: {
                viewBox: { width: 10, height: 10 },
                root: { kind: "path", d: "M0 0L" },
              },
            },
          ],
        }),
    });

    const exitCode = await runExport(io, [
      "--input",
      "invalid.scene.json",
      "--output",
      "-",
      "--format",
      "svg",
      "--font",
      "NotoSansJP:400:normal:fixture.ttf",
    ]);

    expect(exitCode).toBe(1);
    expect(io.stderr.join("")).toContain(
      "Error: SVG rendering failed: [SHAPE_PATH_DATA_INVALID] Shape path data is invalid.",
    );
  });
});
