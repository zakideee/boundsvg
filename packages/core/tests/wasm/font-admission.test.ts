import { beforeAll, describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import { createWasmEngineInstance } from "../../src/wasm/index.js";
import { loadSubsetFont } from "./test-prerequisites.js";

beforeAll(async () => {
  await initNodeWasm();
});

describe("registered font admission", () => {
  it("preserves a typed WOFF2 decode failure and leaves the alias reusable", () => {
    const handle = createWasmEngineInstance();
    try {
      const malformedWoff2 = new Uint8Array(104);
      malformedWoff2.set([0x77, 0x4f, 0x46, 0x32]);
      expect(() => handle.registerFont(malformedWoff2, { alias: "Admitted" })).toThrowError(
        expect.objectContaining({
          code: "FONT_PARSE_FAILED",
          stage: "font",
          context: { operation: "registerFont", reason: "invalidData", faceIndex: 0 },
        }),
      );
      handle.registerFont(loadSubsetFont(), { alias: "Admitted" });
      const glyphs = handle.createShapeFnRegistered("Admitted")("A", {
        fontSizePx: 20,
        letterSpacingPx: 0,
      });
      expect(glyphs).toHaveLength(1);
      expect(glyphs[0]?.glyphId).toBeGreaterThan(0);
    } finally {
      handle.dispose();
    }
  });

  it("does not return a partial result when finite shaping inputs overflow", () => {
    const handle = createWasmEngineInstance();
    try {
      handle.registerFont(loadSubsetFont(), { alias: "Finite" });
      const shape = handle.createShapeFnRegistered("Finite");
      expect(() =>
        shape("AA", { fontSizePx: Number.MAX_VALUE, letterSpacingPx: Number.MAX_VALUE }),
      ).toThrowError(
        expect.objectContaining({
          code: "TEXT_SHAPING_FAILED",
          stage: "text",
          context: { operation: "shapeText", reason: "nonFiniteMetric" },
        }),
      );
      expect(shape("A", { fontSizePx: 20, letterSpacingPx: 0 })).toHaveLength(1);
    } finally {
      handle.dispose();
    }
  });

  it("keeps an unavailable alias distinct from a valid empty string", () => {
    const handle = createWasmEngineInstance();
    try {
      expect(() =>
        handle.createShapeFnRegistered("Absent")("A", { fontSizePx: 20, letterSpacingPx: 0 }),
      ).toThrowError(FatalError);
      handle.registerFont(loadSubsetFont(), { alias: "Present" });
      expect(
        handle.createShapeFnRegistered("Present")("", { fontSizePx: 20, letterSpacingPx: 0 }),
      ).toEqual([]);
    } finally {
      handle.dispose();
    }
  });

  it("rejects unavailable fallback chains and recovers when a font becomes available", () => {
    const handle = createWasmEngineInstance();
    try {
      for (const aliases of [[], [" ", ""], ["Absent"]]) {
        const shape = handle.createShapeFnRegisteredWithFallback(aliases);
        expect(() => shape("A", { fontSizePx: 20, letterSpacingPx: 0 })).toThrowError(
          expect.objectContaining({
            code: "TEXT_FONT_UNAVAILABLE",
            stage: "font",
            context: {
              operation: "shapeTextWithFallback",
              reason: "unregisteredFont",
              weight: 400,
            },
          }),
        );
      }
      handle.registerFont(loadSubsetFont(), { alias: "Available" });
      const shape = handle.createShapeFnRegisteredWithFallback(["Absent", "Available"]);
      expect(shape("A", { fontSizePx: 20, letterSpacingPx: 0 })[0]?.glyphId).toBeGreaterThan(0);
      expect(shape("", { fontSizePx: 20, letterSpacingPx: 0 })).toEqual([]);
    } finally {
      handle.dispose();
    }
  });

  it("reports synthetic missing-glyph transform overflow as an outline failure", () => {
    const handle = createWasmEngineInstance();
    try {
      handle.registerFont(loadSubsetFont(), { alias: "Finite" });
      expect(() =>
        handle.extractPositionedGlyphPaths([
          {
            glyphId: 0,
            fontAlias: "Finite",
            fontWeight: 400,
            fontStyle: "normal",
            fontSizePx: 20,
            originX: 100,
            originY: 80,
            rotationDeg: 0,
            writingMode: "horizontal-tb",
            inlineScale: Number.MAX_VALUE,
            baselineRotationDeg: 45,
            showMissingGlyphs: true,
          },
        ]),
      ).toThrowError(
        expect.objectContaining({
          code: "FONT_OUTLINE_FAILED",
          stage: "font",
        }),
      );
    } finally {
      handle.dispose();
    }
  });
  it("keeps typed shaping failures through all glyph path entry points", () => {
    const handle = createWasmEngineInstance();
    try {
      handle.registerFont(loadSubsetFont(), { alias: "Paths" });
      for (const fallback of [false, true]) {
        const extract = fallback
          ? handle.createGlyphPathFnWithFallback(["Paths"])
          : handle.createGlyphPathFn("Paths");
        for (const pathOptions of [undefined, { writingMode: "horizontal-tb" as const }]) {
          expect(() =>
            extract("AA", {
              fontSizePx: Number.MAX_VALUE,
              letterSpacingPx: Number.MAX_VALUE,
              baselineY: 40,
              startX: 0,
              pathOptions,
            }),
          ).toThrowError(
            expect.objectContaining({
              code: "TEXT_SHAPING_FAILED",
              stage: "text",
              context: { operation: "extractGlyphPaths", reason: "nonFiniteMetric" },
            }),
          );
          expect(
            extract("A", { fontSizePx: 20, letterSpacingPx: 0, baselineY: 40, startX: 0 }),
          ).not.toEqual([]);
        }
      }
    } finally {
      handle.dispose();
    }
  });

  it("rejects empty or unavailable glyph path fallback chains and permits valid empty text", () => {
    const handle = createWasmEngineInstance();
    const params = { fontSizePx: 20, letterSpacingPx: 0, baselineY: 40, startX: 0 };
    try {
      handle.registerFont(loadSubsetFont(), { alias: "Paths" });
      for (const aliases of [[], [" ", ""], ["Absent"]]) {
        expect(() => handle.createGlyphPathFnWithFallback(aliases)("A", params)).toThrowError(
          expect.objectContaining({
            code: "TEXT_FONT_UNAVAILABLE",
            stage: "font",
            context: { operation: "extractGlyphPaths", reason: "unregisteredFont", weight: 400 },
          }),
        );
      }
      const extract = handle.createGlyphPathFnWithFallback(["Absent", "Paths"]);
      expect(extract("A", params)).not.toEqual([]);
      expect(extract("", params)).toEqual([]);
    } finally {
      handle.dispose();
    }
  });

  it("checks disposal before rejecting an empty glyph path fallback chain", () => {
    const handle = createWasmEngineInstance();
    const extract = handle.createGlyphPathFnWithFallback([]);
    handle.dispose();
    expect(() =>
      extract("A", { fontSizePx: 20, letterSpacingPx: 0, baselineY: 40, startX: 0 }),
    ).toThrowError(expect.objectContaining({ code: "WASM_INSTANCE_DISPOSED", stage: "wasm" }));
  });
});
