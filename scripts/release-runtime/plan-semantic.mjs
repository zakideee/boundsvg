import { execFileSync } from "node:child_process";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { cargoManifestHasReleaseMarker, validateReleaseDelta } from "./delta.mjs";
import { failRelease } from "./errors.mjs";
import { readFlatGitTree } from "./git-tree.mjs";
import { loadRepositoryState } from "./repository.mjs";

function git(repositoryRoot, arguments_, encoding = null) {
  try {
    return execFileSync("git", arguments_, {
      cwd: repositoryRoot,
      encoding,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease("PLAN_SEMANTIC_GIT_FAILED", `git ${arguments_.join(" ")} failed`, {
      cause: error,
    });
  }
}

function decodeState(encoded, path) {
  if (encoded.present === false) {
    return undefined;
  }
  const bytes = Buffer.from(encoded.bytesBase64, "base64");
  if (bytes.toString("base64") !== encoded.bytesBase64) {
    failRelease("PLAN_SEMANTIC_BYTES_INVALID", `${path} has noncanonical base64 bytes`);
  }
  return { bytes, mode: encoded.mode };
}

function relevantPlanPaths(plan, state, flatTree) {
  const paths = new Set(plan.files.map(({ path }) => path));
  paths.add("Cargo.lock");
  for (const npmPackage of state.npm.packages) {
    paths.add(npmPackage.path);
    paths.add(`${npmPackage.path.slice(0, -"package.json".length)}CHANGELOG.md`);
  }
  for (const cargoPackage of state.cargo.crates) {
    paths.add(cargoPackage.manifestPath);
  }
  for (const path of flatTree.keys()) {
    if (path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md") {
      paths.add(path);
    }
  }
  return paths;
}

function sourceFileMaps(repositoryRoot, plan, options) {
  const baseFiles = new Map();
  const headFiles = new Map();
  for (const path of options.paths) {
    const entry = options.flatTree.get(path);
    if (entry === undefined) {
      continue;
    }
    if (entry.type !== "blob") {
      failRelease("PLAN_SEMANTIC_FILE_TYPE", `${path} is not a blob in S`);
    }
    const stateAtSource = {
      bytes: git(repositoryRoot, ["show", `${plan.source.commit}:${path}`]),
      mode: entry.mode,
    };
    baseFiles.set(path, stateAtSource);
    headFiles.set(path, stateAtSource);
  }
  return { baseFiles, headFiles };
}

function applyPlanFiles(plan, maps) {
  for (const file of plan.files) {
    const before = decodeState(file.before, file.path);
    const after = decodeState(file.after, file.path);
    const source = maps.baseFiles.get(file.path);
    if (
      (before === undefined && source !== undefined) ||
      (before !== undefined &&
        (source === undefined || source.mode !== before.mode || !source.bytes.equals(before.bytes)))
    ) {
      failRelease("PLAN_SEMANTIC_BEFORE_MISMATCH", `${file.path} before bytes differ from S`);
    }
    if (after === undefined) {
      maps.headFiles.delete(file.path);
    } else {
      maps.headFiles.set(file.path, after);
    }
  }
  return maps;
}

function fileMapsFromPlan(repositoryRoot, plan, state) {
  const flatTree = readFlatGitTree(repositoryRoot, plan.source.commit);
  const paths = relevantPlanPaths(plan, state, flatTree);
  return applyPlanFiles(plan, sourceFileMaps(repositoryRoot, plan, { flatTree, paths }));
}

export function deriveSourceInputHashes(state, baseFiles) {
  const inputs = [];
  for (const [path, fileState] of baseFiles) {
    if (path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md") {
      inputs.push({ path, sha256: sha256(fileState.bytes) });
    }
  }
  const publicNames = new Set(state.cargo.crates.map(({ name }) => name));
  for (const cargoPackage of state.cargo.crates) {
    const fileState = baseFiles.get(cargoPackage.manifestPath);
    if (
      fileState !== undefined &&
      cargoManifestHasReleaseMarker(cargoPackage.manifestPath, fileState.bytes, publicNames)
    ) {
      inputs.push({ path: cargoPackage.manifestPath, sha256: sha256(fileState.bytes) });
    }
  }
  return inputs.sort((left, right) => compareCanonicalStrings(left.path, right.path));
}

export function verifyPlanSemanticDelta(repositoryRoot, plan) {
  const state = loadRepositoryState(repositoryRoot);
  const maps = fileMapsFromPlan(repositoryRoot, plan, state);
  const delta = validateReleaseDelta({
    ...maps,
    cargoPackages: state.cargo.crates.map(({ manifestPath, name }) => ({ manifestPath, name })),
    npmPackages: state.npm.packages.map(({ name, path }) => ({
      changelogPath: `${path.slice(0, -"package.json".length)}CHANGELOG.md`,
      manifestPath: path,
      name,
    })),
    patchNames: state.patchNames,
    workspaceNames: new Set(state.cargoPackages.map(({ name }) => name)),
  });
  if (delta.phase !== "materialized") {
    failRelease(
      "PLAN_SEMANTIC_PHASE",
      "release plan does not represent a materialized version delta",
    );
  }
  if (canonicalJson(delta) !== canonicalJson(plan.semantic?.delta)) {
    failRelease(
      "PLAN_SEMANTIC_REPORT_MISMATCH",
      "release plan semantic report is not independently reproducible",
    );
  }
  const expectedInputs = deriveSourceInputHashes(state, maps.baseFiles);
  const actualInputs = [...plan.inputs].sort((left, right) =>
    compareCanonicalStrings(left.path, right.path),
  );
  if (canonicalJson(expectedInputs) !== canonicalJson(actualInputs)) {
    failRelease("PLAN_INPUT_SET_MISMATCH", "release plan input hashes differ from S");
  }
  if (
    plan.targets.npm !== delta.npm.targetVersion ||
    canonicalJson(plan.targets.crates) !== canonicalJson(delta.cargo.targetVersions)
  ) {
    failRelease(
      "PLAN_TARGET_REPORT_MISMATCH",
      "release plan targets differ from materialized bytes",
    );
  }
  return delta;
}
