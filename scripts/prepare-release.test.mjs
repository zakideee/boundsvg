import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parsePrepareArguments } from "./release-runtime/prepare.mjs";

const commit = "a".repeat(40);
const planHash = "b".repeat(64);
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const prepareSource = readFileSync(
  join(repositoryRoot, "scripts/release-runtime/prepare.mjs"),
  "utf8",
);

test("prepare parser accepts only explicit preview, apply, verify, and post-merge contracts", () => {
  assert.deepEqual(
    parsePrepareArguments([
      "preview",
      "--source",
      commit,
      "--npm-version",
      "2.8.0",
      "--crate-version",
      "crate-kernel=3.2.0",
      "--crate-version",
      "crate-renderer=current",
      "--output",
      "/outside/plan.json",
    ]),
    {
      command: "preview",
      crateVersions: new Map([
        ["crate-kernel", "3.2.0"],
        ["crate-renderer", "current"],
      ]),
      npmVersion: "2.8.0",
      output: "/outside/plan.json",
      source: commit,
    },
  );
  for (const command of ["apply", "verify"]) {
    assert.deepEqual(
      parsePrepareArguments([command, "--plan", "/outside/plan.json", "--plan-sha256", planHash]),
      { command, plan: "/outside/plan.json", planSha256: planHash },
    );
  }
  assert.deepEqual(
    parsePrepareArguments([
      "post-merge",
      "--commit",
      commit,
      "--plan",
      "/outside/plan.json",
      "--plan-sha256",
      planHash,
    ]),
    { command: "post-merge", commit, plan: "/outside/plan.json", planSha256: planHash },
  );
});

test("prepare parser rejects omitted, duplicate, old, ambiguous, and malformed inputs", () => {
  const invalidCases = [
    [],
    ["version"],
    ["preview", "--source", commit, "--npm-version", "2.8.0", "--output", "/plan"],
    [
      "preview",
      "--source",
      commit,
      "--source",
      commit,
      "--npm-version",
      "2.8.0",
      "--crate-version",
      "crate=3.0.0",
      "--output",
      "/plan",
    ],
    [
      "preview",
      "--source",
      "A".repeat(40),
      "--npm-version",
      "2.8.0",
      "--crate-version",
      "crate=3.0.0",
      "--output",
      "/plan",
    ],
    ["apply", "--plan", "/plan", "--plan-sha256", planHash, "--publish"],
    ["apply", "--plan", "/plan", "--plan-sha256", "B".repeat(64)],
    ["post-merge", "--commit", commit, "--plan", "/plan"],
  ];
  for (const argumentList of invalidCases) {
    assert.throws(
      () => parsePrepareArguments(argumentList),
      (error) => String(error.code).startsWith("ARGUMENT_"),
    );
  }
});

test("apply and verify admit structure before semantic Cargo inspection", () => {
  const applyBody = /if \(parsed\.command === "apply"\) \{([\s\S]*?)\n {2}\}/.exec(
    prepareSource,
  )?.[1];
  const verifyBody = /if \(parsed\.command === "verify"\) \{([\s\S]*?)\n {2}\}/.exec(
    prepareSource,
  )?.[1];
  assert.ok(applyBody);
  assert.ok(verifyBody);
  assert.ok(
    applyBody.indexOf("assertApplyAdmission(") < applyBody.indexOf("verifyPlanSemanticDelta("),
  );
  assert.ok(
    verifyBody.indexOf("verifyAppliedPlan(") < verifyBody.indexOf("verifyPlanSemanticDelta("),
  );
  assert.ok(
    verifyBody.lastIndexOf("verifyAppliedPlan(") > verifyBody.indexOf("verifyPlanSemanticDelta("),
  );
});
