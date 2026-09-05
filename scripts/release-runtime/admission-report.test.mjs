import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { admissionReportSchema, validateAdmissionReport } from "./admission-report.mjs";
import { canonicalJsonBytes, sha256 } from "./canonical.mjs";
import { loadAdmissionReport } from "./workflow-core.mjs";

const releaseCommit = "a".repeat(40);
const parentCommit = "b".repeat(40);
const canonicalDigest = "c".repeat(64);

function reportFixture() {
  const createdAt = "2030-01-01T00:00:00.000Z";
  return {
    artifacts: {
      crates: [],
      npm: [
        {
          advances: true,
          canonicalSha256: canonicalDigest,
          filename: "example-package-1.1.0.tgz",
          frontier: "1.0.0",
          name: "@example/package",
          state: "missing",
          version: "1.1.0",
        },
      ],
    },
    bundle: {
      crates: [],
      npm: [
        {
          archiveSha256: "d".repeat(64),
          canonicalSha256: canonicalDigest,
          file: "npm/example-package-1.1.0.tgz",
          filename: "example-package-1.1.0.tgz",
          name: "@example/package",
          version: "1.1.0",
        },
      ],
    },
    commands: [{ argv: ["pnpm", "build:wasm"], cwd: ".", exitCode: 0 }],
    delta: {
      cargo: {
        advanced: [],
        currentVersions: { "example-crate": "0.2.0" },
        targetVersions: { "example-crate": "0.2.0" },
      },
      npm: { advanced: true, currentVersion: "1.0.0", targetVersion: "1.1.0" },
      phase: "materialized",
    },
    eventCommit: releaseCommit,
    lease: {
      createdAt,
      expiresAt: "2030-01-31T00:00:00.000Z",
      kind: "event",
      remainingReruns: 50,
      runAttempt: 1,
      runId: "1234",
      writeRequired: true,
    },
    mainTip: releaseCommit,
    mode: {
      exact: [],
      missing: ["@example/package"],
      mode: "WRITE_ALL",
      targetArtifactCount: 1,
    },
    parentCommit,
    releaseCommit,
    repository: "zakideee/boundsvg",
    run: { createdAt, runAttempt: 1, runId: "1234" },
    schema: admissionReportSchema,
    seal: { publishSetHash: "e".repeat(64), sha256: "f".repeat(64) },
    target: "npm",
    toolchain: {
      node: "22.14.0",
      npm: "11.19.0",
      pnpm: "10.29.3",
      rust: "1.97.0",
      wasmPack: "0.13.1",
    },
    trailingCommitPhases: [],
    workflowSha: releaseCommit,
    writeOrder: ["@example/package"],
  };
}

test("admission report schema binds identity, delta, artifacts, mode, lease, and command log", () => {
  assert.equal(validateAdmissionReport(reportFixture()).releaseCommit, releaseCommit);
});

test("admission report schema rejects every decision-relevant drift", () => {
  const mutations = [
    (report) => {
      report.unexpected = true;
    },
    (report) => {
      report.workflowSha = parentCommit;
    },
    (report) => {
      report.bundle.npm[0].canonicalSha256 = "0".repeat(64);
    },
    (report) => {
      report.delta.npm.advanced = false;
    },
    (report) => {
      report.mode.mode = "WRITE_MISSING";
    },
    (report) => {
      report.lease.remainingReruns = 49;
    },
    (report) => {
      report.trailingCommitPhases.push("materialized");
    },
    (report) => {
      report.commands[0].argv[0] = "bash";
    },
    (report) => {
      report.writeOrder = [];
    },
  ];
  for (const mutate of mutations) {
    const report = reportFixture();
    mutate(report);
    assert.throws(() => validateAdmissionReport(report), {
      code: "ADMISSION_REPORT_INVALID",
    });
  }
});

test("admission report loading requires canonical bytes, an exact hash file, and regular files", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "boundsvg-admission-report-test-"));
  try {
    const reportBytes = canonicalJsonBytes(reportFixture());
    const reportHash = sha256(reportBytes);
    writeFileSync(join(fixtureRoot, "admission.json"), reportBytes);
    writeFileSync(join(fixtureRoot, "admission.sha256"), `${reportHash}\n`);
    assert.equal(loadAdmissionReport(fixtureRoot, reportHash).releaseCommit, releaseCommit);

    writeFileSync(join(fixtureRoot, "admission.sha256"), reportHash);
    assert.throws(() => loadAdmissionReport(fixtureRoot, reportHash), {
      code: "ADMISSION_REPORT_HASH",
    });

    const targetPath = join(fixtureRoot, "hash-target");
    writeFileSync(targetPath, `${reportHash}\n`);
    rmSync(join(fixtureRoot, "admission.sha256"));
    symlinkSync(targetPath, join(fixtureRoot, "admission.sha256"));
    assert.throws(() => loadAdmissionReport(fixtureRoot, reportHash), {
      code: "ADMISSION_REPORT_HASH",
    });
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});
