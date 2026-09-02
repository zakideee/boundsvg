#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(message) {
  process.stderr.write(`release coherence: ${message}\n`);
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function parseStableVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match === null ? null : match.slice(1).map(Number);
}

function compareStableVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

const publicPackages = readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("packages", entry.name, "package.json"))
  .filter((manifestPath) => existsSync(join(repoRoot, manifestPath)))
  .map((manifestPath) => readJson(manifestPath))
  .filter((manifest) => manifest.private !== true && manifest.publishConfig?.access === "public")
  .sort((left, right) => left.name.localeCompare(right.name));

const publicPackageNames = publicPackages.map((manifest) => manifest.name);
const changesetConfig = readJson(".changeset/config.json");
if (changesetConfig.fixed.length !== 1) {
  fail("expected exactly one fixed npm package group");
}

const fixedPackageNames = [...changesetConfig.fixed[0]].sort();
if (!sameMembers(publicPackageNames, fixedPackageNames)) {
  fail("the fixed npm package group must exactly match the public package set");
}

const publicVersions = new Set(publicPackages.map((manifest) => manifest.version));
if (publicVersions.size !== 1) {
  fail("all fixed npm packages must have the same version");
}

const corePackage = publicPackages.find((manifest) => manifest.name === "@boundsvg/core");
const videoPackage = publicPackages.find((manifest) => manifest.name === "@boundsvg/video");
const coreVersionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(corePackage?.version ?? "");
if (coreVersionMatch === null || videoPackage === undefined) {
  fail("core and video must use stable semantic versions");
}

const coreMajor = Number(coreVersionMatch[1]);
const coreMinor = Number(coreVersionMatch[2]);
const expectedVideoPeer = `>=${coreMajor}.${coreMinor}.0 <${coreMajor}.${coreMinor + 1}.0`;
if (videoPackage.peerDependencies?.["@boundsvg/core"] !== expectedVideoPeer) {
  fail(`video must require the core ${coreMajor}.${coreMinor} line (${expectedVideoPeer})`);
}

const cargoMetadata = JSON.parse(
  execFileSync("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1"], {
    cwd: repoRoot,
    encoding: "utf8",
  }),
);
const publicCrateNames = new Set(["boundshape", "boundtext", "boundsvg"]);
const publicCrates = cargoMetadata.packages.filter((crate) => publicCrateNames.has(crate.name));
if (publicCrates.length !== publicCrateNames.size) {
  fail("expected boundshape, boundtext, and boundsvg in Cargo metadata");
}

const publicCrateVersions = new Map(publicCrates.map((crate) => [crate.name, crate.version]));
for (const crate of publicCrates) {
  for (const dependency of crate.dependencies) {
    const dependencyVersion = publicCrateVersions.get(dependency.name);
    if (dependency.path !== null && dependencyVersion !== undefined) {
      const expectedRequirement = `^${dependencyVersion}`;
      if (dependency.req !== expectedRequirement) {
        fail(
          `${crate.name} requires ${dependency.name} ${dependency.req}; expected ${expectedRequirement}`,
        );
      }
    }
  }
}

const releaseMarkerKeys = ["change-kind", "obligation-id", "pending-version"];
for (const crate of cargoMetadata.packages) {
  const releaseMarker = crate.metadata?.["boundsvg-release"];
  if (releaseMarker === undefined) {
    continue;
  }
  if (!publicCrateNames.has(crate.name)) {
    fail(`${crate.name} has release metadata but is not a public crate`);
  }
  if (releaseMarker === null || typeof releaseMarker !== "object" || Array.isArray(releaseMarker)) {
    fail(`${crate.name} release metadata must be a table`);
  }
  const actualMarkerKeys = Object.keys(releaseMarker).sort();
  if (!sameMembers(actualMarkerKeys, releaseMarkerKeys)) {
    fail(`${crate.name} release metadata must contain exactly ${releaseMarkerKeys.join(", ")}`);
  }

  const pendingVersion = releaseMarker["pending-version"];
  const currentVersionParts = parseStableVersion(crate.version);
  const pendingVersionParts =
    typeof pendingVersion === "string" ? parseStableVersion(pendingVersion) : null;
  if (currentVersionParts === null || pendingVersionParts === null) {
    fail(`${crate.name} release versions must be stable semantic versions`);
  }
  if (compareStableVersions(currentVersionParts, pendingVersionParts) >= 0) {
    fail(`${crate.name} pending version ${pendingVersion} must be greater than ${crate.version}`);
  }

  const changeKind = releaseMarker["change-kind"];
  if (typeof changeKind !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(changeKind)) {
    fail(`${crate.name} release change-kind must be a non-empty kebab-case identifier`);
  }
  const obligationId = releaseMarker["obligation-id"];
  if (typeof obligationId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(obligationId)) {
    fail(`${crate.name} release obligation-id must be a non-empty kebab-case identifier`);
  }
}

process.stdout.write(
  `release coherence: ${publicPackages.length} npm packages and ${publicCrates.length} Rust crates passed\n`,
);
