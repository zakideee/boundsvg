import { loadWasmModule } from "@boundsvg/browser";
import { preloadFonts } from "@boundsvg/browser/fonts";
import { createEngineAsync, type Engine } from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";
import { FONT_ALIAS, FONT_URL } from "./config";

export async function initEngine(): Promise<Engine> {
  const wasmModule = await loadWasmModule();
  await initWasm(wasmModule);

  return createEngineAsync({
    fonts: await preloadFonts([
      { alias: FONT_ALIAS, weight: 400, style: "normal", source: FONT_URL },
    ]),
  });
}
