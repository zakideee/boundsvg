import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyChanges,
  collectClassification,
  parseChanges,
  validateJobResults,
} from "./ci-policy.mjs";

function record(path, status = "M", { oldMode = "100644", newMode = "100644" } = {}) {
  return { path, status, oldMode, newMode };
}

function runGit(root, ...args) {
  const command = spawnSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(command.status, 0, command.stderr);
  return command.stdout.trim();
}

function createRepo(context) {
  const root = mkdtempSync(join(tmpdir(), "ci-policy-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "# Start\n");
  runGit(root, "add", ".");
  runGit(root, "commit", "-qm", "Initial fixture");
  const base = runGit(root, "rev-parse", "HEAD");
  runGit(root, "update-ref", "refs/remotes/origin/main", base);
  return { root, base };
}

function commitFile(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  runGit(root, "add", "--", path);
  runGit(root, "commit", "-qm", "Update fixture");
  return runGit(root, "rev-parse", "HEAD");
}

function needsFor(scope, mode) {
  const names =
    scope === "ci"
      ? [
          "changes",
          "docs-build",
          "docs-check",
          "lint-and-typecheck",
          "test-ts",
          "test-rust",
          "test-e2e",
        ]
      : ["changes", "render-regression"];
  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        result:
          mode === "full" || ["changes", "docs-build", "docs-check"].includes(name)
            ? "success"
            : "skipped",
        ...(name === "changes" ? { outputs: { mode } } : {}),
      },
    ]),
  );
}

test("only regular root prose additions and edits use docs coverage", () => {
  assert.equal(classifyChanges([record("README.md")]), "docs");
  assert.equal(classifyChanges([record("CONTRIBUTING.md", "A", { oldMode: "000000" })]), "docs");
  assert.equal(classifyChanges([record("README.md"), record("CONTRIBUTING.md")]), "docs");
  for (const path of [
    "crates/boundtext/src/lib.rs",
    "packages/core/tests/example.test.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "scripts/preflight-pr.mjs",
    "apps/docs/example.md",
    "apps/docs/.vitepress/config.ts",
    "apps/docs/Example.vue",
    "AGENTS.md",
    "SECURITY.md",
    ".changeset/example.md",
    "unknown",
    "nested/README.md",
    "Readme.md",
  ]) {
    assert.equal(classifyChanges([record(path)]), "full", path);
    assert.equal(classifyChanges([record("README.md"), record(path)]), "full", path);
  }
  assert.equal(classifyChanges([]), "full");
  for (const change of [
    record("README.md", "D", { oldMode: "100644", newMode: "000000" }),
    record("README.md", "T", { oldMode: "120000" }),
    record("README.md", "M", { oldMode: "100644", newMode: "100755" }),
    record("README.md", "A", { oldMode: "000000", newMode: "160000" }),
    record("README.md", "A", { oldMode: "000000", newMode: "120000" }),
  ]) {
    assert.equal(classifyChanges([change]), "full");
  }
});

test("raw diff parsing preserves unusual paths and rejects malformed records", () => {
  const header = `:100644 100644 ${"1".repeat(40)} ${"2".repeat(40)} M\0`;
  for (const path of ["a space.md", "a\nnewline.md", "-option.md", "日本語.md"]) {
    assert.deepEqual(parseChanges(Buffer.from(`${header}${path}\0`)), [record(path)]);
  }
  assert.deepEqual(parseChanges(Buffer.alloc(0)), []);
  for (const raw of [
    header,
    `${header}README.md`,
    `${header}../escape\0`,
    `${header}/absolute\0`,
    `${header}./relative\0`,
    `${header}a//b\0`,
    `${header}x\0extra\0`,
    `${header.replace(" M", " U")}x\0`,
    `${header.replace(" M", " R100")}a\0b\0`,
  ]) {
    assert.throws(() => parseChanges(Buffer.from(raw)));
  }
  assert.throws(() => parseChanges(Buffer.from([0xff])));
});

test("PR classification uses exact commits, including a fork-style merge checkout", (context) => {
  const { root, base } = createRepo(context);
  runGit(root, "switch", "-qc", "topic");
  const head = commitFile(root, "README.md", "# Changed\n");
  runGit(root, "switch", "-q", "main");
  const updatedBase = commitFile(root, "source.js", "export const stable = true;\n");
  runGit(root, "merge", "--no-ff", "-qm", "Merge fixture", "topic");
  const checkout = runGit(root, "rev-parse", "HEAD");
  const classified = collectClassification(root, {
    eventName: "pull_request",
    prBaseSha: updatedBase,
    prHeadSha: head,
    githubSha: checkout,
  });
  assert.equal(classified.mode, "docs");
  assert.equal(classified.mergeBase, base);
  assert.equal(classified.checkout, checkout);
  assert.equal(classified.parents.length, 2);
  assert.deepEqual(
    classified.changes.map((change) => change.path),
    ["README.md"],
  );
  assert.match(classified.changesSha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      collectClassification(root, {
        eventName: "pull_request",
        prBaseSha: updatedBase,
        prHeadSha: head,
        githubSha: head,
      }),
    /Checkout/,
  );
});

test("push and explicit full dispatch remain full even for prose edits", (context) => {
  const { root, base } = createRepo(context);
  commitFile(root, "README.md", "# Changed\n");
  assert.equal(
    collectClassification(root, { eventName: "push", pushBeforeSha: base }).mode,
    "full",
  );
  assert.equal(collectClassification(root, { eventName: "push" }).mode, "full");
  assert.equal(
    collectClassification(root, { eventName: "workflow_dispatch", workflowFull: "true" }).mode,
    "full",
  );
  assert.equal(
    collectClassification(root, { eventName: "workflow_dispatch", workflowFull: "false" }).mode,
    "docs",
  );
  for (const env of [
    { eventName: "bad" },
    { eventName: "workflow_dispatch" },
    { eventName: "workflow_dispatch", workflowFull: "yes" },
    { eventName: "pull_request", prBaseSha: base },
    { eventName: "pull_request", prBaseSha: base, prHeadSha: "0".repeat(40) },
    { eventName: "pull_request", prBaseSha: "a".repeat(40), prHeadSha: base },
  ]) {
    assert.throws(() => collectClassification(root, env));
  }
  assert.throws(() => collectClassification(join(root, "missing"), { eventName: "push" }), /Git/);
});

test("renames, deletions and symlinks cannot take the docs lane", (context) => {
  const { root, base } = createRepo(context);
  runGit(root, "mv", "README.md", "CONTRIBUTING.md");
  runGit(root, "commit", "-qm", "Rename fixture");
  assert.equal(
    collectClassification(root, {
      eventName: "pull_request",
      prBaseSha: base,
      prHeadSha: runGit(root, "rev-parse", "HEAD"),
    }).mode,
    "full",
  );
  symlinkSync("CONTRIBUTING.md", join(root, "README.md"));
  runGit(root, "add", "README.md");
  runGit(root, "commit", "-qm", "Symlink fixture");
  assert.equal(
    collectClassification(root, {
      eventName: "pull_request",
      prBaseSha: base,
      prHeadSha: runGit(root, "rev-parse", "HEAD"),
    }).mode,
    "full",
  );
});

test("CLI emits exact identities and all docs flags; invalid inputs fail without outputs", (context) => {
  const { root, base } = createRepo(context);
  const head = commitFile(root, "README.md", "# Changed\n");
  const output = join(root, "outputs.txt");
  const report = join(root, "classification.json");
  const env = { ...process.env };
  for (const [name, field] of [
    ["EVENT_NAME", "pull_request"],
    ["PR_BASE_SHA", base],
    ["PR_HEAD_SHA", head],
    ["GITHUB_SHA", head],
    ["GITHUB_OUTPUT", output],
    ["CI_CLASSIFICATION_REPORT", report],
    ["GITHUB_STEP_SUMMARY", join(root, "summary.md")],
  ]) {
    env[name] = field;
  }
  const script = fileURLToPath(new URL("./ci-policy.mjs", import.meta.url));
  const classified = spawnSync(process.execPath, [script, "classify"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(classified.status, 0, classified.stderr);
  const fields = Object.fromEntries(
    readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
  assert.equal(fields.mode, "docs");
  assert.equal(fields.checkout, head);
  assert.equal(fields.base_ref, base);
  for (const flag of ["full", "rust", "ts", "e2e", "pack"]) {
    assert.equal(fields[flag], "false");
  }
  assert.equal(JSON.parse(readFileSync(report, "utf8")).head, head);
  const summary = readFileSync(env.GITHUB_STEP_SUMMARY, "utf8");
  for (const [label, value] of [
    ["Event", "pull_request"],
    ["Base", base],
    ["Head", head],
    ["Merge base", base],
  ]) {
    assert.ok(summary.includes(`${label}: ${value}\n`), label);
  }

  const originalOutput = readFileSync(output, "utf8");
  env.PR_BASE_SHA = "missing";
  assert.equal(spawnSync(process.execPath, [script, "classify"], { cwd: root, env }).status, 1);
  assert.equal(readFileSync(output, "utf8"), originalOutput);
  env.CI_MODE = "full";
  env.CI_NEEDS = "{invalid";
  assert.equal(spawnSync(process.execPath, [script, "accept", "ci"], { cwd: root, env }).status, 1);
});

for (const scope of ["ci", "render"]) {
  for (const mode of ["docs", "full"]) {
    test(`${scope} ${mode} acceptance rejects every unexpected result`, () => {
      const needs = needsFor(scope, mode);
      assert.doesNotThrow(() => validateJobResults(scope, mode, needs));
      for (const name of Object.keys(needs)) {
        for (const outcome of [
          "failure",
          "cancelled",
          "timed_out",
          "neutral",
          "unknown",
          "success",
          "skipped",
          undefined,
        ]) {
          if (outcome === needs[name].result) {
            continue;
          }
          const changed = structuredClone(needs);
          changed[name].result = outcome;
          assert.throws(
            () => validateJobResults(scope, mode, changed),
            undefined,
            `${name}/${outcome}`,
          );
        }
        const missing = structuredClone(needs);
        delete missing[name];
        assert.throws(() => validateJobResults(scope, mode, missing));
      }
      assert.throws(() => validateJobResults(scope, "", needs));
      assert.throws(() => validateJobResults("unknown", mode, needs));
      assert.throws(() =>
        validateJobResults(scope, mode, { ...needs, extra: { result: "success" } }),
      );
      delete needs.changes.outputs.mode;
      assert.throws(() => validateJobResults(scope, mode, needs));
    });
  }
}

function jobBlock(yaml, name) {
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m").exec(
    yaml,
  );
  assert.ok(match, name);
  return match[1];
}

test("actual workflow wiring keeps required jobs, coverage, and unique acceptance names", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const render = readFileSync(
    new URL("../.github/workflows/render-regression.yml", import.meta.url),
    "utf8",
  );
  const release = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(ci + render, /^\s+paths(?:-ignore)?:/m);
  assert.doesNotMatch(ci + render, /continue-on-error/);
  assert.ok(ci.includes('git cat-file -e "${PREFLIGHT_BASE}^{commit}"'));
  for (const yaml of [ci, render]) {
    assert.doesNotMatch(yaml, /runner.temp/);
    assert.match(yaml, /CI_CLASSIFICATION_REPORT: target\/\S+-classification.json/);
    assert.match(yaml, /path: target\/\S+-classification.json/);
  }
  assert.equal((ci.match(/^ {4}name: CI acceptance$/gm) ?? []).length, 1);
  assert.equal((render.match(/^ {4}name: Baseline Checks$/gm) ?? []).length, 1);
  for (const [yaml, name, expected] of [
    [
      ci,
      "ci-acceptance",
      "[changes, docs-build, docs-check, lint-and-typecheck, test-ts, test-rust, test-e2e]",
    ],
    [render, "baseline-checks", "[changes, render-regression]"],
  ]) {
    const block = jobBlock(yaml, name);
    assert.match(block, /if: \$\{\{ always\(\) \}\}/);
    const actualNeeds = /needs:\s*\[([\s\S]*?)\]/
      .exec(block)?.[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    assert.deepEqual(actualNeeds, expected.slice(1, -1).split(", "));
    for (const dependency of actualNeeds) {
      assert.ok(block.includes(`"result": "\${{ needs.${dependency}.result }}"`));
    }
    assert.match(block, /"mode": "\$\{\{ needs.changes.outputs.mode \}\}"/);
    assert.match(block, /node scripts\/ci-policy.mjs accept/);
  }
  assert.match(jobBlock(ci, "lint-and-typecheck"), /if: needs.changes.outputs.mode == 'full'/);
  for (const name of ["core", "React", "CLI"]) {
    assert.ok(
      ci.includes(`- name: Test ${name}\n        if: needs.changes.outputs.full != 'true'`),
    );
  }
  for (const command of [
    "@boundsvg/shape test",
    "@boundsvg/browser test",
    "@boundsvg/worker test",
    "@boundsvg/video test",
    "@boundsvg/extras test",
    "@boundsvg/testing test",
    "@boundsvg/playground-core test",
    "@boundsvg/playground-react test",
    "pnpm run test:coverage:ts",
    "pnpm bench:smoke",
    "node scripts/pack-e2e.mjs",
    "pnpm knip",
    "cargo test --manifest-path vendor/ttf-parser/Cargo.toml --all-features",
    "--test lib_exports_test --features unicode-full",
    "cargo llvm-cov --workspace --lcov",
    "pnpm run test:e2e",
  ]) {
    assert.ok(ci.includes(command), command);
  }
  assert.match(ci, /- name: Test workspace\n {8}if: needs.changes.outputs.full != 'true'/);
  for (const pkg of ["core", "react", "cli"]) {
    assert.ok(ci.includes(`test -s packages/${pkg}/coverage/coverage-summary.json`));
  }
  assert.match(release, /REQUIRED_CHECKS: \|-\n {4}CI acceptance\n {4}Baseline Checks/);
  assert.doesNotMatch(release, /cache: pnpm|uses: Swatinem\/rust-cache/);
});
