import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "./canonical.mjs";
import { deriveSourceInputHashes } from "./plan-semantic.mjs";

test("plan inputs are rederived from S bytes after Changesets and markers are consumed", () => {
  const changesetBytes = Buffer.from('---\n"@example/pkg": patch\n---\n\nRelease.\n');
  const markedManifest = Buffer.from(`[package]
name = "marked"
version = "1.0.0"

[package.metadata.boundsvg-release]
pending-version = "1.1.0"
change-kind = "api-change"
obligation-id = "marked-api"
`);
  const unmarkedManifest = Buffer.from(`[package]
name = "unmarked"
version = "1.0.0"
`);
  const stateAfterConsumption = {
    cargo: {
      crates: [
        { manifestPath: "crates/marked/Cargo.toml", name: "marked" },
        { manifestPath: "crates/unmarked/Cargo.toml", name: "unmarked" },
      ],
    },
    inputs: { changesets: [], markers: [] },
  };
  const baseFiles = new Map([
    [".changeset/release.md", { bytes: changesetBytes, mode: "100644" }],
    ["crates/marked/Cargo.toml", { bytes: markedManifest, mode: "100644" }],
    ["crates/unmarked/Cargo.toml", { bytes: unmarkedManifest, mode: "100644" }],
  ]);
  assert.deepEqual(deriveSourceInputHashes(stateAfterConsumption, baseFiles), [
    { path: ".changeset/release.md", sha256: sha256(changesetBytes) },
    { path: "crates/marked/Cargo.toml", sha256: sha256(markedManifest) },
  ]);
});
