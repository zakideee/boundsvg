import { canonicalJson } from "./canonical.mjs";
import { failRelease } from "./errors.mjs";
import { classifyRegistryMode } from "./registry.mjs";
import { canonicalRepository } from "./repository.mjs";

const commitPattern = /^[a-f0-9]{40}$/;
const releaseTargets = new Set(["crates", "npm"]);

export function validateDispatchContext(context) {
  if (context.repository !== canonicalRepository) {
    failRelease(
      "DISPATCH_REPOSITORY_MISMATCH",
      "release workflow must run in the canonical repository",
    );
  }
  if (context.ref !== "refs/heads/main") {
    failRelease("DISPATCH_REF_MISMATCH", "release workflow must be dispatched from main");
  }
  const inputKeys = Object.keys(context.inputs ?? {}).sort();
  if (inputKeys.join("\0") !== ["release-commit", "target"].join("\0")) {
    failRelease(
      "DISPATCH_INPUTS_INVALID",
      "release workflow received omitted, legacy, or unknown inputs",
    );
  }
  const releaseCommit = context.inputs["release-commit"];
  const target = context.inputs.target;
  if (!commitPattern.test(releaseCommit)) {
    failRelease("DISPATCH_RELEASE_COMMIT_INVALID", "release-commit must be 40 lowercase hex");
  }
  if (!releaseTargets.has(target)) {
    failRelease("DISPATCH_TARGET_INVALID", "target must be exactly npm or crates");
  }
  for (const [field, value] of [
    ["eventCommit", context.eventCommit],
    ["workflowSha", context.workflowSha],
  ]) {
    if (!commitPattern.test(value)) {
      failRelease("DISPATCH_CONTEXT_COMMIT_INVALID", `${field} must be 40 lowercase hex`);
    }
  }
  if (context.eventCommit !== context.workflowSha) {
    failRelease(
      "DISPATCH_WORKFLOW_SOURCE_MISMATCH",
      "workflow source commit must equal the workflow event commit",
    );
  }
  return { releaseCommit, target };
}

export function validateTrainIdentity(options) {
  for (const [field, value] of [
    ["releaseCommit", options.releaseCommit],
    ["eventCommit", options.eventCommit],
    ["mainTip", options.mainTip],
    ["parentCommit", options.parentCommit],
    ["workflowSha", options.workflowSha],
  ]) {
    if (!commitPattern.test(value)) {
      failRelease("DISPATCH_TRAIN_IDENTITY_INVALID", `${field} is not a full commit ID`);
    }
  }
  if (options.parentCount !== 1) {
    failRelease("DISPATCH_RELEASE_PARENT_COUNT", "release commit must have exactly one parent");
  }
  if (!options.releaseIsAncestorOfMain) {
    failRelease("DISPATCH_RELEASE_NONANCESTOR", "release commit is not an ancestor of fresh main");
  }
  if (
    options.eventCommit !== options.workflowSha ||
    !options.releaseIsAncestorOfEvent ||
    !options.eventIsAncestorOfMain
  ) {
    failRelease(
      "DISPATCH_EVENT_IDENTITY_INVALID",
      "workflow event/source must be on the R-to-T ancestry chain",
    );
  }
  return {
    eventCommit: options.eventCommit,
    mainTip: options.mainTip,
    releaseCommit: options.releaseCommit,
    workflowSha: options.workflowSha,
  };
}

export function verifyControlSeal(releaseSeal, mainSeal) {
  if (canonicalJson(releaseSeal) !== canonicalJson(mainSeal)) {
    failRelease("CONTROL_SEAL_DRIFT", "write-authority seal differs between R and T");
  }
  return releaseSeal;
}

function stableProjection(projection) {
  const stable = structuredClone(projection);
  delete stable.mainTip;
  delete stable.trailingCommitPhases;
  return stable;
}

export function assertApprovalProjectionStable(before, after) {
  if ((after.trailingCommitPhases ?? []).some((phase) => phase !== "steady")) {
    failRelease(
      "APPROVAL_TRAILING_MATERIALIZED",
      "main advanced through a materialized or otherwise unsafe commit",
    );
  }
  if (canonicalJson(stableProjection(before)) !== canonicalJson(stableProjection(after))) {
    failRelease(
      "APPROVAL_PROJECTION_DRIFT",
      "decision-relevant approval projection changed after approval",
    );
  }
  return after;
}

function artifactIdentity(artifact) {
  const identity = structuredClone(artifact);
  delete identity.frontier;
  delete identity.provenanceCommit;
  delete identity.state;
  return identity;
}

function stableApprovalProjection(projection) {
  const stable = structuredClone(projection);
  delete stable.artifacts;
  delete stable.mainTip;
  delete stable.mode;
  delete stable.trailingCommitPhases;
  stable.artifactIdentities = (projection.artifacts ?? []).map(artifactIdentity);
  if (stable.lease !== undefined) {
    delete stable.lease.writeRequired;
  }
  return stable;
}

function assertProjectedMode(projection) {
  const derivedMode = classifyRegistryMode(projection.artifacts ?? []).mode;
  if (projection.mode !== derivedMode) {
    failRelease("APPROVAL_MODE_INVALID", "registry mode does not match the artifact projection");
  }
  const writeRequired = derivedMode !== "AUDIT_ONLY";
  if (projection.lease?.writeRequired !== writeRequired) {
    failRelease("APPROVAL_LEASE_INVALID", "write lease does not match the registry mode");
  }
}

function assertArtifactNarrowing(beforeArtifacts, afterArtifacts, releaseCommit) {
  validateRegistryTransition(beforeArtifacts, afterArtifacts);
  const beforeByName = new Map(beforeArtifacts.map((artifact) => [artifact.name, artifact]));
  for (const afterArtifact of afterArtifacts) {
    const beforeArtifact = beforeByName.get(afterArtifact.name);
    if (
      canonicalJson(artifactIdentity(beforeArtifact)) !==
      canonicalJson(artifactIdentity(afterArtifact))
    ) {
      failRelease("APPROVAL_ARTIFACT_DRIFT", `${afterArtifact.name} artifact identity changed`);
    }
    if (beforeArtifact.state === afterArtifact.state) {
      if (
        beforeArtifact.frontier !== afterArtifact.frontier ||
        beforeArtifact.provenanceCommit !== afterArtifact.provenanceCommit
      ) {
        failRelease("APPROVAL_FRONTIER_DRIFT", `${afterArtifact.name} registry projection changed`);
      }
      continue;
    }
    if (
      beforeArtifact.state !== "missing" ||
      afterArtifact.state !== "exact" ||
      beforeArtifact.advances !== true ||
      afterArtifact.frontier !== afterArtifact.version ||
      afterArtifact.provenanceCommit !== releaseCommit
    ) {
      failRelease("APPROVAL_REGISTRY_DRIFT", `${afterArtifact.name} did not narrow to exact R`);
    }
  }
}

export function assertApprovalProjectionNarrowing(before, after) {
  if ((after.trailingCommitPhases ?? []).some((phase) => phase !== "steady")) {
    failRelease(
      "APPROVAL_TRAILING_MATERIALIZED",
      "main advanced through a materialized or otherwise unsafe commit",
    );
  }
  if (
    canonicalJson(stableApprovalProjection(before)) !==
    canonicalJson(stableApprovalProjection(after))
  ) {
    failRelease(
      "APPROVAL_PROJECTION_DRIFT",
      "decision-relevant approval projection changed after approval",
    );
  }
  assertProjectedMode(before);
  assertProjectedMode(after);
  assertArtifactNarrowing(before.artifacts ?? [], after.artifacts ?? [], before.releaseCommit);
  return after;
}

export function validateRegistryTransition(beforeEntries, afterEntries) {
  const before = new Map(beforeEntries.map((entry) => [entry.name, entry.state]));
  const after = new Map(afterEntries.map((entry) => [entry.name, entry.state]));
  if (
    before.size !== beforeEntries.length ||
    after.size !== afterEntries.length ||
    before.size !== after.size ||
    [...before.keys()].some((name) => !after.has(name))
  ) {
    failRelease("REGISTRY_TRANSITION_INVALID", "registry transition changed the artifact set");
  }
  for (const [name, beforeState] of before) {
    const afterState = after.get(name);
    const valid =
      (beforeState === "missing" && (afterState === "missing" || afterState === "exact")) ||
      (beforeState === "exact" && afterState === "exact");
    if (!valid) {
      failRelease(
        "REGISTRY_TRANSITION_INVALID",
        `${name} changed from ${beforeState} to ${afterState}`,
      );
    }
  }
  return { writeRequired: [...after.values()].includes("missing") };
}
