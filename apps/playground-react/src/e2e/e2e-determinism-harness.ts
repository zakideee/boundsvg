/**
 * E2E Determinism Harness
 *
 * Loads the browser (web-target) WASM build and exposes a scene renderer on
 * `window` so the Playwright spec can verify that browser output is
 * byte-identical to the Node.js goldens pinned in
 * packages/core/tests/determinism/goldens.json.
 *
 * Font aliases/weights/styles must match the Node golden suite exactly.
 */
import { loadWasmModule } from "@boundsvg/browser";
import { preloadFonts } from "@boundsvg/browser/fonts";
import { createAnimatedRasterCollector, createEngineAsync, type Engine } from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";

type SceneInput = Parameters<Engine["renderToSvg"]>[0];

type DeterminismHarness = {
  renderScene: (sceneJson: string) => Promise<{
    svg: string;
    pngBase64: string;
    webpBase64: string;
    animatedWebpBase64: string;
    animatedGifBase64: string;
  }>;
};

// Must stay in sync with the Node golden suite
// (packages/core/tests/determinism/golden.test.ts).
/** Schedule shared with the Node golden suite to compare exact container bytes. */
const ANIMATED_SCHEDULE = { durationMs: 300, fps: 10, iterations: "infinite" } as const;

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: global augmentation requires interface
  interface Window {
    boundsvgDeterminism?: DeterminismHarness;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function getElementByIdOrThrow(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing harness element #${id}`);
  }
  return element;
}

async function main(): Promise<void> {
  const status = getElementByIdOrThrow("status");
  const errorOut = getElementByIdOrThrow("error");
  try {
    const wasmModule = await loadWasmModule();
    await initWasm(wasmModule);

    const engine = await createEngineAsync({
      fonts: await preloadFonts([
        {
          alias: "NotoSansJP",
          weight: 400,
          style: "normal",
          source: "/fonts/NotoSansJP-Regular.subset.ttf",
        },
        {
          alias: "JetBrainsMono",
          weight: 400,
          style: "normal",
          source: "/fonts/JetBrainsMono-Regular.woff2",
        },
        {
          alias: "InterVariable",
          weight: 400,
          style: "normal",
          source: "/fonts/Inter-Variable.ttf",
        },
      ]),
    });

    window.boundsvgDeterminism = {
      async renderScene(sceneJson: string) {
        const vnode = JSON.parse(sceneJson) as SceneInput;
        const svg = engine.renderToSvg(vnode);
        const png = engine.renderToPng(vnode);
        const webp = engine.renderToWebp(vnode);
        const webpCollector = createAnimatedRasterCollector();
        const gifCollector = createAnimatedRasterCollector();
        let animatedWebp: Uint8Array;
        let animatedGif: Uint8Array;
        try {
          await engine.renderToAnimatedWebp(vnode, ANIMATED_SCHEDULE, webpCollector);
          animatedWebp = webpCollector.takeBytes();
          await engine.renderToAnimatedGif(vnode, ANIMATED_SCHEDULE, gifCollector);
          animatedGif = gifCollector.takeBytes();
        } catch (error) {
          webpCollector.abort(error);
          gifCollector.abort(error);
          throw error;
        }
        return {
          svg,
          pngBase64: toBase64(png),
          webpBase64: toBase64(webp),
          animatedWebpBase64: toBase64(animatedWebp),
          animatedGifBase64: toBase64(animatedGif),
        };
      },
    };
    status.textContent = "ready";
  } catch (error) {
    status.textContent = "error";
    errorOut.textContent = error instanceof Error ? error.message : String(error);
  }
}

void main();
