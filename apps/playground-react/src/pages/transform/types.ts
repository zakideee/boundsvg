import type { VNode } from "@boundsvg/react";

export type TransformPresetKey =
  | "translate-only"
  | "rotate-with-origin"
  | "scale-negative"
  | "nested-transform"
  | "all-node-types";

export type TransformPageState = {
  preset: TransformPresetKey;
  canvasWidth: number;
  canvasHeight: number;
  bgColor: string;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
  originX: number;
  originY: number;
};

export type TransformPresetDef = {
  label: string;
  description: string;
  overrides?: Partial<TransformPageState>;
  build: (state: TransformPageState) => VNode;
};
