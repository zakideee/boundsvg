import type { Engine, RenderAnimatedSvgOptions, VNode } from "@boundsvg/react";

export type TemplateDef = {
  title: string;
  description: string;
  licenseNotice?: string;
  animatedSvgOptions?: RenderAnimatedSvgOptions;
} & ({ vnode: VNode; build?: never } | { vnode?: never; build: (engine: Engine) => VNode });

export type ViewTab = "preview" | "svg" | "jsx" | "component";
export type CodeLayout = "tab" | "panel";
