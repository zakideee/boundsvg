import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertReleaseCheckout,
  auditCrateDryRun,
  classifyTrailingCommits,
  crateIndexArtifactAvailable,
  executeRegistryArtifactSequence,
  expectedNpmPublicationRun,
  runCredentialedCratePublish,
  validateCratePublicationRunIdentity,
  validateRequiredCheckRuns,
  validateRequiredChecks,
} from "./workflow-core.mjs";

const releaseCommit = "a".repeat(40);
const eventCommit = "b".repeat(40);
const mainTip = "c".repeat(40);
const headBranchField = "head_branch";
const headShaField = "head_sha";
const checkRunsField = "check_runs";
const completedAtField = "completed_at";
const totalCountField = "total_count";

function runFixture() {
  return {
    event: "workflow_dispatch",
    [headBranchField]: "main",
    [headShaField]: eventCommit,
    id: 1234,
    path: ".github/workflows/release.yml",
  };
}

function optionsFixture() {
  return {
    isAncestor(ancestor, descendant) {
      return (
        (ancestor === releaseCommit && descendant === eventCommit) ||
        (ancestor === eventCommit && descendant === mainTip)
      );
    },
    mainTip,
    releaseCommit,
    runId: "1234",
  };
}

const requiredCheckNames = ["Baseline Checks", "lint-and-typecheck", "test-rust", "test-ts"];

function successfulCheckRuns() {
  return requiredCheckNames.map((name) => ({
    [completedAtField]: "2026-09-06T00:00:00.000Z",
    conclusion: "success",
    name,
    status: "completed",
  }));
}

test("required checks select one unique latest completed run from the complete set", () => {
  const checkRuns = successfulCheckRuns();
  checkRuns.push({
    [completedAtField]: "2026-09-05T00:00:00.000Z",
    conclusion: "failure",
    name: "test-ts",
    status: "completed",
  });
  assert.deepEqual(
    validateRequiredCheckRuns({
      [checkRunsField]: checkRuns,
      [totalCountField]: checkRuns.length,
    }),
    { checks: requiredCheckNames },
  );

  const laterFailure = successfulCheckRuns();
  laterFailure.push({
    [completedAtField]: "2026-09-07T00:00:00.000Z",
    conclusion: "failure",
    name: "test-ts",
    status: "completed",
  });
  assert.throws(
    () =>
      validateRequiredCheckRuns({
        [checkRunsField]: laterFailure,
        [totalCountField]: laterFailure.length,
      }),
    { code: "REQUIRED_CHECK_NOT_SUCCESSFUL" },
  );
});

test("required checks reject pending, ambiguous, invalid, missing, and incomplete authority", () => {
  for (const status of ["queued", "in_progress"]) {
    const checkRuns = successfulCheckRuns();
    checkRuns.push({ [completedAtField]: null, conclusion: null, name: "test-ts", status });
    assert.throws(
      () =>
        validateRequiredCheckRuns({
          [checkRunsField]: checkRuns,
          [totalCountField]: checkRuns.length,
        }),
      { code: "REQUIRED_CHECK_NOT_SUCCESSFUL" },
    );
  }
  for (const completedAt of [undefined, "not-a-timestamp"]) {
    const checkRuns = successfulCheckRuns();
    checkRuns[0][completedAtField] = completedAt;
    assert.throws(
      () =>
        validateRequiredCheckRuns({
          [checkRunsField]: checkRuns,
          [totalCountField]: checkRuns.length,
        }),
      { code: "REQUIRED_CHECKS_UNKNOWN" },
    );
  }
  const tied = successfulCheckRuns();
  tied.push({ ...tied[0] });
  assert.throws(
    () =>
      validateRequiredCheckRuns({
        [checkRunsField]: tied,
        [totalCountField]: tied.length,
      }),
    { code: "REQUIRED_CHECKS_UNKNOWN" },
  );
  const missing = successfulCheckRuns().slice(1);
  assert.throws(
    () =>
      validateRequiredCheckRuns({
        [checkRunsField]: missing,
        [totalCountField]: missing.length,
      }),
    { code: "REQUIRED_CHECKS_UNKNOWN" },
  );
  assert.throws(
    () =>
      validateRequiredCheckRuns({
        [checkRunsField]: successfulCheckRuns(),
        [totalCountField]: 101,
      }),
    { code: "REQUIRED_CHECKS_UNKNOWN" },
  );
});

test("required-check query explicitly requests all runs", () => {
  let endpoint;
  validateRequiredChecks("/unused", releaseCommit, {
    readGitHubJson(_repositoryRoot, observedEndpoint) {
      endpoint = observedEndpoint;
      const checkRuns = successfulCheckRuns();
      return { [checkRunsField]: checkRuns, [totalCountField]: checkRuns.length };
    },
  });
  assert.equal(
    endpoint,
    `repos/zakideee/boundsvg/commits/${releaseCommit}/check-runs?filter=all&per_page=100`,
  );
});

test("registry artifact sequence stops executors after any failed refresh", async () => {
  const artifacts = [{ name: "first" }, { name: "second" }];
  let publishCount = 0;
  await assert.rejects(
    executeRegistryArtifactSequence({
      localArtifacts: artifacts,
      publish: async () => {
        publishCount += 1;
      },
      refresh: async () => {
        const error = new Error("pending check");
        error.code = "REQUIRED_CHECK_NOT_SUCCESSFUL";
        throw error;
      },
    }),
    { code: "REQUIRED_CHECK_NOT_SUCCESSFUL" },
  );
  assert.equal(publishCount, 0);

  let refreshCount = 0;
  const published = [];
  await assert.rejects(
    executeRegistryArtifactSequence({
      localArtifacts: artifacts,
      publish: async (artifact) => published.push(artifact.name),
      refresh: async () => {
        refreshCount += 1;
        if (refreshCount === 2) {
          const error = new Error("failed check");
          error.code = "REQUIRED_CHECK_NOT_SUCCESSFUL";
          throw error;
        }
        return { artifacts, state: {} };
      },
    }),
    { code: "REQUIRED_CHECK_NOT_SUCCESSFUL" },
  );
  assert.deepEqual(published, ["first"]);

  refreshCount = 0;
  published.length = 0;
  const finalProjection = await executeRegistryArtifactSequence({
    localArtifacts: artifacts,
    publish: async (artifact) => published.push(artifact.name),
    refresh: async () => {
      refreshCount += 1;
      return { artifacts, state: {} };
    },
  });
  assert.deepEqual(published, ["first", "second"]);
  assert.equal(refreshCount, 5);
  assert.equal(finalProjection.artifacts, artifacts);
});

function historyFixture() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "boundsvg-first-parent-"));
  const git = (commandArguments) =>
    execFileSync("git", commandArguments, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "Release Test"]);
  git(["config", "user.email", "release-test@example.invalid"]);
  git(["commit", "--allow-empty", "--quiet", "-m", "release"]);
  const release = git(["rev-parse", "HEAD"]);
  const mainBranch = git(["branch", "--show-current"]);
  git(["checkout", "--quiet", "-b", "feature"]);
  git(["commit", "--allow-empty", "--quiet", "-m", "side feature"]);
  const side = git(["rev-parse", "HEAD"]);
  git(["checkout", "--quiet", mainBranch]);
  git(["commit", "--allow-empty", "--quiet", "-m", "main feature"]);
  const direct = git(["rev-parse", "HEAD"]);
  git(["merge", "--quiet", "--no-ff", "feature", "-m", "merge feature"]);
  const merge = git(["rev-parse", "HEAD"]);
  return { direct, merge, release, repositoryRoot, side };
}

test("trailing history classifies only adjacent first-parent commits", () => {
  const fixture = historyFixture();
  try {
    const pairs = [];
    assert.deepEqual(
      classifyTrailingCommits(fixture.repositoryRoot, {
        classifyPair(baseCommit, headCommit) {
          pairs.push([baseCommit, headCommit]);
          return { phase: "steady" };
        },
        mainTip: fixture.merge,
        releaseCommit: fixture.release,
        state: {},
      }),
      ["steady", "steady"],
    );
    assert.deepEqual(pairs, [
      [fixture.release, fixture.direct],
      [fixture.direct, fixture.merge],
    ]);
    assert.equal(pairs.flat().includes(fixture.side), false);

    assert.throws(
      () =>
        classifyTrailingCommits(fixture.repositoryRoot, {
          classifyPair: () => ({ phase: "steady" }),
          mainTip: fixture.merge,
          releaseCommit: fixture.side,
          state: {},
        }),
      { code: "APPROVAL_TRAILING_FIRST_PARENT" },
    );
    assert.throws(
      () =>
        classifyTrailingCommits(fixture.repositoryRoot, {
          classifyPair(_baseCommit, headCommit) {
            return { phase: headCommit === fixture.merge ? "materialized" : "steady" };
          },
          mainTip: fixture.merge,
          releaseCommit: fixture.release,
          state: {},
        }),
      { code: "APPROVAL_TRAILING_MATERIALIZED" },
    );
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
  }
});

test("crate publication run binds workflow_dispatch, main, and the R-to-T chain", () => {
  assert.deepEqual(validateCratePublicationRunIdentity(runFixture(), optionsFixture()), {
    eventCommit,
    runId: "1234",
  });

  const mutations = [
    (run) => {
      run.id = 1235;
    },
    (run) => {
      run.event = "push";
    },
    (run) => {
      run.path = ".github/workflows/other.yml";
    },
    (run) => {
      run.head_branch = "feature";
    },
    (run) => {
      run.head_sha = "not-a-commit";
    },
  ];
  for (const mutate of mutations) {
    const run = runFixture();
    mutate(run);
    assert.throws(() => validateCratePublicationRunIdentity(run, optionsFixture()), {
      code: "CRATE_WORKFLOW_RUN_INVALID",
    });
  }

  assert.throws(
    () =>
      validateCratePublicationRunIdentity(runFixture(), {
        ...optionsFixture(),
        isAncestor: () => false,
      }),
    { code: "CRATE_WORKFLOW_RUN_INVALID" },
  );

  const zeroRun = runFixture();
  zeroRun.id = 0;
  assert.throws(
    () =>
      validateCratePublicationRunIdentity(zeroRun, {
        ...optionsFixture(),
        runId: "0",
      }),
    { code: "CRATE_WORKFLOW_RUN_INVALID" },
  );
});

test("crate index propagation waits for absence but rejects conflicting final identity", () => {
  const artifact = {
    archiveSha256: "a".repeat(64),
    name: "crate-renderer",
    version: "4.2.0",
  };
  assert.equal(crateIndexArtifactAvailable({ records: new Map() }, artifact), false);
  assert.equal(
    crateIndexArtifactAvailable(
      {
        records: new Map([["4.2.0", { cksum: "b".repeat(64), yanked: false }]]),
      },
      artifact,
    ),
    true,
  );
  assert.throws(
    () =>
      crateIndexArtifactAvailable(
        { records: new Map([["4.2.0", { cksum: "b".repeat(64), yanked: true }]]) },
        artifact,
      ),
    { code: "CRATES_INDEX_MISMATCH" },
  );
});

test("npm publication binds an event family only for advancing artifacts", () => {
  const run = { createdAt: "2026-09-05T00:00:00.000Z", runAttempt: 3, runId: "1234" };
  assert.deepEqual(expectedNpmPublicationRun({ advances: true }, run), {
    allowEarlierAttempt: true,
    ...run,
  });
  assert.equal(expectedNpmPublicationRun({ advances: false }, run), undefined);
});

test("release checkout identity and cleanliness can be reasserted after artifact builds", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "boundsvg-admission-checkout-"));
  const git = (commandArguments) =>
    execFileSync("git", commandArguments, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    git(["init", "--quiet"]);
    git(["config", "user.name", "Release Test"]);
    git(["config", "user.email", "release-test@example.invalid"]);
    git(["commit", "--allow-empty", "--quiet", "-m", "release"]);
    const releaseCommit = git(["rev-parse", "HEAD"]).trim();
    assert.doesNotThrow(() => assertReleaseCheckout(repositoryRoot, releaseCommit));
    const invocations = [];
    const execute = (_repositoryRoot, invocation) => invocations.push(invocation);
    const publish = () =>
      runCredentialedCratePublish(repositoryRoot, "crate-renderer", { execute, releaseCommit });
    publish();
    const expectedInvocation = "cargo publish --locked --no-verify --package crate-renderer".split(
      " ",
    );
    assert.deepEqual(invocations[0], expectedInvocation);
    invocations.length = 0;
    assert.throws(() => assertReleaseCheckout(repositoryRoot, "b".repeat(40)), {
      code: "DISPATCH_CHECKOUT_MISMATCH",
    });
    writeFileSync(join(repositoryRoot, "unexpected.txt"), "build mutation\n");
    assert.throws(() => assertReleaseCheckout(repositoryRoot, releaseCommit), {
      code: "DISPATCH_CHECKOUT_DIRTY",
    });
    assert.throws(publish, { code: "DISPATCH_CHECKOUT_DIRTY" });
    assert.equal(invocations.length, 0);
    git(["add", "unexpected.txt"]);
    git(["commit", "--quiet", "-m", "dry-run mutation"]);
    assert.throws(publish, { code: "DISPATCH_CHECKOUT_MISMATCH" });
    assert.equal(invocations.length, 0);
    const registryTokenField = "CARGO_REGISTRY_TOKEN";
    const dryRunOptions = {
      environment: { [registryTokenField]: "fixture" },
      execute(_repositoryRoot, _invocation, { env }) {
        assert.equal(Object.hasOwn(env, registryTokenField), false);
        throw new Error("fixture stop");
      },
    };
    assert.throws(
      () => auditCrateDryRun("/unused", { name: "crate-renderer" }, dryRunOptions),
      /fixture stop/,
    );
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});
