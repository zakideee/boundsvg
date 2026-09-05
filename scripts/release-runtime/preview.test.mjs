import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  run as runPreviewCommand,
  validatePlanOutputPath,
  validatePreviewTargets,
} from "./preview.mjs";

function registryState(versions, options = {}) {
  return {
    deprecated: options.deprecated ?? new Set(),
    records: new Map(versions.map((version) => [version, {}])),
    state: options.state ?? "known",
    versions,
    yanked: options.yanked ?? new Set(),
  };
}

function state() {
  return {
    cargo: {
      crates: [
        { name: "crate-kernel", version: "3.1.0" },
        { name: "crate-renderer", version: "4.2.0" },
      ],
      markers: [{ crateName: "crate-kernel", pendingVersion: "3.2.0" }],
    },
    npm: {
      currentVersion: "2.7.3",
      fixedNames: ["@example/kernel", "@example/renderer"],
    },
    inputs: {
      changesets: [{ releases: [{ name: "@example/kernel", type: "minor" }] }],
    },
  };
}

test("preview targets are complete, independent across ecosystems, and above every frontier", () => {
  const result = validatePreviewTargets({
    crateTargetInputs: new Map([
      ["crate-kernel", "3.2.0"],
      ["crate-renderer", "4.3.0"],
    ]),
    npmTargetInput: "2.8.0",
    registry: {
      crates: new Map([
        ["crate-kernel", registryState(["3.1.0"])],
        ["crate-renderer", registryState(["4.2.0"])],
      ]),
      npm: new Map([
        ["@example/kernel", registryState(["2.7.3"])],
        ["@example/renderer", registryState(["2.7.3"])],
      ]),
    },
    state: state(),
  });
  assert.equal(result.npm.target, "2.8.0");
  assert.equal(result.crates.get("crate-kernel").target, "3.2.0");
  assert.equal(result.crates.get("crate-renderer").target, "4.3.0");
});

test("preview accepts npm-only, Cargo-only, and combined independent advances", () => {
  const base = {
    registry: {
      crates: new Map([
        ["crate-kernel", registryState(["3.1.0"])],
        ["crate-renderer", registryState(["4.2.0"])],
      ]),
      npm: new Map([
        ["@example/kernel", registryState(["2.7.3"])],
        ["@example/renderer", registryState(["2.7.3"])],
      ]),
    },
    state: state(),
  };
  base.state.cargo.markers = [];
  for (const fixture of [
    {
      crateTargetInputs: new Map([
        ["crate-kernel", "current"],
        ["crate-renderer", "current"],
      ]),
      expected: { cargo: false, npm: true },
      npmTargetInput: "2.8.0",
    },
    {
      crateTargetInputs: new Map([
        ["crate-kernel", "3.2.0"],
        ["crate-renderer", "current"],
      ]),
      expected: { cargo: true, npm: false },
      npmTargetInput: "current",
    },
    {
      crateTargetInputs: new Map([
        ["crate-kernel", "3.2.0"],
        ["crate-renderer", "4.3.0"],
      ]),
      expected: { cargo: true, npm: true },
      npmTargetInput: "2.8.0",
    },
  ]) {
    const input = { ...base, ...fixture, state: structuredClone(base.state) };
    if (!fixture.expected.npm) {
      input.state.inputs.changesets = [];
    }
    const result = validatePreviewTargets(input);
    assert.equal(result.npm.advances, fixture.expected.npm);
    assert.equal(
      [...result.crates.values()].some(({ advances }) => advances),
      fixture.expected.cargo,
    );
  }
});

test("preview rejects missing crate targets, unsatisfied markers, no advance, and unknown frontier", () => {
  const base = {
    crateTargetInputs: new Map([
      ["crate-kernel", "3.2.0"],
      ["crate-renderer", "4.3.0"],
    ]),
    npmTargetInput: "2.8.0",
    registry: {
      crates: new Map([
        ["crate-kernel", registryState(["3.1.0"])],
        ["crate-renderer", registryState(["4.2.0"])],
      ]),
      npm: new Map([
        ["@example/kernel", registryState(["2.7.3"])],
        ["@example/renderer", registryState(["2.7.3"])],
      ]),
    },
    state: state(),
  };
  const missing = structuredClone(base);
  missing.crateTargetInputs.delete("crate-renderer");
  assert.throws(() => validatePreviewTargets(missing), { code: "PREVIEW_CRATE_TARGET_SET" });

  const marker = structuredClone(base);
  marker.crateTargetInputs.set("crate-kernel", "3.3.0");
  assert.throws(() => validatePreviewTargets(marker), { code: "PREVIEW_MARKER_TARGET" });

  const noAdvance = structuredClone(base);
  noAdvance.npmTargetInput = "current";
  noAdvance.crateTargetInputs.set("crate-kernel", "current");
  noAdvance.crateTargetInputs.set("crate-renderer", "current");
  noAdvance.state.cargo.markers = [];
  noAdvance.state.inputs.changesets = [];
  assert.throws(() => validatePreviewTargets(noAdvance), { code: "PREVIEW_NO_ADVANCE" });

  const unknown = structuredClone(base);
  unknown.registry.npm.get("@example/kernel").state = "unknown";
  assert.throws(() => validatePreviewTargets(unknown), { code: "FRONTIER_UNKNOWN" });
});

test("preview target must exactly equal the shared Changeset-derived target", () => {
  const input = {
    crateTargetInputs: new Map([
      ["crate-kernel", "3.2.0"],
      ["crate-renderer", "4.3.0"],
    ]),
    npmTargetInput: "3.0.0",
    registry: {
      crates: new Map([
        ["crate-kernel", registryState(["3.1.0"])],
        ["crate-renderer", registryState(["4.2.0"])],
      ]),
      npm: new Map([
        ["@example/kernel", registryState(["2.7.3"])],
        ["@example/renderer", registryState(["2.7.3"])],
      ]),
    },
    state: state(),
  };
  input.state.inputs.changesets[0].releases[0].type = "patch";
  assert.throws(() => validatePreviewTargets(input), { code: "CHANGESET_TARGET_MISMATCH" });

  input.npmTargetInput = "2.7.4";
  assert.equal(validatePreviewTargets(input).npm.target, "2.7.4");
});

test("plan output must be a nonexistent path outside both worktree and git directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "preview-output-test-"));
  const worktree = join(parent, "repo");
  const gitDirectory = join(worktree, ".git");
  const outside = join(parent, "outside");
  mkdirSync(gitDirectory, { recursive: true });
  mkdirSync(outside);
  try {
    assert.equal(
      validatePlanOutputPath(join(outside, "plan.json"), worktree, gitDirectory),
      join(outside, "plan.json"),
    );
    assert.throws(
      () => validatePlanOutputPath(join(worktree, "plan.json"), worktree, gitDirectory),
      { code: "PREVIEW_OUTPUT_INSIDE_REPOSITORY" },
    );
    const existing = join(outside, "existing.json");
    writeFileSync(existing, "existing");
    assert.throws(() => validatePlanOutputPath(existing, worktree, gitDirectory), {
      code: "PREVIEW_OUTPUT_EXISTS",
    });
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test("preview preserves Cargo's stale-lock exit 101", () => {
  assert.throws(
    () =>
      runPreviewCommand(process.cwd(), [process.execPath, "-e", "process.exit(101)"], {
        errorCode: "PREVIEW_LOCK_STALE",
      }),
    (error) => error.code === "PREVIEW_LOCK_STALE" && error.exitCode === 101,
  );
});
