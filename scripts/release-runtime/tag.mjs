import { execFileSync } from "node:child_process";

import { auditRelease } from "./audit.mjs";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { failRelease } from "./errors.mjs";

const commitPattern = /^[a-f0-9]{40}$/;

export function parseTagArguments(commandArguments) {
  if (
    commandArguments.length !== 2 ||
    commandArguments[0] !== "--release-commit" ||
    !commitPattern.test(commandArguments[1] ?? "")
  ) {
    failRelease(
      "ARGUMENT_TAG_OPTIONS_INVALID",
      "tag requires exactly --release-commit followed by 40 lowercase hex",
      { exitCode: 2 },
    );
  }
  return { releaseCommit: commandArguments[1] };
}

function git(repositoryRoot, commandArguments, options = {}) {
  try {
    return (options.execute ?? execFileSync)("git", commandArguments, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease(options.errorCode ?? "TAG_GIT_FAILED", `git ${commandArguments[0]} failed`, {
      cause: error,
    });
  }
}

function resolveTagObject(repositoryRoot, tagName, execute) {
  try {
    const object = (execute ?? execFileSync)(
      "git",
      ["show-ref", "--verify", "--hash", `refs/tags/${tagName}`],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: releaseReadCommandTimeoutMs,
        killSignal: "SIGKILL",
      },
    ).trim();
    if (!commitPattern.test(object)) {
      failRelease("TAG_COLLISION", `${tagName} has an invalid object identity`);
    }
    return object;
  } catch (error) {
    if (error?.status === 1 || error?.status === 128) {
      return undefined;
    }
    if (error?.code === "TAG_COLLISION") {
      throw error;
    }
    failRelease("TAG_GIT_FAILED", `cannot resolve ${tagName}`, { cause: error });
  }
}

function validateExistingTag(repositoryRoot, tagName, options) {
  const object = resolveTagObject(repositoryRoot, tagName, options.execute);
  if (object === undefined) {
    return false;
  }
  const type = git(repositoryRoot, ["cat-file", "-t", `refs/tags/${tagName}`], {
    execute: options.execute,
  }).trim();
  const peeled = git(repositoryRoot, ["rev-parse", `refs/tags/${tagName}^{}`], {
    execute: options.execute,
  }).trim();
  const contents = git(repositoryRoot, ["cat-file", "-p", `refs/tags/${tagName}`], {
    execute: options.execute,
  });
  const separator = contents.indexOf("\n\n");
  const headers = separator < 0 ? "" : contents.slice(0, separator);
  const annotation = separator < 0 ? "" : contents.slice(separator + 2);
  if (
    type !== "tag" ||
    peeled !== options.releaseCommit ||
    !headers.includes(`object ${options.releaseCommit}\n`) ||
    !headers.includes("type commit\n") ||
    !headers.includes(`tag ${tagName}\n`) ||
    annotation !== `${tagName}\n`
  ) {
    failRelease("TAG_COLLISION", `${tagName} is not the exact annotated tag for R`);
  }
  return true;
}

function tagNamesFromAudit(audit) {
  if (audit.delta.npm.advanced !== true) {
    return [];
  }
  const version = audit.state.npm.currentVersion;
  return audit.state.npm.publishOrder.map((packageName) => `${packageName}@${version}`);
}

export async function createReleaseTags(repositoryRoot, releaseCommit, options = {}) {
  const audit = await (options.audit ?? auditRelease)(
    repositoryRoot,
    { phase: "pre-tag", releaseCommit, report: undefined },
    options.auditOptions,
  );
  const tagNames = tagNamesFromAudit(audit);
  if (new Set(tagNames).size !== tagNames.length) {
    failRelease("TAG_SET_INVALID", "release package names produce duplicate tags");
  }
  const existing = [];
  const missing = [];
  for (const tagName of tagNames) {
    git(repositoryRoot, ["check-ref-format", `refs/tags/${tagName}`], { execute: options.execute });
    if (
      validateExistingTag(repositoryRoot, tagName, {
        execute: options.execute,
        releaseCommit,
      })
    ) {
      existing.push(tagName);
    } else {
      missing.push(tagName);
    }
  }

  const created = [];
  try {
    for (const tagName of missing) {
      git(
        repositoryRoot,
        ["tag", "--annotate", "--no-sign", "--message", tagName, tagName, releaseCommit],
        {
          errorCode: "TAG_CREATE_FAILED",
          execute: options.execute,
        },
      );
      created.push(tagName);
      validateExistingTag(repositoryRoot, tagName, {
        execute: options.execute,
        releaseCommit,
      });
    }
  } catch (error) {
    for (const tagName of [...created].reverse()) {
      git(repositoryRoot, ["tag", "--delete", tagName], {
        errorCode: "TAG_ROLLBACK_FAILED",
        execute: options.execute,
      });
    }
    throw error;
  }
  return { created, existing, releaseCommit };
}
