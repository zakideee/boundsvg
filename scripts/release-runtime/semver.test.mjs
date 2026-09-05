import assert from "node:assert/strict";
import test from "node:test";

import {
  compareStableVersions,
  formatMinorLine,
  incrementStableVersion,
  parseStableVersion,
  resolveExplicitTarget,
} from "./semver.mjs";

test("stable SemVer parser accepts canonical numeric triples", () => {
  assert.deepEqual(parseStableVersion("12.34.56"), {
    major: "12",
    minor: "34",
    patch: "56",
    text: "12.34.56",
  });
});

test("stable SemVer parser rejects non-stable and non-canonical values", () => {
  for (const value of [
    "1.2",
    "1.2.3-beta.1",
    "1.2.3+build",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "-1.2.3",
    "current ",
  ]) {
    assert.throws(() => parseStableVersion(value), { code: "INVALID_STABLE_VERSION" });
  }
});

test("stable SemVer comparison stays exact for arbitrarily large identifiers", () => {
  assert.equal(compareStableVersions("90071992547409930.2.3", "90071992547409929.99.99"), 1);
  assert.equal(compareStableVersions("7.10.0", "7.9.999"), 1);
  assert.equal(compareStableVersions("7.10.0", "7.10.0"), 0);
  assert.equal(compareStableVersions("7.9.999", "7.10.0"), -1);
});

test("stable SemVer increments exactly one requested component", () => {
  assert.equal(incrementStableVersion("2.7.3", "patch"), "2.7.4");
  assert.equal(incrementStableVersion("2.7.3", "minor"), "2.8.0");
  assert.equal(incrementStableVersion("2.7.3", "major"), "3.0.0");
  assert.equal(
    incrementStableVersion("2.999999999999999999999999.7", "minor"),
    "2.1000000000000000000000000.0",
  );
  assert.throws(() => incrementStableVersion("2.7.3", "prerelease"), {
    code: "CHANGESET_BUMP_INVALID",
  });
});

test("peer ranges are derived from the target minor line", () => {
  assert.equal(formatMinorLine("12.34.56"), ">=12.34.0 <12.35.0");
  assert.equal(
    formatMinorLine("12.999999999999999999999999.0"),
    ">=12.999999999999999999999999.0 <12.1000000000000000000000000.0",
  );
});

test("explicit target resolves current or a strictly greater stable target", () => {
  assert.deepEqual(resolveExplicitTarget("current", "2.7.3"), {
    advances: false,
    current: "2.7.3",
    target: "2.7.3",
  });
  assert.deepEqual(resolveExplicitTarget("2.8.0", "2.7.3"), {
    advances: true,
    current: "2.7.3",
    target: "2.8.0",
  });
  assert.throws(() => resolveExplicitTarget("2.7.3", "2.7.3"), {
    code: "TARGET_NOT_GREATER",
  });
  assert.throws(() => resolveExplicitTarget("2.6.9", "2.7.3"), {
    code: "TARGET_NOT_GREATER",
  });
});
