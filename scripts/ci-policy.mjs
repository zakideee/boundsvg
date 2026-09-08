/** Select CI coverage and reject incomplete job results. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root prose files that cannot execute as part of the docs build. */
const docsPaths = new Set(["README.md", "CONTRIBUTING.md"]);
/** Dependencies whose exact outcomes determine each acceptance check. */
const expectedJobs = {
  ci: {
    always: ["changes", "docs-build", "docs-check"],
    full: ["lint-and-typecheck", "test-ts", "test-rust", "test-e2e"],
  },
  render: { always: ["changes"], full: ["render-regression"] },
};

function runGit(repoRoot, args) {
  const command = spawnSync("git", args, { cwd: repoRoot, encoding: null });
  if (command.error || command.status !== 0) {
    throw new Error(`Git ${args[0]} failed: ${command.error?.message ?? command.stderr}`);
  }
  return command.stdout;
}

function getCommit(repoRoot, revision) {
  return runGit(repoRoot, ["rev-parse", "--verify", `${revision}^{commit}`])
    .toString()
    .trim();
}

function validateSha(sha, label) {
  if (!/^[a-f0-9]{40}$/.test(sha) || /^0+$/.test(sha)) {
    throw new Error(`Missing or invalid ${label}`);
  }
  return sha;
}

/** Parse NUL-delimited raw Git records without interpreting paths as shell text. */
export function parseChanges(rawDiff) {
  const rawText = new TextDecoder("utf-8", { fatal: true }).decode(rawDiff);
  if (rawText === "") {
    return [];
  }
  if (!rawText.endsWith("\0")) {
    throw new Error("Unterminated Git diff record");
  }
  const fields = rawText.slice(0, -1).split("\0");
  if (fields.length % 2 !== 0) {
    throw new Error("Incomplete Git diff record");
  }
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const header = /^:([0-7]{6}) ([0-7]{6}) [a-f0-9]{40} [a-f0-9]{40} ([AMDT])$/.exec(
      fields[index],
    );
    const path = fields[index + 1];
    if (
      !header ||
      !path ||
      path.startsWith("/") ||
      path.split("/").some((part) => part === ".." || part === "." || part === "")
    ) {
      throw new Error("Invalid Git diff record");
    }
    changes.push({ oldMode: header[1], newMode: header[2], status: header[3], path });
  }
  return changes;
}

/** Limit the docs lane to additions or content edits of two regular files. */
export function classifyChanges(changes) {
  const isDocsOnly =
    changes.length > 0 &&
    changes.every(
      (change) =>
        docsPaths.has(change.path) &&
        change.newMode === "100644" &&
        ((change.status === "A" && change.oldMode === "000000") ||
          (change.status === "M" && change.oldMode === "100644")),
    );
  return isDocsOnly ? "docs" : "full";
}

/** Bind classification to exact commits; Git errors never become an empty diff. */
export function collectClassification(repoRoot, env) {
  const event = env.eventName;
  if (!["pull_request", "push", "workflow_dispatch"].includes(event)) {
    throw new Error("Unsupported CI event");
  }
  if (event === "workflow_dispatch" && !["true", "false"].includes(env.workflowFull)) {
    throw new Error("Missing or invalid full input");
  }
  const checkout = getCommit(repoRoot, "HEAD");
  if (env.githubSha && validateSha(env.githubSha, "checkout SHA") !== checkout) {
    throw new Error("Checkout does not match workflow SHA");
  }
  let base;
  let head = checkout;
  if (event === "pull_request") {
    base = validateSha(env.prBaseSha, "PR base SHA");
    head = validateSha(env.prHeadSha, "PR head SHA");
    getCommit(repoRoot, base);
    getCommit(repoRoot, head);
    runGit(repoRoot, ["merge-base", "--is-ancestor", head, checkout]);
    runGit(repoRoot, ["merge-base", "--is-ancestor", base, checkout]);
  } else if (event === "push") {
    // New branch events may not provide a previous commit.
    base =
      env.pushBeforeSha && !/^0+$/.test(env.pushBeforeSha)
        ? getCommit(repoRoot, validateSha(env.pushBeforeSha, "push base SHA"))
        : getCommit(repoRoot, "HEAD^");
  } else {
    const branch = env.defaultBranch || "main";
    runGit(repoRoot, ["check-ref-format", "--branch", branch]);
    base = getCommit(repoRoot, `refs/remotes/origin/${branch}`);
  }
  const mergeBase = getCommit(
    repoRoot,
    runGit(repoRoot, ["merge-base", base, head]).toString().trim(),
  );
  const rawDiff = runGit(repoRoot, [
    "diff",
    "--raw",
    "-z",
    "--no-renames",
    "--abbrev=40",
    mergeBase,
    head,
    "--",
  ]);
  const changes = parseChanges(rawDiff);
  const isForcedFull =
    event === "push" || (event === "workflow_dispatch" && env.workflowFull === "true");
  const mode = isForcedFull ? "full" : classifyChanges(changes);
  return {
    event,
    mode,
    checkout,
    tree: runGit(repoRoot, ["rev-parse", "HEAD^{tree}"]).toString().trim(),
    parents: runGit(repoRoot, ["show", "-s", "--format=%P", checkout]).toString().trim().split(" "),
    base,
    head,
    mergeBase,
    changes,
    changesSha256: createHash("sha256").update(rawDiff).digest("hex"),
  };
}

/** Require every declared job result, including the expected docs-only skips. */
export function validateJobResults(scope, mode, needs) {
  const jobs = Object.hasOwn(expectedJobs, scope) ? expectedJobs[scope] : undefined;
  if (
    !jobs ||
    !["full", "docs"].includes(mode) ||
    !needs ||
    typeof needs !== "object" ||
    Array.isArray(needs)
  ) {
    throw new Error("Invalid acceptance input");
  }
  const expectedNames = [...jobs.always, ...jobs.full].sort();
  if (JSON.stringify(Object.keys(needs).sort()) !== JSON.stringify(expectedNames)) {
    throw new Error("Missing or unexpected dependency jobs");
  }
  for (const name of expectedNames) {
    const expected = jobs.always.includes(name) || mode === "full" ? "success" : "skipped";
    if (needs[name]?.result !== expected) {
      throw new Error(
        `${name}: expected ${expected}, received ${needs[name]?.result ?? "missing"}`,
      );
    }
  }
  if (needs.changes.outputs?.mode !== mode) {
    throw new Error("Classification output does not match acceptance mode");
  }
}

function main() {
  const [command, scope] = process.argv.slice(2);
  if (command === "classify" && scope === undefined) {
    const classification = collectClassification(process.cwd(), {
      eventName: process.env.EVENT_NAME,
      defaultBranch: process.env.DEFAULT_BRANCH,
      workflowFull: process.env.WORKFLOW_FULL,
      prBaseSha: process.env.PR_BASE_SHA,
      prHeadSha: process.env.PR_HEAD_SHA,
      pushBeforeSha: process.env.PUSH_BEFORE_SHA,
      githubSha: process.env.GITHUB_SHA,
    });
    const report = `${JSON.stringify(classification, null, 2)}\n`;
    if (!process.env.GITHUB_OUTPUT || !process.env.CI_CLASSIFICATION_REPORT) {
      throw new Error("Missing classification output destinations");
    }
    mkdirSync(dirname(process.env.CI_CLASSIFICATION_REPORT), { recursive: true });
    writeFileSync(process.env.CI_CLASSIFICATION_REPORT, report);
    const isFull = classification.mode === "full";
    const outputs = {
      mode: classification.mode,
      checkout: classification.checkout,
      tree: classification.tree,
      full: isFull,
      rust: isFull,
      ts: isFull,
      e2e: isFull,
      pack: isFull,
    };
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [["base_ref", classification.base], ...Object.entries(outputs)]
        .map(([key, field]) => `${key}=${field}\n`)
        .join(""),
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `CI mode: ${classification.mode}\n\nCheckout: ${classification.checkout}\n\nTree: ${classification.tree}\n\nChanged paths: ${classification.changes.length}\n\nDiff SHA-256: ${classification.changesSha256}\n`,
      );
    }
    process.stdout.write(report);
  } else if (command === "accept" && scope) {
    validateJobResults(scope, process.env.CI_MODE, JSON.parse(process.env.CI_NEEDS ?? "null"));
    process.stdout.write(`${scope} acceptance passed (${process.env.CI_MODE})\n`);
  } else {
    throw new Error("Usage: node scripts/ci-policy.mjs classify | accept ci | accept render");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
