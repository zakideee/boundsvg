import assert from "node:assert/strict";
import test from "node:test";

import {
  assertChangesetPrediction,
  deriveFixedGroupChangesetTarget,
  materializeCargoManifest,
  materializeNpmManifest,
} from "./materialize.mjs";

function changeset(type, name = "@example/kernel") {
  return { releases: [{ name, type }] };
}

test("fixed-group target is the unique highest one-step Changeset increment", () => {
  const fixedNames = new Set(["@example/kernel", "@example/adapter"]);
  for (const [changesets, expected] of [
    [[changeset("patch")], { advances: true, bumpType: "patch", target: "2.7.4" }],
    [[changeset("minor")], { advances: true, bumpType: "minor", target: "2.8.0" }],
    [[changeset("major")], { advances: true, bumpType: "major", target: "3.0.0" }],
    [
      [changeset("patch"), changeset("major", "@example/adapter"), changeset("minor")],
      { advances: true, bumpType: "major", target: "3.0.0" },
    ],
    [[], { advances: false, bumpType: undefined, target: "2.7.3" }],
  ]) {
    assert.deepEqual(deriveFixedGroupChangesetTarget(changesets, fixedNames, "2.7.3"), {
      ...expected,
      current: "2.7.3",
    });
  }
  assert.throws(
    () =>
      deriveFixedGroupChangesetTarget(
        [changeset("patch", "@example/outside")],
        fixedNames,
        "2.7.3",
      ),
    { code: "CHANGESET_PACKAGE_OUTSIDE_FIXED_GROUP" },
  );
});

test("all intra-fixed peers move before Changesets to the explicit target minor line", () => {
  const manifest = {
    name: "@example/adapter",
    version: "2.7.3",
    dependencies: { "@example/kernel": "workspace:*", external: "^8.0.0" },
    peerDependencies: { "@example/kernel": ">=2.7.0 <2.8.0", external: ">=18" },
  };
  const result = materializeNpmManifest(
    manifest,
    new Set(["@example/adapter", "@example/kernel"]),
    "2.10.4",
  );
  assert.equal(result.peerDependencies["@example/kernel"], ">=2.10.0 <2.11.0");
  assert.equal(result.dependencies["@example/kernel"], "workspace:*");
  assert.equal(result.peerDependencies.external, ">=18");
  assert.equal(manifest.peerDependencies["@example/kernel"], ">=2.7.0 <2.8.0");
});

test("raw Changesets over-bump is rejected and exact dynamic prediction is accepted", () => {
  const fixedNames = new Set(["@example/kernel", "@example/adapter"]);
  const rawPrediction = {
    releases: [
      { name: "@example/kernel", newVersion: "1.0.0" },
      { name: "@example/adapter", newVersion: "1.0.0" },
    ],
  };
  assert.throws(
    () =>
      assertChangesetPrediction(rawPrediction, {
        advances: true,
        fixedNames,
        targetVersion: "2.10.4",
      }),
    { code: "CHANGESET_PREDICTION_MISMATCH" },
  );
  assert.doesNotThrow(() =>
    assertChangesetPrediction(
      {
        releases: [...fixedNames].map((name) => ({ name, newVersion: "2.10.4" })),
      },
      { advances: true, fixedNames, targetVersion: "2.10.4" },
    ),
  );
  assert.doesNotThrow(() =>
    assertChangesetPrediction(
      { releases: [] },
      { advances: false, fixedNames, targetVersion: "2.7.3" },
    ),
  );
  assert.throws(
    () =>
      assertChangesetPrediction(rawPrediction, {
        advances: false,
        fixedNames,
        targetVersion: "2.7.3",
      }),
    { code: "CHANGESET_PREDICTION_MISMATCH" },
  );
});

test("Cargo materialization updates package and all public path dependency targets then consumes an exact marker", () => {
  const source = `[package]
name = "crate-renderer"
version = "4.2.0"

[package.metadata.boundsvg-release]
pending-version = "4.3.0"
change-kind = "breaking-contract"
obligation-id = "renderer-contract"

[dependencies]
crate-kernel = { path = "../kernel", version = "3.1.0" }
external = "8"

[dev-dependencies]
crate-kernel = { path = "../kernel", version = "3.1.0", features = ["trace"] }
`;
  const output = materializeCargoManifest(source, {
    crateName: "crate-renderer",
    publicTargets: new Map([
      ["crate-kernel", "3.2.0"],
      ["crate-renderer", "4.3.0"],
    ]),
  });
  assert.match(output, /version = "4\.3\.0"/);
  assert.equal((output.match(/version = "3\.2\.0"/g) ?? []).length, 2);
  assert.doesNotMatch(output, /boundsvg-release|pending-version|renderer-contract/);
  assert.match(output, /external = "8"/);
});

test("Cargo marker target mismatch and unmarked unrelated advance are rejected", () => {
  const marked = `[package]
name = "crate-kernel"
version = "3.1.0"

[package.metadata.boundsvg-release]
pending-version = "3.2.0"
change-kind = "breaking-contract"
obligation-id = "kernel-contract"
`;
  assert.throws(
    () =>
      materializeCargoManifest(marked, {
        crateName: "crate-kernel",
        publicTargets: new Map([["crate-kernel", "3.3.0"]]),
      }),
    { code: "CARGO_MARKER_TARGET_MISMATCH" },
  );

  const unmarked = '[package]\nname = "crate-kernel"\nversion = "3.1.0"\n';
  assert.throws(
    () =>
      materializeCargoManifest(unmarked, {
        crateName: "crate-kernel",
        publicTargets: new Map([["crate-kernel", "3.2.0"]]),
      }),
    { code: "CARGO_UNMARKED_ADVANCE" },
  );
});
