import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditAppliedVersionTransition,
  auditReleasePlan,
  classifyVersionTransition,
  compareStableVersions,
  incrementStableVersion,
  parseStableVersion,
  readOption,
  selectPreviousVersion,
} from "./check-release-version-transition.mjs";

const transitionScriptPath = fileURLToPath(
  new URL("./check-release-version-transition.mjs", import.meta.url),
);

function writeFixtureFile(rootDirectory, relativePath, contents) {
  const filePath = join(rootDirectory, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function createFixtureEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([variableName]) => !variableName.startsWith("GIT_")),
  );
}

function runFixtureGit(rootDirectory, args) {
  const hooksPath = join(rootDirectory, ".git-hooks-disabled");
  const result = spawnSync("git", ["-c", `core.hooksPath=${hooksPath}`, ...args], {
    cwd: rootDirectory,
    encoding: "utf8",
    env: createFixtureEnvironment(),
  });
  assert.equal(result.status, 0, result.stderr);
}

test("increments each stable SemVer component independently", () => {
  assert.equal(incrementStableVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(incrementStableVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(incrementStableVersion("0.1.0", "major"), "1.0.0");
  assert.equal(incrementStableVersion("0.9.0", "minor"), "0.10.0");
  assert.equal(incrementStableVersion("9.9.0", "minor"), "9.10.0");
});

test("compares SemVer components as integers", () => {
  assert.equal(compareStableVersions("9.11.0", "9.9.0"), 1);
  assert.equal(compareStableVersions("9.9.1", "9.9.0"), 1);
  assert.equal(compareStableVersions("10.0.0", "9.99.99"), 1);
  assert.equal(compareStableVersions("9.9.0", "9.9.0"), 0);
});

test("rejects values outside the stable three-component format", () => {
  for (const version of ["9.9", "01.2.3", "1.2.3-next.0", "1.2.3+build"]) {
    assert.throws(() => parseStableVersion(version), /invalid stable SemVer/);
  }
});

test("classifies only exact one-step transitions", () => {
  assert.equal(classifyVersionTransition("0.1.0", "0.1.1"), "patch");
  assert.equal(classifyVersionTransition("0.1.0", "0.2.0"), "minor");
  assert.equal(classifyVersionTransition("0.1.0", "1.0.0"), "major");
  assert.equal(classifyVersionTransition("0.1.0", "0.1.0"), "none");
  assert.equal(classifyVersionTransition("0.1.0", "0.1.2"), undefined);
  assert.equal(classifyVersionTransition("0.1.0", "0.3.0"), undefined);
  assert.equal(classifyVersionTransition("0.10.0", "0.2.0"), undefined);
});

test("finds the preceding distinct version across unrelated commits", () => {
  assert.deepEqual(
    selectPreviousVersion("0.2.0", [
      { ref: "head", version: "0.2.0" },
      { ref: "unrelated", version: "0.2.0" },
      { ref: "release-parent", version: "0.1.0" },
    ]),
    { ref: "release-parent", version: "0.1.0" },
  );
  assert.equal(
    selectPreviousVersion("0.2.0", [
      { ref: "head", version: "0.2.0" },
      { ref: "parent", version: "0.2.0" },
    ]),
    undefined,
  );
  assert.deepEqual(
    selectPreviousVersion("0.2.0", [
      { ref: "head", version: "0.2.0" },
      { ref: "prerelease", version: "0.2.0-next.0" },
      { ref: "release-parent", version: "0.1.0" },
    ]),
    { ref: "release-parent", version: "0.1.0" },
  );
});

test("stops reading history after the preceding stable version", () => {
  function* versionHistory() {
    yield { ref: "head", version: "0.2.0" };
    yield { ref: "release-parent", version: "0.1.0" };
    throw new Error("history was read past the preceding version");
  }

  assert.deepEqual(selectPreviousVersion("0.2.0", versionHistory()), {
    ref: "release-parent",
    version: "0.1.0",
  });
});

test("requires a value for command options", () => {
  assert.equal(readOption(["--base", "origin/release"], "--base"), "origin/release");
  assert.equal(readOption([], "--base"), undefined);
  assert.throws(() => readOption(["--base"], "--base"), /--base requires a value/);
  assert.throws(
    () => readOption(["--base", "--previous-version"], "--base"),
    /--base requires a value/,
  );
});

test("accepts a package change without a pending release", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "boundsvg-transition-no-release-"));
  try {
    writeFixtureFile(fixtureRoot, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    writeFixtureFile(
      fixtureRoot,
      "packages/core/package.json",
      `${JSON.stringify({ name: "@boundsvg/core", version: "0.1.0" }, null, 2)}\n`,
    );
    writeFixtureFile(
      fixtureRoot,
      ".changeset/config.json",
      `${JSON.stringify({ fixed: [["@boundsvg/core"]] }, null, 2)}\n`,
    );
    runFixtureGit(fixtureRoot, ["init", "-q"]);
    runFixtureGit(fixtureRoot, ["config", "user.name", "Release Test"]);
    runFixtureGit(fixtureRoot, ["config", "user.email", "release-test@example.com"]);
    runFixtureGit(fixtureRoot, ["add", "."]);
    runFixtureGit(fixtureRoot, ["commit", "-qm", "initial package"]);

    writeFixtureFile(fixtureRoot, "packages/core/src/index.ts", "export const value = 1;\n");
    runFixtureGit(fixtureRoot, ["add", "."]);
    runFixtureGit(fixtureRoot, ["commit", "-qm", "change package source"]);

    const result = spawnSync(process.execPath, [transitionScriptPath, "--base", "HEAD~1"], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: createFixtureEnvironment(),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed \(no transition planned\)/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("accepts an exact synchronized release plan", () => {
  const fixedGroup = ["@boundsvg/core", "@boundsvg/react"];
  const releasePlan = {
    changesets: [
      {
        releases: [{ name: "@boundsvg/core", type: "minor" }],
      },
    ],
    releases: fixedGroup.map((name) => ({
      name,
      type: "minor",
      oldVersion: "0.1.0",
      newVersion: "0.2.0",
    })),
  };

  assert.deepEqual(
    auditReleasePlan(releasePlan, {
      fixedGroups: [fixedGroup],
      packageVersions: {
        "@boundsvg/core": "0.1.0",
        "@boundsvg/react": "0.1.0",
      },
    }),
    [],
  );
});

test("rejects a fixed-group bump that differs from its declared release type", () => {
  const fixedGroup = ["@boundsvg/core", "@boundsvg/video"];
  const violations = auditReleasePlan(
    {
      changesets: [
        {
          releases: [{ name: "@boundsvg/core", type: "minor" }],
        },
      ],
      releases: fixedGroup.map((name) => ({
        name,
        type: "major",
        oldVersion: "0.1.0",
        newVersion: "1.0.0",
      })),
    },
    { fixedGroups: [fixedGroup] },
  );

  assert.ok(violations.some((violation) => violation.includes("does not match declared minor")));
});

test("reports arithmetic, manifest, and fixed-group drift", () => {
  const violations = auditReleasePlan(
    {
      releases: [
        {
          name: "@boundsvg/core",
          type: "minor",
          oldVersion: "0.1.0",
          newVersion: "0.1.1",
        },
        {
          name: "@boundsvg/react",
          type: "patch",
          oldVersion: "0.1.0",
          newVersion: "0.1.1",
        },
      ],
    },
    {
      fixedGroups: [["@boundsvg/core", "@boundsvg/react"]],
      packageVersions: {
        "@boundsvg/core": "0.1.0",
        "@boundsvg/react": "0.0.9",
      },
    },
  );

  assert.ok(violations.some((violation) => violation.includes("must produce 0.2.0")));
  assert.ok(violations.some((violation) => violation.includes("manifest is 0.0.9")));
  assert.ok(violations.some((violation) => violation.includes("release type and versions")));
});

test("rejects skipped or partial applied increments", () => {
  assert.deepEqual(auditAppliedVersionTransition("0.1.0", "0.2.0"), []);
  assert.ok(auditAppliedVersionTransition("0.1.0", "0.1.0").length > 0);
  assert.ok(auditAppliedVersionTransition("0.1.0", "0.1.2").length > 0);
  assert.ok(auditAppliedVersionTransition("0.1.0", "0.3.0").length > 0);
});
