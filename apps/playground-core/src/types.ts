import type { Engine, RenderAnimatedSvgOptions, VNode } from "@boundsvg/core";

/** Authored sample scene, its displayed source, and optional animation metadata. */
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
  /** Animated SVG preview options. Omitted presets keep independent playback. */
  animatedSvgOptions?: RenderAnimatedSvgOptions;
};

/** Active obstacle section and pointer offset within the scene. */
export type DragTarget = {
  preset: string;
  section: string;
  offsetX: number;
  offsetY: number;
};

/** Hit obstacle section with the pointer offset needed to preserve dragging position. */
export type HitResult = { section: string; offsetX: number; offsetY: number };
