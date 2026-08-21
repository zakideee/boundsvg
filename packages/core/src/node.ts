/// <reference types="node" />

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initWasm } from "./wasm/index.js";
import type { WasmModule } from "./wasm/types.js";

type WasmInitializer = (module: WasmModule) => void;

/**
 * Initialize the WASM module using Node.js CJS interop.
 *
 * This is the Node-specific counterpart of the browser path, which
 * loads the wasm-pack web build via `@boundsvg/browser` and passes it to
 * `initWasm(preloaded)`.
 *
 * Safe to call multiple times — subsequent calls are no-ops (delegated
 * to the supplied initializer, or `initWasm` by default).
 */
export async function initNodeWasm(initialize: WasmInitializer = initWasm): Promise<void> {
  const nodeModule = await import("node:module");
  const require = nodeModule.createRequire(import.meta.url);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // The primary artifact is the simd128 build. Older runtimes reject it while
  // loading the generated Node.js wrapper, so keep the scalar artifact as a
  // second candidate in the same package.
  const candidates = [
    resolve(moduleDir, "../wasm-pkg/boundsvg.js"),
    resolve(moduleDir, "../wasm-pkg/scalar/boundsvg.js"),
    resolve(process.cwd(), "wasm-pkg/boundsvg.js"),
    resolve(process.cwd(), "wasm-pkg/scalar/boundsvg.js"),
  ];
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const loaded = require(candidate) as WasmModule;
      initialize(loaded);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}
