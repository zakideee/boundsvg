import {
  Box,
  Canvas,
  evaluateGeometryParts,
  Flex,
  type GeometryDoc,
  Shape,
  Text,
  type VNode,
} from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

// group[ path#bg, boolean#ribbon (fused), unnamed path -> positional id ]
const BADGE_GEOMETRY: GeometryDoc = {
  viewBox: { width: 300, height: 200 },
  root: {
    kind: "group",
    nodeId: "badge",
    children: [
      {
        kind: "path",
        nodeId: "bg",
        d: "M20 0H280C291 0 300 9 300 20V180C300 191 291 200 280 200H20C9 200 0 191 0 180V20C0 9 9 0 20 0Z",
      },
      {
        kind: "boolean",
        nodeId: "ribbon",
        op: "union",
        children: [
          { kind: "path", d: "M20 80H160V120H20Z" },
          { kind: "path", d: "M140 70H280V110H140Z" },
        ],
      },
      { kind: "path", d: "M240 20H280V60H240Z" },
    ],
  },
};

const DISPLAY = { left: 60, top: 72, width: 450, height: 300 };
const SCALE_X = DISPLAY.width / 300;
const SCALE_Y = DISPLAY.height / 200;
const PART_COLORS = ["#38bdf8", "#facc15", "#34d399"] as const;

function buildPartInspectionCanvas(): VNode {
  const parts = evaluateGeometryParts(BADGE_GEOMETRY);
  const overlays: VNode[] = [];
  const legend: VNode[] = [];

  for (const [index, part] of parts.entries()) {
    const color = PART_COLORS[index % PART_COLORS.length] ?? "#38bdf8";
    const bounds = part.bounds;
    if (bounds) {
      overlays.push(
        Box({
          position: "absolute",
          left: DISPLAY.left + bounds.x * SCALE_X,
          top: DISPLAY.top + bounds.y * SCALE_Y,
          width: bounds.width * SCALE_X,
          height: bounds.height * SCALE_Y,
          borderWidth: 1,
          borderColor: color,
          strokeDasharray: "5,4",
          borderRadius: 2,
        }),
        Text(
          {
            font: FA,
            fontSizePx: 12,
            color,
            width: 160,
            wrap: "none",
            position: "absolute",
            left: DISPLAY.left + bounds.x * SCALE_X + 4,
            top: DISPLAY.top + bounds.y * SCALE_Y - 16,
          },
          part.partId,
        ),
      );
      legend.push(
        Text(
          { font: FA, fontSizePx: 13, color, width: 300, wrap: "none" },
          `${part.partId}  (${Math.round(bounds.width)}x${Math.round(bounds.height)} @ ${Math.round(bounds.x)},${Math.round(bounds.y)})`,
        ),
      );
    }
  }

  return Canvas(
    { width: 920, height: 420, background: "#1a1a1a" },
    Text(
      {
        font: FA,
        fontSizePx: 13,
        color: "#94a3b8",
        width: 820,
        wrap: "none",
        position: "absolute",
        left: 60,
        top: 28,
      },
      "evaluateGeometryParts + emitPartIds - check the rendered SVG source for data-boundsvg-part-id / data-boundsvg-meta-*",
    ),
    Shape({
      geometry: BADGE_GEOMETRY,
      width: DISPLAY.width,
      height: DISPLAY.height,
      fill: "#1e293b",
      stroke: "#475569",
      strokeWidth: 2,
      emitPartIds: true,
      meta: { role: "badge", variant: "demo" },
      position: "absolute",
      left: DISPLAY.left,
      top: DISPLAY.top,
    }),
    ...overlays,
    Box(
      {
        position: "absolute",
        left: 580,
        top: 96,
        width: 300,
        height: 170,
        padding: 16,
        background: "#0f172a",
        borderWidth: 1,
        borderColor: "#334155",
        borderRadius: 12,
      },
      Flex(
        { direction: "column", gap: 10, width: 268 },
        Text(
          { font: FA, fontSizePx: 14, color: "#e2e8f0", width: 268, wrap: "none" },
          "Addressable parts",
        ),
        ...legend,
        Text(
          { font: FA, fontSizePx: 11, color: "#64748b", width: 268, wrap: "char", lineHeight: 1.4 },
          "group/transform children stay addressable; the boolean ribbon fused into one part; the unnamed path got a positional id.",
        ),
      ),
    ),
  );
}

export const partInspectionPreset: Preset = {
  title: "Part Inspection",
  description:
    "Part identity survives to the output: emitPartIds tags one path per addressable part (data-boundsvg-part-id) - the structural Shape-IR emits parts as native paths in the document, not as a nested compiled svg. evaluateGeometryParts exposes per-part bounds for the dashed overlays, and meta rides along as data-boundsvg-meta-*.",
  source: `import { Canvas, Shape, evaluateGeometryParts } from "@boundsvg/core";

// Parts follow the authoring tree: group children stay addressable,
// a boolean node fuses into ONE part, unnamed nodes get positional ids.
const parts = evaluateGeometryParts(BADGE_GEOMETRY);
// -> [{ partId: "bg", bounds }, { partId: "ribbon", bounds }, { partId: "part:2", bounds }]

const vnode = Canvas(
  { width: 920, height: 420, background: "#1a1a1a" },
  Shape({
    geometry: BADGE_GEOMETRY, width: 450, height: 300,
    fill: "#1e293b", stroke: "#475569", strokeWidth: 2,
    emitPartIds: true,                        // <path data-boundsvg-part-id="..."> per part
    meta: { role: "badge", variant: "demo" }, // data-boundsvg-meta-* on the node
    position: "absolute", left: 60, top: 72,
  }),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildPartInspectionCanvas(),
};
