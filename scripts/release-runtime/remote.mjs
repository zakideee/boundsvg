import { failRelease, ReleaseControlError } from "./errors.mjs";
import { boundedRequestSignal, readBoundedResponseBytes } from "./network.mjs";
import { canonicalRepository } from "./repository.mjs";

const stableVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const commitPattern = /^[a-f0-9]{40}$/;
const releaseWorkflowPath = ".github/workflows/release.yml";
const githubBuilderId = "https://github.com/actions/runner/github-hosted";
const githubWorkflowBuildType =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const canonicalRepositoryUrl = `https://github.com/${canonicalRepository}`;
const maximumRegistryMetadataBytes = 32 * 1024 * 1024;
const cratesSparseIndexBaseUrl = "https://index.crates.io";

async function fetchJson(url, options, errorCode) {
  let response;
  try {
    response = await options.fetch(url, {
      headers: { accept: "application/json", "user-agent": "boundsvg-release-control" },
      redirect: "error",
      signal: boundedRequestSignal(options.signal, options.timeoutMs),
    });
  } catch (error) {
    failRelease(errorCode, `request failed for ${url}`, { cause: error });
  }
  let value;
  try {
    const bytes = await readBoundedResponseBytes(response, {
      errorCode,
      label: url,
      maximumBytes: maximumRegistryMetadataBytes,
    });
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof ReleaseControlError) {
      throw error;
    }
    failRelease(errorCode, `registry returned non-JSON for ${url}`, { cause: error });
  }
  return { response, value };
}

export async function readNpmRegistryState(packageName, options = {}) {
  const request = options.fetch ?? fetch;
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const { response, value } = await fetchJson(
    url,
    { fetch: request, signal: options.signal, timeoutMs: options.timeoutMs },
    "NPM_REGISTRY_UNKNOWN",
  );
  if (response.status === 404) {
    return {
      deprecated: new Set(),
      latest: undefined,
      records: new Map(),
      state: value?.time?.unpublished === undefined ? "missing-package" : "tombstone",
      versions: [],
    };
  }
  if (!response.ok || value === null || typeof value !== "object" || Array.isArray(value)) {
    failRelease("NPM_REGISTRY_UNKNOWN", `${packageName} registry state is unavailable`);
  }
  if (
    value.versions === null ||
    typeof value.versions !== "object" ||
    Array.isArray(value.versions)
  ) {
    failRelease("NPM_REGISTRY_UNKNOWN", `${packageName} registry versions are malformed`);
  }
  const records = new Map();
  const deprecated = new Set();
  for (const [version, record] of Object.entries(value.versions)) {
    if (!stableVersionPattern.test(version)) {
      continue;
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      failRelease("NPM_REGISTRY_UNKNOWN", `${packageName}@${version} metadata is malformed`);
    }
    records.set(version, record);
    if (typeof record.deprecated === "string" && record.deprecated.length > 0) {
      deprecated.add(version);
    }
  }
  return {
    deprecated,
    latest: value["dist-tags"]?.latest,
    records,
    state: "known",
    versions: [...records.keys()].sort(),
  };
}

export async function readCrateRegistryState(crateName, options = {}) {
  const request = options.fetch ?? fetch;
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}`;
  const { response, value } = await fetchJson(
    url,
    { fetch: request, signal: options.signal, timeoutMs: options.timeoutMs },
    "CRATES_REGISTRY_UNKNOWN",
  );
  if (response.status === 404) {
    return {
      records: new Map(),
      state: "missing-package",
      trustedPublishingOnly: null,
      versions: [],
      yanked: new Set(),
    };
  }
  if (
    !response.ok ||
    !Array.isArray(value?.versions) ||
    typeof value?.crate?.trustpub_only !== "boolean"
  ) {
    failRelease("CRATES_REGISTRY_UNKNOWN", `${crateName} registry state is unavailable`);
  }
  const records = new Map();
  const yanked = new Set();
  for (const record of value.versions) {
    if (record === null || typeof record !== "object" || !stableVersionPattern.test(record.num)) {
      continue;
    }
    if (records.has(record.num)) {
      failRelease("CRATES_REGISTRY_UNKNOWN", `${crateName}@${record.num} is duplicated`);
    }
    records.set(record.num, record);
    if (record.yanked === true) {
      yanked.add(record.num);
    }
  }
  return {
    records,
    state: "known",
    trustedPublishingOnly: value.crate.trustpub_only,
    versions: [...records.keys()].sort(),
    yanked,
  };
}

function crateSparseIndexPath(crateName) {
  const normalizedName = crateName.toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalizedName)) {
    failRelease("CRATES_INDEX_UNKNOWN", `${crateName} is not a valid sparse-index crate name`);
  }
  if (normalizedName.length === 1) {
    return `1/${normalizedName}`;
  }
  if (normalizedName.length === 2) {
    return `2/${normalizedName}`;
  }
  if (normalizedName.length === 3) {
    return `3/${normalizedName[0]}/${normalizedName}`;
  }
  return `${normalizedName.slice(0, 2)}/${normalizedName.slice(2, 4)}/${normalizedName}`;
}

export async function readCrateSparseIndexState(crateName, options = {}) {
  const request = options.fetch ?? fetch;
  const url = `${cratesSparseIndexBaseUrl}/${crateSparseIndexPath(crateName)}`;
  let response;
  try {
    response = await request(url, {
      headers: {
        accept: "text/plain",
        "user-agent": "boundsvg-release-control",
      },
      redirect: "error",
      signal: boundedRequestSignal(options.signal, options.timeoutMs),
    });
  } catch (error) {
    failRelease("CRATES_INDEX_UNKNOWN", `request failed for ${url}`, { cause: error });
  }
  if (response.status === 404) {
    return { records: new Map(), state: "missing-package", versions: [], yanked: new Set() };
  }
  if (!response.ok) {
    failRelease("CRATES_INDEX_UNKNOWN", `${crateName} sparse-index state is unavailable`);
  }
  const bytes = await readBoundedResponseBytes(response, {
    errorCode: "CRATES_INDEX_UNKNOWN",
    label: url,
    maximumBytes: maximumRegistryMetadataBytes,
  });
  const records = new Map();
  const yanked = new Set();
  const lines = bytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    failRelease("CRATES_INDEX_UNKNOWN", `${crateName} sparse-index entry is empty`);
  }
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      failRelease("CRATES_INDEX_UNKNOWN", `${crateName} sparse-index JSON is invalid`, {
        cause: error,
      });
    }
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      typeof record.vers !== "string" ||
      record.name?.toLowerCase() !== crateName.toLowerCase() ||
      !/^[a-f0-9]{64}$/.test(record.cksum ?? "") ||
      typeof record.yanked !== "boolean"
    ) {
      failRelease("CRATES_INDEX_UNKNOWN", `${crateName} sparse-index record is malformed`);
    }
    if (!stableVersionPattern.test(record.vers)) {
      continue;
    }
    if (records.has(record.vers)) {
      failRelease("CRATES_INDEX_UNKNOWN", `${crateName}@${record.vers} is duplicated in the index`);
    }
    records.set(record.vers, record);
    if (record.yanked) {
      yanked.add(record.vers);
    }
  }
  return { records, state: "known", versions: [...records.keys()].sort(), yanked };
}

export function validateCrateRegistryProjection(crateName, apiState, indexState) {
  if (
    apiState?.state !== indexState?.state ||
    !Array.isArray(apiState?.versions) ||
    !Array.isArray(indexState?.versions) ||
    apiState.versions.join("\0") !== indexState.versions.join("\0")
  ) {
    failRelease(
      "CRATES_INDEX_MISMATCH",
      `${crateName} API and sparse-index version frontiers differ`,
    );
  }
  for (const version of apiState.versions) {
    const apiRecord = apiState.records.get(version);
    const indexRecord = indexState.records.get(version);
    if (
      apiRecord?.checksum !== indexRecord?.cksum ||
      apiRecord?.yanked !== indexRecord?.yanked ||
      apiState.yanked.has(version) !== indexState.yanked.has(version)
    ) {
      failRelease(
        "CRATES_INDEX_MISMATCH",
        `${crateName}@${version} API and sparse-index records differ`,
      );
    }
  }
  return { ...apiState, indexRecords: indexState.records };
}

export async function readCrateRegistryProjection(crateName, options = {}) {
  const [apiState, indexState] = await Promise.all([
    readCrateRegistryState(crateName, options),
    readCrateSparseIndexState(crateName, options),
  ]);
  return validateCrateRegistryProjection(crateName, apiState, indexState);
}

export function parseNpmAttestations(responseValue) {
  const bundles = Array.isArray(responseValue) ? responseValue : responseValue?.attestations;
  if (!Array.isArray(bundles) || bundles.length === 0) {
    failRelease("NPM_ATTESTATIONS_INVALID", "npm attestation response is empty or malformed");
  }
  const statements = [];
  for (const entry of bundles) {
    const payload = entry?.bundle?.dsseEnvelope?.payload;
    if (typeof payload !== "string") {
      failRelease("NPM_ATTESTATIONS_INVALID", "npm attestation has no DSSE payload");
    }
    try {
      statements.push(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    } catch (error) {
      failRelease("NPM_ATTESTATIONS_INVALID", "npm attestation payload is invalid", {
        cause: error,
      });
    }
  }
  return statements;
}

function npmStatementMatches(statement, expected) {
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow;
  const dependencies = statement?.predicate?.buildDefinition?.resolvedDependencies;
  const builderId = statement?.predicate?.runDetails?.builder?.id;
  const invocationId = statement?.predicate?.runDetails?.metadata?.invocationId;
  const subjectMatches = statement?.subject?.some(
    (subject) => subject?.digest?.sha512 === expected.digest,
  );
  const sourceMatches = dependencies?.some(
    (dependency) =>
      dependency?.digest?.gitCommit === expected.releaseCommit &&
      dependency?.uri === `git+https://github.com/${canonicalRepository}@refs/heads/main`,
  );
  return (
    statement?._type === "https://in-toto.io/Statement/v1" &&
    statement?.predicateType === "https://slsa.dev/provenance/v1" &&
    statement?.predicate?.buildDefinition?.buildType === githubWorkflowBuildType &&
    subjectMatches === true &&
    workflow?.ref === "refs/heads/main" &&
    workflow?.repository === canonicalRepositoryUrl &&
    workflow?.path === releaseWorkflowPath &&
    sourceMatches === true &&
    builderId === githubBuilderId &&
    invocationId ===
      `https://github.com/${canonicalRepository}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}`
  );
}

function parseInvocationId(invocationId) {
  const pattern = new RegExp(
    `^https://github\\.com/${canonicalRepository.replace("/", "\\/")}/actions/runs/(\\d+)/attempts/(\\d+)$`,
  );
  const match = pattern.exec(invocationId ?? "");
  if (match === null) {
    return undefined;
  }
  return { runAttempt: Number.parseInt(match[2], 10), runId: match[1] };
}

export function extractNpmProvenanceBinding(statements, digest) {
  const bindings = [];
  for (const statement of statements) {
    const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow;
    const dependencies = statement?.predicate?.buildDefinition?.resolvedDependencies;
    const builderId = statement?.predicate?.runDetails?.builder?.id;
    const invocation = parseInvocationId(statement?.predicate?.runDetails?.metadata?.invocationId);
    const source = dependencies?.find(
      (dependency) =>
        commitPattern.test(dependency?.digest?.gitCommit ?? "") &&
        dependency?.uri === `git+https://github.com/${canonicalRepository}@refs/heads/main`,
    );
    if (
      statement?._type === "https://in-toto.io/Statement/v1" &&
      statement?.predicateType === "https://slsa.dev/provenance/v1" &&
      statement?.predicate?.buildDefinition?.buildType === githubWorkflowBuildType &&
      statement?.subject?.some((subject) => subject?.digest?.sha512 === digest) &&
      workflow?.ref === "refs/heads/main" &&
      workflow?.repository === canonicalRepositoryUrl &&
      workflow?.path === releaseWorkflowPath &&
      builderId === githubBuilderId &&
      source !== undefined &&
      invocation !== undefined
    ) {
      bindings.push({
        releaseCommit: source.digest.gitCommit,
        runAttempt: invocation.runAttempt,
        runId: invocation.runId,
      });
    }
  }
  const unique = new Map(
    bindings.map((binding) => [
      `${binding.releaseCommit}\0${binding.runId}\0${binding.runAttempt}`,
      binding,
    ]),
  );
  if (unique.size !== 1) {
    failRelease(
      "NPM_PROVENANCE_MISMATCH",
      "npm provenance does not yield one canonical source/run binding",
    );
  }
  return [...unique.values()][0];
}

export function validateNpmProvenance(statements, expected) {
  if (
    !Array.isArray(statements) ||
    !statements.some((statement) => npmStatementMatches(statement, expected))
  ) {
    failRelease(
      "NPM_PROVENANCE_MISMATCH",
      "npm provenance does not bind the audited digest to R and the expected workflow run",
    );
  }
  return {
    releaseCommit: expected.releaseCommit,
    runAttempt: expected.runAttempt,
    runId: expected.runId,
  };
}

export function validateCrateProvenance(record, expected) {
  const trust = record?.trustpub_data;
  if (
    record?.yanked !== false ||
    trust?.provider !== "github" ||
    trust?.repository !== canonicalRepository ||
    String(trust?.run_id) !== String(expected.runId) ||
    !commitPattern.test(trust?.sha ?? "") ||
    trust.sha !== expected.eventCommit
  ) {
    failRelease(
      "CRATE_PROVENANCE_MISMATCH",
      "crate metadata does not bind a non-yanked artifact to the expected workflow event and run",
    );
  }
  return { eventCommit: expected.eventCommit, runId: String(expected.runId) };
}
