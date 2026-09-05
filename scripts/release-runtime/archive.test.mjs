import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeArchiveEntries,
  inspectCrateArchive,
  inspectNpmArchive,
  readTarEntries,
  validatePackedNpmManifest,
} from "./archive.mjs";

const pathInVcsField = "path_in_vcs";

function file(path, data, mode = 0o644) {
  return { data: Buffer.from(data), mode, path, type: "file" };
}

const packageFile = (path, data = "x") => file(`package/${path}`, data);
function symlink(path, linkTarget) {
  return { linkTarget, mode: 0o777, path: `package/${path}`, type: "symlink" };
}
const hardlink = (path, target) => ({ ...symlink(path, `package/${target}`), type: "hardlink" });
function rejectCanonical(code, ...entries) {
  assert.throws(() => canonicalizeArchiveEntries(entries), { code });
}
function packageManifest(overrides = {}) {
  return {
    name: "@example/renderer",
    version: "2.8.0",
    scripts: { build: "tool build" },
    files: ["dist"],
    exports: { ".": "./dist/index.js" },
    dependencies: { "@example/kernel": "workspace:*", external: "^4.0.0" },
    peerDependencies: { "@example/adapter": ">=2.7.0 <2.8.0" },
    devDependencies: { "@example/adapter": "workspace:*" },
    ...overrides,
  };
}

function writeTarText(header, [offset, length], value) {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function tarEntry(path, data, type = "0") {
  const body = Buffer.from(data);
  const header = Buffer.alloc(512);
  writeTarText(header, [0, 100], path);
  writeTarText(header, [100, 8], "0000644\0");
  writeTarText(header, [108, 8], "0000000\0");
  writeTarText(header, [116, 8], "0000000\0");
  writeTarText(header, [124, 12], `${body.length.toString(8).padStart(11, "0")}\0`);
  writeTarText(header, [136, 12], "00000000000\0");
  header.fill(0x20, 148, 156);
  header[156] = (typeof type === "string" ? type : "0").charCodeAt(0);
  writeTarText(header, [257, 6], "ustar\0");
  writeTarText(header, [263, 2], "00");
  (typeof type === "function" ? type : () => {})(header);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  writeTarText(header, [148, 8], `${checksum.toString(8).padStart(6, "0")}\0 `);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

function paxRecord(key, value) {
  let length = Buffer.byteLength(` ${key}=${value}\n`) + 1;
  while (true) {
    const record = `${length} ${key}=${value}\n`;
    const actualLength = Buffer.byteLength(record);
    if (actualLength === length) {
      return record;
    }
    length = actualLength;
  }
}

const parseTar = (...entries) => readTarEntries(Buffer.concat([...entries, Buffer.alloc(1024)]));
const paxEntry = (key, value, type = "x") => tarEntry("pax", paxRecord(key, value), type);
function rejectTar(code, ...entries) {
  assert.throws(() => parseTar(...entries), { code });
}

function repeatedTarHeaders(header, count) {
  const archive = Buffer.alloc(header.length * count + 1024);
  for (let index = 0; index < count; index += 1) {
    header.copy(archive, index * header.length);
  }
  return archive;
}
test("archive canonicalization ignores envelope order and JSON key order", () => {
  const first = canonicalizeArchiveEntries(
    [
      file("package/dist/index.js", "export {};\n", 0o644),
      file("package/package.json", '{"name":"pkg","version":"1.0.0"}\n'),
    ],
    { rootPrefix: "package", semanticJsonPaths: new Set(["package.json"]) },
  );
  const second = canonicalizeArchiveEntries(
    [
      file("package/package.json", '{"version":"1.0.0","name":"pkg"}'),
      file("package/dist/index.js", "export {};\n", 0o644),
    ],
    { rootPrefix: "package", semanticJsonPaths: new Set(["package.json"]) },
  );
  assert.equal(first.sha256, second.sha256);
});

test("archive canonicalization rejects duplicate, absolute, escaping, unsafe mode, and unsupported type entries", () => {
  const fixtures = [
    [file("package/a", "one"), file("package/a", "two")],
    [file("/package/a", "one")],
    [file("package/../outside", "one")],
    [file("package/a", "one", 0o666)],
    [{ mode: 0o644, path: "package/device", type: "character-device" }],
  ];
  const codes = [
    "ARCHIVE_DUPLICATE_PATH",
    "ARCHIVE_PATH_INVALID",
    "ARCHIVE_PATH_ESCAPE",
    "ARCHIVE_MODE_UNSAFE",
    "ARCHIVE_TYPE_UNSUPPORTED",
  ];
  fixtures.forEach((entries, index) => {
    assert.throws(() => canonicalizeArchiveEntries(entries, { rootPrefix: "package" }), {
      code: codes[index],
    });
  });
});

test("archive canonicalization accepts contained links and rejects link escapes", () => {
  assert.doesNotThrow(() =>
    canonicalizeArchiveEntries(
      [
        file("package/dist/index.js", "export {};\n"),
        {
          linkTarget: "index.js",
          mode: 0o777,
          path: "package/dist/entry.js",
          type: "symlink",
        },
        hardlink("dist/hard.js", "dist/index.js"),
        hardlink("dist/hard-chain.js", "dist/hard.js"),
      ],
      { rootPrefix: "package" },
    ),
  );
  assert.throws(
    () =>
      canonicalizeArchiveEntries(
        [
          {
            linkTarget: "../../../outside",
            mode: 0o777,
            path: "package/dist/entry.js",
            type: "symlink",
          },
        ],
        { rootPrefix: "package" },
      ),
    { code: "ARCHIVE_LINK_ESCAPE" },
  );
  const ancestor = "ARCHIVE_PATH_ANCESTOR_CONFLICT";
  rejectCanonical(ancestor, packageFile("a"), packageFile("a/b"));
  rejectCanonical(ancestor, packageFile("a/b"), packageFile("a"));
  rejectCanonical("ARCHIVE_LINK_CYCLE", symlink("a", "a"));
  rejectCanonical("ARCHIVE_LINK_CYCLE", symlink("a", "b"), symlink("b", "a"));
  rejectCanonical("ARCHIVE_LINK_UNRESOLVED", hardlink("a", "missing"));
  const invalidLink = [symlink("a", "target"), hardlink("b", "a"), packageFile("target")];
  rejectCanonical("ARCHIVE_LINK_TYPE_INVALID", ...invalidLink);
  rejectCanonical(ancestor, symlink("a", "target"), packageFile("a/child"), packageFile("target"));
});
test("tar parsing accepts only unambiguous supported extension semantics", () => {
  const archiveFile = tarEntry("package/a", "x");
  const ignoredFile = tarEntry("ignored", "x");
  for (const data of [Buffer.from("package/a\0hidden"), Buffer.from([0xff])]) {
    rejectTar("ARCHIVE_STRING_INVALID", tarEntry("long", data, "L"), ignoredFile);
  }
  for (const offset of [0, 157, 257, 263, 265, 297, 345]) {
    const invalid = tarEntry("package/a", "x", (header) => header.set([0, 0xff], offset));
    rejectTar("ARCHIVE_STRING_INVALID", invalid);
  }
  for (const [type, key, value] of [
    ["x", "GNU.sparse.name", "package/a"],
    ["x", "SCHILY.xattr.user.test", "x"],
    ["x", "unknown", "x"],
    ["g", "path", "package/a"],
    ["x", "linkpath", "package/a"],
  ]) {
    rejectTar("ARCHIVE_PAX_UNSUPPORTED", paxEntry(key, value, type), archiveFile);
  }
  const ambiguousExtension = "ARCHIVE_EXTENSION_AMBIGUOUS";
  rejectTar(ambiguousExtension, paxEntry("mtime", "1", "g"), paxEntry("mtime", "2"), archiveFile);
  assert.equal(parseTar(paxEntry("path", "package/long"), ignoredFile)[0].path, "package/long");
  assert.equal(parseTar(paxEntry("mtime", "1.5", "g"), archiveFile)[0].path, "package/a");
});

test("tar parsing tracks empty local PAX presence and counts every nonzero header", () => {
  const emptyLocalPax = tarEntry("pax", "", "x");
  const archiveFile = tarEntry("package/a", "");
  rejectTar("ARCHIVE_EXTENSION_AMBIGUOUS", emptyLocalPax, emptyLocalPax, archiveFile);
  assert.equal(parseTar(emptyLocalPax, archiveFile).length, 1);
  rejectTar("ARCHIVE_EXTENSION_DANGLING", emptyLocalPax);

  assert.equal(readTarEntries(repeatedTarHeaders(archiveFile, 100_000)).length, 100_000);
  assert.throws(() => readTarEntries(repeatedTarHeaders(archiveFile, 100_001)), {
    code: "ARCHIVE_ENTRY_LIMIT",
  });
});

test("archive link validation is iterative across the full supported chain depth", () => {
  const chainLength = 20_000;
  const pathAt = (index) => `link-${String(index).padStart(5, "0")}`;
  const validChain = Array.from({ length: chainLength }, (_unused, index) =>
    hardlink(pathAt(index), index + 1 === chainLength ? "target" : pathAt(index + 1)),
  );
  assert.doesNotThrow(() => canonicalizeArchiveEntries([...validChain, packageFile("target")]));

  const cycle = validChain.map((entry) => ({ ...entry }));
  cycle.at(-1).linkTarget = `package/${pathAt(0)}`;
  assert.throws(() => canonicalizeArchiveEntries(cycle), { code: "ARCHIVE_LINK_CYCLE" });
});

test("tar parsing rejects ambiguous PAX keys and bytes after the terminator", () => {
  const duplicatePax = `${paxRecord("path", "package/a")}${paxRecord("path", "package/b")}`;
  const duplicateArchive = Buffer.concat([
    tarEntry("pax", duplicatePax, "x"),
    tarEntry("ignored", "payload"),
    Buffer.alloc(1024),
  ]);
  assert.throws(() => readTarEntries(duplicateArchive), { code: "ARCHIVE_PAX_DUPLICATE" });

  const trailingArchive = Buffer.concat([
    tarEntry("package/a", "payload"),
    Buffer.alloc(1024),
    Buffer.from([1]),
    Buffer.alloc(511),
  ]);
  assert.throws(() => readTarEntries(trailingArchive), { code: "ARCHIVE_TRAILING_DATA" });
});

test("tar parsing rejects incomplete, dangling, competing, and size-changing metadata", () => {
  const fixtures = [
    {
      bytes: Buffer.concat([tarEntry("package/a", "payload"), Buffer.alloc(512)]),
      code: "ARCHIVE_TRAILING_DATA",
    },
    {
      bytes: Buffer.concat([
        tarEntry("pax", paxRecord("path", "package/a"), "x"),
        Buffer.alloc(1024),
      ]),
      code: "ARCHIVE_EXTENSION_DANGLING",
    },
    {
      bytes: Buffer.concat([
        tarEntry("pax", paxRecord("path", "package/a"), "x"),
        tarEntry("long-path", "package/b\0", "L"),
        tarEntry("ignored", "payload"),
        Buffer.alloc(1024),
      ]),
      code: "ARCHIVE_EXTENSION_AMBIGUOUS",
    },
    {
      bytes: Buffer.concat([
        tarEntry("pax", paxRecord("size", "1"), "x"),
        tarEntry("package/a", "payload"),
        Buffer.alloc(1024),
      ]),
      code: "ARCHIVE_PAX_UNSUPPORTED",
    },
    {
      bytes: tarEntry("package/a", "payload"),
      code: "ARCHIVE_TERMINATOR_MISSING",
    },
    {
      bytes: Buffer.concat([tarEntry("package/link", "hidden payload", "2"), Buffer.alloc(1024)]),
      code: "ARCHIVE_NONFILE_DATA",
    },
  ];
  for (const fixture of fixtures) {
    assert.throws(() => readTarEntries(fixture.bytes), { code: fixture.code });
  }

  const nonzeroPadding = tarEntry("package/a", "x");
  nonzeroPadding[513] = 1;
  assert.throws(() => readTarEntries(Buffer.concat([nonzeroPadding, Buffer.alloc(1024)])), {
    code: "ARCHIVE_PADDING_INVALID",
  });
});

test("packed npm manifests require exact runtime versions, derived peer lines, and no workspace protocol", () => {
  const sourceManifest = packageManifest();
  const packedManifest = packageManifest({
    dependencies: { "@example/kernel": "2.8.0", external: "^4.0.0" },
    peerDependencies: { "@example/adapter": ">=2.8.0 <2.9.0" },
    devDependencies: { "@example/adapter": "2.8.0" },
  });
  assert.doesNotThrow(() =>
    validatePackedNpmManifest({
      fixedPackageNames: new Set(["@example/kernel", "@example/adapter", "@example/renderer"]),
      packedManifest,
      sourceManifest,
      targetVersion: "2.8.0",
    }),
  );

  for (const [mutation, code] of [
    [
      { dependencies: { "@example/kernel": "workspace:*", external: "^4.0.0" } },
      "NPM_WORKSPACE_PROTOCOL",
    ],
    [
      { dependencies: { "@example/kernel": "^2.8.0", external: "^4.0.0" } },
      "NPM_INTERNAL_RANGE_INVALID",
    ],
    [{ peerDependencies: { "@example/adapter": ">=2.8.0" } }, "NPM_PEER_RANGE_INVALID"],
    [
      { dependencies: { "@example/kernel": "2.8.0", external: "^5.0.0" } },
      "NPM_EXTERNAL_DEPENDENCY_CHANGED",
    ],
    [{ optionalDependencies: { "@example/renderer": "2.8.0" } }, "NPM_DEPENDENCY_ADDED"],
    [{ files: ["dist", "extra"] }, "NPM_PACKED_MANIFEST_CHANGED"],
    [
      { scripts: { build: "tool build", prepublishOnly: "run something" } },
      "NPM_LIFECYCLE_SCRIPT_FORBIDDEN",
    ],
  ]) {
    assert.throws(
      () =>
        validatePackedNpmManifest({
          fixedPackageNames: new Set(["@example/kernel", "@example/adapter", "@example/renderer"]),
          packedManifest: packageManifest({
            dependencies: { "@example/kernel": "2.8.0", external: "^4.0.0" },
            peerDependencies: { "@example/adapter": ">=2.8.0 <2.9.0" },
            devDependencies: { "@example/adapter": "2.8.0" },
            ...mutation,
          }),
          sourceManifest,
          targetVersion: "2.8.0",
        }),
      { code },
    );
  }
});

test("npm archive inspection binds the package manifest to the audited archive", () => {
  const sourceManifest = packageManifest({
    dependencies: { "@example/kernel": "2.8.0", external: "^4.0.0" },
    peerDependencies: { "@example/adapter": ">=2.8.0 <2.9.0" },
    devDependencies: { "@example/adapter": "2.8.0" },
  });
  const result = inspectNpmArchive({
    entries: [
      file("package/package.json", JSON.stringify(sourceManifest)),
      file("package/dist/index.js", "export {};\n"),
    ],
    fixedPackageNames: new Set(["@example/kernel", "@example/adapter", "@example/renderer"]),
    sourceManifest,
    targetVersion: "2.8.0",
  });
  assert.match(result.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.name, "@example/renderer");
  const duplicateManifest = `{"name":"unexpected",${JSON.stringify(sourceManifest).slice(1)}`;
  assert.throws(
    () =>
      inspectNpmArchive({
        entries: [file("package/package.json", duplicateManifest)],
        fixedPackageNames: new Set(["@example/kernel", "@example/adapter", "@example/renderer"]),
        sourceManifest,
        targetVersion: "2.8.0",
      }),
    { code: "NPM_PACKED_MANIFEST_INVALID" },
  );
});

test("npm carried equality follows A/R payload bytes including crate-built WASM", () => {
  const manifest = packageManifest({
    dependencies: { "@example/kernel": "2.8.0", external: "^4.0.0" },
    devDependencies: { "@example/adapter": "2.8.0" },
    peerDependencies: { "@example/adapter": ">=2.8.0 <2.9.0" },
  });
  const inspect = (wasmBytes) =>
    inspectNpmArchive({
      entries: [
        file("package/package.json", JSON.stringify(manifest)),
        file("package/dist/renderer.wasm", wasmBytes),
      ],
      fixedPackageNames: new Set(["@example/kernel", "@example/adapter", "@example/renderer"]),
      sourceManifest: manifest,
      targetVersion: "2.8.0",
    }).canonicalSha256;

  const prospectiveA = inspect("crate build one");
  const releaseR = inspect("crate build one");
  const registryCarried = inspect("crate build one");
  assert.equal(prospectiveA, registryCarried);
  assert.equal(releaseR, registryCarried);
  assert.notEqual(inspect("crate build two"), registryCarried);
});

test("crate archive inspection separates VCS identity and validates archive lock projection", () => {
  const releaseCommit = "e".repeat(40);
  const expectedPublicDependencies = new Map([
    ["crate-kernel", new Set()],
    ["crate-renderer", new Set(["crate-kernel"])],
  ]);
  const lock = `version = 4

[[package]]
name = "crate-kernel"
version = "3.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"1".repeat(64)}"

[[package]]
name = "crate-renderer"
version = "4.2.0"
dependencies = [
 "crate-kernel",
]
`;
  const expectedPublicVersions = new Map([
    ["crate-kernel", "3.1.0"],
    ["crate-renderer", "4.2.0"],
  ]);
  const vcsPath = "crate-renderer-4.2.0/.cargo_vcs_info.json";
  const baseEntries = [
    file(
      "crate-renderer-4.2.0/Cargo.toml.orig",
      '[package]\nname = "crate-renderer"\nversion = "4.2.0"\n',
    ),
    file(
      "crate-renderer-4.2.0/Cargo.toml",
      '[package]\nname = "crate-renderer"\nversion = "4.2.0"\n',
    ),
    file("crate-renderer-4.2.0/Cargo.lock", lock),
    file(
      vcsPath,
      JSON.stringify({ git: { sha1: releaseCommit }, [pathInVcsField]: "crates/crate-renderer" }),
    ),
    file("crate-renderer-4.2.0/src/lib.rs", "pub fn render() {}\n"),
  ];
  const inspectionOptions = {
    crateName: "crate-renderer",
    expectedPath: "crates/crate-renderer",
    expectedPublicDependencies,
    expectedPublicVersions,
    releaseCommit,
    sourceManifest: baseEntries[0].data,
    version: "4.2.0",
  };
  const result = inspectCrateArchive({ ...inspectionOptions, entries: baseEntries });
  assert.match(result.canonicalSha256, /^[a-f0-9]{64}$/);

  const vcsModeEntries = (mode) =>
    baseEntries.map((entry) => (entry.path === vcsPath ? file(vcsPath, entry.data, mode) : entry));
  const executableVcs = inspectCrateArchive({
    ...inspectionOptions,
    entries: vcsModeEntries(0o755),
  });
  assert.notEqual(result.canonicalSha256, executableVcs.canonicalSha256);
  assert.throws(
    () => inspectCrateArchive({ ...inspectionOptions, entries: vcsModeEntries(0o777) }),
    { code: "ARCHIVE_MODE_UNSAFE" },
  );
  assert.throws(
    () =>
      inspectCrateArchive({
        ...inspectionOptions,
        entries: [...baseEntries, file(`${vcsPath}/hidden`, "hidden")],
      }),
    { code: "ARCHIVE_PATH_ANCESTOR_CONFLICT" },
  );
  assert.throws(
    () =>
      inspectCrateArchive({
        ...inspectionOptions,
        entries: [
          ...baseEntries.filter((entry) => entry.path !== vcsPath),
          {
            linkTarget: "Cargo.toml",
            mode: 0o777,
            path: vcsPath,
            type: "symlink",
          },
        ],
      }),
    { code: "ARCHIVE_REQUIRED_FILE_MISSING" },
  );

  const externalLockEntry = `
[[package]]
name = "external"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"2".repeat(64)}"
`;
  const withExternalLock = baseEntries.map((entry) =>
    entry.path === "crate-renderer-4.2.0/Cargo.lock"
      ? file(entry.path, `${lock}${externalLockEntry}`)
      : entry,
  );
  const changedExternalLock = withExternalLock.map((entry) =>
    entry.path === "crate-renderer-4.2.0/Cargo.lock"
      ? file(entry.path, entry.data.toString("utf8").replace("2".repeat(64), "3".repeat(64)))
      : entry,
  );
  assert.notEqual(
    inspectCrateArchive({ ...inspectionOptions, entries: withExternalLock }).canonicalSha256,
    inspectCrateArchive({ ...inspectionOptions, entries: changedExternalLock }).canonicalSha256,
  );

  const originalManifestDrift = baseEntries.map((entry) =>
    entry.path === "crate-renderer-4.2.0/Cargo.toml.orig"
      ? file(entry.path, entry.data.toString("utf8").replace("4.2.0", "4.2.1"))
      : entry,
  );
  assert.throws(
    () => inspectCrateArchive({ ...inspectionOptions, entries: originalManifestDrift }),
    { code: "CRATE_ORIGINAL_MANIFEST_MISMATCH" },
  );

  const normalizedManifestDrift = baseEntries.map((entry) =>
    entry.path === "crate-renderer-4.2.0/Cargo.toml"
      ? file(entry.path, `${entry.data.toString("utf8")}authors = [\n "Unexpected",\n]\n`)
      : entry,
  );
  assert.notEqual(
    result.canonicalSha256,
    inspectCrateArchive({ ...inspectionOptions, entries: normalizedManifestDrift }).canonicalSha256,
  );

  const extraVcsField = baseEntries.map((entry) =>
    entry.path === vcsPath
      ? file(
          vcsPath,
          JSON.stringify({
            extra: true,
            git: { sha1: releaseCommit },
            [pathInVcsField]: "crates/crate-renderer",
          }),
        )
      : entry,
  );
  assert.throws(() => inspectCrateArchive({ ...inspectionOptions, entries: extraVcsField }), {
    code: "CRATE_VCS_INVALID",
  });

  const duplicateVcsSha = [
    ...baseEntries.filter((entry) => entry.path !== vcsPath),
    file(
      vcsPath,
      `{"git":{"sha1":"${"a".repeat(40)}","sha1":"${releaseCommit}"},"path_in_vcs":"crates/crate-renderer"}`,
    ),
  ];
  assert.throws(() => inspectCrateArchive({ ...inspectionOptions, entries: duplicateVcsSha }), {
    code: "CRATE_VCS_INVALID",
  });

  for (const dirty of [true, "false"]) {
    const dirtyEntries = baseEntries.map((entry) =>
      entry.path === vcsPath
        ? file(
            vcsPath,
            JSON.stringify({
              git: { dirty, sha1: releaseCommit },
              [pathInVcsField]: "crates/crate-renderer",
            }),
          )
        : entry,
    );
    assert.throws(() => inspectCrateArchive({ ...inspectionOptions, entries: dirtyEntries }), {
      code: "CRATE_VCS_DIRTY",
    });
  }

  const dependencyDrift = baseEntries.map((entry) =>
    entry.path === "crate-renderer-4.2.0/Cargo.lock"
      ? file(
          entry.path,
          lock.replace('dependencies = [\n "crate-kernel",\n]', "dependencies = [\n]"),
        )
      : entry,
  );
  assert.throws(() => inspectCrateArchive({ ...inspectionOptions, entries: dependencyDrift }), {
    code: "CRATE_ARCHIVE_LOCK_DEPENDENCY_MISMATCH",
  });

  const vcsEntry = baseEntries.find(({ path }) => path === vcsPath);
  assert.throws(
    () => inspectCrateArchive({ ...inspectionOptions, entries: [...baseEntries, vcsEntry] }),
    { code: "ARCHIVE_REQUIRED_FILE_MISSING" },
  );
});
