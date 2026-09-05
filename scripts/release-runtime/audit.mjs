import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { verifyControlSeal } from "./admission.mjs";
import {
  auditDocsBuild,
  buildReleaseOutputs,
  packageCrateArtifacts,
  packNpmArtifacts,
} from "./artifacts.mjs";
import { canonicalJson, sha256 } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { asReleaseControlError, failRelease } from "./errors.mjs";
import { resolveCommit, verifyRepositoryDelta } from "./git-files.mjs";
import { classifyRegistryMode, docsBuildPolicy, pollRegistry } from "./registry.mjs";
import { canonicalRepository, loadRepositoryState } from "./repository.mjs";
import { buildControlSeal } from "./seal.mjs";
import {
  readAndValidateGitHubReleaseSettings,
  readAndValidateNpmTrustedPublishers,
} from "./settings.mjs";
import {
  assertWorkflowToolchain,
  classifyCrateArtifacts,
  classifyNpmArtifacts,
  classifyTrailingCommits,
  fetchFreshMain,
  gitIsAncestor,
  loadAdmissionReport,
  readRegistryState,
  releaseParent,
  validateRequiredChecks,
} from "./workflow-core.mjs";

const commitPattern = /^[a-f0-9]{40}$/;
const auditPhases = new Set(["post-crates", "post-npm", "pre-crates", "pre-npm", "pre-tag"]);

function parseOptionPairs(commandArguments) {
  if (commandArguments.length % 2 !== 0) {
    failRelease("ARGUMENT_OPTIONS_INVALID", "audit options must be name-value pairs", {
      exitCode: 2,
    });
  }
  const values = new Map();
  for (let index = 0; index < commandArguments.length; index += 2) {
    const name = commandArguments[index];
    const value = commandArguments[index + 1];
    if (
      !["--phase", "--release-commit", "--report"].includes(name) ||
      typeof value !== "string" ||
      value === "" ||
      value.startsWith("--") ||
      values.has(name)
    ) {
      failRelease("ARGUMENT_OPTIONS_INVALID", "audit options are invalid", { exitCode: 2 });
    }
    values.set(name, value);
  }
  return values;
}

export function parseAuditArguments(commandArguments) {
  const values = parseOptionPairs(commandArguments);
  const actualNames = [...values.keys()].sort();
  const expectedWithoutReport = ["--phase", "--release-commit"];
  const expectedWithReport = [...expectedWithoutReport, "--report"];
  if (
    ![expectedWithoutReport, expectedWithReport].some(
      (expectedNames) => expectedNames.sort().join("\0") === actualNames.join("\0"),
    )
  ) {
    failRelease(
      "ARGUMENT_OPTIONS_INVALID",
      "audit requires phase, commit, and only an optional report",
      {
        exitCode: 2,
      },
    );
  }
  const phase = values.get("--phase");
  const releaseCommit = values.get("--release-commit");
  if (!auditPhases.has(phase)) {
    failRelease("ARGUMENT_PHASE_INVALID", "audit phase is invalid", { exitCode: 2 });
  }
  if (!commitPattern.test(releaseCommit)) {
    failRelease("ARGUMENT_RELEASE_COMMIT_INVALID", "release commit must be 40 lowercase hex", {
      exitCode: 2,
    });
  }
  return { phase, releaseCommit, report: values.get("--report") };
}

function allExact(artifacts) {
  return artifacts.every(({ state }) => state === "exact");
}

export function validateAuditPhaseArtifacts(phase, artifacts) {
  if (!auditPhases.has(phase)) {
    failRelease("AUDIT_PHASE_INVALID", `unsupported audit phase ${phase}`);
  }
  const npmMode = classifyRegistryMode(artifacts.npm).mode;
  const cratesMode = classifyRegistryMode(artifacts.crates).mode;
  if (
    ["post-npm", "pre-crates", "post-crates", "pre-tag"].includes(phase) &&
    !allExact(artifacts.npm)
  ) {
    failRelease("AUDIT_NPM_NOT_EXACT", `${phase} requires every npm artifact to be exact`);
  }
  if (["post-crates", "pre-tag"].includes(phase) && !allExact(artifacts.crates)) {
    failRelease("AUDIT_CRATES_NOT_EXACT", `${phase} requires every crate artifact to be exact`);
  }
  return { cratesMode, npmMode };
}

function command(repositoryRoot, invocation, options = {}) {
  const [commandName, ...commandArguments] = invocation;
  try {
    return (options.execute ?? execFileSync)(commandName, commandArguments, {
      cwd: repositoryRoot,
      encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease(options.errorCode ?? "AUDIT_COMMAND_FAILED", `${commandName} failed`, {
      cause: error,
    });
  }
}

function normalizedRemoteUrl(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function assertAuditSource(repositoryRoot, releaseCommit, execute) {
  const remote = command(repositoryRoot, ["git", "remote", "get-url", "origin"], { execute });
  if (normalizedRemoteUrl(remote) !== `https://github.com/${canonicalRepository}`) {
    failRelease("AUDIT_REMOTE_MISMATCH", "origin is not the canonical repository");
  }
  if (resolveCommit(repositoryRoot, "HEAD") !== releaseCommit) {
    failRelease("AUDIT_CHECKOUT_MISMATCH", "audit checkout HEAD must equal R");
  }
  const status = command(repositoryRoot, ["git", "status", "--porcelain=v2", "-z"], {
    encoding: null,
    execute,
  });
  if (status.length !== 0) {
    failRelease("AUDIT_CHECKOUT_DIRTY", "audit requires a clean tracked and untracked checkout");
  }
}

function loadOptionalReport(reportPath, releaseCommit) {
  if (reportPath === undefined) {
    return undefined;
  }
  let reportStats;
  try {
    reportStats = lstatSync(reportPath);
  } catch (error) {
    failRelease("AUDIT_REPORT_PATH_INVALID", "report must name a regular admission.json file", {
      cause: error,
    });
  }
  if (
    basename(reportPath) !== "admission.json" ||
    !reportStats.isFile() ||
    reportStats.isSymbolicLink()
  ) {
    failRelease("AUDIT_REPORT_PATH_INVALID", "report must name a regular admission.json file");
  }
  const report = loadAdmissionReport(dirname(reportPath));
  if (report.releaseCommit !== releaseCommit) {
    failRelease("AUDIT_REPORT_COMMIT_MISMATCH", "admission report does not describe R");
  }
  return report;
}

export function assertReportArtifacts(report, localArtifacts) {
  if (report === undefined) {
    return;
  }
  const carriedEcosystems = report.target === "crates" ? ["crates", "npm"] : ["npm"];
  for (const ecosystem of carriedEcosystems) {
    const reportArtifacts = report.bundle[ecosystem].map(({ canonicalSha256, name, version }) => ({
      canonicalSha256,
      name,
      version,
    }));
    const rebuiltArtifacts = localArtifacts[ecosystem].map(
      ({ canonicalSha256, name, version }) => ({ canonicalSha256, name, version }),
    );
    if (canonicalJson(reportArtifacts) !== canonicalJson(rebuiltArtifacts)) {
      failRelease("AUDIT_REPORT_ARTIFACT_MISMATCH", `${ecosystem} report artifacts differ from R`);
    }
  }
}

async function auditCrateDocumentation(crateArtifacts, options) {
  await Promise.all(
    crateArtifacts.map((artifact) =>
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
        sleep:
          options.sleep ??
          ((delayMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs))),
      }),
    ),
  );
}

function reportTargetForPhase(phase) {
  if (["pre-npm", "post-npm"].includes(phase)) {
    return "npm";
  }
  if (["pre-crates", "post-crates"].includes(phase)) {
    return "crates";
  }
  return undefined;
}

function validateAuditReportProjection(report, options) {
  if (report === undefined) {
    return;
  }
  const expectedTarget = reportTargetForPhase(options.phase);
  if (expectedTarget !== undefined && report.target !== expectedTarget) {
    failRelease(
      "AUDIT_REPORT_TARGET_MISMATCH",
      "admission report target differs from the audit phase",
    );
  }
  if (
    report.seal.sha256 !== options.releaseSeal.sha256 ||
    report.seal.publishSetHash !== sha256(canonicalJson(options.releaseSeal.publishSet)) ||
    canonicalJson(report.delta) !==
      canonicalJson({
        cargo: options.delta.cargo,
        npm: options.delta.npm,
        phase: options.delta.phase,
      })
  ) {
    failRelease("AUDIT_REPORT_PROJECTION_MISMATCH", "admission report differs from R");
  }
}

export async function finalizeAuditAfterDocumentation(phase, initialProjection, options) {
  if (!["post-crates", "pre-tag"].includes(phase)) {
    return initialProjection;
  }
  await options.auditDocumentation(initialProjection.crateArtifacts);
  return phase === "pre-tag" ? options.refreshProjection() : initialProjection;
}

async function readFinalPreTagProjection({
  localArtifacts,
  options,
  parsed,
  report,
  repositoryRoot,
}) {
  assertAuditSource(repositoryRoot, parsed.releaseCommit, options.execute);
  const mainTip = fetchFreshMain(repositoryRoot);
  if (!gitIsAncestor(repositoryRoot, parsed.releaseCommit, mainTip)) {
    failRelease("AUDIT_RELEASE_NONANCESTOR", "R is not an ancestor of fresh main");
  }
  const parentCommit = releaseParent(repositoryRoot, parsed.releaseCommit);
  const delta = verifyRepositoryDelta(repositoryRoot, parentCommit);
  if (delta.phase !== "materialized" || delta.baseCommit !== parentCommit) {
    failRelease("AUDIT_RELEASE_NOT_MATERIALIZED", "R is not one exact materialized version commit");
  }
  const state = loadRepositoryState(repositoryRoot);
  const trailingCommitPhases = classifyTrailingCommits(repositoryRoot, {
    mainTip,
    releaseCommit: parsed.releaseCommit,
    state,
  });
  const releaseSeal = buildControlSeal(repositoryRoot, parsed.releaseCommit);
  verifyControlSeal(releaseSeal, buildControlSeal(repositoryRoot, mainTip));
  validateAuditReportProjection(report, { delta, phase: parsed.phase, releaseSeal });
  await (options.validateRequiredChecks ?? validateRequiredChecks)(
    repositoryRoot,
    parsed.releaseCommit,
  );
  await (options.validateGitHubSettings ?? readAndValidateGitHubReleaseSettings)();
  assertReportArtifacts(report, localArtifacts);
  const registry = await (options.readRegistry ?? readRegistryState)(state, {
    fetch: options.fetch,
  });
  const npmArtifacts = await classifyNpmArtifacts({
    delta,
    fetch: options.fetch,
    localArtifacts: localArtifacts.npm,
    registry,
    releaseCommit: parsed.releaseCommit,
    repositoryRoot,
    run: report?.target === "npm" ? report.run : undefined,
    selectedTarget: report?.target,
    state,
  });
  const crateArtifacts = await classifyCrateArtifacts({
    delta,
    fetch: options.fetch,
    localArtifacts: localArtifacts.crates,
    mainTip,
    registry,
    releaseCommit: parsed.releaseCommit,
    repositoryRoot,
    run: report?.target === "crates" ? report.run : undefined,
    state,
  });
  const modes = validateAuditPhaseArtifacts(parsed.phase, {
    crates: crateArtifacts,
    npm: npmArtifacts,
  });
  return {
    crateArtifacts,
    result: {
      delta,
      report,
      state,
      summary: {
        crates: { artifacts: crateArtifacts.length, mode: modes.cratesMode },
        mainTip,
        npm: { artifacts: npmArtifacts.length, mode: modes.npmMode },
        phase: parsed.phase,
        releaseCommit: parsed.releaseCommit,
        trailingCommitPhases,
      },
    },
  };
}

export async function auditRelease(repositoryRoot, parsed, options = {}) {
  assertAuditSource(repositoryRoot, parsed.releaseCommit, options.execute);
  const report = loadOptionalReport(parsed.report, parsed.releaseCommit);
  const mainTip = fetchFreshMain(repositoryRoot);
  if (!gitIsAncestor(repositoryRoot, parsed.releaseCommit, mainTip)) {
    failRelease("AUDIT_RELEASE_NONANCESTOR", "R is not an ancestor of fresh main");
  }
  const parentCommit = releaseParent(repositoryRoot, parsed.releaseCommit);
  const delta = verifyRepositoryDelta(repositoryRoot, parentCommit);
  if (delta.phase !== "materialized" || delta.baseCommit !== parentCommit) {
    failRelease("AUDIT_RELEASE_NOT_MATERIALIZED", "R is not one exact materialized version commit");
  }
  const state = loadRepositoryState(repositoryRoot);
  const trailingCommitPhases = classifyTrailingCommits(repositoryRoot, {
    mainTip,
    releaseCommit: parsed.releaseCommit,
    state,
  });
  const releaseSeal = buildControlSeal(repositoryRoot, parsed.releaseCommit);
  verifyControlSeal(releaseSeal, buildControlSeal(repositoryRoot, mainTip));
  validateAuditReportProjection(report, { delta, phase: parsed.phase, releaseSeal });
  await (options.validateRequiredChecks ?? validateRequiredChecks)(
    repositoryRoot,
    parsed.releaseCommit,
  );
  await (options.validateGitHubSettings ?? readAndValidateGitHubReleaseSettings)();
  await (options.validateToolchain ?? assertWorkflowToolchain)(repositoryRoot);

  const temporaryRoot = mkdtempSync(join(tmpdir(), "boundsvg-release-audit-"));
  try {
    const commandLog = [];
    buildReleaseOutputs(repositoryRoot, commandLog);
    const localArtifacts = {
      crates: packageCrateArtifacts({
        cargoModel: state.cargo,
        commandLog,
        noVerify: true,
        outputDirectory: join(temporaryRoot, "crates"),
        releaseCommit: parsed.releaseCommit,
        repositoryRoot,
      }),
      npm: packNpmArtifacts({
        commandLog,
        npmModel: state.npm,
        outputDirectory: join(temporaryRoot, "npm"),
        repositoryRoot,
      }),
    };
    const statusAfterBuild = command(repositoryRoot, ["git", "status", "--porcelain=v2", "-z"], {
      encoding: null,
      execute: options.execute,
    });
    if (statusAfterBuild.length !== 0) {
      failRelease(
        "AUDIT_BUILD_MUTATED_SOURCE",
        "release build changed tracked or untracked source",
      );
    }
    assertReportArtifacts(report, localArtifacts);
    const registry = await (options.readRegistry ?? readRegistryState)(state, {
      fetch: options.fetch,
    });
    const npmArtifacts = await classifyNpmArtifacts({
      delta,
      fetch: options.fetch,
      localArtifacts: localArtifacts.npm,
      registry,
      releaseCommit: parsed.releaseCommit,
      repositoryRoot,
      run: report?.target === "npm" ? report.run : undefined,
      selectedTarget: report?.target,
      state,
    });
    const crateArtifacts = await classifyCrateArtifacts({
      delta,
      fetch: options.fetch,
      localArtifacts: localArtifacts.crates,
      mainTip,
      registry,
      releaseCommit: parsed.releaseCommit,
      repositoryRoot,
      run: report?.target === "crates" ? report.run : undefined,
      state,
    });
    const modes = validateAuditPhaseArtifacts(parsed.phase, {
      crates: crateArtifacts,
      npm: npmArtifacts,
    });
    if (parsed.phase === "pre-npm" && modes.npmMode !== "AUDIT_ONLY") {
      await (options.validateNpmTrustedPublishers ?? readAndValidateNpmTrustedPublishers)(
        state.npm.fixedNames,
        { repositoryRoot },
      );
    }
    const initialProjection = {
      crateArtifacts,
      result: {
        delta,
        report,
        state,
        summary: {
          crates: { artifacts: crateArtifacts.length, mode: modes.cratesMode },
          mainTip,
          npm: { artifacts: npmArtifacts.length, mode: modes.npmMode },
          phase: parsed.phase,
          releaseCommit: parsed.releaseCommit,
          trailingCommitPhases,
        },
      },
    };
    const finalProjection = await finalizeAuditAfterDocumentation(parsed.phase, initialProjection, {
      auditDocumentation: (artifacts) => auditCrateDocumentation(artifacts, options),
      refreshProjection: () =>
        readFinalPreTagProjection({ localArtifacts, options, parsed, report, repositoryRoot }),
    });
    return finalProjection.result;
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}
