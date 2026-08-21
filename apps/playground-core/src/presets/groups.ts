export type PresetGroupDef = {
  key: string;
  label: string;
  presetKeys: string[];
};

export const DEFAULT_PRESET_KEY = "fit";

export const PRESET_GROUPS: PresetGroupDef[] = [
  {
    key: "basics",
    label: "Basics",
    presetKeys: ["fit", "grid"],
  },
  {
    key: "typography",
    label: "Typography",
    presetKeys: [
      "grapheme-clusters",
      "font-fallback",
      "variable-font",
      "inline-primitives",
      "ruby",
      "vertical",
      "text-effects",
    ],
  },
  {
    key: "sizing-flow",
    label: "Sizing & Flow",
    presetKeys: ["shrinkwrap", "measurements", "text-flow", "flow-rich", "bubble-flow"],
  },
  {
    key: "geometry",
    label: "Geometry",
    presetKeys: [
      "shape-primitives",
      "shape-opacity",
      "shape-ops",
      "symbol-registry",
      "symbol-stretch",
      "part-inspection",
      "part-paint",
      "defs-sharing",
    ],
  },
  {
    key: "composition",
    label: "Composition",
    presetKeys: ["transform", "z-index", "layered"],
  },
  {
    key: "interaction",
    label: "Interaction",
    presetKeys: ["mouse"],
  },
  {
    key: "text-motion",
    label: "Text Motion",
    presetKeys: [
      "typing-ime-timeline",
      "text-on-path-basics",
      "decoration-path-fit",
      "rich-text-on-path",
      "text-path-motion",
    ],
  },
];
