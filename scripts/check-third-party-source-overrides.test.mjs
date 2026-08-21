import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditThirdPartySourceOverrides } from "./check-third-party-source-overrides.mjs";

function withFixture(files, run) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "boundsvg-source-override-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = join(fixtureRoot, relativePath);
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, contents);
    }
    run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("accepts the single pre-existing ttf-parser exception", () => {
  withFixture(
    {
      "Cargo.toml": `[workspace]\n[patch.crates-io]\nttf-parser = { path = "vendor/ttf-parser" }\n`,
      "vendor/ttf-parser/Cargo.toml": `[package]\nname = "ttf-parser"\nversion = "0.25.1"\n`,
    },
    (fixtureRoot) => {
      assert.deepEqual(auditThirdPartySourceOverrides(fixtureRoot), []);
    },
  );
});

test("rejects a source override for a crate other than the vendored ttf-parser", () => {
  withFixture(
    {
      "Cargo.toml": `[workspace]\n[patch.crates-io]\nresvg = { path = "vendor/resvg" }\nttf-parser = { path = "vendor/ttf-parser" }\n`,
      "vendor/resvg/Cargo.toml": `[package]\nname = "resvg"\nversion = "0.45.1"\n`,
      "vendor/ttf-parser/Cargo.toml": `[package]\nname = "ttf-parser"\nversion = "0.25.1"\n`,
    },
    (fixtureRoot) => {
      const violations = auditThirdPartySourceOverrides(fixtureRoot);
      assert.ok(violations.some((violation) => violation.startsWith("vendor/resvg:")));
      assert.ok(violations.some((violation) => violation.includes("crates.io patch")));
      assert.ok(violations.some((violation) => violation.includes("vendor/resvg")));
    },
  );
});

test("rejects Cargo git dependencies and source replacement", () => {
  withFixture(
    {
      ".cargo/config.toml": `[source.crates-io]\nreplace-with = "fork"\n`,
      "Cargo.toml": `[dependencies]\nresvg = { git = "https://example.invalid/resvg" }\n`,
    },
    (fixtureRoot) => {
      const violations = auditThirdPartySourceOverrides(fixtureRoot);
      assert.ok(violations.some((violation) => violation.includes("Cargo git dependency")));
      assert.ok(violations.some((violation) => violation.includes("Cargo source replacement")));
    },
  );
});
