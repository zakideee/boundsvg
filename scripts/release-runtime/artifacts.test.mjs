import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  auditDocsBuild,
  buildCratePackageArguments,
  containedOutputPath,
  parsePackOutput,
  validateCarriedSource,
  verifyCrateDownloadBytes,
  verifyCrateIndexRecord,
  verifyNpmDistBytes,
} from "./artifacts.mjs";

test("pnpm pack output accepts one object and confines its absolute filename", () => {
  const outputDirectory = join(tmpdir(), "boundsvg-release-artifacts");
  const artifactPath = join(outputDirectory, "boundsvg-core-4.2.0.tgz");
  assert.equal(
    parsePackOutput(JSON.stringify({ filename: artifactPath }), "@boundsvg/core"),
    artifactPath,
  );
  assert.equal(containedOutputPath(outputDirectory, artifactPath), artifactPath);
  assert.equal(containedOutputPath(outputDirectory, "boundsvg-core-4.2.0.tgz"), artifactPath);
  for (const invalidOutput of [
    JSON.stringify([{ filename: artifactPath }]),
    JSON.stringify({ filename: 42 }),
    "null",
  ]) {
    assert.throws(() => parsePackOutput(invalidOutput, "@boundsvg/core"), {
      code: "NPM_PACK_OUTPUT_INVALID",
    });
  }
  for (const unsafeFilename of [
    join(outputDirectory, "nested", "artifact.tgz"),
    join(outputDirectory, "..", "artifact.tgz"),
    "nested/artifact.tgz",
    "unsafe\\artifact.tgz",
  ]) {
    assert.throws(() => containedOutputPath(outputDirectory, unsafeFilename), {
      code: "ARTIFACT_PATH_ESCAPE",
    });
  }
});

test("public artifact redirects are validated before following them", async () => {
  let requests = 0;
  await assert.rejects(
    auditDocsBuild({
      crateName: "crate-renderer",
      fetch: async () => {
        requests += 1;
        return {
          headers: new Headers({ location: "http://127.0.0.1/private" }),
          ok: false,
          status: 302,
          url: "https://docs.rs/redirect",
        };
      },
      version: "4.2.0",
    }),
    { code: "DOCS_BUILD_UNKNOWN" },
  );
  assert.equal(requests, 1);
});

test("crate admission packages the graph in one invocation for unpublished workspace dependencies", () => {
  assert.deepEqual(
    buildCratePackageArguments({
      cargoTargetDirectory: "/tmp/cargo-target",
      noVerify: true,
      publishOrder: ["boundshape", "boundtext", "boundsvg"],
    }),
    [
      "package",
      "--locked",
      "--package",
      "boundshape",
      "--package",
      "boundtext",
      "--package",
      "boundsvg",
      "--target-dir",
      "/tmp/cargo-target",
      "--no-verify",
    ],
  );
});

test("npm dist bytes require exact SHA-512 integrity and SHA-1 shasum", () => {
  const bytes = Buffer.from("audited npm tarball");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const shasum = createHash("sha1").update(bytes).digest("hex");
  assert.equal(verifyNpmDistBytes(bytes, { integrity, shasum }).sha512.length, 128);
  assert.throws(() => verifyNpmDistBytes(Buffer.from("different"), { integrity, shasum }), {
    code: "NPM_DIST_DIGEST_MISMATCH",
  });
});

test("crate download bytes require the exact API checksum", () => {
  const bytes = Buffer.from("audited crate archive");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  assert.equal(verifyCrateDownloadBytes(bytes, { checksum }).sha256, checksum);
  assert.throws(() => verifyCrateDownloadBytes(Buffer.from("different"), { checksum }), {
    code: "CRATE_DOWNLOAD_CHECKSUM_MISMATCH",
  });
});

test("crate sparse-index record must match the API checksum and be non-yanked", () => {
  const checksum = "a".repeat(64);
  assert.deepEqual(
    verifyCrateIndexRecord({ checksum, yanked: false }, { cksum: checksum, yanked: false }),
    { checksum, yanked: false },
  );
  for (const indexRecord of [
    undefined,
    { cksum: "b".repeat(64), yanked: false },
    { cksum: checksum, yanked: true },
  ]) {
    assert.throws(() => verifyCrateIndexRecord({ checksum, yanked: false }, indexRecord), {
      code: "CRATES_INDEX_MISMATCH",
    });
  }
});

test("carried source requires canonical repository and a non-executed ancestor P[a]", () => {
  const releaseCommit = "a".repeat(40);
  const provenanceCommit = "b".repeat(40);
  let ancestryChecks = 0;
  assert.equal(
    validateCarriedSource({
      isAncestor(left, right) {
        ancestryChecks += 1;
        return left === provenanceCommit && right === releaseCommit;
      },
      provenanceCommit,
      releaseCommit,
      repository: "zakideee/boundsvg",
    }).provenanceCommit,
    provenanceCommit,
  );
  assert.equal(ancestryChecks, 1);
  for (const override of [
    { repository: "attacker/fork" },
    { isAncestor: () => false },
    { provenanceCommit: "A".repeat(40) },
  ]) {
    assert.throws(
      () =>
        validateCarriedSource({
          isAncestor: () => true,
          provenanceCommit,
          releaseCommit,
          repository: "zakideee/boundsvg",
          ...override,
        }),
      { code: "CARRIED_SOURCE_INVALID" },
    );
  }
});
