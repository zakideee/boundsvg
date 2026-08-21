import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  exports: Record<string, unknown>;
};

describe("public core entries", () => {
  it("exposes inspection through the root and canonical inspect subpath", async () => {
    const rootEntry = await import("../src/index.js");
    const inspectEntry = await import("../src/inspect.js");

    expect(rootEntry.inspectScene).toBeTypeOf("function");
    expect(Reflect.has(rootEntry, "collectInspectionBBoxes")).toBe(false);
    expect(inspectEntry.inspectScene).toBe(rootEntry.inspectScene);
    expect(inspectEntry.collectInspectionBBoxes).toBeTypeOf("function");
  });

  it("publishes inspect without a debug compatibility alias", () => {
    const testDir = fileURLToPath(new URL(".", import.meta.url));
    const packageJson = JSON.parse(
      readFileSync(resolve(testDir, "../package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.exports["./inspect"]).toBeDefined();
    expect(packageJson.exports["./debug"]).toBeUndefined();
  });
});
