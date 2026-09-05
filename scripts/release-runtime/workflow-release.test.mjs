import assert from "node:assert/strict";
import test from "node:test";

import { executeWorkflowReleaseCommand } from "./workflow-release.mjs";

const releaseRepositoryRootField = "RELEASE_REPOSITORY_ROOT";

test("workflow entry executes the S controller against a separate R repository root", async () => {
  const releaseCommit = "a".repeat(40);
  const releaseRepositoryRoot = "/tmp/release-source";
  let admissionOptions;
  const outcome = await executeWorkflowReleaseCommand(
    [
      "admission",
      "--target",
      "npm",
      "--release-commit",
      releaseCommit,
      "--bundle",
      "/tmp/release-bundle",
    ],
    { [releaseRepositoryRootField]: releaseRepositoryRoot },
    {
      async createAdmissionReport(options) {
        admissionOptions = options;
        return { reportSha256: "b".repeat(64) };
      },
      async executeRegistryJob() {
        assert.fail("admission must not invoke the registry job");
      },
    },
  );

  assert.equal(admissionOptions.repositoryRoot, releaseRepositoryRoot);
  assert.notEqual(admissionOptions.trustedRepositoryRoot, releaseRepositoryRoot);
  assert.equal(admissionOptions.releaseCommit, releaseCommit);
  assert.equal(outcome.target, "npm");
  assert.equal(outcome.result.reportSha256, "b".repeat(64));
});

test("workflow entry rejects a noncanonical R repository root before dispatch", async () => {
  await assert.rejects(
    executeWorkflowReleaseCommand(
      [
        "admission",
        "--target",
        "npm",
        "--release-commit",
        "a".repeat(40),
        "--bundle",
        "/tmp/release-bundle",
      ],
      { [releaseRepositoryRootField]: "relative/release-source" },
    ),
    { code: "RELEASE_REPOSITORY_ROOT_INVALID" },
  );
});
