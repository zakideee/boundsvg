import { loadWasmModule } from "@boundsvg/browser";
import { preloadFonts } from "@boundsvg/browser/fonts";
import { createEngineAsync, type Engine } from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";
import {
  CJK_VARFONT_ALIAS,
  CJK_VARFONT_URL,
  FONT_ALIAS,
  FONT_URL,
  JETBRAINS_ALIAS,
  JETBRAINS_URL,
  MONASPACE_ALIAS,
  MONASPACE_URL,
  VARFONT_ALIAS,
  VARFONT_URL,
} from "./config";

export async function initEngine(): Promise<Engine> {
  const wasmModule = await loadWasmModule();
  await initWasm(wasmModule);

  return createEngineAsync({
    fonts: await preloadFonts([
      { alias: FONT_ALIAS, weight: 400, style: "normal", source: FONT_URL },
      { alias: VARFONT_ALIAS, weight: 400, style: "normal", source: VARFONT_URL },
      { alias: CJK_VARFONT_ALIAS, weight: 400, style: "normal", source: CJK_VARFONT_URL },
      { alias: JETBRAINS_ALIAS, weight: 400, style: "normal", source: JETBRAINS_URL },
      { alias: MONASPACE_ALIAS, weight: 400, style: "normal", source: MONASPACE_URL },
    ]),
  });
}
