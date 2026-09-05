import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateRootCargoLock } from "./cargo-lock.mjs";
import { failRelease } from "./errors.mjs";
import { loadRepositoryState } from "./repository.mjs";

const npmPublishLifecycleScripts = Object.freeze([
  "postpack",
  "postpublish",
  "prepack",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "publish",
]);

function validatePendingChangesets(state) {
  const fixedNames = new Set(state.npm.fixedNames);
  for (const changeset of state.inputs.changesets) {
    for (const release of changeset.releases) {
      if (!fixedNames.has(release.name)) {
        failRelease(
          "CHANGESET_PACKAGE_OUTSIDE_FIXED_GROUP",
          `${changeset.path} names non-fixed package ${release.name}`,
        );
      }
    }
  }
}

function validateNpmLifecycleScripts(state) {
  for (const npmPackage of state.npm.packages) {
    for (const scriptName of npmPublishLifecycleScripts) {
      if (Object.hasOwn(npmPackage.manifest.scripts ?? {}, scriptName)) {
        failRelease(
          "NPM_LIFECYCLE_SCRIPT_FORBIDDEN",
          `${npmPackage.name} defines forbidden publish lifecycle script ${scriptName}`,
        );
      }
    }
  }
}

function rootLockOptions(state) {
  const publicVersions = new Map(state.cargo.crates.map(({ name, version }) => [name, version]));
  const publicDependencies = new Map(
    state.cargo.crates.map((cargoPackage) => [
      cargoPackage.name,
      new Set(cargoPackage.dependencies.map(({ name }) => name)),
    ]),
  );
  return {
    patchNames: state.patchNames,
    publicDependencies,
    publicVersions,
    workspaceNames: new Set(state.cargoPackages.map(({ name }) => name)),
  };
}

function validateSteadyState(state) {
  validatePendingChangesets(state);
  validateNpmLifecycleScripts(state);
  const lockText = readFileSync(join(state.repositoryRoot, "Cargo.lock"), "utf8");
  const lock = validateRootCargoLock(lockText, rootLockOptions(state));
  return {
    cargo: {
      crates: state.cargo.crates.map(({ manifestPath, name, version }) => ({
        manifestPath,
        name,
        version,
      })),
      markers: state.cargo.markers,
      publishOrder: state.cargo.publishOrder,
    },
    inputs: state.inputs,
    lock: { publicProjection: lock.publicProjection },
    npm: {
      currentVersion: state.npm.currentVersion,
      fixedNames: state.npm.fixedNames,
      packages: state.npm.packages.map(({ name, path }) => ({ name, path })),
      publishOrder: state.npm.publishOrder,
    },
    phase: "steady",
    repository: state.repository,
  };
}

export function verifySteadyRepository(repositoryRoot, options = {}) {
  return validateSteadyState(loadRepositoryState(repositoryRoot, options));
}
