import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReleaseSequence,
  classifyRegistryMode,
  classifyStableTarget,
  pollRegistry,
  validateCrateWriteLease,
  validateNpmEventLease,
} from "./registry.mjs";

function artifact(state, options = {}) {
  return {
    advances: options.advances ?? true,
    name: options.name ?? "artifact",
    provenanceCommit: options.provenanceCommit,
    state,
  };
}

test("registry mode is disjoint for zero, one, and many write candidates", () => {
  assert.equal(classifyRegistryMode([]).mode, "AUDIT_ONLY");
  assert.equal(classifyRegistryMode([artifact("missing")]).mode, "WRITE_ALL");
  assert.equal(
    classifyRegistryMode([
      artifact("exact", { name: "first" }),
      artifact("missing", { name: "second" }),
      artifact("missing", { name: "third" }),
    ]).mode,
    "WRITE_MISSING",
  );
  assert.equal(
    classifyRegistryMode([
      artifact("exact", { name: "first" }),
      artifact("exact", { name: "second" }),
    ]).mode,
    "AUDIT_ONLY",
  );
});

test("registry conflicts and unknown observations fail before mode selection", () => {
  assert.throws(() => classifyRegistryMode([artifact("conflict")]), {
    code: "REGISTRY_CONFLICT",
  });
  assert.throws(() => classifyRegistryMode([artifact("unknown")]), {
    code: "REGISTRY_UNKNOWN",
  });
});

test("stable frontier rejects current, lower, equal-existing, higher, deprecated, yanked, tombstone, and unknown targets", () => {
  const current = "2.7.3";
  const cases = [
    { code: "CURRENT_NOT_CARRIED", carried: false, target: "current", versions: [current] },
    { code: "TARGET_NOT_GREATER", target: "2.7.2", versions: [current] },
    { code: "TARGET_EXISTS", target: "2.8.0", versions: [current, "2.8.0"] },
    { code: "TARGET_BEHIND_FRONTIER", target: "2.8.0", versions: [current, "2.9.0"] },
    {
      code: "TARGET_DEPRECATED",
      deprecated: new Set(["2.8.0"]),
      target: "2.8.0",
      versions: [current],
    },
    { code: "TARGET_YANKED", target: "2.8.0", versions: [current], yanked: new Set(["2.8.0"]) },
    { code: "TARGET_TOMBSTONE", state: "tombstone", target: "2.8.0", versions: [current] },
    { code: "FRONTIER_UNKNOWN", state: "unknown", target: "2.8.0", versions: [current] },
  ];
  for (const fixture of cases) {
    assert.throws(
      () =>
        classifyStableTarget({
          carried: fixture.carried ?? true,
          current,
          deprecated: fixture.deprecated ?? new Set(),
          state: fixture.state ?? "known",
          target: fixture.target,
          versions: fixture.versions,
          yanked: fixture.yanked ?? new Set(),
        }),
      { code: fixture.code },
    );
  }
});

test("a greater definitively missing stable target is accepted", () => {
  assert.deepEqual(
    classifyStableTarget({
      carried: false,
      current: "2.7.3",
      deprecated: new Set(),
      state: "known",
      target: "2.10.0",
      versions: ["1.9.0", "2.7.3"],
      yanked: new Set(),
    }),
    { advances: true, frontier: "2.7.3", target: "2.10.0" },
  );
});

test("an existing advanced target is accepted only for publish recovery", () => {
  const input = {
    carried: true,
    current: "2.7.3",
    state: "known",
    target: "2.10.0",
    versions: ["2.7.3", "2.10.0"],
  };
  assert.throws(() => classifyStableTarget(input), { code: "TARGET_EXISTS" });
  assert.deepEqual(classifyStableTarget({ ...input, allowExistingTarget: true }), {
    advances: true,
    frontier: "2.10.0",
    target: "2.10.0",
  });
  assert.throws(
    () =>
      classifyStableTarget({
        ...input,
        allowExistingTarget: true,
        versions: ["2.7.3", "2.10.0", "2.11.0"],
      }),
    { code: "TARGET_BEHIND_FRONTIER" },
  );
});

test("npm event leases bind the original event family and enforce time and rerun ceilings", () => {
  const releaseCommit = "a".repeat(40);
  const baseLease = {
    createdAt: "2031-04-01T00:00:00.000Z",
    eventCommit: releaseCommit,
    now: "2031-04-30T23:59:59.999Z",
    ref: "refs/heads/main",
    releaseCommit,
    repository: "zakideee/boundsvg",
    runAttempt: 51,
    runId: 123,
    workflowPath: ".github/workflows/release.yml",
    workflowSha: releaseCommit,
  };
  assert.deepEqual(validateNpmEventLease(baseLease), {
    createdAt: "2031-04-01T00:00:00.000Z",
    expiresAt: "2031-05-01T00:00:00.000Z",
    kind: "event",
    remainingReruns: 0,
    runAttempt: 51,
    runId: 123,
  });
  assert.throws(() => validateNpmEventLease({ ...baseLease, eventCommit: "b".repeat(40) }), {
    code: "NPM_EVENT_COMMIT_MISMATCH",
  });
  assert.throws(() => validateNpmEventLease({ ...baseLease, now: "2031-05-01T00:00:00.001Z" }), {
    code: "NPM_EVENT_EXPIRED",
  });
  assert.throws(() => validateNpmEventLease({ ...baseLease, runAttempt: 52 }), {
    code: "NPM_RERUN_LIMIT",
  });
});

test("crate writes accept either a valid event lease or an exact same-train registry lease", () => {
  const releaseCommit = "c".repeat(40);
  const eventLease = { kind: "event", runAttempt: 1, runId: "31" };
  assert.deepEqual(
    validateCrateWriteLease({ eventLease, releaseCommit, registryArtifacts: [] }),
    eventLease,
  );
  assert.equal(
    validateCrateWriteLease({
      eventLease: undefined,
      releaseCommit,
      registryArtifacts: [
        artifact("exact", { name: "already-written", provenanceCommit: releaseCommit }),
      ],
    }).kind,
    "registry",
  );
  assert.throws(
    () =>
      validateCrateWriteLease({
        eventLease: undefined,
        releaseCommit,
        registryArtifacts: [
          artifact("exact", { name: "carried", advances: false, provenanceCommit: "d".repeat(40) }),
        ],
      }),
    { code: "CRATE_WRITE_LEASE_MISSING" },
  );
});

test("bounded polling uses the exact npm, crate-index, and docs schedules with an injected clock", async () => {
  for (const fixture of [
    { attempts: 30, delayMs: 10_000 },
    { attempts: 30, delayMs: 10_000 },
    { attempts: 60, delayMs: 30_000 },
  ]) {
    let reads = 0;
    const delays = [];
    await assert.rejects(
      pollRegistry({
        attempts: fixture.attempts,
        delayMs: fixture.delayMs,
        read: async () => {
          reads += 1;
          return false;
        },
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      }),
      { code: "REGISTRY_POLL_TIMEOUT" },
    );
    assert.equal(reads, fixture.attempts);
    assert.equal(delays.length, fixture.attempts - 1);
    assert.ok(delays.every((delayMs) => delayMs === fixture.delayMs));
  }
});

test("release sequence requires npm audit before crates and crate audit/docs before tags", () => {
  assert.doesNotThrow(() =>
    assertReleaseSequence([
      "npm-write",
      "npm-audit",
      "crates-write",
      "crates-audit",
      "docs-audit",
      "tag",
    ]),
  );
  assert.throws(
    () =>
      assertReleaseSequence([
        "npm-write",
        "crates-write",
        "npm-audit",
        "crates-audit",
        "docs-audit",
        "tag",
      ]),
    { code: "RELEASE_SEQUENCE_INVALID" },
  );
});
