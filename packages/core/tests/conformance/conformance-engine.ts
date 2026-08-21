/**
 * Shared real-WASM engine setup for the conformance suite.
 *
 * Used by vitest suites and by the headless PNG renderer
 * (scripts/render-conformance-visual.mts), so it must not import vitest and must
 * resolve paths via import.meta.url (tsx runs it as plain ESM).
 *
 * Prerequisite: built WASM package — run `pnpm build:wasm` first.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";

const conformanceDir = path.dirname(fileURLToPath(import.meta.url));
const wasmPkgPath = path.resolve(conformanceDir, "../../wasm-pkg/boundsvg.js");
const fontsDir = path.resolve(conformanceDir, "../../../../fixtures/fonts");

/** Throws with a build hint when the WASM package has not been built. */
export function assertConformancePrerequisites(): void {
  if (!fs.existsSync(wasmPkgPath)) {
    throw new Error(`Missing WASM package: ${wasmPkgPath}. Run: pnpm build:wasm`);
  }
}

function loadFixtureFont(fileName: string): Uint8Array {
  const fontPath = path.join(fontsDir, fileName);
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Missing font fixture: ${fontPath}`);
  }
  return new Uint8Array(fs.readFileSync(fontPath));
}

/** The fixture fonts every conformance suite renders with. */
export function loadConformanceFonts(): Array<{
  alias: string;
  weight: number;
  style: "normal" | "italic";
  data: Uint8Array;
}> {
  return [
    {
      alias: "NotoSansJP",
      weight: 400,
      style: "normal",
      data: loadFixtureFont("NotoSansJP-Regular.subset.ttf"),
    },
    {
      alias: "NotoSerifJP",
      weight: 400,
      style: "normal",
      data: loadFixtureFont("NotoSerifJP-Regular.subset.ttf"),
    },
    {
      alias: "JetBrainsMono",
      weight: 400,
      style: "normal",
      data: loadFixtureFont("JetBrainsMono-Regular.woff2"),
    },
    {
      alias: "InterVariable",
      weight: 400,
      style: "normal",
      data: loadFixtureFont("Inter-Variable.ttf"),
    },
  ];
}

/** Creates the engine every conformance suite renders with (fixture fonts only). */
export async function createConformanceEngine(): Promise<Engine> {
  assertConformancePrerequisites();
  await initNodeWasm();
  return createEngineAsync({
    fonts: loadConformanceFonts(),
  });
}
