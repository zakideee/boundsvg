import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { failRelease } from "./errors.mjs";

function git(repositoryRoot, arguments_, encoding) {
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
    failRelease("GIT_TREE_READ_FAILED", `git ${arguments_.join(" ")} failed`, { cause: error });
  }
}

function gitObjectId(type, bytes) {
  const header = Buffer.from(`${type} ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

export function readFlatGitTree(repositoryRoot, commit) {
  const output = git(repositoryRoot, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const entries = new Map();
  for (const record of output.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(record);
    if (match === null) {
      failRelease("GIT_TREE_FORMAT_INVALID", "git ls-tree returned an invalid record");
    }
    entries.set(match[4], { mode: match[1], objectId: match[3], type: match[2] });
  }
  return entries;
}

function insertTreeEntry(root, path, entry) {
  const components = path.split("/");
  let directory = root;
  for (const component of components.slice(0, -1)) {
    const current = directory.get(component);
    if (current?.kind === "leaf") {
      failRelease("GIT_TREE_PATH_CONFLICT", `${path} conflicts with a file ancestor`);
    }
    if (current === undefined) {
      const children = new Map();
      directory.set(component, { children, kind: "directory" });
      directory = children;
    } else {
      directory = current.children;
    }
  }
  const name = components.at(-1);
  if (directory.has(name)) {
    failRelease("GIT_TREE_PATH_CONFLICT", `${path} has a duplicate tree entry`);
  }
  directory.set(name, { ...entry, kind: "leaf" });
}

function compareTreeNames(left, right) {
  const leftSortName = `${left.name}${left.value.kind === "directory" ? "/" : ""}`;
  const rightSortName = `${right.name}${right.value.kind === "directory" ? "/" : ""}`;
  return Buffer.compare(Buffer.from(leftSortName), Buffer.from(rightSortName));
}

function hashTreeDirectory(directory) {
  const chunks = [];
  const entries = [...directory].map(([name, value]) => ({ name, value })).sort(compareTreeNames);
  for (const { name, value } of entries) {
    const mode = value.kind === "directory" ? "40000" : value.mode;
    const objectId =
      value.kind === "directory" ? hashTreeDirectory(value.children) : value.objectId;
    chunks.push(Buffer.from(`${mode} ${name}\0`, "utf8"), Buffer.from(objectId, "hex"));
  }
  return gitObjectId("tree", Buffer.concat(chunks));
}

function hashFlatGitTree(entries) {
  const root = new Map();
  for (const [path, entry] of entries) {
    insertTreeEntry(root, path, entry);
  }
  return hashTreeDirectory(root);
}

export function prospectiveTreeId(repositoryRoot, sourceCommit, changes) {
  const entries = readFlatGitTree(repositoryRoot, sourceCommit);
  for (const change of changes) {
    if (change.after === undefined) {
      entries.delete(change.path);
      continue;
    }
    entries.set(change.path, {
      mode: change.after.mode,
      objectId: gitObjectId("blob", change.after.bytes),
      type: "blob",
    });
  }
  return hashFlatGitTree(entries);
}

export function commitTreeId(repositoryRoot, commit) {
  return git(repositoryRoot, ["show", "-s", "--format=%T", commit], "utf8").trim();
}
