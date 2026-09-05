import { compareCanonicalStrings } from "./canonical.mjs";
import { failRelease } from "./errors.mjs";

function parseQuotedValue(rawValue, field) {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    failRelease("CARGO_LOCK_PARSE_FAILED", `invalid ${field} value in Cargo.lock`, {
      cause: error,
    });
  }
}

function parseDependencies(block) {
  const matches = [...block.matchAll(/^dependencies\s*=\s*\[([\s\S]*?)^\]/gm)];
  if (matches.length === 0) {
    return [];
  }
  if (matches.length !== 1) {
    failRelease("CARGO_LOCK_PARSE_FAILED", "Cargo.lock package repeats dependencies");
  }
  const dependencies = [];
  for (const rawLine of matches[0][1].split("\n")) {
    if (rawLine.trim() === "") {
      continue;
    }
    const dependencyMatch = /^\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/.exec(rawLine);
    if (dependencyMatch === null) {
      failRelease("CARGO_LOCK_PARSE_FAILED", "Cargo.lock has an invalid dependency entry");
    }
    dependencies.push(parseQuotedValue(dependencyMatch[1], "dependency"));
  }
  return dependencies.sort();
}

function parsePackageField(block, field) {
  const matches = [
    ...block.matchAll(new RegExp(`^${field}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$`, "gm")),
  ];
  if (matches.length > 1) {
    failRelease("CARGO_LOCK_PARSE_FAILED", `Cargo.lock package repeats ${field}`);
  }
  return matches.length === 0 ? undefined : parseQuotedValue(matches[0][1], field);
}

function parseCargoPackageBlock(block) {
  const fields = Object.fromEntries(
    ["name", "version", "source", "checksum"].map((field) => [
      field,
      parsePackageField(block, field),
    ]),
  );
  if (fields.name === undefined || fields.version === undefined) {
    failRelease("CARGO_LOCK_PARSE_FAILED", "Cargo.lock package is missing name or version");
  }
  const cargoPackage = {
    dependencies: parseDependencies(block),
    name: fields.name,
    version: fields.version,
  };
  if (fields.source !== undefined) {
    cargoPackage.source = fields.source;
  }
  if (fields.checksum !== undefined) {
    cargoPackage.checksum = fields.checksum;
  }
  return cargoPackage;
}

function assertUniquePackageIdentities(packages) {
  const identities = new Set();
  for (const cargoPackage of packages) {
    const identity = `${cargoPackage.name}\0${cargoPackage.version}\0${cargoPackage.source ?? ""}`;
    if (identities.has(identity)) {
      failRelease(
        "CARGO_LOCK_DUPLICATE_PACKAGE",
        `Cargo.lock repeats ${cargoPackage.name} ${cargoPackage.version}`,
      );
    }
    identities.add(identity);
  }
}

export function parseCargoLock(lockText) {
  if (typeof lockText !== "string" || !/^version\s*=\s*4\s*$/m.test(lockText)) {
    failRelease("CARGO_LOCK_PARSE_FAILED", "Cargo.lock must use format version 4");
  }
  const packages = lockText
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map(parseCargoPackageBlock);
  assertUniquePackageIdentities(packages);
  return packages;
}

export function projectPublicCargoLock(lockText, publicVersions) {
  const packages = parseCargoLock(lockText);
  const projection = [];
  for (const cargoPackage of packages) {
    if (publicVersions.has(cargoPackage.name)) {
      projection.push(cargoPackage);
    }
  }
  const names = projection.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    failRelease("CARGO_ARCHIVE_LOCK_DUPLICATE_PUBLIC", "archive lock repeats a public crate name");
  }
  projection.sort((left, right) => compareCanonicalStrings(left.name, right.name));
  return projection;
}

function dependencyPackageName(dependency) {
  return dependency.split(" ", 1)[0];
}

function sameStringSets(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  return [...left].every((value) => right.has(value));
}

function validateRootLockEntry(cargoPackage, options) {
  if (
    cargoPackage.source === undefined &&
    !options.workspaceNames.has(cargoPackage.name) &&
    !options.patchNames.has(cargoPackage.name)
  ) {
    failRelease(
      "CARGO_ROOT_LOCK_SOURCELESS_EXTERNAL",
      `${cargoPackage.name} is source-less but is neither a workspace member nor an approved patch`,
    );
  }
  if (cargoPackage.source === undefined && cargoPackage.checksum !== undefined) {
    failRelease(
      "CARGO_ROOT_LOCK_SOURCELESS_CHECKSUM",
      `${cargoPackage.name} is source-less but carries a checksum`,
    );
  }
  if (options.workspaceNames.has(cargoPackage.name) && cargoPackage.source !== undefined) {
    failRelease(
      "CARGO_ROOT_LOCK_WORKSPACE_SOURCE",
      `${cargoPackage.name} workspace entry must not have a registry source`,
    );
  }
}

function validatePublicLockEntry(options) {
  const candidates = options.entries.filter(({ name }) => name === options.crateName);
  if (candidates.length !== 1) {
    failRelease(
      "CARGO_ROOT_LOCK_PUBLIC_IDENTITY",
      `${options.crateName} must have exactly one root lock entry`,
    );
  }
  const lockPackage = candidates[0];
  if (lockPackage.version !== options.expectedVersion) {
    failRelease(
      "CARGO_ROOT_LOCK_VERSION_MISMATCH",
      `${options.crateName} lock version ${lockPackage.version} does not match ${options.expectedVersion}`,
    );
  }
  if (lockPackage.source !== undefined || lockPackage.checksum !== undefined) {
    failRelease(
      "CARGO_ROOT_LOCK_WORKSPACE_SOURCE",
      `${options.crateName} root lock entry must be source-less`,
    );
  }
  const actualPublicDependencies = new Set(
    lockPackage.dependencies
      .map(dependencyPackageName)
      .filter((dependencyName) => options.publicNames.has(dependencyName)),
  );
  const expectedDependencies = options.publicDependencies.get(options.crateName) ?? new Set();
  if (!sameStringSets(actualPublicDependencies, expectedDependencies)) {
    failRelease(
      "CARGO_ROOT_LOCK_DEPENDENCY_MISMATCH",
      `${options.crateName} public dependency projection does not match the manifest graph`,
    );
  }
  return lockPackage;
}

export function validateRootCargoLock(lockText, options) {
  const entries = parseCargoLock(lockText);
  const publicNames = new Set(options.publicVersions.keys());
  for (const cargoPackage of entries) {
    validateRootLockEntry(cargoPackage, options);
  }
  const publicProjection = [...options.publicVersions].map(([crateName, expectedVersion]) =>
    validatePublicLockEntry({
      crateName,
      entries,
      expectedVersion,
      publicDependencies: options.publicDependencies,
      publicNames,
    }),
  );
  publicProjection.sort((left, right) => compareCanonicalStrings(left.name, right.name));
  return { entries, publicProjection };
}
