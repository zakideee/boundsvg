import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseDelta } from "./delta.mjs";

function entry(text, mode = "100644") {
  return { bytes: Buffer.from(text), mode };
}

const changeset = '---\n"@example/root": minor\n---\n\nA public change.\n';

function npmManifest(version, options = {}) {
  return `${JSON.stringify(
    {
      name: options.name ?? "@example/root",
      version,
      publishConfig: { access: "public" },
      scripts: { build: options.build ?? "build-tool" },
      files: options.files ?? ["dist"],
      exports: options.exports ?? { ".": "./dist/index.js" },
      dependencies: { external: options.external ?? "^8.0.0" },
      peerDependencies: { "external-peer": options.externalPeer ?? ">=18" },
    },
    null,
    2,
  )}\n`;
}

function cargoManifest(version, options = {}) {
  const marker =
    options.marker === false
      ? ""
      : '\n[package.metadata.boundsvg-release]\npending-version = "3.2.0"\nchange-kind = "breaking-contract"\nobligation-id = "kernel-contract"\n';
  return `[package]\nname = "crate-kernel"\nversion = "${version}"\ndescription = "${options.description ?? "Kernel"}"\n\n[features]\ndefault = ["${options.feature ?? "stable"}"]\n\n[dependencies]\nexternal = "${options.external ?? "8"}"\n${marker}`;
}

function fixture() {
  const base = new Map([
    [".changeset/proposal.md", entry(changeset)],
    ["packages/root/package.json", entry(npmManifest("2.7.3"))],
    ["packages/root/CHANGELOG.md", entry("# @example/root\n\n## 2.7.3\n\nOld.\n")],
    ["crates/kernel/Cargo.toml", entry(cargoManifest("3.1.0"))],
    ["Cargo.lock", entry('version = 4\n\n[[package]]\nname = "crate-kernel"\nversion = "3.1.0"\n')],
  ]);
  const head = new Map([
    ["packages/root/package.json", entry(npmManifest("2.8.0"))],
    [
      "packages/root/CHANGELOG.md",
      entry("# @example/root\n\n## 2.8.0\n\nA public change.\n\n## 2.7.3\n\nOld.\n"),
    ],
    ["crates/kernel/Cargo.toml", entry(cargoManifest("3.2.0", { marker: false }))],
    ["Cargo.lock", entry('version = 4\n\n[[package]]\nname = "crate-kernel"\nversion = "3.2.0"\n')],
  ]);
  return {
    baseFiles: base,
    cargoPackages: [{ manifestPath: "crates/kernel/Cargo.toml", name: "crate-kernel" }],
    headFiles: head,
    npmPackages: [
      {
        changelogPath: "packages/root/CHANGELOG.md",
        manifestPath: "packages/root/package.json",
        name: "@example/root",
      },
    ],
    patchNames: new Set(),
    workspaceNames: new Set(["crate-kernel"]),
  };
}

test("materialized delta consumes exact inputs and changes only authorized version surfaces", () => {
  const result = validateReleaseDelta(fixture());
  assert.equal(result.phase, "materialized");
  assert.equal(result.npm.targetVersion, "2.8.0");
  assert.deepEqual(result.cargo.advanced, ["crate-kernel"]);
});

test("materialized npm target is bound to the exact Changeset one-step increment", () => {
  const wrongMajor = fixture();
  wrongMajor.baseFiles.set(
    ".changeset/proposal.md",
    entry(changeset.replace(": minor", ": patch")),
  );
  wrongMajor.headFiles.set("packages/root/package.json", entry(npmManifest("3.0.0")));
  wrongMajor.headFiles.set(
    "packages/root/CHANGELOG.md",
    entry("# @example/root\n\n## 3.0.0\n\nA public change.\n\n## 2.7.3\n\nOld.\n"),
  );
  assert.throws(() => validateReleaseDelta(wrongMajor), {
    code: "CHANGESET_TARGET_MISMATCH",
  });

  const exactPatch = fixture();
  exactPatch.baseFiles.set(
    ".changeset/proposal.md",
    entry(changeset.replace(": minor", ": patch")),
  );
  exactPatch.headFiles.set("packages/root/package.json", entry(npmManifest("2.7.4")));
  exactPatch.headFiles.set(
    "packages/root/CHANGELOG.md",
    entry("# @example/root\n\n## 2.7.4\n\nA public change.\n\n## 2.7.3\n\nOld.\n"),
  );
  assert.equal(validateReleaseDelta(exactPatch).npm.targetVersion, "2.7.4");
});

test("marker-only deletion and partial input consumption fail closed", () => {
  const markerOnly = fixture();
  markerOnly.headFiles.set(
    "packages/root/package.json",
    markerOnly.baseFiles.get("packages/root/package.json"),
  );
  markerOnly.headFiles.set(
    "packages/root/CHANGELOG.md",
    markerOnly.baseFiles.get("packages/root/CHANGELOG.md"),
  );
  markerOnly.headFiles.set("Cargo.lock", markerOnly.baseFiles.get("Cargo.lock"));
  markerOnly.headFiles.set(
    "crates/kernel/Cargo.toml",
    entry(cargoManifest("3.1.0", { marker: false })),
  );
  markerOnly.headFiles.set(
    ".changeset/proposal.md",
    markerOnly.baseFiles.get(".changeset/proposal.md"),
  );
  assert.throws(() => validateReleaseDelta(markerOnly), { code: "CARGO_MARKER_ONLY_DELETION" });

  const partial = fixture();
  partial.headFiles.set(".changeset/proposal.md", partial.baseFiles.get(".changeset/proposal.md"));
  assert.throws(() => validateReleaseDelta(partial), { code: "CHANGESET_NOT_CONSUMED" });
});

test("materialization consumes every pre-existing Changeset and Cargo marker", () => {
  const markerLeftBehind = fixture();
  markerLeftBehind.headFiles.set(
    "crates/kernel/Cargo.toml",
    markerLeftBehind.baseFiles.get("crates/kernel/Cargo.toml"),
  );
  markerLeftBehind.headFiles.set("Cargo.lock", markerLeftBehind.baseFiles.get("Cargo.lock"));
  assert.throws(() => validateReleaseDelta(markerLeftBehind), {
    code: "CARGO_MARKER_NOT_CONSUMED",
  });

  const changesetLeftBehind = fixture();
  changesetLeftBehind.headFiles.set(
    "packages/root/package.json",
    changesetLeftBehind.baseFiles.get("packages/root/package.json"),
  );
  changesetLeftBehind.headFiles.set(
    "packages/root/CHANGELOG.md",
    changesetLeftBehind.baseFiles.get("packages/root/CHANGELOG.md"),
  );
  changesetLeftBehind.headFiles.set(
    ".changeset/proposal.md",
    changesetLeftBehind.baseFiles.get(".changeset/proposal.md"),
  );
  assert.throws(() => validateReleaseDelta(changesetLeftBehind), {
    code: "CHANGESET_NOT_CONSUMED",
  });
});

test("consumed base inputs must already satisfy their public schemas", () => {
  const outsideChangeset = fixture();
  outsideChangeset.baseFiles.set(
    ".changeset/proposal.md",
    entry('---\n"private-package": patch\n---\n\nInvalid.\n'),
  );
  assert.throws(() => validateReleaseDelta(outsideChangeset), {
    code: "CHANGESET_PACKAGE_OUTSIDE_FIXED_GROUP",
  });

  const invalidMarker = fixture();
  invalidMarker.baseFiles.set(
    "crates/kernel/Cargo.toml",
    entry(`[package]
name = "crate-kernel"
version = "3.1.0"

[package.metadata.boundsvg-release]
pending-version = "3.2.0"
change-kind = "breaking-contract"
`),
  );
  assert.throws(() => validateReleaseDelta(invalidMarker), {
    code: "CARGO_MARKER_KEYS_INVALID",
  });
});

test("changeset-only deletion is classified as maintenance, not materialization", () => {
  const maintenance = fixture();
  maintenance.headFiles = new Map(maintenance.baseFiles);
  maintenance.headFiles.delete(".changeset/proposal.md");
  const result = validateReleaseDelta(maintenance);
  assert.equal(result.phase, "changeset-maintenance");
});

test("ordinary public Cargo manifest edits remain steady before version materialization", () => {
  const steady = fixture();
  steady.headFiles = new Map(steady.baseFiles);
  steady.headFiles.set(
    "crates/kernel/Cargo.toml",
    entry(
      cargoManifest("3.1.0", { description: "Improved kernel", external: "9", feature: "new" }),
    ),
  );
  assert.deepEqual(validateReleaseDelta(steady), {
    cargo: { advanced: [] },
    npm: { advanced: false },
    phase: "steady",
  });

  const markerUpdate = fixture();
  markerUpdate.headFiles = new Map(markerUpdate.baseFiles);
  markerUpdate.headFiles.set(
    "crates/kernel/Cargo.toml",
    entry(cargoManifest("3.1.0").replace('pending-version = "3.2.0"', 'pending-version = "3.3.0"')),
  );
  assert.equal(validateReleaseDelta(markerUpdate).phase, "steady");
});

test("npm scripts and external dependencies cannot hide inside a version delta", () => {
  for (const replacement of [
    npmManifest("2.8.0", { build: "different-tool" }),
    npmManifest("2.8.0", { external: "^9.0.0" }),
    npmManifest("2.8.0", { externalPeer: ">=19" }),
    npmManifest("2.8.0", { files: ["dist", "hidden"] }),
    npmManifest("2.8.0", { exports: { ".": "./dist/other.js" } }),
  ]) {
    const changed = fixture();
    changed.headFiles.set("packages/root/package.json", entry(replacement));
    assert.throws(() => validateReleaseDelta(changed), { code: "NPM_MANIFEST_FORBIDDEN_DELTA" });
  }
});

test("Cargo metadata and unrelated lock entries cannot hide inside a version delta", () => {
  for (const mutation of [
    { description: "Changed", marker: false },
    { external: "9", marker: false },
    { feature: "changed", marker: false },
  ]) {
    const manifestChanged = fixture();
    manifestChanged.headFiles.set(
      "crates/kernel/Cargo.toml",
      entry(cargoManifest("3.2.0", mutation)),
    );
    assert.throws(() => validateReleaseDelta(manifestChanged), {
      code: "CARGO_MANIFEST_FORBIDDEN_DELTA",
    });
  }

  const lockChanged = fixture();
  lockChanged.baseFiles.set(
    "Cargo.lock",
    entry(
      'version = 4\n\n[[package]]\nname = "crate-kernel"\nversion = "3.1.0"\n\n[[package]]\nname = "external"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n',
    ),
  );
  lockChanged.headFiles.set(
    "Cargo.lock",
    entry(
      'version = 4\n\n[[package]]\nname = "crate-kernel"\nversion = "3.2.0"\n\n[[package]]\nname = "external"\nversion = "1.0.1"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"\n',
    ),
  );
  assert.throws(() => validateReleaseDelta(lockChanged), {
    code: "CARGO_ROOT_LOCK_EXTERNAL_DELTA",
  });
});

test("npm materialization requires target CHANGELOG coverage and preserved history", () => {
  for (const changelog of [
    "# @example/root\n\n## 2.7.3\n\nOld.\n",
    "# @example/root\n\n## 2.8.0\n\nA public change.\n",
    "# changed header\n\n## 2.8.0\n\nA public change.\n\n## 2.7.3\n\nOld.\n",
    "# @example/root\n\n## 2.8.00\n\nA public change.\n\n## 2.7.3\n\nOld.\n",
    "# @example/root\n\n## 2.8.0\n\n## 2.7.3\n\nOld.\n",
    "# @example/root\n\n## 2.8.0\n\nA fabricated summary.\n\n## 2.7.3\n\nOld.\n",
  ]) {
    const changed = fixture();
    changed.headFiles.set("packages/root/CHANGELOG.md", entry(changelog));
    assert.throws(() => validateReleaseDelta(changed), {
      code: "CHANGELOG_COVERAGE_INVALID",
    });
  }
});

test("npm materialization recognizes multiline Changeset summaries as rendered by changelog-github", () => {
  const changed = fixture();
  changed.baseFiles.set(
    ".changeset/proposal.md",
    entry(
      '---\n"@example/root": minor\n---\n\nA public change.\n\nExplain the migration.\nKeep the old history.\n',
    ),
  );
  changed.headFiles.set(
    "packages/root/CHANGELOG.md",
    entry(
      "# @example/root\n\n## 2.8.0\n\n### Minor Changes\n\n- [#42](https://example.invalid/pull/42) - A public change.\n\n  Explain the migration.\n  Keep the old history.\n\n## 2.7.3\n\nOld.\n",
    ),
  );
  assert.equal(validateReleaseDelta(changed).phase, "materialized");

  changed.headFiles.set(
    "packages/root/CHANGELOG.md",
    entry(
      "# @example/root\n\n## 2.8.0\n\n### Minor Changes\n\n- A public change.\n\n  Different migration.\n  Keep the old history.\n\n## 2.7.3\n\nOld.\n",
    ),
  );
  assert.throws(() => validateReleaseDelta(changed), {
    code: "CHANGELOG_COVERAGE_INVALID",
  });
});

test("a fixed-group member with no direct Changeset may have an empty version block", () => {
  const changed = fixture();
  changed.baseFiles.set(
    "packages/shape/package.json",
    entry(npmManifest("2.7.3", { name: "@example/shape" })),
  );
  changed.baseFiles.set(
    "packages/shape/CHANGELOG.md",
    entry("# @example/shape\n\n## 2.7.3\n\nOld.\n"),
  );
  changed.headFiles.set(
    "packages/shape/package.json",
    entry(npmManifest("2.8.0", { name: "@example/shape" })),
  );
  changed.headFiles.set(
    "packages/shape/CHANGELOG.md",
    entry("# @example/shape\n\n## 2.8.0\n\n## 2.7.3\n\nOld.\n"),
  );
  changed.npmPackages.push({
    changelogPath: "packages/shape/CHANGELOG.md",
    manifestPath: "packages/shape/package.json",
    name: "@example/shape",
  });
  assert.equal(validateReleaseDelta(changed).phase, "materialized");
});

test("extra paths and mode changes are rejected even when their bytes look harmless", () => {
  const extra = fixture();
  extra.headFiles.set("notes.txt", entry("extra\n"));
  assert.throws(() => validateReleaseDelta(extra), { code: "VERSION_PATH_NOT_ALLOWED" });

  const mode = fixture();
  mode.headFiles.set("packages/root/package.json", entry(npmManifest("2.8.0"), "100755"));
  assert.throws(() => validateReleaseDelta(mode), { code: "VERSION_MODE_CHANGED" });
});
