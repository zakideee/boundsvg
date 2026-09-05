#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { asReleaseControlError } from "./release-runtime/errors.mjs";
import { createReleaseTags, parseTagArguments } from "./release-runtime/tag.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const parsed = parseTagArguments(process.argv.slice(2));
  const result = await createReleaseTags(repositoryRoot, parsed.releaseCommit);
  process.stdout.write(`${JSON.stringify({ ...result, status: "ok" })}\n`);
} catch (error) {
  const releaseError = asReleaseControlError(error, "RELEASE_TAG_FAILED");
  process.stderr.write(`release tag [${releaseError.code}]: ${releaseError.message}\n`);
  process.exit(releaseError.code.startsWith("ARGUMENT_") ? 2 : releaseError.exitCode);
}
