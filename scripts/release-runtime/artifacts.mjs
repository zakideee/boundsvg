import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { inspectCrateArchive, inspectNpmArchive, readTarEntries } from "./archive.mjs";
import { sha256 } from "./canonical.mjs";
import { releaseWorkCommandTimeoutMs } from "./command-limits.mjs";
import { failRelease } from "./errors.mjs";
import { boundedRequestSignal, readBoundedResponseBytes } from "./network.mjs";
import {
  extractNpmProvenanceBinding,
  parseNpmAttestations,
  validateCrateProvenance,
  validateNpmProvenance,
} from "./remote.mjs";
import { canonicalRepository } from "./repository.mjs";

const commitPattern = /^[a-f0-9]{40}$/;
const maximumRegistryArchiveBytes = 256 * 1024 * 1024;
const maximumRegistryJsonBytes = 16 * 1024 * 1024;
const maximumRegistryHtmlBytes = 4 * 1024 * 1024;

export function verifyNpmDistBytes(bytes, dist) {
  const integrityMatch = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(dist?.integrity ?? "");
  if (integrityMatch === null || !/^[a-f0-9]{40}$/.test(dist?.shasum ?? "")) {
    failRelease("NPM_DIST_METADATA_INVALID", "npm dist digest metadata is missing or malformed");
  }
  const actualSha512Bytes = createHash("sha512").update(bytes).digest();
  const expectedSha512Bytes = Buffer.from(integrityMatch[1], "base64");
  const actualShasum = createHash("sha1").update(bytes).digest("hex");
  if (!actualSha512Bytes.equals(expectedSha512Bytes) || actualShasum !== dist.shasum) {
    failRelease("NPM_DIST_DIGEST_MISMATCH", "npm tarball bytes do not match registry digests");
  }
  return { sha1: actualShasum, sha512: actualSha512Bytes.toString("hex") };
}

export function verifyCrateDownloadBytes(bytes, record) {
  if (!/^[a-f0-9]{64}$/.test(record?.checksum ?? "")) {
    failRelease("CRATE_CHECKSUM_INVALID", "crates.io record has no valid checksum");
  }
  const actual = sha256(bytes);
  if (actual !== record.checksum) {
    failRelease(
      "CRATE_DOWNLOAD_CHECKSUM_MISMATCH",
      "crate download bytes do not match the crates.io API checksum",
    );
  }
  return { sha256: actual };
}

export function verifyCrateIndexRecord(apiRecord, indexRecord) {
  if (
    indexRecord === undefined ||
    indexRecord.yanked !== false ||
    apiRecord?.yanked !== false ||
    !/^[a-f0-9]{64}$/.test(indexRecord.cksum ?? "") ||
    indexRecord.cksum !== apiRecord?.checksum
  ) {
    failRelease(
      "CRATES_INDEX_MISMATCH",
      "crate API and sparse-index checksum/yank state do not identify one exact artifact",
    );
  }
  return { checksum: indexRecord.cksum, yanked: false };
}

export function validateCarriedSource(options) {
  if (
    options.repository !== canonicalRepository ||
    !commitPattern.test(options.provenanceCommit) ||
    !commitPattern.test(options.releaseCommit) ||
    !options.isAncestor(options.provenanceCommit, options.releaseCommit)
  ) {
    failRelease(
      "CARRIED_SOURCE_INVALID",
      "carried provenance must name a canonical ancestor of the release source",
    );
  }
  return { provenanceCommit: options.provenanceCommit, releaseCommit: options.releaseCommit };
}

function run(repositoryRoot, invocation, options = {}) {
  const [commandName, ...commandArguments] = invocation;
  let stdout;
  try {
    stdout = execFileSync(commandName, commandArguments, {
      cwd: options.cwd ?? repositoryRoot,
      encoding: "utf8",
      env: options.env ?? process.env,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseWorkCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease(
      options.errorCode ?? "ARTIFACT_COMMAND_FAILED",
      `${commandName} ${commandArguments.join(" ")} failed`,
      { cause: error, exitCode: error?.status ?? 1 },
    );
  }
  options.commandLog?.push({
    argv: [
      commandName,
      ...commandArguments.map((argument) => options.redact?.(argument) ?? argument),
    ],
    cwd: options.cwdLabel ?? ".",
    exitCode: 0,
  });
  return stdout;
}

export function containedOutputPath(outputDirectory, filename) {
  const absoluteOutput = resolve(outputDirectory);
  const artifactPath = resolve(outputDirectory, filename);
  const relativePath = relative(absoluteOutput, artifactPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.includes(sep) ||
    filename.includes("\\")
  ) {
    failRelease("ARTIFACT_PATH_ESCAPE", `pack command returned unsafe filename ${filename}`);
  }
  return artifactPath;
}

export function parsePackOutput(stdout, packageName) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    failRelease("NPM_PACK_OUTPUT_INVALID", `${packageName} pack output is not JSON`, {
      cause: error,
    });
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.filename !== "string"
  ) {
    failRelease("NPM_PACK_OUTPUT_INVALID", `${packageName} pack output is not a single artifact`);
  }
  return value.filename;
}

export function buildReleaseOutputs(repositoryRoot, commandLog = []) {
  for (const script of ["build:wasm", "build:wasm:web", "build:wasm:mp4", "typecheck"]) {
    run(repositoryRoot, ["pnpm", script], { commandLog });
  }
  run(repositoryRoot, ["node", "scripts/pack-e2e.mjs"], { commandLog });
  return commandLog;
}

export function packNpmArtifacts(options) {
  mkdirSync(options.outputDirectory, { recursive: true });
  const fixedNames = new Set(options.npmModel.fixedNames);
  const packageByName = new Map(
    options.npmModel.packages.map((npmPackage) => [npmPackage.name, npmPackage]),
  );
  const artifacts = [];
  for (const packageName of options.npmModel.publishOrder) {
    const npmPackage = packageByName.get(packageName);
    const packageDirectory = dirname(join(options.repositoryRoot, npmPackage.path));
    const stdout = run(
      options.repositoryRoot,
      [
        "pnpm",
        "--config.ignore-scripts=true",
        "pack",
        "--json",
        "--pack-destination",
        options.outputDirectory,
      ],
      {
        commandLog: options.commandLog,
        cwd: packageDirectory,
        cwdLabel: dirname(npmPackage.path),
        redact(argument) {
          return argument === options.outputDirectory ? "$ARTIFACTS" : argument;
        },
      },
    );
    const returnedFilename = parsePackOutput(stdout, packageName);
    const artifactPath = containedOutputPath(options.outputDirectory, returnedFilename);
    const filename = basename(artifactPath);
    const bytes = readFileSync(artifactPath);
    const inspection = inspectNpmArchive({
      entries: readTarEntries(bytes),
      fixedPackageNames: fixedNames,
      sourceManifest: npmPackage.manifest,
      targetVersion: options.npmModel.currentVersion,
    });
    artifacts.push({
      archiveSha256: sha256(bytes),
      canonicalSha256: inspection.canonicalSha256,
      filename,
      name: packageName,
      path: artifactPath,
      version: options.npmModel.currentVersion,
    });
  }
  return artifacts;
}

export function buildCratePackageArguments(options) {
  const commandArguments = ["package", "--locked"];
  for (const crateName of options.publishOrder) {
    commandArguments.push("--package", crateName);
  }
  commandArguments.push("--target-dir", options.cargoTargetDirectory);
  if (options.allowDirty === true) {
    commandArguments.push("--allow-dirty", "--no-verify");
  } else if (options.noVerify === true) {
    commandArguments.push("--no-verify");
  }
  return commandArguments;
}

export function publicCargoDependencyMap(crates) {
  return new Map(
    crates.map((cargoPackage) => [
      cargoPackage.name,
      new Set(cargoPackage.dependencies.map(({ name }) => name)),
    ]),
  );
}

export function packageCrateArtifacts(options) {
  const cargoTargetDirectory = join(options.outputDirectory, "cargo-target");
  mkdirSync(cargoTargetDirectory, { recursive: true });
  const crateByName = new Map(
    options.cargoModel.crates.map((cargoPackage) => [cargoPackage.name, cargoPackage]),
  );
  const expectedPublicVersions = new Map(
    options.cargoModel.crates.map(({ name, version }) => [name, version]),
  );
  const expectedPublicDependencies = publicCargoDependencyMap(options.cargoModel.crates);
  const commandArguments = buildCratePackageArguments({
    allowDirty: options.allowDirty,
    cargoTargetDirectory,
    noVerify: options.noVerify,
    publishOrder: options.cargoModel.publishOrder,
  });
  run(options.repositoryRoot, ["cargo", ...commandArguments], {
    commandLog: options.commandLog,
    redact(argument) {
      return argument === cargoTargetDirectory ? "$CARGO_TARGET" : argument;
    },
  });
  const artifacts = [];
  for (const crateName of options.cargoModel.publishOrder) {
    const cargoPackage = crateByName.get(crateName);
    const filename = `${crateName}-${cargoPackage.version}.crate`;
    const artifactPath = join(cargoTargetDirectory, "package", filename);
    const bytes = readFileSync(artifactPath);
    const inspection = inspectCrateArchive({
      crateName,
      entries: readTarEntries(bytes),
      expectedPath: dirname(cargoPackage.manifestPath),
      expectedPublicDependencies,
      expectedPublicVersions,
      releaseCommit: options.releaseCommit,
      requireCleanVcs: options.allowDirty !== true,
      sourceManifest: readFileSync(join(options.repositoryRoot, cargoPackage.manifestPath)),
      version: cargoPackage.version,
    });
    artifacts.push({
      archiveSha256: sha256(bytes),
      canonicalSha256: inspection.canonicalSha256,
      filename,
      name: crateName,
      path: artifactPath,
      version: cargoPackage.version,
      vcsInfo: inspection.vcsInfo,
    });
  }
  return artifacts;
}

function validatePublicUrl(rawUrl, allowedHosts, code) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    failRelease(code, "registry supplied an invalid URL", { cause: error });
  }
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    failRelease(code, `registry supplied a URL outside the allowed hosts: ${url.hostname}`);
  }
  return url;
}

async function readPublicBytes(rawUrl, options) {
  let url = validatePublicUrl(rawUrl, options.allowedHosts, options.errorCode);
  const signal = boundedRequestSignal(options.signal, options.timeoutMs);
  let response;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    try {
      response = await (options.fetch ?? fetch)(url, {
        headers: { accept: options.accept ?? "application/octet-stream" },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      failRelease(options.errorCode, `registry download failed for ${url.hostname}`, {
        cause: error,
      });
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      break;
    }
    const location = response?.headers?.get?.("location");
    if (typeof location !== "string" || location.length === 0 || redirectCount === 5) {
      failRelease(options.errorCode, "registry download has an invalid redirect chain");
    }
    let redirectedUrl;
    try {
      redirectedUrl = new URL(location, url);
    } catch (error) {
      failRelease(options.errorCode, "registry download has an invalid redirect URL", {
        cause: error,
      });
    }
    url = validatePublicUrl(redirectedUrl.href, options.allowedHosts, options.errorCode);
  }
  if (!response.ok) {
    failRelease(options.errorCode, `registry download returned HTTP ${response.status}`);
  }
  if (response.url !== "") {
    validatePublicUrl(response.url, options.allowedHosts, options.errorCode);
  }
  return readBoundedResponseBytes(response, {
    errorCode: options.errorCode,
    label: url.hostname,
    maximumBytes: options.maximumBytes ?? maximumRegistryArchiveBytes,
  });
}

export async function auditNpmRegistryArtifact(options) {
  const record = options.registryState.records.get(options.localArtifact.version);
  if (record === undefined) {
    failRelease("NPM_ARTIFACT_MISSING", `${options.localArtifact.name} target is not published`);
  }
  if (typeof record.deprecated === "string" && record.deprecated.length > 0) {
    failRelease("NPM_ARTIFACT_DEPRECATED", `${options.localArtifact.name} target is deprecated`);
  }
  if (options.registryState.latest !== options.localArtifact.version) {
    failRelease(
      "NPM_DIST_TAG_MISMATCH",
      `${options.localArtifact.name} latest tag is not the target`,
    );
  }
  const tarballUrl = record.dist?.tarball;
  if (typeof tarballUrl !== "string") {
    failRelease("NPM_DIST_METADATA_INVALID", `${options.localArtifact.name} has no tarball URL`);
  }
  const archiveBytes = await readPublicBytes(tarballUrl, {
    allowedHosts: new Set(["registry.npmjs.org"]),
    errorCode: "NPM_REGISTRY_UNKNOWN",
    fetch: options.fetch,
    signal: options.signal,
  });
  const digests = verifyNpmDistBytes(archiveBytes, record.dist);
  const inspection = inspectNpmArchive({
    entries: readTarEntries(archiveBytes),
    fixedPackageNames: options.fixedPackageNames,
    sourceManifest: options.sourceManifest,
    targetVersion: options.localArtifact.version,
  });
  if (inspection.canonicalSha256 !== options.localArtifact.canonicalSha256) {
    failRelease(
      "NPM_CANONICAL_PAYLOAD_MISMATCH",
      `${options.localArtifact.name} registry payload differs from the audited local artifact`,
    );
  }
  const attestationUrl = record.dist?.attestations?.url;
  if (typeof attestationUrl !== "string") {
    failRelease("NPM_PROVENANCE_MISMATCH", `${options.localArtifact.name} has no attestation URL`);
  }
  const attestationBytes = await readPublicBytes(attestationUrl, {
    accept: "application/json",
    allowedHosts: new Set(["registry.npmjs.org"]),
    errorCode: "NPM_REGISTRY_UNKNOWN",
    fetch: options.fetch,
    maximumBytes: maximumRegistryJsonBytes,
    signal: options.signal,
  });
  let attestationResponse;
  try {
    attestationResponse = JSON.parse(attestationBytes.toString("utf8"));
  } catch (error) {
    failRelease("NPM_ATTESTATIONS_INVALID", "npm attestation response is invalid JSON", {
      cause: error,
    });
  }
  const statements = parseNpmAttestations(attestationResponse);
  let binding;
  if (options.expectedRun === undefined) {
    binding = extractNpmProvenanceBinding(statements, digests.sha512);
  } else if (options.expectedRun.allowEarlierAttempt === true) {
    binding = extractNpmProvenanceBinding(statements, digests.sha512);
    if (
      binding.releaseCommit !== options.releaseCommit ||
      String(binding.runId) !== String(options.expectedRun.runId) ||
      binding.runAttempt > options.expectedRun.runAttempt
    ) {
      failRelease("NPM_PROVENANCE_MISMATCH", "npm artifact is outside the original event family");
    }
  } else {
    binding = validateNpmProvenance(statements, {
      digest: digests.sha512,
      releaseCommit: options.releaseCommit,
      runAttempt: options.expectedRun.runAttempt,
      runId: options.expectedRun.runId,
    });
  }
  return {
    archiveSha256: sha256(archiveBytes),
    canonicalSha256: inspection.canonicalSha256,
    provenance: binding,
  };
}

function crateVcsInfo(entries, rootPrefix) {
  const vcsEntry = entries.find(
    (entry) => entry.type === "file" && entry.path === `${rootPrefix}/.cargo_vcs_info.json`,
  );
  if (!Buffer.isBuffer(vcsEntry?.data)) {
    failRelease("CRATE_VCS_INVALID", "crate archive has no .cargo_vcs_info.json");
  }
  try {
    return JSON.parse(vcsEntry.data.toString("utf8"));
  } catch (error) {
    failRelease("CRATE_VCS_INVALID", "crate archive VCS metadata is invalid JSON", {
      cause: error,
    });
  }
}

export async function auditCrateRegistryArtifact(options) {
  const record = options.registryState.records.get(options.localArtifact.version);
  if (record === undefined) {
    failRelease("CRATE_ARTIFACT_MISSING", `${options.localArtifact.name} target is not published`);
  }
  const downloadUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(options.localArtifact.name)}/${encodeURIComponent(options.localArtifact.version)}/download`;
  const archiveBytes = await readPublicBytes(downloadUrl, {
    allowedHosts: new Set(["crates.io", "static.crates.io"]),
    errorCode: "CRATES_REGISTRY_UNKNOWN",
    fetch: options.fetch,
    signal: options.signal,
  });
  verifyCrateDownloadBytes(archiveBytes, record);
  verifyCrateIndexRecord(
    record,
    options.registryState.indexRecords?.get(options.localArtifact.version),
  );
  const entries = readTarEntries(archiveBytes);
  const rootPrefix = `${options.localArtifact.name}-${options.localArtifact.version}`;
  const vcsInfo = crateVcsInfo(entries, rootPrefix);
  const provenanceCommit = vcsInfo.git?.sha1;
  if (!commitPattern.test(provenanceCommit ?? "")) {
    failRelease("CRATE_VCS_INVALID", "crate archive has no valid source commit");
  }
  const inspection = inspectCrateArchive({
    crateName: options.localArtifact.name,
    entries,
    expectedPath: options.expectedPath,
    expectedPublicDependencies: options.expectedPublicDependencies,
    expectedPublicVersions: options.expectedPublicVersions,
    releaseCommit: provenanceCommit,
    requireCleanVcs: true,
    sourceManifest: options.sourceManifest,
    version: options.localArtifact.version,
  });
  if (inspection.canonicalSha256 !== options.localArtifact.canonicalSha256) {
    failRelease(
      "CRATE_CANONICAL_PAYLOAD_MISMATCH",
      `${options.localArtifact.name} registry payload differs from the audited local artifact`,
    );
  }
  const publication = validateCrateProvenance(record, {
    eventCommit: options.expectedRun?.eventCommit ?? record?.trustpub_data?.sha,
    runId: options.expectedRun?.runId ?? record?.trustpub_data?.run_id,
  });
  if (options.expectedRun !== undefined && provenanceCommit !== options.releaseCommit) {
    failRelease("CRATE_VCS_MISMATCH", "crate archive source does not equal R");
  }
  return {
    archiveSha256: sha256(archiveBytes),
    canonicalSha256: inspection.canonicalSha256,
    provenanceCommit,
    publication,
    vcsInfo,
  };
}

export async function auditDocsBuild(options) {
  const url = `https://docs.rs/crate/${encodeURIComponent(options.crateName)}/${encodeURIComponent(options.version)}/builds`;
  const bytes = await readPublicBytes(url, {
    accept: "text/html",
    allowedHosts: new Set(["docs.rs"]),
    errorCode: "DOCS_BUILD_UNKNOWN",
    fetch: options.fetch,
    maximumBytes: maximumRegistryHtmlBytes,
    signal: options.signal,
  });
  const html = bytes.toString("utf8");
  if (!html.includes('title="All builds succeeded"')) {
    failRelease(
      "DOCS_BUILD_INCOMPLETE",
      `${options.crateName}@${options.version} docs.rs build has not succeeded`,
    );
  }
  return { crateName: options.crateName, version: options.version };
}
