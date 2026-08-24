#!/usr/bin/env node

/**
 * Validate synchronized npm, Rust, and generated WASM release versions.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastGlob from "fast-glob";
import { parse } from "yaml";

const cargoManifests = {
  boundmp4: "crates/boundmp4/Cargo.toml",
  boundshape: "crates/boundshape/Cargo.toml",
  boundtext: "crates/boundtext/Cargo.toml",
  boundsvg: "crates/boundsvg/Cargo.toml",
};

const wasmPackages = [
  { relativePath: "packages/core/wasm-pkg/package.json", packageName: "boundsvg" },
  { relativePath: "packages/core/wasm-pkg/scalar/package.json", packageName: "boundsvg" },
  { relativePath: "crates/boundsvg/pkg-web/package.json", packageName: "boundsvg" },
  { relativePath: "crates/boundsvg/pkg-web/scalar/package.json", packageName: "boundsvg" },
  { relativePath: "packages/video/wasm-pkg/package.json", packageName: "boundmp4" },
];

function readJson(rootDirectory, relativePath) {
  return JSON.parse(readFileSync(resolve(rootDirectory, relativePath), "utf8"));
}

function readWorkspacePackagePatterns(rootDirectory) {
  const workspacePath = resolve(rootDirectory, "pnpm-workspace.yaml");
  const workspaceConfig = parse(readFileSync(workspacePath, "utf8"));
  if (
    workspaceConfig === null ||
    typeof workspaceConfig !== "object" ||
    !Array.isArray(workspaceConfig.packages) ||
    workspaceConfig.packages.some((pattern) => typeof pattern !== "string")
  ) {
    throw new TypeError("pnpm-workspace.yaml: packages must be an array of glob strings");
  }
  return workspaceConfig.packages;
}

function packageManifestPattern(workspacePattern) {
  const negated = workspacePattern.startsWith("!");
  const directoryPattern = negated ? workspacePattern.slice(1) : workspacePattern;
  if (
    directoryPattern.length === 0 ||
    isAbsolute(directoryPattern) ||
    directoryPattern === ".." ||
    directoryPattern.startsWith("../")
  ) {
    throw new TypeError(`pnpm-workspace.yaml: invalid package glob ${workspacePattern}`);
  }
  const normalizedPattern = directoryPattern.replace(/\/+$/u, "");
  const manifestPattern =
    normalizedPattern === "." ? "package.json" : `${normalizedPattern}/package.json`;
  return negated ? `!${manifestPattern}` : manifestPattern;
}

/** Discover every publishable package covered by pnpm-workspace.yaml. */
export function discoverPublishablePackagePaths(rootDirectory) {
  const manifestPatterns = readWorkspacePackagePatterns(rootDirectory).map(packageManifestPattern);
  return fastGlob
    .sync(manifestPatterns, {
      cwd: rootDirectory,
      followSymbolicLinks: false,
      onlyFiles: true,
      unique: true,
    })
    .filter((relativePath) => readJson(rootDirectory, relativePath).private !== true)
    .sort();
}

function readPackageVersion(contents) {
  let section = "";
  for (const sourceLine of contents.split("\n")) {
    const line = sourceLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1] ?? "";
      continue;
    }
    if (section === "package") {
      const versionMatch = line.match(/^version\s*=\s*"([^"]+)"$/);
      if (versionMatch) {
        return versionMatch[1];
      }
    }
  }
  return undefined;
}

function readPathDependencyVersions(contents, dependencyName, dependencyPath) {
  const versions = [];
  for (const sourceLine of contents.split("\n")) {
    const line = sourceLine.trim();
    if (!line.startsWith(`${dependencyName} = {`) || !line.includes(`path = "${dependencyPath}"`)) {
      continue;
    }
    const versionMatch = line.match(/\bversion\s*=\s*"([^"]+)"/);
    if (versionMatch) {
      versions.push(versionMatch[1]);
    }
  }
  return versions;
}

function readLockVersion(contents, packageName) {
  for (const block of contents.split("[[package]]").slice(1)) {
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    if (name !== packageName) {
      continue;
    }
    return block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  }
  return undefined;
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((entry) => actual.includes(entry))
  );
}

function auditNpmVersions(npmPackages, expectedVersion) {
  const violations = [];
  for (const { relativePath, manifest } of npmPackages) {
    if (manifest.version !== expectedVersion) {
      violations.push(
        `${relativePath}: version ${String(manifest.version)} does not match ${expectedVersion}`,
      );
    }
  }
  return violations;
}

function auditFixedGroup(resolvedRoot, npmPackages) {
  const publishableNames = npmPackages.map(({ manifest }) => manifest.name);
  const changesetConfig = readJson(resolvedRoot, ".changeset/config.json");
  const hasFixedGroup = Array.isArray(changesetConfig.fixed)
    ? changesetConfig.fixed.some(
        (group) => Array.isArray(group) && sameMembers(group, publishableNames),
      )
    : false;
  return hasFixedGroup
    ? []
    : [".changeset/config.json: publishable packages must share one fixed group"];
}

function auditCargoVersions(resolvedRoot, expectedVersion) {
  const violations = [];
  const cargoContents = Object.fromEntries(
    Object.entries(cargoManifests).map(([crateName, relativePath]) => [
      crateName,
      readFileSync(resolve(resolvedRoot, relativePath), "utf8"),
    ]),
  );
  for (const [crateName, contents] of Object.entries(cargoContents)) {
    const crateVersion = readPackageVersion(contents);
    if (crateVersion !== expectedVersion) {
      violations.push(
        `${cargoManifests[crateName]}: package version ${String(crateVersion)} does not match ${expectedVersion}`,
      );
    }
  }

  const dependencyChecks = [
    ["boundtext", "boundshape", "../boundshape", 1],
    ["boundsvg", "boundshape", "../boundshape", 1],
    ["boundsvg", "boundtext", "../boundtext", 2],
  ];
  for (const [owner, dependencyName, dependencyPath, expectedCount] of dependencyChecks) {
    const versions = readPathDependencyVersions(
      cargoContents[owner],
      dependencyName,
      dependencyPath,
    );
    if (
      versions.length !== expectedCount ||
      versions.some((version) => version !== expectedVersion)
    ) {
      violations.push(
        `${cargoManifests[owner]}: expected ${expectedCount} ${dependencyName} path dependency version(s) at ${expectedVersion}`,
      );
    }
  }

  const cargoLock = readFileSync(resolve(resolvedRoot, "Cargo.lock"), "utf8");
  for (const crateName of Object.keys(cargoManifests)) {
    const lockVersion = readLockVersion(cargoLock, crateName);
    if (lockVersion !== expectedVersion) {
      violations.push(
        `Cargo.lock: ${crateName} version ${String(lockVersion)} does not match ${expectedVersion}`,
      );
    }
  }
  return violations;
}

function auditWasmArtifacts(resolvedRoot, expectedVersion) {
  const violations = [];
  for (const { relativePath, packageName } of wasmPackages) {
    const artifactPath = resolve(resolvedRoot, relativePath);
    if (!existsSync(artifactPath)) {
      violations.push(`${relativePath}: generated WASM package is missing`);
      continue;
    }
    const manifest = readJson(resolvedRoot, relativePath);
    if (manifest.name !== packageName || manifest.version !== expectedVersion) {
      violations.push(
        `${relativePath}: expected ${packageName}@${expectedVersion}, found ${String(manifest.name)}@${String(manifest.version)}`,
      );
    }
  }
  return violations;
}

/** Return every version synchronization violation found under a repository root. */
export function auditReleaseVersionSync(rootDirectory, options = {}) {
  const resolvedRoot = resolve(rootDirectory);
  const publishablePackagePaths = discoverPublishablePackagePaths(resolvedRoot);
  const npmPackages = publishablePackagePaths.map((relativePath) => ({
    relativePath,
    manifest: readJson(resolvedRoot, relativePath),
  }));
  const expectedVersion = npmPackages.find(({ manifest }) => manifest.name === "@boundsvg/core")
    ?.manifest.version;

  if (typeof expectedVersion !== "string") {
    return ["packages/core/package.json: missing package version"];
  }

  return [
    ...auditNpmVersions(npmPackages, expectedVersion),
    ...auditFixedGroup(resolvedRoot, npmPackages),
    ...auditCargoVersions(resolvedRoot, expectedVersion),
    ...(options.artifacts === true ? auditWasmArtifacts(resolvedRoot, expectedVersion) : []),
  ];
}

function runCli() {
  const artifacts = process.argv.includes("--artifacts");
  const violations = auditReleaseVersionSync(process.cwd(), { artifacts });
  if (violations.length > 0) {
    process.stderr.write("release version sync check: failed\n");
    process.stderr.write(`${violations.map((violation) => `- ${violation}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `release version sync check: passed${artifacts ? " (including WASM artifacts)" : ""}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runCli();
}
