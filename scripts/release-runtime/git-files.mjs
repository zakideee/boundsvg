import { execFileSync } from "node:child_process";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { validateReleaseDelta } from "./delta.mjs";
import { failRelease } from "./errors.mjs";
import { loadRepositoryState } from "./repository.mjs";

function git(repositoryRoot, arguments_, options = {}) {
  try {
    return execFileSync("git", arguments_, {
      cwd: repositoryRoot,
      encoding: options.encoding,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease("GIT_READ_FAILED", `git ${arguments_.join(" ")} failed`, { cause: error });
  }
}

export function resolveCommit(repositoryRoot, revision) {
  const commit = git(repositoryRoot, ["rev-parse", "--verify", `${revision}^{commit}`], {
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    failRelease("GIT_COMMIT_INVALID", `${revision} did not resolve to a full commit`);
  }
  return commit;
}

function mergeBase(repositoryRoot, left, right) {
  return resolveCommit(
    repositoryRoot,
    git(repositoryRoot, ["merge-base", left, right], { encoding: "utf8" }).trim(),
  );
}

function listTreePaths(repositoryRoot, commit, prefix) {
  const argumentList = ["ls-tree", "-r", "-z", "--name-only", commit];
  if (prefix !== undefined) {
    argumentList.push("--", prefix);
  }
  return git(repositoryRoot, argumentList).toString("utf8").split("\0").filter(Boolean);
}

function treeEntry(repositoryRoot, commit, path) {
  const output = git(repositoryRoot, ["ls-tree", "-z", commit, "--", path]).toString("utf8");
  if (output === "") {
    return undefined;
  }
  const match = /^(\d{6}) (?:blob|commit) [a-f0-9]{40}\t([^\0]+)\0$/.exec(output);
  if (match === null || match[2] !== path) {
    failRelease("GIT_TREE_ENTRY_INVALID", `cannot parse tree entry for ${path}`);
  }
  return {
    bytes: git(repositoryRoot, ["show", `${commit}:${path}`]),
    mode: match[1],
  };
}

function changedPaths(repositoryRoot, baseCommit, headCommit) {
  return git(repositoryRoot, ["diff", "--name-only", "-z", baseCommit, headCommit])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

export function readVersionFileMaps(repositoryRoot, options) {
  const { baseCommit, headCommit, state } = options;
  const paths = new Set(changedPaths(repositoryRoot, baseCommit, headCommit));
  paths.add("Cargo.lock");
  for (const npmPackage of state.npm.packages) {
    paths.add(npmPackage.path);
    paths.add(`${npmPackage.path.slice(0, -"package.json".length)}CHANGELOG.md`);
  }
  for (const cargoPackage of state.cargo.crates) {
    paths.add(cargoPackage.manifestPath);
  }
  for (const commit of [baseCommit, headCommit]) {
    for (const path of listTreePaths(repositoryRoot, commit, ".changeset")) {
      if (path.endsWith(".md") && path !== ".changeset/README.md") {
        paths.add(path);
      }
    }
  }
  const baseFiles = new Map();
  const headFiles = new Map();
  for (const path of [...paths].sort()) {
    const baseEntry = treeEntry(repositoryRoot, baseCommit, path);
    const headEntry = treeEntry(repositoryRoot, headCommit, path);
    if (baseEntry !== undefined) {
      baseFiles.set(path, baseEntry);
    }
    if (headEntry !== undefined) {
      headFiles.set(path, headEntry);
    }
  }
  return { baseFiles, headFiles };
}

export function verifyRepositoryDelta(repositoryRoot, baseRevision, options = {}) {
  const state = options.state ?? loadRepositoryState(repositoryRoot, options);
  const headCommit = resolveCommit(repositoryRoot, "HEAD");
  const baseTip = resolveCommit(repositoryRoot, baseRevision);
  const baseCommit = mergeBase(repositoryRoot, baseTip, headCommit);
  const fileMaps = readVersionFileMaps(repositoryRoot, { baseCommit, headCommit, state });
  const result = validateReleaseDelta({
    ...fileMaps,
    cargoPackages: state.cargo.crates.map(({ manifestPath, name }) => ({ manifestPath, name })),
    npmPackages: state.npm.packages.map(({ name, path }) => ({
      changelogPath: `${path.slice(0, -"package.json".length)}CHANGELOG.md`,
      manifestPath: path,
      name,
    })),
    patchNames: state.patchNames,
    workspaceNames: new Set(state.cargoPackages.map(({ name }) => name)),
  });
  return { ...result, baseCommit, headCommit, repository: state.repository };
}
