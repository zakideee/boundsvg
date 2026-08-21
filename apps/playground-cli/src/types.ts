export type CodeTab = "component" | "scene" | "svg" | "png" | "tsx";

export type PresetDefinition = {
  key: string;
  title: string;
  svg?: string;
  svgUrl?: string;
  sourceLabel?: string;
  sourceRepo?: string;
  sourceCommit?: string;
  sourcePath?: string;
  license?: string;
};

export type PresetSourceDefinition = {
  key: string;
  title: string;
  presets: PresetDefinition[];
};

export type PresetGroupDefinition = {
  key: string;
  title: string;
  sources: PresetSourceDefinition[];
};
