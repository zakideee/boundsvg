#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const full = args.includes("--full");
const all = full || args.includes("--all");
// CI's lint job passes --checks-only: static checks (biome, prettier,
// typecheck) stay, while cargo and package test suites are
// skipped because the test-rust / test-ts jobs run supersets of them.
const checksOnly = args.includes("--checks-only");
const base = readOption("--base") ?? process.env.PREFLIGHT_BASE ?? "origin/main";

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function runCapture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function run(command, commandArgs, options = {}) {
  const label = [command, ...commandArgs].join(" ");
  writeLine(`\n$ ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function writeLine(message = "") {
  process.stdout.write(`${message}\n`);
}

function splitLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles() {
  // --diff-filter=d: deleted paths must not reach per-file lint invocations —
  // biome and prettier fail on files that no longer exist.
  const committed = splitLines(
    runCapture("git", ["diff", "--name-only", "--diff-filter=d", `${base}...HEAD`]),
  );
  const staged = splitLines(
    runCapture("git", ["diff", "--cached", "--name-only", "--diff-filter=d"]),
  );
  const unstaged = splitLines(runCapture("git", ["diff", "--name-only", "--diff-filter=d"]));
  const untracked = splitLines(runCapture("git", ["ls-files", "--others", "--exclude-standard"]));
  const merged = [...new Set([...committed, ...staged, ...unstaged, ...untracked])].sort();
  // Symlinks must not reach per-file lint invocations either — prettier
  // hard-errors on an explicitly listed symbolic link. Their targets are
  // linted under their own paths.
  const symlinks = new Set(
    splitLines(runCapture("git", ["ls-files", "-s"]))
      .filter((line) => line.startsWith("120000 "))
      .map((line) => line.split("\t")[1]),
  );
  return merged.filter((file) => !symlinks.has(file));
}

const files = all ? [] : changedFiles();

function hasFile(predicate) {
  return all || files.some(predicate);
}

function hasExtension(extensions) {
  return hasFile((filePath) => extensions.some((extension) => filePath.endsWith(extension)));
}

function inPath(prefix) {
  return hasFile((filePath) => filePath.startsWith(prefix));
}

function isPath(filePath) {
  return hasFile((changedPath) => changedPath === filePath);
}

const tasks = [];

const STATIC_CHECK_IDS = new Set([
  "biome",
  "prettier",
  "typecheck-build-chain",
  "third-party-source-overrides",
]);

function addTask(id, reason, steps) {
  if (checksOnly && !STATIC_CHECK_IDS.has(id)) {
    return;
  }
  if (tasks.some((task) => task.id === id)) {
    return;
  }
  tasks.push({ id, reason, steps });
}

const jsLikeFiles = all
  ? []
  : files.filter((filePath) => /\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/.test(filePath));
const proseFiles = all ? [] : files.filter((filePath) => /\.(md|yml|yaml|html)$/.test(filePath));
const shapeBoundaryChanged =
  inPath("packages/shape/src/") ||
  isPath("packages/shape/package.json") ||
  isPath("packages/shape/tsconfig.json") ||
  isPath("packages/shape/tsup.config.ts");

addTask("third-party-source-overrides", "third-party source policy applies to every change", [
  ["pnpm", ["check:third-party-source-overrides"]],
]);

if (all) {
  addTask("biome", "full run requested", [["pnpm", ["exec", "biome", "check", "."]]]);
} else if (jsLikeFiles.length > 0) {
  addTask("biome", "TS/JS/JSON/CSS files changed", [
    ["pnpm", ["exec", "biome", "check", "--no-errors-on-unmatched", ...jsLikeFiles]],
  ]);
}

if (all) {
  addTask("prettier", "full run requested", [
    [
      "pnpm",
      [
        "exec",
        "prettier",
        "--check",
        "**/*.md",
        "**/*.yml",
        "**/*.yaml",
        "**/*.html",
        "--ignore-unknown",
      ],
    ],
  ]);
} else if (proseFiles.length > 0) {
  addTask("prettier", "Markdown/YAML/HTML files changed", [
    ["pnpm", ["exec", "prettier", "--check", "--ignore-unknown", ...proseFiles]],
  ]);
}

if (full) {
  addTask("wasm-builds", "full run requested", [
    ["pnpm", ["build:wasm"]],
    ["pnpm", ["build:wasm:web"]],
    ["pnpm", ["build:wasm:mp4"]],
  ]);
}

const packageBoundaryChanged =
  isPath("package.json") ||
  isPath("pnpm-lock.yaml") ||
  isPath("pnpm-workspace.yaml") ||
  isPath("tsconfig.check.json") ||
  inPath("packages/") ||
  inPath("crates/") ||
  isPath("Cargo.toml") ||
  isPath("Cargo.lock") ||
  isPath("rust-toolchain.toml") ||
  isPath("scripts/check-public-declarations.mjs") ||
  inPath("apps/playground-shared/");

if (packageBoundaryChanged) {
  addTask("typecheck-build-chain", "public TS package or workspace boundary changed", [
    ["pnpm", ["typecheck"]],
  ]);
}

if (inPath("packages/core/") || shapeBoundaryChanged) {
  addTask("core-tests", "core package or shape authoring boundary changed", [
    ["pnpm", ["--filter", "@boundsvg/core", "test"]],
  ]);
}

if (inPath("packages/browser/")) {
  addTask("browser-tests", "browser package changed", [
    ["pnpm", ["--filter", "@boundsvg/browser", "test"]],
  ]);
}

if (inPath("packages/worker/")) {
  addTask("worker-tests", "worker package changed", [
    ["pnpm", ["--filter", "@boundsvg/worker", "test"]],
  ]);
}

if (inPath("crates/boundmp4/")) {
  addTask("boundmp4-tests", "mp4 muxer crate changed", [["cargo", ["test", "-p", "boundmp4"]]]);
}

if (inPath("packages/video/") || inPath("crates/boundmp4/")) {
  // The video tests load the muxer wasm, so a crate change has to be rebuilt
  // first or they assert against the previous binary.
  addTask("video-tests", "video package or mp4 muxer changed", [
    ["pnpm", ["build:wasm:mp4"]],
    ["pnpm", ["--filter", "@boundsvg/video", "test"]],
  ]);
}

if (inPath("packages/react/")) {
  addTask("react-tests", "react package changed", [
    ["pnpm", ["--filter", "@boundsvg/react", "test"]],
  ]);
}

if (inPath("packages/cli/")) {
  addTask("cli-tests", "cli package changed", [["pnpm", ["--filter", "@boundsvg/cli", "test"]]]);
}

if (inPath("packages/extras/")) {
  addTask("extras-tests", "extras package changed", [
    ["pnpm", ["--filter", "@boundsvg/extras", "test"]],
  ]);
}

if (inPath("apps/playground-react/")) {
  addTask("playground-react-tests", "playground React changed", [
    ["pnpm", ["--filter", "@boundsvg/playground-react", "test"]],
  ]);
}

if (inPath("packages/shape/")) {
  addTask("shape-build-and-tests", "shape package changed", [
    ["pnpm", ["--filter", "@boundsvg/shape", "build"]],
    ["pnpm", ["--filter", "@boundsvg/shape", "test"]],
  ]);
}

const rustChanged =
  isPath("Cargo.toml") ||
  isPath("Cargo.lock") ||
  hasExtension([".rs"]) ||
  hasFile((filePath) => filePath.endsWith("/Cargo.toml") || filePath.endsWith("/Cargo.lock"));

if (rustChanged) {
  addTask("rustfmt", "Rust files or Cargo metadata changed", [
    ["cargo", ["fmt", "--all", "--check"], { cwd: "crates/boundsvg" }],
  ]);
}

if (inPath("crates/boundshape/")) {
  addTask("boundshape-tests", "boundshape changed", [
    ["cargo", ["test", "-p", "boundshape"], { cwd: "crates/boundsvg" }],
  ]);
}

if (inPath("crates/boundtext/")) {
  addTask("boundtext-tests", "boundtext changed", [
    ["cargo", ["test", "-p", "boundtext"], { cwd: "crates/boundsvg" }],
  ]);
}

const boundsvgRustBoundaryChanged =
  rustChanged &&
  (all ||
    inPath("crates/boundsvg/") ||
    inPath("crates/boundtext/") ||
    inPath("crates/boundtext-cli/") ||
    isPath("Cargo.toml") ||
    isPath("Cargo.lock"));

if (boundsvgRustBoundaryChanged) {
  addTask("boundsvg-export-contracts", "boundsvg/boundtext Rust boundary changed", [
    ["cargo", ["test", "--workspace", "--test", "lib_exports_test"], { cwd: "crates/boundsvg" }],
    [
      "cargo",
      ["test", "-p", "boundsvg", "--test", "lib_exports_test", "--features", "unicode-full"],
      { cwd: "crates/boundsvg" },
    ],
  ]);
}

if (inPath("crates/boundsvg/")) {
  addTask("boundsvg-instance-tests", "boundsvg engine tests changed", [
    ["cargo", ["test", "-p", "boundsvg", "--test", "instance_test"], { cwd: "crates/boundsvg" }],
  ]);
}

if (full) {
  addTask("rust-clippy", "full run requested", [
    [
      "cargo",
      ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
      { cwd: "crates/boundsvg" },
    ],
  ]);
}

if (tasks.length === 0) {
  writeLine(`preflight: no matching tasks for changes against ${base}`);
  process.exit(0);
}

writeLine(`preflight: base=${base}`);
if (!all) {
  writeLine(`preflight: ${files.length} changed file(s) considered`);
}

for (const task of tasks) {
  writeLine(`\n== ${task.id} ==`);
  writeLine(task.reason);
  for (const [command, commandArgs, options] of task.steps) {
    run(command, commandArgs, options);
  }
}

writeLine("\npreflight: passed");
