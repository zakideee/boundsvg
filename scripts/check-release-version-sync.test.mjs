import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  auditReleaseVersionSync,
  discoverPublishablePackagePaths,
} from "./check-release-version-sync.mjs";

const publishablePackages = [
  { relativePath: "packages/browser/package.json", name: "@boundsvg/browser" },
  { relativePath: "packages/cli/package.json", name: "@boundsvg/cli" },
  { relativePath: "packages/core/package.json", name: "@boundsvg/core" },
  { relativePath: "packages/extras/package.json", name: "@boundsvg/extras" },
  { relativePath: "packages/react/package.json", name: "@boundsvg/react" },
  { relativePath: "packages/shape/package.json", name: "@boundsvg/shape" },
  { relativePath: "packages/testing/package.json", name: "@boundsvg/testing" },
  { relativePath: "packages/video/package.json", name: "@boundsvg/video" },
  { relativePath: "packages/worker/package.json", name: "@boundsvg/worker" },
];

function writeFixtureFile(rootDirectory, relativePath, contents) {
  const filePath = join(rootDirectory, relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, contents);
}

function withFixture(version, run) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "boundsvg-version-sync-"));
  try {
    writeFixtureFile(
      fixtureRoot,
      "pnpm-workspace.yaml",
      'packages:\n  - "packages/*"\n  - "apps/*"\n',
    );
    for (const { relativePath, name } of publishablePackages) {
      writeFixtureFile(
        fixtureRoot,
        relativePath,
        `${JSON.stringify({ name, version }, null, 2)}\n`,
      );
    }
    writeFixtureFile(
      fixtureRoot,
      ".changeset/config.json",
      `${JSON.stringify({ fixed: [publishablePackages.map(({ name }) => name)] }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "crates/boundmp4/Cargo.toml",
      `[package]\nname = "boundmp4"\nversion = "${version}"\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "crates/boundshape/Cargo.toml",
      `[package]\nname = "boundshape"\nversion = "${version}"\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "crates/boundtext/Cargo.toml",
      `[package]\nname = "boundtext"\nversion = "${version}"\n[dependencies]\nboundshape = { path = "../boundshape", version = "${version}" }\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "crates/boundsvg/Cargo.toml",
      `[package]\nname = "boundsvg"\nversion = "${version}"\n[dependencies]\nboundshape = { path = "../boundshape", version = "${version}" }\nboundtext = { path = "../boundtext", version = "${version}" }\n[dev-dependencies]\nboundtext = { path = "../boundtext", version = "${version}", features = ["phase-trace"] }\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "Cargo.lock",
      `version = 4\n\n[[package]]\nname = "boundmp4"\nversion = "${version}"\n\n[[package]]\nname = "boundshape"\nversion = "${version}"\n\n[[package]]\nname = "boundtext"\nversion = "${version}"\n\n[[package]]\nname = "boundsvg"\nversion = "${version}"\n`,
    );
    for (const relativePath of [
      "packages/core/wasm-pkg/package.json",
      "packages/core/wasm-pkg/scalar/package.json",
      "crates/boundsvg/pkg-web/package.json",
      "crates/boundsvg/pkg-web/scalar/package.json",
    ]) {
      writeFixtureFile(
        fixtureRoot,
        relativePath,
        `${JSON.stringify({ name: "boundsvg", version }, null, 2)}\n`,
      );
    }
    writeFixtureFile(
      fixtureRoot,
      "packages/video/wasm-pkg/package.json",
      `${JSON.stringify({ name: "boundmp4", version }, null, 2)}\n`,
    );
    run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("accepts synchronized npm, Cargo, and WASM versions", () => {
  withFixture("0.1.1", (fixtureRoot) => {
    assert.deepEqual(auditReleaseVersionSync(fixtureRoot, { artifacts: true }), []);
  });
});

test("reports package, dependency, lockfile, and artifact drift", () => {
  withFixture("0.1.1", (fixtureRoot) => {
    writeFixtureFile(
      fixtureRoot,
      "packages/worker/package.json",
      `${JSON.stringify({ name: "@boundsvg/worker", version: "0.1.0" }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "crates/boundtext/Cargo.toml",
      `[package]\nname = "boundtext"\nversion = "0.1.0"\n[dependencies]\nboundshape = { path = "../boundshape", version = "0.1.0" }\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "packages/core/wasm-pkg/package.json",
      `${JSON.stringify({ name: "boundsvg", version: "0.1.0" }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "crates/boundmp4/Cargo.toml",
      `[package]\nname = "boundmp4"\nversion = "0.1.0"\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "packages/video/wasm-pkg/package.json",
      `${JSON.stringify({ name: "boundmp4", version: "0.1.0" }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "Cargo.lock",
      `version = 4\n\n[[package]]\nname = "boundshape"\nversion = "0.1.1"\n\n[[package]]\nname = "boundtext"\nversion = "0.1.0"\n\n[[package]]\nname = "boundsvg"\nversion = "0.1.1"\n`,
    );

    const violations = auditReleaseVersionSync(fixtureRoot, { artifacts: true });
    assert.ok(violations.some((violation) => violation.includes("packages/worker/package.json")));
    assert.ok(violations.some((violation) => violation.includes("crates/boundtext/Cargo.toml")));
    assert.ok(violations.some((violation) => violation.includes("crates/boundmp4/Cargo.toml")));
    assert.ok(violations.some((violation) => violation.includes("Cargo.lock")));
    assert.ok(
      violations.some((violation) => violation.includes("packages/core/wasm-pkg/package.json")),
    );
    assert.ok(
      violations.some((violation) => violation.includes("packages/video/wasm-pkg/package.json")),
    );
  });
});

test("discovers publishable packages from every configured workspace root", () => {
  withFixture("0.1.1", (fixtureRoot) => {
    writeFixtureFile(
      fixtureRoot,
      "tools/future/package.json",
      `${JSON.stringify({ name: "@boundsvg/future", version: "0.1.0" }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "apps/non-publishable-tool/package.json",
      `${JSON.stringify({ name: "@boundsvg/non-publishable-tool", private: true, version: "9.9.9" }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      "pnpm-workspace.yaml",
      'packages:\n  - "packages/*"\n  - "apps/*"\n  - "tools/*"\n',
    );

    const discovered = discoverPublishablePackagePaths(fixtureRoot);
    assert.ok(discovered.includes("tools/future/package.json"));
    assert.ok(!discovered.includes("apps/non-publishable-tool/package.json"));

    const violations = auditReleaseVersionSync(fixtureRoot);
    assert.ok(violations.some((violation) => violation.includes("tools/future/package.json")));
    assert.ok(violations.some((violation) => violation.includes("fixed group")));
    assert.ok(violations.every((violation) => !violation.includes("non-publishable-tool")));
  });
});
