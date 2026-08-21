import type { VNode } from "@boundsvg/react";
import type { ReactNode } from "react";

export type ComparePattern = {
  id: string;
  title: string;
  description: string;
  category: "flex" | "grid" | "composite";
  canvasWidth: number;
  canvasHeight: number;
  buildVNode: () => VNode;
  buildHtml: () => ReactNode;
};
