import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkDocumentLinks, collectAnchors, extractLinks } from "./check-ci-doc-links.mjs";

test("extract inline, reference, image and HTML destinations without code examples", () => {
  const markdown =
    '# Title\n[inline](guide.md "title") ![image](image.svg) [reference][id] [id][] [id]\n[id]: guide.md#heading\n<a href="guide.md?a=1&amp;b=2">link</a> <img src=picture.png>\n`[ignored](missing)`\n```md\n[ignored](missing)\n```\n';
  const links = extractLinks(markdown).map((link) => link.destination);
  assert.deepEqual(links, [
    "guide.md?a=1&b=2",
    "picture.png",
    "guide.md",
    "image.svg",
    "guide.md#heading",
    "guide.md#heading",
    "guide.md#heading",
  ]);
  assert.deepEqual(
    extractLinks("[nested [label]](dir/with(parentheses).md)").map((link) => link.destination),
    ["dir/with(parentheses).md"],
  );
  assert.throws(() => extractLinks("[missing][id]"), /Undefined/);
  assert.throws(() => extractLinks("[label](unterminated"), /Unterminated/);
  assert.throws(() => extractLinks("[label](two words)"), /Unrecognized/);
});

test("heading fragments include duplicates, inline formatting, and explicit anchors", () => {
  assert.deepEqual(
    [
      ...collectAnchors(
        '# Same\n## Same\n## Same-1\n## `Code` **title**\nTitle\n=====\n## 日本語\n<a id="explicit"></a>\n```\n# Ignored\n```',
      ),
    ],
    ["same", "same-1", "same-1-1", "code-title", "title", "日本語", "explicit"],
  );
});

test("syntax diagnostics preserve source lines across multiline literals", () => {
  const prefix = "# Guide\n`code\nexample`\n<!-- comment\ncontinued -->\n";
  for (const [source, error] of [
    ["[label](unterminated", /line 6: Unterminated/],
    ["[missing][id]", /line 6: Undefined/],
    ["[label](two words)", /line 6: Unrecognized/],
    ["[id]: two words", /line 6: Unrecognized/],
  ]) {
    assert.throws(() => extractLinks(prefix + source), error);
  }
  assert.deepEqual(extractLinks(`${prefix}[link](guide.md)`), [
    { destination: "guide.md", line: 6 },
  ]);
});

function fixture(context, readme) {
  const root = mkdtempSync(join(tmpdir(), "doc-links-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "README.md"), readme);
  writeFileSync(join(root, "CONTRIBUTING.md"), "# Contributing\n");
  writeFileSync(join(root, "docs", "a space.md"), "# Heading\n## Heading\n");
  writeFileSync(join(root, "image.svg"), '<svg id="drawing"/>');
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  return root;
}

test("tracked local paths and Markdown fragments pass; external destinations are reported separately", (context) => {
  const root = fixture(
    context,
    "# Title\n[local](docs/a%20space.md#heading-1) [self](#title)\n[external](https://example.invalid/) ![drawing](image.svg#drawing)\n",
  );
  const report = checkDocumentLinks(root);
  assert.deepEqual(report.errors, []);
  assert.equal(report.checked.length, 3);
  assert.deepEqual(
    report.notChecked.map((link) => link.reason),
    ["external", "non-Markdown fragment"],
  );
});

test("missing, untracked, outside, invalid and unsupported destinations fail", (context) => {
  const root = fixture(
    context,
    "[missing](missing.md) [untracked](new.md) [escape](../outside) [anchor](docs/a%20space.md#missing) [scheme](javascript:alert) [bad](%GG)",
  );
  writeFileSync(join(root, "new.md"), "# Untracked\n");
  assert.equal(checkDocumentLinks(root).errors.length, 6);
  symlinkSync(tmpdir(), join(root, "outside"));
  assert.equal(spawnSync("git", ["add", "outside"], { cwd: root }).status, 0);
  writeFileSync(join(root, "README.md"), "[outside](outside)\n");
  assert.match(checkDocumentLinks(root).errors[0], /symlink outside/);
});

test("malformed links report both the document and source line", (context) => {
  const root = fixture(context, "# Guide\n\n[missing][id]\n");
  assert.deepEqual(checkDocumentLinks(root).errors, [
    "README.md: line 3: Undefined Markdown reference: id",
  ]);
});
