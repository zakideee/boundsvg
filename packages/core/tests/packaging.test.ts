import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const builtCjsEntry = resolve(packageRoot, "dist/index.cjs");
const builtNodeWasm = resolve(packageRoot, "wasm-pkg/boundsvg.js");
const builtScalarNodeWasm = resolve(packageRoot, "wasm-pkg/scalar/boundsvg.js");
const dualLicenseFiles = ["LICENSE-MIT", "LICENSE-APACHE"] as const;
const builtRuntimeMissing = !existsSync(builtCjsEntry) || !existsSync(builtNodeWasm);

if (process.env.CI !== undefined && builtRuntimeMissing) {
  throw new Error(
    "CI must build @boundsvg/core and its node WASM package before the built CJS runtime test",
  );
}

type PackageManifest = {
  files?: string[];
  license?: string;
  name?: string;
  private?: boolean;
};

function getPublishablePackages(): Array<{
  directory: string;
  manifest: PackageManifest;
}> {
  const packagesRoot = resolve(repositoryRoot, "packages");
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = resolve(packagesRoot, entry.name);
      const manifestPath = resolve(directory, "package.json");
      if (!existsSync(manifestPath)) {
        return null;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
      return manifest.private === true ? null : { directory, manifest };
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => (left.manifest.name ?? "").localeCompare(right.manifest.name ?? ""));
}

function packageShipsWasm(directory: string, manifest: PackageManifest): boolean {
  if (manifest.files?.some((file) => file === "wasm-pkg" || file.endsWith(".wasm"))) {
    return true;
  }
  // Every wasm-pack artifact is named `<crate>_bg.wasm`; matching one crate by
  // name would silently exempt a package that ships a different one.
  const buildConfigPath = resolve(directory, "tsup.config.ts");
  return existsSync(buildConfigPath) && readFileSync(buildConfigPath, "utf8").includes("_bg.wasm");
}

/**
 * A package that declares wasm must have the binary where `files` points.
 *
 * Nothing else catches a build step that stops copying it: the manifest and the
 * build config still look right, and consumers get a 404 at load time.
 */
function assertShippedWasmPayload(directory: string, manifest: PackageManifest): void {
  const shippedRoots = (manifest.files ?? [])
    .map((file) => resolve(directory, file))
    .filter((path) => existsSync(path));
  const builtRoots = shippedRoots.filter((path) => statSync(path).isDirectory());
  if (builtRoots.length === 0) {
    // Nothing built in this checkout; the tarball itself is covered by pack-e2e.
    return;
  }
  expect(
    builtRoots.some((root) => findWasmFile(root) !== undefined),
    `${manifest.name ?? directory} ships no .wasm payload`,
  ).toBe(true);
}

function findWasmFile(directory: string): string | undefined {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findWasmFile(path);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".wasm") && statSync(path).size > 0) {
      return path;
    }
  }
  return undefined;
}

/**
 * Guards the npm tarball layout. `initNodeWasm()` resolves the primary
 * `wasm-pkg/boundsvg.js` and the scalar fallback relative to the installed
 * package root, so the published tarball must ship the full wasm-pkg tree or
 * every consumer install is broken (works in-repo, fails after `npm install`).
 */
describe("npm packaging", () => {
  it("includes wasm-pkg in the files allowlist", () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      files?: string[];
    };
    expect(manifest.files).toContain("dist");
    expect(manifest.files).toContain("wasm-pkg");
  });

  it("has no wasm-pack generated .gitignore that would exclude wasm-pkg from the tarball", () => {
    // wasm-pack emits wasm-pkg/.gitignore containing "*"; npm-packlist honors
    // nested .gitignore files, silently emptying the shipped directory. The
    // build:wasm script removes it — this test catches that step regressing.
    expect(existsSync(resolve(packageRoot, "wasm-pkg", ".gitignore"))).toBe(false);
  });

  it("includes the scalar WASM fallback when the primary build is present", () => {
    if (!existsSync(builtNodeWasm)) {
      return;
    }

    expect(existsSync(builtScalarNodeWasm)).toBe(true);
    expect(existsSync(resolve(packageRoot, "wasm-pkg/scalar/boundsvg_bg.wasm"))).toBe(true);
    expect(existsSync(resolve(packageRoot, "wasm-pkg/scalar/.gitignore"))).toBe(false);
  });

  it("declares public access for npm publish", () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      publishConfig?: { access?: string };
    };
    expect(manifest.publishConfig?.access).toBe("public");
  });

  it("ships canonical license payloads from every publishable package", () => {
    const publishablePackages = getPublishablePackages();
    expect(publishablePackages).toHaveLength(9);

    for (const { directory, manifest } of publishablePackages) {
      const packageName = manifest.name ?? directory;

      expect(manifest.license, packageName).toBe("MIT OR Apache-2.0");
      for (const licenseFile of dualLicenseFiles) {
        expect(manifest.files, `${packageName}: ${licenseFile}`).toContain(licenseFile);
        expect(readFileSync(resolve(directory, licenseFile))).toEqual(
          readFileSync(resolve(repositoryRoot, licenseFile)),
        );
      }
    }

    const wasmPackages = publishablePackages.filter(({ directory, manifest }) =>
      packageShipsWasm(directory, manifest),
    );
    expect(wasmPackages.map(({ manifest }) => manifest.name)).toEqual([
      "@boundsvg/browser",
      "@boundsvg/core",
      "@boundsvg/video",
    ]);
    for (const { directory, manifest } of wasmPackages) {
      expect(manifest.files, manifest.name).toContain("THIRD-PARTY-LICENSES");
      expect(readFileSync(resolve(directory, "THIRD-PARTY-LICENSES"))).toEqual(
        readFileSync(resolve(repositoryRoot, "THIRD-PARTY-LICENSES")),
      );
      // Same wasm-pack .gitignore trap as the core package guards above.
      expect(existsSync(resolve(directory, "wasm-pkg", ".gitignore")), manifest.name).toBe(false);
      assertShippedWasmPayload(directory, manifest);
    }
  });
});

describe.skipIf(builtRuntimeMissing)("built CJS runtime", () => {
  it("auto-initializes the WASM module used by createEngineAsync", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--eval",
        `
          (async () => {
            const core = require(${JSON.stringify(builtCjsEntry)});
            const engine = await core.createEngineAsync({});
            try {
              const scene = {
                type: "Canvas",
                width: 32,
                height: 16,
                children: [
                  { type: "Box", width: 32, height: 16, background: "#dc2626", children: [] },
                ],
              };
              const svg = engine.renderToSvg(scene);
              const png = engine.renderToPng(scene);
              console.log(JSON.stringify({
                svg: svg.startsWith("<svg") && svg.length > 0,
                png: Array.from(png.slice(0, 8)),
              }));
            } finally {
              engine.dispose();
            }
          })().catch((error) => {
            console.error(error);
            process.exitCode = 1;
          });
        `,
      ],
      { cwd: packageRoot, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      svg: true,
      png: [137, 80, 78, 71, 13, 10, 26, 10],
    });
  });
});
