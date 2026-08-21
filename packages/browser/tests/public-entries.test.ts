import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type ConditionalExport = {
  import?: string;
  require?: string;
  types?: string;
};

type PackageJson = {
  exports: Record<string, string | ConditionalExport>;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const cjsEntries = ["png", "fonts", "assets", "events"] as const;
const missingCjsEntries = cjsEntries.filter(
  (entry) => !existsSync(resolve(testDir, `../dist/${entry}.cjs`)),
);

if (process.env.CI !== undefined && missingCjsEntries.length > 0) {
  throw new Error(
    `CI must build @boundsvg/browser before its packed-entry tests; missing: ${missingCjsEntries.join(
      ", ",
    )}`,
  );
}

function getConditionalExport(packageJson: PackageJson, subpath: string): ConditionalExport {
  const target = packageJson.exports[subpath];
  if (target === undefined || typeof target === "string") {
    throw new TypeError(`Expected conditional package export for ${subpath}`);
  }
  return target;
}

describe("public browser entries", () => {
  it("exposes runtime, wasm, png, and fonts subpaths in package exports", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(testDir, "../package.json"), "utf8"),
    ) as PackageJson;

    const rootExport = getConditionalExport(packageJson, ".");
    const wasmExport = getConditionalExport(packageJson, "./wasm");

    for (const subpath of ["./png", "./fonts", "./assets", "./events"]) {
      const target = getConditionalExport(packageJson, subpath);
      expect(target.import).toMatch(/\.js$/);
      expect(target.require).toMatch(/\.cjs$/);
      expect(target.types).toMatch(/\.d\.ts$/);
    }
    expect(rootExport.require).toBeUndefined();
    expect(wasmExport.require).toBeUndefined();
  });

  it.skipIf(missingCjsEntries.length > 0)(
    "loads every declared CommonJS utility entry",
    async () => {
      const expectedExports = {
        png: "pngToDataUrl",
        fonts: "createFontLoader",
        assets: "readPngDimensions",
        events: "resolveHitTarget",
      } as const;

      for (const entry of cjsEntries) {
        const loaded = require(`@boundsvg/browser/${entry}`) as Record<string, unknown>;
        expect(loaded[expectedExports[entry]]).toBeTypeOf("function");
      }

      const pngEntry = require("@boundsvg/browser/png") as {
        pngToDataUrl: (png: Uint8Array) => string;
      };
      expect(pngEntry.pngToDataUrl(new Uint8Array([137, 80, 78, 71]))).toBe(
        "data:image/png;base64,iVBORw==",
      );

      const fontsEntry = require("@boundsvg/browser/fonts") as {
        createFontLoader: () => { load: (source: Uint8Array) => Promise<Uint8Array> };
      };
      const fontBytes = new Uint8Array([1, 2, 3]);
      await expect(fontsEntry.createFontLoader().load(fontBytes)).resolves.toBe(fontBytes);

      const assetsEntry = require("@boundsvg/browser/assets") as {
        readPngDimensions: (png: Uint8Array) => { width: number; height: number } | null;
      };
      const pngHeader = new Uint8Array(24);
      pngHeader.set([137, 80, 78, 71, 13, 10, 26, 10]);
      const pngView = new DataView(pngHeader.buffer);
      pngView.setUint32(16, 320, false);
      pngView.setUint32(20, 180, false);
      expect(assetsEntry.readPngDimensions(pngHeader)).toEqual({ width: 320, height: 180 });

      const eventsEntry = require("@boundsvg/browser/events") as {
        resolveHitTarget: (
          container: Element,
          candidates: ReadonlyArray<string>,
          nodeTypes: ReadonlyMap<string, string>,
          clientX: number,
          clientY: number,
        ) => string | null;
      };
      expect(
        eventsEntry.resolveHitTarget(
          {} as unknown as Element,
          ["representative-box"],
          new Map([["representative-box", "rect"]]),
          10,
          20,
        ),
      ).toBe("representative-box");
    },
  );

  it("has source entries for png and fonts APIs", async () => {
    const pngEntry = await import("../src/png.js");
    const fontsEntry = await import("../src/fonts.js");
    const assetsEntry = await import("../src/assets.js");
    const eventsEntry = await import("../src/events.js");

    expect(pngEntry.pngToDataUrl).toBeDefined();
    expect(pngEntry.pngToBlob).toBeDefined();
    expect(pngEntry.createPngObjectUrl).toBeDefined();
    expect(pngEntry.revokePngObjectUrl).toBeDefined();
    expect(fontsEntry.createFontLoader).toBeDefined();
    expect(fontsEntry.preloadFonts).toBeDefined();
    expect(fontsEntry.clearFontCache).toBeDefined();
    expect(assetsEntry.readPngDimensions).toBeDefined();
    expect(eventsEntry.resolveHitTarget).toBeDefined();
    expect(eventsEntry.translateSvgCoords).toBeDefined();
    expect(eventsEntry.verifyPathGeometry).toBeDefined();
  });
});
