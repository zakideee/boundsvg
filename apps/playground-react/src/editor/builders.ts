import { Box, Canvas, Flex, type GeometryDoc, Shape, Svg, Text, type VNode } from "@boundsvg/core";
import type { BoundSvgConfig, FontDefinition } from "@boundsvg/react/provider";
import { asset } from "../lib/asset";
import type {
  AssetRenderCacheMap,
  CompositionPlacementMap,
  EditorAssetId,
  EditorAssetState,
  EditorFontKey,
} from "./atoms";
import { EDITOR_ASSET_IDS } from "./atoms";

// This editor splits scenes with @boundsvg/core builder functions because
// toVNode() only resolves boundsvg phantom components, not arbitrary React components.
export const COMPOSITION_CANVAS = {
  width: 960,
  height: 620,
} as const;

export const EDITOR_FONT_OPTIONS: Array<{ value: EditorFontKey; label: string }> = [
  { value: "sans", label: "Sans / Noto Sans JP" },
  { value: "serif", label: "Serif / Noto Serif JP" },
  { value: "rounded", label: "Rounded / Zen Maru Gothic" },
];

const FONT_SOURCES: Record<EditorFontKey, string> = {
  sans: asset("/fonts/NotoSansJP-Regular.subset.woff2"),
  serif: asset("/fonts/NotoSerifJP-Regular.subset.woff2"),
  rounded: asset("/fonts/ZenMaruGothic-Regular.subset.woff2"),
};

const FONT_ALIASES: Record<EditorAssetId, Record<EditorFontKey, string>> = {
  headline: {
    sans: "EditorHeadlineSans",
    serif: "EditorHeadlineSerif",
    rounded: "EditorHeadlineRounded",
  },
  badge: {
    sans: "EditorBadgeSans",
    serif: "EditorBadgeSerif",
    rounded: "EditorBadgeRounded",
  },
  stamp: {
    sans: "EditorStampSans",
    serif: "EditorStampSerif",
    rounded: "EditorStampRounded",
  },
};

function buildFontDefinitions(assetId: EditorAssetId): FontDefinition[] {
  return EDITOR_FONT_OPTIONS.map((option) => ({
    alias: FONT_ALIASES[assetId][option.value],
    weight: 400,
    style: "normal",
    source: FONT_SOURCES[option.value],
  }));
}

export const ASSET_PROVIDER_CONFIGS: Record<EditorAssetId, BoundSvgConfig> = {
  headline: {
    fonts: buildFontDefinitions("headline"),
    defaultRenderOptions: { textPathMode: "merged" },
  },
  badge: {
    fonts: buildFontDefinitions("badge"),
    defaultRenderOptions: { textPathMode: "merged" },
  },
  stamp: {
    fonts: buildFontDefinitions("stamp"),
    defaultRenderOptions: { textPathMode: "merged" },
  },
};

export const COMPOSITION_PROVIDER_CONFIG: BoundSvgConfig = { fonts: [] };

function resolveFontAlias(assetId: EditorAssetId, fontKey: EditorFontKey): string {
  return FONT_ALIASES[assetId][fontKey];
}

function headlineFontSize(state: EditorAssetState): number {
  return Math.max(30, Math.round(state.canvasHeight * 0.26));
}

// Lower-third telop: light base bar, accent block, and broadcast-style
// multilayer edging (dark outline + white inner) with a soft drop shadow.
function buildHeadlineAssetVNode(state: EditorAssetState): VNode {
  const font = resolveFontAlias("headline", state.fontKey);
  const barHeight = Math.round(state.canvasHeight * 0.56);
  const barTop = state.canvasHeight - barHeight - 12;
  const accentWidth = 16;
  const textLeft = 12 + accentWidth + 18;
  return Canvas(
    { width: state.canvasWidth, height: state.canvasHeight },
    Box({
      position: "absolute",
      left: 12,
      top: barTop,
      width: state.canvasWidth - 24,
      height: barHeight,
      background: state.backgroundColor,
      borderRadius: 10,
      boxShadow: "0 6 18 rgba(0, 0, 0, 0.45)",
    }),
    Box({
      position: "absolute",
      left: 12,
      top: barTop,
      width: accentWidth,
      height: barHeight,
      background: state.accentColor,
      borderRadius: 10,
    }),
    Box({
      position: "absolute",
      left: 12 + accentWidth + 10,
      top: barTop + barHeight - 10,
      width: state.canvasWidth - textLeft - 22,
      height: 4,
      background: state.accentColor,
      borderRadius: 2,
      opacity: 0.85,
    }),
    Flex(
      {
        direction: "column",
        justifyContent: "center",
        position: "absolute",
        left: textLeft,
        top: barTop,
        width: state.canvasWidth - textLeft - 24,
        height: barHeight - 12,
      },
      Text(
        {
          font,
          fontSizePx: headlineFontSize(state),
          color: state.textColor,
          wrap: "char",
          fit: "shrink",
          minFontSizePx: 18,
          maxLines: 1,
          lineHeight: 1.05,
          preferredFrame: { w: state.canvasWidth - textLeft - 24 },
          textStrokes: [
            { color: "#0b1220", widthPx: 7 },
            { color: "#ffffff", widthPx: 3 },
          ],
          textShadows: [{ dx: 2, dy: 3, blurPx: 4, color: "rgba(0, 0, 0, 0.55)" }],
        },
        state.text,
      ),
    ),
  );
}

// Badge plate with addressable parts: partPaint recolors the ribbon and gem
// from the shared asset colors without touching the plate geometry.
const BADGE_GEOMETRY: GeometryDoc = {
  viewBox: { width: 300, height: 160 },
  root: {
    kind: "group",
    nodeId: "badge",
    children: [
      {
        kind: "path",
        nodeId: "plate",
        d: "M18 0H282C292 0 300 8 300 18V142C300 152 292 160 282 160H18C8 160 0 152 0 142V18C0 8 8 0 18 0Z",
      },
      {
        kind: "boolean",
        nodeId: "ribbon",
        op: "union",
        children: [
          { kind: "path", d: "M0 58H190V102H0Z" },
          { kind: "path", d: "M170 50H300V94H170Z" },
        ],
      },
      { kind: "path", nodeId: "gem", d: "M258 16H288V46H258Z" },
    ],
  },
};

function badgeFontSize(state: EditorAssetState): number {
  return Math.max(18, Math.round(state.canvasHeight * 0.2));
}

function buildBadgeAssetVNode(state: EditorAssetState): VNode {
  const font = resolveFontAlias("badge", state.fontKey);
  return Canvas(
    { width: state.canvasWidth, height: state.canvasHeight },
    Shape({
      geometry: BADGE_GEOMETRY,
      width: state.canvasWidth,
      height: state.canvasHeight,
      fill: state.backgroundColor,
      emitPartIds: true,
      partPaint: {
        ribbon: { fill: state.accentColor },
        gem: { fill: state.textColor },
      },
      position: "absolute",
      left: 0,
      top: 0,
    }),
    Flex(
      {
        direction: "column",
        justifyContent: "center",
        alignItems: "center",
        position: "absolute",
        left: 0,
        top: Math.round(state.canvasHeight * 0.3),
        width: state.canvasWidth,
        height: Math.round(state.canvasHeight * 0.34),
      },
      Text(
        {
          font,
          fontSizePx: badgeFontSize(state),
          color: state.textColor,
          wrap: "none",
          fit: "shrink",
          minFontSizePx: 12,
          letterSpacingPx: 3,
          textAlign: "center",
          preferredFrame: { w: state.canvasWidth - 60 },
          textShadows: [{ dx: 1, dy: 2, blurPx: 2, color: "rgba(0, 0, 0, 0.4)" }],
        },
        state.text,
      ),
    ),
  );
}

// Ring seal from a circle-minus-circle boolean. The rendered source shows the
// ring as compact C segments - boolean output re-fits curves.
const STAMP_GEOMETRY: GeometryDoc = {
  viewBox: { width: 200, height: 200 },
  root: {
    kind: "group",
    nodeId: "seal",
    children: [
      {
        kind: "boolean",
        nodeId: "ring",
        op: "subtract",
        children: [
          {
            kind: "path",
            d: "M196 100C196 153.019 153.019 196 100 196C46.981 196 4 153.019 4 100C4 46.981 46.981 4 100 4C153.019 4 196 46.981 196 100Z",
          },
          {
            kind: "path",
            d: "M182 100C182 145.287 145.287 182 100 182C54.713 182 18 145.287 18 100C18 54.713 54.713 18 100 18C145.287 18 182 54.713 182 100Z",
          },
        ],
      },
      {
        kind: "boolean",
        nodeId: "inner-ring",
        op: "subtract",
        children: [
          {
            kind: "path",
            d: "M172 100C172 139.765 139.765 172 100 172C60.235 172 28 139.765 28 100C28 60.235 60.235 28 100 28C139.765 28 172 60.235 172 100Z",
          },
          {
            kind: "path",
            d: "M166 100C166 136.451 136.451 166 100 166C63.549 166 34 136.451 34 100C34 63.549 63.549 34 100 34C136.451 34 166 63.549 166 100Z",
          },
        ],
      },
    ],
  },
};

function stampFontSize(state: EditorAssetState): number {
  return Math.max(18, Math.round(Math.min(state.canvasWidth, state.canvasHeight) * 0.16));
}

function buildStampAssetVNode(state: EditorAssetState): VNode {
  const font = resolveFontAlias("stamp", state.fontKey);
  const diameter = Math.min(state.canvasWidth, state.canvasHeight) - 8;
  const left = Math.round((state.canvasWidth - diameter) / 2);
  const top = Math.round((state.canvasHeight - diameter) / 2);
  // A fixed label width is what makes fit:"shrink" engage - the centered
  // flex would otherwise grant the text its intrinsic width.
  const labelWidth = Math.round(diameter * 0.56);
  return Canvas(
    { width: state.canvasWidth, height: state.canvasHeight },
    Shape({
      geometry: STAMP_GEOMETRY,
      width: diameter,
      height: diameter,
      fill: state.accentColor,
      emitPartIds: true,
      position: "absolute",
      left,
      top,
    }),
    Flex(
      {
        direction: "column",
        justifyContent: "center",
        alignItems: "center",
        position: "absolute",
        left,
        top,
        width: diameter,
        height: diameter,
      },
      Text(
        {
          font,
          fontSizePx: stampFontSize(state),
          color: state.textColor,
          wrap: "none",
          fit: "shrink",
          minFontSizePx: 12,
          letterSpacingPx: 4,
          textAlign: "center",
          // Keep the label inside the inner ring.
          width: labelWidth,
        },
        state.text,
      ),
    ),
  );
}

export function buildAssetVNode(assetId: EditorAssetId, state: EditorAssetState): VNode {
  switch (assetId) {
    case "headline":
      return buildHeadlineAssetVNode(state);
    case "badge":
      return buildBadgeAssetVNode(state);
    case "stamp":
      return buildStampAssetVNode(state);
  }
}

export function buildCompositionVNode(
  renderCache: AssetRenderCacheMap,
  placements: CompositionPlacementMap,
  selectedId: EditorAssetId | null,
  handlers: Record<EditorAssetId, string>,
): VNode {
  // Asset previews render text as paths and feed the resulting self-contained SVG
  // strings back into the main canvas as nested Svg nodes. This avoids font alias
  // collisions across isolated providers while keeping whole-canvas export stable.
  const stageChildren = EDITOR_ASSET_IDS.flatMap((assetId) => {
    const placement = placements[assetId];
    const cached = renderCache[assetId];
    const isSelected = selectedId === assetId;
    const children: VNode[] = [];

    // Selection visuals are handled entirely by the DOM overlay — no SVG-level
    // decoration is needed, which avoids the previous double-border issue.

    if (cached.svg) {
      children.push(
        Svg({
          id: assetId,
          content: cached.svg,
          width: placement.width,
          height: placement.height,
          position: "absolute",
          left: placement.x,
          top: placement.y,
          opacity: isSelected ? 1 : 0.97,
          preserveAspectRatio: "meet",
          contentIdPrefix: `editor-${assetId}-`,
          onPointerDown: handlers[assetId],
        }),
      );
    } else {
      children.push(
        Box({
          id: `${assetId}-placeholder`,
          position: "absolute",
          left: placement.x,
          top: placement.y,
          width: placement.width,
          height: placement.height,
          background: "#1e1e1e",
          borderWidth: 1,
          borderColor: "#474747",
          borderRadius: 18,
          opacity: 0.88,
        }),
      );
    }

    return children;
  });

  return Canvas(
    {
      width: COMPOSITION_CANVAS.width,
      height: COMPOSITION_CANVAS.height,
      background: "#07101f",
    },
    Box(
      {
        id: "composition-stage",
        position: "relative",
        width: COMPOSITION_CANVAS.width,
        height: COMPOSITION_CANVAS.height,
        overflow: "clip",
      },
      ...stageChildren,
    ),
  );
}
