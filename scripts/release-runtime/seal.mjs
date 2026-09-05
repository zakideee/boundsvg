import { execFileSync } from "node:child_process";
import { posix } from "node:path";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { failRelease } from "./errors.mjs";
import { readFlatGitTree } from "./git-tree.mjs";
import * as topology from "./topology.mjs";

const runtimePrefix = "scripts/release-runtime/";
const actionPinPattern = /^[a-f0-9]{40}$/;

function importedSpecifiers(source, path) {
  if (/\bimport\s*\(\s*(?!["'])/.test(source)) {
    failRelease("CONTROL_DYNAMIC_IMPORT", `${path} uses a nonliteral dynamic import`);
  }
  if (/\brequire\s*\(|\bcreateRequire\b/.test(source)) {
    failRelease("CONTROL_COMMONJS_IMPORT", `${path} uses an unsealed CommonJS import`);
  }
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

export function resolveJavaScriptImportClosure(entryPaths, readSource) {
  const pending = [...entryPaths];
  const visited = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) {
      continue;
    }
    const source = readSource(path);
    if (typeof source !== "string") {
      failRelease("CONTROL_IMPORT_MISSING", `release control module is missing: ${path}`);
    }
    visited.add(path);
    for (const specifier of importedSpecifiers(source, path)) {
      if (specifier.startsWith("node:")) {
        continue;
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        failRelease("CONTROL_IMPORT_EXTERNAL", `${path} imports external module ${specifier}`);
      }
      const importedPath = posix.normalize(posix.join(posix.dirname(path), specifier));
      if (path.startsWith(runtimePrefix) && !importedPath.startsWith(runtimePrefix)) {
        failRelease("CONTROL_IMPORT_BOUNDARY", `${path} imports outside release-runtime`);
      }
      pending.push(importedPath);
    }
  }
  return [...visited].sort();
}

function uniqueCapturedValues(workflow, pattern) {
  return [...new Set([...workflow.matchAll(pattern)].map((match) => match[1]))];
}

function oneExactPin(workflow, options) {
  const values = uniqueCapturedValues(workflow, options.pattern);
  if (values.length !== 1 || values[0] !== options.expected) {
    failRelease(
      "CONTROL_TOOL_PIN_MISMATCH",
      `${options.label} must be pinned to ${options.expected}`,
    );
  }
  return values[0];
}

export function validateWorkflowPins(workflow) {
  for (const match of workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)) {
    const reference = match[1];
    if (reference.startsWith("./")) {
      continue;
    }
    const separator = reference.lastIndexOf("@");
    if (separator < 1 || !actionPinPattern.test(reference.slice(separator + 1))) {
      failRelease(
        "CONTROL_ACTION_UNPINNED",
        `workflow action is not pinned by commit: ${reference}`,
      );
    }
  }
  oneExactPin(workflow, {
    expected:
      "48377f8478372aa1c4e47b763475b135836da82436a5700f2e5e8eb5084fc840f93c7b117eb3ad3b5f7d3194c81b6710a10d59448f6ddbcb21ac3fb672bdc003",
    label: "npm CLI archive SHA-512",
    pattern: /^\s*RELEASE_NPM_CLI_SHA512:\s*([^\s]+)\s*$/gm,
  });
  return {
    node: oneExactPin(workflow, {
      expected: "22.14.0",
      label: "Node",
      pattern: /^\s*node-version:\s*["']?([^\s"']+)["']?\s*$/gm,
    }),
    npm: oneExactPin(workflow, {
      expected: "11.19.0",
      label: "npm",
      pattern: /^\s*RELEASE_NPM_CLI_VERSION:\s*([^\s]+)\s*$/gm,
    }),
    pnpm: oneExactPin(workflow, {
      expected: "10.29.3",
      label: "pnpm",
      pattern: /^\s*version:\s*["']?([^\s"']+)["']?\s*$/gm,
    }),
    rust: oneExactPin(workflow, {
      expected: "1.97.0",
      label: "Rust",
      pattern: /^\s*toolchain:\s*["']?([^\s"']+)["']?\s*$/gm,
    }),
    wasmPack: oneExactPin(workflow, {
      expected: "0.13.1",
      label: "wasm-pack",
      pattern: /^\s*tool:\s*wasm-pack@([^\s]+)\s*$/gm,
    }),
  };
}

function git(repositoryRoot, arguments_, encoding = null) {
  try {
    return execFileSync("git", arguments_, {
      cwd: repositoryRoot,
      encoding,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease("CONTROL_SEAL_GIT_FAILED", `git ${arguments_.join(" ")} failed`, { cause: error });
  }
}

function commitText(repositoryRoot, commit, path) {
  return git(repositoryRoot, ["show", `${commit}:${path}`], "utf8");
}

function parseRootReleaseCommands(rootManifest) {
  const commands = {};
  for (const [name, command] of Object.entries(rootManifest.scripts ?? {})) {
    if (name.startsWith("release:") || name === "release") {
      commands[name] = command;
    }
  }
  return commands;
}

function scriptEntryPaths(commands, workflow) {
  const entries = new Set();
  for (const command of [...Object.values(commands), ...workflow.split("\n")]) {
    for (const match of String(command).matchAll(
      /\bnode\s+(?:trusted-source\/)?(scripts\/[A-Za-z0-9_./-]+\.mjs)\b/g,
    )) {
      entries.add(posix.normalize(match[1]));
    }
  }
  return [...entries];
}

function packageProjection(repositoryRoot, options) {
  const workspaceSource = commitText(repositoryRoot, options.commit, "pnpm-workspace.yaml");
  const patterns = topology.parsePnpmWorkspacePatterns(workspaceSource);
  const manifests = [];
  for (const path of options.flatTree.keys()) {
    if (
      !path.endsWith("/package.json") ||
      !patterns.some((pattern) => topology.pnpmPatternMatchesManifest(pattern, path))
    ) {
      continue;
    }
    manifests.push({ path, value: JSON.parse(commitText(repositoryRoot, options.commit, path)) });
  }
  return topology.projectNpmTopology(manifests, options.changesetConfig).publishSet;
}

function crateProjection(repositoryRoot, commit, rootCargoManifest) {
  return topology
    .projectCargoTopology(rootCargoManifest, (manifestPath) =>
      commitText(repositoryRoot, commit, manifestPath),
    )
    .filter(({ publish }) => publish)
    .map(({ name, path }) => ({ name, path }))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));
}

function workflowCommandMap(workflow) {
  const commands = [];
  let currentJob;
  let currentEnvironment;
  for (const line of workflow.split("\n")) {
    const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch !== null) {
      currentJob = jobMatch[1];
      currentEnvironment = undefined;
      continue;
    }
    const environmentMatch = /^ {4}environment:\s*([^\s#]+)\s*$/.exec(line);
    if (environmentMatch !== null) {
      currentEnvironment = environmentMatch[1];
    }
    const runMatch =
      /^\s+run:\s*(node (?:trusted-source\/)?scripts\/release-runtime\/[^\s]+.*)$/.exec(line);
    if (runMatch !== null) {
      commands.push({
        command: runMatch[1],
        environment: currentEnvironment ?? null,
        job: currentJob,
      });
    }
  }
  return commands;
}

export function buildControlSeal(repositoryRoot, commit) {
  const flatTree = readFlatGitTree(repositoryRoot, commit);
  const workflowPath = ".github/workflows/release.yml";
  const workflow = commitText(repositoryRoot, commit, workflowPath);
  const rootManifest = JSON.parse(commitText(repositoryRoot, commit, "package.json"));
  const changesetConfig = JSON.parse(commitText(repositoryRoot, commit, ".changeset/config.json"));
  const rootCargoManifest = commitText(repositoryRoot, commit, "Cargo.toml");
  const commands = parseRootReleaseCommands(rootManifest);
  const entryPaths = scriptEntryPaths(commands, workflow);
  const importClosure = resolveJavaScriptImportClosure(entryPaths, (path) => {
    if (!flatTree.has(path)) {
      return undefined;
    }
    return commitText(repositoryRoot, commit, path);
  });
  const sealedPaths = new Set([workflowPath, ...entryPaths, ...importClosure]);
  for (const path of flatTree.keys()) {
    if (path === ".npmrc" || path.endsWith("/.npmrc")) {
      sealedPaths.add(path);
    }
  }
  const files = [...sealedPaths].sort().map((path) => {
    const entry = flatTree.get(path);
    if (entry?.type !== "blob") {
      failRelease("CONTROL_SEAL_PATH_MISSING", `sealed path is missing or not a blob: ${path}`);
    }
    return {
      mode: entry.mode,
      path,
      sha256: sha256(commitText(repositoryRoot, commit, path)),
    };
  });
  const seal = {
    commands,
    files,
    packageManager: rootManifest.packageManager,
    pins: validateWorkflowPins(workflow),
    publishSet: {
      crates: crateProjection(repositoryRoot, commit, rootCargoManifest),
      npm: packageProjection(repositoryRoot, { changesetConfig, commit, flatTree }),
    },
    workflowCommands: workflowCommandMap(workflow),
  };
  return { ...seal, sha256: sha256(canonicalJson(seal)) };
}
