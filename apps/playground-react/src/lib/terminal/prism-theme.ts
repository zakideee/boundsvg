import type { TerminalTokenColorMap } from "./types";

export const DEFAULT_TERMINAL_TEXT_COLOR = "#dbeafe";
const DEFAULT_TERMINAL_TAG_PUNCTUATION_COLOR = "#5b8fb8";

const DEFAULT_TERMINAL_TOKEN_COLORS: TerminalTokenColorMap = {
  comment: "#6b7fa0",
  prolog: "#6b7fa0",
  doctype: "#6b7fa0",
  cdata: "#6b7fa0",
  punctuation: "#8b9fc6",
  tag: "#7dd3fc",
  "attr-name": "#a5b4fc",
  "attr-value": "#86efac",
  string: "#86efac",
  number: "#fbbf24",
  boolean: "#fbbf24",
  keyword: "#c084fc",
  operator: "#c084fc",
  function: "#67e8f9",
  "class-name": "#67e8f9",
  builtin: "#f9a8d4",
  script: "#dbeafe",
};

const TERMINAL_COLOR_PRIORITY: readonly (keyof TerminalTokenColorMap)[] = [
  "comment",
  "prolog",
  "doctype",
  "cdata",
  "attr-name",
  "attr-value",
  "string",
  "number",
  "boolean",
  "keyword",
  "operator",
  "function",
  "class-name",
  "builtin",
  "script",
  "tag",
  "punctuation",
];

export function createTerminalTokenColorMap(
  overrides?: Partial<TerminalTokenColorMap>,
): TerminalTokenColorMap {
  return { ...DEFAULT_TERMINAL_TOKEN_COLORS, ...overrides };
}

export function resolveTerminalTokenColor(
  tokenTypes: readonly string[],
  tokenColors: TerminalTokenColorMap,
  defaultTextColor: string = DEFAULT_TERMINAL_TEXT_COLOR,
  tagPunctuationColor: string = DEFAULT_TERMINAL_TAG_PUNCTUATION_COLOR,
): string {
  if (tokenTypes.includes("tag") && tokenTypes.includes("punctuation")) {
    return tagPunctuationColor;
  }
  for (const tokenType of TERMINAL_COLOR_PRIORITY) {
    if (tokenTypes.includes(tokenType)) {
      return tokenColors[tokenType] ?? defaultTextColor;
    }
  }
  return defaultTextColor;
}
