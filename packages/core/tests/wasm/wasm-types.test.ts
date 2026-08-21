import { describe, expect, it } from "vitest";
import type { FlowExclusionShape, WasmLayoutOutput } from "../../src/wasm/index.js";

describe("WasmLayoutOutput", () => {
  it("matches the public compute_layout JSON shape", () => {
    const sample = {
      nodes: [
        {
          nodeId: "text1",
          x: 0,
          y: 0,
          width: 100,
          height: 24,
          textLayout: {
            glyphs: [],
            measuredWidth: 100,
            measuredHeight: 24,
            lines: [
              {
                text: "AB",
                glyphs: [],
                width: 100,
                baselineY: 18,
                fragments: [
                  {
                    text: "AB",
                    glyphs: [],
                    width: 100,
                    style: {
                      font: "NotoSansJP",
                      fallback: ["FallbackFont"],
                      fontWeight: 700,
                      fontStyle: "italic",
                      fontSizePx: 24,
                      letterSpacingPx: 1.5,
                      textOrientation: "upright",
                      fontVariationSettings: '"wght" 700',
                      color: "#ff0000",
                      language: "ja",
                    },
                  },
                ],
                positionedGlyphs: [
                  {
                    glyphId: 1,
                    text: "A",
                    clusterStart: 0,
                    clusterEnd: 1,
                    fontAlias: "NotoSansJP",
                    fontFallback: ["FallbackFont"],
                    fontWeight: 700,
                    fontStyle: "italic",
                    fontSizePx: 24,
                    fontVariationSettings: '"wght" 700',
                    fill: "#ff0000",
                    originX: 0,
                    originY: 18,
                    xOffset: 0,
                    yOffset: 0,
                    xAdvance: 10,
                    yAdvance: 0,
                    rotationDeg: 0,
                    absolutePosition: false,
                  },
                ],
              },
            ],
            bbox: { x: 0, y: 0, w: 100, h: 24 },
            chosenFontSizePx: 24,
            overflow: { type: "none" },
          },
        },
      ],
      measureCallCount: 1,
      measureCacheHits: 0,
    } satisfies WasmLayoutOutput;

    expect(sample.nodes[0]?.nodeId).toBe("text1");
    expect(sample.nodes[0]?.textLayout?.lines?.[0]?.fragments?.[0]?.style?.color).toBe("#ff0000");
    expect(sample.measureCacheHits).toBe(0);
  });
});

describe("FlowExclusionShape", () => {
  it("accepts scalar and edge-specific exclusion margins", () => {
    const shapes = [
      { kind: "rect", x: 0, y: 0, width: 10, height: 10, marginPx: 4 },
      { kind: "circle", cx: 10, cy: 10, r: 5, marginPx: { right: 12, bottom: 6 } },
      {
        kind: "path",
        d: "M0 0 L10 0 L10 10 Z",
        marginPx: { top: 2, left: 3 },
      },
    ] satisfies FlowExclusionShape[];

    expect(shapes).toHaveLength(3);
  });
});
