import { canonicalJson, compareCanonicalStrings, deepEqualCanonical } from "./canonical.mjs";
import { parseCargoLock, validateRootCargoLock } from "./cargo-lock.mjs";
import { failRelease } from "./errors.mjs";
import { deriveFixedGroupChangesetTarget } from "./materialize.mjs";
import { parseChangeset, validateReleaseMarker } from "./model.mjs";
import { compareStableVersions, formatMinorLine, parseStableVersion } from "./semver.mjs";

const npmDependencySections = [
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
];

function requiredEntry(files, path, side) {
  const fileEntry = files.get(path);
  if (fileEntry === undefined) {
    failRelease("VERSION_REQUIRED_PATH_MISSING", `${side} is missing ${path}`);
  }
  return fileEntry;
}

function parseJsonEntry(files, path, side) {
  try {
    return JSON.parse(requiredEntry(files, path, side).bytes.toString("utf8"));
  } catch (error) {
    failRelease("VERSION_JSON_INVALID", `${side} ${path} is not valid JSON`, { cause: error });
  }
}

function changedFileEntries(baseFiles, headFiles) {
  const paths = [...new Set([...baseFiles.keys(), ...headFiles.keys()])].sort();
  return paths
    .map((path) => {
      const before = baseFiles.get(path);
      const after = headFiles.get(path);
      if (
        before?.mode === after?.mode &&
        before !== undefined &&
        after !== undefined &&
        before.bytes.equals(after.bytes)
      ) {
        return undefined;
      }
      return { after, before, path };
    })
    .filter((entry) => entry !== undefined);
}

function uniformNpmVersion(files, packages, side) {
  const versions = new Set(
    packages.map(({ manifestPath }) => parseJsonEntry(files, manifestPath, side).version),
  );
  if (versions.size !== 1) {
    failRelease("NPM_VERSION_PARTIAL", `${side} fixed group does not have one version`);
  }
  const version = [...versions][0];
  parseStableVersion(version);
  return version;
}

function validateInternalNpmRequirement(options) {
  if (options.side !== "head") {
    return;
  }
  if (options.section === "peerDependencies") {
    if (options.requirement !== formatMinorLine(options.targetVersion)) {
      failRelease(
        "NPM_INTERNAL_PEER_MISMATCH",
        `${options.packageName} peer ${options.dependencyName} is not on the target minor line`,
      );
    }
    return;
  }
  if (
    typeof options.requirement !== "string" ||
    (!options.requirement.startsWith("workspace:") && options.requirement !== options.targetVersion)
  ) {
    failRelease(
      "NPM_INTERNAL_RANGE_INVALID",
      `${options.packageName} ${options.section} dependency ${options.dependencyName} is not materialized safely`,
    );
  }
}

function normalizeNpmManifest(manifest, options) {
  const normalized = structuredClone(manifest);
  normalized.version = "__FIXED_VERSION__";
  for (const section of npmDependencySections) {
    const dependencies = normalized[section] ?? {};
    for (const [dependencyName, requirement] of Object.entries(dependencies)) {
      if (!options.fixedNames.has(dependencyName)) {
        continue;
      }
      validateInternalNpmRequirement({
        dependencyName,
        packageName: manifest.name,
        requirement,
        section,
        side: options.side,
        targetVersion: options.targetVersion,
      });
      dependencies[dependencyName] = "__INTERNAL_RANGE__";
    }
  }
  return normalized;
}

function validateNpmManifestDelta(options) {
  const fixedNames = new Set(options.npmPackages.map(({ name }) => name));
  for (const npmPackage of options.npmPackages) {
    const baseManifest = parseJsonEntry(options.baseFiles, npmPackage.manifestPath, "base");
    const headManifest = parseJsonEntry(options.headFiles, npmPackage.manifestPath, "head");
    if (baseManifest.name !== npmPackage.name || headManifest.name !== npmPackage.name) {
      failRelease(
        "NPM_MANIFEST_IDENTITY_CHANGED",
        `${npmPackage.manifestPath} changed package name`,
      );
    }
    const normalizedBase = normalizeNpmManifest(baseManifest, {
      fixedNames,
      side: "base",
      targetVersion: options.targetVersion,
    });
    const normalizedHead = normalizeNpmManifest(headManifest, {
      fixedNames,
      side: "head",
      targetVersion: options.targetVersion,
    });
    if (!deepEqualCanonical(normalizedBase, normalizedHead)) {
      failRelease(
        "NPM_MANIFEST_FORBIDDEN_DELTA",
        `${npmPackage.manifestPath} changed outside version/internal ranges`,
      );
    }
  }
}

function normalizedChangesetSummary(summary) {
  return summary
    .replace(/^\s*(?:pr|pull|pull\s+request):\s*#?(\d+)/im, "")
    .replace(/^\s*commit:\s*([^\s]+)/im, "")
    .replace(/^\s*(?:author|user):\s*@?([^\s]+)/gim, "")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd());
}

function changelogContainsSummary(inserted, summary) {
  const expectedLines = normalizedChangesetSummary(summary);
  if (expectedLines.length === 0 || expectedLines[0] === "") {
    return false;
  }
  const insertedLines = inserted.split("\n").map((line) => line.trimEnd());
  return insertedLines.some((line, startIndex) => {
    if (!line.endsWith(expectedLines[0])) {
      return false;
    }
    return expectedLines.slice(1).every((expectedLine, offset) => {
      const actualLine = insertedLines[startIndex + offset + 1];
      return expectedLine === "" ? actualLine === "" : actualLine === `  ${expectedLine}`;
    });
  });
}

function validateChangelog(baseBytes, headBytes, options) {
  const baseText = baseBytes.toString("utf8");
  const headText = headBytes.toString("utf8");
  const firstBreak = baseText.indexOf("\n\n");
  if (firstBreak < 0) {
    failRelease("CHANGELOG_BASE_INVALID", `${options.packageName} changelog has no stable header`);
  }
  const header = baseText.slice(0, firstBreak + 2);
  const preservedBody = baseText.slice(firstBreak + 2);
  if (!headText.startsWith(header) || !headText.endsWith(preservedBody)) {
    failRelease(
      "CHANGELOG_COVERAGE_INVALID",
      `${options.packageName} changelog does not preserve history and add ${options.targetVersion}`,
    );
  }
  const inserted = headText.slice(header.length, headText.length - preservedBody.length);
  const heading = `## ${options.targetVersion}`;
  const [firstLine, ...remainingLines] = inserted.split("\n");
  const insertedBody = remainingLines.join("\n").trim();
  if (
    firstLine !== heading ||
    remainingLines[0] !== "" ||
    (options.expectedSummaries.length > 0 && insertedBody.length === 0) ||
    remainingLines.some((line) => /^##\s/.test(line)) ||
    options.expectedSummaries.some((summary) => !changelogContainsSummary(inserted, summary))
  ) {
    failRelease(
      "CHANGELOG_COVERAGE_INVALID",
      `${options.packageName} changelog does not contain the exact target block and summaries`,
    );
  }
}

function parseTomlString(rawValue, path) {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    failRelease("CARGO_MANIFEST_PARSE_FAILED", `invalid TOML string in ${path}`, { cause: error });
  }
}

const releaseMarkerSection = "package.metadata.boundsvg-release";

function parseReleaseMarkerLine(rawLine, options) {
  const markerAssignment = /^\s*([A-Za-z0-9-]+)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(rawLine);
  if (markerAssignment === null) {
    if (rawLine.trim() !== "") {
      failRelease("CARGO_MANIFEST_PARSE_FAILED", `invalid release marker in ${options.path}`);
    }
    return;
  }
  const key = markerAssignment[1];
  if (Object.hasOwn(options.marker, key)) {
    failRelease("CARGO_MANIFEST_PARSE_FAILED", `duplicate release marker key in ${options.path}`);
  }
  options.marker[key] = parseTomlString(markerAssignment[2], options.path);
}

function normalizeCargoPackageLine(rawLine, options) {
  const identityAssignment = /^\s*(name|version)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(rawLine);
  if (identityAssignment === null) {
    return rawLine;
  }
  const value = parseTomlString(identityAssignment[2], options.path);
  if (identityAssignment[1] === "name") {
    options.state.packageName = value;
    return rawLine;
  }
  options.state.version = value;
  return rawLine.replace(identityAssignment[2], '"__PACKAGE_VERSION__"');
}

function normalizeCargoDependencyLine(rawLine, options) {
  const dependencyAssignment = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(rawLine);
  if (dependencyAssignment === null || !options.publicNames.has(dependencyAssignment[1])) {
    return rawLine;
  }
  const requirementMatch = /\bversion\s*=\s*("(?:[^"\\]|\\.)*")/.exec(dependencyAssignment[2]);
  const pathMatch = /\bpath\s*=\s*("(?:[^"\\]|\\.)*")/.exec(dependencyAssignment[2]);
  if (requirementMatch === null || pathMatch === null) {
    failRelease(
      "CARGO_PUBLIC_DEPENDENCY_INVALID",
      `${options.path} has an unbounded public path dependency ${dependencyAssignment[1]}`,
    );
  }
  options.publicDependencies.set(
    dependencyAssignment[1],
    parseTomlString(requirementMatch[1], options.path),
  );
  return rawLine.replace(requirementMatch[1], '"__PUBLIC_VERSION__"');
}

function parseCargoManifest(path, bytes, publicNames) {
  const state = { packageName: undefined, section: "", version: undefined };
  const marker = {};
  const publicDependencies = new Map();
  const normalizedLines = [];
  for (const rawLine of bytes.toString("utf8").split("\n")) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine);
    if (sectionMatch !== null) {
      state.section = sectionMatch[1];
      if (state.section === releaseMarkerSection) {
        continue;
      }
      normalizedLines.push(rawLine);
      continue;
    }
    if (state.section === releaseMarkerSection) {
      parseReleaseMarkerLine(rawLine, { marker, path });
      continue;
    }
    if (state.section === "package") {
      normalizedLines.push(normalizeCargoPackageLine(rawLine, { path, state }));
      continue;
    }
    if (/^(?:target\..+\.)?(?:dev-|build-)?dependencies$/.test(state.section)) {
      normalizedLines.push(
        normalizeCargoDependencyLine(rawLine, { path, publicDependencies, publicNames }),
      );
      continue;
    }
    normalizedLines.push(rawLine);
  }
  if (state.packageName === undefined || state.version === undefined) {
    failRelease("CARGO_MANIFEST_PARSE_FAILED", `${path} has no package name/version`);
  }
  parseStableVersion(state.version);
  return {
    marker: Object.keys(marker).length === 0 ? undefined : marker,
    name: state.packageName,
    normalizedText: normalizedLines.join("\n"),
    publicDependencies,
    version: state.version,
  };
}

export function cargoManifestHasReleaseMarker(path, bytes, publicNames) {
  return parseCargoManifest(path, bytes, publicNames).marker !== undefined;
}

function validateParsedMarker(crateName, manifest) {
  if (manifest.marker !== undefined) {
    validateReleaseMarker(crateName, {
      currentVersion: manifest.version,
      isPublic: true,
      marker: manifest.marker,
    });
  }
}

function parseCargoManifestPair(cargoPackage, options) {
  const baseManifest = parseCargoManifest(
    cargoPackage.manifestPath,
    requiredEntry(options.baseFiles, cargoPackage.manifestPath, "base").bytes,
    options.publicNames,
  );
  const headManifest = parseCargoManifest(
    cargoPackage.manifestPath,
    requiredEntry(options.headFiles, cargoPackage.manifestPath, "head").bytes,
    options.publicNames,
  );
  if (baseManifest.name !== cargoPackage.name || headManifest.name !== cargoPackage.name) {
    failRelease("CARGO_MANIFEST_IDENTITY_CHANGED", `${cargoPackage.manifestPath} changed name`);
  }
  validateParsedMarker(cargoPackage.name, baseManifest);
  validateParsedMarker(cargoPackage.name, headManifest);
  const comparison = compareStableVersions(headManifest.version, baseManifest.version);
  if (comparison < 0) {
    failRelease("CARGO_VERSION_REGRESSED", `${cargoPackage.name} version regressed`);
  }
  return { baseManifest, cargoPackage, didAdvance: comparison > 0, headManifest };
}

function validateMaterializedCargoManifestDelta(pair) {
  if (pair.baseManifest.normalizedText !== pair.headManifest.normalizedText) {
    failRelease(
      "CARGO_MANIFEST_FORBIDDEN_DELTA",
      `${pair.cargoPackage.manifestPath} changed outside version/public ranges/marker consumption`,
    );
  }
}

function validateMarkerTransition(pair) {
  const { baseManifest, cargoPackage, didAdvance, headManifest } = pair;
  if (baseManifest.marker === undefined) {
    return;
  }
  if (!didAdvance && headManifest.marker === undefined) {
    failRelease(
      "CARGO_MARKER_ONLY_DELETION",
      `${cargoPackage.name} release marker was deleted without a version advance`,
    );
  }
  if (
    didAdvance &&
    (baseManifest.marker["pending-version"] !== headManifest.version ||
      headManifest.marker !== undefined)
  ) {
    failRelease(
      "CARGO_MARKER_NOT_CONSUMED",
      `${cargoPackage.name} did not consume its exact pending marker`,
    );
  }
  if (!didAdvance && !deepEqualCanonical(baseManifest.marker, headManifest.marker)) {
    failRelease("CARGO_MARKER_CHANGED", `${cargoPackage.name} release marker changed unexpectedly`);
  }
}

function changedPublicCargoDependency(pair) {
  return [...pair.headManifest.publicDependencies].some(
    ([dependencyName, requirement]) =>
      pair.baseManifest.publicDependencies.get(dependencyName) !== requirement,
  );
}

function validateCargoPackageObligations(pair, headByName) {
  validateMarkerTransition(pair);
  const dependencyChanged = changedPublicCargoDependency(pair);
  if (pair.didAdvance && pair.baseManifest.marker === undefined && !dependencyChanged) {
    failRelease(
      "CARGO_UNMARKED_ADVANCE",
      `${pair.cargoPackage.name} advanced without a marker or public dependency obligation`,
    );
  }
  if (!pair.didAdvance && dependencyChanged) {
    failRelease(
      "CARGO_CONSUMER_NOT_ADVANCED",
      `${pair.cargoPackage.name} changed a public dependency without advancing`,
    );
  }
  for (const [dependencyName, requirement] of pair.headManifest.publicDependencies) {
    if (headByName.get(dependencyName)?.version !== requirement) {
      failRelease(
        "CARGO_INTERNAL_RANGE_MISMATCH",
        `${pair.cargoPackage.name} does not require ${dependencyName} at its target version`,
      );
    }
  }
}

function validateCargoManifestDelta(options) {
  const publicNames = new Set(options.cargoPackages.map(({ name }) => name));
  const pairs = options.cargoPackages.map((cargoPackage) =>
    parseCargoManifestPair(cargoPackage, { ...options, publicNames }),
  );
  const baseByName = new Map(
    pairs.map(({ baseManifest, cargoPackage }) => [cargoPackage.name, baseManifest]),
  );
  const headByName = new Map(
    pairs.map(({ cargoPackage, headManifest }) => [cargoPackage.name, headManifest]),
  );
  const cargoMaterialized = pairs.some(({ didAdvance }) => didAdvance);
  if (cargoMaterialized) {
    for (const pair of pairs) {
      validateMaterializedCargoManifestDelta(pair);
      validateCargoPackageObligations(pair, headByName);
    }
  } else {
    for (const { baseManifest, cargoPackage, headManifest } of pairs) {
      if (baseManifest.marker !== undefined && headManifest.marker === undefined) {
        failRelease(
          "CARGO_MARKER_ONLY_DELETION",
          `${cargoPackage.name} release marker was deleted without a version advance`,
        );
      }
    }
  }
  const advanced = pairs
    .filter(({ didAdvance }) => didAdvance)
    .map(({ cargoPackage }) => cargoPackage.name)
    .sort();
  return { advanced, baseByName, headByName };
}

function validateLockDelta(options, cargoResult) {
  const headLock = requiredEntry(options.headFiles, "Cargo.lock", "head").bytes.toString("utf8");
  const publicVersions = new Map(
    [...cargoResult.headByName].map(([name, manifest]) => [name, manifest.version]),
  );
  const publicDependencies = new Map(
    [...cargoResult.headByName].map(([name, manifest]) => [
      name,
      new Set(manifest.publicDependencies.keys()),
    ]),
  );
  validateRootCargoLock(headLock, {
    patchNames: options.patchNames,
    publicDependencies,
    publicVersions,
    workspaceNames: options.workspaceNames,
  });
  const publicNames = new Set(publicVersions.keys());
  const externalProjection = (lockText) =>
    parseCargoLock(lockText)
      .filter(({ name }) => !publicNames.has(name))
      .sort((left, right) =>
        compareCanonicalStrings(
          `${left.name}\0${left.version}\0${left.source ?? ""}`,
          `${right.name}\0${right.version}\0${right.source ?? ""}`,
        ),
      );
  const baseExternal = externalProjection(
    requiredEntry(options.baseFiles, "Cargo.lock", "base").bytes.toString("utf8"),
  );
  const headExternal = externalProjection(headLock);
  if (canonicalJson(baseExternal) !== canonicalJson(headExternal)) {
    failRelease("CARGO_ROOT_LOCK_EXTERNAL_DELTA", "root Cargo.lock changed outside public entries");
  }
}

function pendingChangesetPaths(files) {
  const paths = [...files.keys()].filter(
    (path) =>
      path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md",
  );
  for (const path of paths) {
    parseChangeset(path, files.get(path).bytes.toString("utf8"));
  }
  return paths.sort();
}

function validatePendingChangesetPackages(files, npmPackages) {
  const fixedNames = new Set(npmPackages.map(({ name }) => name));
  for (const path of pendingChangesetPaths(files)) {
    const changeset = parseChangeset(path, files.get(path).bytes.toString("utf8"));
    for (const release of changeset.releases) {
      if (!fixedNames.has(release.name)) {
        failRelease(
          "CHANGESET_PACKAGE_OUTSIDE_FIXED_GROUP",
          `${path} names non-fixed package ${release.name}`,
        );
      }
    }
  }
}

function assertAllowedMaterializedPaths(options, classification) {
  const allowed = new Set();
  if (classification.npmAdvanced) {
    for (const path of pendingChangesetPaths(options.baseFiles)) {
      allowed.add(path);
    }
    for (const npmPackage of options.npmPackages) {
      allowed.add(npmPackage.manifestPath);
      allowed.add(npmPackage.changelogPath);
    }
  }
  if (classification.cargoAdvanced.length > 0) {
    allowed.add("Cargo.lock");
    for (const cargoPackage of options.cargoPackages) {
      allowed.add(cargoPackage.manifestPath);
    }
  }
  for (const change of classification.changes) {
    if (!allowed.has(change.path)) {
      failRelease("VERSION_PATH_NOT_ALLOWED", `${change.path} is outside the version delta`);
    }
    if (
      change.before !== undefined &&
      change.after !== undefined &&
      change.before.mode !== change.after.mode
    ) {
      failRelease("VERSION_MODE_CHANGED", `${change.path} changed file mode`);
    }
  }
}

function nonMaterializedDelta(changes, deletedChangesets) {
  if (deletedChangesets.length === 0) {
    return { cargo: { advanced: [] }, npm: { advanced: false }, phase: "steady" };
  }
  if (
    changes.length !== deletedChangesets.length ||
    changes.some(({ path }) => !deletedChangesets.includes(path))
  ) {
    failRelease(
      "CHANGESET_MAINTENANCE_MIXED",
      "Changeset maintenance deletion is mixed with another semantic change",
    );
  }
  return { cargo: { advanced: [] }, npm: { advanced: false }, phase: "changeset-maintenance" };
}

function assertMaterializedInputsConsumed(options, cargoResult) {
  if (pendingChangesetPaths(options.headFiles).length > 0) {
    failRelease("CHANGESET_NOT_CONSUMED", "materialized versions left a pending Changeset");
  }
  if ([...cargoResult.headByName.values()].some(({ marker }) => marker !== undefined)) {
    failRelease("CARGO_MARKER_NOT_CONSUMED", "materialized versions left a pending Cargo marker");
  }
}

function validateNpmMaterialization(options, targetNpmVersion, deletedChangesets) {
  const baseChangesets = pendingChangesetPaths(options.baseFiles);
  if (
    pendingChangesetPaths(options.headFiles).length !== 0 ||
    deletedChangesets.length !== baseChangesets.length
  ) {
    failRelease("CHANGESET_NOT_CONSUMED", "materialized npm versions did not consume all inputs");
  }
  validateNpmManifestDelta({ ...options, targetVersion: targetNpmVersion });
  const parsedChangesets = baseChangesets.map((path) =>
    parseChangeset(path, options.baseFiles.get(path).bytes.toString("utf8")),
  );
  const changesetTarget = deriveFixedGroupChangesetTarget(
    parsedChangesets,
    new Set(options.npmPackages.map(({ name }) => name)),
    options.currentNpmVersion,
  );
  if (!changesetTarget.advances || changesetTarget.target !== targetNpmVersion) {
    failRelease(
      "CHANGESET_TARGET_MISMATCH",
      "materialized npm target does not equal the Changeset-derived fixed-group target",
    );
  }
  for (const npmPackage of options.npmPackages) {
    validateChangelog(
      requiredEntry(options.baseFiles, npmPackage.changelogPath, "base").bytes,
      requiredEntry(options.headFiles, npmPackage.changelogPath, "head").bytes,
      {
        expectedSummaries: parsedChangesets
          .filter(({ releases }) => releases.some(({ name }) => name === npmPackage.name))
          .map(({ summary }) => summary),
        packageName: npmPackage.name,
        targetVersion: targetNpmVersion,
      },
    );
  }
}

function cargoVersionMap(manifests) {
  return Object.fromEntries(
    [...manifests]
      .map(([name, manifest]) => [name, manifest.version])
      .sort(([left], [right]) => compareCanonicalStrings(left, right)),
  );
}

export function validateReleaseDelta(options) {
  validatePendingChangesetPackages(options.baseFiles, options.npmPackages);
  const changes = changedFileEntries(options.baseFiles, options.headFiles);
  const baseNpmVersion = uniformNpmVersion(options.baseFiles, options.npmPackages, "base");
  const targetNpmVersion = uniformNpmVersion(options.headFiles, options.npmPackages, "head");
  const npmComparison = compareStableVersions(targetNpmVersion, baseNpmVersion);
  if (npmComparison < 0) {
    failRelease("NPM_VERSION_REGRESSED", "the fixed npm version regressed");
  }
  const npmAdvanced = npmComparison > 0;
  const cargoResult = validateCargoManifestDelta(options);
  const deletedChangesets = pendingChangesetPaths(options.baseFiles).filter(
    (path) => !options.headFiles.has(path),
  );
  const materialized = npmAdvanced || cargoResult.advanced.length > 0;
  if (!materialized) {
    return nonMaterializedDelta(changes, deletedChangesets);
  }
  assertMaterializedInputsConsumed(options, cargoResult);
  assertAllowedMaterializedPaths(options, {
    cargoAdvanced: cargoResult.advanced,
    changes,
    npmAdvanced,
  });
  if (npmAdvanced) {
    validateNpmMaterialization(
      { ...options, currentNpmVersion: baseNpmVersion },
      targetNpmVersion,
      deletedChangesets,
    );
  }
  if (cargoResult.advanced.length > 0) {
    validateLockDelta(options, cargoResult);
  }
  return {
    cargo: {
      advanced: cargoResult.advanced,
      currentVersions: cargoVersionMap(cargoResult.baseByName),
      targetVersions: cargoVersionMap(cargoResult.headByName),
    },
    npm: { advanced: npmAdvanced, currentVersion: baseNpmVersion, targetVersion: targetNpmVersion },
    phase: "materialized",
  };
}
