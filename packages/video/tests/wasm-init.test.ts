import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initVideoWasm } from "../src/mp4-writer.js";

/**
 * Lives in its own file because it needs a module that has not initialized yet:
 * vitest gives each file a fresh module registry.
 */
describe("initVideoWasm", () => {
  it("lets a later call succeed after a failed load", async () => {
    // A successful init is cached; a rejected one must not be, or one transient
    // fetch failure would make the package permanently unusable.
    await expect(initVideoWasm(new Uint8Array([0, 1, 2, 3]))).rejects.toThrow();

    const wasmPath = fileURLToPath(new URL("../wasm-pkg/boundmp4_bg.wasm", import.meta.url));
    await expect(initVideoWasm(await readFile(wasmPath))).resolves.toBeUndefined();
  });
});
