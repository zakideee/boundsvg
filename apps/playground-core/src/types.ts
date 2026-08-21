import type { Engine, VNode } from "@boundsvg/core";

export type Preset = {
  title: string;
  description: string;
  build: (engine?: Engine) => VNode;
  source: string;
  /**
   * Total length of the preset's declarative animation. Presets that set it
   * offer animated WebP and GIF export; the rest offer still formats only.
   */
  animationDurationMs?: number;
};

export type DragTarget = {
  preset: string;
  section: string;
  offsetX: number;
  offsetY: number;
};

export type HitResult = { section: string; offsetX: number; offsetY: number };

export type RubyFrag = {
  text: string;
  x: number;
  y: number;
  availableInlineSizePx: number;
  baselineOffset?: number;
  style?: { fontSizePx?: number; color?: string };
  ruby?: {
    text: string;
    position: string;
    style: { fontSizePx: number; color?: string };
    gapPx: number;
  };
};
