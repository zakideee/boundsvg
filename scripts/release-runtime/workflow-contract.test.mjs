import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateWorkflowPins } from "./seal.mjs";

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const workflow = readFileSync(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");

test("workflow jobs, actions, commands, and environments form a closed topology", () => {
  assert.deepEqual(
    [...workflow.matchAll(/^ {2}([a-z][a-z-]+):\s*$/gm)].map((match) => match[1]),
    ["admission", "npm-publish", "crates-publish"],
  );
  assert.deepEqual(
    [...workflow.matchAll(/^\s+(?:-\s+)?uses:\s*([^\s#]+)/gm)].map((match) => match[1]),
    [
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "dtolnay/rust-toolchain@6c977a6ca4077a0ceb28ffbe03f59d46e9ac8772",
      "taiki-e/install-action@a2a5f6e99e1a31540baa0468acfa302cff0f359f",
      "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "dtolnay/rust-toolchain@6c977a6ca4077a0ceb28ffbe03f59d46e9ac8772",
      "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "dtolnay/rust-toolchain@6c977a6ca4077a0ceb28ffbe03f59d46e9ac8772",
      "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
      "rust-lang/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18",
    ],
  );
  assert.deepEqual(
    [...workflow.matchAll(/^\s+(?:-\s+)?run:\s*(\S.*)$/gm)].map((match) => match[1]),
    [
      "|",
      "|",
      "pnpm install --frozen-lockfile --ignore-scripts",
      'node scripts/release-runtime/workflow-release.mjs admission --target "$RELEASE_TARGET" --release-commit "$RELEASE_COMMIT" --bundle "$BUNDLE_DIRECTORY"',
      "|",
      "|",
      "pnpm install --frozen-lockfile --ignore-scripts",
      'node scripts/release-runtime/workflow-release.mjs npm --release-commit "$RELEASE_COMMIT" --bundle "$BUNDLE_DIRECTORY" --report-sha256 "$REPORT_SHA256"',
      "|",
      "|",
      "pnpm install --frozen-lockfile --ignore-scripts",
      'node scripts/release-runtime/workflow-release.mjs crates --release-commit "$RELEASE_COMMIT" --bundle "$BUNDLE_DIRECTORY" --report-sha256 "$REPORT_SHA256"',
    ],
  );
  assert.deepEqual(
    [...workflow.matchAll(/^ {4}environment:\s*([^\s#]+)/gm)].map((match) => match[1]),
    ["npm-publish", "crates-publish"],
  );
});

test("release workflow has only the sentinel target and exact release-commit inputs", () => {
  const inputBlock = /workflow_dispatch:\n([\s\S]*?)\n\nconcurrency:/.exec(workflow)?.[1] ?? "";
  assert.match(inputBlock, /^ {6}target:\s*$/m);
  assert.match(inputBlock, /^ {10}- select-target\s*$/m);
  assert.match(inputBlock, /^ {10}- npm\s*$/m);
  assert.match(inputBlock, /^ {10}- crates\s*$/m);
  assert.match(inputBlock, /^ {6}release-commit:\s*$/m);
  assert.doesNotMatch(inputBlock, /^ {6}publish(?:-crates)?:/m);
  assert.equal((inputBlock.match(/^ {6}[a-z][a-z-]+:\s*$/gm) ?? []).length, 2);
});

test("dead Changesets route and broad write permissions are absent", () => {
  assert.doesNotMatch(workflow, /changesets\/action|changeset version|changeset tag/);
  assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:|pnpm -r publish|--no-git-checks/);
  assert.match(workflow, /concurrency:\n {2}group: release\n {2}cancel-in-progress: false/);
});

test("admission is environmentless and registry jobs have target-specific minimal authority", () => {
  const admission = / {2}admission:\n([\s\S]*?)(?=\n {2}npm-publish:)/.exec(workflow)?.[1] ?? "";
  const npm = / {2}npm-publish:\n([\s\S]*?)(?=\n {2}crates-publish:)/.exec(workflow)?.[1] ?? "";
  const crates = / {2}crates-publish:\n([\s\S]*)$/.exec(workflow)?.[1] ?? "";
  assert.doesNotMatch(admission, /^ {4}environment:/m);
  assert.match(admission, /permissions:\n {6}contents: read/);
  assert.match(npm, /^ {4}environment: npm-publish$/m);
  assert.match(crates, /^ {4}environment: crates-publish$/m);
  for (const registryJob of [npm, crates]) {
    assert.match(registryJob, /permissions:\n {6}contents: read\n {6}id-token: write/);
  }
});

test("every job checks out exact R and its trusted parent without persisted credentials", () => {
  const checkoutCount = (workflow.match(/uses: actions\/checkout@/g) ?? []).length;
  assert.equal(checkoutCount, 6);
  assert.equal((workflow.match(/ref: \$\{\{ inputs\.release-commit \}\}/g) ?? []).length, 3);
  assert.equal(
    (workflow.match(/ref: \$\{\{ steps\.trust-source\.outputs\.parent \}\}/g) ?? []).length,
    3,
  );
  assert.equal((workflow.match(/path: release-source/g) ?? []).length, 3);
  assert.equal((workflow.match(/path: trusted-source/g) ?? []).length, 3);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, checkoutCount);
  assert.equal((workflow.match(/fetch-depth: 0/g) ?? []).length, checkoutCount);
  assert.equal((workflow.match(/working-directory: release-source/g) ?? []).length, 6);
  assert.equal((workflow.match(/working-directory: trusted-source/g) ?? []).length, 3);
  assert.equal(
    (workflow.match(/pnpm install --frozen-lockfile --ignore-scripts/g) ?? []).length,
    3,
  );
  assert.equal((workflow.match(/--max-filesize 33554432/g) ?? []).length, 3);
  assert.equal((workflow.match(/sha512sum --check --strict/g) ?? []).length, 3);
  assert.equal((workflow.match(/--strip-components=1 --no-same-owner/g) ?? []).length, 3);
  assert.equal((workflow.match(/bin\/npm-cli\.js" "\$npm_cli_bin\/npm"/g) ?? []).length, 3);
  assert.equal((workflow.match(/>> "\$GITHUB_PATH"/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /npm install --global|npm install -g|npx|pnpm dlx/);
  assert.doesNotMatch(workflow, /^\s+cache:/m);
});

test("workflow resolves S in workflow-owned shell and executes only its trusted controller", () => {
  assert.equal((workflow.match(/id: trust-source/g) ?? []).length, 3);
  assert.equal(
    (workflow.match(/git merge-base --is-ancestor "\$RELEASE_COMMIT" "\$EVENT_COMMIT"/g) ?? [])
      .length,
    3,
  );
  assert.equal(
    (
      workflow.match(/RELEASE_REPOSITORY_ROOT: \$\{\{ github\.workspace \}\}\/release-source/g) ??
      []
    ).length,
    3,
  );
  assert.equal((workflow.match(/working-directory: trusted-source/g) ?? []).length, 3);
  assert.equal(
    (workflow.match(/run: node scripts\/release-runtime\/workflow-release\.mjs/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(
    workflow,
    /node trusted-source\/scripts\/release-runtime\/workflow-release\.mjs/,
  );
});

test("workflow uses one audited bundle and S-trusted admission/write commands", () => {
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.equal(
    (workflow.match(/actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/g) ?? [])
      .length,
    2,
  );
  assert.match(workflow, /node scripts\/release-runtime\/workflow-release\.mjs admission/);
  assert.match(workflow, /node scripts\/release-runtime\/workflow-release\.mjs npm/);
  assert.match(workflow, /node scripts\/release-runtime\/workflow-release\.mjs crates/);
  assert.equal((workflow.match(/--report-sha256 "\$REPORT_SHA256"/g) ?? []).length, 2);
  assert.equal(
    (workflow.match(/REPORT_SHA256: \$\{\{ needs\.admission\.outputs\.report-sha256 \}\}/g) ?? [])
      .length,
    2,
  );
  assert.match(
    workflow,
    /rust-lang\/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18/,
  );
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
});

test("every workflow job has a finite top-level deadline", () => {
  assert.equal((workflow.match(/^ {4}timeout-minutes: (?:30|60|120)$/gm) ?? []).length, 3);
});

test("all actions and release toolchains are immutable exact pins", () => {
  assert.deepEqual(validateWorkflowPins(workflow), {
    node: "22.14.0",
    npm: "11.19.0",
    pnpm: "10.29.3",
    rust: "1.97.0",
    wasmPack: "0.13.1",
  });
});
