import assert from "node:assert/strict";
import test from "node:test";
import { loadRepositoryState } from "./repository.mjs";
import { buildControlSeal } from "./seal.mjs";
import * as topology from "./topology.mjs";

const workspace = (patterns, setting = 1) =>
  `packages:\n${patterns.map((path) => `  - "${path}"`).join("\n")}\nminimumReleaseAge: ${setting}\n`;
function rejectAll(parser, code, sources) {
  sources.forEach((source) => {
    assert.throws(() => parser(source), { code });
  });
}
test("workspace syntax, adapters, metadata, and semantic drift are closed", () => {
  const parsePnpm = topology.parsePnpmWorkspacePatterns;
  const patterns = ["packages/core", "missing/*"];
  assert.deepEqual(parsePnpm(workspace(patterns)), patterns);
  rejectAll(parsePnpm, "WORKSPACE_SYNTAX_INVALID", [
    "packages: ['packages/*']",
    "packages:\n  - packages/*",
    ...["!packages/core", "packages/**", "packages/{core,cli}"].map((path) => workspace([path])),
    `${workspace(["packages/*"])}packages:\n  - "apps/*"\n`,
  ]);
  const repositoryRoot = process.cwd();
  const runtime = loadRepositoryState(repositoryRoot).npm.packages.map(({ name, path }) => ({
    name,
    path: path.slice(0, -"/package.json".length),
  }));
  assert.deepEqual(runtime, buildControlSeal(repositoryRoot, "HEAD").publishSet.npm);
  const value = { name: "core", publishConfig: { access: "public" } };
  const projectNpm = (path) =>
    topology.projectNpmTopology([{ path: `${path}/package.json`, value }], { fixed: [["core"]] })
      .publishSet;
  assert.deepEqual(parsePnpm(workspace(["p"], 1)), parsePnpm(workspace(["p"], 2)));
  assert.notDeepEqual(projectNpm("packages/core"), projectNpm("moved/core"));
  const cargoWorkspace = "[workspace]\nmembers = ['crates/a']";
  assert.deepEqual(topology.parseCargoWorkspaceMembers(cargoWorkspace), ["crates/a"]);
  rejectAll(topology.parseCargoWorkspaceMembers, "CARGO_WORKSPACE_INVALID", [
    '[workspace]\nmembers = ["crates/*"]',
    '[workspace]\nmembers = ["""crates/a"""]',
    '[workspace]\nmembers = ["crates/a"] garbage',
    '[workspace]\nmembers = ["crates/a"]\nmembers = ["crates/b"]',
  ]);
  const projectCargo = (publish = "") =>
    topology.projectCargoTopology(cargoWorkspace, () => `[package]\nname = "crate-a"\n${publish}`);
  const privateTopology = projectCargo("publish = []");
  assert.equal(privateTopology[0].publish, false);
  assert.notDeepEqual(projectCargo(), privateTopology);
  const matching = { manifestPath: "crates/a/Cargo.toml", name: "crate-a", publish: [] };
  topology.assertCargoMetadataTopology(privateTopology, [matching]);
  const mismatches = [
    { ...matching, manifestPath: "crates/b/Cargo.toml" },
    { ...matching, name: "crate-b" },
    { ...matching, publish: null },
  ];
  mismatches.forEach((mismatch) => {
    assert.throws(() => topology.assertCargoMetadataTopology(privateTopology, [mismatch]), {
      code: "CARGO_WORKSPACE_METADATA_MISMATCH",
    });
  });
});
