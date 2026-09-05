import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compareCanonicalStrings } from "./canonical.mjs";

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const rootManifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const continuousIntegration = readFileSync(
  join(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);
const changesetGuide = readFileSync(join(repositoryRoot, ".changeset/README.md"), "utf8");
const commandGuide = readFileSync(join(repositoryRoot, ".claude/commands/release.md"), "utf8");
const versioningGuide = readFileSync(
  join(repositoryRoot, "apps/docs/getting-started/versioning.md"),
  "utf8",
);
const preflight = readFileSync(join(repositoryRoot, "scripts/preflight-pr.mjs"), "utf8");
const coherenceCommand = readFileSync(
  join(repositoryRoot, "scripts/check-release-coherence.mjs"),
  "utf8",
);

const commandFragments = [
  "pnpm release:prepare -- preview --source <S> --npm-version <stable|current>",
  "pnpm release:prepare -- apply --plan <path> --plan-sha256 <64-lowercase-hex>",
  "pnpm release:prepare -- verify --plan <path> --plan-sha256 <64-lowercase-hex>",
  "pnpm release:verify --commit <R> --plan <path> --plan-sha256 <64-lowercase-hex>",
  "pnpm release:audit -- --phase <pre-npm|post-npm|pre-crates|post-crates|pre-tag>",
  "pnpm release:tag -- --release-commit <R>",
];

function normalizeDocumentCommands(document) {
  return document.replace(/\\\n\s*/g, " ").replace(/\s+/g, " ");
}

test("root scripts expose only the guarded release frontdoors", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(rootManifest.scripts)
        .filter(([name]) => name.startsWith("release:"))
        .sort(([left], [right]) => compareCanonicalStrings(left, right)),
    ),
    {
      "release:audit": "node scripts/release-runtime/audit-cli.mjs",
      "release:prepare": "node scripts/prepare-release.mjs",
      "release:tag": "node scripts/tag-release.mjs",
      "release:verify": "node scripts/prepare-release.mjs post-merge",
    },
  );
  assert.equal(rootManifest.scripts.changeset, "changeset");
  assert.equal(Object.hasOwn(rootManifest.scripts, "version"), false);
});

test("maintainer documentation and the tracked command adapter agree exactly", () => {
  for (const fragment of commandFragments) {
    assert.ok(changesetGuide.includes(fragment), `.changeset guide is missing ${fragment}`);
    assert.ok(commandGuide.includes(fragment), `command guide is missing ${fragment}`);
    assert.ok(versioningGuide.includes(fragment), `versioning guide is missing ${fragment}`);
  }
  for (const document of [changesetGuide, commandGuide, versioningGuide]) {
    const normalized = normalizeDocumentCommands(document);
    assert.ok(
      normalized.includes(
        "pnpm release:prepare -- preview --source <S> --npm-version <stable|current> --crate-version boundshape=<stable|current> --crate-version boundtext=<stable|current> --crate-version boundsvg=<stable|current> --output <path-outside-worktree>",
      ),
    );
    assert.ok(
      normalized.includes(
        "pnpm release:audit -- --phase <pre-npm|post-npm|pre-crates|post-crates|pre-tag> --release-commit <R> [--report <path>]",
      ),
    );
    assert.doesNotMatch(
      document,
      /changeset (?:tag|version)|release:sync|publish-crates=true|publish=true/,
    );
  }
});

test("Scene document guidance remains separate from the release narrative", () => {
  assert.match(
    versioningGuide,
    /A `version` property is not a\ncompatibility marker; the closed Scene schema rejects it/,
  );
  assert.match(versioningGuide, /The current WASM schema remains version 31\./);
  assert.ok(
    versioningGuide.indexOf("## Scene documents") <
      versioningGuide.indexOf("## Maintainer release flow"),
  );
});

test("the required lint-and-typecheck path owns release-control admission", () => {
  const lintJob =
    / {2}lint-and-typecheck:\n([\s\S]*?)(?=\n {2}test-ts:)/.exec(continuousIntegration)?.[1] ?? "";
  assert.match(lintJob, /^ {4}needs: changes$/m);
  assert.match(lintJob, /^ {4}if: always\(\)$/m);
  assert.match(lintJob, /CHANGE_RESULT: \$\{\{ needs\.changes\.result \}\}/);
  assert.match(lintJob, /pnpm preflight .*--checks-only --base "\$\{PREFLIGHT_BASE\}"/);
  assert.match(
    preflight,
    /\["pnpm", \["check:release-coherence", "--base", base\]\][\s\S]*release-control-tests/,
  );
  assert.match(preflight, /check:release-control/);
  assert.match(coherenceCommand, /cargo", \["check", "--workspace", "--locked"\]/);
});
