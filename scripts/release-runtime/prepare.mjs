import { execFileSync } from "node:child_process";

import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { failRelease } from "./errors.mjs";
import {
  applyReleasePlan,
  assertApplyAdmission,
  loadReleasePlan,
  verifyAppliedPlan,
  verifyPostMergeIdentity,
} from "./plan.mjs";
import { verifyPlanSemanticDelta } from "./plan-semantic.mjs";
import { previewRelease } from "./preview.mjs";

const commitPattern = /^[a-f0-9]{40}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const stableVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const crateNamePattern = /^[a-z][a-z0-9_-]*$/;

function parseOptionPairs(arguments_, repeatable = new Set()) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      typeof name !== "string" ||
      !name.startsWith("--") ||
      typeof value !== "string" ||
      value === "" ||
      value.startsWith("--")
    ) {
      failRelease("ARGUMENT_SYNTAX_INVALID", "options must be explicit --name value pairs");
    }
    if (values.has(name) && !repeatable.has(name)) {
      failRelease("ARGUMENT_DUPLICATE", `${name} may be supplied only once`);
    }
    const current = values.get(name) ?? [];
    current.push(value);
    values.set(name, current);
  }
  return values;
}

function requireExactOptions(values, required) {
  const actual = [...values.keys()].sort();
  const expected = [...required].sort();
  if (actual.join("\0") !== expected.join("\0")) {
    failRelease(
      "ARGUMENT_OPTIONS_INVALID",
      `expected exactly ${expected.join(", ")}; received ${actual.join(", ") || "none"}`,
    );
  }
}

function one(values, name) {
  const entries = values.get(name);
  if (entries?.length !== 1) {
    failRelease("ARGUMENT_REQUIRED", `${name} is required exactly once`);
  }
  return entries[0];
}

function validateTarget(value, optionName) {
  if (value !== "current" && !stableVersionPattern.test(value)) {
    failRelease("ARGUMENT_VERSION_INVALID", `${optionName} must be current or a stable version`);
  }
}

function parsePreview(arguments_) {
  const values = parseOptionPairs(arguments_, new Set(["--crate-version"]));
  requireExactOptions(values, ["--crate-version", "--npm-version", "--output", "--source"]);
  const source = one(values, "--source");
  const npmVersion = one(values, "--npm-version");
  const output = one(values, "--output");
  if (!commitPattern.test(source)) {
    failRelease("ARGUMENT_COMMIT_INVALID", "--source must be exactly 40 lowercase hex characters");
  }
  validateTarget(npmVersion, "--npm-version");
  const crateVersions = new Map();
  for (const assignment of values.get("--crate-version")) {
    const match = /^([^=]+)=(.+)$/.exec(assignment);
    if (match === null || !crateNamePattern.test(match[1]) || crateVersions.has(match[1])) {
      failRelease(
        "ARGUMENT_CRATE_TARGET_INVALID",
        `invalid or duplicate crate target: ${assignment}`,
      );
    }
    validateTarget(match[2], `--crate-version ${match[1]}`);
    crateVersions.set(match[1], match[2]);
  }
  return { command: "preview", crateVersions, npmVersion, output, source };
}

function parsePlanCommand(command, arguments_) {
  const values = parseOptionPairs(arguments_);
  requireExactOptions(values, ["--plan", "--plan-sha256"]);
  const planSha256 = one(values, "--plan-sha256");
  if (!sha256Pattern.test(planSha256)) {
    failRelease("ARGUMENT_PLAN_HASH_INVALID", "--plan-sha256 must be 64 lowercase hex characters");
  }
  return { command, plan: one(values, "--plan"), planSha256 };
}

function parsePostMerge(arguments_) {
  const values = parseOptionPairs(arguments_);
  requireExactOptions(values, ["--commit", "--plan", "--plan-sha256"]);
  const commit = one(values, "--commit");
  const planSha256 = one(values, "--plan-sha256");
  if (!commitPattern.test(commit)) {
    failRelease("ARGUMENT_COMMIT_INVALID", "--commit must be exactly 40 lowercase hex characters");
  }
  if (!sha256Pattern.test(planSha256)) {
    failRelease("ARGUMENT_PLAN_HASH_INVALID", "--plan-sha256 must be 64 lowercase hex characters");
  }
  return {
    command: "post-merge",
    commit,
    plan: one(values, "--plan"),
    planSha256,
  };
}

export function parsePrepareArguments(arguments_) {
  const [command, ...commandArguments] = arguments_;
  if (command === "preview") {
    return parsePreview(commandArguments);
  }
  if (command === "apply" || command === "verify") {
    return parsePlanCommand(command, commandArguments);
  }
  if (command === "post-merge") {
    return parsePostMerge(commandArguments);
  }
  failRelease(
    "ARGUMENT_COMMAND_INVALID",
    "first argument must be preview, apply, verify, or post-merge",
    { exitCode: 2 },
  );
}

function assertTrustedSourceCheckout(repositoryRoot, plan) {
  // The structural verifier below reads R only as a Git object. This check
  // keeps every executable module loaded from the retained S checkout.
  let head;
  let status;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    }).trim();
    status = execFileSync("git", ["status", "--porcelain=v2", "-z"], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease("POST_MERGE_TRUSTED_SOURCE_READ_FAILED", "cannot inspect trusted S checkout", {
      cause: error,
    });
  }
  if (head !== plan.source.commit || status.length !== 0) {
    failRelease("POST_MERGE_TRUSTED_SOURCE_MISMATCH", "trusted verifier checkout does not equal S");
  }
  return repositoryRoot;
}

export async function executePrepareCommand(repositoryRoot, parsed, options = {}) {
  if (parsed.command === "preview") {
    return previewRelease(repositoryRoot, parsed, options);
  }
  const plan = loadReleasePlan(parsed.plan, parsed.planSha256);
  if (parsed.command === "apply") {
    assertApplyAdmission(repositoryRoot, plan);
    verifyPlanSemanticDelta(repositoryRoot, plan);
    return applyReleasePlan(repositoryRoot, plan);
  }
  if (parsed.command === "verify") {
    verifyAppliedPlan(repositoryRoot, plan);
    verifyPlanSemanticDelta(repositoryRoot, plan);
    return verifyAppliedPlan(repositoryRoot, plan);
  }
  assertTrustedSourceCheckout(repositoryRoot, plan);
  verifyPlanSemanticDelta(repositoryRoot, plan);
  return verifyPostMergeIdentity(repositoryRoot, parsed.commit, plan);
}
