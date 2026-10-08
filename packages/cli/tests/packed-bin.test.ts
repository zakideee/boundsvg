import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";

/** Package root used for the same pnpm archive generation as publication. */
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
/** Archive assertions require a current CLI build, just like the bin smoke tests. */
const builtBinMissing = !existsSync(join(packageDirectory, "dist/bin.js"));

if (process.env.CI !== undefined && builtBinMissing) {
  throw new Error("CI must build @boundsvg/cli before the packed bin test");
}

/**
 * Read regular files from the short-path tar records emitted by pnpm pack.
 * @throws If the archive cannot be read or uses unsupported long-path records.
 */
function readPackedFiles(archivePath: string): Map<string, Buffer> {
  const archive = gunzipSync(readFileSync(archivePath));
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (name.length === 0) {
      break;
    }
    const length = Number.parseInt(header.subarray(124, 136).toString("ascii"), 8);
    const entryType = header[156];
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    if (prefix.length > 0 || [76, 75, 120, 103].includes(entryType!)) {
      throw new Error("Packed CLI test requires short-path tar records");
    }
    if (entryType === 0 || entryType === 48) {
      files.set(name, archive.subarray(offset + 512, offset + 512 + length));
    }
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  return files;
}

it.skipIf(builtBinMissing)(
  "packs one executable and preserves the library and animation entries",
  () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "boundsvg-cli-package-"));
    try {
      const packed = JSON.parse(
        execFileSync("pnpm", ["pack", "--json", "--pack-destination", temporaryDirectory], {
          cwd: packageDirectory,
          encoding: "utf8",
          env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" },
        }),
      ) as { filename: string };
      const files = readPackedFiles(join(temporaryDirectory, basename(packed.filename)));
      const manifest = JSON.parse(files.get("package/package.json")!.toString("utf8"));
      expect(manifest.bin).toEqual({ boundsvg: "./dist/bin.js" });
      expect(manifest.dependencies.tinyglobby).toBe("^0.2.15");
      expect(manifest.dependencies["@boundsvg/core"]).toBe(manifest.version);
      expect(JSON.stringify(manifest)).not.toContain("workspace:");
      expect(manifest.exports["."]).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      });
      expect(manifest.exports["./animation"]).toEqual({
        types: "./dist/animation.d.ts",
        import: "./dist/animation.js",
      });
      expect(files.get("package/dist/bin.js")!.toString("utf8")).toMatch(
        /^#!\/usr\/bin\/env node\n/,
      );
      for (const entry of ["index", "animation"]) {
        expect(files.get(`package/dist/${entry}.js`)!.toString("utf8")).not.toMatch(/^#!/);
        expect(files.has(`package/dist/${entry}.d.ts`)).toBe(true);
      }
      expect([...files.keys()].filter((name) => name.includes("index-convert"))).toEqual([]);
      for (const [name, contents] of files) {
        if (name.endsWith(".js") || name.endsWith(".d.ts")) {
          expect(contents.toString("utf8")).not.toMatch(/\bparseArgs\b/);
        }
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  },
);
