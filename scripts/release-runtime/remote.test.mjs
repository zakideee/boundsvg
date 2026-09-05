import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNpmAttestations,
  readCrateRegistryState,
  readCrateSparseIndexState,
  readNpmRegistryState,
  validateCrateProvenance,
  validateCrateRegistryProjection,
  validateNpmProvenance,
} from "./remote.mjs";

const trustpubDataField = "trustpub_data";
const trustpubOnlyField = "trustpub_only";
const runIdField = "run_id";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("npm registry reader distinguishes definitive versions, deprecations, tags, missing, tombstone, and unknown", async () => {
  const known = await readNpmRegistryState("@example/package", {
    fetch: async () =>
      jsonResponse({
        "dist-tags": { latest: "2.8.0" },
        versions: {
          "2.7.3": { deprecated: "old" },
          "2.8.0": { dist: { integrity: "sha512-value", tarball: "https://registry.invalid/tgz" } },
        },
      }),
  });
  assert.deepEqual(known.versions, ["2.7.3", "2.8.0"]);
  assert.deepEqual([...known.deprecated], ["2.7.3"]);
  assert.equal(known.latest, "2.8.0");
  assert.equal(known.state, "known");

  assert.equal(
    (await readNpmRegistryState("@example/missing", { fetch: async () => jsonResponse({}, 404) }))
      .state,
    "missing-package",
  );
  assert.equal(
    (
      await readNpmRegistryState("@example/tombstone", {
        fetch: async () => jsonResponse({ time: { unpublished: { time: "2031-01-01" } } }, 404),
      })
    ).state,
    "tombstone",
  );
  await assert.rejects(
    readNpmRegistryState("@example/unknown", { fetch: async () => jsonResponse({}, 503) }),
    { code: "NPM_REGISTRY_UNKNOWN" },
  );
});

test("crates registry reader retains yanked frontier and trusted-publishing binding", async () => {
  const state = await readCrateRegistryState("crate-renderer", {
    fetch: async () =>
      jsonResponse({
        crate: { [trustpubOnlyField]: false },
        versions: [
          { checksum: "a".repeat(64), num: "4.2.0", yanked: false },
          {
            checksum: "b".repeat(64),
            num: "4.3.0",
            [trustpubDataField]: {
              provider: "github",
              repository: "zakideee/boundsvg",
              [runIdField]: "7654",
              sha: "c".repeat(40),
            },
            yanked: true,
          },
        ],
      }),
  });
  assert.deepEqual(state.versions, ["4.2.0", "4.3.0"]);
  assert.deepEqual([...state.yanked], ["4.3.0"]);
  assert.equal(state.trustedPublishingOnly, false);
  assert.equal(state.records.get("4.3.0").trustpub_data.run_id, "7654");
});

test("crates sparse index reader uses the Cargo path and retains exact checksum and yank state", async () => {
  let requestedUrl;
  const state = await readCrateSparseIndexState("crate-renderer", {
    fetch: async (url) => {
      requestedUrl = url;
      return new Response(
        `${JSON.stringify({ cksum: "a".repeat(64), name: "crate-renderer", vers: "4.2.0", yanked: false })}\n${JSON.stringify({ cksum: "b".repeat(64), name: "crate-renderer", vers: "4.3.0", yanked: true })}\n`,
        { status: 200 },
      );
    },
  });
  assert.equal(requestedUrl, "https://index.crates.io/cr/at/crate-renderer");
  assert.equal(state.records.get("4.2.0").cksum, "a".repeat(64));
  assert.deepEqual([...state.yanked], ["4.3.0"]);
});

test("crates API and sparse index must expose one exact stable frontier", () => {
  const checksum = "a".repeat(64);
  const apiState = {
    records: new Map([["4.2.0", { checksum, num: "4.2.0", yanked: false }]]),
    state: "known",
    trustedPublishingOnly: false,
    versions: ["4.2.0"],
    yanked: new Set(),
  };
  const indexState = {
    records: new Map([
      ["4.2.0", { cksum: checksum, name: "crate-renderer", vers: "4.2.0", yanked: false }],
    ]),
    state: "known",
    versions: ["4.2.0"],
    yanked: new Set(),
  };
  assert.equal(
    validateCrateRegistryProjection("crate-renderer", apiState, indexState).indexRecords.get(
      "4.2.0",
    ).cksum,
    checksum,
  );
  assert.throws(
    () =>
      validateCrateRegistryProjection("crate-renderer", apiState, {
        ...indexState,
        records: new Map([
          ["4.2.0", { ...indexState.records.get("4.2.0"), cksum: "b".repeat(64) }],
        ]),
      }),
    { code: "CRATES_INDEX_MISMATCH" },
  );
});

test("npm provenance binds digest, canonical source, main, workflow, run family, and attempt", () => {
  const releaseCommit = "d".repeat(40);
  const payload = {
    _type: "https://in-toto.io/Statement/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            path: ".github/workflows/release.yml",
            ref: "refs/heads/main",
            repository: "https://github.com/zakideee/boundsvg",
          },
        },
        resolvedDependencies: [
          {
            digest: { gitCommit: releaseCommit },
            uri: "git+https://github.com/zakideee/boundsvg@refs/heads/main",
          },
        ],
      },
      runDetails: {
        builder: {
          id: "https://github.com/actions/runner/github-hosted",
        },
        metadata: {
          invocationId: "https://github.com/zakideee/boundsvg/actions/runs/1234/attempts/3",
        },
      },
    },
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ digest: { sha512: "e".repeat(128) }, name: "package.tgz" }],
  };
  const bundles = [
    {
      bundle: {
        dsseEnvelope: { payload: Buffer.from(JSON.stringify(payload)).toString("base64url") },
      },
    },
  ];
  const statements = parseNpmAttestations(bundles);
  assert.equal(
    validateNpmProvenance(statements, {
      digest: "e".repeat(128),
      releaseCommit,
      runAttempt: 3,
      runId: "1234",
    }).releaseCommit,
    releaseCommit,
  );
  assert.throws(
    () =>
      validateNpmProvenance(statements, {
        digest: "f".repeat(128),
        releaseCommit,
        runAttempt: 3,
        runId: "1234",
      }),
    { code: "NPM_PROVENANCE_MISMATCH" },
  );
  for (const mutate of [
    (statement) => {
      statement.predicate.buildDefinition.buildType = "https://example.invalid/build";
    },
    (statement) => {
      statement.predicate.buildDefinition.externalParameters.workflow.repository =
        "zakideee/boundsvg";
    },
    (statement) => {
      statement.predicate.buildDefinition.externalParameters.workflow.path =
        ".github/workflows/other.yml";
    },
    (statement) => {
      statement.predicate.runDetails.builder.id = "https://example.invalid/runner";
    },
  ]) {
    const changed = structuredClone(payload);
    mutate(changed);
    assert.throws(
      () =>
        validateNpmProvenance([changed], {
          digest: "e".repeat(128),
          releaseCommit,
          runAttempt: 3,
          runId: "1234",
        }),
      { code: "NPM_PROVENANCE_MISMATCH" },
    );
  }
});

test("crate provenance keeps the OIDC event commit separate from archive source identity", () => {
  const eventCommit = "e".repeat(40);
  const record = {
    checksum: "a".repeat(64),
    [trustpubDataField]: {
      provider: "github",
      repository: "zakideee/boundsvg",
      [runIdField]: "9876",
      sha: eventCommit,
    },
    yanked: false,
  };
  assert.equal(
    validateCrateProvenance(record, { eventCommit, runId: "9876" }).eventCommit,
    eventCommit,
  );
  assert.throws(
    () => validateCrateProvenance({ ...record, yanked: true }, { eventCommit, runId: "9876" }),
    { code: "CRATE_PROVENANCE_MISMATCH" },
  );
});
