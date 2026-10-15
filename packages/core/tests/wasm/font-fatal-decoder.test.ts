import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { decodeWasmFontFatal, invokeWasmFont } from "../../src/wasm/font-fatal-decoder.js";
import { decodeWasmTextLayoutFatal } from "../../src/wasm/text-layout-fatal-decoder.js";

describe("font failure transport", () => {
  const catalog = [
    [
      "FONT_PARSE_FAILED",
      "Font parsing or admission failed.",
      "font",
      { reason: "invalidTable", table: "GSUB", faceIndex: 0 },
    ],
    [
      "FONT_OUTLINE_FAILED",
      "Font outline extraction failed.",
      "font",
      { reason: "drawingFailed", glyphId: 65534 },
    ],
    ["TEXT_SHAPING_FAILED", "Text shaping failed.", "text", { reason: "bufferPreparationFailed" }],
    [
      "TEXT_SHAPING_LIMIT_EXCEEDED",
      "The shaping buffer failed during processing.",
      "text",
      { reason: "bufferFailedDuringShaping" },
    ],
    [
      "TEXT_SHAPING_INVALID_OUTPUT",
      "The shaper returned invalid glyph data.",
      "text",
      { reason: "invalidCluster", glyphIndex: 1 },
    ],
  ] as const;

  it.each(
    catalog,
  )("preserves %s at direct font and measurement boundaries", (code, message, stage, details) => {
    const direct = JSON.stringify({
      severity: "fatal",
      code,
      message,
      stage,
      context: { operation: "shapeText", ...details },
    });
    const decoded = decodeWasmFontFatal(direct, "shapeText");
    expect(decoded).toBeInstanceOf(FatalError);
    expect(decoded?.toJSON()).toEqual(JSON.parse(direct));
    expect(() =>
      invokeWasmFont("shapeText", () => {
        throw direct;
      }),
    ).toThrowError(
      expect.objectContaining({ code, stage, context: { operation: "shapeText", ...details } }),
    );
    const measurement = JSON.stringify({
      severity: "fatal",
      code,
      message,
      stage,
      context: { operation: "measureTextBlock", ...details },
    });
    expect(decodeWasmTextLayoutFatal(measurement, "measureTextBlock")?.code).toBe(code);
  });

  it("rejects wrong operations, invalid counts, unknown reasons and extra fields", () => {
    const envelope = {
      severity: "fatal",
      code: "FONT_PARSE_FAILED",
      message: "Font parsing or admission failed.",
      stage: "font",
      context: { operation: "registerFont", reason: "invalidTable", table: "GSUB", faceIndex: 0 },
    };
    expect(decodeWasmFontFatal(JSON.stringify(envelope), "shapeText")).toBeUndefined();
    for (const patch of [
      { faceIndex: -1 },
      { faceIndex: 0x1_0000_0000 },
      { reason: "madeUp" },
      { table: "/host/font.ttf" },
      { bytes: [0, 1] },
    ]) {
      expect(
        decodeWasmFontFatal(
          JSON.stringify({ ...envelope, context: { ...envelope.context, ...patch } }),
          "registerFont",
        ),
      ).toBeUndefined();
    }
    for (const input of [
      "unstructured failure",
      "x".repeat(8193),
      null,
      new Error("native transport"),
    ]) {
      expect(decodeWasmFontFatal(input, "registerFont")).toBeUndefined();
    }
  });

  it("turns unknown native failures into a typed boundary failure", () => {
    expect(() =>
      invokeWasmFont("registerFont", () => {
        throw "bad font";
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "WASM_FONT_FAILED",
        stage: "wasm",
        context: { operation: "registerFont" },
      }),
    );
  });
});
