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

process.stdout.write(
  `release coherence: ${publicPackages.length} npm packages and ${publicCrates.length} Rust crates passed\n`,
);
