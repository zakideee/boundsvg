#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { verifySteadyRepository } from "./release-runtime/coherence.mjs";
import { releaseWorkCommandTimeoutMs } from "./release-runtime/command-limits.mjs";
import { asReleaseControlError } from "./release-runtime/errors.mjs";
import { verifyRepositoryDelta } from "./release-runtime/git-files.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArguments(arguments_) {
  if (arguments_.length === 0) {
    return {};
  }
  if (arguments_.length === 2 && arguments_[0] === "--base" && arguments_[1] !== "") {
    return { base: arguments_[1] };
  }
  process.stderr.write("usage: check-release-coherence.mjs [--base <revision>]\n");
  process.exit(2);
}

function runLockedCargoCheck() {
  const result = spawnSync("cargo", ["check", "--workspace", "--locked"], {
    cwd: repositoryRoot,
    stdio: "inherit",
    timeout: releaseWorkCommandTimeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  const { base } = parseArguments(process.argv.slice(2));
  const steadyReport = verifySteadyRepository(repositoryRoot);
  const phaseReport =
    base === undefined ? steadyReport : verifyRepositoryDelta(repositoryRoot, base);
  if (phaseReport.phase === "materialized") {
    runLockedCargoCheck();
  }
  process.stdout.write(
    `release coherence: ${steadyReport.npm.packages.length} npm packages and ${steadyReport.cargo.crates.length} Rust crates passed (${phaseReport.phase})\n`,
  );
} catch (error) {
  const releaseError = asReleaseControlError(error, "RELEASE_COHERENCE_FAILED");
  process.stderr.write(`release coherence [${releaseError.code}]: ${releaseError.message}\n`);
  process.exit(releaseError.exitCode);
}
