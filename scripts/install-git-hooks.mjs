#!/usr/bin/env node
// Installs the repository's git hooks via prek. Skips cleanly when the
// checkout has no .git (tarball, zip download, or `git archive` extraction),
// where hook installation is neither possible nor needed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".git")) {
  process.stdout.write("postinstall: no .git here — skipping git hook installation.\n");
  process.exit(0);
}

const result = spawnSync("prek", ["install", "-t", "pre-commit", "-t", "pre-push"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
