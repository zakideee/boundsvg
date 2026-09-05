#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { asReleaseControlError } from "./release-runtime/errors.mjs";
import { executePrepareCommand, parsePrepareArguments } from "./release-runtime/prepare.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const parsed = parsePrepareArguments(process.argv.slice(2));
  const result = await executePrepareCommand(repositoryRoot, parsed);
  const publicResult = { ...result };
  delete publicResult.output;
  process.stdout.write(`${JSON.stringify(publicResult)}\n`);
} catch (error) {
  const releaseError = asReleaseControlError(error, "RELEASE_PREPARE_FAILED");
  process.stderr.write(`release prepare [${releaseError.code}]: ${releaseError.message}\n`);
  process.exit(releaseError.code.startsWith("ARGUMENT_") ? 2 : releaseError.exitCode);
}
