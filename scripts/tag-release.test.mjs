import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReleaseTags, parseTagArguments } from "./release-runtime/tag.mjs";

const releaseCommitPattern = /^[a-f0-9]{40}$/;

function git(repositoryRoot, commandArguments) {
  return execFileSync("git", commandArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function repositoryFixture() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "boundsvg-tag-test-"));
  git(repositoryRoot, ["init", "--quiet"]);
  git(repositoryRoot, ["config", "user.name", "Release Test"]);
  git(repositoryRoot, ["config", "user.email", "release-test@example.invalid"]);
  git(repositoryRoot, ["commit", "--allow-empty", "--quiet", "-m", "source"]);
  const parentCommit = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  git(repositoryRoot, ["commit", "--allow-empty", "--quiet", "-m", "release"]);
  const releaseCommit = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  assert.match(parentCommit, releaseCommitPattern);
  assert.match(releaseCommit, releaseCommitPattern);
  return { parentCommit, releaseCommit, repositoryRoot };
}

function auditResult(packageNames, npmAdvanced = true) {
  return {
    delta: { npm: { advanced: npmAdvanced } },
    state: {
      npm: {
        currentVersion: "2.8.0",
        publishOrder: packageNames,
      },
    },
  };
}

test("tag arguments accept one exact release commit and reject every alternate frontdoor", () => {
  const releaseCommit = "a".repeat(40);
  assert.deepEqual(parseTagArguments(["--release-commit", releaseCommit]), { releaseCommit });
  for (const commandArguments of [
    [],
    ["--release-commit", "A".repeat(40)],
    ["--release-commit", releaseCommit, "--push", "true"],
    ["--release-commit", releaseCommit, "--release-commit", releaseCommit],
  ]) {
    assert.throws(
      () => parseTagArguments(commandArguments),
      (error) => String(error.code).startsWith("ARGUMENT_"),
    );
  }
});

test("annotated npm tags are dynamic, exact, local-only, and idempotent", async () => {
  const fixture = repositoryFixture();
  const commandLog = [];
  try {
    git(fixture.repositoryRoot, ["config", "tag.gpgSign", "true"]);
    const execute = (command, commandArguments, options) => {
      commandLog.push([command, ...commandArguments]);
      return execFileSync(command, commandArguments, options);
    };
    const options = {
      audit: async () => auditResult(["@example/kernel", "@example/renderer"]),
      execute,
    };
    const first = await createReleaseTags(fixture.repositoryRoot, fixture.releaseCommit, options);
    assert.deepEqual(first.created, ["@example/kernel@2.8.0", "@example/renderer@2.8.0"]);
    const second = await createReleaseTags(fixture.repositoryRoot, fixture.releaseCommit, options);
    assert.deepEqual(second.existing, ["@example/kernel@2.8.0", "@example/renderer@2.8.0"]);
    for (const tagName of first.created) {
      assert.equal(
        git(fixture.repositoryRoot, ["cat-file", "-t", `refs/tags/${tagName}`]).trim(),
        "tag",
      );
      assert.equal(
        git(fixture.repositoryRoot, ["rev-parse", `refs/tags/${tagName}^{}`]).trim(),
        fixture.releaseCommit,
      );
    }
    assert.equal(
      commandLog.some((entry) => entry.includes("push")),
      false,
    );
    assert.equal(
      commandLog
        .filter((entry) => entry[1] === "tag" && entry.includes("--annotate"))
        .every((entry) => entry.includes("--no-sign")),
      true,
    );
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
  }
});

test("tag collisions fail before creation and a partial local failure rolls back only new tags", async () => {
  const collision = repositoryFixture();
  try {
    git(collision.repositoryRoot, ["tag", "@example/kernel@2.8.0", collision.parentCommit]);
    await assert.rejects(
      createReleaseTags(collision.repositoryRoot, collision.releaseCommit, {
        audit: async () => auditResult(["@example/kernel", "@example/renderer"]),
      }),
      { code: "TAG_COLLISION" },
    );
    assert.equal(
      git(collision.repositoryRoot, ["tag", "--list", "@example/renderer@2.8.0"]).trim(),
      "",
    );
  } finally {
    rmSync(collision.repositoryRoot, { force: true, recursive: true });
  }

  const rollback = repositoryFixture();
  const createdTag = "@example/kernel@2.8.0";
  const failedTag = "@example/renderer@2.8.0";
  try {
    const execute = (command, commandArguments, options) => {
      if (commandArguments[0] === "tag" && commandArguments.at(-2) === failedTag) {
        const error = new Error("injected tag failure");
        error.status = 1;
        throw error;
      }
      return execFileSync(command, commandArguments, options);
    };
    await assert.rejects(
      createReleaseTags(rollback.repositoryRoot, rollback.releaseCommit, {
        audit: async () => auditResult(["@example/kernel", "@example/renderer"]),
        execute,
      }),
      { code: "TAG_CREATE_FAILED" },
    );
    assert.equal(git(rollback.repositoryRoot, ["tag", "--list", createdTag]).trim(), "");
    assert.equal(git(rollback.repositoryRoot, ["tag", "--list", failedTag]).trim(), "");
  } finally {
    rmSync(rollback.repositoryRoot, { force: true, recursive: true });
  }
});

test("a Rust-only train creates no npm or crate tags", async () => {
  const fixture = repositoryFixture();
  try {
    const result = await createReleaseTags(fixture.repositoryRoot, fixture.releaseCommit, {
      audit: async () => auditResult(["@example/kernel"], false),
    });
    assert.deepEqual(result, { created: [], existing: [], releaseCommit: fixture.releaseCommit });
    assert.equal(git(fixture.repositoryRoot, ["tag", "--list"]).trim(), "");
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
  }
});

test("tag mutation is never reached when the final pre-tag authority rejects", async () => {
  let executorCalls = 0;
  const error = new Error("final check became pending");
  error.code = "REQUIRED_CHECK_NOT_SUCCESSFUL";
  await assert.rejects(
    createReleaseTags("/unused", "a".repeat(40), {
      audit: async () => {
        throw error;
      },
      execute: () => {
        executorCalls += 1;
      },
    }),
    { code: "REQUIRED_CHECK_NOT_SUCCESSFUL" },
  );
  assert.equal(executorCalls, 0);
});
