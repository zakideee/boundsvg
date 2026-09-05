import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJsonBytes, sha256 } from "./canonical.mjs";
import {
  applyReleasePlan,
  createReleasePlan,
  loadReleasePlan,
  verifyAppliedPlan,
  verifyPostMergeIdentity,
} from "./plan.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "release-plan-test-"));
  const root = join(parent, "repository");
  mkdirSync(root);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Release Test"]);
  git(root, ["config", "user.email", "release-test@example.invalid"]);
  git(root, ["remote", "add", "origin", "https://github.com/zakideee/boundsvg.git"]);
  mkdirSync(join(root, ".changeset"));
  writeFileSync(join(root, "version.txt"), "before\n");
  writeFileSync(join(root, ".changeset/change.md"), "pending\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);
  const sourceCommit = git(root, ["rev-parse", "HEAD"]);
  const sourceTree = git(root, ["show", "-s", "--format=%T", sourceCommit]);
  const artifactDigest = "c".repeat(64);
  const plan = createReleasePlan({
    commands: [{ argv: ["pnpm", "changeset", "version"], cwd: ".", exitCode: 0 }],
    files: [
      {
        after: { bytes: Buffer.from("after\n"), mode: "100644" },
        before: { bytes: Buffer.from("before\n"), mode: "100644" },
        path: "version.txt",
      },
      {
        after: undefined,
        before: { bytes: Buffer.from("pending\n"), mode: "100644" },
        path: ".changeset/change.md",
      },
    ],
    graphs: { cargoPublishOrder: ["crate"], npmPublishOrder: ["package"] },
    inputs: [{ path: ".changeset/change.md", sha256: "0".repeat(64) }],
    repository: "zakideee/boundsvg",
    repositoryRoot: root,
    semantic: {
      artifacts: {
        crates: [
          {
            canonicalSha256: artifactDigest,
            name: "crate",
            state: "advance",
            version: "3.2.0",
          },
        ],
        npm: [
          {
            canonicalSha256: artifactDigest,
            name: "package",
            state: "advance",
            version: "2.8.0",
          },
        ],
      },
      delta: {
        cargo: {
          advanced: ["crate"],
          currentVersions: { crate: "3.1.0" },
          targetVersions: { crate: "3.2.0" },
        },
        npm: { advanced: true, currentVersion: "2.7.0", targetVersion: "2.8.0" },
        phase: "materialized",
      },
      settings: "verified",
    },
    sourceCommit,
    sourceTree,
    targets: { crates: { crate: "3.2.0" }, npm: "2.8.0" },
    tools: {
      biome: "2.4.2",
      node: "22.14.0",
      npm: "11.19.0",
      pnpm: "10.29.3",
      prettier: "3.8.1",
      rustc: "1.97.0",
      wasmPack: "0.13.1",
    },
  });
  const planPath = join(parent, "release-plan.json");
  writeFileSync(planPath, plan.bytes);
  return { parent, plan, planPath, root, sourceCommit, sourceTree };
}

test("canonical plan apply and read-only verify reconstruct the same prospective tree", () => {
  const current = fixture();
  try {
    const loaded = loadReleasePlan(current.planPath, current.plan.sha256);
    assert.equal(loaded.source.commit, current.sourceCommit);
    applyReleasePlan(current.root, loaded);
    assert.equal(readFileSync(join(current.root, "version.txt"), "utf8"), "after\n");
    assert.equal(verifyAppliedPlan(current.root, loaded).tree, loaded.prospectiveTree);
  } finally {
    rmSync(current.parent, { force: true, recursive: true });
  }
});

test("apply rejects hash, before-byte, and untracked drift before mutation", () => {
  for (const fixtureCase of [
    {
      expectedVersionText: "before\n",
      mutate(current) {
        current.plan.sha256 = "f".repeat(64);
      },
    },
    {
      expectedVersionText: "drift\n",
      mutate(current) {
        writeFileSync(join(current.root, "version.txt"), "drift\n");
      },
    },
    {
      expectedVersionText: "before\n",
      mutate(current) {
        writeFileSync(join(current.root, "untracked.txt"), "drift\n");
      },
    },
  ]) {
    const current = fixture();
    try {
      fixtureCase.mutate(current);
      assert.throws(
        () => {
          const plan = loadReleasePlan(current.planPath, current.plan.sha256);
          applyReleasePlan(current.root, plan);
        },
        (error) => typeof error.code === "string",
      );
      assert.equal(
        readFileSync(join(current.root, "version.txt"), "utf8"),
        fixtureCase.expectedVersionText,
      );
    } finally {
      rmSync(current.parent, { force: true, recursive: true });
    }
  }
});

test("apply rejects a branch whose HEAD moved away from S", () => {
  const current = fixture();
  try {
    writeFileSync(join(current.root, "base-drift.txt"), "drift\n");
    git(current.root, ["add", "base-drift.txt"]);
    git(current.root, ["commit", "-m", "base drift"]);
    const loaded = loadReleasePlan(current.planPath, current.plan.sha256);
    assert.throws(() => applyReleasePlan(current.root, loaded), { code: "PLAN_SOURCE_DRIFT" });
    assert.equal(readFileSync(join(current.root, "version.txt"), "utf8"), "before\n");
  } finally {
    rmSync(current.parent, { force: true, recursive: true });
  }
});

test("plan loading rejects symlinks and every nested decision surface drift", () => {
  const current = fixture();
  try {
    const symlinkPath = join(current.parent, "release-plan-link.json");
    symlinkSync(current.planPath, symlinkPath);
    assert.throws(() => loadReleasePlan(symlinkPath, current.plan.sha256), {
      code: "PLAN_FILE_INVALID",
    });

    for (const mutate of [
      (plan) => {
        plan.graphs.npmPublishOrder.push("hidden-package");
      },
      (plan) => {
        plan.commands[0].argv.push("/absolute/unreviewed-path");
      },
      (plan) => {
        plan.inputs[0].sha256 = "A".repeat(64);
      },
      (plan) => {
        plan.semantic.artifacts.npm[0].canonicalSha256 = "D".repeat(64);
      },
      (plan) => {
        plan.targets.npm = "2.9.0";
      },
      (plan) => {
        plan.tools.node = "22.15.0";
      },
    ]) {
      const mutated = structuredClone(current.plan.plan);
      mutate(mutated);
      const mutatedBytes = canonicalJsonBytes(mutated);
      writeFileSync(current.planPath, mutatedBytes);
      assert.throws(() => loadReleasePlan(current.planPath, sha256(mutatedBytes)), {
        code: "PLAN_SHAPE_INVALID",
      });
    }
  } finally {
    rmSync(current.parent, { force: true, recursive: true });
  }
});

test("ordinary apply failure restores every before byte", () => {
  const current = fixture();
  try {
    const loaded = loadReleasePlan(current.planPath, current.plan.sha256);
    let writes = 0;
    assert.throws(
      () =>
        applyReleasePlan(current.root, loaded, {
          afterWrite() {
            writes += 1;
            if (writes === 1) {
              const failure = new Error("injected failure");
              failure.code = "INJECTED";
              throw failure;
            }
          },
        }),
      { code: "PLAN_APPLY_FAILED" },
    );
    assert.equal(readFileSync(join(current.root, "version.txt"), "utf8"), "before\n");
    assert.equal(readFileSync(join(current.root, ".changeset/change.md"), "utf8"), "pending\n");
  } finally {
    rmSync(current.parent, { force: true, recursive: true });
  }
});

test("S/A/R identity accepts one exact single-parent commit and rejects a wrong parent", () => {
  const current = fixture();
  try {
    const loaded = loadReleasePlan(current.planPath, current.plan.sha256);
    applyReleasePlan(current.root, loaded);
    git(current.root, ["add", "-A"]);
    git(current.root, ["commit", "-m", "version"]);
    const releaseCommit = git(current.root, ["rev-parse", "HEAD"]);
    assert.equal(
      verifyPostMergeIdentity(current.root, releaseCommit, loaded).releaseCommit,
      releaseCommit,
    );

    writeFileSync(join(current.root, "extra.txt"), "extra\n");
    git(current.root, ["add", "extra.txt"]);
    git(current.root, ["commit", "-m", "extra"]);
    const wrongTree = git(current.root, ["rev-parse", "HEAD"]);
    assert.throws(() => verifyPostMergeIdentity(current.root, wrongTree, loaded), {
      code: "RELEASE_PARENT_MISMATCH",
    });
  } finally {
    rmSync(current.parent, { force: true, recursive: true });
  }
});

test("S-trusted verification rejects single-parent R tree drift in bytes, mode, and paths", () => {
  const mutations = [
    {
      label: "byte",
      mutate(current) {
        writeFileSync(join(current.root, "version.txt"), "wrong bytes\n");
      },
    },
    {
      label: "mode",
      mutate(current) {
        chmodSync(join(current.root, "version.txt"), 0o755);
      },
    },
    {
      label: "extra path",
      mutate(current) {
        writeFileSync(join(current.root, "extra.txt"), "extra\n");
      },
    },
    {
      label: "self-modified verifier",
      mutate(current) {
        mkdirSync(join(current.root, "scripts/release-runtime"), { recursive: true });
        writeFileSync(join(current.root, "scripts/release-runtime/plan.mjs"), "export {};\n");
      },
    },
  ];
  for (const mutation of mutations) {
    const current = fixture();
    try {
      const loaded = loadReleasePlan(current.planPath, current.plan.sha256);
      applyReleasePlan(current.root, loaded);
      mutation.mutate(current);
      git(current.root, ["add", "-A"]);
      git(current.root, ["commit", "-m", mutation.label]);
      const releaseCommit = git(current.root, ["rev-parse", "HEAD"]);
      assert.throws(() => verifyPostMergeIdentity(current.root, releaseCommit, loaded), {
        code: "RELEASE_TREE_MISMATCH",
      });
    } finally {
      rmSync(current.parent, { force: true, recursive: true });
    }
  }
});

test("plan creation rejects unsafe paths, duplicate paths, and unsupported modes", () => {
  const common = {
    commands: [],
    graphs: {},
    inputs: [],
    repository: "zakideee/boundsvg",
    repositoryRoot: process.cwd(),
    semantic: {},
    sourceCommit: "a".repeat(40),
    sourceTree: "b".repeat(40),
    targets: {},
    tools: {},
  };
  for (const files of [
    [{ after: { bytes: Buffer.from("x"), mode: "100644" }, path: "../escape" }],
    [
      { after: { bytes: Buffer.from("x"), mode: "100644" }, path: "same" },
      { after: { bytes: Buffer.from("y"), mode: "100644" }, path: "same" },
    ],
    [{ after: { bytes: Buffer.from("x"), mode: "120000" }, path: "link" }],
  ]) {
    assert.throws(
      () => createReleasePlan({ ...common, files }),
      (error) => String(error.code).startsWith("PLAN_"),
    );
  }
});
