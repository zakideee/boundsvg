import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  auditCrateRegistryArtifact,
  auditNpmRegistryArtifact,
  buildReleaseOutputs,
  packageCrateArtifacts,
  packNpmArtifacts,
  publicCargoDependencyMap,
  validateCarriedSource,
} from "./artifacts.mjs";
import { canonicalJson } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs, releaseWorkCommandTimeoutMs } from "./command-limits.mjs";
import { validateReleaseDelta } from "./delta.mjs";
import { failRelease } from "./errors.mjs";
import { commitTreeId, readFlatGitTree } from "./git-tree.mjs";
import {
  assertChangesetPrediction,
  deriveFixedGroupChangesetTarget,
  materializeCargoManifest,
  materializeNpmManifest,
} from "./materialize.mjs";
import { createReleasePlan } from "./plan.mjs";
import { classifyStableTarget } from "./registry.mjs";
import { readCrateRegistryProjection, readNpmRegistryState } from "./remote.mjs";
import { canonicalRepository, loadRepositoryState } from "./repository.mjs";
import { readAndValidateGitHubReleaseSettings } from "./settings.mjs";

function isInside(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..");
}

export function validatePlanOutputPath(outputPath, repositoryRoot, gitDirectory) {
  if (typeof outputPath !== "string" || outputPath.length === 0 || outputPath.includes("\0")) {
    failRelease("PREVIEW_OUTPUT_INVALID", "plan output path is invalid");
  }
  const absoluteOutput = resolve(outputPath);
  if (existsSync(absoluteOutput)) {
    failRelease("PREVIEW_OUTPUT_EXISTS", "plan output path already exists");
  }
  let canonicalParent;
  try {
    canonicalParent = realpathSync(dirname(absoluteOutput));
  } catch (error) {
    failRelease("PREVIEW_OUTPUT_PARENT_INVALID", "plan output parent must already exist", {
      cause: error,
    });
  }
  const canonicalOutput = join(canonicalParent, basename(absoluteOutput));
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const canonicalGitDirectory = realpathSync(gitDirectory);
  if (
    isInside(canonicalRepositoryRoot, canonicalOutput) ||
    isInside(canonicalGitDirectory, canonicalOutput)
  ) {
    failRelease(
      "PREVIEW_OUTPUT_INSIDE_REPOSITORY",
      "plan output must be outside the worktree and Git directory",
    );
  }
  return canonicalOutput;
}

function registryStateFor(registryMap, name, ecosystem) {
  const state = registryMap.get(name);
  if (state === undefined) {
    failRelease("PREVIEW_REGISTRY_SET", `${ecosystem} registry result is missing ${name}`);
  }
  return state;
}

function stateKind(registryState) {
  return registryState.state === "missing-package" ? "known" : registryState.state;
}

export function validatePreviewTargets(options) {
  const expectedCrateNames = options.state.cargo.crates.map(({ name }) => name).sort();
  const suppliedCrateNames = [...options.crateTargetInputs.keys()].sort();
  if (expectedCrateNames.join("\0") !== suppliedCrateNames.join("\0")) {
    failRelease(
      "PREVIEW_CRATE_TARGET_SET",
      "crate target inputs must exactly equal the dynamically derived public crate set",
    );
  }

  const npmArtifactTargets = [];
  for (const packageName of options.state.npm.fixedNames) {
    const registryState = registryStateFor(options.registry.npm, packageName, "npm");
    npmArtifactTargets.push({
      name: packageName,
      ...classifyStableTarget({
        carried: registryState.records.has(options.state.npm.currentVersion),
        current: options.state.npm.currentVersion,
        deprecated: registryState.deprecated,
        state: stateKind(registryState),
        target: options.npmTargetInput,
        versions: registryState.versions,
      }),
    });
  }
  const npmTarget = npmArtifactTargets[0];
  if (
    npmTarget === undefined ||
    npmArtifactTargets.some(
      ({ advances, target }) => advances !== npmTarget.advances || target !== npmTarget.target,
    )
  ) {
    failRelease("PREVIEW_NPM_TARGET_INCONSISTENT", "fixed npm targets are inconsistent");
  }
  const changesetTarget = deriveFixedGroupChangesetTarget(
    options.state.inputs.changesets,
    new Set(options.state.npm.fixedNames),
    options.state.npm.currentVersion,
  );
  if (
    npmTarget.advances !== changesetTarget.advances ||
    npmTarget.target !== changesetTarget.target
  ) {
    failRelease(
      "CHANGESET_TARGET_MISMATCH",
      "explicit npm target does not equal the Changeset-derived fixed-group target",
    );
  }

  const crateTargets = new Map();
  for (const cargoPackage of options.state.cargo.crates) {
    const registryState = registryStateFor(options.registry.crates, cargoPackage.name, "crates");
    const target = classifyStableTarget({
      carried: registryState.records.has(cargoPackage.version),
      current: cargoPackage.version,
      state: stateKind(registryState),
      target: options.crateTargetInputs.get(cargoPackage.name),
      versions: registryState.versions,
      yanked: registryState.yanked,
    });
    crateTargets.set(cargoPackage.name, target);
  }
  for (const marker of options.state.cargo.markers) {
    const target = crateTargets.get(marker.crateName);
    if (!target?.advances || target.target !== marker.pendingVersion) {
      failRelease(
        "PREVIEW_MARKER_TARGET",
        `${marker.crateName} target does not exactly satisfy its pending marker`,
      );
    }
  }
  if (!npmTarget.advances && ![...crateTargets.values()].some(({ advances }) => advances)) {
    failRelease("PREVIEW_NO_ADVANCE", "at least one npm or Cargo target must advance");
  }
  return {
    crates: crateTargets,
    npm: {
      advances: npmTarget.advances,
      artifacts: npmArtifactTargets,
      current: options.state.npm.currentVersion,
      target: npmTarget.target,
    },
  };
}

export function run(repositoryRoot, invocation, options = {}) {
  const [commandName, ...commandArguments] = invocation;
  let stdout;
  try {
    stdout = execFileSync(commandName, commandArguments, {
      cwd: options.cwd ?? repositoryRoot,
      encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
      env: options.env ?? process.env,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseWorkCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease(options.errorCode ?? "PREVIEW_COMMAND_FAILED", `${commandName} failed`, {
      cause: error,
      exitCode: error?.status ?? 1,
    });
  }
  if (options.commandLog !== undefined) {
    options.commandLog.push({
      argv: [
        commandName,
        ...commandArguments.map((argument) => options.redact?.(argument) ?? argument),
      ],
      cwd: options.cwdLabel ?? ".",
      exitCode: 0,
    });
  }
  return stdout;
}

function normalizeRemoteUrl(remote) {
  return remote
    .trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function assertPreviewSource(repositoryRoot, sourceCommit) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    failRelease("PREVIEW_SOURCE_INVALID", "S must be 40 lowercase hex");
  }
  if (
    normalizeRemoteUrl(run(repositoryRoot, ["git", "remote", "get-url", "origin"])) !==
    `https://github.com/${canonicalRepository}`
  ) {
    failRelease("PREVIEW_REMOTE_MISMATCH", "origin is not the canonical repository");
  }
  if (
    run(repositoryRoot, ["git", "status", "--porcelain=v2", "-z"], {
      encoding: null,
    }).length !== 0
  ) {
    failRelease(
      "PREVIEW_WORKTREE_DIRTY",
      "preview requires a clean tracked and untracked worktree",
    );
  }
  run(repositoryRoot, ["git", "fetch", "--no-tags", "--prune", "origin", "main"], {
    errorCode: "PREVIEW_FETCH_FAILED",
  });
  const head = run(repositoryRoot, ["git", "rev-parse", "HEAD"]).trim();
  const main = run(repositoryRoot, ["git", "rev-parse", "origin/main"]).trim();
  if (head !== sourceCommit || main !== sourceCommit) {
    failRelease("PREVIEW_SOURCE_STALE", "S must equal clean HEAD and fresh origin/main");
  }
  return {
    gitDirectory: run(repositoryRoot, ["git", "rev-parse", "--absolute-git-dir"]).trim(),
    sourceTree: commitTreeId(repositoryRoot, sourceCommit),
  };
}

async function readPreviewRegistry(state, options = {}) {
  const npmEntries = await Promise.all(
    state.npm.fixedNames.map(async (name) => [
      name,
      await readNpmRegistryState(name, { fetch: options.fetch, signal: options.signal }),
    ]),
  );
  const crateEntries = await Promise.all(
    state.cargo.crates.map(async ({ name }) => [
      name,
      await readCrateRegistryProjection(name, {
        fetch: options.fetch,
        signal: options.signal,
      }),
    ]),
  );
  return { crates: new Map(crateEntries), npm: new Map(npmEntries) };
}

function updateNpmPeers(worktree, npmModel, targetVersion) {
  const fixedNames = new Set(npmModel.fixedNames);
  for (const npmPackage of npmModel.packages) {
    const materialized = materializeNpmManifest(npmPackage.manifest, fixedNames, targetVersion);
    if (canonicalJson(materialized) !== canonicalJson(npmPackage.manifest)) {
      writeFileSync(join(worktree, npmPackage.path), `${JSON.stringify(materialized, null, 2)}\n`);
    }
  }
}

function materializeCargo(worktree, cargoModel, targets) {
  for (const cargoPackage of cargoModel.crates) {
    const manifestPath = join(worktree, cargoPackage.manifestPath);
    const before = readFileSync(manifestPath, "utf8");
    const after = materializeCargoManifest(before, {
      crateName: cargoPackage.name,
      publicTargets: targets,
    });
    if (after !== before) {
      writeFileSync(manifestPath, after);
    }
  }
}

function runFormatFixpoint(worktree, npmModel, commandLog) {
  const manifestPaths = npmModel.packages.map(({ path }) => path);
  const argumentList = [
    "exec",
    "biome",
    "check",
    "--write",
    "--no-errors-on-unmatched",
    ...manifestPaths,
  ];
  run(worktree, ["pnpm", ...argumentList], { commandLog });
  const firstPass = new Map(
    manifestPaths.map((path) => [path, readFileSync(join(worktree, path))]),
  );
  run(worktree, ["pnpm", ...argumentList], { commandLog });
  if (
    manifestPaths.some((path) => !firstPass.get(path).equals(readFileSync(join(worktree, path))))
  ) {
    failRelease(
      "PREVIEW_FORMATTER_NOT_IDEMPOTENT",
      "repository formatter did not reach a fixpoint",
    );
  }
}

function workingFileState(worktree, path) {
  const absolutePath = join(worktree, path);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  const stats = lstatSync(absolutePath);
  if (!stats.isFile()) {
    failRelease("PREVIEW_FILE_TYPE_INVALID", `${path} is not a regular file`);
  }
  return {
    bytes: readFileSync(absolutePath),
    mode: (stats.mode & 0o111) === 0 ? "100644" : "100755",
  };
}

function sourceFileState(repositoryRoot, path, options) {
  const treeEntry = options.flatTree.get(path);
  if (treeEntry === undefined) {
    return undefined;
  }
  if (treeEntry.type !== "blob" || !["100644", "100755"].includes(treeEntry.mode)) {
    failRelease("PREVIEW_FILE_TYPE_INVALID", `${path} has an unsupported source type`);
  }
  return {
    bytes: run(repositoryRoot, ["git", "show", `${options.sourceCommit}:${path}`], {
      encoding: null,
    }),
    mode: treeEntry.mode,
  };
}

function changedWorkingPaths(worktree) {
  const untracked = run(worktree, ["git", "ls-files", "--others", "--exclude-standard", "-z"], {
    encoding: null,
  });
  if (untracked.length !== 0) {
    failRelease("PREVIEW_UNTRACKED_OUTPUT", "materialization created an untracked worktree path");
  }
  return run(worktree, ["git", "diff", "--name-only", "-z", "HEAD"], {
    encoding: null,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function captureProspectiveState(repositoryRoot, worktree, options) {
  const flatTree = readFlatGitTree(repositoryRoot, options.sourceCommit);
  const changedPaths = changedWorkingPaths(worktree);
  const relevantPaths = new Set(changedPaths);
  relevantPaths.add("Cargo.lock");
  for (const npmPackage of options.beforeState.npm.packages) {
    relevantPaths.add(npmPackage.path);
    relevantPaths.add(`${npmPackage.path.slice(0, -"package.json".length)}CHANGELOG.md`);
  }
  for (const cargoPackage of options.beforeState.cargo.crates) {
    relevantPaths.add(cargoPackage.manifestPath);
  }
  for (const path of flatTree.keys()) {
    if (path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md") {
      relevantPaths.add(path);
    }
  }
  const baseFiles = new Map();
  const headFiles = new Map();
  for (const path of [...relevantPaths].sort()) {
    const before = sourceFileState(repositoryRoot, path, {
      flatTree,
      sourceCommit: options.sourceCommit,
    });
    const after = workingFileState(worktree, path);
    if (before !== undefined) {
      baseFiles.set(path, before);
    }
    if (after !== undefined) {
      headFiles.set(path, after);
    }
  }
  const delta = validateReleaseDelta({
    baseFiles,
    cargoPackages: options.beforeState.cargo.crates.map(({ manifestPath, name }) => ({
      manifestPath,
      name,
    })),
    headFiles,
    npmPackages: options.beforeState.npm.packages.map(({ name, path }) => ({
      changelogPath: `${path.slice(0, -"package.json".length)}CHANGELOG.md`,
      manifestPath: path,
      name,
    })),
    patchNames: options.afterState.patchNames,
    workspaceNames: new Set(options.afterState.cargoPackages.map(({ name }) => name)),
  });
  if (delta.phase !== "materialized") {
    failRelease("PREVIEW_NOT_MATERIALIZED", "preview did not produce a materialized version tree");
  }
  return {
    delta,
    files: changedPaths.map((path) => ({
      after: headFiles.get(path),
      before: baseFiles.get(path),
      path,
    })),
  };
}

function isGitAncestor(repositoryRoot, ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: repositoryRoot,
    stdio: "ignore",
    timeout: releaseReadCommandTimeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  failRelease("PREVIEW_ANCESTRY_UNKNOWN", "Git ancestry could not be determined");
}

async function auditProspectiveArtifacts(options) {
  const npmArtifacts = new Map(options.npmArtifacts.map((artifact) => [artifact.name, artifact]));
  const crateArtifacts = new Map(
    options.crateArtifacts.map((artifact) => [artifact.name, artifact]),
  );
  const npmPackages = new Map(
    options.afterState.npm.packages.map((npmPackage) => [npmPackage.name, npmPackage]),
  );
  const fixedPackageNames = new Set(options.afterState.npm.fixedNames);
  const expectedPublicVersions = new Map(
    options.afterState.cargo.crates.map(({ name, version }) => [name, version]),
  );
  const expectedPublicDependencies = publicCargoDependencyMap(options.afterState.cargo.crates);
  const npmReport = [];
  for (const packageName of options.afterState.npm.fixedNames) {
    const target = options.targets.npm.artifacts.find(({ name }) => name === packageName);
    const localArtifact = npmArtifacts.get(packageName);
    const report = {
      canonicalSha256: localArtifact.canonicalSha256,
      name: packageName,
      state: target.advances ? "advance" : "carried",
      version: localArtifact.version,
    };
    if (!target.advances) {
      const audit = await auditNpmRegistryArtifact({
        fetch: options.fetch,
        fixedPackageNames,
        localArtifact,
        registryState: options.registry.npm.get(packageName),
        sourceManifest: npmPackages.get(packageName).manifest,
      });
      validateCarriedSource({
        isAncestor: (ancestor, descendant) =>
          isGitAncestor(options.repositoryRoot, ancestor, descendant),
        provenanceCommit: audit.provenance.releaseCommit,
        releaseCommit: options.sourceCommit,
        repository: canonicalRepository,
      });
      report.provenanceCommit = audit.provenance.releaseCommit;
    }
    npmReport.push(report);
  }
  const crateReport = [];
  for (const cargoPackage of options.afterState.cargo.crates) {
    const target = options.targets.crates.get(cargoPackage.name);
    const localArtifact = crateArtifacts.get(cargoPackage.name);
    const report = {
      canonicalSha256: localArtifact.canonicalSha256,
      name: cargoPackage.name,
      state: target.advances ? "advance" : "carried",
      version: cargoPackage.version,
    };
    if (!target.advances) {
      const audit = await auditCrateRegistryArtifact({
        expectedPath: dirname(cargoPackage.manifestPath),
        expectedPublicDependencies,
        expectedPublicVersions,
        fetch: options.fetch,
        localArtifact,
        registryState: options.registry.crates.get(cargoPackage.name),
        sourceManifest: readFileSync(
          join(options.afterState.repositoryRoot, cargoPackage.manifestPath),
        ),
      });
      validateCarriedSource({
        isAncestor: (ancestor, descendant) =>
          isGitAncestor(options.repositoryRoot, ancestor, descendant),
        provenanceCommit: audit.provenanceCommit,
        releaseCommit: options.sourceCommit,
        repository: canonicalRepository,
      });
      report.provenanceCommit = audit.provenanceCommit;
    }
    crateReport.push(report);
  }
  return { crates: crateReport, npm: npmReport };
}

function parseVersionOutput(output, command) {
  const match = /^(?:v)?([^\s]+)/.exec(output.trim());
  if (match === null) {
    failRelease("PREVIEW_TOOL_VERSION_INVALID", `${command} did not report a version`);
  }
  return match[1];
}

function readAndValidateToolVersions(worktree, commandLog) {
  const versions = {
    biome: parseVersionOutput(
      run(worktree, ["pnpm", "exec", "biome", "--version"], { commandLog }),
      "biome",
    ),
    node: process.version.replace(/^v/, ""),
    npm: parseVersionOutput(run(worktree, ["npm", "--version"], { commandLog }), "npm"),
    pnpm: parseVersionOutput(run(worktree, ["pnpm", "--version"], { commandLog }), "pnpm"),
    prettier: parseVersionOutput(
      run(worktree, ["pnpm", "exec", "prettier", "--version"], {
        commandLog,
      }),
      "prettier",
    ),
    rustc: parseVersionOutput(
      run(worktree, ["rustc", "--version"], { commandLog }).replace(/^rustc\s+/, ""),
      "rustc",
    ),
    wasmPack: parseVersionOutput(
      run(worktree, ["wasm-pack", "--version"], { commandLog }).replace(/^wasm-pack\s+/, ""),
      "wasm-pack",
    ),
  };
  const expected = {
    biome: "2.4.2",
    node: "22.14.0",
    npm: "11.19.0",
    pnpm: "10.29.3",
    prettier: "3.8.1",
    rustc: "1.97.0",
    wasmPack: "0.13.1",
  };
  if (canonicalJson(versions) !== canonicalJson(expected)) {
    failRelease("PREVIEW_TOOLCHAIN_MISMATCH", "preview toolchain does not match release pins");
  }
  return versions;
}

export async function previewRelease(repositoryRoot, arguments_, options = {}) {
  const source = assertPreviewSource(repositoryRoot, arguments_.source);
  const outputPath = validatePlanOutputPath(arguments_.output, repositoryRoot, source.gitDirectory);
  const beforeState = loadRepositoryState(repositoryRoot);
  const registry = await (options.readRegistry ?? readPreviewRegistry)(beforeState, options);
  const targets = validatePreviewTargets({
    crateTargetInputs: arguments_.crateVersions,
    npmTargetInput: arguments_.npmVersion,
    registry,
    state: beforeState,
  });
  (options.validateSettings ?? readAndValidateGitHubReleaseSettings)();

  const temporaryRoot = mkdtempSync(join(tmpdir(), "boundsvg-release-preview-"));
  const worktree = join(temporaryRoot, "worktree");
  const artifactDirectory = join(temporaryRoot, "artifacts");
  const statusPath = join(temporaryRoot, "changeset-status.json");
  const commandLog = [];
  try {
    run(repositoryRoot, ["git", "worktree", "add", "--detach", worktree, arguments_.source], {
      errorCode: "PREVIEW_WORKTREE_FAILED",
    });
    run(worktree, ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], {
      commandLog,
    });
    const tools = readAndValidateToolVersions(worktree, commandLog);
    updateNpmPeers(worktree, beforeState.npm, targets.npm.target);
    run(worktree, ["pnpm", "changeset", "status", "--output", statusPath], {
      commandLog,
      redact(argument) {
        return argument === statusPath ? "$CHANGESET_STATUS" : argument;
      },
    });
    assertChangesetPrediction(JSON.parse(readFileSync(statusPath, "utf8")), {
      advances: targets.npm.advances,
      fixedNames: new Set(beforeState.npm.fixedNames),
      targetVersion: targets.npm.target,
    });
    run(worktree, ["pnpm", "changeset", "version"], { commandLog });
    materializeCargo(
      worktree,
      beforeState.cargo,
      new Map([...targets.crates].map(([name, target]) => [name, target.target])),
    );
    run(worktree, ["cargo", "check", "--workspace"], { commandLog });
    runFormatFixpoint(worktree, beforeState.npm, commandLog);
    run(worktree, ["cargo", "check", "--workspace", "--locked"], {
      commandLog,
      errorCode: "PREVIEW_LOCK_STALE",
    });
    const afterState = loadRepositoryState(worktree);
    const prospective = captureProspectiveState(repositoryRoot, worktree, {
      afterState,
      beforeState,
      sourceCommit: arguments_.source,
    });
    const beforeBuildDiff = run(worktree, ["git", "diff", "--binary", "HEAD"], {
      encoding: null,
    });
    buildReleaseOutputs(worktree, commandLog);
    const npmArtifacts = packNpmArtifacts({
      commandLog,
      npmModel: afterState.npm,
      outputDirectory: join(artifactDirectory, "npm"),
      repositoryRoot: worktree,
    });
    const crateArtifacts = packageCrateArtifacts({
      allowDirty: true,
      cargoModel: afterState.cargo,
      commandLog,
      outputDirectory: join(artifactDirectory, "crates"),
      releaseCommit: arguments_.source,
      repositoryRoot: worktree,
    });
    const afterBuildDiff = run(worktree, ["git", "diff", "--binary", "HEAD"], {
      encoding: null,
    });
    if (!beforeBuildDiff.equals(afterBuildDiff)) {
      failRelease(
        "PREVIEW_BUILD_MUTATED_SOURCE",
        "release build changed tracked prospective bytes",
      );
    }
    const artifactReport = await auditProspectiveArtifacts({
      afterState,
      crateArtifacts,
      fetch: options.fetch,
      npmArtifacts,
      registry,
      repositoryRoot,
      sourceCommit: arguments_.source,
      targets,
    });
    const releasePlan = createReleasePlan({
      commands: commandLog,
      files: prospective.files,
      graphs: {
        cargoPublishOrder: afterState.cargo.publishOrder,
        npmPublishOrder: afterState.npm.publishOrder,
      },
      inputs: [...beforeState.inputs.changesets, ...beforeState.inputs.markers].map(
        ({ path, sha256: inputSha256 }) => ({ path, sha256: inputSha256 }),
      ),
      repository: canonicalRepository,
      repositoryRoot,
      semantic: { artifacts: artifactReport, delta: prospective.delta, settings: "verified" },
      sourceCommit: arguments_.source,
      sourceTree: source.sourceTree,
      targets: {
        crates: Object.fromEntries(
          [...targets.crates].map(([name, target]) => [name, target.target]),
        ),
        npm: targets.npm.target,
      },
      tools,
    });
    writeFileSync(outputPath, releasePlan.bytes, { flag: "wx", mode: 0o600 });
    return {
      output: outputPath,
      planSha256: releasePlan.sha256,
      prospectiveTree: releasePlan.plan.prospectiveTree,
    };
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", worktree], {
      cwd: repositoryRoot,
      stdio: "ignore",
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}
