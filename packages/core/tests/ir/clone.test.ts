import { describe, expect, it } from "vitest";
import { RecoverableError } from "../../src/errors.js";
import { cloneIR, cloneIRForLayeredTransform, cloneRenderMutableIR } from "../../src/ir/clone.js";
import type {
  IR,
  IRGroupNode,
  IRImageNode,
  IRNode,
  IRPathNode,
  IRRectNode,
  IRShapeNode,
  IRSvgNode,
  IRTextNode,
} from "../../src/ir/types.js";
import { circularClip } from "../helpers/box-clip.js";

/** Exhaustive mutable group fields covered by the clone fixture. */
const GROUP_FIELDS = {
  type: true,
  nodeId: true,
  ownership: true,
  bbox: true,
  children: true,
  opacity: true,
  transform: true,
  animation: true,
  boxShadow: true,
  clip: true,
} satisfies Record<keyof IRGroupNode, true>;

/** Exhaustive rectangle fields covered by the clone fixture. */
const RECT_FIELDS = {
  type: true,
  nodeId: true,
  ownership: true,
  bbox: true,
  fill: true,
  stroke: true,
  strokeWidth: true,
  strokeScaling: true,
  strokeLinecap: true,
  strokeLinejoin: true,
  strokeDasharray: true,
  strokeMiterlimit: true,
  gradient: true,
  borderRadius: true,
} satisfies Record<keyof IRRectNode, true>;

/** Exhaustive text fields, including resolved paint resources, covered by the clone fixture. */
const TEXT_FIELDS = {
  type: true,
  nodeId: true,
  ownership: true,
  bbox: true,
  lines: true,
  font: true,
  fontFallback: true,
  fontSizePx: true,
  fontWeight: true,
  fontStyle: true,
  letterSpacingPx: true,
  fontVariationSettings: true,
  fontFeatureSettings: true,
  color: true,
  textAlign: true,
  layoutBox: true,
  writingMode: true,
  language: true,
  lineHeightPx: true,
  textLayoutKind: true,
  textPath: true,
  sourceText: true,
  displayText: true,
  glyphPaths: true,
  gradients: true,
  unitMap: true,
  unitAnimation: true,
  unitAnimationSamples: true,
  stroke: true,
  strokeWidth: true,
  strokeLinecap: true,
  strokeLinejoin: true,
  strokeDasharray: true,
  strokeMiterlimit: true,
  strokes: true,
  shadows: true,
  textDecorations: true,
} satisfies Record<keyof IRTextNode, true>;

/** Image-specific fields exercised by clone mutation isolation. */
const IMAGE_FIELDS = {
  type: true,
  nodeId: true,
  ownership: true,
  bbox: true,
  src: true,
  preserveAspectRatio: true,
} satisfies Record<keyof IRImageNode, true>;

/** Canonical Path fields whose nested values must be copied without mutable aliases. */
const PATH_FIELDS = {
  type: true,
  nodeId: true,
  ownership: true,
  bbox: true,
  fill: true,
  stroke: true,
  strokeWidth: true,
  fillRule: true,
  strokeLinecap: true,
  strokeLinejoin: true,
  strokeDasharray: true,
  strokeMiterlimit: true,
  pathData: true,
  pathGeometry: true,
  strokeScaling: true,
} satisfies Record<keyof IRPathNode, true>;

/** Embedded-SVG fields exercised by clone mutation isolation. */
const SVG_FIELDS = {
  type: true,
  nodeId: true,
  ownership: true,
  bbox: true,
  svgContent: true,
  svgViewBox: true,
  preserveAspectRatio: true,
} satisfies Record<keyof IRSvgNode, true>;

/** Shape-specific fields exercised by clone mutation isolation. */
const SHAPE_FIELDS = {
  type: true,
  nodeId: true,
  ownership: true,
  bbox: true,
  fill: true,
  stroke: true,
  strokeWidth: true,
  fillRule: true,
  strokeLinecap: true,
  strokeLinejoin: true,
  strokeDasharray: true,
  strokeMiterlimit: true,
  shapeParts: true,
} satisfies Record<keyof IRShapeNode, true>;

const handlers = { onClick: "click", onPointerMove: "move" } as const;
const animation = {
  keyframes: [
    { at: 0, opacity: 0, transform: { translateX: 1, rotateDeg: 2 } },
    { at: 1, opacity: 1 },
  ],
  durationMs: 1000,
  delayMs: 10,
  easing: [0.1, 0.2, 0.3, 0.4],
  iterations: 2,
  fill: "both",
} as const;

const radialRect: IRRectNode = {
  ownership: { role: "source" },
  type: "rect",
  nodeId: "rect",
  bbox: { x: 1, y: 2, w: 30, h: 40 },
  fill: "#fff",
  stroke: "#000",
  strokeWidth: 2,
  strokeScaling: "transform",
  strokeLinecap: "round",
  strokeLinejoin: "bevel",
  strokeDasharray: "2 1",
  strokeMiterlimit: 4,
  gradient: {
    type: "radial",
    geometry: { centerX: 30, centerY: 40, radiusX: 50, radiusY: 60 },
    stops: [
      { color: "red", offset: 0 },
      { color: "blue", offset: 1 },
    ],
  },
  borderRadius: { tl: 1, tr: 2, br: 3, bl: 4 },
};

const textNode: IRTextNode = {
  ownership: { role: "source", on: handlers },
  gradients: [
    {
      color: "linear-gradient(90deg, red, blue)",
      bbox: { x: 0, y: 0, w: 80, h: 24 },
      gradient: {
        type: "linear",
        geometry: { startX: 0, startY: 12, endX: 80, endY: 12 },
        stops: [
          { color: "red", offset: 0 },
          { color: "blue", offset: 1 },
        ],
      },
    },
  ],
  type: "text",
  nodeId: "text",
  bbox: { x: 0, y: 0, w: 80, h: 24 },
  lines: [
    {
      text: "A",
      glyphs: [
        {
          glyphId: 1,
          xAdvance: 10,
          yAdvance: 0,
          xOffset: 0,
          yOffset: 0,
          cluster: 0,
          fontAlias: "Primary",
          fontWeight: 700,
          fontStyle: "italic",
          rotationDeg: 2,
        },
      ],
      width: 10,
      baselineY: 18,
      fragments: [
        {
          text: "A",
          glyphs: [
            {
              glyphId: 1,
              xAdvance: 10,
              yAdvance: 0,
              xOffset: 0,
              yOffset: 0,
              cluster: 0,
            },
          ],
          width: 10,
          style: {
            font: "Primary",
            fallback: ["Fallback"],
            fontWeight: 700,
            fontStyle: "italic",
            fontVariationSettings: '"wght" 700',
            fontFeatureSettings: '"liga" 1',
            color: "#123",
            textStrokes: [{ color: "#fff", widthPx: 2 }],
            textShadows: [{ dx: 1, dy: 2, blurPx: 3, color: "#000" }],
            language: "ja",
            fontSizePx: 20,
            letterSpacingPx: 1,
            textOrientation: "upright",
          },
        },
      ],
      positionedGlyphs: [
        {
          glyphId: 1,
          text: "A",
          clusterStart: 0,
          clusterEnd: 1,
          sourceStart: 0,
          sourceEnd: 1,
          sourceRole: "content",
          paintRangeIndex: 0,
          textStrokes: [{ color: "#fff", widthPx: 2 }],
          textShadows: [{ dx: 1, dy: 2, color: "#000" }],
          fontAlias: "Primary",
          fontFallback: ["Fallback"],
          fontWeight: 700,
          fontStyle: "italic",
          fontSizePx: 20,
          fontVariationSettings: '"wght" 700',
          fontFeatureSettings: '"liga" 1',
          fill: "#123",
          originX: 0,
          originY: 18,
          xOffset: 0,
          yOffset: 0,
          xAdvance: 10,
          yAdvance: 0,
          rotationDeg: 2,
          baselineRotationDeg: 3,
          inlineScale: 1.1,
          syntheticKind: "ellipsis",
          outlineWritingMode: "horizontal-tb",
          absolutePosition: true,
        },
      ],
    },
  ],
  font: "Primary",
  fontFallback: ["Fallback"],
  fontSizePx: 20,
  fontWeight: 700,
  fontStyle: "italic",
  letterSpacingPx: 1,
  fontVariationSettings: '"wght" 700',
  fontFeatureSettings: '"liga" 1',
  color: "#123",
  textAlign: "center",
  layoutBox: { x: 0, y: 0, w: 100, h: 30 },
  writingMode: "horizontal-tb",
  language: "ja",
  lineHeightPx: 24,
  textLayoutKind: "path",
  textPath: {
    d: "M0 0H100",
    startOffsetPx: 1,
    textAnchor: "middle",
    pathDirection: "forward",
    pathNormal: "left",
    pathOffsetPx: 2,
    pathFit: "spacing",
    pathOverflow: "ellipsis",
  },
  sourceText: "AB",
  displayText: "A",
  glyphPaths: [
    {
      nodeId: "text",
      d: "M0 0H1",
      fill: "#123",
      glyphIds: [1],
      text: "A",
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      unitId: "u0",
      sourceStart: 0,
      sourceEnd: 1,
      sourceRole: "content",
      paintRangeIndex: 0,
      strokes: [{ color: "#fff", widthPx: 2 }],
      shadows: [{ dx: 1, dy: 2, color: "#000" }],
      missingGlyph: true,
    },
  ],
  unitMap: {
    kind: "cluster",
    ruby: "separate",
    units: [
      {
        unitId: "u0",
        kind: "cluster",
        sourceStart: 0,
        sourceEnd: 1,
        lineId: "l0",
        logicalOrder: 0,
        visualOrder: 0,
        members: [{ lineIndex: 0, glyphIndex: 0, sourceRole: "content" }],
      },
    ],
  },
  unitAnimation: {
    by: "cluster",
    animation: { ...animation, easing: { type: "spring", stiffness: 100 } },
    delayStepMs: 12,
    order: "visual",
    ruby: "separate",
  },
  unitAnimationSamples: [
    {
      unitId: "u0",
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      opacity: 0.5,
      transform: { translateX: 2, rotateDeg: 3 },
    },
  ],
  stroke: "#fff",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "bevel",
  strokeDasharray: "2 1",
  strokeMiterlimit: 4,
  strokes: [{ color: "#fff", widthPx: 4 }],
  shadows: [{ dx: 1, dy: 2, blurPx: 3, color: "#000" }],
  textDecorations: [
    {
      line: "underline",
      style: "wavy",
      color: "#456",
      skipInk: "all",
      paths: [
        {
          d: "M0 0H1",
          originX: 0,
          originY: 1,
          contourCount: 1,
          segmentCount: 1,
          pathDistanceStartPx: 0,
          pathDistanceEndPx: 1,
        },
      ],
      sourceStart: 0,
      sourceEnd: 1,
    },
  ],
};

const groupNode: IRGroupNode = {
  ownership: { role: "source", on: handlers, meta: { label: "group" } },
  type: "group",
  nodeId: "group",
  bbox: { x: 0, y: 0, w: 100, h: 100 },
  children: [radialRect, textNode],
  opacity: 0.5,
  transform: { translateX: 1, scaleY: 2, originX: 3, originY: 4 },
  animation,

  boxShadow: { dx: 1, dy: 2, blur: 3, spread: 4, color: "#000" },

  clip: circularClip({ x: 0, y: 0, w: 90, h: 90 }, { tl: 1, tr: 2, br: 3, bl: 4 }),
};

const imageNode: IRImageNode = {
  ownership: { role: "source", on: handlers },
  type: "image",
  nodeId: "image",
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  src: "data:image/png;base64,AA==",
  preserveAspectRatio: "xMidYMid meet",
};

/** Complete Path fixture with separate layout and paint geometry. */
const pathNode: IRPathNode = {
  ownership: { role: "source", on: handlers },
  type: "path",
  nodeId: "path",
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  fill: "#fff",
  stroke: "#000",
  strokeWidth: 2,
  fillRule: "evenodd",
  strokeLinecap: "round",
  strokeLinejoin: "bevel",
  strokeDasharray: "2 1",
  strokeMiterlimit: 4,
  pathData: "M0 0H10",
  pathGeometry: {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
    strokeOutset: { radius: 1, multiplier: 1 },
    isComplete: true,
  },
  strokeScaling: "canvas",
};

const svgNode: IRSvgNode = {
  ownership: { role: "source", on: handlers },
  type: "svg",
  nodeId: "svg",
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  svgContent: '<path d="M0 0H10"/>',
  svgViewBox: "0 0 10 10",
  preserveAspectRatio: "xMidYMid meet",
};

const shapeNode: IRShapeNode = {
  ownership: { role: "source", on: handlers },
  type: "shape",
  nodeId: "shape",
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  fill: "#fff",
  stroke: "#000",
  strokeWidth: 2,
  fillRule: "evenodd",
  strokeLinecap: "round",
  strokeLinejoin: "bevel",
  strokeDasharray: "2 1",
  strokeMiterlimit: 4,
  shapeParts: [
    {
      partId: "part",
      d: "M0 0H10",
      strokeD: "M0 1H10",
      bounds: { x: 0, y: 0, width: 10, height: 1 },
      paint: {
        fill: "#fff",
        stroke: "#000",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "bevel",
        strokeDasharray: "2 1",
        strokeMiterlimit: 4,
      },
    },
  ],
};

function collectObjectReferences(value: unknown, references = new Set<object>()): Set<object> {
  if (typeof value !== "object" || value === null || references.has(value)) {
    return references;
  }
  references.add(value);
  for (const childValue of Object.values(value)) {
    collectObjectReferences(childValue, references);
  }
  return references;
}

function expectDeepIsolation(source: IRNode): void {
  const clone = cloneIRForLayeredTransform(source);
  expect(clone).toEqual(source);

  const sourceReferences = collectObjectReferences(source);
  for (const cloneReference of collectObjectReferences(clone)) {
    expect(sourceReferences.has(cloneReference)).toBe(false);
  }
}

describe("cloneIRForLayeredTransform", () => {
  const cases: Array<{
    name: string;
    node: IRNode;
    fields: Record<string, true>;
  }> = [
    { name: "group", node: groupNode, fields: GROUP_FIELDS },
    { name: "rect", node: radialRect, fields: RECT_FIELDS },
    { name: "text", node: textNode, fields: TEXT_FIELDS },
    { name: "image", node: imageNode, fields: IMAGE_FIELDS },
    { name: "path", node: pathNode, fields: PATH_FIELDS },
    { name: "svg", node: svgNode, fields: SVG_FIELDS },
    { name: "shape", node: shapeNode, fields: SHAPE_FIELDS },
  ];

  for (const { name, node, fields } of cases) {
    it(`deeply isolates every populated ${name} field`, () => {
      expect(Object.keys(node).sort()).toEqual(Object.keys(fields).sort());
      expectDeepIsolation(node);
    });
  }

  it("preserves an omitted line-fragment style while cloning a text node", () => {
    const styleLessText = structuredClone(textNode);
    const fragment = styleLessText.lines[0]?.fragments?.[0];
    if (!fragment) {
      throw new TypeError("fixture line fragment is missing");
    }
    Reflect.deleteProperty(fragment, "style");

    const clone = cloneIRForLayeredTransform(styleLessText);
    if (clone.type !== "text") {
      throw new TypeError("cloned fixture is not a text node");
    }
    expect(clone.lines[0]?.fragments?.[0]).not.toHaveProperty("style");
  });

  it("deeply isolates linear-gradient stops too", () => {
    const linearRect: IRRectNode = {
      ...radialRect,
      gradient: {
        type: "linear",
        geometry: { startX: -2.5, startY: 37.5, endX: 32.5, endY: 2.5 },
        stops: [
          { color: "red", offset: 0 },
          { color: "blue", offset: 1 },
        ],
      },
    };

    expectDeepIsolation(linearRect);
  });
});

describe("cloneRenderMutableIR", () => {
  it("isolates exactly the render mutation set from a compiled IR", () => {
    const warning = new RecoverableError("TEST_WARNING", "warning", {
      fallback: "continue",
      stage: "ir",
    });
    const source: IR = {
      root: { ...groupNode, children: [textNode] },

      width: 100,
      height: 100,
      debug: true,
      warnings: [warning],
    };

    const clone = cloneRenderMutableIR(source);
    const clonedText = clone.root.type === "group" ? clone.root.children?.[0] : undefined;

    expect(clone).toEqual(source);
    expect(clone.warnings).not.toBe(source.warnings);
    expect(clone.root.ownership).toBe(source.root.ownership);
    expect(clone.root).not.toBe(source.root);
    expect(clonedText?.type).toBe("text");
    if (clonedText?.type !== "text") {
      return;
    }
    expect(clonedText.glyphPaths).not.toBe(textNode.glyphPaths);
    expect(clonedText.unitAnimationSamples).not.toBe(textNode.unitAnimationSamples);
    expect(clonedText.lines).toBe(textNode.lines);
    expect(clonedText.unitAnimation).toBe(textNode.unitAnimation);

    clone.warnings.push(warning);
    clonedText.glyphPaths?.push({
      nodeId: "extra",
      d: "M0 0",
      fill: "#000",
      glyphIds: [],
      text: "",
      bbox: { x: 0, y: 0, w: 0, h: 0 },
    });
    clonedText.unitAnimationSamples?.push({ unitId: "extra" });

    expect(source.warnings).toHaveLength(1);
    expect(textNode.glyphPaths).toHaveLength(1);
    expect(textNode.unitAnimationSamples).toHaveLength(1);
  });
});

describe("cloneIR", () => {
  it("detaches the complete IR and rehydrates warning semantics", () => {
    const warning = new RecoverableError("TEST_WARNING", "warning", {
      fallback: "continue",
      stage: "ir",
      nodeId: "text",
      context: {
        details: {
          labels: ["first", "second"],
          coordinates: [{ x: 1, y: 2 }],
        },
      },
    });
    const source: IR = {
      root: { ...groupNode, children: [textNode, imageNode, pathNode, svgNode, shapeNode] },

      width: 100,
      height: 100,
      debug: true,
      warnings: [warning],
    };

    const snapshot = cloneIR(source);

    expect(snapshot).toEqual(source);
    const sourceReferences = collectObjectReferences(source);
    for (const snapshotReference of collectObjectReferences(snapshot)) {
      expect(sourceReferences.has(snapshotReference)).toBe(false);
    }
    expect(snapshot.warnings[0]).toBeInstanceOf(RecoverableError);
    expect(snapshot.warnings[0]?.toJSON()).toEqual(warning.toJSON());
  });
});
