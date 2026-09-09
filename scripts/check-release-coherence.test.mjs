import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseWorkflow = readFileSync(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");

test("the repository satisfies the release coherence check", () => {
  const result = spawnSync(process.execPath, ["scripts/check-release-coherence.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^release coherence: \d+ npm packages and \d+ Rust crates passed\n$/);
});

test("the release workflow exposes only explicit native publication routes", () => {
  for (const target of [
    "select-target",
    "npm",
    "crate-boundshape",
    "crate-boundtext",
    "crate-boundsvg",
  ]) {
    assert.match(releaseWorkflow, new RegExp(`^\\s+- ${target}$`, "m"));
  }
  for (const requiredCheck of ["CI acceptance", "Baseline Checks"]) {
    assert.match(releaseWorkflow, new RegExp(`^\\s+${requiredCheck}$`, "m"));
  }

  assert.match(releaseWorkflow, /default: select-target/);
  assert.match(releaseWorkflow, /\*\) exit 2/);
  assert.match(releaseWorkflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(releaseWorkflow, /test "\$GITHUB_SHA" = "\$RELEASE_COMMIT"/);
  assert.match(releaseWorkflow, /max_by\(\[\.started_at, \.id\]\)/);
  assert.match(releaseWorkflow, /environment:\n\s+name:.*npm-publish.*crates-publish/);
  assert.match(releaseWorkflow, /pnpm -r publish --no-git-checks/);
  assert.match(releaseWorkflow, /cargo publish --locked --package "\$crate"/);

  const environmentIndex = releaseWorkflow.indexOf("environment:\n      name:");
  const refreshIndex = releaseWorkflow.indexOf("- name: Refresh source and check authority");
  const authenticationIndex = releaseWorkflow.indexOf("- name: Authenticate with crates.io");
  const npmPublishIndex = releaseWorkflow.indexOf("- name: Publish npm packages");
  const cratePublishIndex = releaseWorkflow.indexOf("- name: Publish one Rust crate");
  assert.ok(environmentIndex >= 0);
  assert.ok(refreshIndex > environmentIndex);
  assert.ok(authenticationIndex > refreshIndex);
  assert.ok(npmPublishIndex > refreshIndex);
  assert.ok(cratePublishIndex > authenticationIndex);

  for (const forbidden of [
    "changesets/action",
    "release-runtime",
    "prepare-release",
    "tag-release",
    "contents: write",
    "pull-requests: write",
    "publish-crates:",
    "pull_request:",
    "registry.npmjs.org",
    "api.crates.io",
    "sleep ",
  ]) {
    assert.doesNotMatch(releaseWorkflow, new RegExp(forbidden));
  }

  const actions = [...releaseWorkflow.matchAll(/^\s+(?:- )?uses: ([^@\s]+)@([^\s]+)/gm)];
  assert.ok(actions.length > 0);
  for (const [, action, revision] of actions) {
    assert.match(revision, /^[0-9a-f]{40}$/, action);
  }
});
