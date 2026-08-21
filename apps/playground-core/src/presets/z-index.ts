import { Box, Canvas, Flex, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

const CARD_COLORS = ["#2563eb", "#f59e0b", "#10b981"] as const;

function overlappingCards(zIndexes: readonly (number | undefined)[]) {
  return Box(
    { width: 400, height: 200 },
    ...zIndexes.map((zIndex, index) =>
      Box({
        id: `card-z${zIndex ?? "none"}-${index}`,
        width: 180,
        height: 120,
        background: CARD_COLORS[index % CARD_COLORS.length],
        borderRadius: 14,
        borderWidth: 2,
        borderColor: "#f8fafc",
        position: "absolute",
        top: 20 + index * 24,
        left: 20 + index * 90,
        ...(zIndex === undefined ? {} : { zIndex }),
      }),
    ),
  );
}

function panel(title: string, subtitle: string, zIndexes: readonly (number | undefined)[]) {
  return Flex(
    { direction: "column", gap: 8, width: 420 },
    Text({ font: FA, fontSizePx: 16, color: "#e2e8f0" }, title),
    Text({ font: FA, fontSizePx: 12, color: "#64748b", wrap: "char" }, subtitle),
    overlappingCards(zIndexes),
  );
}

function buildZIndexCanvas() {
  return Canvas(
    { width: 920, height: 340, background: "#1a1a1a" },
    Flex(
      {
        direction: "row",
        width: 920,
        height: 340,
        padding: 24,
        gap: 24,
        justifyContent: "center",
        alignItems: "center",
      },
      panel("Source order (no zIndex)", "Later siblings paint on top: blue, amber, green.", [
        undefined,
        undefined,
        undefined,
      ]),
      panel(
        "zIndex 3 / 2 / 1",
        "Same source order, reversed paint order: blue ends up on top.",
        [3, 2, 1],
      ),
    ),
  );
}

export const zIndexPreset: Preset = {
  title: "Z-Index",
  description:
    "Sibling-local paint order. zIndex reorders siblings (stable, integer, higher paints later) without CSS stacking contexts — a child never escapes its parent's paint position.",
  source: `import { Box, Canvas, Flex } from "@boundsvg/core";

// Without zIndex, later siblings paint on top.
// With zIndex, siblings are reordered locally (ties keep source order).
const vnode = Canvas(
  { width: 920, height: 340, background: "#1a1a1a" },
  Flex(
    { direction: "row", padding: 24, gap: 24 },
    // source order: blue, amber, green -> green on top
    Box({ width: 400, height: 200 },
      Box({ position: "absolute", top: 20, left: 20,  width: 180, height: 120, background: "#2563eb" }),
      Box({ position: "absolute", top: 44, left: 110, width: 180, height: 120, background: "#f59e0b" }),
      Box({ position: "absolute", top: 68, left: 200, width: 180, height: 120, background: "#10b981" }),
    ),
    // zIndex 3/2/1 -> blue on top, without touching source order
    Box({ width: 400, height: 200 },
      Box({ zIndex: 3, position: "absolute", top: 20, left: 20,  width: 180, height: 120, background: "#2563eb" }),
      Box({ zIndex: 2, position: "absolute", top: 44, left: 110, width: 180, height: 120, background: "#f59e0b" }),
      Box({ zIndex: 1, position: "absolute", top: 68, left: 200, width: 180, height: 120, background: "#10b981" }),
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildZIndexCanvas(),
};
