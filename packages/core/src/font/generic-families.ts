/**
 * CSS generic font-family keywords. These are never registered in the engine
 * font registry: the vector layout path ignores them, and PNG rasterization
 * resolves them via `EngineOptions.fontFamilies`. Compare lowercased values.
 */
export const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
]);
