import assert from "node:assert/strict";
import test from "node:test";

import { validateGitHubReleaseSettings, validateNpmTrustedPublisher } from "./settings.mjs";

const apiField = Object.freeze({
  actorId: "actor_id",
  actorType: "actor_type",
  allowedActions: "allowed_actions",
  allowedMergeMethods: "allowed_merge_methods",
  bypassActors: "bypass_actors",
  bypassMode: "bypass_mode",
  canAdminsBypass: "can_admins_bypass",
  canApprovePullRequestReviews: "can_approve_pull_request_reviews",
  customBranchPolicies: "custom_branch_policies",
  defaultBranch: "default_branch",
  defaultWorkflowPermissions: "default_workflow_permissions",
  deploymentBranchPolicy: "deployment_branch_policy",
  dismissStaleReviewsOnPush: "dismiss_stale_reviews_on_push",
  doNotEnforceOnCreate: "do_not_enforce_on_create",
  fullName: "full_name",
  githubOwnedAllowed: "github_owned_allowed",
  patternsAllowed: "patterns_allowed",
  preventSelfReview: "prevent_self_review",
  protectedBranches: "protected_branches",
  protectionRules: "protection_rules",
  refName: "ref_name",
  requireCodeOwnerReview: "require_code_owner_review",
  requireExtraApprovalForUnattributedChanges: "require_extra_approval_for_unattributed_changes",
  requireLastPushApproval: "require_last_push_approval",
  requiredApprovingReviewCount: "required_approving_review_count",
  requiredReviewers: "required_reviewers",
  requiredReviewThreadResolution: "required_review_thread_resolution",
  requiredStatusChecks: "required_status_checks",
  shaPinningRequired: "sha_pinning_required",
  sourceType: "source_type",
  strictRequiredStatusChecksPolicy: "strict_required_status_checks_policy",
  verifiedAllowed: "verified_allowed",
});

function fixture() {
  return {
    actions: {
      [apiField.allowedActions]: "selected",
      enabled: true,
      [apiField.shaPinningRequired]: true,
    },
    environments: new Map([
      [
        "npm-publish",
        {
          [apiField.canAdminsBypass]: true,
          [apiField.deploymentBranchPolicy]: {
            [apiField.customBranchPolicies]: false,
            [apiField.protectedBranches]: true,
          },
          [apiField.protectionRules]: [
            {
              [apiField.preventSelfReview]: false,
              reviewers: [{ reviewer: { login: "zakideee" }, type: "User" }],
              type: "required_reviewers",
            },
          ],
        },
      ],
      [
        "crates-publish",
        {
          [apiField.canAdminsBypass]: true,
          [apiField.deploymentBranchPolicy]: {
            [apiField.customBranchPolicies]: false,
            [apiField.protectedBranches]: true,
          },
          [apiField.protectionRules]: [
            {
              [apiField.preventSelfReview]: false,
              reviewers: [{ reviewer: { login: "zakideee" }, type: "User" }],
              type: "required_reviewers",
            },
          ],
        },
      ],
    ]),
    repository: {
      [apiField.defaultBranch]: "main",
      [apiField.fullName]: "zakideee/boundsvg",
      private: false,
    },
    ruleset: {
      [apiField.bypassActors]: [],
      conditions: {
        [apiField.refName]: {
          exclude: [],
          include: ["~DEFAULT_BRANCH"],
        },
      },
      enforcement: "active",
      id: 21187820,
      name: "main-protect",
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          parameters: {
            [apiField.allowedMergeMethods]: ["merge", "squash", "rebase"],
            [apiField.dismissStaleReviewsOnPush]: false,
            [apiField.requireCodeOwnerReview]: false,
            [apiField.requireExtraApprovalForUnattributedChanges]: true,
            [apiField.requireLastPushApproval]: false,
            [apiField.requiredApprovingReviewCount]: 0,
            [apiField.requiredReviewThreadResolution]: false,
            [apiField.requiredReviewers]: [],
          },
          type: "pull_request",
        },
        {
          parameters: {
            [apiField.doNotEnforceOnCreate]: false,
            [apiField.requiredStatusChecks]: [
              { context: "lint-and-typecheck" },
              { context: "test-ts" },
              { context: "test-rust" },
              { context: "Baseline Checks" },
            ],
            [apiField.strictRequiredStatusChecksPolicy]: false,
          },
          type: "required_status_checks",
        },
      ],
      source: "zakideee/boundsvg",
      [apiField.sourceType]: "Repository",
      target: "branch",
    },
    selectedActions: {
      [apiField.githubOwnedAllowed]: true,
      [apiField.patternsAllowed]: [
        "dtolnay/rust-toolchain@*",
        "Swatinem/rust-cache@*",
        "taiki-e/install-action@*",
        "pnpm/action-setup@*",
        "rust-lang/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18",
      ],
      [apiField.verifiedAllowed]: false,
    },
    workflowPermissions: {
      [apiField.canApprovePullRequestReviews]: true,
      [apiField.defaultWorkflowPermissions]: "read",
    },
  };
}

test("fresh GitHub release settings require the exact protected control surface", () => {
  const result = validateGitHubReleaseSettings(fixture());
  assert.equal(result.rulesetId, 21187820);
  assert.deepEqual(result.environments, ["crates-publish", "npm-publish"]);
});

test("settings drift never repairs itself and fails before write authority", () => {
  for (const mutate of [
    (settings) => {
      settings.actions.sha_pinning_required = false;
    },
    (settings) => {
      settings.selectedActions.patterns_allowed.push("changesets/action@*");
    },
    (settings) => {
      settings.ruleset.rules
        .find(({ type }) => type === "required_status_checks")
        .parameters.required_status_checks.pop();
    },
    (settings) => {
      settings.environments.get("npm-publish").protection_rules[0].reviewers = [];
    },
    (settings) => {
      settings.environments.get("crates-publish").deployment_branch_policy.protected_branches =
        false;
    },
    (settings) => {
      settings.ruleset.target = "tag";
    },
    (settings) => {
      delete settings.ruleset.target;
    },
    (settings) => {
      settings.ruleset.source = "attacker/fork";
    },
    (settings) => {
      settings.ruleset.conditions.ref_name.include = ["refs/heads/main"];
    },
    (settings) => {
      settings.ruleset.bypass_actors.push({
        [apiField.actorId]: 1,
        [apiField.actorType]: "Team",
        [apiField.bypassMode]: "always",
      });
    },
    (settings) => {
      settings.ruleset.rules.push({ type: "deletion" });
    },
    (settings) => {
      settings.ruleset.rules.find(
        ({ type }) => type === "pull_request",
      ).parameters.require_code_owner_review = true;
    },
    (settings) => {
      settings.ruleset.rules.find(
        ({ type }) => type === "required_status_checks",
      ).parameters.strict_required_status_checks_policy = true;
    },
  ]) {
    const settings = fixture();
    mutate(settings);
    assert.throws(
      () => validateGitHubReleaseSettings(settings),
      (error) => String(error.code).startsWith("SETTINGS_"),
    );
  }
});

test("npm trusted publisher must be the exact publish-only workflow relationship", () => {
  const relationship = {
    environment: "npm-publish",
    file: "release.yml",
    id: "opaque-relationship-id",
    permissions: ["createPackage"],
    repository: "zakideee/boundsvg",
    type: "github",
  };
  assert.deepEqual(validateNpmTrustedPublisher("@example/package", relationship), {
    environment: "npm-publish",
    file: "release.yml",
    packageName: "@example/package",
    permissions: ["createPackage"],
    repository: "zakideee/boundsvg",
    type: "github",
  });
  for (const mutate of [
    (value) => {
      value.repository = "attacker/fork";
    },
    (value) => {
      value.file = "other.yml";
    },
    (value) => {
      value.environment = "production";
    },
    (value) => {
      value.permissions.push("createStagedPackage");
    },
    (value) => [value],
  ]) {
    const changed = structuredClone(relationship);
    const result = mutate(changed) ?? changed;
    assert.throws(() => validateNpmTrustedPublisher("@example/package", result), {
      code: "SETTINGS_NPM_TRUST_MISMATCH",
    });
  }
});
