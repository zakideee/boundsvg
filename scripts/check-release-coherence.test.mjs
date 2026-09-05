import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifySteadyRepository } from "./release-runtime/coherence.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("the checked-in repository satisfies the offline steady release contract", () => {
  const report = verifySteadyRepository(repositoryRoot);
  assert.equal(report.phase, "steady");
  assert.deepEqual(
    new Set(report.npm.fixedNames),
    new Set(report.npm.packages.map(({ name }) => name)),
  );
  assert.deepEqual(
    new Set(report.cargo.publishOrder),
    new Set(report.cargo.crates.map(({ name }) => name)),
  );
  assert.ok(report.inputs.changesets.every(({ path }) => path.startsWith(".changeset/")));
  assert.ok(report.inputs.markers.every(({ path }) => path.endsWith("Cargo.toml")));
});

test("steady verification is independent of the process working directory", () => {
  const report = verifySteadyRepository(resolve(repositoryRoot));
  assert.equal(report.repository, "zakideee/boundsvg");
});
