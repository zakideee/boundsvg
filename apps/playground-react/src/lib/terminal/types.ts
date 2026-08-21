import type { VNode } from "@boundsvg/core";

export type TerminalSyntaxLanguage = "tsx" | "typescript" | "jsx" | "javascript" | "markup";
export type TerminalWrapMode = "none" | "char";

export type TerminalPrismTokenType =
  | "comment"
  | "prolog"
  | "doctype"
  | "cdata"
  | "punctuation"
  | "tag"
  | "attr-name"
  | "attr-value"
  | "string"
  | "number"
  | "boolean"
  | "keyword"
  | "operator"
  | "function"
  | "class-name"
  | "builtin"
  | "script";

export type TerminalTokenColorMap = Record<TerminalPrismTokenType, string>;

export type TerminalFontRoleInput = {
  alias: string;
  fallback: string[];
  label: string;
};

export type TerminalFontInput = {
  source: TerminalFontRoleInput;
  output: TerminalFontRoleInput;
};

export type TerminalOutputLineInput = {
  prompt?: string;
  text: string;
  color?: string;
  wrap?: TerminalWrapMode;
};

export type TerminalPaneLayoutInput = {
  splitDirection?: "row" | "column";
  sourceWeight?: number;
  outputWeight?: number;
  gapPx?: number;
  sourceTitle?: string;
  outputTitle?: string;
};

export type TerminalSurfaceInput = {
  canvasWidth?: number;
  canvasHeight?: number;
  frameWidth?: number;
  frameHeight?: number;
  canvasBackground?: string;
};

export type TerminalChromeInput = {
  routeLabel?: string;
  footerLeft?: string;
  footerRight?: string;
};

export type TerminalThemeInput = {
  defaultTextColor?: string;
  tagPunctuationColor?: string;
  tokenColors?: Partial<TerminalTokenColorMap>;
};

export type TerminalDesignInput = {
  code: string;
  language?: TerminalSyntaxLanguage;
  lineNumberStart?: number;
  outputLines: readonly TerminalOutputLineInput[];
  fonts: TerminalFontInput;
  layout?: TerminalPaneLayoutInput;
  surface?: TerminalSurfaceInput;
  chrome?: TerminalChromeInput;
  theme?: TerminalThemeInput;
  licenseNotice?: string;
};

export type TerminalBoundsvgInput = {
  vnode: VNode;
  licenseNotice: string;
  requiredFontAliases: string[];
};

export type PrismTextSegment = {
  text: string;
  tokenTypes: string[];
};

export type TerminalSourceSegment = {
  text: string;
  tokenTypes: string[];
  color: string;
};

export type TerminalSourceLine = {
  lineLabel: string;
  segments: TerminalSourceSegment[];
};

export type TerminalPaneFrame = {
  width: number;
  height: number;
};

export type ResolvedTerminalPaneLayout = {
  splitDirection: "row" | "column";
  gapPx: number;
  source: TerminalPaneFrame;
  output: TerminalPaneFrame;
};
