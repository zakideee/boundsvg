import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { releaseReadCommandTimeoutMs, releaseWorkCommandTimeoutMs } from "./command-limits.mjs";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(runtimeDirectory));
const subprocessDeadlineCounts = new Map([
  ["scripts/check-release-coherence.mjs", 1],
  ["scripts/release-runtime/artifacts.mjs", 1],
  ["scripts/release-runtime/audit.mjs", 1],
  ["scripts/release-runtime/git-files.mjs", 1],
  ["scripts/release-runtime/git-tree.mjs", 1],
  ["scripts/release-runtime/plan-semantic.mjs", 1],
  ["scripts/release-runtime/plan.mjs", 1],
  ["scripts/release-runtime/prepare.mjs", 2],
  ["scripts/release-runtime/preview.mjs", 3],
  ["scripts/release-runtime/repository.mjs", 1],
  ["scripts/release-runtime/seal.mjs", 1],
  ["scripts/release-runtime/settings.mjs", 2],
  ["scripts/release-runtime/tag.mjs", 2],
  ["scripts/release-runtime/workflow-core.mjs", 2],
]);

test("release subprocesses have explicit hard deadlines below the shortest job bound", () => {
  assert.ok(releaseReadCommandTimeoutMs > 0);
  assert.ok(releaseReadCommandTimeoutMs < releaseWorkCommandTimeoutMs);
  assert.ok(releaseWorkCommandTimeoutMs < 30 * 60 * 1_000);
  for (const [path, expectedCount] of subprocessDeadlineCounts) {
    const source = readFileSync(join(repositoryRoot, path), "utf8");
    assert.equal((source.match(/\btimeout:/g) ?? []).length, expectedCount, path);
    assert.equal((source.match(/\bkillSignal: "SIGKILL"/g) ?? []).length, expectedCount, path);
  }
});
