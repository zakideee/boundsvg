import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initNodeWasm } from "../../src/node.js";
import { parsePathBBox } from "../../src/path/utils.js";
import {
  createWasmEngineInstance,
  type PositionedGlyphPathRequest,
  type WasmEngineHandle,
} from "../../src/wasm/index.js";
import {
  assertWasmPkgAvailable,
  loadInterVariableFont,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

const ANGLES = [-179, -90, -45, 0, 45, 90, 179] as const;

function hashPath(pathData: string): string {
  return createHash("sha256").update(pathData).digest("hex").slice(0, 16);
}

function pathFixture(pathData: string): {
  hash: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
} {
  const bbox = parsePathBBox(pathData);
  if (!bbox) {
    throw new Error("expected a parseable glyph path");
  }
  return { hash: hashPath(pathData), bbox };
}

describe("baseline glyph rotation", () => {
  let handle: WasmEngineHandle;
  let notoGlyphId: number;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    handle = createWasmEngineInstance();
    handle.registerFont(loadSubsetFont(), { alias: "Noto", weight: 400, style: "normal" });
    handle.registerFont(loadJetBrainsMonoFont(), {
      alias: "JetBrains",
      weight: 400,
      style: "normal",
    });
    handle.registerFont(loadInterVariableFont(), {
      alias: "Inter",
      weight: 400,
      style: "normal",
    });
    notoGlyphId = handle.createShapeFnRegistered("Noto")("A", {
      fontSizePx: 48,
      letterSpacingPx: 0,
    })[0]!.glyphId;
  });

  afterAll(() => {
    handle.dispose();
  });

  function notoRequest(
    baselineRotationDeg?: number,
    overrides: Partial<PositionedGlyphPathRequest> = {},
  ): PositionedGlyphPathRequest {
    return {
      glyphId: notoGlyphId,
      text: "A",
      fontSizePx: 48,
      originX: 100,
      originY: 120,
      rotationDeg: 0,
      ...(baselineRotationDeg !== undefined && { baselineRotationDeg }),
      writingMode: "horizontal-tb",
      fontAlias: "Noto",
      fontWeight: 400,
      fontStyle: "normal",
      ...overrides,
    };
  }

  it("keeps absent and zero rotations byte-identical in horizontal and vertical modes", () => {
    for (const overrides of [{}, { rotationDeg: 90, writingMode: "vertical-rl" as const }]) {
      const absent = handle.extractPositionedGlyphPaths([notoRequest(undefined, overrides)])[0]!;
      const zero = handle.extractPositionedGlyphPaths([notoRequest(0, overrides)])[0]!;
      expect(zero.d).toBe(absent.d);
    }
  });

  it("matches deterministic outline and bbox fixtures at representative angles", () => {
    const fixtures = ANGLES.map((baselineRotationDeg) => {
      const path = handle.extractPositionedGlyphPaths([notoRequest(baselineRotationDeg)])[0]!;
      return { angle: baselineRotationDeg, ...pathFixture(path.d) };
    });

    expect(fixtures).toEqual([
      {
        angle: -179,
        hash: "d6d93234af8d4378",
        bbox: { minX: 71.01, minY: 119.49, maxX: 99.81, maxY: 154.97 },
      },
      {
        angle: -90,
        hash: "525a4c836b6ddf12",
        bbox: { minX: 64.82, minY: 91.01, maxX: 100, maxY: 119.81 },
      },
      {
        angle: -45,
        hash: "c47efea18b72907c",
        bbox: { minX: 83.67, minY: 83.07, maxX: 120.5, maxY: 119.86 },
      },
      {
        angle: 0,
        hash: "99bfaabd8cb1d40f",
        bbox: { minX: 100.19, minY: 84.82, maxX: 128.99, maxY: 120 },
      },
      {
        angle: 45,
        hash: "a3896f2f56617afc",
        bbox: { minX: 100.14, minY: 103.67, maxX: 136.93, maxY: 140.5 },
      },
      {
        angle: 90,
        hash: "181f18e3484c6577",
        bbox: { minX: 100, minY: 120.19, maxX: 135.18, maxY: 148.99 },
      },
      {
        angle: 179,
        hash: "2d4484bced3148b6",
        bbox: { minX: 71.01, minY: 120, maxX: 99.81, maxY: 155.48 },
      },
    ]);
  });

  it("rotates synthetic tofu with the same affine path and keeps its bbox finite", () => {
    const path = handle.extractPositionedGlyphPaths([
      notoRequest(45, { glyphId: 0, text: "\u{10ffff}", showMissingGlyphs: true }),
    ])[0]!;
    const fixture = pathFixture(path.d);

    expect(path.d.match(/M/g)).toHaveLength(3);
    expect(fixture).toEqual({
      hash: "a37d6b1ddb1c4976",
      bbox: { minX: 104.07, minY: 98.28, maxX: 155.66, maxY: 149.87 },
    });
    expect(Object.values(fixture.bbox).every(Number.isFinite)).toBe(true);
  });

  it("applies rotation to variable-font outlines", () => {
    const shapeWithVariations = handle.createShapeWithVariationsFn("Inter");
    expect(shapeWithVariations).not.toBeNull();
    const glyphId = shapeWithVariations!("H", {
      fontSizePx: 48,
      letterSpacingPx: 0,
      variationsJson: "[]",
    })[0]!.glyphId;
    const request: PositionedGlyphPathRequest = {
      glyphId,
      text: "H",
      fontSizePx: 48,
      originX: 100,
      originY: 120,
      rotationDeg: 0,
      baselineRotationDeg: 45,
      writingMode: "horizontal-tb",
      fontAlias: "Inter",
      fontWeight: 400,
      fontStyle: "normal",
    };
    const regular = handle.extractPositionedGlyphPaths([request])[0]!;
    const bold = handle.extractPositionedGlyphPaths([
      { ...request, fontVariationSettings: '"wght" 900' },
    ])[0]!;

    expect(hashPath(regular.d)).not.toBe(hashPath(bold.d));
    expect([pathFixture(regular.d), pathFixture(bold.d)]).toEqual([
      {
        hash: "d9ee3a21e1af9742",
        bbox: { minX: 102.98, minY: 98.29, maxX: 146.93, maxY: 142.24 },
      },
      {
        hash: "45de6253a3eea24e",
        bbox: { minX: 101.59, minY: 96.9, maxX: 148.56, maxY: 143.86 },
      },
    ]);
  });

  it("extracts rotated outlines from every resolved font fallback", () => {
    const glyphs = handle.createShapeFnRegisteredWithFallback(["JetBrains", "Noto"])("A\u65e5", {
      fontSizePx: 48,
      letterSpacingPx: 0,
    });
    let originX = 20;
    const requests: PositionedGlyphPathRequest[] = glyphs.map((glyph) => {
      const request: PositionedGlyphPathRequest = {
        glyphId: glyph.glyphId,
        fontSizePx: 48,
        originX,
        originY: 80,
        rotationDeg: glyph.rotationDeg ?? 0,
        baselineRotationDeg: -45,
        writingMode: "horizontal-tb",
        fontAlias: glyph.fontAlias ?? "",
        fontWeight: glyph.fontWeight ?? 400,
        fontStyle: glyph.fontStyle ?? "normal",
      };
      originX += glyph.xAdvance;
      return request;
    });

    expect(requests.map((request) => request.fontAlias)).toEqual(["JetBrains", "Noto"]);
    const paths = handle.extractPositionedGlyphPaths(requests);
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.d.length > 0)).toBe(true);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects non-finite rotation %s before JSON serialization", (baselineRotationDeg) => {
    expect(() =>
      handle.extractPositionedGlyphPaths([notoRequest(baselineRotationDeg)]),
    ).toThrowError(/baselineRotationDeg must be finite/);
  });

  it("applies inline scaling to native outlines before baseline rotation", () => {
    const natural = handle.extractPositionedGlyphPaths([notoRequest(45)])[0]!;
    const scaled = handle.extractPositionedGlyphPaths([notoRequest(45, { inlineScale: 2 })])[0]!;

    expect(scaled.d).not.toBe(natural.d);
    expect(pathFixture(scaled.d).bbox).not.toEqual(pathFixture(natural.d).bbox);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid inline scale %s before JSON serialization", (inlineScale) => {
    expect(() =>
      handle.extractPositionedGlyphPaths([notoRequest(undefined, { inlineScale })]),
    ).toThrowError(/inlineScale must be positive and finite/);
  });

  it("normalizes a very large finite rotation before converting to radians", () => {
    const path = handle.extractPositionedGlyphPaths([notoRequest(Number.MAX_VALUE)])[0]!;
    const bbox = pathFixture(path.d).bbox;

    expect(Object.values(bbox).every(Number.isFinite)).toBe(true);
    expect(path.d).not.toMatch(/NaN|inf/i);
  });
});
