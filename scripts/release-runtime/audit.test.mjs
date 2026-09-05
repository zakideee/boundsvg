import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReportArtifacts,
  finalizeAuditAfterDocumentation,
  parseAuditArguments,
  validateAuditPhaseArtifacts,
} from "./audit.mjs";

const releaseCommit = "a".repeat(40);

function artifact(name, state, advances = true) {
  return { advances, name, state };
}

function bundledArtifact(name, version, canonicalSha256) {
  return { canonicalSha256, name, version };
}

test("audit arguments require one phase and release commit with only an optional report", () => {
  assert.deepEqual(
    parseAuditArguments([
      "--phase",
      "pre-crates",
      "--release-commit",
      releaseCommit,
      "--report",
      "/audit/admission.json",
    ]),
    { phase: "pre-crates", releaseCommit, report: "/audit/admission.json" },
  );
  assert.deepEqual(parseAuditArguments(["--release-commit", releaseCommit, "--phase", "pre-tag"]), {
    phase: "pre-tag",
    releaseCommit,
    report: undefined,
  });
  for (const commandArguments of [
    [],
    ["--phase", "publish", "--release-commit", releaseCommit],
    ["--phase", "pre-npm", "--release-commit", "A".repeat(40)],
    ["--phase", "pre-npm", "--release-commit", releaseCommit, "--write", "true"],
    ["--phase", "pre-npm", "--phase", "post-npm", "--release-commit", releaseCommit],
  ]) {
    assert.throws(
      () => parseAuditArguments(commandArguments),
      (error) => String(error.code).startsWith("ARGUMENT_"),
    );
  }
});

test("audit phases distinguish pre-write, post-write, and final exact states dynamically", () => {
  const npmMissing = [artifact("npm-a", "missing"), artifact("npm-b", "missing")];
  const npmPartial = [artifact("npm-a", "exact"), artifact("npm-b", "missing")];
  const npmExact = [artifact("npm-a", "exact"), artifact("npm-b", "exact")];
  const cratesMissing = [artifact("crate-a", "missing")];
  const cratesExact = [artifact("crate-a", "exact")];

  assert.equal(
    validateAuditPhaseArtifacts("pre-npm", {
      crates: cratesMissing,
      npm: npmMissing,
    }).npmMode,
    "WRITE_ALL",
  );
  assert.equal(
    validateAuditPhaseArtifacts("pre-npm", {
      crates: [],
      npm: npmPartial,
    }).npmMode,
    "WRITE_MISSING",
  );
  assert.equal(
    validateAuditPhaseArtifacts("pre-crates", {
      crates: cratesMissing,
      npm: npmExact,
    }).cratesMode,
    "WRITE_ALL",
  );
  assert.deepEqual(
    validateAuditPhaseArtifacts("pre-crates", {
      crates: cratesMissing,
      npm: [artifact("npm-carried", "exact", false)],
    }),
    { cratesMode: "WRITE_ALL", npmMode: "AUDIT_ONLY" },
  );
  assert.deepEqual(validateAuditPhaseArtifacts("pre-tag", { crates: [], npm: [] }), {
    cratesMode: "AUDIT_ONLY",
    npmMode: "AUDIT_ONLY",
  });

  assert.throws(
    () => validateAuditPhaseArtifacts("post-npm", { crates: cratesMissing, npm: npmMissing }),
    { code: "AUDIT_NPM_NOT_EXACT" },
  );
  assert.throws(
    () => validateAuditPhaseArtifacts("post-crates", { crates: cratesMissing, npm: npmExact }),
    { code: "AUDIT_CRATES_NOT_EXACT" },
  );
  assert.doesNotThrow(() =>
    validateAuditPhaseArtifacts("post-crates", { crates: cratesExact, npm: npmExact }),
  );
});

test("admission report artifact comparison follows the carried target scope", () => {
  const npmArtifacts = [bundledArtifact("npm-a", "2.8.0", "a".repeat(64))];
  const crateArtifacts = [bundledArtifact("crate-a", "1.4.0", "b".repeat(64))];
  const localArtifacts = { crates: crateArtifacts, npm: npmArtifacts };

  assert.doesNotThrow(() =>
    assertReportArtifacts(
      { bundle: { crates: [], npm: npmArtifacts }, target: "npm" },
      localArtifacts,
    ),
  );
  assert.throws(
    () =>
      assertReportArtifacts(
        {
          bundle: {
            crates: [],
            npm: [bundledArtifact("npm-a", "2.8.0", "c".repeat(64))],
          },
          target: "npm",
        },
        localArtifacts,
      ),
    { code: "AUDIT_REPORT_ARTIFACT_MISMATCH" },
  );
  assert.doesNotThrow(() =>
    assertReportArtifacts(
      { bundle: { crates: crateArtifacts, npm: npmArtifacts }, target: "crates" },
      localArtifacts,
    ),
  );
  assert.throws(
    () =>
      assertReportArtifacts(
        { bundle: { crates: [], npm: npmArtifacts }, target: "crates" },
        localArtifacts,
      ),
    { code: "AUDIT_REPORT_ARTIFACT_MISMATCH" },
  );
});

test("pre-tag authority is refreshed only after documentation closes", async () => {
  const events = [];
  const initialProjection = { crateArtifacts: [{ name: "crate-a" }], mainTip: "initial" };
  const finalProjection = { crateArtifacts: initialProjection.crateArtifacts, mainTip: "feature" };
  const result = await finalizeAuditAfterDocumentation("pre-tag", initialProjection, {
    auditDocumentation: async (artifacts) => {
      events.push(`docs:${artifacts.length}`);
    },
    refreshProjection: async () => {
      events.push("refresh");
      return finalProjection;
    },
  });
  assert.equal(result, finalProjection);
  assert.deepEqual(events, ["docs:1", "refresh"]);

  events.length = 0;
  assert.equal(
    await finalizeAuditAfterDocumentation("post-crates", initialProjection, {
      auditDocumentation: async () => events.push("docs"),
      refreshProjection: async () => events.push("unexpected refresh"),
    }),
    initialProjection,
  );
  assert.deepEqual(events, ["docs"]);
});

test("every final pre-tag authority drift aborts instead of returning the initial projection", async () => {
  for (const code of [
    "REQUIRED_CHECK_NOT_SUCCESSFUL",
    "NPM_DIST_TAG_MISMATCH",
    "CRATE_YANKED",
    "CONTROL_SEAL_MISMATCH",
    "GITHUB_SETTINGS_MISMATCH",
    "REGISTRY_RESPONSE_INVALID",
  ]) {
    await assert.rejects(
      finalizeAuditAfterDocumentation(
        "pre-tag",
        { crateArtifacts: [], mainTip: "initial" },
        {
          auditDocumentation: async () => {},
          refreshProjection: async () => {
            const error = new Error("final authority drift");
            error.code = code;
            throw error;
          },
        },
      ),
      { code },
    );
  }
});
