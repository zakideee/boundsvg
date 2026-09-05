import { canonicalJson } from "./canonical.mjs";
import { failRelease } from "./errors.mjs";
import { canonicalRepository } from "./repository.mjs";
import { compareStableVersions, parseStableVersion } from "./semver.mjs";

export const releasePlanSchema = "https://boundsvg.dev/release-plan/v1";

const commitPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const npmNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const crateNamePattern = /^[a-z][a-z0-9_-]*$/;
const expectedTools = Object.freeze({
  biome: "2.4.2",
  node: "22.14.0",
  npm: "11.19.0",
  pnpm: "10.29.3",
  prettier: "3.8.1",
  rustc: "1.97.0",
  wasmPack: "0.13.1",
});
const maximumCommands = 10_000;
const maximumArguments = 256;

function failPlan(message) {
  failRelease("PLAN_SHAPE_INVALID", message);
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failPlan(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, keys, label) {
  const record = assertRecord(value, label);
  const expected = [...keys].sort();
  if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(expected)) {
    failPlan(`${label} has missing or unknown fields`);
  }
  return record;
}

function assertCommit(value, label) {
  if (typeof value !== "string" || !commitPattern.test(value)) {
    failPlan(`${label} must be a full lowercase commit ID`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    failPlan(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertStableVersion(value, label) {
  try {
    parseStableVersion(value);
  } catch {
    failPlan(`${label} must be a canonical stable version`);
  }
}

function assertName(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    failPlan(`${label} is invalid`);
  }
}

function validateVersionMap(value, pattern, label) {
  const versions = assertRecord(value, label);
  for (const [name, version] of Object.entries(versions)) {
    assertName(name, pattern, `${label} name`);
    assertStableVersion(version, `${label}.${name}`);
  }
  return versions;
}

function assertUniqueNames(value, pattern, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((name) => typeof name !== "string" || !pattern.test(name)) ||
    new Set(value).size !== value.length
  ) {
    failPlan(`${label} must be a nonempty unique name array`);
  }
  return value;
}

function validateCargoDelta(cargo) {
  assertExactKeys(cargo, ["advanced", "currentVersions", "targetVersions"], "semantic.delta.cargo");
  const currentVersions = validateVersionMap(
    cargo.currentVersions,
    crateNamePattern,
    "semantic.delta.cargo.currentVersions",
  );
  const targetVersions = validateVersionMap(
    cargo.targetVersions,
    crateNamePattern,
    "semantic.delta.cargo.targetVersions",
  );
  const currentNames = Object.keys(currentVersions).sort();
  const targetNames = Object.keys(targetVersions).sort();
  if (canonicalJson(currentNames) !== canonicalJson(targetNames)) {
    failPlan("Cargo current and target version sets differ");
  }
  if (
    !Array.isArray(cargo.advanced) ||
    cargo.advanced.some((name) => typeof name !== "string" || !crateNamePattern.test(name)) ||
    new Set(cargo.advanced).size !== cargo.advanced.length ||
    canonicalJson(cargo.advanced) !== canonicalJson([...cargo.advanced].sort())
  ) {
    failPlan("semantic.delta.cargo.advanced is invalid");
  }
  const advancedNames = new Set(cargo.advanced);
  for (const name of currentNames) {
    const comparison = compareStableVersions(targetVersions[name], currentVersions[name]);
    if (
      (advancedNames.has(name) && comparison <= 0) ||
      (!advancedNames.has(name) && comparison !== 0)
    ) {
      failPlan(`${name} Cargo advance classification is inconsistent`);
    }
  }
  if (cargo.advanced.some((name) => !Object.hasOwn(targetVersions, name))) {
    failPlan("Cargo advanced set contains an unknown crate");
  }
  return { advancedNames, targetVersions };
}

function validateNpmDelta(npm) {
  assertExactKeys(npm, ["advanced", "currentVersion", "targetVersion"], "semantic.delta.npm");
  if (typeof npm.advanced !== "boolean") {
    failPlan("semantic.delta.npm.advanced must be boolean");
  }
  assertStableVersion(npm.currentVersion, "semantic.delta.npm.currentVersion");
  assertStableVersion(npm.targetVersion, "semantic.delta.npm.targetVersion");
  const comparison = compareStableVersions(npm.targetVersion, npm.currentVersion);
  if ((npm.advanced && comparison <= 0) || (!npm.advanced && comparison !== 0)) {
    failPlan("npm advance classification is inconsistent");
  }
  return npm;
}

function validateMaterializedDelta(delta) {
  assertExactKeys(delta, ["cargo", "npm", "phase"], "semantic.delta");
  if (delta.phase !== "materialized") {
    failPlan("semantic.delta phase must be materialized");
  }
  const cargo = validateCargoDelta(delta.cargo);
  const npm = validateNpmDelta(delta.npm);
  if (!npm.advanced && cargo.advancedNames.size === 0) {
    failPlan("a materialized plan must advance at least one ecosystem");
  }
  return { cargo, npm };
}

function validateArtifact(artifact, options) {
  const expectedKeys = options.advances
    ? ["canonicalSha256", "name", "state", "version"]
    : ["canonicalSha256", "name", "provenanceCommit", "state", "version"];
  assertExactKeys(artifact, expectedKeys, options.label);
  assertName(
    artifact.name,
    options.ecosystem === "npm" ? npmNamePattern : crateNamePattern,
    `${options.label}.name`,
  );
  assertDigest(artifact.canonicalSha256, `${options.label}.canonicalSha256`);
  assertStableVersion(artifact.version, `${options.label}.version`);
  if (
    artifact.version !== options.expectedVersion ||
    artifact.state !== (options.advances ? "advance" : "carried")
  ) {
    failPlan(`${options.label} differs from the target and advance classification`);
  }
  if (!options.advances) {
    assertCommit(artifact.provenanceCommit, `${options.label}.provenanceCommit`);
  }
}

function validateArtifactSet(artifacts, options) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    failPlan(`semantic.artifacts.${options.ecosystem} must be a nonempty array`);
  }
  const names = [];
  for (const [index, artifact] of artifacts.entries()) {
    const expectedVersion = options.targetVersions[artifact?.name];
    if (expectedVersion === undefined) {
      failPlan(`semantic.artifacts.${options.ecosystem}[${index}] names an unknown artifact`);
    }
    validateArtifact(artifact, {
      advances: options.advancedNames.has(artifact.name),
      ecosystem: options.ecosystem,
      expectedVersion,
      label: `semantic.artifacts.${options.ecosystem}[${index}]`,
    });
    names.push(artifact.name);
  }
  if (
    new Set(names).size !== names.length ||
    canonicalJson([...names].sort()) !== canonicalJson([...options.expectedNames].sort()) ||
    canonicalJson(names) !== canonicalJson([...names].sort())
  ) {
    failPlan(`semantic.artifacts.${options.ecosystem} has an invalid artifact set or order`);
  }
}

function validateSemantic(plan) {
  const semantic = assertExactKeys(plan.semantic, ["artifacts", "delta", "settings"], "semantic");
  if (semantic.settings !== "verified") {
    failPlan("semantic.settings must be verified");
  }
  const delta = validateMaterializedDelta(semantic.delta);
  const artifacts = assertExactKeys(semantic.artifacts, ["crates", "npm"], "semantic.artifacts");
  validateArtifactSet(artifacts.npm, {
    advancedNames: delta.npm.advanced ? new Set(plan.graphs.npmPublishOrder) : new Set(),
    ecosystem: "npm",
    expectedNames: plan.graphs.npmPublishOrder,
    targetVersions: Object.fromEntries(
      plan.graphs.npmPublishOrder.map((name) => [name, delta.npm.targetVersion]),
    ),
  });
  validateArtifactSet(artifacts.crates, {
    advancedNames: delta.cargo.advancedNames,
    ecosystem: "crates",
    expectedNames: plan.graphs.cargoPublishOrder,
    targetVersions: delta.cargo.targetVersions,
  });
  return delta;
}

function validateTargets(plan, delta) {
  const targets = assertExactKeys(plan.targets, ["crates", "npm"], "targets");
  assertStableVersion(targets.npm, "targets.npm");
  const crates = validateVersionMap(targets.crates, crateNamePattern, "targets.crates");
  if (
    targets.npm !== delta.npm.targetVersion ||
    canonicalJson(crates) !== canonicalJson(delta.cargo.targetVersions)
  ) {
    failPlan("targets differ from the semantic delta");
  }
}

function validateGraphs(plan) {
  const graphs = assertExactKeys(plan.graphs, ["cargoPublishOrder", "npmPublishOrder"], "graphs");
  assertUniqueNames(graphs.cargoPublishOrder, crateNamePattern, "graphs.cargoPublishOrder");
  if (
    !Array.isArray(graphs.npmPublishOrder) ||
    graphs.npmPublishOrder.length === 0 ||
    graphs.npmPublishOrder.some((name) => typeof name !== "string" || !npmNamePattern.test(name)) ||
    new Set(graphs.npmPublishOrder).size !== graphs.npmPublishOrder.length
  ) {
    failPlan("graphs.npmPublishOrder must be a nonempty unique name array");
  }
}

function validateInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    failPlan("inputs must be a nonempty array");
  }
  const paths = [];
  for (const [index, input] of inputs.entries()) {
    assertExactKeys(input, ["path", "sha256"], `inputs[${index}]`);
    if (typeof input.path !== "string") {
      failPlan(`inputs[${index}].path must be a string`);
    }
    assertDigest(input.sha256, `inputs[${index}].sha256`);
    paths.push(input.path);
  }
  if (
    new Set(paths).size !== paths.length ||
    canonicalJson(paths) !== canonicalJson([...paths].sort())
  ) {
    failPlan("inputs must have unique canonical path order");
  }
}

function validateCommandLog(commands) {
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > maximumCommands) {
    failPlan("commands must be a nonempty bounded array");
  }
  const allowedExecutables = new Set(["cargo", "node", "npm", "pnpm", "rustc", "wasm-pack"]);
  for (const [index, command] of commands.entries()) {
    assertExactKeys(command, ["argv", "cwd", "exitCode"], `commands[${index}]`);
    if (
      !Array.isArray(command.argv) ||
      command.argv.length === 0 ||
      command.argv.length > maximumArguments ||
      command.argv.some(
        (argument) =>
          typeof argument !== "string" ||
          argument.length === 0 ||
          argument.length > 4_096 ||
          /[\0\r\n]/.test(argument) ||
          argument.startsWith("/") ||
          /^[A-Za-z]:[\\/]/.test(argument),
      ) ||
      !allowedExecutables.has(command.argv[0]) ||
      typeof command.cwd !== "string" ||
      (command.cwd !== "." &&
        (command.cwd.includes("\\") ||
          command.cwd.startsWith("/") ||
          command.cwd.split("/").some((part) => part === "" || part === "." || part === ".."))) ||
      command.exitCode !== 0
    ) {
      failPlan(`commands[${index}] is invalid`);
    }
  }
}

export function validateReleasePlanMetadata(plan) {
  assertExactKeys(
    plan,
    [
      "commands",
      "files",
      "graphs",
      "inputs",
      "prospectiveTree",
      "repository",
      "schema",
      "semantic",
      "source",
      "targets",
      "tools",
    ],
    "release plan",
  );
  if (plan.schema !== releasePlanSchema || plan.repository !== canonicalRepository) {
    failPlan("release plan schema or repository is invalid");
  }
  const source = assertExactKeys(plan.source, ["commit", "tree"], "source");
  assertCommit(source.commit, "source.commit");
  assertCommit(source.tree, "source.tree");
  assertCommit(plan.prospectiveTree, "prospectiveTree");
  validateGraphs(plan);
  const delta = validateSemantic(plan);
  validateTargets(plan, delta);
  validateInputs(plan.inputs);
  validateCommandLog(plan.commands);
  assertExactKeys(plan.tools, Object.keys(expectedTools), "tools");
  if (canonicalJson(plan.tools) !== canonicalJson(expectedTools)) {
    failPlan("tools differ from the pinned preview toolchain");
  }
  return plan;
}
