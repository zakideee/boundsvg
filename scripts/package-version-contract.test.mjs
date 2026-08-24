import assert from "node:assert/strict";
import test from "node:test";

import { auditPackedWorkspaceDependencyVersions } from "./package-version-contract.mjs";

const candidateVersions = new Map([
  ["@boundsvg/core", "0.2.0"],
  ["@boundsvg/shape", "0.2.0"],
]);

test("accepts exact workspace dependencies and compatible peer ranges", () => {
  assert.deepEqual(
    auditPackedWorkspaceDependencyVersions(
      {
        name: "@boundsvg/video",
        dependencies: { "@boundsvg/shape": "0.2.0" },
        peerDependencies: { "@boundsvg/core": ">=0.1.0 <0.3.0" },
      },
      candidateVersions,
    ),
    [],
  );
});

test("rejects ranged workspace dependencies and incompatible peers", () => {
  const violations = auditPackedWorkspaceDependencyVersions(
    {
      name: "@boundsvg/video",
      dependencies: { "@boundsvg/shape": "^0.2.0" },
      peerDependencies: { "@boundsvg/core": "^0.1.0" },
    },
    candidateVersions,
  );

  assert.ok(violations.some((violation) => violation.includes("expected candidate 0.2.0")));
  assert.ok(violations.some((violation) => violation.includes("excludes candidate 0.2.0")));
});

test("ignores external dependencies", () => {
  assert.deepEqual(
    auditPackedWorkspaceDependencyVersions(
      {
        name: "@boundsvg/core",
        dependencies: { react: "^19.0.0" },
      },
      candidateVersions,
    ),
    [],
  );
});
