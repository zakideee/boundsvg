import type { DebugOverlayPart } from "@boundsvg/react";
import type { RendererMode } from "../../types";

export type ShapePresetKey =
  | "pill"
  | "notch-card"
  | "arrow"
  | "callout"
  | "opacity"
  | "parts"
  | "part-paint"
  | "boolean-analysis"
  | "normalize-paths";

export type ShapesPageState = {
  preset: ShapePresetKey;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  debugOverlayParts: DebugOverlayPart[];
  renderer: RendererMode;
};
