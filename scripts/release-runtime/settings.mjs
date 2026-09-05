import { execFileSync } from "node:child_process";

import { canonicalJson, compareCanonicalStrings } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { failRelease } from "./errors.mjs";
import { canonicalRepository } from "./repository.mjs";

const rulesetId = 21_187_820;
const expectedActionPatterns = [
  "Swatinem/rust-cache@*",
  "dtolnay/rust-toolchain@*",
  "pnpm/action-setup@*",
  "rust-lang/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18",
  "taiki-e/install-action@*",
].sort();
const expectedChecks = ["Baseline Checks", "lint-and-typecheck", "test-rust", "test-ts"].sort();
const publicationEnvironments = ["crates-publish", "npm-publish"];
const rulesetField = Object.freeze({
  allowedMergeMethods: "allowed_merge_methods",
  bypassActors: "bypass_actors",
  dismissStaleReviewsOnPush: "dismiss_stale_reviews_on_push",
  doNotEnforceOnCreate: "do_not_enforce_on_create",
  refName: "ref_name",
  requireCodeOwnerReview: "require_code_owner_review",
  requireExtraApprovalForUnattributedChanges: "require_extra_approval_for_unattributed_changes",
  requireLastPushApproval: "require_last_push_approval",
  requiredApprovingReviewCount: "required_approving_review_count",
  requiredReviewThreadResolution: "required_review_thread_resolution",
  requiredReviewers: "required_reviewers",
  requiredStatusChecks: "required_status_checks",
  sourceType: "source_type",
  strictRequiredStatusChecksPolicy: "strict_required_status_checks_policy",
});
const expectedRuleset = {
  [rulesetField.bypassActors]: [],
  conditions: { [rulesetField.refName]: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
  enforcement: "active",
  id: rulesetId,
  name: "main-protect",
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      parameters: {
        [rulesetField.allowedMergeMethods]: ["merge", "rebase", "squash"],
        [rulesetField.dismissStaleReviewsOnPush]: false,
        [rulesetField.requireCodeOwnerReview]: false,
        [rulesetField.requireExtraApprovalForUnattributedChanges]: true,
        [rulesetField.requireLastPushApproval]: false,
        [rulesetField.requiredApprovingReviewCount]: 0,
        [rulesetField.requiredReviewThreadResolution]: false,
        [rulesetField.requiredReviewers]: [],
      },
      type: "pull_request",
    },
    {
      parameters: {
        [rulesetField.doNotEnforceOnCreate]: false,
        [rulesetField.requiredStatusChecks]: expectedChecks.map((context) => ({ context })),
        [rulesetField.strictRequiredStatusChecksPolicy]: false,
      },
      type: "required_status_checks",
    },
  ],
  source: canonicalRepository,
  [rulesetField.sourceType]: "Repository",
  target: "branch",
};

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function failSettings(message) {
  failRelease("SETTINGS_RELEASE_CONTROL_MISMATCH", message);
}

function normalizedRulesetProjection(ruleset) {
  const projection = structuredClone({
    [rulesetField.bypassActors]: ruleset?.[rulesetField.bypassActors],
    conditions: ruleset?.conditions,
    enforcement: ruleset?.enforcement,
    id: ruleset?.id,
    name: ruleset?.name,
    rules: ruleset?.rules,
    source: ruleset?.source,
    [rulesetField.sourceType]: ruleset?.[rulesetField.sourceType],
    target: ruleset?.target,
  });
  if (!Array.isArray(projection[rulesetField.bypassActors]) || !Array.isArray(projection.rules)) {
    failSettings("main ruleset projection is malformed");
  }
  projection[rulesetField.bypassActors].sort((left, right) =>
    compareCanonicalStrings(canonicalJson(left), canonicalJson(right)),
  );
  for (const rule of projection.rules) {
    if (Array.isArray(rule?.parameters?.[rulesetField.allowedMergeMethods])) {
      rule.parameters[rulesetField.allowedMergeMethods].sort();
    }
    if (Array.isArray(rule?.parameters?.[rulesetField.requiredReviewers])) {
      rule.parameters[rulesetField.requiredReviewers].sort((left, right) =>
        compareCanonicalStrings(canonicalJson(left), canonicalJson(right)),
      );
    }
    if (Array.isArray(rule?.parameters?.[rulesetField.requiredStatusChecks])) {
      rule.parameters[rulesetField.requiredStatusChecks].sort((left, right) =>
        compareCanonicalStrings(canonicalJson(left), canonicalJson(right)),
      );
    }
  }
  projection.rules.sort((left, right) =>
    compareCanonicalStrings(canonicalJson(left), canonicalJson(right)),
  );
  if (Array.isArray(projection.conditions?.[rulesetField.refName]?.include)) {
    projection.conditions[rulesetField.refName].include.sort();
  }
  if (Array.isArray(projection.conditions?.[rulesetField.refName]?.exclude)) {
    projection.conditions[rulesetField.refName].exclude.sort();
  }
  return projection;
}

function encodedRulesetProjection(ruleset) {
  const projection = normalizedRulesetProjection(ruleset);
  try {
    return canonicalJson(projection);
  } catch (error) {
    if (error?.code === "SETTINGS_RELEASE_CONTROL_MISMATCH") {
      throw error;
    }
    failSettings("main ruleset projection is incomplete or malformed");
  }
}

function validateEnvironment(name, environment) {
  if (
    environment?.can_admins_bypass !== true ||
    environment?.deployment_branch_policy?.protected_branches !== true ||
    environment?.deployment_branch_policy?.custom_branch_policies !== false
  ) {
    failSettings(`${name} does not use the approved protected-branch policy`);
  }
  const reviewerRules = (environment.protection_rules ?? []).filter(
    ({ type }) => type === "required_reviewers",
  );
  const waitRules = (environment.protection_rules ?? []).filter(
    ({ type }) => type === "wait_timer",
  );
  const reviewers = reviewerRules[0]?.reviewers ?? [];
  if (
    reviewerRules.length !== 1 ||
    waitRules.length !== 0 ||
    reviewerRules[0].prevent_self_review !== false ||
    reviewers.length !== 1 ||
    reviewers[0]?.type !== "User" ||
    reviewers[0]?.reviewer?.login !== "zakideee"
  ) {
    failSettings(`${name} reviewer or wait policy differs from the approved state`);
  }
}

export function validateGitHubReleaseSettings(settings) {
  if (
    settings.repository?.full_name !== canonicalRepository ||
    settings.repository?.private !== false ||
    settings.repository?.default_branch !== "main"
  ) {
    failSettings("repository identity, visibility, or default branch differs");
  }
  if (
    settings.actions?.enabled !== true ||
    settings.actions?.allowed_actions !== "selected" ||
    settings.actions?.sha_pinning_required !== true
  ) {
    failSettings("Actions enablement, selection, or SHA pinning differs");
  }
  if (
    settings.selectedActions?.github_owned_allowed !== true ||
    settings.selectedActions?.verified_allowed !== false ||
    !Array.isArray(settings.selectedActions?.patterns_allowed) ||
    !sameStrings(settings.selectedActions.patterns_allowed, expectedActionPatterns)
  ) {
    failSettings("selected Actions allowlist differs from the post-R0 release state");
  }
  if (
    settings.workflowPermissions?.default_workflow_permissions !== "read" ||
    settings.workflowPermissions?.can_approve_pull_request_reviews !== true
  ) {
    failSettings("default workflow token permissions differ");
  }
  if (encodedRulesetProjection(settings.ruleset) !== encodedRulesetProjection(expectedRuleset)) {
    failSettings("main ruleset differs from the exact approved protection projection");
  }
  for (const environmentName of publicationEnvironments) {
    validateEnvironment(environmentName, settings.environments.get(environmentName));
  }
  return { environments: publicationEnvironments, rulesetId };
}

function ghJson(arguments_, execute) {
  let stdout;
  try {
    stdout = execute("gh", ["api", ...arguments_], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease("SETTINGS_READ_FAILED", `GitHub settings read failed for ${arguments_[0]}`, {
      cause: error,
    });
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    failRelease("SETTINGS_READ_FAILED", `GitHub settings JSON is invalid for ${arguments_[0]}`, {
      cause: error,
    });
  }
}

function readGitHubReleaseSettings(options = {}) {
  const execute = options.execute ?? execFileSync;
  const prefix = `repos/${canonicalRepository}`;
  const environments = new Map(
    publicationEnvironments.map((name) => [
      name,
      ghJson([`${prefix}/environments/${name}`], execute),
    ]),
  );
  return {
    actions: ghJson([`${prefix}/actions/permissions`], execute),
    environments,
    repository: ghJson([prefix], execute),
    ruleset: ghJson([`${prefix}/rulesets/${rulesetId}`], execute),
    selectedActions: ghJson([`${prefix}/actions/permissions/selected-actions`], execute),
    workflowPermissions: ghJson([`${prefix}/actions/permissions/workflow`], execute),
  };
}

export function readAndValidateGitHubReleaseSettings(options = {}) {
  return validateGitHubReleaseSettings(readGitHubReleaseSettings(options));
}

export function validateNpmTrustedPublisher(packageName, relationship) {
  const projection = {
    environment: relationship?.environment,
    file: relationship?.file,
    packageName,
    permissions: relationship?.permissions,
    repository: relationship?.repository,
    type: relationship?.type,
  };
  if (
    projection.type !== "github" ||
    projection.repository !== canonicalRepository ||
    projection.file !== "release.yml" ||
    projection.environment !== "npm-publish" ||
    !sameStrings(projection.permissions ?? [], ["createPackage"])
  ) {
    failRelease(
      "SETTINGS_NPM_TRUST_MISMATCH",
      `${packageName} trusted publisher differs from the release workflow contract`,
    );
  }
  return projection;
}

export function readAndValidateNpmTrustedPublishers(packageNames, options = {}) {
  const execute = options.execute ?? execFileSync;
  const relationships = [];
  for (const packageName of packageNames) {
    let stdout;
    try {
      stdout = execute("npm", ["trust", "list", packageName, "--json"], {
        cwd: options.repositoryRoot,
        encoding: "utf8",
        env: options.env ?? process.env,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: releaseReadCommandTimeoutMs,
        killSignal: "SIGKILL",
      });
    } catch (error) {
      failRelease(
        "SETTINGS_NPM_TRUST_READ_FAILED",
        `${packageName} trusted publisher could not be read with the current npm authorization`,
        { cause: error },
      );
    }
    let relationship;
    try {
      relationship = JSON.parse(stdout);
    } catch (error) {
      failRelease(
        "SETTINGS_NPM_TRUST_READ_FAILED",
        `${packageName} trust response is invalid JSON`,
        {
          cause: error,
        },
      );
    }
    relationships.push(validateNpmTrustedPublisher(packageName, relationship));
  }
  return relationships;
}
