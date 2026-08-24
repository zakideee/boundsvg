/**
 * Integration coverage for the Cargo release-version synchronization script.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const syncScriptPath = fileURLToPath(new URL("./sync-cargo-version.sh", import.meta.url));

function writeFixtureFile(rootDirectory, relativePath, contents) {
  const filePath = join(rootDirectory, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function crateManifest(crateName, dependencies = "") {
  return `[package]\nname = "${crateName}"\nversion = "0.1.0"\nedition = "2024"\n\n[lib]\npath = "src/lib.rs"\n${dependencies}`;
}

test("updates Rust manifests and Cargo.lock to the npm release version", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "boundsvg-cargo-version-"));
  try {
    writeFixtureFile(
      fixtureRoot,
      "packages/core/package.json",
      `${JSON.stringify({ name: "@boundsvg/core", version: "0.2.0" }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "Cargo.toml",
      `[workspace]\nmembers = ["crates/boundshape", "crates/boundtext", "crates/boundsvg", "crates/boundmp4"]\nresolver = "3"\n`,
    );
    writeFixtureFile(fixtureRoot, "crates/boundshape/Cargo.toml", crateManifest("boundshape"));
    writeFixtureFile(
      fixtureRoot,
      "crates/boundtext/Cargo.toml",
      crateManifest(
        "boundtext",
        `\n[dependencies]\nboundshape = { path = "../boundshape", version = "0.1.0" }\n`,
      ),
    );
    writeFixtureFile(
      fixtureRoot,
      "crates/boundsvg/Cargo.toml",
      crateManifest(
        "boundsvg",
        `\n[dependencies]\nboundshape = { path = "../boundshape", version = "0.1.0" }\nboundtext = { path = "../boundtext", version = "0.1.0" }\n\n[dev-dependencies]\nboundtext = { path = "../boundtext", version = "0.1.0" }\n`,
      ),
    );
    writeFixtureFile(fixtureRoot, "crates/boundmp4/Cargo.toml", crateManifest("boundmp4"));
    for (const crateName of ["boundshape", "boundtext", "boundsvg", "boundmp4"]) {
      writeFixtureFile(fixtureRoot, `crates/${crateName}/src/lib.rs`, "pub fn fixture() {}\n");
    }

    const initialLock = spawnSync("cargo", ["generate-lockfile"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.equal(initialLock.status, 0, initialLock.stderr);

    const synchronization = spawnSync("bash", [syncScriptPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.equal(synchronization.status, 0, synchronization.stderr);

    for (const crateName of ["boundshape", "boundtext", "boundsvg", "boundmp4"]) {
      const manifest = readFileSync(join(fixtureRoot, `crates/${crateName}/Cargo.toml`), "utf8");
      assert.match(manifest, /^version = "0\.2\.0"$/m);
    }
    const cargoLock = readFileSync(join(fixtureRoot, "Cargo.lock"), "utf8");
    for (const crateName of ["boundshape", "boundtext", "boundsvg", "boundmp4"]) {
      assert.match(cargoLock, new RegExp(`name = "${crateName}"\\nversion = "0\\.2\\.0"`));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
