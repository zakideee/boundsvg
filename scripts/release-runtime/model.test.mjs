import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCargoModel,
  buildNpmModel,
  parseChangeset,
  topologicalOrder,
  validateReleaseMarker,
} from "./model.mjs";

function npmManifest(name, options = {}) {
  return {
    name,
    version: options.version ?? "2.7.3",
    private: options.private,
    publishConfig: options.public === false ? undefined : { access: "public" },
    dependencies: options.dependencies,
    devDependencies: options.devDependencies,
    peerDependencies: options.peerDependencies,
  };
}

test("npm model derives a fixed publish set and dependency order without a member-count constant", () => {
  for (const manifests of [
    [npmManifest("@example/one")],
    [
      npmManifest("@example/leaf", { dependencies: { "@example/root": "workspace:*" } }),
      npmManifest("@example/root"),
      npmManifest("@example/peer", {
        devDependencies: { "@example/root": "workspace:*" },
        peerDependencies: { "@example/root": ">=2.7.0 <2.8.0" },
      }),
    ],
  ]) {
    const names = manifests.map((manifest) => manifest.name);
    const model = buildNpmModel({
      changesetConfig: { fixed: [names] },
      manifests: manifests.map((manifest, index) => ({
        path: `workspace-${index}/package.json`,
        value: manifest,
      })),
    });
    assert.equal(model.packages.length, manifests.length);
    assert.deepEqual(new Set(model.publishOrder), new Set(names));
    if (names.includes("@example/root")) {
      assert.ok(
        model.publishOrder.indexOf("@example/root") < model.publishOrder.indexOf("@example/leaf"),
      );
    }
  }

  assert.throws(() => buildNpmModel({ changesetConfig: { fixed: [[]] }, manifests: [] }), {
    code: "NPM_PUBLIC_SET_EMPTY",
  });
});

test("npm model rejects a non-exact fixed group, split versions, and stale internal peers", () => {
  const base = {
    changesetConfig: { fixed: [["@example/root", "@example/leaf"]] },
    manifests: [
      { path: "root/package.json", value: npmManifest("@example/root") },
      {
        path: "leaf/package.json",
        value: npmManifest("@example/leaf", {
          peerDependencies: { "@example/root": ">=2.7.0 <2.8.0" },
        }),
      },
    ],
  };
  assert.throws(() => buildNpmModel({ ...base, changesetConfig: { fixed: [["@example/root"]] } }), {
    code: "NPM_FIXED_GROUP_MISMATCH",
  });
  assert.throws(
    () =>
      buildNpmModel({
        ...base,
        manifests: [
          base.manifests[0],
          {
            ...base.manifests[1],
            value: { ...base.manifests[1].value, version: "2.8.0" },
          },
        ],
      }),
    { code: "NPM_FIXED_VERSION_MISMATCH" },
  );
  assert.throws(
    () =>
      buildNpmModel({
        ...base,
        manifests: [
          base.manifests[0],
          {
            ...base.manifests[1],
            value: {
              ...base.manifests[1].value,
              peerDependencies: { "@example/root": ">=2.6.0 <2.7.0" },
            },
          },
        ],
      }),
    { code: "NPM_INTERNAL_PEER_MISMATCH" },
  );
});

test("topological ordering is deterministic and rejects a publish dependency cycle", () => {
  assert.deepEqual(
    topologicalOrder(
      ["gamma", "alpha", "beta"],
      [
        ["beta", "alpha"],
        ["gamma", "beta"],
      ],
    ),
    ["alpha", "beta", "gamma"],
  );
  assert.throws(
    () =>
      topologicalOrder(
        ["alpha", "beta"],
        [
          ["alpha", "beta"],
          ["beta", "alpha"],
        ],
      ),
    { code: "DEPENDENCY_CYCLE" },
  );
});

test("Cargo model derives publishability, dependency order, and exact release markers", () => {
  const model = buildCargoModel({
    packages: [
      {
        dependencies: [
          { name: "crate-kernel", path: "/repo/crates/kernel", req: "^3.1.0", kind: null },
        ],
        manifestPath: "crates/renderer/Cargo.toml",
        metadata: {},
        name: "crate-renderer",
        publish: null,
        version: "4.2.0",
      },
      {
        dependencies: [],
        manifestPath: "crates/kernel/Cargo.toml",
        metadata: {
          "boundsvg-release": {
            "change-kind": "breaking-contract",
            "obligation-id": "kernel-contract",
            "pending-version": "3.2.0",
          },
        },
        name: "crate-kernel",
        publish: null,
        version: "3.1.0",
      },
      {
        dependencies: [],
        manifestPath: "crates/tool/Cargo.toml",
        metadata: {},
        name: "private-tool",
        publish: [],
        version: "1.0.0",
      },
    ],
  });
  assert.deepEqual(model.publishOrder, ["crate-kernel", "crate-renderer"]);
  assert.equal(model.crates.length, 2);
  assert.equal(model.markers.length, 1);
});

test("release marker schema rejects partial, extra, private, and non-advancing markers", () => {
  const valid = {
    "change-kind": "breaking-contract",
    "obligation-id": "kernel-contract",
    "pending-version": "3.2.0",
  };
  assert.doesNotThrow(() =>
    validateReleaseMarker("crate-kernel", {
      currentVersion: "3.1.0",
      isPublic: true,
      marker: valid,
    }),
  );
  for (const [marker, isPublic, code] of [
    [{ ...valid, extra: "value" }, true, "CARGO_MARKER_KEYS_INVALID"],
    [{ ...valid, "pending-version": "3.1.0" }, true, "CARGO_MARKER_NOT_ADVANCING"],
    [{ ...valid, "change-kind": "Bad Kind" }, true, "CARGO_MARKER_IDENTIFIER_INVALID"],
    [valid, false, "CARGO_MARKER_PRIVATE_CRATE"],
  ]) {
    assert.throws(
      () =>
        validateReleaseMarker("crate-kernel", {
          currentVersion: "3.1.0",
          isPublic,
          marker,
        }),
      {
        code,
      },
    );
  }
});

test("pending Changeset parsing preserves package bumps and body without a fixed inventory", () => {
  const parsed = parseChangeset(
    "proposal.md",
    '---\n"@example/root": minor\n"@example/leaf": patch\n---\n\nDescribe the change.\n',
  );
  assert.deepEqual(parsed.releases, [
    { name: "@example/leaf", type: "patch" },
    { name: "@example/root", type: "minor" },
  ]);
  assert.equal(parsed.summary, "Describe the change.");
  assert.throws(() => parseChangeset("bad.md", "---\nname: impossible\n---\n"), {
    code: "CHANGESET_PARSE_FAILED",
  });
});
