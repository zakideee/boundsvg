import { posix } from "node:path";

import { canonicalJson } from "./canonical.mjs";
import { failRelease } from "./errors.mjs";
import { classifyRegistryMode } from "./registry.mjs";
import { canonicalRepository } from "./repository.mjs";
import { compareStableVersions, parseStableVersion } from "./semver.mjs";

export const admissionReportSchema = "https://boundsvg.dev/release-admission/v1";

const commitPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const runIdPattern = /^[1-9]\d*$/;
const eventLeaseLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const maximumEventReruns = 50;
const expectedToolchain = Object.freeze({
  node: "22.14.0",
  npm: "11.19.0",
  pnpm: "10.29.3",
  rust: "1.97.0",
  wasmPack: "0.13.1",
});

function failReport(message) {
  failRelease("ADMISSION_REPORT_INVALID", message);
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failReport(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, requiredKeys, options) {
  const record = assertRecord(value, options.label);
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...(options.optionalKeys ?? [])]);
  if (
    [...required].some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    failReport(`${options.label} has missing or unknown fields`);
  }
  return record;
}

function assertCommit(value, label) {
  if (typeof value !== "string" || !commitPattern.test(value)) {
    failReport(`${label} must be a full lowercase commit ID`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    failReport(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertStableVersion(value, label) {
  try {
    parseStableVersion(value);
  } catch {
    failReport(`${label} must be a canonical stable version`);
  }
}

function assertSafeName(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 214 ||
    /[\0\r\n]/.test(value)
  ) {
    failReport(`${label} is invalid`);
  }
}

function assertUniqueNames(entries, label) {
  const names = entries.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    failReport(`${label} contains duplicate artifact names`);
  }
}

function validateVersionMap(value, label) {
  const versions = assertRecord(value, label);
  for (const [name, version] of Object.entries(versions)) {
    assertSafeName(name, `${label} name`);
    assertStableVersion(version, `${label}.${name}`);
  }
  return versions;
}

function validateDelta(delta) {
  assertExactKeys(delta, ["cargo", "npm", "phase"], { label: "delta" });
  if (delta.phase !== "materialized") {
    failReport("delta phase must be materialized");
  }
  const cargo = assertExactKeys(delta.cargo, ["advanced", "currentVersions", "targetVersions"], {
    label: "delta.cargo",
  });
  const npm = assertExactKeys(delta.npm, ["advanced", "currentVersion", "targetVersion"], {
    label: "delta.npm",
  });
  if (!Array.isArray(cargo.advanced) || new Set(cargo.advanced).size !== cargo.advanced.length) {
    failReport("delta.cargo.advanced must be a unique array");
  }
  const currentVersions = validateVersionMap(cargo.currentVersions, "delta.cargo.currentVersions");
  const targetVersions = validateVersionMap(cargo.targetVersions, "delta.cargo.targetVersions");
  if (
    canonicalJson(Object.keys(currentVersions).sort()) !==
    canonicalJson(Object.keys(targetVersions).sort())
  ) {
    failReport("Cargo current and target version sets differ");
  }
  const advancedNames = new Set(cargo.advanced);
  for (const name of cargo.advanced) {
    assertSafeName(name, "delta.cargo.advanced name");
    if (!Object.hasOwn(targetVersions, name)) {
      failReport(`${name} is not in the Cargo target version set`);
    }
  }
  for (const name of Object.keys(targetVersions)) {
    const comparison = compareStableVersions(targetVersions[name], currentVersions[name]);
    if (
      (advancedNames.has(name) && comparison <= 0) ||
      (!advancedNames.has(name) && comparison !== 0)
    ) {
      failReport(`${name} Cargo advance classification is inconsistent`);
    }
  }
  if (typeof npm.advanced !== "boolean") {
    failReport("delta.npm.advanced must be boolean");
  }
  assertStableVersion(npm.currentVersion, "delta.npm.currentVersion");
  assertStableVersion(npm.targetVersion, "delta.npm.targetVersion");
  const npmComparison = compareStableVersions(npm.targetVersion, npm.currentVersion);
  if ((npm.advanced && npmComparison <= 0) || (!npm.advanced && npmComparison !== 0)) {
    failReport("npm advance classification is inconsistent");
  }
  if (!npm.advanced && cargo.advanced.length === 0) {
    failReport("a materialized report must advance at least one artifact");
  }
}

function validateObservedArtifact(entry, label) {
  assertExactKeys(
    entry,
    ["advances", "canonicalSha256", "filename", "frontier", "name", "state", "version"],
    { label, optionalKeys: ["provenanceCommit"] },
  );
  if (typeof entry.advances !== "boolean" || !["exact", "missing"].includes(entry.state)) {
    failReport(`${label} has an invalid classification`);
  }
  assertDigest(entry.canonicalSha256, `${label}.canonicalSha256`);
  assertSafeName(entry.name, `${label}.name`);
  assertStableVersion(entry.version, `${label}.version`);
  if (
    typeof entry.filename !== "string" ||
    entry.filename.length === 0 ||
    entry.filename.includes("\\") ||
    posix.basename(entry.filename) !== entry.filename
  ) {
    failReport(`${label}.filename is unsafe`);
  }
  if (entry.frontier !== null) {
    assertStableVersion(entry.frontier, `${label}.frontier`);
  }
  if (entry.state === "exact") {
    assertCommit(entry.provenanceCommit, `${label}.provenanceCommit`);
  } else if (Object.hasOwn(entry, "provenanceCommit")) {
    failReport(`${label} cannot bind provenance while missing`);
  }
  if (!entry.advances && entry.state !== "exact") {
    failReport(`${label} carried artifact is not exact`);
  }
}

function validateBundleArtifact(entry, ecosystem, label) {
  assertExactKeys(
    entry,
    ["archiveSha256", "canonicalSha256", "file", "filename", "name", "version"],
    { label },
  );
  assertDigest(entry.archiveSha256, `${label}.archiveSha256`);
  assertDigest(entry.canonicalSha256, `${label}.canonicalSha256`);
  assertSafeName(entry.name, `${label}.name`);
  assertStableVersion(entry.version, `${label}.version`);
  if (
    typeof entry.file !== "string" ||
    !entry.file.startsWith(`${ecosystem}/`) ||
    entry.file.includes("\\") ||
    entry.file
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..") ||
    typeof entry.filename !== "string" ||
    posix.basename(entry.file) !== entry.filename
  ) {
    failReport(`${label} has an unsafe bundle path`);
  }
}

function artifactIdentity(entries) {
  return entries.map(({ canonicalSha256, filename, name, version }) => ({
    canonicalSha256,
    filename,
    name,
    version,
  }));
}

function validateArtifactBundlePair(report, ecosystem) {
  const observed = report.artifacts[ecosystem];
  const bundled = report.bundle[ecosystem];
  if (!Array.isArray(observed) || !Array.isArray(bundled)) {
    failReport(`${ecosystem} artifact projections must be arrays`);
  }
  observed.forEach((entry, index) => {
    validateObservedArtifact(entry, `artifacts.${ecosystem}[${index}]`);
  });
  bundled.forEach((entry, index) => {
    validateBundleArtifact(entry, ecosystem, `bundle.${ecosystem}[${index}]`);
  });
  assertUniqueNames(observed, `artifacts.${ecosystem}`);
  assertUniqueNames(bundled, `bundle.${ecosystem}`);
  if (canonicalJson(artifactIdentity(observed)) !== canonicalJson(artifactIdentity(bundled))) {
    failReport(`${ecosystem} report and bundle artifact identities differ`);
  }
}

function validateTargetArtifactScope(report) {
  if (report.artifacts.npm.length === 0) {
    failReport("npm fixed-group artifacts are missing");
  }
  if (
    report.target === "npm" &&
    (report.artifacts.crates.length !== 0 || report.bundle.crates.length !== 0)
  ) {
    failReport("an npm report cannot carry crate artifacts");
  }
  if (report.target === "crates" && report.artifacts.crates.length === 0) {
    failReport("a crates report must carry public crate artifacts");
  }
}

function validateNpmArtifactDelta(report) {
  for (const artifact of report.artifacts.npm) {
    if (
      artifact.advances !== report.delta.npm.advanced ||
      artifact.version !== report.delta.npm.targetVersion
    ) {
      failReport(`${artifact.name} differs from the npm delta`);
    }
  }
}

function validateCrateArtifactDelta(report) {
  if (report.target !== "crates") {
    return;
  }
  const crateNames = report.artifacts.crates.map(({ name }) => name).sort();
  if (
    canonicalJson(crateNames) !==
    canonicalJson(Object.keys(report.delta.cargo.targetVersions).sort())
  ) {
    failReport("crate artifact set differs from the Cargo delta");
  }
  const advancedNames = new Set(report.delta.cargo.advanced);
  for (const artifact of report.artifacts.crates) {
    if (
      artifact.advances !== advancedNames.has(artifact.name) ||
      artifact.version !== report.delta.cargo.targetVersions[artifact.name]
    ) {
      failReport(`${artifact.name} differs from the Cargo delta`);
    }
  }
  if (report.artifacts.npm.some(({ state }) => state !== "exact")) {
    failReport("crates report npm prerequisites must all be exact");
  }
}

function validateArtifactMode(report) {
  const selected = report.artifacts[report.target];
  const derivedMode = classifyRegistryMode(selected);
  if (canonicalJson(report.mode) !== canonicalJson(derivedMode)) {
    failReport("registry mode differs from the artifact projection");
  }
  const expectedWriteOrder = selected.filter(({ advances }) => advances).map(({ name }) => name);
  if (canonicalJson(report.writeOrder) !== canonicalJson(expectedWriteOrder)) {
    failReport("write order differs from the selected publish graph");
  }
}

function validateArtifactCollections(report) {
  assertExactKeys(report.artifacts, ["crates", "npm"], { label: "artifacts" });
  assertExactKeys(report.bundle, ["crates", "npm"], { label: "bundle" });
  for (const ecosystem of ["npm", "crates"]) {
    validateArtifactBundlePair(report, ecosystem);
  }
  validateTargetArtifactScope(report);
  validateNpmArtifactDelta(report);
  validateCrateArtifactDelta(report);
  validateArtifactMode(report);
}

function validateRun(run) {
  assertExactKeys(run, ["createdAt", "runAttempt", "runId"], { label: "run" });
  if (
    typeof run.createdAt !== "string" ||
    !Number.isFinite(Date.parse(run.createdAt)) ||
    !Number.isInteger(run.runAttempt) ||
    run.runAttempt < 1 ||
    typeof run.runId !== "string" ||
    !runIdPattern.test(run.runId)
  ) {
    failReport("workflow run identity is invalid");
  }
}

function validateLease(report) {
  const writeRequired = report.mode.mode !== "AUDIT_ONLY";
  if (!writeRequired) {
    assertExactKeys(report.lease, ["kind", "writeRequired"], { label: "lease" });
    if (report.lease.kind !== "none" || report.lease.writeRequired !== false) {
      failReport("audit-only mode must carry no write lease");
    }
    return;
  }
  if (report.lease?.kind === "event") {
    assertExactKeys(
      report.lease,
      ["createdAt", "expiresAt", "kind", "remainingReruns", "runAttempt", "runId", "writeRequired"],
      { label: "lease" },
    );
    const createdAt = Date.parse(report.lease.createdAt);
    const expiresAt = Date.parse(report.lease.expiresAt);
    if (
      report.lease.writeRequired !== true ||
      report.lease.createdAt !== report.run.createdAt ||
      report.lease.runAttempt !== report.run.runAttempt ||
      report.lease.runId !== report.run.runId ||
      !Number.isFinite(createdAt) ||
      expiresAt !== createdAt + eventLeaseLifetimeMs ||
      report.lease.remainingReruns !== maximumEventReruns - (report.run.runAttempt - 1)
    ) {
      failReport("event lease differs from the workflow run family");
    }
    return;
  }
  if (report.target !== "crates" || report.lease?.kind !== "registry") {
    failReport("selected registry has no valid lease kind");
  }
  assertExactKeys(report.lease, ["artifact", "kind", "writeRequired"], { label: "lease" });
  const leaseArtifact = [...report.artifacts.npm, ...report.artifacts.crates].find(
    ({ name }) => name === report.lease.artifact,
  );
  if (
    report.lease.writeRequired !== true ||
    leaseArtifact?.advances !== true ||
    leaseArtifact.state !== "exact" ||
    leaseArtifact.provenanceCommit !== report.releaseCommit
  ) {
    failReport("registry lease is not bound to an advanced exact R artifact");
  }
}

function validateCommandLog(commands) {
  if (!Array.isArray(commands)) {
    failReport("commands must be an array");
  }
  for (const [index, command] of commands.entries()) {
    assertExactKeys(command, ["argv", "cwd", "exitCode"], {
      label: `commands[${index}]`,
    });
    if (
      !Array.isArray(command.argv) ||
      command.argv.length === 0 ||
      command.argv.some((argument) => typeof argument !== "string" || argument.length === 0) ||
      !["cargo", "node", "pnpm"].includes(command.argv[0]) ||
      typeof command.cwd !== "string" ||
      command.cwd.includes("\\") ||
      (command.cwd !== "." &&
        command.cwd.split("/").some((part) => part === "" || part === "." || part === "..")) ||
      command.exitCode !== 0
    ) {
      failReport(`commands[${index}] is invalid`);
    }
  }
}

export function validateAdmissionReport(report) {
  assertExactKeys(
    report,
    [
      "artifacts",
      "bundle",
      "commands",
      "delta",
      "eventCommit",
      "lease",
      "mainTip",
      "mode",
      "parentCommit",
      "releaseCommit",
      "repository",
      "run",
      "schema",
      "seal",
      "target",
      "toolchain",
      "trailingCommitPhases",
      "workflowSha",
      "writeOrder",
    ],
    { label: "admission report" },
  );
  if (
    report.schema !== admissionReportSchema ||
    report.repository !== canonicalRepository ||
    !["npm", "crates"].includes(report.target)
  ) {
    failReport("admission report identity is invalid");
  }
  for (const field of ["eventCommit", "mainTip", "parentCommit", "releaseCommit", "workflowSha"]) {
    assertCommit(report[field], field);
  }
  if (report.eventCommit !== report.workflowSha) {
    failReport("workflow source commit differs from the event commit");
  }
  assertExactKeys(report.seal, ["publishSetHash", "sha256"], { label: "seal" });
  assertDigest(report.seal.publishSetHash, "seal.publishSetHash");
  assertDigest(report.seal.sha256, "seal.sha256");
  assertExactKeys(report.toolchain, Object.keys(expectedToolchain), { label: "toolchain" });
  if (canonicalJson(report.toolchain) !== canonicalJson(expectedToolchain)) {
    failReport("report toolchain differs from the release pins");
  }
  if (
    !Array.isArray(report.trailingCommitPhases) ||
    report.trailingCommitPhases.some((phase) => phase !== "steady") ||
    !Array.isArray(report.writeOrder) ||
    new Set(report.writeOrder).size !== report.writeOrder.length
  ) {
    failReport("trailing commit phases or write order are invalid");
  }
  validateRun(report.run);
  validateDelta(report.delta);
  validateArtifactCollections(report);
  validateLease(report);
  validateCommandLog(report.commands);
  return report;
}
