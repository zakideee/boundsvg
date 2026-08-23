import type { BoundSvgConfig, FontDefinition } from "@boundsvg/react/provider";
import { asset } from "./lib/asset";

// ---------------------------------------------------------------------------
// Font definitions
// ---------------------------------------------------------------------------
/** Variation axis descriptor for variable fonts. */
type VariationAxis = {
  tag: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
};

type FontDef = {
  alias: string;
  label: string;
  fileName: string;
  /** Supported variation axes (present only for variable fonts). */
  axes?: VariationAxis[];
  /** OpenType feature tags supported by this font (from GSUB/GPOS tables). */
  features?: string[];
};

export const FONT_DEFS: FontDef[] = [
  {
    alias: "NotoSansJP",
    label: "Noto Sans JP",
    fileName: "NotoSansJP-Regular.subset",
    features: ["kern", "liga"],
  },
  {
    alias: "NotoSerifJP",
    label: "Noto Serif JP",
    fileName: "NotoSerifJP-Regular.subset",
    features: ["kern", "liga"],
  },
  {
    alias: "ZenMaruGothic",
    label: "Zen Maru Gothic",
    fileName: "ZenMaruGothic-Regular.subset",
    features: ["frac", "kern"],
  },
  {
    alias: "Inter",
    label: "Inter (Variable)",
    fileName: "Inter-Variable",
    axes: [
      { tag: "wght", label: "Weight", min: 100, max: 900, step: 1, defaultValue: 400 },
      { tag: "opsz", label: "Optical Size", min: 14, max: 32, step: 1, defaultValue: 14 },
    ],
    features: ["frac", "kern", "pnum", "salt", "tnum", "zero"],
  },
  {
    alias: "NotoSansCJKjp",
    label: "Noto Sans CJK JP (Variable)",
    fileName: "NotoSansCJKjp-VF.subset",
    axes: [{ tag: "wght", label: "Weight", min: 100, max: 900, step: 1, defaultValue: 100 }],
    features: ["kern", "liga"],
  },
];

type FontFormat = "woff2" | "ttf";

export function fontAlias(family: string, format: FontFormat): string {
  return `${family}-${format}`;
}

const fonts: FontDefinition[] = [
  ...FONT_DEFS.flatMap((def) => {
    if (def.axes) {
      // Variable fonts: TTF only
      return [
        {
          alias: fontAlias(def.alias, "ttf"),
          weight: 400,
          style: "normal" as const,
          source: asset(`/fonts/${def.fileName}.ttf`),
        },
      ];
    }
    // Static fonts: both WOFF2 and TTF
    return (["woff2", "ttf"] as const).map((fmt) => ({
      alias: fontAlias(def.alias, fmt),
      weight: 400,
      style: "normal" as const,
      source: asset(`/fonts/${def.fileName}.${fmt}`),
    }));
  }),
  {
    alias: "JetBrainsMono-woff2",
    weight: 400,
    style: "normal",
    source: asset("/fonts/JetBrainsMono-Regular.woff2"),
  },
  {
    alias: "MonaspaceNeon-woff2",
    weight: 400,
    style: "normal",
    source: asset("/fonts/MonaspaceNeon-Regular.woff2"),
  },
];

export const config: BoundSvgConfig = { fonts };

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------
export type RouteKey =
  | "playground"
  | "templates"
  | "shapes"
  | "text-flow"
  | "api"
  | "compare"
  | "interactive"
  | "worker"
  | "editor"
  | "layered"
  | "animation"
  | "transform"
  | "text-effects"
  | "hit-test";

type RouteDef = {
  key: RouteKey;
  hash: string;
  label: string;
  description: string;
};

type RouteGroupDef = {
  key: string;
  label: string;
  routes: RouteDef[];
};

/**
 * Top navigation, basics -> advanced. `ROUTES` flattens these groups, so the
 * group definitions own the display order; hashes and keys never change.
 */
export const ROUTE_GROUPS: RouteGroupDef[] = [
  {
    key: "basics",
    label: "Basics",
    routes: [
      {
        key: "templates",
        hash: "#/templates",
        label: "Templates",
        description: "Ready-made layout examples",
      },
      {
        key: "playground",
        hash: "#/playground",
        label: "Controls",
        description: "Fine-grained prop controls",
      },
    ],
  },
  {
    key: "layout-drawing",
    label: "Layout & Drawing",
    routes: [
      {
        key: "shapes",
        hash: "#/shapes",
        label: "Shapes",
        description: "Shape, Symbol & geometry registry",
      },
      {
        key: "text-effects",
        hash: "#/text-effects",
        label: "Text Effects",
        description: "Multi-layer outlines and shadows for telop typography",
      },
      {
        key: "transform",
        hash: "#/transform",
        label: "Transform",
        description: "Static post-layout paint transforms on layout containers and leaves",
      },
      {
        key: "animation",
        hash: "#/animation",
        label: "Animation",
        description: "Declarative SVG playback and deterministic time sampling",
      },
      {
        key: "text-flow",
        hash: "#/text-flow",
        label: "Text Flow",
        description: "Obstacle avoidance with draggable exclusions",
      },
    ],
  },
  {
    key: "compose-inspect",
    label: "Compose & Inspect",
    routes: [
      {
        key: "compare",
        hash: "#/compare",
        label: "Layout Compare",
        description: "BoundSvg vs HTML/CSS layout comparison",
      },
      {
        key: "editor",
        hash: "#/editor",
        label: "Multi-SVG Editor",
        description: "Compose multiple SVGs into one canvas",
      },
      {
        key: "layered",
        hash: "#/layered",
        label: "Layered",
        description: "Layer-aware SVG/PNG export",
      },
    ],
  },
  {
    key: "api-runtime",
    label: "API & Runtime",
    routes: [
      {
        key: "api",
        hash: "#/api",
        label: "API Examples",
        description: "Hook API usage examples",
      },
      {
        key: "worker",
        hash: "#/worker",
        label: "Worker",
        description: "Web Worker rendering with async hooks",
      },
    ],
  },
  {
    key: "interaction",
    label: "Interaction",
    routes: [
      {
        key: "interactive",
        hash: "#/interactive",
        label: "Events",
        description: "Pointer and touch event handling",
      },
      {
        key: "hit-test",
        hash: "#/hit-test",
        label: "Hit Test",
        description: "Kernel-precise per-part hit testing on shapes",
      },
    ],
  },
];

/** Initial page; pinned independently of group ordering. */
export const DEFAULT_ROUTE_KEY: RouteKey = "templates";

export const ROUTES: RouteDef[] = ROUTE_GROUPS.flatMap((group) => group.routes);

export const ROUTE_GROUP_BY_ROUTE = new Map<RouteKey, RouteGroupDef>(
  ROUTE_GROUPS.flatMap((group) => group.routes.map((route) => [route.key, group] as const)),
);

export const ROUTE_BY_HASH = new Map<string, RouteKey>(ROUTES.map((r) => [r.hash, r.key]));

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------
export type RendererMode = "boundsvg" | "svg-hook" | "png-hook" | "svg-async" | "png-async";
export type TextPathModeOption = "merged" | "glyphs";
