import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkflowArguments } from "./workflow-arguments.mjs";

const releaseCommit = "a".repeat(40);
const reportSha256 = "b".repeat(64);

test("workflow arguments bind admission and registry commands to exact inputs", () => {
  assert.deepEqual(
    parseWorkflowArguments([
      "admission",
      "--target",
      "npm",
      "--release-commit",
      releaseCommit,
      "--bundle",
      "/bundle",
    ]),
    {
      bundleDirectory: "/bundle",
      command: "admission",
      releaseCommit,
      reportSha256: undefined,
      target: "npm",
    },
  );
  assert.deepEqual(
    parseWorkflowArguments([
      "crates",
      "--report-sha256",
      reportSha256,
      "--bundle",
      "/bundle",
      "--release-commit",
      releaseCommit,
    ]),
    {
      bundleDirectory: "/bundle",
      command: "crates",
      releaseCommit,
      reportSha256,
      target: "crates",
    },
  );
});

test("workflow arguments reject omitted, duplicate, legacy, malformed, and extra options", () => {
  const validRegistry = [
    "npm",
    "--bundle",
    "/bundle",
    "--release-commit",
    releaseCommit,
    "--report-sha256",
    reportSha256,
  ];
  for (const argumentList of [
    [],
    ["unknown", ...validRegistry.slice(1)],
    validRegistry.slice(0, -2),
    [...validRegistry, "--publish", "true"],
    [...validRegistry, "--bundle", "/other"],
    validRegistry.map((value) => (value === releaseCommit ? "A".repeat(40) : value)),
    validRegistry.map((value) => (value === reportSha256 ? "b".repeat(63) : value)),
    [
      "admission",
      "--bundle",
      "/bundle",
      "--release-commit",
      releaseCommit,
      "--target",
      "select-target",
    ],
  ]) {
    assert.throws(
      () => parseWorkflowArguments(argumentList),
      (error) => String(error.code).startsWith("ARGUMENT_"),
    );
  }
});
