#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverPublishablePackagePaths } from "./check-release-version-sync.mjs";

const releaseTypes = ["patch", "minor", "major"];
const releaseTypeRanks = new Map(releaseTypes.map((releaseType, index) => [releaseType, index]));

/** Parse a stable SemVer string into integer components. */
export function parseStableVersion(version) {
  if (typeof version !== "string") {
    throw new TypeError("version must be a string");
  }
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) {
    throw new TypeError(`invalid stable SemVer: ${version}`);
  }
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
  };
}

function formatStableVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

/** Compare stable SemVer values component by component. */
export function compareStableVersions(leftVersion, rightVersion) {
  const left = parseStableVersion(leftVersion);
  const right = parseStableVersion(rightVersion);
  for (const component of ["major", "minor", "patch"]) {
    if (left[component] < right[component]) {
      return -1;
    }
    if (left[component] > right[component]) {
      return 1;
    }
  }
  return 0;
}

/** Return the exact next stable version for one release increment. */
export function incrementStableVersion(version, releaseType) {
  const parsed = parseStableVersion(version);
  if (releaseType === "patch") {
    parsed.patch += 1n;
  } else if (releaseType === "minor") {
    parsed.minor += 1n;
    parsed.patch = 0n;
  } else if (releaseType === "major") {
    parsed.major += 1n;
    parsed.minor = 0n;
    parsed.patch = 0n;
  } else {
    throw new TypeError(`invalid release type: ${String(releaseType)}`);
  }
  return formatStableVersion(parsed);
}

/** Identify an exact one-step stable SemVer transition. */
export function classifyVersionTransition(oldVersion, newVersion) {
  if (compareStableVersions(oldVersion, newVersion) === 0) {
    return "none";
  }
  return releaseTypes.find(
    (releaseType) => incrementStableVersion(oldVersion, releaseType) === newVersion,
  );
}

function appendVersionError(violations, label, operation) {
  try {
    operation();
  } catch (error) {
    violations.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function auditReleaseEntry(release, currentVersion, violations) {
  if (currentVersion !== undefined && release.oldVersion !== currentVersion) {
    violations.push(
      `${release.name}: release plan starts at ${String(release.oldVersion)}, manifest is ${currentVersion}`,
    );
  }

  appendVersionError(violations, release.name, () => {
    parseStableVersion(release.oldVersion);
    parseStableVersion(release.newVersion);
    if (release.type === "none") {
      if (release.newVersion !== release.oldVersion) {
        violations.push(`${release.name}: a none release must keep ${release.oldVersion}`);
      }
      return;
    }
    if (!releaseTypes.includes(release.type)) {
      violations.push(`${release.name}: invalid release type ${String(release.type)}`);
      return;
    }
    const expectedVersion = incrementStableVersion(release.oldVersion, release.type);
    if (release.newVersion !== expectedVersion) {
      violations.push(
        `${release.name}: ${release.type} from ${release.oldVersion} must produce ${expectedVersion}, found ${release.newVersion}`,
      );
    }
  });
}

function collectDeclaredReleaseTypes(changesets) {
  const declaredReleaseTypes = new Map();
  for (const changeset of changesets) {
    for (const release of changeset.releases ?? []) {
      const currentType = declaredReleaseTypes.get(release.name);
      const currentRank = releaseTypeRanks.get(currentType) ?? -1;
      const nextRank = releaseTypeRanks.get(release.type) ?? -1;
      if (nextRank > currentRank) {
        declaredReleaseTypes.set(release.name, release.type);
      }
    }
  }
  return declaredReleaseTypes;
}

function highestDeclaredType(fixedGroup, declaredReleaseTypes) {
  return fixedGroup
    .map((packageName) => declaredReleaseTypes.get(packageName))
    .filter((releaseType) => releaseType !== undefined)
    .sort(
      (leftType, rightType) =>
        (releaseTypeRanks.get(rightType) ?? -1) - (releaseTypeRanks.get(leftType) ?? -1),
    )[0];
}

function auditFixedReleaseGroup(fixedGroup, { declaredReleaseTypes, releasesByName, violations }) {
  const groupReleases = fixedGroup
    .map((packageName) => releasesByName.get(packageName))
    .filter((release) => release !== undefined);
  const activeReleases = groupReleases.filter((release) => release.type !== "none");
  if (activeReleases.length === 0) {
    return;
  }
  if (groupReleases.length !== fixedGroup.length || activeReleases.length !== fixedGroup.length) {
    violations.push("fixed release group: every package must participate in the transition");
    return;
  }
  const releaseTypesInGroup = new Set(activeReleases.map((release) => release.type));
  const oldVersions = new Set(activeReleases.map((release) => release.oldVersion));
  const newVersions = new Set(activeReleases.map((release) => release.newVersion));
  if (releaseTypesInGroup.size !== 1 || oldVersions.size !== 1 || newVersions.size !== 1) {
    violations.push("fixed release group: release type and versions must match");
  }
  const declaredType = highestDeclaredType(fixedGroup, declaredReleaseTypes);
  const resolvedType = activeReleases[0]?.type;
  if (declaredType !== undefined && resolvedType !== declaredType) {
    violations.push(
      `fixed release group: resolved ${String(resolvedType)} does not match declared ${declaredType}`,
    );
  }
}

/** Validate every transition emitted by a Changesets release plan. */
export function auditReleasePlan(releasePlan, options = {}) {
  const violations = [];
  if (!releasePlan || !Array.isArray(releasePlan.releases)) {
    return ["release plan: missing releases array"];
  }

  const releasesByName = new Map();
  for (const release of releasePlan.releases) {
    const label = typeof release?.name === "string" ? release.name : "unnamed release";
    if (typeof release?.name !== "string") {
      violations.push(`${label}: missing package name`);
      continue;
    }
    if (releasesByName.has(release.name)) {
      violations.push(`${release.name}: duplicate release entry`);
      continue;
    }
    releasesByName.set(release.name, release);

    auditReleaseEntry(release, options.packageVersions?.[release.name], violations);
  }

  const declaredReleaseTypes = collectDeclaredReleaseTypes(releasePlan.changesets ?? []);

  for (const fixedGroup of options.fixedGroups ?? []) {
    auditFixedReleaseGroup(fixedGroup, {
      declaredReleaseTypes,
      releasesByName,
      violations,
    });
  }

  return violations;
}

/** Validate an already-applied manifest version transition. */
export function auditAppliedVersionTransition(oldVersion, newVersion) {
  const violations = [];
  appendVersionError(violations, "applied release", () => {
    const releaseType = classifyVersionTransition(oldVersion, newVersion);
    if (releaseType === undefined || releaseType === "none") {
      violations.push(
        `applied release: ${oldVersion} to ${newVersion} is not one exact patch, minor, or major increment`,
      );
    }
  });
  return violations;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readVersionAtRef(rootDirectory, baseRef) {
  const result = spawnSync("git", ["show", `${baseRef}:packages/core/package.json`], {
    cwd: rootDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    throw new Error(`cannot read @boundsvg/core version from ${baseRef}`);
  }
  const manifest = JSON.parse(result.stdout);
  if (typeof manifest.version !== "string") {
    throw new Error(`@boundsvg/core version is missing from ${baseRef}`);
  }
  return manifest.version;
}

/** Select the first historical stable manifest whose version differs from the current release. */
export function selectPreviousVersion(currentVersion, versionHistory) {
  parseStableVersion(currentVersion);
  for (const historyEntry of versionHistory) {
    try {
      parseStableVersion(historyEntry.version);
    } catch {
      continue;
    }
    if (historyEntry.version !== currentVersion) {
      return historyEntry;
    }
  }
  return undefined;
}

/** Find the Git revision and version immediately preceding the current release line. */
export function readPreviousVersion(rootDirectory, currentVersion) {
  const logResult = spawnSync("git", ["log", "--format=%H", "--", "packages/core/package.json"], {
    cwd: rootDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (logResult.status !== 0) {
    throw new Error("cannot read @boundsvg/core version history");
  }
  const refs = logResult.stdout.split("\n").filter(Boolean);
  const versionHistory = (function* readVersionHistory() {
    for (const ref of refs) {
      yield { ref, version: readVersionAtRef(rootDirectory, ref) };
    }
  })();
  const previousVersion = selectPreviousVersion(currentVersion, versionHistory);
  if (!previousVersion) {
    throw new Error(`cannot find a version before @boundsvg/core@${currentVersion}`);
  }
  return previousVersion;
}

function readPackageVersions(rootDirectory) {
  return Object.fromEntries(
    discoverPublishablePackagePaths(rootDirectory).map((relativePath) => {
      const manifest = readJsonFile(resolve(rootDirectory, relativePath));
      return [manifest.name, manifest.version];
    }),
  );
}

function readPendingChangesets(rootDirectory) {
  return readdirSync(resolve(rootDirectory, ".changeset"))
    .filter((fileName) => fileName.endsWith(".md") && fileName !== "README.md")
    .sort();
}

function readReleasePlan(rootDirectory) {
  const relativeOutputPath = `.changeset/.release-plan-${process.pid}-${randomUUID()}.json`;
  const absoluteOutputPath = resolve(rootDirectory, relativeOutputPath);
  const cliPath = resolve(rootDirectory, "node_modules/@changesets/cli/bin.js");
  try {
    const result = spawnSync(
      process.execPath,
      [cliPath, "status", `--output=${relativeOutputPath}`],
      {
        cwd: rootDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status !== 0 || !existsSync(absoluteOutputPath)) {
      const details = [result.stderr, result.stdout]
        .map((output) => output.trim())
        .filter(Boolean)
        .join("\n");
      throw new Error(
        `changeset status did not produce a release plan${details ? `:\n${details}` : ""}`,
      );
    }
    return readJsonFile(absoluteOutputPath);
  } finally {
    rmSync(absoluteOutputPath, { force: true });
  }
}

export function readOption(args, optionName) {
  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) {
    return undefined;
  }
  const optionValue = args[optionIndex + 1];
  if (optionValue === undefined || optionValue.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return optionValue;
}

function runCli() {
  const rootDirectory = process.cwd();
  const args = process.argv.slice(2);
  const explicitBaseRef = readOption(args, "--base");
  const usePreviousVersion = args.includes("--previous-version");
  if (explicitBaseRef !== undefined && usePreviousVersion) {
    throw new Error("--base and --previous-version cannot be combined");
  }
  const packageVersions = readPackageVersions(rootDirectory);
  const currentVersion = packageVersions["@boundsvg/core"];
  if (typeof currentVersion !== "string") {
    throw new Error("@boundsvg/core version is missing");
  }
  const base = usePreviousVersion
    ? readPreviousVersion(rootDirectory, currentVersion)
    : {
        ref: explicitBaseRef ?? "origin/main",
        version: readVersionAtRef(rootDirectory, explicitBaseRef ?? "origin/main"),
      };
  const baseVersion = base.version;
  const changesetConfig = readJsonFile(resolve(rootDirectory, ".changeset/config.json"));

  let violations;
  let outcome;
  if (currentVersion === baseVersion) {
    const pendingChangesets = readPendingChangesets(rootDirectory);
    if (pendingChangesets.length === 0) {
      violations = [];
      outcome = "no transition planned";
    } else {
      const releasePlan = readReleasePlan(rootDirectory);
      violations = auditReleasePlan(releasePlan, {
        fixedGroups: changesetConfig.fixed,
        packageVersions,
      });
      const coreRelease = releasePlan.releases.find(
        (release) => release.name === "@boundsvg/core" && release.type !== "none",
      );
      outcome = coreRelease
        ? `planned ${coreRelease.oldVersion} -> ${coreRelease.newVersion} (${coreRelease.type})`
        : "no transition planned";
    }
  } else {
    violations = auditAppliedVersionTransition(baseVersion, currentVersion);
    if (readPendingChangesets(rootDirectory).length > 0) {
      violations.push("applied release: pending changesets must be consumed");
    }
    const releaseType = classifyVersionTransition(baseVersion, currentVersion);
    outcome = `applied ${baseVersion} -> ${currentVersion} (${String(releaseType)})`;
  }

  if (violations.length > 0) {
    process.stderr.write("release version transition check: failed\n");
    process.stderr.write(`${violations.map((violation) => `- ${violation}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`release version transition check: passed (${outcome})\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write("release version transition check: failed\n");
    process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
