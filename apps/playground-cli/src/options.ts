import type { DebugOverlayConfig, DebugOverlayPart } from "@boundsvg/core";
import type { AnalyzeSvgOptions } from "@boundsvg/core/svg";
import { DEFAULT_PREVIEW_PNG_SCALE, FONT_ALIAS } from "./config";

function readBBoxOverlayParts(): DebugOverlayPart[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="opt-bbox-part"]'))
    .filter((input) => input.checked)
    .map((input) => input.value as DebugOverlayPart);
}

function resolveDebugOverlayConfig(parts: readonly DebugOverlayPart[]): false | DebugOverlayConfig {
  if (parts.length === 0) {
    return false;
  }
  return { parts };
}

export function getAnalyzeOptions(): AnalyzeSvgOptions {
  const defaultFont =
    (document.getElementById("opt-default-font") as HTMLInputElement).value || FONT_ALIAS;
  const fontMapRaw = (document.getElementById("opt-font-map") as HTMLInputElement).value.trim();
  const wrap = (document.getElementById("opt-wrap") as HTMLSelectElement).value as
    | "word"
    | "char"
    | "none";
  const fit = (document.getElementById("opt-fit") as HTMLSelectElement).value as
    | "shrink"
    | "none"
    | "grow";

  const fontAliasMap: Record<string, string> = {};
  if (fontMapRaw) {
    for (const pair of fontMapRaw.split(",")) {
      const [cssName, alias] = pair.split(":").map((part) => part.trim());
      if (cssName && alias) {
        fontAliasMap[cssName] = alias;
      }
    }
  }

  return {
    defaultFont,
    fontAliasMap: Object.keys(fontAliasMap).length > 0 ? fontAliasMap : undefined,
    wrap,
    fit,
  };
}

export function getRenderOptions(): {
  debug: false | DebugOverlayConfig;
  textPathMode: "merged" | "glyphs";
  scale: number;
} {
  const debug = resolveDebugOverlayConfig(readBBoxOverlayParts());
  const textPathMode = (document.getElementById("opt-text-rendering") as HTMLSelectElement).value as
    | "merged"
    | "glyphs";
  const scaleRaw = Number((document.getElementById("opt-png-scale") as HTMLSelectElement).value);
  const scale =
    Number.isFinite(scaleRaw) && scaleRaw > 0 ? (scaleRaw <= 1 ? 1 : 2) : DEFAULT_PREVIEW_PNG_SCALE;
  return { debug, textPathMode, scale };
}
