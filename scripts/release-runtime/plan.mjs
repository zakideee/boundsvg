import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { canonicalJsonBytes, compareCanonicalStrings, sha256 } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { asReleaseControlError, failRelease } from "./errors.mjs";
import { commitTreeId, prospectiveTreeId, readFlatGitTree } from "./git-tree.mjs";
import { releasePlanSchema, validateReleasePlanMetadata } from "./plan-schema.mjs";
import { canonicalRepository } from "./repository.mjs";

const allowedFileModes = new Set(["100644", "100755"]);
const lowercaseObjectIdPattern = /^[a-f0-9]{40}$/;
const lowercaseSha256Pattern = /^[a-f0-9]{64}$/;
const maximumPlanBytes = 64 * 1024 * 1024;

function git(repositoryRoot, arguments_, encoding = "utf8") {
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
    failRelease("GIT_READ_FAILED", `git ${arguments_.join(" ")} failed`, { cause: error });
  }
}

function validatePlanPath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    path.split("/").some((component) => component === "" || component === "." || component === "..")
  ) {
    failRelease("PLAN_PATH_INVALID", `invalid plan path: ${path}`);
  }
}

function encodeFileState(state, path) {
  if (state === undefined) {
    return { present: false };
  }
  if (!allowedFileModes.has(state.mode) || !Buffer.isBuffer(state.bytes)) {
    failRelease("PLAN_FILE_STATE_INVALID", `invalid file state for ${path}`);
  }
  return {
    bytesBase64: state.bytes.toString("base64"),
    mode: state.mode,
    present: true,
    sha256: sha256(state.bytes),
  };
}

function decodeFileState(state, path) {
  if (state?.present === false && Object.keys(state).length === 1) {
    return undefined;
  }
  if (
    state?.present !== true ||
    !allowedFileModes.has(state.mode) ||
    typeof state.bytesBase64 !== "string" ||
    !lowercaseSha256Pattern.test(state.sha256)
  ) {
    failRelease("PLAN_FILE_STATE_INVALID", `invalid encoded file state for ${path}`);
  }
  const bytes = Buffer.from(state.bytesBase64, "base64");
  if (bytes.toString("base64") !== state.bytesBase64 || sha256(bytes) !== state.sha256) {
    failRelease("PLAN_FILE_HASH_MISMATCH", `encoded bytes do not match the hash for ${path}`);
  }
  return { bytes, mode: state.mode };
}

function normalizePlanFiles(files) {
  const seen = new Set();
  const normalized = [];
  for (const file of files) {
    validatePlanPath(file.path);
    if (seen.has(file.path)) {
      failRelease("PLAN_PATH_DUPLICATE", `plan repeats ${file.path}`);
    }
    seen.add(file.path);
    if (file.before === undefined && file.after === undefined) {
      failRelease("PLAN_EMPTY_CHANGE", `${file.path} has neither before nor after state`);
    }
    const before = encodeFileState(file.before, file.path);
    const after = encodeFileState(file.after, file.path);
    if (canonicalJsonBytes(before).equals(canonicalJsonBytes(after))) {
      failRelease("PLAN_NOOP_CHANGE", `${file.path} has identical before and after state`);
    }
    normalized.push({ after, before, path: file.path });
  }
  return normalized.sort((left, right) => compareCanonicalStrings(left.path, right.path));
}

function decodedChanges(planFiles) {
  return planFiles.map((file) => ({
    after: decodeFileState(file.after, file.path),
    before: decodeFileState(file.before, file.path),
    path: file.path,
  }));
}

function assertObjectId(value, field) {
  if (!lowercaseObjectIdPattern.test(value)) {
    failRelease("PLAN_OBJECT_ID_INVALID", `${field} must be a lowercase 40-hex object ID`);
  }
}

function assertPlanShape(plan) {
  validateReleasePlanMetadata(plan);
  if (!Array.isArray(plan.files) || plan.files.length === 0) {
    failRelease("PLAN_FILES_INVALID", "release plan must contain at least one change");
  }
  const normalized = normalizePlanFiles(decodedChanges(plan.files));
  if (!canonicalJsonBytes(normalized).equals(canonicalJsonBytes(plan.files))) {
    failRelease("PLAN_FILES_NONCANONICAL", "release plan files are not canonically ordered");
  }
  for (const input of plan.inputs) {
    validatePlanPath(input.path);
    if (!lowercaseSha256Pattern.test(input.sha256)) {
      failRelease("PLAN_INPUT_HASH_INVALID", `${input.path} has an invalid input hash`);
    }
  }
  return plan;
}

function assertSourceStates(repositoryRoot, sourceCommit, changes) {
  const sourceEntries = readFlatGitTree(repositoryRoot, sourceCommit);
  for (const change of changes) {
    const sourceEntry = sourceEntries.get(change.path);
    if (change.before === undefined) {
      if (sourceEntry !== undefined) {
        failRelease(
          "PLAN_BEFORE_PRESENCE_MISMATCH",
          `${change.path} unexpectedly exists in source`,
        );
      }
      continue;
    }
    if (
      sourceEntry?.type !== "blob" ||
      sourceEntry.mode !== change.before.mode ||
      git(repositoryRoot, ["show", `${sourceCommit}:${change.path}`], null).compare(
        change.before.bytes,
      ) !== 0
    ) {
      failRelease("PLAN_BEFORE_MISMATCH", `${change.path} before state does not match source`);
    }
  }
}

export function createReleasePlan(options) {
  const files = normalizePlanFiles(options.files);
  assertObjectId(options.sourceCommit, "source.commit");
  assertObjectId(options.sourceTree, "source.tree");
  const changes = decodedChanges(files);
  const actualSourceTree = commitTreeId(options.repositoryRoot, options.sourceCommit);
  if (actualSourceTree !== options.sourceTree) {
    failRelease("PLAN_SOURCE_TREE_MISMATCH", "declared source tree does not match source commit");
  }
  assertSourceStates(options.repositoryRoot, options.sourceCommit, changes);
  const prospectiveTree = prospectiveTreeId(options.repositoryRoot, options.sourceCommit, changes);
  const plan = {
    commands: options.commands,
    files,
    graphs: options.graphs,
    inputs: options.inputs,
    prospectiveTree,
    repository: options.repository,
    schema: releasePlanSchema,
    semantic: options.semantic,
    source: { commit: options.sourceCommit, tree: options.sourceTree },
    targets: options.targets,
    tools: options.tools,
  };
  assertPlanShape(plan);
  const bytes = canonicalJsonBytes(plan);
  return { bytes, plan, sha256: sha256(bytes) };
}

export function loadReleasePlan(planPath, expectedSha256) {
  if (!lowercaseSha256Pattern.test(expectedSha256)) {
    failRelease("PLAN_HASH_INVALID", "plan SHA-256 must be 64 lowercase hex characters");
  }
  let stats;
  try {
    stats = lstatSync(planPath);
  } catch (error) {
    failRelease("PLAN_FILE_INVALID", "release plan cannot be inspected", { cause: error });
  }
  if (!stats.isFile() || stats.size > maximumPlanBytes) {
    failRelease("PLAN_FILE_INVALID", "release plan must be a bounded regular file");
  }
  const bytes = readFileSync(planPath);
  if (bytes.length !== stats.size || bytes.length > maximumPlanBytes) {
    failRelease("PLAN_FILE_INVALID", "release plan changed while it was being read");
  }
  if (sha256(bytes) !== expectedSha256) {
    failRelease("PLAN_HASH_MISMATCH", "release plan bytes do not match the supplied SHA-256");
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    failRelease("PLAN_JSON_INVALID", "release plan is not valid JSON", { cause: error });
  }
  assertPlanShape(plan);
  if (!bytes.equals(canonicalJsonBytes(plan))) {
    failRelease("PLAN_BYTES_NONCANONICAL", "release plan is not canonical JSON bytes");
  }
  return plan;
}

function repositoryRelativePath(repositoryRoot, path) {
  const absoluteRoot = resolve(repositoryRoot);
  const absolutePath = resolve(absoluteRoot, path);
  const relativePath = relative(absoluteRoot, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(absoluteRoot, relativePath) !== absolutePath
  ) {
    failRelease("PLAN_PATH_ESCAPE", `${path} escapes the repository`);
  }
  let ancestor = dirname(absolutePath);
  while (ancestor !== absoluteRoot) {
    if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) {
      failRelease("PLAN_PATH_SYMLINK_ANCESTOR", `${path} traverses a symbolic link`);
    }
    ancestor = dirname(ancestor);
  }
  return absolutePath;
}

function currentFileState(repositoryRoot, path) {
  const absolutePath = repositoryRelativePath(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  const stats = lstatSync(absolutePath);
  if (!stats.isFile()) {
    failRelease("PLAN_FILE_TYPE_MISMATCH", `${path} is not a regular file`);
  }
  return {
    bytes: readFileSync(absolutePath),
    mode: (stats.mode & 0o111) === 0 ? "100644" : "100755",
  };
}

function sameFileState(left, right) {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.mode === right.mode && left.bytes.equals(right.bytes);
}

function assertCanonicalRepository(repositoryRoot) {
  const remote = git(repositoryRoot, ["remote", "get-url", "origin"]).trim();
  const normalized = remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (normalized !== `https://github.com/${canonicalRepository}`) {
    failRelease("REPOSITORY_REMOTE_MISMATCH", "origin is not the canonical repository");
  }
}

export function assertApplyAdmission(repositoryRoot, plan) {
  assertCanonicalRepository(repositoryRoot);
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  if (head !== plan.source.commit || commitTreeId(repositoryRoot, head) !== plan.source.tree) {
    failRelease("PLAN_SOURCE_DRIFT", "HEAD no longer matches plan source S");
  }
  if (git(repositoryRoot, ["status", "--porcelain=v2", "-z"], null).length !== 0) {
    failRelease("PLAN_WORKTREE_DIRTY", "apply requires a completely clean repository");
  }
  for (const change of decodedChanges(plan.files)) {
    if (!sameFileState(currentFileState(repositoryRoot, change.path), change.before)) {
      failRelease("PLAN_BEFORE_MISMATCH", `${change.path} does not match plan before bytes`);
    }
  }
}

function writeState(repositoryRoot, path, state) {
  const absolutePath = repositoryRelativePath(repositoryRoot, path);
  if (state === undefined) {
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
    return;
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.release-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, state.bytes, {
      flag: "wx",
      mode: state.mode === "100755" ? 0o755 : 0o644,
    });
    chmodSync(temporaryPath, state.mode === "100755" ? 0o755 : 0o644);
    renameSync(temporaryPath, absolutePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function applyReleasePlan(repositoryRoot, plan, options = {}) {
  assertPlanShape(plan);
  assertApplyAdmission(repositoryRoot, plan);
  const changes = decodedChanges(plan.files);
  try {
    for (const change of changes) {
      writeState(repositoryRoot, change.path, change.after);
      options.afterWrite?.(change.path);
    }
  } catch (error) {
    try {
      for (const change of [...changes].reverse()) {
        writeState(repositoryRoot, change.path, change.before);
      }
    } catch (rollbackError) {
      failRelease(
        "PLAN_ROLLBACK_FAILED",
        "release plan failed and its ordinary rollback also failed",
        { cause: rollbackError },
      );
    }
    const releaseError = asReleaseControlError(error, "PLAN_APPLY_FAILED");
    failRelease("PLAN_APPLY_FAILED", releaseError.message, { cause: error });
  }
  return { changedPaths: changes.map(({ path }) => path), tree: plan.prospectiveTree };
}

function splitNull(value) {
  return value.toString("utf8").split("\0").filter(Boolean).sort();
}

export function verifyAppliedPlan(repositoryRoot, plan) {
  assertPlanShape(plan);
  assertCanonicalRepository(repositoryRoot);
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  if (head !== plan.source.commit || commitTreeId(repositoryRoot, head) !== plan.source.tree) {
    failRelease("PLAN_SOURCE_DRIFT", "post-apply HEAD does not equal S");
  }
  if (git(repositoryRoot, ["diff", "--cached", "--name-only", "-z"], null).length !== 0) {
    failRelease("PLAN_INDEX_DIRTY", "post-apply verification requires an unchanged index");
  }
  if (
    git(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"], null).length !== 0
  ) {
    failRelease("PLAN_UNTRACKED_FILES", "post-apply verification rejects untracked files");
  }
  const changes = decodedChanges(plan.files);
  for (const change of changes) {
    if (!sameFileState(currentFileState(repositoryRoot, change.path), change.after)) {
      failRelease("PLAN_AFTER_MISMATCH", `${change.path} does not match plan after bytes`);
    }
  }
  const actualChangedPaths = splitNull(
    git(repositoryRoot, ["diff", "--name-only", "-z", plan.source.commit], null),
  );
  const expectedChangedPaths = changes.map(({ path }) => path).sort();
  if (actualChangedPaths.join("\0") !== expectedChangedPaths.join("\0")) {
    failRelease("PLAN_CHANGED_PATH_MISMATCH", "post-apply tracked paths differ from the plan");
  }
  const tree = prospectiveTreeId(repositoryRoot, plan.source.commit, changes);
  if (tree !== plan.prospectiveTree) {
    failRelease("PLAN_PROSPECTIVE_TREE_MISMATCH", "post-apply tree does not equal A");
  }
  return { changedPaths: expectedChangedPaths, tree };
}

function commitFileState(repositoryRoot, commit, path) {
  const entry = readFlatGitTree(repositoryRoot, commit).get(path);
  if (entry === undefined) {
    return undefined;
  }
  if (entry.type !== "blob" || !allowedFileModes.has(entry.mode)) {
    failRelease("RELEASE_FILE_TYPE_INVALID", `${path} is not a regular release file`);
  }
  return { bytes: git(repositoryRoot, ["show", `${commit}:${path}`], null), mode: entry.mode };
}

export function verifyPostMergeIdentity(repositoryRoot, releaseCommit, plan) {
  assertPlanShape(plan);
  assertObjectId(releaseCommit, "releaseCommit");
  const parentLine = git(repositoryRoot, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    releaseCommit,
  ]).trim();
  const identities = parentLine.split(" ");
  if (
    identities.length !== 2 ||
    identities[0] !== releaseCommit ||
    identities[1] !== plan.source.commit
  ) {
    failRelease("RELEASE_PARENT_MISMATCH", "R must be a single-parent commit whose parent is S");
  }
  if (commitTreeId(repositoryRoot, releaseCommit) !== plan.prospectiveTree) {
    failRelease("RELEASE_TREE_MISMATCH", "tree(R) does not equal prospective tree A");
  }
  const changes = decodedChanges(plan.files);
  for (const change of changes) {
    if (
      !sameFileState(
        commitFileState(repositoryRoot, plan.source.commit, change.path),
        change.before,
      )
    ) {
      failRelease("RELEASE_BEFORE_MISMATCH", `${change.path} differs from plan before bytes`);
    }
    if (!sameFileState(commitFileState(repositoryRoot, releaseCommit, change.path), change.after)) {
      failRelease("RELEASE_AFTER_MISMATCH", `${change.path} differs from plan after bytes`);
    }
  }
  const actualPaths = splitNull(
    git(repositoryRoot, ["diff", "--name-only", "-z", plan.source.commit, releaseCommit], null),
  );
  const expectedPaths = changes.map(({ path }) => path).sort();
  if (actualPaths.join("\0") !== expectedPaths.join("\0")) {
    failRelease("RELEASE_PATH_MISMATCH", "R changes paths outside the plan");
  }
  return { releaseCommit, sourceCommit: plan.source.commit, tree: plan.prospectiveTree };
}
