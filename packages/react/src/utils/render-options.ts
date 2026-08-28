import type { CompileOptions, OutputCommonOptions, RenderIrOptions } from "@boundsvg/core";
import type { BoundSvgDefaultCommonOptions } from "../types.js";

export function pickCompileOptions(
  defaults: BoundSvgDefaultCommonOptions | undefined,
): CompileOptions {
  return {
    ...(defaults?.skipValidation !== undefined && { skipValidation: defaults.skipValidation }),
    ...(defaults?.textPathMode !== undefined && { textPathMode: defaults.textPathMode }),
  };
}

export function pickOutputCommonOptions(
  defaults: BoundSvgDefaultCommonOptions | undefined,
): OutputCommonOptions {
  return {
    ...(defaults?.scale !== undefined && { scale: defaults.scale }),
    ...(defaults?.debug !== undefined && { debug: defaults.debug }),
    ...(defaults?.onWarning !== undefined && { onWarning: defaults.onWarning }),
    ...(defaults?.showMissingGlyphs !== undefined && {
      showMissingGlyphs: defaults.showMissingGlyphs,
    }),
    ...(defaults?.generator !== undefined && { generator: defaults.generator }),
  };
}

export function pickRenderIrOptions(
  defaults: BoundSvgDefaultCommonOptions | undefined,
): RenderIrOptions {
  return {
    ...pickCompileOptions(defaults),
    ...(defaults?.onWarning !== undefined && { onWarning: defaults.onWarning }),
    ...(defaults?.showMissingGlyphs !== undefined && {
      showMissingGlyphs: defaults.showMissingGlyphs,
    }),
  };
}
