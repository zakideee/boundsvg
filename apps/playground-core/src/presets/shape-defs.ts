import {
  booleanGeometry,
  geometryDoc,
  groupGeometry,
  pathGeometry,
  symbolDefinition,
} from "@boundsvg/shape";

// ---------------------------------------------------------------------------
// Pill — simple rounded rectangle
// ---------------------------------------------------------------------------

export const PILL_GEOMETRY = geometryDoc(
  { width: 140, height: 64 },
  pathGeometry(
    "M32 0H108C125.673 0 140 14.327 140 32C140 49.673 125.673 64 108 64H32C14.327 64 0 49.673 0 32C0 14.327 14.327 0 32 0Z",
  ),
);

export const BADGE_GEOMETRY = geometryDoc(
  { width: 120, height: 120 },
  pathGeometry("M60 0L104 22V70L60 120L16 70V22Z"),
);

export const ARC_RELATIVE_GEOMETRY = geometryDoc(
  { width: 200, height: 120 },
  pathGeometry(
    "m20 60a40 40 0 0 1 40 -40h80a40 40 0 0 1 40 40a40 40 0 0 1 -40 40h-80a40 40 0 0 1 -40 -40z",
  ),
);

export const SELF_INTERSECT_GEOMETRY = geometryDoc(
  { width: 164, height: 120 },
  pathGeometry("M20 16L144 104L20 104L144 16Z"),
);

// ---------------------------------------------------------------------------
// Notch card — boolean subtract (card − notch circle)
// ---------------------------------------------------------------------------

const cardPath = pathGeometry(
  "M16 0H284C292.837 0 300 7.163 300 16V184C300 192.837 292.837 200 284 200H16C7.163 200 0 192.837 0 184V16C0 7.163 7.163 0 16 0Z",
);
const notchCircle = pathGeometry(
  "M150 0C150 16.569 138.807 30 125 30C111.193 30 100 16.569 100 0C100 -16.569 111.193 -30 125 -30C138.807 -30 150 -16.569 150 0Z",
);

export const CARD_GEOMETRY = geometryDoc({ width: 300, height: 200 }, cardPath);
export const NOTCH_CIRCLE_GEOMETRY = geometryDoc(
  { x: 100, y: -30, width: 50, height: 60 },
  notchCircle,
);
export const DIVIDE_LHS_GEOMETRY = geometryDoc({ width: 300, height: 200 }, cardPath);
export const DIVIDE_RHS_GEOMETRY = geometryDoc(
  { x: 100, y: -30, width: 50, height: 60 },
  notchCircle,
);
export const DIVIDE_SOURCE_VIEWBOX = { x: 0, y: -30, width: 300, height: 230 };

export const NOTCH_CARD_GEOMETRY = geometryDoc(
  { width: 300, height: 200 },
  booleanGeometry("subtract", [cardPath, notchCircle]),
);

const unionLeftPanel = pathGeometry("M0 0H120V80H0Z");
const unionRightPanel = pathGeometry("M80 20H200V100H80Z");

export const UNION_BUBBLE_GEOMETRY = geometryDoc(
  { width: 200, height: 120 },
  booleanGeometry("union", [unionLeftPanel, unionRightPanel]),
);

export const XOR_BUBBLE_GEOMETRY = geometryDoc(
  { width: 200, height: 120 },
  booleanGeometry("xor", [unionLeftPanel, unionRightPanel]),
);

// ---------------------------------------------------------------------------
// Arrow — elastic segments (fixed head + stretch shaft + fixed tail)
// ---------------------------------------------------------------------------

const arrowShaft = pathGeometry("M0 7H170V13H0Z", { nodeId: "shaft" });
const arrowHead = pathGeometry("M170 0L200 10L170 20Z", { nodeId: "head" });

export const ARROW_SYMBOL = symbolDefinition({
  geometry: geometryDoc({ width: 200, height: 20 }, groupGeometry([arrowShaft, arrowHead])),
  elasticSegments: [
    {
      nodeId: "shaft",
      axis: "x",
      role: "stretch",
      frame: { x: 0, y: 0, width: 170, height: 20 },
    },
    {
      nodeId: "head",
      axis: "x",
      role: "fixed-end",
      frame: { x: 170, y: 0, width: 30, height: 20 },
    },
  ],
});

// ---------------------------------------------------------------------------
// Callout — speech-bubble for registry demo
// ---------------------------------------------------------------------------

export const CALLOUT_GEOMETRY = geometryDoc(
  { width: 200, height: 120 },
  pathGeometry(
    "M16 0H184C192.837 0 200 7.163 200 16V80C200 88.837 192.837 96 184 96H110L100 120L90 96H16C7.163 96 0 88.837 0 80V16C0 7.163 7.163 0 16 0Z",
  ),
);
