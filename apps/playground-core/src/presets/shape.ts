import {
  Box,
  Canvas,
  computeGeometryIntersections,
  divideGeometryRegions,
  Flex,
  type GeometryIntersection,
  type GeometryViewBox,
  type Region,
  Shape,
  Svg,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: matches core API name
  Symbol,
  Text,
  type VNode,
} from "@boundsvg/core";
import { wasmRenderShapeRegionSvg } from "@boundsvg/core/wasm";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";
import {
  ARC_RELATIVE_GEOMETRY,
  ARROW_SYMBOL,
  BADGE_GEOMETRY,
  CALLOUT_GEOMETRY,
  CARD_GEOMETRY,
  DIVIDE_LHS_GEOMETRY,
  DIVIDE_RHS_GEOMETRY,
  DIVIDE_SOURCE_VIEWBOX,
  NOTCH_CARD_GEOMETRY,
  NOTCH_CIRCLE_GEOMETRY,
  PILL_GEOMETRY,
  SELF_INTERSECT_GEOMETRY,
  UNION_BUBBLE_GEOMETRY,
  XOR_BUBBLE_GEOMETRY,
} from "./shape-defs";

const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 420;
const TILE_WIDTH = 208;
const TILE_HEIGHT = 208;
const STRIP_PANEL_HEIGHT = 112;

type RegionPaint = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
};

type TargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RegionBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

function demoTile(title: string, subtitle: string, child: VNode) {
  return Box(
    {
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      padding: 12,
      background: "#0f172a",
      borderWidth: 1,
      borderColor: "#334155",
      borderRadius: 18,
    },
    Flex(
      {
        direction: "column",
        width: TILE_WIDTH - 24,
        height: TILE_HEIGHT - 24,
        alignItems: "center",
        justifyContent: "space-between",
      },
      Box(
        {
          width: TILE_WIDTH - 24,
          height: 136,
          borderWidth: 1,
          borderColor: "#1e293b",
          borderRadius: 14,
          background: "#111827",
        },
        child,
      ),
      Flex(
        {
          direction: "column",
          width: TILE_WIDTH - 24,
          gap: 4,
        },
        Text({ font: FA, fontSizePx: 14, color: "#e2e8f0" }, title),
        Text(
          { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char", lineHeight: 1.35 },
          subtitle,
        ),
      ),
    ),
  );
}

function stripPanel(title: string, subtitle: string, child: VNode, width: number) {
  return Box(
    {
      width,
      height: STRIP_PANEL_HEIGHT,
      padding: 12,
      background: "#0f172a",
      borderWidth: 1,
      borderColor: "#22314a",
      borderRadius: 16,
    },
    Flex(
      {
        direction: "row",
        width: width - 24,
        height: STRIP_PANEL_HEIGHT - 24,
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
      },
      Box(
        {
          width: width - 178,
          height: 72,
          borderWidth: 1,
          borderColor: "#172235",
          borderRadius: 12,
          background: "#111827",
        },
        child,
      ),
      Flex(
        {
          direction: "column",
          width: 140,
          gap: 4,
        },
        Text({ font: FA, fontSizePx: 13, color: "#e2e8f0" }, title),
        Text(
          { font: FA, fontSizePx: 11, color: "#64748b", wrap: "char", lineHeight: 1.35 },
          subtitle,
        ),
      ),
    ),
  );
}

function computeRegionBounds(region: Region): RegionBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const updatePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const contour of region.contours) {
    for (const segment of contour.segments) {
      updatePoint(segment.p0.x, segment.p0.y);
      if (segment.kind === "line") {
        updatePoint(segment.p1.x, segment.p1.y);
      } else if (segment.kind === "quad") {
        updatePoint(segment.p1.x, segment.p1.y);
        updatePoint(segment.p2.x, segment.p2.y);
      } else {
        updatePoint(segment.p1.x, segment.p1.y);
        updatePoint(segment.p2.x, segment.p2.y);
        updatePoint(segment.p3.x, segment.p3.y);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function extractSvgInnerContent(svgDocument: string): string {
  const start = svgDocument.indexOf(">");
  const end = svgDocument.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end <= start) {
    return svgDocument;
  }
  return svgDocument.slice(start + 1, end);
}

function renderRegionToSvgContent(region: Region, paint: RegionPaint): string {
  const svgDocument = wasmRenderShapeRegionSvg(region, {
    paint,
  });
  const bounds = computeRegionBounds(region);
  const innerContent = extractSvgInnerContent(svgDocument);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}">${innerContent}</svg>`;
}

function dedupeIntersections(
  intersections: readonly GeometryIntersection[],
  epsilon = 0.75,
): GeometryIntersection[] {
  const deduped: GeometryIntersection[] = [];
  for (const intersection of intersections) {
    const duplicate = deduped.some((existing) => {
      const dx = existing.point.x - intersection.point.x;
      const dy = existing.point.y - intersection.point.y;
      return Math.abs(dx) <= epsilon && Math.abs(dy) <= epsilon;
    });
    if (!duplicate) {
      deduped.push(intersection);
    }
  }
  return deduped;
}

function buildIntersectionMarkers(
  intersections: readonly GeometryIntersection[],
  sourceViewBox: GeometryViewBox,
  targetRect: TargetRect,
): VNode[] {
  const markerSize = 8;
  const sourceX = sourceViewBox.x ?? 0;
  const sourceY = sourceViewBox.y ?? 0;

  return dedupeIntersections(intersections).map((intersection, index) =>
    Box({
      width: markerSize,
      height: markerSize,
      background: "#f8fafc",
      borderWidth: 2,
      borderColor: "#ef4444",
      borderRadius: 999,
      position: "absolute",
      left:
        targetRect.left +
        ((intersection.point.x - sourceX) / sourceViewBox.width) * targetRect.width -
        markerSize / 2,
      top:
        targetRect.top +
        ((intersection.point.y - sourceY) / sourceViewBox.height) * targetRect.height -
        markerSize / 2,
      id: `intersection-marker-${index}`,
    }),
  );
}

function buildOperandPreview(targetWidth: number, targetHeight: number, withMarkers = false) {
  const sourceX = DIVIDE_SOURCE_VIEWBOX.x ?? 0;
  const sourceY = DIVIDE_SOURCE_VIEWBOX.y ?? 0;
  const sourceWidth = DIVIDE_SOURCE_VIEWBOX.width;
  const sourceHeight = DIVIDE_SOURCE_VIEWBOX.height;
  const cardHeight = (CARD_GEOMETRY.viewBox.height / sourceHeight) * targetHeight;
  const notchLeft = (((DIVIDE_RHS_GEOMETRY.viewBox.x ?? 0) - sourceX) / sourceWidth) * targetWidth;
  const notchTop = (((DIVIDE_RHS_GEOMETRY.viewBox.y ?? 0) - sourceY) / sourceHeight) * targetHeight;
  const notchWidth = (DIVIDE_RHS_GEOMETRY.viewBox.width / sourceWidth) * targetWidth;
  const notchHeight = (DIVIDE_RHS_GEOMETRY.viewBox.height / sourceHeight) * targetHeight;
  const cardTop = ((0 - sourceY) / sourceHeight) * targetHeight;
  const intersections = withMarkers
    ? computeGeometryIntersections(DIVIDE_LHS_GEOMETRY, DIVIDE_RHS_GEOMETRY)
    : [];

  return Box(
    {
      width: targetWidth,
      height: targetHeight,
      position: "relative",
    },
    Shape({
      geometry: CARD_GEOMETRY,
      width: targetWidth,
      height: cardHeight,
      fill: "#1e293b",
      stroke: "#475569",
      strokeWidth: 2,
      position: "absolute",
      top: cardTop,
      left: 0,
    }),
    Shape({
      geometry: NOTCH_CIRCLE_GEOMETRY,
      width: notchWidth,
      height: notchHeight,
      fill: "#38bdf8",
      opacity: 0.45,
      stroke: "#7dd3fc",
      strokeWidth: 2,
      position: "absolute",
      top: notchTop,
      left: notchLeft,
    }),
    ...buildIntersectionMarkers(intersections, DIVIDE_SOURCE_VIEWBOX, {
      left: 0,
      top: 0,
      width: targetWidth,
      height: targetHeight,
    }),
  );
}

function arrowRow(width: number, fill: string, stroke: string, label: string) {
  return Flex(
    {
      direction: "row",
      width: 680,
      alignItems: "center",
      justifyContent: "start",
      gap: 16,
    },
    Symbol({ symbol: ARROW_SYMBOL, width, height: 30, fill, stroke, strokeWidth: 2 }),
    Text({ font: FA, fontSizePx: 13, color: "#94a3b8" }, label),
  );
}

function buildPrimitivesCanvas() {
  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#1a1a1a" },
    Flex(
      {
        direction: "column",
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        padding: 24,
        gap: 18,
        justifyContent: "center",
        alignItems: "center",
      },
      Flex(
        {
          direction: "row",
          gap: 16,
          width: 896,
          justifyContent: "center",
        },
        demoTile(
          "Pill",
          "Single-path rounded geometry for buttons and chips.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: PILL_GEOMETRY,
              width: 148,
              height: 68,
              fill: "#2563eb",
              stroke: "#7dd3fc",
              strokeWidth: 2,
            }),
          ),
        ),
        demoTile(
          "Badge",
          "Angular path silhouette with the same Shape API.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: BADGE_GEOMETRY,
              width: 84,
              height: 84,
              fill: "#f59e0b",
              stroke: "#fcd34d",
              strokeWidth: 2,
            }),
          ),
        ),
        demoTile(
          "Callout",
          "Tail and body share the same closed-region border rendering.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: CALLOUT_GEOMETRY,
              width: 152,
              height: 92,
              fill: "#0f766e",
              stroke: "#2dd4bf",
              strokeWidth: 2,
            }),
          ),
        ),
        demoTile(
          "Boolean Card",
          "Subtract result keeps the same notch silhouette for fill and border.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: NOTCH_CARD_GEOMETRY,
              width: 168,
              height: 112,
              fill: "#1e293b",
              stroke: "#475569",
              strokeWidth: 2,
            }),
          ),
        ),
      ),
      Flex(
        {
          direction: "row",
          gap: 16,
          width: 896,
          justifyContent: "center",
        },
        stripPanel(
          "Relative + Arc",
          "Lowercase path commands and arc segments are normalized before rendering.",
          Flex(
            {
              direction: "column",
              width: 262,
              height: 72,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: ARC_RELATIVE_GEOMETRY,
              width: 208,
              height: 86,
              fill: "#0f766e",
              stroke: "#5eead4",
              strokeWidth: 2,
            }),
          ),
          440,
        ),
        stripPanel(
          "Self-Intersection",
          "Self-crossing input is normalized instead of rejected in the current kernel.",
          Flex(
            {
              direction: "column",
              width: 262,
              height: 72,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: SELF_INTERSECT_GEOMETRY,
              width: 172,
              height: 96,
              fill: "#7c3aed",
              stroke: "#c4b5fd",
              strokeWidth: 2,
            }),
          ),
          440,
        ),
      ),
      Text(
        { font: FA, fontSizePx: 18, color: "#94a3b8" },
        "Shape primitives — single path, boolean, and normalized path inputs in one view",
      ),
    ),
  );
}

function buildBooleanOpsCanvas() {
  const divided = divideGeometryRegions(DIVIDE_LHS_GEOMETRY, DIVIDE_RHS_GEOMETRY);

  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#1a1a1a" },
    Flex(
      {
        direction: "column",
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        padding: 24,
        gap: 18,
        justifyContent: "center",
        alignItems: "center",
      },
      Flex(
        {
          direction: "row",
          gap: 16,
          width: 896,
          justifyContent: "center",
        },
        demoTile(
          "Notch Operands",
          "Card and notch circle used by the subtract and divide analysis below.",
          Box(
            {
              width: 184,
              height: 136,
              position: "relative",
            },
            Shape({
              geometry: CARD_GEOMETRY,
              width: 164,
              height: 110,
              fill: "#1e293b",
              stroke: "#475569",
              strokeWidth: 2,
              position: "absolute",
              top: 18,
              left: 10,
            }),
            Shape({
              geometry: NOTCH_CIRCLE_GEOMETRY,
              width: 44,
              height: 54,
              fill: "#38bdf8",
              opacity: 0.45,
              stroke: "#7dd3fc",
              strokeWidth: 2,
              position: "absolute",
              top: 2,
              left: 92,
            }),
          ),
        ),
        demoTile(
          "Union Example",
          "Separate stable example: two overlapping panels merged into one contour.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: UNION_BUBBLE_GEOMETRY,
              width: 146,
              height: 88,
              fill: "#8b5cf6",
            }),
          ),
        ),
        demoTile(
          "Subtract",
          "Card minus notch circle: the filled card keeps the same top cutout in its border.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: NOTCH_CARD_GEOMETRY,
              width: 168,
              height: 112,
              fill: "#1e293b",
              stroke: "#64748b",
              strokeWidth: 2,
            }),
          ),
        ),
        demoTile(
          "XOR Example",
          "Separate stable example: overlap disappears while the non-overlapping panels remain.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: XOR_BUBBLE_GEOMETRY,
              width: 146,
              height: 88,
              fill: "#10b981",
            }),
          ),
        ),
      ),
      Flex(
        {
          direction: "row",
          gap: 16,
          width: 896,
          justifyContent: "center",
        },
        stripPanel(
          "Divide / Subtract part",
          "From the card + notch operands: this is the lhs - rhs piece returned by divide.",
          Svg({
            content: renderRegionToSvgContent(divided.subtract, {
              fill: "#1e293b",
              stroke: "#64748b",
              strokeWidth: 2,
            }),
            width: 110,
            height: 72,
            preserveAspectRatio: "meet",
          }),
          288,
        ),
        stripPanel(
          "Divide / Intersect part",
          "From the same card + notch operands: this is the overlap region lhs ∩ rhs.",
          Svg({
            content: renderRegionToSvgContent(divided.intersect, {
              fill: "#0ea5e9",
              stroke: "#7dd3fc",
              strokeWidth: 2,
              opacity: 0.95,
            }),
            width: 110,
            height: 72,
            preserveAspectRatio: "meet",
          }),
          288,
        ),
        stripPanel(
          "Intersection points",
          "Marker dots come from computeGeometryIntersections() on the card + notch operands.",
          buildOperandPreview(110, 72, true),
          288,
        ),
      ),
      Text(
        { font: FA, fontSizePx: 18, color: "#94a3b8" },
        "Boolean examples — stable union/xor samples above, card-notch subtract and divide analysis below",
      ),
    ),
  );
}

function buildElasticArrowCanvas() {
  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#1a1a1a" },
    Flex(
      {
        direction: "column",
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        padding: [28, 48, 24, 48],
        gap: 20,
        justifyContent: "center",
        alignItems: "center",
      },
      arrowRow(200, "#f59e0b", "#fcd34d", "200px — base symbol"),
      arrowRow(360, "#10b981", "#5eead4", "360px — shaft stretches, head remains fixed"),
      arrowRow(560, "#6366f1", "#a5b4fc", "560px — fill and outline stay aligned"),
      Text(
        { font: FA, fontSizePx: 18, color: "#94a3b8" },
        "Elastic segments — fill and outline both show the same head-fixed, shaft-stretch behavior",
      ),
    ),
  );
}

export const shapePrimitivesPreset: Preset = {
  title: "Shape: Primitives",
  description:
    "Multiple geometry styles in one view: primitive silhouettes plus normalized arc/relative and self-intersecting inputs.",
  source: `import { Canvas, Flex, Shape, Text } from "@boundsvg/core";
import { geometryDoc, pathGeometry, booleanGeometry } from "@boundsvg/shape";

// Define geometries from SVG path data
const pill = geometryDoc(
  { width: 140, height: 64 },
  pathGeometry("M32 0H108C125.673 0 140 14.327 140 32C140 49.673 125.673 64 108 64H32C14.327 64 0 49.673 0 32C0 14.327 14.327 0 32 0Z"),
);
const badge = geometryDoc(
  { width: 120, height: 120 },
  pathGeometry("M60 0L104 22V70L60 120L16 70V22Z"),
);

// Boolean subtract: card minus notch circle
const card = pathGeometry("M16 0H284C292.837 0 300 7.163 300 16V184C300 192.837 292.837 200 284 200H16C7.163 200 0 192.837 0 184V16C0 7.163 7.163 0 16 0Z");
const notch = pathGeometry("M150 0C150 16.569 138.807 30 125 30C111.193 30 100 16.569 100 0...");
const notchCard = geometryDoc({ width: 300, height: 200 }, booleanGeometry("subtract", [card, notch]));

const vnode = Canvas(
  { width: 920, height: 420, background: "#1a1a1a" },
  Flex(
    { direction: "column", width: 920, height: 420, padding: 24, gap: 18,
      justifyContent: "center", alignItems: "center" },
    Flex(
      { direction: "row", gap: 16 },
      Shape({ geometry: pill, width: 148, height: 68,
        fill: "#2563eb", stroke: "#7dd3fc", strokeWidth: 2 }),
      Shape({ geometry: badge, width: 84, height: 84,
        fill: "#f59e0b", stroke: "#fcd34d", strokeWidth: 2 }),
      Shape({ geometry: notchCard, width: 168, height: 112,
        fill: "#1e293b", stroke: "#475569", strokeWidth: 2 }),
    ),
    Text({ font: "${FA}", fontSizePx: 18, color: "#94a3b8" },
      "Shape primitives — single path, boolean, and normalized path inputs"),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildPrimitivesCanvas(),
};

function buildOpacityCanvas() {
  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#1a1a1a" },
    Flex(
      {
        direction: "column",
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        padding: 24,
        gap: 18,
        justifyContent: "center",
        alignItems: "center",
      },
      Flex(
        {
          direction: "row",
          gap: 16,
          width: 896,
          justifyContent: "center",
        },
        demoTile(
          "Shape opacity 0.5",
          "Shape applies opacity once, on its wrapper group.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: PILL_GEOMETRY,
              width: 148,
              height: 68,
              fill: "#2563eb",
              opacity: 0.5,
            }),
          ),
        ),
        demoTile(
          "Box opacity 0.5",
          "Reference: a Box with the same fill and opacity must match the Shape's tone.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Box({
              width: 148,
              height: 68,
              background: "#2563eb",
              borderRadius: 32,
              opacity: 0.5,
            }),
          ),
        ),
        demoTile(
          "Shape opacity 1.0",
          "Fully opaque Shape for contrast against the 0.5 tiles.",
          Flex(
            {
              direction: "column",
              width: 184,
              height: 136,
              justifyContent: "center",
              alignItems: "center",
            },
            Shape({
              geometry: PILL_GEOMETRY,
              width: 148,
              height: 68,
              fill: "#2563eb",
            }),
          ),
        ),
      ),
      Text(
        { font: FA, fontSizePx: 18, color: "#94a3b8" },
        "Shape opacity — the 0.5 Shape and the 0.5 Box must render at the same tone",
      ),
    ),
  );
}

export const shapeOpacityPreset: Preset = {
  title: "Shape: Opacity",
  description:
    "Shape and Symbol opacity is applied exactly once (wrapper group). The 0.5 Shape must match the tone of the 0.5 reference Box.",
  source: `import { Box, Canvas, Flex, Shape } from "@boundsvg/core";

// Shape opacity is applied once, on the wrapper group — a Shape with
// opacity 0.5 renders at the same tone as any other node with opacity 0.5.
const vnode = Canvas(
  { width: 920, height: 420, background: "#1a1a1a" },
  Flex(
    { direction: "row", gap: 16, padding: 24, alignItems: "center" },
    Shape({ geometry: pill, width: 148, height: 68, fill: "#2563eb", opacity: 0.5 }),
    Box({ width: 148, height: 68, background: "#2563eb", borderRadius: 32, opacity: 0.5 }),
    Shape({ geometry: pill, width: 148, height: 68, fill: "#2563eb" }),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildOpacityCanvas(),
};

export const shapeBooleanOpsPreset: Preset = {
  title: "Shape: Boolean Ops",
  description:
    "Stable union/xor examples plus a separate card-notch divide analysis in the same tab.",
  source: `import {
  Canvas, Flex, Shape, Svg, Text,
  divideGeometryRegions, computeGeometryIntersections,
} from "@boundsvg/core";
import { geometryDoc, pathGeometry, booleanGeometry } from "@boundsvg/shape";
import { wasmRenderShapeRegionSvg } from "@boundsvg/core/wasm";

// Define card and notch circle geometries
const cardPath = pathGeometry("M16 0H284C292.837 0 300 7.163 300 16V184...");
const notchCircle = pathGeometry("M150 0C150 16.569 138.807 30 125 30...");
const card = geometryDoc({ width: 300, height: 200 }, cardPath);
const notchCircleDoc = geometryDoc({ x: 100, y: -30, width: 50, height: 60 }, notchCircle);

// Boolean subtract
const notchCard = geometryDoc({ width: 300, height: 200 },
  booleanGeometry("subtract", [cardPath, notchCircle]));

// Divide into subtract / intersect regions
const divided = divideGeometryRegions(card, notchCircleDoc);
const hits = computeGeometryIntersections(card, notchCircleDoc);

// Render divide results via WASM region SVG
const subtractSvg = wasmRenderShapeRegionSvg(divided.subtract, {
  paint: { fill: "#1e293b", stroke: "#64748b", strokeWidth: 2 },
});
const intersectSvg = wasmRenderShapeRegionSvg(divided.intersect, {
  paint: { fill: "#0ea5e9", stroke: "#7dd3fc", strokeWidth: 2 },
});

const vnode = Canvas(
  { width: 920, height: 420, background: "#1a1a1a" },
  Flex(
    { direction: "column", width: 920, height: 420, padding: 24, gap: 18,
      justifyContent: "center", alignItems: "center" },
    Flex(
      { direction: "row", gap: 16 },
      Shape({ geometry: notchCard, width: 168, height: 112,
        fill: "#1e293b", stroke: "#64748b", strokeWidth: 2 }),
      Svg({ content: subtractSvg, width: 110, height: 72,
        preserveAspectRatio: "meet" }),
      Svg({ content: intersectSvg, width: 110, height: 72,
        preserveAspectRatio: "meet" }),
    ),
    Text({ font: "${FA}", fontSizePx: 18, color: "#94a3b8" },
      "Boolean ops — subtract, divide analysis, and intersection points"),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildBooleanOpsCanvas(),
};

export const symbolStretchPreset: Preset = {
  title: "Symbol: Elastic Arrow",
  description:
    "Three left-aligned arrows show that fill and outline both keep the head fixed while the shaft stretches.",
  source: `import { Canvas, Flex, Symbol, Text } from "@boundsvg/core";
import { geometryDoc, pathGeometry, groupGeometry, symbolDefinition } from "@boundsvg/shape";

// Define arrow with elastic segments: fixed head + stretch shaft
const arrow = symbolDefinition({
  geometry: geometryDoc({ width: 200, height: 20 },
    groupGeometry([
      pathGeometry("M0 7H170V13H0Z", { nodeId: "shaft" }),
      pathGeometry("M170 0L200 10L170 20Z", { nodeId: "head" }),
    ])),
  elasticSegments: [
    { nodeId: "shaft", axis: "x", role: "stretch",
      frame: { x: 0, y: 0, width: 170, height: 20 } },
    { nodeId: "head", axis: "x", role: "fixed-end",
      frame: { x: 170, y: 0, width: 30, height: 20 } },
  ],
});

// Same symbol at different widths — head stays fixed, shaft stretches
const vnode = Canvas(
  { width: 920, height: 420, background: "#1a1a1a" },
  Flex(
    { direction: "column", width: 920, height: 420, gap: 20,
      padding: [28, 48, 24, 48], justifyContent: "center", alignItems: "center" },
    Symbol({ symbol: arrow, width: 200, height: 30,
      fill: "#f59e0b", stroke: "#fcd34d", strokeWidth: 2 }),
    Symbol({ symbol: arrow, width: 360, height: 30,
      fill: "#10b981", stroke: "#5eead4", strokeWidth: 2 }),
    Symbol({ symbol: arrow, width: 560, height: 30,
      fill: "#6366f1", stroke: "#a5b4fc", strokeWidth: 2 }),
    Text({ font: "${FA}", fontSizePx: 18, color: "#94a3b8" },
      "Elastic segments — fill and outline both keep head fixed while shaft stretches"),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildElasticArrowCanvas(),
};

export const symbolRegistryPreset: Preset = {
  title: "Symbol: Registry",
  description:
    "Registers a callout geometry via engine.registerGeometry(), then renders the same closed-region border through geometryId.",
  source: `import { Canvas, Flex, Shape, Text } from "@boundsvg/core";
import { geometryDoc, pathGeometry } from "@boundsvg/shape";

// Define a callout geometry
const calloutGeometry = geometryDoc(
  { width: 200, height: 120 },
  pathGeometry("M16 0H184C192.837 0 200 7.163 200 16V80C200 88.837 192.837 96 184 96H110L100 120L90 96H16C7.163 96 0 88.837 0 80V16C0 7.163 7.163 0 16 0Z"),
);

// Register geometry — reusable by geometryId across multiple Shape calls
engine.registerGeometry("callout", calloutGeometry);

// Reference by geometryId instead of inline geometry
const vnode = Canvas(
  { width: 920, height: 320, background: "#1a1a1a" },
  Flex(
    { direction: "column", justifyContent: "center",
      alignItems: "center", width: 920, height: 320, gap: 16 },
    Shape({
      geometryId: "callout",
      width: 400, height: 240,
      fill: "#0f172a", stroke: "#334155", strokeWidth: 2,
    }),
    Text({ font: "${FA}", fontSizePx: 20, color: "#94a3b8" },
      'Registry — geometryId="callout" shares the same border path'),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: (engine) => {
    if (engine) {
      engine.registerGeometry("callout", CALLOUT_GEOMETRY);
    }
    return Canvas(
      { width: 920, height: 320, background: "#1a1a1a" },
      Flex(
        {
          direction: "column",
          justifyContent: "center",
          alignItems: "center",
          width: 920,
          height: 320,
          gap: 16,
        },
        Shape({
          geometryId: "callout",
          width: 400,
          height: 240,
          fill: "#0f172a",
          stroke: "#334155",
          strokeWidth: 2,
        }),
        Text(
          { font: FA, fontSizePx: 20, color: "#94a3b8" },
          'Registry — geometryId="callout" shares the same border path',
        ),
      ),
    );
  },
};
