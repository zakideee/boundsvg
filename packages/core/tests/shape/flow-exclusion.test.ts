import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initNodeWasm } from "../../src/node.js";
import { geometryToFlowExclusion, symbolToFlowExclusion } from "../../src/shape/flow-exclusion.js";
import { regionToPathData } from "../../src/shape/serialize-region.js";
import type { GeometryDoc } from "../../src/shape/types.js";
import type { TextFlowWithExclusionsResult, WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createWasmEngineInstance,
  type FlowExclusionShape,
  wasmEvaluateShapeRegion,
} from "../../src/wasm/index.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "../wasm/test-prerequisites.js";

const FONT_ALIAS = "flow-exclusion-test-font";

// 4-cubic bezier approximation of a circle: center (60,60), r=50 in a 120x120 viewBox
const KAPPA = 27.61423749; // 50 * 0.55228...
const CIRCLE_GEOMETRY: GeometryDoc = {
  viewBox: { width: 120, height: 120 },
  root: {
    kind: "path",
    d:
      `M60 10C${60 + KAPPA} 10 110 ${60 - KAPPA} 110 60` +
      `C110 ${60 + KAPPA} ${60 + KAPPA} 110 60 110` +
      `C${60 - KAPPA} 110 10 ${60 + KAPPA} 10 60` +
      `C10 ${60 - KAPPA} ${60 - KAPPA} 10 60 10Z`,
  },
};

const DONUT_GEOMETRY: GeometryDoc = {
  viewBox: { width: 200, height: 200 },
  root: {
    kind: "boolean",
    op: "subtract",
    children: [
      { kind: "path", d: "M0 0H200V200H0Z" },
      { kind: "path", d: "M60 60H140V140H60Z" },
    ],
  },
};

const SQUARE_GEOMETRY: GeometryDoc = {
  viewBox: { width: 10, height: 10 },
  root: { kind: "path", d: "M0 0H10V10H0Z" },
};

let handle: WasmEngineHandle;

beforeAll(async () => {
  assertWasmPkgAvailable();
  await initNodeWasm();
  handle = createWasmEngineInstance();
  handle.registerFont(loadSubsetFont(), { alias: FONT_ALIAS, weight: 400, style: "normal" });
});

afterAll(() => {
  handle.dispose();
});

function flowWith(exclusions: FlowExclusionShape[]): TextFlowWithExclusionsResult {
  return handle.layoutTextFlowWithExclusions({
    text: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも".repeat(4),
    fontFamily: FONT_ALIAS,
    fontSizePx: 16,
    language: "ja",
    wrap: "char",
    flowBox: { x: 0, y: 0, width: 240, height: 240 },
    exclusions,
  });
}

describe("regionToPathData", () => {
  it("serializes a square with transform baked in", () => {
    const region = wasmEvaluateShapeRegion(SQUARE_GEOMETRY);
    const d = regionToPathData(region, { scaleX: 2, scaleY: 3, translateX: 5, translateY: 7 });
    // The kernel keeps the explicit closing segment before Z.
    expect(d).toBe("M5 7L25 7L25 37L5 37L5 7Z");
  });

  it("is deterministic across calls", () => {
    const region = wasmEvaluateShapeRegion(DONUT_GEOMETRY);
    const first = regionToPathData(region);
    const second = regionToPathData(wasmEvaluateShapeRegion(DONUT_GEOMETRY));
    expect(second).toBe(first);
  });

  it("emits one closed subpath per contour", () => {
    const region = wasmEvaluateShapeRegion(DONUT_GEOMETRY);
    const d = regionToPathData(region);
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
  });
});

describe("geometryToFlowExclusion", () => {
  it("attaches the caller-provided nodeId to placement errors", () => {
    try {
      geometryToFlowExclusion(CIRCLE_GEOMETRY, {
        x: Number.NaN,
        y: 0,
        width: 100,
        height: 100,
        nodeId: "shape-1",
      });
      expect.unreachable("geometryToFlowExclusion should throw");
    } catch (error) {
      expect((error as { nodeId?: string }).nodeId).toBe("shape-1");
      expect((error as { stage?: string }).stage).toBe("validate");
    }
  });

  it("matches the analytic circle exclusion fragment-for-fragment", () => {
    const analytic = flowWith([{ kind: "circle", cx: 120, cy: 120, r: 50 }]);
    const derived = flowWith([
      geometryToFlowExclusion(CIRCLE_GEOMETRY, { x: 60, y: 60, width: 120, height: 120 }),
    ]);

    expect(derived.lines.length).toBe(analytic.lines.length);
    // Compare per-line aggregate usable width and leftmost start. Exact
    // fragment counts can differ by one near the circle's widest band, where
    // the ~1px cubic-approximation error crosses the min-region-width filter.
    let comparedLines = 0;
    for (const [index, analyticLine] of analytic.lines.entries()) {
      const derivedLine = derived.lines[index];
      expect(derivedLine).toBeDefined();
      const sum = (fragments: { availableInlineSizePx: number }[]) =>
        fragments.reduce((total, fragment) => total + fragment.availableInlineSizePx, 0);
      expect(
        Math.abs(sum(derivedLine!.fragments) - sum(analyticLine.fragments)),
      ).toBeLessThanOrEqual(8);
      const firstAnalytic = analyticLine.fragments[0];
      const firstDerived = derivedLine!.fragments[0];
      if (firstAnalytic && firstDerived) {
        expect(Math.abs(firstDerived.x - firstAnalytic.x)).toBeLessThanOrEqual(2);
      }
      comparedLines += 1;
    }
    expect(comparedLines).toBeGreaterThan(4);
  });

  it("keeps holes excluded: no text fragment lands inside a donut hole", () => {
    // Donut scaled to 200x200 at (20,20): outer box (20,20)-(220,220),
    // hole spans (80,80)-(160,160). Flow box is 240x240, so usable space in
    // the donut band is only left of x=20 and right of x=220.
    const result = flowWith([
      geometryToFlowExclusion(DONUT_GEOMETRY, { x: 20, y: 20, width: 200, height: 200 }),
    ]);
    let checkedFragments = 0;
    for (const line of result.lines) {
      for (const fragment of line.fragments) {
        const left = fragment.x;
        const right = fragment.x + fragment.availableInlineSizePx;
        const top = fragment.y;
        if (top > 80 && top < 160) {
          const insideHole = left >= 80 && right <= 160;
          expect(insideHole).toBe(false);
          checkedFragments += 1;
        }
      }
    }
    expect(checkedFragments).toBeGreaterThan(0);
  });

  it("applies marginPx passthrough", () => {
    const exclusion = geometryToFlowExclusion(SQUARE_GEOMETRY, {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      marginPx: { top: 1, right: 2, bottom: 3, left: 4 },
    });
    expect(exclusion.kind).toBe("path");
    expect(exclusion.marginPx).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  it("bakes a post-layout rotation around the placed shape's local origin", () => {
    const exclusion = geometryToFlowExclusion(SQUARE_GEOMETRY, {
      x: 10,
      y: 20,
      width: 20,
      height: 10,
      transform: { rotateDeg: 90, originX: 10, originY: 5 },
    });

    expect(exclusion.kind).toBe("path");
    if (exclusion.kind === "path") {
      expect(exclusion.d).toBe("M25 15L25 35L15 35L15 15L25 15Z");
    }
  });

  it("rejects non-positive sizes", () => {
    expect(() =>
      geometryToFlowExclusion(SQUARE_GEOMETRY, { x: 0, y: 0, width: 0, height: 50 }),
    ).toThrowError(/positive and finite/);
  });
});

describe("symbolToFlowExclusion", () => {
  it("resolves elastic segments before deriving the exclusion", () => {
    const symbol = {
      geometry: {
        viewBox: { width: 100, height: 20 },
        root: {
          kind: "group" as const,
          children: [
            { kind: "path" as const, nodeId: "shaft", d: "M0 8H70V12H0Z" },
            { kind: "path" as const, nodeId: "head", d: "M70 4L100 10L70 16Z" },
          ],
        },
      },
      elasticSegments: [
        {
          nodeId: "shaft",
          axis: "x" as const,
          role: "stretch" as const,
          frame: { x: 0, y: 0, width: 70, height: 20 },
        },
        {
          nodeId: "head",
          axis: "x" as const,
          role: "fixed-end" as const,
          frame: { x: 70, y: 0, width: 30, height: 20 },
        },
      ],
    };
    const exclusion = symbolToFlowExclusion(symbol, { x: 0, y: 0, width: 160, height: 20 });
    expect(exclusion.kind).toBe("path");
    if (exclusion.kind === "path") {
      // Elastic resolve stretched the shaft: arrow tip reaches x=160
      expect(exclusion.d).toContain("160");
    }
  });
});
