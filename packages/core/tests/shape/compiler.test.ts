import { beforeAll, describe, expect, it } from "vitest";
import { initNodeWasm } from "../../src/node.js";
import {
  compileGeometryToSvgDocument,
  computeGeometryIntersections,
  divideGeometryRegions,
  transformToSvg,
} from "../../src/shape/compiler.js";
import { assertWasmPkgAvailable } from "../wasm/test-prerequisites.js";

describe("shape compiler", () => {
  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
  });

  it("emits scaleX-only transforms without stretching y", () => {
    expect(transformToSvg({ scaleX: 2 })).toBe("scale(2 1)");
  });

  it("emits scaleY-only transforms without stretching x", () => {
    expect(transformToSvg({ scaleY: 3 })).toBe("scale(1 3)");
  });

  it("compiles subtract path-only geometry into a single compound path", () => {
    const svg = compileGeometryToSvgDocument({
      viewBox: { width: 120, height: 120 },
      root: {
        kind: "boolean",
        op: "subtract",
        children: [
          { kind: "path", d: "M0 0H120V120H0Z" },
          { kind: "path", d: "M80 20Q80 40 60 40Q40 40 40 20Z" },
        ],
      },
    });

    // Boolean evaluation flattens curves for topological robustness, then
    // re-fits smooth runs back to compact cubics: the rect boundary
    // stays exact lines and the curved hole comes back as a few C segments,
    // not a dense polyline or a chord-collapsed diamond.
    expect(svg).toContain('<path d="M0,0L120,0L120,120L0,120Z M40,20');
    const pathData = /<path d="([^"]*)"/.exec(svg)?.[1] ?? "";
    const holeData = pathData.split(" M")[1] ?? "";
    expect(holeData).toContain("C");
    expect((holeData.match(/[LC]/g) ?? []).length).toBeLessThan(10);
    expect(svg).not.toContain("clip-path=");
  });

  it("compiles xor path-only geometry into a single even-odd path", () => {
    const svg = compileGeometryToSvgDocument({
      viewBox: { width: 140, height: 120 },
      root: {
        kind: "boolean",
        op: "xor",
        children: [
          {
            kind: "path",
            d: "M60 60C60 93.137 33.137 120 0 120C-33.137 120 -60 93.137 -60 60C-60 26.863 -33.137 0 0 0C33.137 0 60 26.863 60 60Z",
          },
          {
            kind: "path",
            d: "M140 60C140 93.137 113.137 120 80 120C46.863 120 20 93.137 20 60C20 26.863 46.863 0 80 0C113.137 0 140 26.863 140 60Z",
          },
        ],
      },
    });

    expect(svg).toContain("<path d=");
    expect(svg).not.toContain('fill-rule="evenodd"');
  });

  it("bakes viewport scaling into H/V path coordinates", () => {
    const svg = compileGeometryToSvgDocument(
      {
        viewBox: { width: 200, height: 120 },
        root: {
          kind: "path",
          d: "M16 0H184V80H16Z",
        },
      },
      {
        viewport: { width: 400, height: 240 },
      },
    );

    expect(svg).toContain('viewBox="0 0 400 240"');
    expect(svg).toContain('d="M32,0L368,0L368,160L32,160Z"');
  });

  it("normalizes relative and arc path commands through the WASM parser", () => {
    const svg = compileGeometryToSvgDocument({
      viewBox: { width: 120, height: 120 },
      root: {
        kind: "path",
        d: "m80 20a20 20 0 1 1 -40 0z",
      },
    });

    expect(svg).toContain("<path d=");
    expect(svg).toContain("C");
  });

  it("queries intersections between closed geometries", () => {
    const intersections = computeGeometryIntersections(
      {
        viewBox: { width: 120, height: 120 },
        root: { kind: "path", d: "M10 60L60 10L110 60L60 110Z" },
      },
      {
        viewBox: { width: 120, height: 120 },
        root: { kind: "path", d: "M45 15H105V75H45Z" },
      },
    );

    expect(intersections.length).toBeGreaterThan(0);
    expect(intersections[0]?.contourIndexA).toBe(0);
    expect(intersections[0]?.contourIndexB).toBe(0);
  });

  it("divides two geometries into subtract and intersection regions", () => {
    const regions = divideGeometryRegions(
      {
        viewBox: { width: 100, height: 100 },
        root: { kind: "path", d: "M0 0H100V100H0Z" },
      },
      {
        viewBox: { width: 100, height: 100 },
        root: { kind: "path", d: "M25 25H75V75H25Z" },
      },
    );

    expect(regions.subtract.contours).toHaveLength(2);
    expect(regions.intersect.contours).toHaveLength(1);
    expect(regions.intersect.contours[0]!.segments).toHaveLength(4);
  });
});
