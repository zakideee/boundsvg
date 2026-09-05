import { posix } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  canonicalJson,
  compareCanonicalStrings,
  deepEqualCanonical,
  sha256,
} from "./canonical.mjs";
import { projectPublicCargoLock } from "./cargo-lock.mjs";
import { failRelease } from "./errors.mjs";
import { formatMinorLine } from "./semver.mjs";
import { parseStrictJsonBytes } from "./strict-json.mjs";

const supportedArchiveTypes = new Set(["directory", "file", "hardlink", "symlink"]);
const maximumArchiveBytes = 512 * 1024 * 1024;
const maximumArchiveEntries = 100_000;
const dependencySections = [
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
];
const forbiddenLifecycleScripts = new Set([
  "postpack",
  "postpublish",
  "prepack",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "publish",
]);
const paxEnvelopeKeys = new Set(["atime", "ctime", "gid", "gname", "mtime", "uid", "uname"]);
const paxSemanticKeys = new Set(["linkpath", "path"]);
const crateVcsPayloadSentinel = Buffer.from("validated crate VCS metadata", "utf8");
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeArchiveUtf8(bytes, label) {
  try {
    return utf8Decoder.decode(bytes);
  } catch (error) {
    failRelease("ARCHIVE_STRING_INVALID", `${label} is not valid UTF-8`, { cause: error });
  }
}

function normalizeArchivePath(archivePath, rootPrefix) {
  if (
    typeof archivePath !== "string" ||
    archivePath.length === 0 ||
    archivePath.length > 16_384 ||
    /[\0\r\n]/.test(archivePath) ||
    archivePath.includes("\\") ||
    posix.isAbsolute(archivePath)
  ) {
    failRelease("ARCHIVE_PATH_INVALID", `invalid archive path: ${archivePath}`);
  }
  const components = archivePath.split("/").filter((component) => component !== "");
  if (components.includes("..")) {
    failRelease("ARCHIVE_PATH_ESCAPE", `archive path escapes its root: ${archivePath}`);
  }
  const normalized = posix.normalize(archivePath).replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === rootPrefix) {
    return undefined;
  }
  if (!normalized.startsWith(`${rootPrefix}/`)) {
    failRelease("ARCHIVE_ROOT_MISMATCH", `${archivePath} is outside ${rootPrefix}`);
  }
  const relative = normalized.slice(rootPrefix.length + 1);
  if (relative.length === 0 || relative === "." || relative.startsWith("../")) {
    failRelease("ARCHIVE_PATH_ESCAPE", `archive path escapes its root: ${archivePath}`);
  }
  return relative;
}

function normalizeArchiveMode(type, mode, archivePath) {
  if (!Number.isInteger(mode) || mode < 0 || (mode & ~0o777) !== 0) {
    failRelease("ARCHIVE_MODE_UNSAFE", `invalid mode for ${archivePath}`);
  }
  if (type === "symlink" || type === "hardlink") {
    return 0o777;
  }
  if ((mode & 0o022) !== 0) {
    failRelease("ARCHIVE_MODE_UNSAFE", `writable group/world mode for ${archivePath}`);
  }
  if (type === "directory") {
    return 0o755;
  }
  return (mode & 0o111) === 0 ? 0o644 : 0o755;
}

function validateLinkTarget(entryPath, linkTarget, options) {
  if (
    typeof linkTarget !== "string" ||
    linkTarget.length === 0 ||
    linkTarget.length > 16_384 ||
    /[\0\r\n]/.test(linkTarget) ||
    linkTarget.includes("\\") ||
    posix.isAbsolute(linkTarget)
  ) {
    failRelease("ARCHIVE_LINK_ESCAPE", `invalid link target for ${entryPath}`);
  }
  const target =
    options.type === "hardlink"
      ? normalizeArchivePath(linkTarget, options.rootPrefix)
      : posix.normalize(posix.join(posix.dirname(entryPath), linkTarget));
  if (target === undefined || target === ".." || target.startsWith("../")) {
    failRelease("ARCHIVE_LINK_ESCAPE", `link target escapes the archive: ${entryPath}`);
  }
  return target;
}

function canonicalArchiveFile(entry, options) {
  if (!Buffer.isBuffer(entry.data)) {
    failRelease("ARCHIVE_FILE_DATA_INVALID", `file data is missing for ${options.relativePath}`);
  }
  let canonicalData = entry.data;
  if (options.semanticJsonPaths.has(options.relativePath)) {
    try {
      const semanticJson = parseStrictJsonBytes(entry.data, options.relativePath);
      canonicalData = Buffer.from(canonicalJson(semanticJson), "utf8");
    } catch (error) {
      failRelease("ARCHIVE_JSON_INVALID", `invalid JSON at ${options.relativePath}`, {
        cause: error,
      });
    }
  }
  return {
    mode: options.mode,
    path: options.relativePath,
    sha256: sha256(canonicalData),
    size: canonicalData.length,
    type: entry.type,
  };
}

function canonicalArchiveNonFile(entry, options) {
  const canonicalEntry = {
    mode: options.mode,
    path: options.relativePath,
    type: entry.type,
  };
  if (entry.type === "hardlink" || entry.type === "symlink") {
    canonicalEntry.linkTarget = validateLinkTarget(options.relativePath, entry.linkTarget, {
      rootPrefix: options.rootPrefix,
      type: entry.type,
    });
  }
  return canonicalEntry;
}

function canonicalArchiveEntry(entry, options) {
  const mode = normalizeArchiveMode(entry.type, entry.mode, options.relativePath);
  return entry.type === "file"
    ? canonicalArchiveFile(entry, { ...options, mode })
    : canonicalArchiveNonFile(entry, { ...options, mode });
}

function resolveArchiveLink(entry, entriesByPath, linkStates) {
  const stack = [{ entry, resolve: false }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.resolve) {
      linkStates.set(frame.entry.path, "resolved");
      continue;
    }
    const state = linkStates.get(frame.entry.path);
    if (state === "resolved") {
      continue;
    }
    if (state === "visiting") {
      failRelease("ARCHIVE_LINK_CYCLE", `archive link cycle includes ${frame.entry.path}`);
    }
    linkStates.set(frame.entry.path, "visiting");
    const target = entriesByPath.get(frame.entry.linkTarget);
    if (target === undefined) {
      failRelease("ARCHIVE_LINK_UNRESOLVED", `archive link target is missing: ${frame.entry.path}`);
    }
    if (frame.entry.type === "hardlink" && !["file", "hardlink"].includes(target.type)) {
      failRelease(
        "ARCHIVE_LINK_TYPE_INVALID",
        `hardlink target is not a file: ${frame.entry.path}`,
      );
    }
    stack.push({ entry: frame.entry, resolve: true });
    if (target.type === "hardlink" || target.type === "symlink") {
      stack.push({ entry: target, resolve: false });
    }
  }
}

function validateArchiveTopology(entries) {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const linkStates = new Map();
  for (const entry of entries) {
    let ancestor = posix.dirname(entry.path);
    while (ancestor !== ".") {
      const ancestorEntry = entriesByPath.get(ancestor);
      if (ancestorEntry !== undefined && ancestorEntry.type !== "directory") {
        failRelease("ARCHIVE_PATH_ANCESTOR_CONFLICT", `${ancestor} is not a directory`);
      }
      ancestor = posix.dirname(ancestor);
    }
    if (entry.type === "hardlink" || entry.type === "symlink") {
      resolveArchiveLink(entry, entriesByPath, linkStates);
    }
  }
}

export function canonicalizeArchiveEntries(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length > maximumArchiveEntries) {
    failRelease("ARCHIVE_ENTRY_LIMIT", "archive entry count exceeds the supported bound");
  }
  const rootPrefix = options.rootPrefix ?? "package";
  const semanticJsonPaths = options.semanticJsonPaths ?? new Set();
  const seen = new Set();
  let rootSeen = false;
  const canonicalEntries = [];
  for (const entry of entries) {
    if (!supportedArchiveTypes.has(entry.type)) {
      failRelease("ARCHIVE_TYPE_UNSUPPORTED", `unsupported entry type at ${entry.path}`);
    }
    const relativePath = normalizeArchivePath(entry.path, rootPrefix);
    if (relativePath === undefined) {
      if (rootSeen || entry.type !== "directory") {
        failRelease("ARCHIVE_DUPLICATE_PATH", `duplicate or invalid archive root: ${rootPrefix}`);
      }
      normalizeArchiveMode(entry.type, entry.mode, rootPrefix);
      rootSeen = true;
      continue;
    }
    if (seen.has(relativePath)) {
      failRelease("ARCHIVE_DUPLICATE_PATH", `duplicate archive path: ${relativePath}`);
    }
    seen.add(relativePath);
    canonicalEntries.push(
      canonicalArchiveEntry(entry, { relativePath, rootPrefix, semanticJsonPaths }),
    );
  }
  canonicalEntries.sort((left, right) => compareCanonicalStrings(left.path, right.path));
  validateArchiveTopology(canonicalEntries);
  return { entries: canonicalEntries, sha256: sha256(canonicalJson(canonicalEntries)) };
}

function parseTarString(header, start, length) {
  const end = header.indexOf(0, start);
  const boundary = end === -1 || end > start + length ? start + length : end;
  if (
    end >= start &&
    end < start + length &&
    !header.subarray(end + 1, start + length).every((byte) => byte === 0)
  ) {
    failRelease("ARCHIVE_STRING_INVALID", "tar string has data after its NUL terminator");
  }
  return decodeArchiveUtf8(header.subarray(start, boundary), "tar string");
}

function parseTarNumber(header, start, length) {
  const bytes = header.subarray(start, start + length);
  if ((bytes[0] & 0x80) !== 0) {
    let value = BigInt(bytes[0] & 0x7f);
    for (const byte of bytes.subarray(1)) {
      value = value * 256n + BigInt(byte);
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      failRelease("ARCHIVE_NUMBER_TOO_LARGE", "tar numeric field exceeds the supported bound");
    }
    return Number(value);
  }
  const text = bytes.toString("ascii").replace(/\0.*$/s, "").trim();
  if (text === "") {
    return 0;
  }
  if (!/^[0-7]+$/.test(text)) {
    failRelease("ARCHIVE_HEADER_INVALID", `invalid tar numeric field: ${text}`);
  }
  return Number.parseInt(text, 8);
}

function verifyTarChecksum(header) {
  const expected = parseTarNumber(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    failRelease("ARCHIVE_CHECKSUM_INVALID", "tar header checksum does not match");
  }
}

function parsePaxRecords(data) {
  const records = Object.create(null);
  let offset = 0;
  while (offset < data.length) {
    const separator = data.indexOf(0x20, offset);
    if (separator < 0) {
      failRelease("ARCHIVE_PAX_INVALID", "PAX record length is missing");
    }
    const lengthText = data.subarray(offset, separator).toString("ascii");
    if (
      !/^[1-9]\d*$/.test(lengthText) ||
      !data.subarray(offset, separator).equals(Buffer.from(lengthText, "ascii"))
    ) {
      failRelease("ARCHIVE_PAX_INVALID", "PAX record length is invalid");
    }
    const length = Number.parseInt(lengthText, 10);
    if (
      !Number.isSafeInteger(length) ||
      separator >= offset + length - 1 ||
      offset + length > data.length ||
      data[offset + length - 1] !== 0x0a
    ) {
      failRelease("ARCHIVE_PAX_INVALID", "PAX record length is invalid");
    }
    const record = decodeArchiveUtf8(
      data.subarray(separator + 1, offset + length - 1),
      "PAX record",
    );
    const equals = record.indexOf("=");
    if (equals <= 0) {
      failRelease("ARCHIVE_PAX_INVALID", "PAX record value is invalid");
    }
    const key = record.slice(0, equals);
    if (!/^[\x21-\x3c\x3e-\x7e]+$/.test(key)) {
      failRelease("ARCHIVE_PAX_INVALID", "PAX record key is not printable ASCII");
    }
    if (Object.hasOwn(records, key)) {
      failRelease("ARCHIVE_PAX_DUPLICATE", `duplicate PAX record: ${key}`);
    }
    records[key] = record.slice(equals + 1);
    offset += length;
  }
  return records;
}

function validatePaxRecords(records, global) {
  for (const [key, value] of Object.entries(records)) {
    const valid = paxSemanticKeys.has(key)
      ? !global && value.length > 0 && !/[\0\r\n]/.test(value)
      : paxEnvelopeKeys.has(key) &&
        (key.endsWith("time")
          ? /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))
          : key.endsWith("id")
            ? /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
            : value.length > 0 && !/\p{Cc}/u.test(value));
    if (!valid) {
      failRelease("ARCHIVE_PAX_UNSUPPORTED", `unsupported PAX field: ${key}`);
    }
  }
}

function expandTarBytes(archiveBytes) {
  if (!Buffer.isBuffer(archiveBytes) || archiveBytes.length > maximumArchiveBytes) {
    failRelease("ARCHIVE_SIZE_LIMIT", "archive bytes exceed the supported bound");
  }
  if (archiveBytes[0] !== 0x1f || archiveBytes[1] !== 0x8b) {
    return archiveBytes;
  }
  try {
    return gunzipSync(archiveBytes, { maxOutputLength: maximumArchiveBytes });
  } catch (error) {
    failRelease("ARCHIVE_DECOMPRESSION_FAILED", "gzip archive cannot be expanded safely", {
      cause: error,
    });
  }
}

function readTarBlock(tarBytes, offset) {
  const header = tarBytes.subarray(offset, offset + 512);
  verifyTarChecksum(header);
  const size = parseTarNumber(header, 124, 12);
  const dataStart = offset + 512;
  const dataEnd = dataStart + size;
  const nextOffset = dataStart + Math.ceil(size / 512) * 512;
  if (dataEnd > tarBytes.length || nextOffset > tarBytes.length) {
    failRelease("ARCHIVE_TRUNCATED", "tar entry exceeds archive length");
  }
  if (!tarBytes.subarray(dataEnd, nextOffset).every((byte) => byte === 0)) {
    failRelease("ARCHIVE_PADDING_INVALID", "tar entry has nonzero padding bytes");
  }
  const prefix = parseTarString(header, 345, 155);
  const headerPath = parseTarString(header, 0, 100);
  const headerLink = parseTarString(header, 157, 100);
  parseTarString(header, 257, 6);
  parseTarString(header, 263, 2);
  parseTarString(header, 265, 32);
  parseTarString(header, 297, 32);
  return {
    data: tarBytes.subarray(dataStart, dataEnd),
    header,
    headerLink,
    joinedPath: prefix === "" ? headerPath : `${prefix}/${headerPath}`,
    nextOffset,
    typeFlag: String.fromCharCode(header[156] || 0x30),
  };
}

function setTarExtension(state, field, value) {
  if (state[field] !== undefined) {
    failRelease("ARCHIVE_EXTENSION_AMBIGUOUS", `tar repeats ${field} before a file entry`);
  }
  state[field] = value;
}

function applyTarExtension(block, state) {
  if (block.typeFlag === "x" || block.typeFlag === "g") {
    const records = parsePaxRecords(block.data);
    if (Object.hasOwn(records, "size")) {
      failRelease("ARCHIVE_PAX_UNSUPPORTED", "PAX size overrides are not supported");
    }
    validatePaxRecords(records, block.typeFlag === "g");
    if (block.typeFlag === "g") {
      if (Object.keys(records).some((key) => Object.hasOwn(state.globalPax, key))) {
        failRelease("ARCHIVE_EXTENSION_AMBIGUOUS", "tar repeats global PAX metadata");
      }
      state.globalPax = { ...state.globalPax, ...records };
    } else {
      if (state.nextPaxPresent) {
        failRelease("ARCHIVE_EXTENSION_AMBIGUOUS", "tar repeats a local PAX header");
      }
      state.nextPax = records;
      state.nextPaxPresent = true;
    }
    state.extensionPending = true;
    return true;
  }
  if (block.typeFlag === "L" || block.typeFlag === "K") {
    const field = block.typeFlag === "L" ? "longPath" : "longLink";
    const value = parseTarString(block.data, 0, block.data.length);
    if (value.length === 0) {
      failRelease("ARCHIVE_STRING_INVALID", `GNU ${field} is empty`);
    }
    setTarExtension(state, field, value);
    state.extensionPending = true;
    return true;
  }
  return false;
}

function tarEntryType(typeFlag) {
  return (
    {
      "\0": "file",
      0: "file",
      1: "hardlink",
      2: "symlink",
      5: "directory",
    }[typeFlag] ?? `type-${typeFlag}`
  );
}

function assertUnambiguousTarNames(attributes, state) {
  if (
    (attributes.path !== undefined && state.longPath !== undefined) ||
    (attributes.linkpath !== undefined && state.longLink !== undefined)
  ) {
    failRelease("ARCHIVE_EXTENSION_AMBIGUOUS", "tar supplies competing extended names");
  }
}

function consumeTarEntry(block, state) {
  if (state.entries.length >= maximumArchiveEntries) {
    failRelease("ARCHIVE_ENTRY_LIMIT", "archive entry count exceeds the supported bound");
  }
  if (Object.keys(state.nextPax).some((key) => Object.hasOwn(state.globalPax, key))) {
    failRelease("ARCHIVE_EXTENSION_AMBIGUOUS", "tar supplies competing global/local PAX metadata");
  }
  const attributes = { ...state.globalPax, ...state.nextPax };
  assertUnambiguousTarNames(attributes, state);
  const type = tarEntryType(block.typeFlag);
  const linkTarget = attributes.linkpath ?? state.longLink ?? block.headerLink;
  if (type !== "hardlink" && type !== "symlink" && linkTarget !== "") {
    failRelease(
      attributes.linkpath === undefined ? "ARCHIVE_LINK_TYPE_INVALID" : "ARCHIVE_PAX_UNSUPPORTED",
      "tar link metadata applies only to a link entry",
    );
  }
  if (type !== "file" && block.data.length !== 0) {
    failRelease("ARCHIVE_NONFILE_DATA", "tar non-file entry contains hidden payload bytes");
  }
  state.entries.push({
    data: type === "file" ? Buffer.from(block.data) : undefined,
    linkTarget,
    mode: parseTarNumber(block.header, 100, 8),
    path: attributes.path ?? state.longPath ?? block.joinedPath,
    type,
  });
  state.nextPax = {};
  state.nextPaxPresent = false;
  state.longPath = undefined;
  state.longLink = undefined;
  state.extensionPending = false;
}

function validateTarTerminator(tarBytes, offset, state) {
  if (tarBytes.length - offset < 1_024 || !tarBytes.subarray(offset).every((byte) => byte === 0)) {
    failRelease("ARCHIVE_TRAILING_DATA", "tar archive has an invalid or nonfinal terminator");
  }
  if (
    state.nextPaxPresent ||
    state.longPath !== undefined ||
    state.longLink !== undefined ||
    state.extensionPending
  ) {
    failRelease("ARCHIVE_EXTENSION_DANGLING", "tar ends with unused extended metadata");
  }
}

export function readTarEntries(archiveBytes) {
  const tarBytes = expandTarBytes(archiveBytes);
  if (tarBytes.length === 0 || tarBytes.length % 512 !== 0) {
    failRelease("ARCHIVE_TRUNCATED", "tar archive does not end on a complete block");
  }
  const state = {
    entries: [],
    extensionPending: false,
    globalPax: {},
    headerCount: 0,
    longLink: undefined,
    longPath: undefined,
    nextPax: {},
    nextPaxPresent: false,
  };
  let offset = 0;
  let terminated = false;
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      validateTarTerminator(tarBytes, offset, state);
      terminated = true;
      break;
    }
    state.headerCount += 1;
    if (state.headerCount > maximumArchiveEntries) {
      failRelease("ARCHIVE_ENTRY_LIMIT", "archive header count exceeds the supported bound");
    }
    const block = readTarBlock(tarBytes, offset);
    if (!applyTarExtension(block, state)) {
      consumeTarEntry(block, state);
    }
    offset = block.nextOffset;
  }
  if (!terminated) {
    failRelease("ARCHIVE_TERMINATOR_MISSING", "tar archive has no zero-block terminator");
  }
  return state.entries;
}

function cloneWithoutDependencySections(manifest) {
  const clone = structuredClone(manifest);
  for (const section of dependencySections) {
    delete clone[section];
  }
  return clone;
}

function dependencyRecord(value, label) {
  const dependencies = value ?? {};
  if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
    failRelease("NPM_DEPENDENCY_SECTION_INVALID", `${label} is not an object`);
  }
  return dependencies;
}

function validatePackedDependencyRange(options) {
  if (typeof options.packedRange !== "string") {
    failRelease(
      "NPM_DEPENDENCY_RANGE_INVALID",
      `${options.section}.${options.dependencyName} is not a string`,
    );
  }
  if (options.packedRange.startsWith("workspace:")) {
    failRelease(
      "NPM_WORKSPACE_PROTOCOL",
      `${options.section}.${options.dependencyName} retains workspace protocol`,
    );
  }
  if (!options.fixedPackageNames.has(options.dependencyName)) {
    if (options.sourceRange !== options.packedRange) {
      failRelease(
        "NPM_EXTERNAL_DEPENDENCY_CHANGED",
        `${options.section}.${options.dependencyName} changed during pack`,
      );
    }
    return;
  }
  const expectedRange =
    options.section === "peerDependencies"
      ? formatMinorLine(options.targetVersion)
      : options.targetVersion;
  if (options.packedRange !== expectedRange) {
    failRelease(
      options.section === "peerDependencies"
        ? "NPM_PEER_RANGE_INVALID"
        : "NPM_INTERNAL_RANGE_INVALID",
      `${options.dependencyName} does not match the packed target range`,
    );
  }
}

function validatePackedDependencySection(section, options) {
  const sourceDependencies = dependencyRecord(options.sourceManifest[section], `source ${section}`);
  const packedDependencies = dependencyRecord(options.packedManifest[section], `packed ${section}`);
  for (const dependencyName of Object.keys(sourceDependencies)) {
    if (!Object.hasOwn(packedDependencies, dependencyName)) {
      failRelease("NPM_DEPENDENCY_REMOVED", `${section}.${dependencyName} disappeared during pack`);
    }
  }
  for (const [dependencyName, packedRange] of Object.entries(packedDependencies)) {
    if (!Object.hasOwn(sourceDependencies, dependencyName)) {
      failRelease("NPM_DEPENDENCY_ADDED", `${section}.${dependencyName} appeared during pack`);
    }
    validatePackedDependencyRange({
      dependencyName,
      fixedPackageNames: options.fixedPackageNames,
      packedRange,
      section,
      sourceRange: sourceDependencies[dependencyName],
      targetVersion: options.targetVersion,
    });
  }
}

export function validatePackedNpmManifest(options) {
  if (
    options.packedManifest.name !== options.sourceManifest.name ||
    options.packedManifest.version !== options.targetVersion
  ) {
    failRelease(
      "NPM_PACKED_IDENTITY_MISMATCH",
      "packed npm name/version does not match the target",
    );
  }
  for (const scriptName of forbiddenLifecycleScripts) {
    if (Object.hasOwn(options.packedManifest.scripts ?? {}, scriptName)) {
      failRelease(
        "NPM_LIFECYCLE_SCRIPT_FORBIDDEN",
        `forbidden npm lifecycle script: ${scriptName}`,
      );
    }
  }
  if (
    !deepEqualCanonical(
      cloneWithoutDependencySections(options.sourceManifest),
      cloneWithoutDependencySections(options.packedManifest),
    )
  ) {
    failRelease("NPM_PACKED_MANIFEST_CHANGED", "packed npm manifest changed a forbidden field");
  }

  for (const section of dependencySections) {
    validatePackedDependencySection(section, options);
  }
}

function findFile(entries, archivePath) {
  const candidates = entries.filter(
    (candidate) => candidate.path === archivePath && candidate.type === "file",
  );
  if (candidates.length !== 1 || !Buffer.isBuffer(candidates[0].data)) {
    failRelease(
      "ARCHIVE_REQUIRED_FILE_MISSING",
      `required archive file is missing or duplicated: ${archivePath}`,
    );
  }
  return candidates[0].data;
}

export function inspectNpmArchive(options) {
  const manifestBytes = findFile(options.entries, "package/package.json");
  let manifest;
  try {
    manifest = parseStrictJsonBytes(manifestBytes, "packed package.json");
  } catch (error) {
    failRelease("NPM_PACKED_MANIFEST_INVALID", "packed package.json is invalid", { cause: error });
  }
  validatePackedNpmManifest({
    fixedPackageNames: options.fixedPackageNames,
    packedManifest: manifest,
    sourceManifest: options.sourceManifest,
    targetVersion: options.targetVersion,
  });
  const canonical = canonicalizeArchiveEntries(options.entries, {
    rootPrefix: "package",
    semanticJsonPaths: new Set(["package.json"]),
  });
  return { canonicalEntries: canonical.entries, canonicalSha256: canonical.sha256, manifest };
}

function publicDependencyNames(cargoPackage, publicNames) {
  return new Set(
    cargoPackage.dependencies
      .map((dependency) => dependency.split(" ", 1)[0])
      .filter((dependencyName) => publicNames.has(dependencyName)),
  );
}

function sameStringSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateArchiveLock(lockText, options) {
  const projection = projectPublicCargoLock(lockText, options.expectedPublicVersions);
  const publicNames = new Set(options.expectedPublicVersions.keys());
  const ownEntry = projection.find((entry) => entry.name === options.crateName);
  if (
    ownEntry === undefined ||
    ownEntry.version !== options.expectedPublicVersions.get(options.crateName)
  ) {
    failRelease(
      "CRATE_ARCHIVE_LOCK_SELF_MISMATCH",
      "archive lock does not contain the packaged crate target",
    );
  }
  if (ownEntry.source !== undefined || ownEntry.checksum !== undefined) {
    failRelease("CRATE_ARCHIVE_LOCK_SELF_SOURCE", "packaged crate lock entry must be source-less");
  }
  for (const entry of projection) {
    const expectedVersion = options.expectedPublicVersions.get(entry.name);
    const expectedDependencies = options.expectedPublicDependencies.get(entry.name);
    if (
      !(expectedDependencies instanceof Set) ||
      !sameStringSet(publicDependencyNames(entry, publicNames), expectedDependencies)
    ) {
      failRelease(
        "CRATE_ARCHIVE_LOCK_DEPENDENCY_MISMATCH",
        `${entry.name} archive lock dependencies differ from the public graph`,
      );
    }
    if (entry.version !== expectedVersion) {
      failRelease(
        "CRATE_ARCHIVE_LOCK_VERSION_MISMATCH",
        `${entry.name} has an unexpected archive lock version`,
      );
    }
    if (entry.name !== options.crateName) {
      if (entry.source !== "registry+https://github.com/rust-lang/crates.io-index") {
        failRelease("CRATE_ARCHIVE_LOCK_SOURCE_MISMATCH", `${entry.name} is not registry-backed`);
      }
      if (typeof entry.checksum !== "string" || !/^[a-f0-9]{64}$/.test(entry.checksum)) {
        failRelease(
          "CRATE_ARCHIVE_LOCK_CHECKSUM_INVALID",
          `${entry.name} has no canonical checksum`,
        );
      }
    }
  }
  return projection;
}

function validateCrateVcsInfo(vcsInfo, options) {
  if (
    vcsInfo === null ||
    typeof vcsInfo !== "object" ||
    Array.isArray(vcsInfo) ||
    Object.keys(vcsInfo).sort().join("\0") !== "git\0path_in_vcs" ||
    vcsInfo.git === null ||
    typeof vcsInfo.git !== "object" ||
    Array.isArray(vcsInfo.git)
  ) {
    failRelease("CRATE_VCS_INVALID", ".cargo_vcs_info.json has an unsupported shape");
  }
  const gitKeys = Object.keys(vcsInfo.git).sort();
  if (!(gitKeys.join("\0") === "sha1" || gitKeys.join("\0") === "dirty\0sha1")) {
    failRelease("CRATE_VCS_INVALID", ".cargo_vcs_info.json has unsupported Git fields");
  }
  if (vcsInfo.git.sha1 !== options.releaseCommit || vcsInfo.path_in_vcs !== options.expectedPath) {
    failRelease("CRATE_VCS_MISMATCH", "crate VCS metadata does not match the release source");
  }
  if (
    options.requireCleanVcs !== false &&
    vcsInfo.git.dirty !== undefined &&
    vcsInfo.git.dirty !== false
  ) {
    failRelease("CRATE_VCS_DIRTY", "crate VCS metadata reports a dirty source");
  }
}

export function inspectCrateArchive(options) {
  const rootPrefix = `${options.crateName}-${options.version}`;
  const vcsPath = `${rootPrefix}/.cargo_vcs_info.json`;
  const originalManifest = findFile(options.entries, `${rootPrefix}/Cargo.toml.orig`);
  findFile(options.entries, `${rootPrefix}/Cargo.toml`);
  if (!Buffer.isBuffer(options.sourceManifest)) {
    failRelease("CRATE_SOURCE_MANIFEST_INVALID", "crate source manifest bytes are required");
  }
  if (!originalManifest.equals(options.sourceManifest)) {
    failRelease(
      "CRATE_ORIGINAL_MANIFEST_MISMATCH",
      "crate Cargo.toml.orig does not equal the release source manifest",
    );
  }
  const lockBytes = findFile(options.entries, `${rootPrefix}/Cargo.lock`);
  const vcsBytes = findFile(options.entries, vcsPath);
  let vcsInfo;
  try {
    vcsInfo = parseStrictJsonBytes(vcsBytes, ".cargo_vcs_info.json");
  } catch (error) {
    failRelease("CRATE_VCS_INVALID", ".cargo_vcs_info.json is invalid", { cause: error });
  }
  validateCrateVcsInfo(vcsInfo, options);
  const lockProjection = validateArchiveLock(lockBytes.toString("utf8"), {
    crateName: options.crateName,
    expectedPublicDependencies: options.expectedPublicDependencies,
    expectedPublicVersions: options.expectedPublicVersions,
  });
  const canonical = canonicalizeArchiveEntries(
    options.entries.map((entry) =>
      entry.path === vcsPath && entry.type === "file"
        ? { ...entry, data: crateVcsPayloadSentinel }
        : entry,
    ),
    { rootPrefix },
  );
  return {
    canonicalEntries: canonical.entries,
    canonicalSha256: canonical.sha256,
    lockProjection,
    originalManifestSha256: sha256(originalManifest),
    vcsInfo,
  };
}
