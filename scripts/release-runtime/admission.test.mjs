import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovalProjectionNarrowing,
  assertApprovalProjectionStable,
  validateDispatchContext,
  validateRegistryTransition,
  validateTrainIdentity,
  verifyControlSeal,
} from "./admission.mjs";

const releaseCommit = "a".repeat(40);
const mainTip = "b".repeat(40);

test("workflow dispatch accepts one explicit registry and exact release identity", () => {
  assert.deepEqual(
    validateDispatchContext({
      eventCommit: releaseCommit,
      inputs: { "release-commit": releaseCommit, target: "npm" },
      ref: "refs/heads/main",
      repository: "zakideee/boundsvg",
      workflowSha: releaseCommit,
    }),
    { releaseCommit, target: "npm" },
  );
});

test("sentinel, omitted, legacy flags, malformed identity, wrong repo, and non-main fail admission", () => {
  const base = {
    eventCommit: releaseCommit,
    inputs: { "release-commit": releaseCommit, target: "npm" },
    ref: "refs/heads/main",
    repository: "zakideee/boundsvg",
    workflowSha: releaseCommit,
  };
  const cases = [
    { inputs: { "release-commit": releaseCommit, target: "select-target" } },
    { inputs: { "release-commit": releaseCommit } },
    { inputs: { "release-commit": releaseCommit, publish: true, target: "npm" } },
    { inputs: { "release-commit": releaseCommit, "publish-crates": true, publish: true } },
    { inputs: { "release-commit": "A".repeat(40), target: "npm" } },
    { repository: "attacker/fork" },
    { ref: "refs/heads/release/test" },
    { workflowSha: mainTip },
  ];
  for (const override of cases) {
    assert.throws(
      () => validateDispatchContext({ ...base, ...override }),
      (error) => String(error.code).startsWith("DISPATCH_"),
    );
  }
});

test("train identity separates R, E, and T and requires ancestry", () => {
  assert.deepEqual(
    validateTrainIdentity({
      eventIsAncestorOfMain: true,
      eventCommit: releaseCommit,
      mainTip,
      parentCommit: "c".repeat(40),
      parentCount: 1,
      releaseCommit,
      releaseIsAncestorOfEvent: true,
      releaseIsAncestorOfMain: true,
      workflowSha: releaseCommit,
    }),
    { eventCommit: releaseCommit, mainTip, releaseCommit, workflowSha: releaseCommit },
  );
  assert.throws(
    () =>
      validateTrainIdentity({
        eventIsAncestorOfMain: true,
        eventCommit: releaseCommit,
        mainTip,
        parentCommit: "c".repeat(40),
        parentCount: 1,
        releaseCommit,
        releaseIsAncestorOfEvent: true,
        releaseIsAncestorOfMain: false,
        workflowSha: releaseCommit,
      }),
    { code: "DISPATCH_RELEASE_NONANCESTOR" },
  );
  assert.throws(
    () =>
      validateTrainIdentity({
        eventIsAncestorOfMain: true,
        eventCommit: releaseCommit,
        mainTip,
        parentCommit: "c".repeat(40),
        parentCount: 2,
        releaseCommit,
        releaseIsAncestorOfEvent: true,
        releaseIsAncestorOfMain: true,
        workflowSha: releaseCommit,
      }),
    { code: "DISPATCH_RELEASE_PARENT_COUNT" },
  );
  assert.throws(
    () =>
      validateTrainIdentity({
        eventIsAncestorOfMain: false,
        eventCommit: releaseCommit,
        mainTip,
        parentCommit: "c".repeat(40),
        parentCount: 1,
        releaseCommit,
        releaseIsAncestorOfEvent: true,
        releaseIsAncestorOfMain: true,
        workflowSha: releaseCommit,
      }),
    { code: "DISPATCH_EVENT_IDENTITY_INVALID" },
  );
});

test("control seal requires exact presence, mode, bytes, publish topology, and command map", () => {
  const rSeal = {
    commands: { audit: "node audit.mjs" },
    files: [{ mode: "100644", path: "control.mjs", sha256: "1".repeat(64) }],
    publishSet: [{ name: "package", path: "packages/package" }],
  };
  assert.doesNotThrow(() => verifyControlSeal(rSeal, structuredClone(rSeal)));
  for (const mutate of [
    (seal) => {
      seal.files[0].sha256 = "2".repeat(64);
    },
    (seal) => {
      seal.files[0].mode = "100755";
    },
    (seal) => {
      seal.publishSet.push({ name: "extra", path: "packages/extra" });
    },
    (seal) => {
      seal.commands.audit = "node other.mjs";
    },
  ]) {
    const changed = structuredClone(rSeal);
    mutate(changed);
    assert.throws(() => verifyControlSeal(rSeal, changed), { code: "CONTROL_SEAL_DRIFT" });
  }
});

test("feature-only T movement may continue only with an identical decision projection", () => {
  const before = {
    artifacts: [{ name: "package", state: "missing" }],
    frontier: { package: "2.7.3" },
    lease: { kind: "event", valid: true },
    mode: "WRITE_ALL",
    publishSetHash: "1".repeat(64),
    releaseCommit,
    sealHash: "2".repeat(64),
    target: "npm",
    mainTip: releaseCommit,
  };
  assert.doesNotThrow(() =>
    assertApprovalProjectionStable(before, {
      ...before,
      mainTip,
      trailingCommitPhases: ["steady"],
    }),
  );
  for (const key of ["frontier", "lease", "mode", "publishSetHash", "sealHash"]) {
    const after = { ...before, mainTip, trailingCommitPhases: ["steady"] };
    after[key] = key === "mode" ? "WRITE_MISSING" : { changed: true };
    assert.throws(() => assertApprovalProjectionStable(before, after), {
      code: "APPROVAL_PROJECTION_DRIFT",
    });
  }
  assert.throws(
    () =>
      assertApprovalProjectionStable(before, {
        ...before,
        mainTip,
        trailingCommitPhases: ["materialized"],
      }),
    { code: "APPROVAL_TRAILING_MATERIALIZED" },
  );
});

test("write-before registry transition permits only missing to exact narrowing", () => {
  assert.equal(
    validateRegistryTransition(
      [{ name: "package", state: "missing" }],
      [{ name: "package", state: "exact" }],
    ).writeRequired,
    false,
  );
  assert.equal(
    validateRegistryTransition(
      [{ name: "package", state: "missing" }],
      [{ name: "package", state: "missing" }],
    ).writeRequired,
    true,
  );
  for (const afterState of ["conflict", "unknown"]) {
    assert.throws(
      () =>
        validateRegistryTransition(
          [{ name: "package", state: "missing" }],
          [{ name: "package", state: afterState }],
        ),
      { code: "REGISTRY_TRANSITION_INVALID" },
    );
  }
  assert.throws(
    () =>
      validateRegistryTransition(
        [{ name: "package", state: "exact" }],
        [{ name: "package", state: "missing" }],
      ),
    { code: "REGISTRY_TRANSITION_INVALID" },
  );
});

test("an external exact race permits only audited missing-to-exact progress", () => {
  const baseArtifact = {
    advances: true,
    canonicalSha256: "3".repeat(64),
    filename: "package.tgz",
    frontier: "2.7.3",
    name: "package",
    state: "missing",
    version: "2.8.0",
  };
  const before = {
    artifacts: [baseArtifact],
    eventCommit: releaseCommit,
    lease: { kind: "event", runId: "17", writeRequired: true },
    mainTip: releaseCommit,
    mode: "WRITE_ALL",
    prerequisites: [],
    publishSetHash: "4".repeat(64),
    releaseCommit,
    run: { runAttempt: 1, runId: "17" },
    sealHash: "5".repeat(64),
    target: "npm",
    trailingCommitPhases: [],
    workflowSha: releaseCommit,
    writeOrder: ["package"],
  };
  const after = {
    ...before,
    artifacts: [
      {
        ...baseArtifact,
        frontier: "2.8.0",
        provenanceCommit: releaseCommit,
        state: "exact",
      },
    ],
    lease: { ...before.lease, writeRequired: false },
    mainTip,
    mode: "AUDIT_ONLY",
    trailingCommitPhases: ["steady"],
  };
  assert.doesNotThrow(() => assertApprovalProjectionNarrowing(before, after));

  for (const mutate of [
    (projection) => {
      projection.artifacts[0].provenanceCommit = mainTip;
    },
    (projection) => {
      projection.artifacts[0].frontier = "2.9.0";
    },
    (projection) => {
      projection.mode = "WRITE_MISSING";
    },
    (projection) => {
      projection.sealHash = "6".repeat(64);
    },
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    assert.throws(
      () => assertApprovalProjectionNarrowing(before, changed),
      (error) =>
        String(error.code).startsWith("APPROVAL_") || error.code === "REGISTRY_TRANSITION_INVALID",
    );
  }
});

test("a still-missing artifact cannot cross a different stable frontier", () => {
  const artifact = {
    advances: true,
    canonicalSha256: "7".repeat(64),
    filename: "package.tgz",
    frontier: "1.0.0",
    name: "package",
    state: "missing",
    version: "2.0.0",
  };
  const before = {
    artifacts: [artifact],
    lease: { kind: "event", writeRequired: true },
    mode: "WRITE_ALL",
    releaseCommit,
  };
  assert.throws(
    () =>
      assertApprovalProjectionNarrowing(before, {
        ...before,
        artifacts: [{ ...artifact, frontier: "1.5.0" }],
      }),
    { code: "APPROVAL_FRONTIER_DRIFT" },
  );
});
