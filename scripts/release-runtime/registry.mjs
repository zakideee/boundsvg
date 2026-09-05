import { failRelease } from "./errors.mjs";
import {
  compareStableVersions,
  maximumStableVersion,
  parseStableVersion,
  resolveExplicitTarget,
} from "./semver.mjs";

export const npmAvailabilityPolicy = Object.freeze({ attempts: 30, delayMs: 10_000 });
export const crateIndexPolicy = Object.freeze({ attempts: 30, delayMs: 10_000 });
export const docsBuildPolicy = Object.freeze({ attempts: 60, delayMs: 30_000 });

const npmLeaseLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const npmMaximumReruns = 50;

export function classifyStableTarget(options) {
  const {
    carried,
    current,
    deprecated = new Set(),
    state,
    target: targetInput,
    versions,
    yanked = new Set(),
  } = options;
  if (state !== "known") {
    const code = state === "tombstone" ? "TARGET_TOMBSTONE" : "FRONTIER_UNKNOWN";
    failRelease(code, "registry frontier is not definitive");
  }

  parseStableVersion(current);
  for (const version of versions) {
    parseStableVersion(version);
  }
  const resolved = resolveExplicitTarget(targetInput, current);
  const target = resolved.target;
  if (deprecated.has(target)) {
    failRelease("TARGET_DEPRECATED", `${target} is deprecated`);
  }
  if (yanked.has(target)) {
    failRelease("TARGET_YANKED", `${target} is yanked`);
  }

  const frontier = maximumStableVersion(versions);
  if (!resolved.advances) {
    if (!carried || !versions.includes(target)) {
      failRelease("CURRENT_NOT_CARRIED", `${target} is not an exact carried artifact`);
    }
    if (frontier !== undefined && compareStableVersions(frontier, target) > 0) {
      failRelease("CURRENT_BEHIND_FRONTIER", `${target} is behind registry frontier ${frontier}`);
    }
    return { advances: false, frontier, target };
  }

  const targetExists = versions.includes(target);
  if (targetExists && (options.allowExistingTarget !== true || !carried)) {
    failRelease("TARGET_EXISTS", `${target} already exists in the registry`);
  }
  if (
    frontier !== undefined &&
    (compareStableVersions(target, frontier) < 0 ||
      (compareStableVersions(target, frontier) === 0 && !targetExists))
  ) {
    failRelease("TARGET_BEHIND_FRONTIER", `${target} is not above registry frontier ${frontier}`);
  }
  return { advances: true, frontier, target };
}

export function classifyRegistryMode(artifacts) {
  for (const entry of artifacts) {
    if (entry.state === "conflict") {
      failRelease("REGISTRY_CONFLICT", `${entry.name} conflicts with the release source`);
    }
    if (entry.state === "unknown") {
      failRelease("REGISTRY_UNKNOWN", `${entry.name} has an unknown registry state`);
    }
    if (!entry.advances && entry.state !== "exact") {
      failRelease("CARRIED_ARTIFACT_NOT_EXACT", `${entry.name} is not an exact carried artifact`);
    }
    if (entry.state !== "exact" && entry.state !== "missing") {
      failRelease("REGISTRY_STATE_INVALID", `${entry.name} has invalid state ${entry.state}`);
    }
  }

  const advanced = artifacts.filter((entry) => entry.advances);
  const exact = advanced.filter((entry) => entry.state === "exact");
  const missing = advanced.filter((entry) => entry.state === "missing");
  let mode = "AUDIT_ONLY";
  if (advanced.length > 0 && exact.length === 0 && missing.length === advanced.length) {
    mode = "WRITE_ALL";
  } else if (advanced.length > 0 && exact.length > 0 && missing.length > 0) {
    mode = "WRITE_MISSING";
  } else if (missing.length !== 0) {
    failRelease("REGISTRY_MODE_AMBIGUOUS", "registry state does not map to one release mode");
  }
  return {
    exact: exact.map((entry) => entry.name),
    missing: missing.map((entry) => entry.name),
    mode,
    targetArtifactCount: advanced.length,
  };
}

function parseInstant(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    failRelease(code, `invalid timestamp: ${value}`);
  }
  return parsed;
}

export function validateNpmEventLease(lease) {
  if (lease.repository !== "zakideee/boundsvg") {
    failRelease("NPM_EVENT_REPOSITORY_MISMATCH", "npm event repository is not canonical");
  }
  if (lease.workflowPath !== ".github/workflows/release.yml") {
    failRelease("NPM_EVENT_WORKFLOW_MISMATCH", "npm event workflow path is not canonical");
  }
  if (lease.ref !== "refs/heads/main") {
    failRelease("NPM_EVENT_REF_MISMATCH", "npm event did not originate from main");
  }
  if (lease.eventCommit !== lease.releaseCommit) {
    failRelease("NPM_EVENT_COMMIT_MISMATCH", "npm event commit does not equal the release commit");
  }
  if (lease.workflowSha !== lease.releaseCommit) {
    failRelease(
      "NPM_EVENT_WORKFLOW_SHA_MISMATCH",
      "npm workflow SHA does not equal the release commit",
    );
  }
  if (!Number.isInteger(lease.runAttempt) || lease.runAttempt < 1) {
    failRelease("NPM_RUN_ATTEMPT_INVALID", "npm run attempt must be a positive integer");
  }
  if (lease.runAttempt - 1 > npmMaximumReruns) {
    failRelease("NPM_RERUN_LIMIT", "npm event exceeded the rerun limit");
  }
  const createdAt = parseInstant(lease.createdAt, "NPM_EVENT_CREATED_AT_INVALID");
  const now = parseInstant(lease.now, "NPM_EVENT_NOW_INVALID");
  if (now < createdAt || now - createdAt > npmLeaseLifetimeMs) {
    failRelease("NPM_EVENT_EXPIRED", "npm event is outside the allowed rerun window");
  }
  return {
    createdAt: lease.createdAt,
    expiresAt: new Date(createdAt + npmLeaseLifetimeMs).toISOString(),
    kind: "event",
    remainingReruns: npmMaximumReruns - (lease.runAttempt - 1),
    runAttempt: lease.runAttempt,
    runId: lease.runId,
  };
}

export function validateCrateWriteLease(options) {
  if (options.eventLease !== undefined) {
    return options.eventLease;
  }
  const registryLease = options.registryArtifacts.find(
    (entry) =>
      entry.advances && entry.state === "exact" && entry.provenanceCommit === options.releaseCommit,
  );
  if (registryLease === undefined) {
    failRelease("CRATE_WRITE_LEASE_MISSING", "crate write has no valid event or registry lease");
  }
  return { artifact: registryLease.name, kind: "registry" };
}

export async function pollRegistry(options) {
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    failRelease("POLL_ATTEMPTS_INVALID", "poll attempts must be a positive integer");
  }
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    if (await options.read(attempt)) {
      return { attempt };
    }
    if (attempt < options.attempts) {
      await options.sleep(options.delayMs);
    }
  }
  failRelease("REGISTRY_POLL_TIMEOUT", "registry state remained uncertain after bounded polling");
}

export function assertReleaseSequence(events) {
  const indexOf = (name) => events.indexOf(name);
  const npmWrite = indexOf("npm-write");
  const npmAudit = indexOf("npm-audit");
  const cratesWrite = indexOf("crates-write");
  const cratesAudit = indexOf("crates-audit");
  const docsAudit = indexOf("docs-audit");
  const tag = indexOf("tag");
  const ordered =
    npmAudit >= 0 &&
    (npmWrite < 0 || npmWrite < npmAudit) &&
    (cratesWrite < 0 || npmAudit < cratesWrite) &&
    cratesAudit >= 0 &&
    (cratesWrite < 0 || cratesWrite < cratesAudit) &&
    docsAudit > cratesAudit &&
    tag > docsAudit;
  if (!ordered) {
    failRelease("RELEASE_SEQUENCE_INVALID", "release events violate the required audit order");
  }
}
