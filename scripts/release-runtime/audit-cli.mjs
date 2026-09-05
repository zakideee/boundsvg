#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { auditRelease, parseAuditArguments } from "./audit.mjs";
import { asReleaseControlError } from "./errors.mjs";

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

try {
  const parsed = parseAuditArguments(process.argv.slice(2));
  const result = await auditRelease(repositoryRoot, parsed);
  process.stdout.write(`${JSON.stringify({ ...result.summary, status: "ok" })}\n`);
} catch (error) {
  const releaseError = asReleaseControlError(error, "RELEASE_AUDIT_FAILED");
  process.stderr.write(`release audit [${releaseError.code}]: ${releaseError.message}\n`);
  process.exit(releaseError.code.startsWith("ARGUMENT_") ? 2 : releaseError.exitCode);
}
