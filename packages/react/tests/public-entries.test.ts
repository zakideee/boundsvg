import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  exports: Record<string, unknown>;
};

describe("public React entries", () => {
  it("keeps the root entry focused on components and VNode conversion", async () => {
    const entry = await import("../src/index.js");

    expect(entry.BoundSvg).toBeDefined();
    expect(entry.Canvas).toBeDefined();
    expect(entry.InlineRect).toBeDefined();
    expect(entry.useRenderToSvg).toBeDefined();
    expect(entry.toVNode).toBeDefined();
    expect(Reflect.has(entry, "BoundSvgProvider")).toBe(false);
    expect(Reflect.has(entry, "useBoundSvg")).toBe(false);
    expect(Reflect.has(entry, "useRenderToPng")).toBe(false);
    expect(Reflect.has(entry, "useRenderToSvgAsync")).toBe(false);
  });

  it("exposes provider, worker, png, interactive, inspect, and debug subpaths", () => {
    const testDir = fileURLToPath(new URL(".", import.meta.url));
    const packageJson = JSON.parse(
      readFileSync(resolve(testDir, "../package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.exports["./provider"]).toBeDefined();
    expect(packageJson.exports["./worker"]).toBeDefined();
    expect(packageJson.exports["./png"]).toBeDefined();
    expect(packageJson.exports["./interactive"]).toBeDefined();
    expect(packageJson.exports["./inspect"]).toBeDefined();
    expect(packageJson.exports["./debug"]).toBeDefined();
    expect(packageJson.exports["./assets"]).toBeDefined();
  });

  it("keeps structured inspection separate from visual debugging", async () => {
    const providerEntry = await import("../src/provider.js");
    const workerEntry = await import("../src/worker.js");
    const pngEntry = await import("../src/png.js");
    const interactiveEntry = await import("../src/interactive.js");
    const inspectEntry = await import("../src/inspect.js");
    const debugEntry = await import("../src/debug.js");
    const assetsEntry = await import("../src/assets.js");

    expect(providerEntry.BoundSvgProvider).toBeDefined();
    expect(providerEntry.useBoundSvg).toBeDefined();
    expect(workerEntry.useRenderToSvgAsync).toBeDefined();
    expect(workerEntry.useRenderToPngAsync).toBeDefined();
    expect(pngEntry.useRenderToPng).toBeDefined();
    expect(interactiveEntry.InteractiveBoundSvg).toBeTypeOf("function");
    expect(interactiveEntry.useTextCopy).toBeTypeOf("function");
    expect(inspectEntry.useBoundSvgInspection).toBeDefined();
    expect(Reflect.has(debugEntry, "useBoundSvgInspection")).toBe(false);
    expect(debugEntry.BoundSvgDebugOverlay).toBeDefined();
    expect(assetsEntry.useRenderAsset).toBeDefined();
  });
});
