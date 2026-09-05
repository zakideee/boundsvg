import assert from "node:assert/strict";
import test from "node:test";

import { parseCargoLock, projectPublicCargoLock, validateRootCargoLock } from "./cargo-lock.mjs";

const checksum = "a".repeat(64);

function lock(publicVersion = "4.2.0") {
  return `version = 4

[[package]]
name = "crate-kernel"
version = "3.1.0"
dependencies = [
 "registry-leaf",
]

[[package]]
name = "crate-renderer"
version = "${publicVersion}"
dependencies = [
 "crate-kernel",
 "patched-codec",
]

[[package]]
name = "private-tool"
version = "1.0.0"

[[package]]
name = "patched-codec"
version = "8.0.0"

[[package]]
name = "registry-leaf"
version = "9.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${checksum}"
`;
}

const validationOptions = {
  patchNames: new Set(["patched-codec"]),
  publicDependencies: new Map([
    ["crate-kernel", new Set()],
    ["crate-renderer", new Set(["crate-kernel"])],
  ]),
  publicVersions: new Map([
    ["crate-kernel", "3.1.0"],
    ["crate-renderer", "4.2.0"],
  ]),
  workspaceNames: new Set(["crate-kernel", "crate-renderer", "private-tool"]),
};

test("root Cargo lock accepts workspace and explicit patch source-less entries", () => {
  const result = validateRootCargoLock(lock(), validationOptions);
  assert.equal(result.publicProjection.length, 2);
  assert.equal(result.entries.length, 5);
});

test("root Cargo lock rejects stale public versions and source-backed workspace entries", () => {
  assert.throws(() => validateRootCargoLock(lock("4.1.0"), validationOptions), {
    code: "CARGO_ROOT_LOCK_VERSION_MISMATCH",
  });
  const sourceBacked = lock().replace(
    'name = "crate-kernel"\nversion = "3.1.0"',
    `name = "crate-kernel"\nversion = "3.1.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"`,
  );
  assert.throws(() => validateRootCargoLock(sourceBacked, validationOptions), {
    code: "CARGO_ROOT_LOCK_WORKSPACE_SOURCE",
  });
});

test("root Cargo lock rejects unapproved source-less externals and public dependency drift", () => {
  assert.throws(
    () =>
      validateRootCargoLock(
        lock().replace('name = "patched-codec"', 'name = "unapproved-codec"'),
        validationOptions,
      ),
    { code: "CARGO_ROOT_LOCK_SOURCELESS_EXTERNAL" },
  );
  assert.throws(
    () =>
      validateRootCargoLock(
        lock().replace(' "crate-kernel",\n "patched-codec",', ' "patched-codec",'),
        validationOptions,
      ),
    { code: "CARGO_ROOT_LOCK_DEPENDENCY_MISMATCH" },
  );
});

test("Cargo lock parser rejects duplicate package identities", () => {
  const duplicate = `${lock()}\n[[package]]${lock().split("[[package]]")[1]}`;
  assert.throws(() => parseCargoLock(duplicate), { code: "CARGO_LOCK_DUPLICATE_PACKAGE" });
});

test("Cargo lock parser rejects duplicate fields, malformed dependencies, and public-name ambiguity", () => {
  assert.throws(
    () =>
      parseCargoLock(`version = 4

[[package]]
name = "duplicate"
name = "duplicate"
version = "1.0.0"
`),
    { code: "CARGO_LOCK_PARSE_FAILED" },
  );
  assert.throws(
    () =>
      parseCargoLock(`version = 4

[[package]]
name = "malformed"
version = "1.0.0"
dependencies = [
 not-a-string,
]
`),
    { code: "CARGO_LOCK_PARSE_FAILED" },
  );

  const ambiguousPublicName = `${lock()}\n[[package]]
name = "crate-kernel"
version = "3.2.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${checksum}"
`;
  assert.throws(
    () =>
      projectPublicCargoLock(
        ambiguousPublicName,
        new Map([
          ["crate-kernel", "3.1.0"],
          ["crate-renderer", "4.2.0"],
        ]),
      ),
    { code: "CARGO_ARCHIVE_LOCK_DUPLICATE_PUBLIC" },
  );
});
