import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  assertApprovalProjectionNarrowing,
  validateDispatchContext,
  validateRegistryTransition,
  validateTrainIdentity,
  verifyControlSeal,
} from "./admission.mjs";
import { admissionReportSchema, validateAdmissionReport } from "./admission-report.mjs";
import { inspectCrateArchive, readTarEntries } from "./archive.mjs";
import {
  auditCrateRegistryArtifact,
  auditDocsBuild,
  auditNpmRegistryArtifact,
  buildReleaseOutputs,
  packageCrateArtifacts,
  packNpmArtifacts,
  publicCargoDependencyMap,
  validateCarriedSource,
} from "./artifacts.mjs";
import { canonicalJson, canonicalJsonBytes, sha256 } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs, releaseWorkCommandTimeoutMs } from "./command-limits.mjs";
import { validateReleaseDelta } from "./delta.mjs";
import { asReleaseControlError, failRelease, ReleaseControlError } from "./errors.mjs";
import { readVersionFileMaps, resolveCommit, verifyRepositoryDelta } from "./git-files.mjs";
import {
  classifyRegistryMode,
  classifyStableTarget,
  crateIndexPolicy,
  docsBuildPolicy,
  npmAvailabilityPolicy,
  pollRegistry,
  validateCrateWriteLease,
  validateNpmEventLease,
} from "./registry.mjs";
import {
  readCrateRegistryProjection,
  readCrateSparseIndexState,
  readNpmRegistryState,
} from "./remote.mjs";
import { canonicalRepository, loadRepositoryState } from "./repository.mjs";
import { buildControlSeal } from "./seal.mjs";

const requiredChecks = ["Baseline Checks", "lint-and-typecheck", "test-rust", "test-ts"];
const maximumAdmissionReportBytes = 8 * 1024 * 1024;
const maximumArtifactBytes = 512 * 1024 * 1024;
const cargoTargetDirectoryEnvironmentField = "CARGO_TARGET_DIR";
const githubCheckRunsField = "check_runs";
const githubCompletedAtField = "completed_at";
const githubTotalCountField = "total_count";
const npmIgnoreScriptsEnvironmentField = "NPM_CONFIG_IGNORE_SCRIPTS";
const npmProvenanceEnvironmentField = "NPM_CONFIG_PROVENANCE";

function command(repositoryRoot, invocation, options = {}) {
  const [executable, ...commandArguments] = invocation;
  try {
    return execFileSync(executable, commandArguments, {
      cwd: options.cwd ?? repositoryRoot,
      encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
      env: options.env ?? process.env,
      maxBuffer: 128 * 1024 * 1024,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? releaseWorkCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease(options.errorCode ?? "RELEASE_COMMAND_FAILED", `${executable} failed`, {
      cause: error,
      exitCode: error?.status ?? 1,
    });
  }
}

function ghJson(repositoryRoot, endpoint) {
  const stdout = command(repositoryRoot, ["gh", "api", endpoint], {
    errorCode: "GITHUB_READ_FAILED",
  });
  try {
    return JSON.parse(stdout);
  } catch (error) {
    failRelease("GITHUB_READ_FAILED", `GitHub returned invalid JSON for ${endpoint}`, {
      cause: error,
    });
  }
}

export function validateCratePublicationRunIdentity(run, options) {
  if (
    !/^[1-9]\d*$/.test(options.runId) ||
    String(run?.id) !== options.runId ||
    run?.event !== "workflow_dispatch" ||
    run?.path !== ".github/workflows/release.yml" ||
    run?.head_branch !== "main" ||
    !/^[a-f0-9]{40}$/.test(run?.head_sha ?? "") ||
    !options.isAncestor(options.releaseCommit, run.head_sha) ||
    !options.isAncestor(run.head_sha, options.mainTip)
  ) {
    failRelease(
      "CRATE_WORKFLOW_RUN_INVALID",
      "crate provenance run is not an eligible release workflow on the R-to-T chain",
    );
  }
  return { eventCommit: run.head_sha, runId: String(run.id) };
}

function validateCratePublicationRun(repositoryRoot, options) {
  if (!/^[1-9]\d*$/.test(String(options.runId))) {
    failRelease("CRATE_WORKFLOW_RUN_INVALID", "crate provenance has no valid workflow run ID");
  }
  const run = ghJson(repositoryRoot, `repos/${canonicalRepository}/actions/runs/${options.runId}`);
  const identity = validateCratePublicationRunIdentity(run, {
    isAncestor: (ancestor, descendant) => gitIsAncestor(repositoryRoot, ancestor, descendant),
    mainTip: options.mainTip,
    releaseCommit: options.releaseCommit,
    runId: String(options.runId),
  });
  if (options.verifySeal !== false) {
    verifyControlSeal(
      buildControlSeal(repositoryRoot, options.releaseCommit),
      buildControlSeal(repositoryRoot, run.head_sha),
    );
  }
  return identity;
}

function validateWorkflowRun(repositoryRoot, environment, releaseCommit) {
  const runId = environment.GITHUB_RUN_ID;
  const runAttempt = Number.parseInt(environment.GITHUB_RUN_ATTEMPT ?? "", 10);
  if (!/^\d+$/.test(runId ?? "") || !Number.isInteger(runAttempt) || runAttempt < 1) {
    failRelease("WORKFLOW_RUN_IDENTITY_INVALID", "workflow run identity is missing");
  }
  const run = ghJson(repositoryRoot, `repos/${canonicalRepository}/actions/runs/${runId}`);
  if (
    run.id !== Number.parseInt(runId, 10) ||
    run.run_attempt !== runAttempt ||
    run.event !== "workflow_dispatch" ||
    run.path !== ".github/workflows/release.yml" ||
    run.head_branch !== "main" ||
    run.head_sha !== environment.GITHUB_SHA ||
    typeof run.created_at !== "string"
  ) {
    failRelease(
      "WORKFLOW_RUN_IDENTITY_INVALID",
      "GitHub run metadata differs from the event context",
    );
  }
  validateRequiredChecks(repositoryRoot, releaseCommit);
  return { createdAt: run.created_at, runAttempt, runId: String(run.id) };
}

export function validateRequiredCheckRuns(checkRuns) {
  const candidatesByName = checkRuns?.[githubCheckRunsField];
  const totalCount = checkRuns?.[githubTotalCountField];
  if (
    !Array.isArray(candidatesByName) ||
    !Number.isSafeInteger(totalCount) ||
    totalCount < 0 ||
    totalCount > 100 ||
    totalCount !== candidatesByName.length
  ) {
    failRelease("REQUIRED_CHECKS_UNKNOWN", "required check-run set is incomplete");
  }
  for (const checkName of requiredChecks) {
    const candidates = candidatesByName.filter(({ name }) => name === checkName);
    if (candidates.length === 0) {
      failRelease("REQUIRED_CHECKS_UNKNOWN", `${checkName} has no check-run candidate`);
    }
    if (candidates.some(({ status }) => status !== "completed")) {
      failRelease("REQUIRED_CHECK_NOT_SUCCESSFUL", `${checkName} has a pending check-run`);
    }
    const timestamps = candidates.map((candidate) => Date.parse(candidate[githubCompletedAtField]));
    if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
      failRelease("REQUIRED_CHECKS_UNKNOWN", `${checkName} has an invalid completion time`);
    }
    const latestTimestamp = Math.max(...timestamps);
    const latestIndexes = timestamps
      .map((timestamp, index) => (timestamp === latestTimestamp ? index : -1))
      .filter((index) => index >= 0);
    if (latestIndexes.length !== 1) {
      failRelease("REQUIRED_CHECKS_UNKNOWN", `${checkName} has an ambiguous latest check-run`);
    }
    if (candidates[latestIndexes[0]].conclusion !== "success") {
      failRelease("REQUIRED_CHECK_NOT_SUCCESSFUL", `${checkName} is not successful at R`);
    }
  }
  return { checks: requiredChecks };
}

export function validateRequiredChecks(repositoryRoot, releaseCommit, options = {}) {
  const checkRuns = (options.readGitHubJson ?? ghJson)(
    repositoryRoot,
    `repos/${canonicalRepository}/commits/${releaseCommit}/check-runs?filter=all&per_page=100`,
  );
  return validateRequiredCheckRuns(checkRuns);
}

export function fetchFreshMain(repositoryRoot) {
  command(repositoryRoot, ["git", "fetch", "--no-tags", "--prune", "origin", "main"], {
    errorCode: "RELEASE_MAIN_FETCH_FAILED",
  });
  return resolveCommit(repositoryRoot, "origin/main");
}

export function releaseParent(repositoryRoot, releaseCommit) {
  const line = command(repositoryRoot, [
    "git",
    "rev-list",
    "--parents",
    "-n",
    "1",
    releaseCommit,
  ]).trim();
  const commits = line.split(" ");
  if (commits.length !== 2 || commits[0] !== releaseCommit) {
    failRelease("DISPATCH_RELEASE_PARENT_COUNT", "R must have exactly one parent");
  }
  return commits[1];
}

function loadTrustedSourceState(repositoryRoot, sourceCommit) {
  if (
    typeof repositoryRoot !== "string" ||
    resolveCommit(repositoryRoot, "HEAD") !== sourceCommit
  ) {
    failRelease(
      "TRUSTED_SOURCE_CHECKOUT_MISMATCH",
      "trusted controller checkout must equal the sole parent S of R",
    );
  }
  if (
    command(repositoryRoot, ["git", "status", "--porcelain=v2", "-z"], {
      encoding: null,
      timeoutMs: releaseReadCommandTimeoutMs,
    }).length !== 0
  ) {
    failRelease("TRUSTED_SOURCE_CHECKOUT_DIRTY", "trusted S checkout must remain clean");
  }
  return loadRepositoryState(repositoryRoot);
}

export function assertReleaseCheckout(repositoryRoot, releaseCommit) {
  if (resolveCommit(repositoryRoot, "HEAD") !== releaseCommit) {
    failRelease("DISPATCH_CHECKOUT_MISMATCH", "release checkout HEAD does not equal R");
  }
  if (
    command(repositoryRoot, ["git", "status", "--porcelain=v2", "-z"], {
      encoding: null,
      timeoutMs: releaseReadCommandTimeoutMs,
    }).length !== 0
  ) {
    failRelease("DISPATCH_CHECKOUT_DIRTY", "release checkout must remain clean");
  }
}

export function gitIsAncestor(repositoryRoot, ancestor, descendant) {
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
  failRelease("RELEASE_ANCESTRY_UNKNOWN", "Git ancestry could not be established");
}

function deltaOptions(state, maps) {
  return {
    ...maps,
    cargoPackages: state.cargo.crates.map(({ manifestPath, name }) => ({ manifestPath, name })),
    npmPackages: state.npm.packages.map(({ name, path }) => ({
      changelogPath: `${path.slice(0, -"package.json".length)}CHANGELOG.md`,
      manifestPath: path,
      name,
    })),
    patchNames: state.patchNames,
    workspaceNames: new Set(state.cargoPackages.map(({ name }) => name)),
  };
}

export function classifyTrailingCommits(repositoryRoot, options) {
  if (options.releaseCommit === options.mainTip) {
    return [];
  }
  const commits = command(repositoryRoot, [
    "git",
    "rev-list",
    "--first-parent",
    "--reverse",
    `${options.releaseCommit}..${options.mainTip}`,
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
  if (commits.length === 0 || commits.at(-1) !== options.mainTip) {
    failRelease("APPROVAL_TRAILING_FIRST_PARENT", "R is not on T's first-parent chain");
  }
  const phases = [];
  let parent = options.releaseCommit;
  for (const commit of commits) {
    const parentLine = command(repositoryRoot, ["git", "rev-list", "--parents", "-n", "1", commit])
      .trim()
      .split(" ");
    if (parentLine[0] !== commit || parentLine.length < 2 || parentLine[1] !== parent) {
      failRelease(
        "APPROVAL_TRAILING_FIRST_PARENT",
        "trailing main history is not adjacent to R on the first-parent chain",
      );
    }
    const delta =
      options.classifyPair?.(parent, commit) ??
      validateReleaseDelta(
        deltaOptions(
          options.state,
          readVersionFileMaps(repositoryRoot, {
            baseCommit: parent,
            headCommit: commit,
            state: options.state,
          }),
        ),
      );
    phases.push(delta.phase);
    if (delta.phase !== "steady") {
      failRelease(
        "APPROVAL_TRAILING_MATERIALIZED",
        `commit ${commit} after R is ${delta.phase}, not feature-only steady state`,
      );
    }
    parent = commit;
  }
  return phases;
}

export async function readRegistryState(state, options = {}) {
  const npmEntries =
    options.includeNpm === false
      ? []
      : await Promise.all(
          state.npm.fixedNames.map(async (name) => [
            name,
            await readNpmRegistryState(name, options),
          ]),
        );
  const crateEntries =
    options.includeCrates === false
      ? []
      : await Promise.all(
          state.cargo.crates.map(async ({ name }) => [
            name,
            await readCrateRegistryProjection(name, options),
          ]),
        );
  return { crates: new Map(crateEntries), npm: new Map(npmEntries) };
}

function knownRegistryState(state) {
  return state.state === "missing-package" ? "known" : state.state;
}

export async function classifyNpmArtifacts(options) {
  const localByName = new Map(options.localArtifacts.map((artifact) => [artifact.name, artifact]));
  const packageByName = new Map(
    options.state.npm.packages.map((npmPackage) => [npmPackage.name, npmPackage]),
  );
  const fixedNames = new Set(options.state.npm.fixedNames);
  const artifacts = [];
  for (const packageName of options.state.npm.publishOrder) {
    const localArtifact = localByName.get(packageName);
    const registryState = options.registry.npm.get(packageName);
    const npmPackage = packageByName.get(packageName);
    if (localArtifact === undefined || registryState === undefined || npmPackage === undefined) {
      failRelease(
        "NPM_ARTIFACT_SET_INVALID",
        `${packageName} is missing from the release projection`,
      );
    }
    const targetInput = options.delta.npm.advanced ? localArtifact.version : "current";
    const target = classifyStableTarget({
      allowExistingTarget: true,
      carried: registryState.records.has(localArtifact.version),
      current: options.delta.npm.currentVersion,
      deprecated: registryState.deprecated,
      state: knownRegistryState(registryState),
      target: targetInput,
      versions: registryState.versions,
    });
    const report = {
      advances: target.advances,
      canonicalSha256: localArtifact.canonicalSha256,
      filename: localArtifact.filename,
      frontier: target.frontier ?? null,
      name: packageName,
      state: "missing",
      version: localArtifact.version,
    };
    if (registryState.records.has(localArtifact.version)) {
      const audit = await auditNpmRegistryArtifact({
        expectedRun:
          target.advances && options.selectedTarget === "npm" && options.run !== undefined
            ? { ...options.run, allowEarlierAttempt: true }
            : undefined,
        fetch: options.fetch,
        fixedPackageNames: fixedNames,
        localArtifact,
        registryState,
        releaseCommit: options.releaseCommit,
        sourceManifest: npmPackage.manifest,
      });
      const provenanceCommit = audit.provenance.releaseCommit;
      if (target.advances && provenanceCommit !== options.releaseCommit) {
        failRelease("NPM_PROVENANCE_MISMATCH", `${packageName} target is not bound to R`);
      }
      if (!target.advances) {
        validateCarriedSource({
          isAncestor: (ancestor, descendant) =>
            gitIsAncestor(options.repositoryRoot, ancestor, descendant),
          provenanceCommit,
          releaseCommit: options.releaseCommit,
          repository: canonicalRepository,
        });
      }
      report.provenanceCommit = provenanceCommit;
      report.state = "exact";
    }
    artifacts.push(report);
  }
  return artifacts;
}

async function auditExistingCrateArtifact(options) {
  const registryRecord = options.registryState.records.get(options.localArtifact.version);
  const advancedRun = options.advances
    ? validateCratePublicationRun(options.repositoryRoot, {
        mainTip: options.mainTip ?? resolveCommit(options.repositoryRoot, "origin/main"),
        releaseCommit: options.releaseCommit,
        runId: registryRecord?.trustpub_data?.run_id,
      })
    : undefined;
  const audit = await auditCrateRegistryArtifact({
    expectedPath: dirname(options.cargoPackage.manifestPath),
    expectedPublicDependencies: options.expectedPublicDependencies,
    expectedPublicVersions: options.expectedPublicVersions,
    expectedRun: advancedRun,
    fetch: options.fetch,
    localArtifact: options.localArtifact,
    registryState: options.registryState,
    releaseCommit: options.releaseCommit,
    sourceManifest: readFileSync(join(options.repositoryRoot, options.cargoPackage.manifestPath)),
  });
  if (options.advances && audit.provenanceCommit !== options.releaseCommit) {
    failRelease(
      "CRATE_PROVENANCE_MISMATCH",
      `${options.localArtifact.name} target is not bound to R`,
    );
  }
  if (!options.advances) {
    validateCarriedSource({
      isAncestor: (ancestor, descendant) =>
        gitIsAncestor(options.repositoryRoot, ancestor, descendant),
      provenanceCommit: audit.provenanceCommit,
      releaseCommit: options.releaseCommit,
      repository: canonicalRepository,
    });
    const carriedRun = validateCratePublicationRun(options.repositoryRoot, {
      mainTip: options.mainTip ?? resolveCommit(options.repositoryRoot, "origin/main"),
      releaseCommit: audit.provenanceCommit,
      runId: audit.publication.runId,
      verifySeal: false,
    });
    if (
      carriedRun.eventCommit !== audit.publication.eventCommit ||
      carriedRun.runId !== audit.publication.runId
    ) {
      failRelease(
        "CRATE_PROVENANCE_MISMATCH",
        `${options.localArtifact.name} trusted-publishing claims differ from its workflow run`,
      );
    }
  }
  return audit.provenanceCommit;
}

export async function classifyCrateArtifacts(options) {
  const localByName = new Map(options.localArtifacts.map((artifact) => [artifact.name, artifact]));
  const crateByName = new Map(
    options.state.cargo.crates.map((cargoPackage) => [cargoPackage.name, cargoPackage]),
  );
  const expectedPublicVersions = new Map(
    options.state.cargo.crates.map(({ name, version }) => [name, version]),
  );
  const expectedPublicDependencies = publicCargoDependencyMap(options.state.cargo.crates);
  const advancedNames = new Set(options.delta.cargo.advanced);
  const artifacts = [];
  for (const crateName of options.state.cargo.publishOrder) {
    const cargoPackage = crateByName.get(crateName);
    const localArtifact = localByName.get(crateName);
    const registryState = options.registry.crates.get(crateName);
    if (cargoPackage === undefined || localArtifact === undefined || registryState === undefined) {
      failRelease(
        "CRATE_ARTIFACT_SET_INVALID",
        `${crateName} is missing from the release projection`,
      );
    }
    const advances = advancedNames.has(crateName);
    const target = classifyStableTarget({
      allowExistingTarget: true,
      carried: registryState.records.has(localArtifact.version),
      current: options.delta.cargo.currentVersions[crateName],
      state: knownRegistryState(registryState),
      target: advances ? localArtifact.version : "current",
      versions: registryState.versions,
      yanked: registryState.yanked,
    });
    const report = {
      advances: target.advances,
      canonicalSha256: localArtifact.canonicalSha256,
      filename: localArtifact.filename,
      frontier: target.frontier ?? null,
      name: crateName,
      state: "missing",
      version: localArtifact.version,
    };
    if (registryState.records.has(localArtifact.version)) {
      report.provenanceCommit = await auditExistingCrateArtifact({
        advances,
        cargoPackage,
        expectedPublicDependencies,
        expectedPublicVersions,
        fetch: options.fetch,
        localArtifact,
        mainTip: options.mainTip,
        registryState,
        releaseCommit: options.releaseCommit,
        repositoryRoot: options.repositoryRoot,
        run: options.run,
      });
      report.state = "exact";
    }
    artifacts.push(report);
  }
  return artifacts;
}

function validEventLease(context) {
  try {
    return validateNpmEventLease(context);
  } catch {
    return undefined;
  }
}

function leaseForTarget(options) {
  if (options.mode.mode === "AUDIT_ONLY") {
    return { kind: "none", writeRequired: false };
  }
  const eventLease = validEventLease({
    createdAt: options.run.createdAt,
    eventCommit: options.eventCommit,
    now: options.now,
    ref: "refs/heads/main",
    releaseCommit: options.releaseCommit,
    repository: canonicalRepository,
    runAttempt: options.run.runAttempt,
    runId: options.run.runId,
    workflowPath: ".github/workflows/release.yml",
    workflowSha: options.workflowSha,
  });
  if (options.target === "npm") {
    if (eventLease === undefined) {
      failRelease("NPM_EVENT_LEASE_INVALID", "npm writes require the original E=R event family");
    }
    return { ...eventLease, writeRequired: true };
  }
  const crateLease = validateCrateWriteLease({
    eventLease,
    registryArtifacts: [...options.npmArtifacts, ...options.crateArtifacts],
    releaseCommit: options.releaseCommit,
  });
  return { ...crateLease, writeRequired: true };
}

function relativeArtifactReport(bundleDirectory, artifacts) {
  return artifacts.map((artifact) => ({
    archiveSha256: artifact.archiveSha256,
    canonicalSha256: artifact.canonicalSha256,
    file: relative(bundleDirectory, artifact.path).split("\\").join("/"),
    filename: artifact.filename,
    name: artifact.name,
    version: artifact.version,
  }));
}

export function assertWorkflowToolchain(repositoryRoot) {
  const versions = {
    node: process.version.replace(/^v/, ""),
    npm: command(repositoryRoot, ["npm", "--version"]).trim(),
    pnpm: command(repositoryRoot, ["pnpm", "--version"]).trim(),
    rust: command(repositoryRoot, ["rustc", "--version"]).trim().split(/\s+/)[1],
    wasmPack: command(repositoryRoot, ["wasm-pack", "--version"]).trim().split(/\s+/)[1],
  };
  const expected = {
    node: "22.14.0",
    npm: "11.19.0",
    pnpm: "10.29.3",
    rust: "1.97.0",
    wasmPack: "0.13.1",
  };
  if (canonicalJson(versions) !== canonicalJson(expected)) {
    failRelease("WORKFLOW_TOOLCHAIN_MISMATCH", "runtime toolchain differs from workflow pins");
  }
  return versions;
}

export async function createAdmissionReport(options) {
  const dispatch = validateDispatchContext({
    eventCommit: options.environment.GITHUB_SHA,
    inputs: {
      "release-commit": options.releaseCommit,
      target: options.target,
    },
    ref: options.environment.GITHUB_REF,
    repository: options.environment.GITHUB_REPOSITORY,
    workflowSha: options.environment.GITHUB_WORKFLOW_SHA,
  });
  assertReleaseCheckout(options.repositoryRoot, dispatch.releaseCommit);
  const mainTip = fetchFreshMain(options.repositoryRoot);
  const parentCommit = releaseParent(options.repositoryRoot, dispatch.releaseCommit);
  const sourceState = loadTrustedSourceState(options.trustedRepositoryRoot, parentCommit);
  validateTrainIdentity({
    eventIsAncestorOfMain: gitIsAncestor(
      options.repositoryRoot,
      options.environment.GITHUB_SHA,
      mainTip,
    ),
    eventCommit: options.environment.GITHUB_SHA,
    mainTip,
    parentCommit,
    parentCount: 1,
    releaseCommit: dispatch.releaseCommit,
    releaseIsAncestorOfEvent: gitIsAncestor(
      options.repositoryRoot,
      dispatch.releaseCommit,
      options.environment.GITHUB_SHA,
    ),
    releaseIsAncestorOfMain: gitIsAncestor(options.repositoryRoot, dispatch.releaseCommit, mainTip),
    workflowSha: options.environment.GITHUB_WORKFLOW_SHA,
  });
  const delta = verifyRepositoryDelta(options.repositoryRoot, parentCommit, { state: sourceState });
  if (delta.phase !== "materialized" || delta.baseCommit !== parentCommit) {
    failRelease(
      "DISPATCH_RELEASE_NOT_MATERIALIZED",
      "R is not one exact materialized version commit",
    );
  }
  const state = loadRepositoryState(options.repositoryRoot);
  const trailingCommitPhases = classifyTrailingCommits(options.repositoryRoot, {
    mainTip,
    releaseCommit: dispatch.releaseCommit,
    state,
  });
  const releaseSeal = buildControlSeal(options.repositoryRoot, dispatch.releaseCommit);
  const eventSeal = buildControlSeal(options.repositoryRoot, options.environment.GITHUB_SHA);
  const workflowSeal = buildControlSeal(
    options.repositoryRoot,
    options.environment.GITHUB_WORKFLOW_SHA,
  );
  const mainSeal = buildControlSeal(options.repositoryRoot, mainTip);
  verifyControlSeal(releaseSeal, eventSeal);
  verifyControlSeal(releaseSeal, workflowSeal);
  verifyControlSeal(releaseSeal, mainSeal);
  const run =
    options.run ??
    validateWorkflowRun(options.repositoryRoot, options.environment, dispatch.releaseCommit);
  const toolchain = assertWorkflowToolchain(options.repositoryRoot);

  mkdirSync(options.bundleDirectory, { recursive: true });
  const commandLog = [];
  buildReleaseOutputs(options.repositoryRoot, commandLog);
  const npmLocalArtifacts = packNpmArtifacts({
    commandLog,
    npmModel: state.npm,
    outputDirectory: join(options.bundleDirectory, "npm"),
    repositoryRoot: options.repositoryRoot,
  });
  const crateLocalArtifacts =
    dispatch.target === "crates"
      ? packageCrateArtifacts({
          cargoModel: state.cargo,
          commandLog,
          noVerify: true,
          outputDirectory: join(options.bundleDirectory, "crates"),
          releaseCommit: dispatch.releaseCommit,
          repositoryRoot: options.repositoryRoot,
        })
      : [];
  assertReleaseCheckout(options.repositoryRoot, dispatch.releaseCommit);
  const registry = await readRegistryState(state, {
    fetch: options.fetch,
    includeCrates: dispatch.target === "crates",
  });
  const npmArtifacts = await classifyNpmArtifacts({
    delta,
    fetch: options.fetch,
    localArtifacts: npmLocalArtifacts,
    registry,
    releaseCommit: dispatch.releaseCommit,
    repositoryRoot: options.repositoryRoot,
    run,
    selectedTarget: dispatch.target,
    state,
  });
  let crateArtifacts = [];
  if (dispatch.target === "crates") {
    if (npmArtifacts.some(({ state: artifactState }) => artifactState !== "exact")) {
      failRelease("CRATES_NPM_PREREQUISITE", "crates admission requires a full exact npm audit");
    }
    crateArtifacts = await classifyCrateArtifacts({
      delta,
      fetch: options.fetch,
      localArtifacts: crateLocalArtifacts,
      mainTip,
      registry,
      releaseCommit: dispatch.releaseCommit,
      repositoryRoot: options.repositoryRoot,
      run,
      state,
    });
  }
  const targetArtifacts = dispatch.target === "npm" ? npmArtifacts : crateArtifacts;
  const mode = classifyRegistryMode(targetArtifacts);
  const lease = leaseForTarget({
    crateArtifacts,
    eventCommit: options.environment.GITHUB_SHA,
    mode,
    now: options.now ?? new Date().toISOString(),
    npmArtifacts,
    releaseCommit: dispatch.releaseCommit,
    run,
    target: dispatch.target,
    workflowSha: options.environment.GITHUB_WORKFLOW_SHA,
  });
  const report = {
    artifacts: {
      crates: crateArtifacts,
      npm: npmArtifacts,
    },
    bundle: {
      crates: relativeArtifactReport(options.bundleDirectory, crateLocalArtifacts),
      npm: relativeArtifactReport(options.bundleDirectory, npmLocalArtifacts),
    },
    commands: commandLog,
    delta: {
      cargo: delta.cargo,
      npm: delta.npm,
      phase: delta.phase,
    },
    eventCommit: options.environment.GITHUB_SHA,
    lease,
    mainTip,
    mode,
    parentCommit,
    releaseCommit: dispatch.releaseCommit,
    repository: canonicalRepository,
    run,
    schema: admissionReportSchema,
    seal: {
      publishSetHash: sha256(canonicalJson(releaseSeal.publishSet)),
      sha256: releaseSeal.sha256,
    },
    target: dispatch.target,
    toolchain,
    trailingCommitPhases,
    writeOrder: targetArtifacts.filter(({ advances }) => advances).map(({ name }) => name),
    workflowSha: options.environment.GITHUB_WORKFLOW_SHA,
  };
  const reportBytes = canonicalJsonBytes(report);
  const reportSha256 = sha256(reportBytes);
  writeFileSync(join(options.bundleDirectory, "admission.json"), reportBytes, {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(join(options.bundleDirectory, "admission.sha256"), `${reportSha256}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return { report, reportSha256 };
}

function readRegularFile(path, maximumBytes, errorCode) {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size < 1 || stats.size > maximumBytes) {
      failRelease(errorCode, `${basename(path)} is not a bounded regular file`);
    }
    return readFileSync(path);
  } catch (error) {
    if (error instanceof ReleaseControlError) {
      throw error;
    }
    failRelease(errorCode, `${basename(path)} could not be read`, { cause: error });
  }
}

function canonicalBundleDirectory(bundleDirectory) {
  try {
    const stats = lstatSync(bundleDirectory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      failRelease("ADMISSION_BUNDLE_PATH", "admission bundle must be a real directory");
    }
    return realpathSync(bundleDirectory);
  } catch (error) {
    if (error instanceof ReleaseControlError) {
      throw error;
    }
    failRelease("ADMISSION_BUNDLE_PATH", "admission bundle could not be resolved", {
      cause: error,
    });
  }
}

export function loadAdmissionReport(bundleDirectory, suppliedHash) {
  const canonicalBundle = canonicalBundleDirectory(bundleDirectory);
  const bytes = readRegularFile(
    join(canonicalBundle, "admission.json"),
    maximumAdmissionReportBytes,
    "ADMISSION_REPORT_INVALID",
  );
  const hashBytes = readRegularFile(
    join(canonicalBundle, "admission.sha256"),
    65,
    "ADMISSION_REPORT_HASH",
  );
  const hashText = hashBytes.toString("ascii");
  const expectedHash = hashText.slice(0, -1);
  if (
    !/^[a-f0-9]{64}\n$/.test(hashText) ||
    (suppliedHash !== undefined && suppliedHash !== expectedHash) ||
    sha256(bytes) !== expectedHash
  ) {
    failRelease("ADMISSION_REPORT_HASH", "admission report hash does not match its bytes");
  }
  let report;
  try {
    report = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    failRelease("ADMISSION_REPORT_INVALID", "admission report is invalid JSON", { cause: error });
  }
  validateAdmissionReport(report);
  if (!bytes.equals(canonicalJsonBytes(report))) {
    failRelease("ADMISSION_REPORT_INVALID", "admission report is not canonical JSON");
  }
  return report;
}

function localArtifactsFromReport(bundleDirectory, entries) {
  const canonicalBundle = canonicalBundleDirectory(bundleDirectory);
  return entries.map((entry) => {
    if (
      typeof entry?.file !== "string" ||
      entry.file.includes("\\") ||
      entry.file
        .split("/")
        .some((segment) => segment === "" || segment === "." || segment === "..") ||
      typeof entry.filename !== "string" ||
      basename(entry.file) !== entry.filename ||
      !/^[a-f0-9]{64}$/.test(entry.archiveSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(entry.canonicalSha256 ?? "")
    ) {
      failRelease("ADMISSION_ARTIFACT_PATH", "admission artifact metadata is invalid");
    }
    const artifactPath = resolve(canonicalBundle, ...entry.file.split("/"));
    const relativePath = relative(canonicalBundle, artifactPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      failRelease("ADMISSION_ARTIFACT_PATH", `${entry.name} artifact escapes the bundle`);
    }
    let canonicalArtifactPath;
    try {
      canonicalArtifactPath = realpathSync(artifactPath);
    } catch (error) {
      failRelease("ADMISSION_ARTIFACT_PATH", `${entry.name} artifact cannot be resolved`, {
        cause: error,
      });
    }
    const canonicalRelativePath = relative(canonicalBundle, canonicalArtifactPath);
    if (
      canonicalArtifactPath !== artifactPath ||
      canonicalRelativePath === ".." ||
      canonicalRelativePath.startsWith(`..${sep}`)
    ) {
      failRelease("ADMISSION_ARTIFACT_PATH", `${entry.name} artifact resolves outside the bundle`);
    }
    const bytes = readRegularFile(artifactPath, maximumArtifactBytes, "ADMISSION_ARTIFACT_PATH");
    if (sha256(bytes) !== entry.archiveSha256) {
      failRelease(
        "ADMISSION_ARTIFACT_HASH",
        `${entry.name} artifact bytes changed after admission`,
      );
    }
    return { ...entry, path: artifactPath };
  });
}

async function refreshProjection(options, report, localArtifacts) {
  if (resolveCommit(options.repositoryRoot, "HEAD") !== report.releaseCommit) {
    failRelease("DISPATCH_CHECKOUT_MISMATCH", "registry checkout HEAD no longer equals R");
  }
  if (
    command(options.repositoryRoot, ["git", "status", "--porcelain=v2", "-z"], {
      encoding: null,
    }).length !== 0
  ) {
    failRelease("DISPATCH_CHECKOUT_DIRTY", "registry checkout must remain clean");
  }
  const mainTip = fetchFreshMain(options.repositoryRoot);
  await (options.validateRequiredChecks ?? validateRequiredChecks)(
    options.repositoryRoot,
    report.releaseCommit,
  );
  const parentCommit = releaseParent(options.repositoryRoot, report.releaseCommit);
  const sourceState = loadTrustedSourceState(options.trustedRepositoryRoot, parentCommit);
  validateTrainIdentity({
    eventIsAncestorOfMain: gitIsAncestor(options.repositoryRoot, report.eventCommit, mainTip),
    eventCommit: report.eventCommit,
    mainTip,
    parentCommit,
    parentCount: 1,
    releaseCommit: report.releaseCommit,
    releaseIsAncestorOfEvent: gitIsAncestor(
      options.repositoryRoot,
      report.releaseCommit,
      report.eventCommit,
    ),
    releaseIsAncestorOfMain: gitIsAncestor(options.repositoryRoot, report.releaseCommit, mainTip),
    workflowSha: report.workflowSha,
  });
  if (parentCommit !== report.parentCommit) {
    failRelease("APPROVAL_PARENT_DRIFT", "R parent differs from the admission report");
  }
  const verifiedDelta = verifyRepositoryDelta(options.repositoryRoot, parentCommit, {
    state: sourceState,
  });
  const verifiedDeltaProjection = {
    cargo: verifiedDelta.cargo,
    npm: verifiedDelta.npm,
    phase: verifiedDelta.phase,
  };
  if (canonicalJson(verifiedDeltaProjection) !== canonicalJson(report.delta)) {
    failRelease("APPROVAL_DELTA_DRIFT", "materialized R delta differs from the admission report");
  }
  const state = loadRepositoryState(options.repositoryRoot);
  const trailingCommitPhases = classifyTrailingCommits(options.repositoryRoot, {
    mainTip,
    releaseCommit: report.releaseCommit,
    state,
  });
  const releaseSeal = buildControlSeal(options.repositoryRoot, report.releaseCommit);
  const eventSeal = buildControlSeal(options.repositoryRoot, report.eventCommit);
  const workflowSeal = buildControlSeal(options.repositoryRoot, report.workflowSha);
  const mainSeal = buildControlSeal(options.repositoryRoot, mainTip);
  verifyControlSeal(releaseSeal, eventSeal);
  verifyControlSeal(releaseSeal, workflowSeal);
  verifyControlSeal(releaseSeal, mainSeal);
  const registry = await readRegistryState(state, {
    fetch: options.fetch,
    includeCrates: report.target === "crates",
  });
  const npmArtifacts = await classifyNpmArtifacts({
    delta: report.delta,
    fetch: options.fetch,
    localArtifacts: localArtifacts.npm,
    registry,
    releaseCommit: report.releaseCommit,
    repositoryRoot: options.repositoryRoot,
    run: report.run,
    selectedTarget: report.target,
    state,
  });
  const crateArtifacts =
    report.target === "crates"
      ? await classifyCrateArtifacts({
          delta: report.delta,
          fetch: options.fetch,
          localArtifacts: localArtifacts.crates,
          mainTip,
          registry,
          releaseCommit: report.releaseCommit,
          repositoryRoot: options.repositoryRoot,
          run: report.run,
          state,
        })
      : [];
  if (
    report.target === "crates" &&
    npmArtifacts.some(({ state: artifactState }) => artifactState !== "exact")
  ) {
    failRelease("CRATES_NPM_PREREQUISITE", "crates writes require a fresh full npm audit");
  }
  const artifacts = report.target === "npm" ? npmArtifacts : crateArtifacts;
  const mode = classifyRegistryMode(artifacts);
  const lease =
    mode.mode === "AUDIT_ONLY"
      ? { ...report.lease, writeRequired: false }
      : leaseForTarget({
          crateArtifacts,
          eventCommit: report.eventCommit,
          mode,
          now:
            typeof options.now === "function"
              ? options.now()
              : (options.now ?? new Date().toISOString()),
          npmArtifacts,
          releaseCommit: report.releaseCommit,
          run: report.run,
          target: report.target,
          workflowSha: report.workflowSha,
        });
  const projection = {
    artifacts,
    eventCommit: report.eventCommit,
    lease,
    mainTip,
    mode: mode.mode,
    prerequisites: report.target === "crates" ? npmArtifacts : [],
    publishSetHash: sha256(canonicalJson(releaseSeal.publishSet)),
    releaseCommit: report.releaseCommit,
    run: report.run,
    sealHash: releaseSeal.sha256,
    target: report.target,
    trailingCommitPhases,
    workflowSha: report.workflowSha,
    writeOrder: report.writeOrder,
  };
  return { artifacts, crateArtifacts, mainTip, npmArtifacts, projection, registry, state };
}

function reportProjection(report) {
  const selected = report.target === "npm" ? report.artifacts.npm : report.artifacts.crates;
  return {
    artifacts: selected,
    eventCommit: report.eventCommit,
    lease: report.lease,
    mainTip: report.mainTip,
    mode: report.mode.mode,
    prerequisites: report.target === "crates" ? report.artifacts.npm : [],
    publishSetHash: report.seal.publishSetHash,
    releaseCommit: report.releaseCommit,
    run: report.run,
    sealHash: report.seal.sha256,
    target: report.target,
    trailingCommitPhases: report.trailingCommitPhases,
    workflowSha: report.workflowSha,
    writeOrder: report.writeOrder,
  };
}

function sleep(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

export function auditCrateDryRun(repositoryRoot, artifact, options) {
  const temporaryTarget = mkdtempSync(join(tmpdir(), "boundsvg-crate-dry-run-"));
  const dryRunEnvironment = { ...(options.environment ?? process.env) };
  delete dryRunEnvironment.CARGO_REGISTRY_TOKEN;
  try {
    (options.execute ?? command)(
      repositoryRoot,
      ["cargo", "publish", "--dry-run", "--locked", "--package", artifact.name],
      {
        env: { ...dryRunEnvironment, [cargoTargetDirectoryEnvironmentField]: temporaryTarget },
        stdio: "inherit",
      },
    );
    const candidateBytes = readFileSync(join(temporaryTarget, "package", artifact.filename));
    const inspection = inspectCrateArchive({
      crateName: artifact.name,
      entries: readTarEntries(candidateBytes),
      expectedPath: dirname(options.cargoPackage.manifestPath),
      expectedPublicDependencies: publicCargoDependencyMap(options.state.cargo.crates),
      expectedPublicVersions: new Map(
        options.state.cargo.crates.map(({ name, version }) => [name, version]),
      ),
      releaseCommit: artifact.releaseCommit,
      requireCleanVcs: true,
      sourceManifest: readFileSync(join(repositoryRoot, options.cargoPackage.manifestPath)),
      version: artifact.version,
    });
    if (inspection.canonicalSha256 !== artifact.canonicalSha256) {
      failRelease(
        "CRATE_DRY_RUN_PAYLOAD_MISMATCH",
        `${artifact.name} dry-run payload differs from the admission artifact`,
      );
    }
  } finally {
    rmSync(temporaryTarget, { force: true, recursive: true });
  }
}

async function publishNpmArtifact(options, artifact, state) {
  const before = [{ name: artifact.name, state: artifact.state }];
  if (artifact.state === "missing") {
    command(
      options.repositoryRoot,
      ["npm", "publish", artifact.path, "--access", "public", "--tag", "latest"],
      {
        env: {
          ...process.env,
          [npmIgnoreScriptsEnvironmentField]: "true",
          [npmProvenanceEnvironmentField]: "true",
        },
        errorCode: "NPM_PUBLISH_FAILED",
        stdio: "inherit",
      },
    );
    await pollRegistry({
      ...npmAvailabilityPolicy,
      read: async () => {
        const registryState = await readNpmRegistryState(artifact.name, { fetch: options.fetch });
        return registryState.records.has(artifact.version);
      },
      sleep: options.sleep ?? sleep,
    });
  }
  const registryState = await readNpmRegistryState(artifact.name, { fetch: options.fetch });
  const afterState = registryState.records.has(artifact.version) ? "exact" : "unknown";
  validateRegistryTransition(before, [{ name: artifact.name, state: afterState }]);
  const npmPackage = state.npm.packages.find(({ name }) => name === artifact.name);
  await auditNpmRegistryArtifact({
    expectedRun: expectedNpmPublicationRun(artifact, options.report.run),
    fetch: options.fetch,
    fixedPackageNames: new Set(state.npm.fixedNames),
    localArtifact: artifact,
    registryState,
    releaseCommit: options.report.releaseCommit,
    sourceManifest: npmPackage.manifest,
  });
}

export function expectedNpmPublicationRun(artifact, run) {
  return artifact.advances ? { ...run, allowEarlierAttempt: true } : undefined;
}

export function crateIndexArtifactAvailable(indexState, artifact) {
  const indexRecord = indexState.records.get(artifact.version);
  if (indexRecord === undefined) {
    return false;
  }
  if (indexRecord.yanked !== false) {
    failRelease("CRATES_INDEX_MISMATCH", `${artifact.name} sparse index target version is yanked`);
  }
  return true;
}

export function runCredentialedCratePublish(repositoryRoot, crateName, options) {
  assertReleaseCheckout(repositoryRoot, options.releaseCommit);
  (options.execute ?? command)(
    repositoryRoot,
    ["cargo", "publish", "--locked", "--no-verify", "--package", crateName],
    {
      env: options.environment ?? process.env,
      errorCode: "CRATE_PUBLISH_FAILED",
      stdio: "inherit",
    },
  );
  assertReleaseCheckout(repositoryRoot, options.releaseCommit);
}

async function publishCrateArtifact(options, artifact, state) {
  const cargoPackage = state.cargo.crates.find(({ name }) => name === artifact.name);
  if (cargoPackage === undefined) {
    failRelease("CRATE_ARTIFACT_SET_INVALID", `${artifact.name} is not a public crate`);
  }
  const before = [{ name: artifact.name, state: artifact.state }];
  if (artifact.state === "missing") {
    auditCrateDryRun(
      options.repositoryRoot,
      { ...artifact, releaseCommit: options.report.releaseCommit },
      { cargoPackage, state },
    );
    runCredentialedCratePublish(options.repositoryRoot, artifact.name, {
      releaseCommit: options.report.releaseCommit,
    });
    await pollRegistry({
      ...crateIndexPolicy,
      read: async () => {
        const indexState = await readCrateSparseIndexState(artifact.name, {
          fetch: options.fetch,
        });
        return crateIndexArtifactAvailable(indexState, artifact);
      },
      sleep: options.sleep ?? sleep,
    });
  }
  const registryState = await readCrateRegistryProjection(artifact.name, { fetch: options.fetch });
  const afterState = registryState.records.has(artifact.version) ? "exact" : "unknown";
  validateRegistryTransition(before, [{ name: artifact.name, state: afterState }]);
  await auditExistingCrateArtifact({
    advances: artifact.advances,
    cargoPackage,
    expectedPublicDependencies: publicCargoDependencyMap(state.cargo.crates),
    expectedPublicVersions: new Map(state.cargo.crates.map(({ name, version }) => [name, version])),
    fetch: options.fetch,
    localArtifact: artifact,
    mainTip: fetchFreshMain(options.repositoryRoot),
    registryState,
    releaseCommit: options.report.releaseCommit,
    repositoryRoot: options.repositoryRoot,
  });
}

async function auditCrateDocumentation(artifacts, options) {
  await Promise.all(
    artifacts.map((artifact) =>
      pollRegistry({
        ...docsBuildPolicy,
        read: async () => {
          try {
            await auditDocsBuild({
              crateName: artifact.name,
              fetch: options.fetch,
              version: artifact.version,
            });
            return true;
          } catch (error) {
            const releaseError = asReleaseControlError(error, "DOCS_BUILD_UNKNOWN");
            if (["DOCS_BUILD_INCOMPLETE", "DOCS_BUILD_UNKNOWN"].includes(releaseError.code)) {
              return false;
            }
            throw error;
          }
        },
        sleep: options.sleep ?? sleep,
      }),
    ),
  );
}

export async function executeRegistryJob(options) {
  const report = loadAdmissionReport(options.bundleDirectory, options.reportSha256);
  if (report.target !== options.target || report.releaseCommit !== options.releaseCommit) {
    failRelease("ADMISSION_REPORT_TARGET", "registry job does not match its admission report");
  }
  if (resolveCommit(options.repositoryRoot, "HEAD") !== report.releaseCommit) {
    failRelease("DISPATCH_CHECKOUT_MISMATCH", "registry checkout HEAD does not equal R");
  }
  const localArtifacts = {
    crates: localArtifactsFromReport(options.bundleDirectory, report.bundle.crates),
    npm: localArtifactsFromReport(options.bundleDirectory, report.bundle.npm),
  };
  const frozenProjection = reportProjection(report);
  let previousProjection = frozenProjection;
  const refreshAndValidate = async () => {
    const refreshed = await refreshProjection(options, report, localArtifacts);
    assertApprovalProjectionNarrowing(frozenProjection, refreshed.projection);
    assertApprovalProjectionNarrowing(previousProjection, refreshed.projection);
    previousProjection = refreshed.projection;
    return refreshed;
  };
  const selectedArtifacts = options.target === "npm" ? localArtifacts.npm : localArtifacts.crates;
  const executionOptions = { ...options, report };
  const after = await executeRegistryArtifactSequence({
    localArtifacts: selectedArtifacts,
    publish: async (artifact, freshBefore) => {
      if (options.target === "npm") {
        await publishNpmArtifact(executionOptions, artifact, freshBefore.state);
      } else {
        await publishCrateArtifact(executionOptions, artifact, freshBefore.state);
      }
    },
    refresh: refreshAndValidate,
  });
  if (after.artifacts.some(({ state: artifactState }) => artifactState !== "exact")) {
    failRelease("REGISTRY_FINAL_AUDIT_FAILED", "selected registry is not fully exact after writes");
  }
  if (options.target === "crates") {
    await auditCrateDocumentation(after.artifacts, options);
  }
  return { artifacts: after.artifacts.length, mode: report.mode.mode, target: options.target };
}

export async function executeRegistryArtifactSequence(options) {
  for (const localArtifact of options.localArtifacts) {
    const freshBefore = await options.refresh();
    const observedArtifact = freshBefore.artifacts.find(({ name }) => name === localArtifact.name);
    if (observedArtifact === undefined) {
      failRelease(
        "ADMISSION_ARTIFACT_SET",
        `${localArtifact.name} is absent from the live projection`,
      );
    }
    await options.publish({ ...localArtifact, ...observedArtifact }, freshBefore);
    await options.refresh();
  }
  return options.refresh();
}
