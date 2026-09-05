import { failRelease } from "./errors.mjs";

const commitPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const commands = new Set(["admission", "crates", "npm"]);

export function parseWorkflowArguments(arguments_) {
  const [command, ...tokens] = arguments_;
  if (!commands.has(command)) {
    failRelease("ARGUMENT_COMMAND_INVALID", "workflow command must be admission, npm, or crates", {
      exitCode: 2,
    });
  }
  if (tokens.length % 2 !== 0) {
    failRelease("ARGUMENT_OPTIONS_INVALID", "workflow options must be name-value pairs", {
      exitCode: 2,
    });
  }
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (
      !["--bundle", "--release-commit", "--report-sha256", "--target"].includes(name) ||
      typeof value !== "string" ||
      value === "" ||
      value.startsWith("--") ||
      values.has(name)
    ) {
      failRelease("ARGUMENT_OPTIONS_INVALID", "workflow options are invalid", { exitCode: 2 });
    }
    values.set(name, value);
  }
  const expected =
    command === "admission"
      ? ["--bundle", "--release-commit", "--target"]
      : ["--bundle", "--release-commit", "--report-sha256"];
  if ([...values.keys()].sort().join("\0") !== expected.sort().join("\0")) {
    failRelease("ARGUMENT_OPTIONS_INVALID", "workflow options are incomplete or unexpected", {
      exitCode: 2,
    });
  }
  const releaseCommit = values.get("--release-commit");
  if (!commitPattern.test(releaseCommit)) {
    failRelease("ARGUMENT_RELEASE_COMMIT_INVALID", "release commit must be 40 lowercase hex", {
      exitCode: 2,
    });
  }
  const target = command === "admission" ? values.get("--target") : command;
  if (!["crates", "npm"].includes(target)) {
    failRelease("ARGUMENT_TARGET_INVALID", "target must be exactly npm or crates", { exitCode: 2 });
  }
  const reportSha256 = values.get("--report-sha256");
  if (command !== "admission" && !digestPattern.test(reportSha256)) {
    failRelease("ARGUMENT_REPORT_HASH_INVALID", "report hash must be 64 lowercase hex", {
      exitCode: 2,
    });
  }
  return {
    bundleDirectory: values.get("--bundle"),
    command,
    releaseCommit,
    reportSha256,
    target,
  };
}
