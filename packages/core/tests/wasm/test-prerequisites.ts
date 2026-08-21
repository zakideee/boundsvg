import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";

const wasmPkgPath = path.resolve(__dirname, "../../wasm-pkg/boundsvg.js");
const subsetFontPath = path.resolve(
  __dirname,
  "../../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf",
);
const jetBrainsMonoPath = path.resolve(
  __dirname,
  "../../../../fixtures/fonts/JetBrainsMono-Regular.woff2",
);
const interVariablePath = path.resolve(__dirname, "../../../../fixtures/fonts/Inter-Variable.ttf");

export function assertWasmPkgAvailable(): void {
  expect(
    fs.existsSync(wasmPkgPath),
    `Missing WASM package: ${wasmPkgPath}. Run: pnpm build:wasm`,
  ).toBe(true);
}

export function assertSubsetFontAvailable(): void {
  expect(fs.existsSync(subsetFontPath), `Missing font fixture: ${subsetFontPath}`).toBe(true);
}

export function loadSubsetFont(): Uint8Array {
  assertSubsetFontAvailable();
  return new Uint8Array(fs.readFileSync(subsetFontPath));
}

export function loadJetBrainsMonoFont(): Uint8Array {
  expect(fs.existsSync(jetBrainsMonoPath), `Missing font fixture: ${jetBrainsMonoPath}`).toBe(true);
  return new Uint8Array(fs.readFileSync(jetBrainsMonoPath));
}

export function loadInterVariableFont(): Uint8Array {
  expect(fs.existsSync(interVariablePath), `Missing font fixture: ${interVariablePath}`).toBe(true);
  return new Uint8Array(fs.readFileSync(interVariablePath));
}
