#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { asReleaseControlError, failRelease } from "./errors.mjs";
import { parseWorkflowArguments } from "./workflow-arguments.mjs";
import { createAdmissionReport, executeRegistryJob } from "./workflow-core.mjs";

const controllerRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function releaseRepositoryRoot(environment) {
  const suppliedRoot = environment.RELEASE_REPOSITORY_ROOT;
  if (suppliedRoot === undefined) {
    return controllerRoot;
  }
  if (!isAbsolute(suppliedRoot) || resolve(suppliedRoot) !== suppliedRoot) {
    failRelease(
      "RELEASE_REPOSITORY_ROOT_INVALID",
      "RELEASE_REPOSITORY_ROOT must be an absolute normalized path",
    );
  }
  return suppliedRoot;
}

export async function executeWorkflowReleaseCommand(
  arguments_,
  environment,
  operations = { createAdmissionReport, executeRegistryJob },
) {
  const parsed = parseWorkflowArguments(arguments_);
  const repositoryRoot = releaseRepositoryRoot(environment);
  const result =
    parsed.command === "admission"
      ? await operations.createAdmissionReport({
          bundleDirectory: parsed.bundleDirectory,
          environment,
          releaseCommit: parsed.releaseCommit,
          repositoryRoot,
          target: parsed.target,
          trustedRepositoryRoot: controllerRoot,
        })
      : await operations.executeRegistryJob({
          bundleDirectory: parsed.bundleDirectory,
          releaseCommit: parsed.releaseCommit,
          reportSha256: parsed.reportSha256,
          repositoryRoot,
          target: parsed.target,
          trustedRepositoryRoot: controllerRoot,
        });
  if (parsed.command === "admission" && typeof environment.GITHUB_OUTPUT === "string") {
    appendFileSync(
      environment.GITHUB_OUTPUT,
      `target=${parsed.target}\nreport-sha256=${result.reportSha256}\n`,
    );
  }
  return { result, target: parsed.target };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outcome = await executeWorkflowReleaseCommand(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify({ status: "ok", target: outcome.target })}\n`);
  } catch (error) {
    const releaseError = asReleaseControlError(error, "RELEASE_WORKFLOW_FAILED");
    process.stderr.write(`release workflow [${releaseError.code}]: ${releaseError.message}\n`);
    process.exit(releaseError.code.startsWith("ARGUMENT_") ? 2 : releaseError.exitCode);
  }
}
