import { failRelease } from "./errors.mjs";
import {
  compareStableVersions,
  formatMinorLine,
  incrementStableVersion,
  parseStableVersion,
} from "./semver.mjs";

const changesetBumpPriority = new Map([
  ["patch", 0],
  ["minor", 1],
  ["major", 2],
]);

export function deriveFixedGroupChangesetTarget(changesets, fixedNames, currentVersion) {
  parseStableVersion(currentVersion);
  if (!Array.isArray(changesets) || !(fixedNames instanceof Set) || fixedNames.size === 0) {
    failRelease("CHANGESET_BUMP_INVALID", "Changeset target inputs are invalid");
  }
  let bumpType;
  for (const changeset of changesets) {
    if (!Array.isArray(changeset?.releases)) {
      failRelease("CHANGESET_BUMP_INVALID", "Changeset releases are invalid");
    }
    for (const release of changeset.releases) {
      if (!fixedNames.has(release?.name)) {
        failRelease(
          "CHANGESET_PACKAGE_OUTSIDE_FIXED_GROUP",
          `Changeset names non-fixed package ${release?.name}`,
        );
      }
      const priority = changesetBumpPriority.get(release.type);
      if (priority === undefined) {
        failRelease("CHANGESET_BUMP_INVALID", `unsupported Changeset bump: ${release.type}`);
      }
      if (bumpType === undefined || priority > changesetBumpPriority.get(bumpType)) {
        bumpType = release.type;
      }
    }
  }
  return {
    advances: bumpType !== undefined,
    bumpType,
    current: currentVersion,
    target:
      bumpType === undefined ? currentVersion : incrementStableVersion(currentVersion, bumpType),
  };
}

export function materializeNpmManifest(manifest, fixedNames, targetVersion) {
  parseStableVersion(targetVersion);
  const materialized = structuredClone(manifest);
  for (const [dependencyName] of Object.entries(materialized.peerDependencies ?? {})) {
    if (fixedNames.has(dependencyName)) {
      materialized.peerDependencies[dependencyName] = formatMinorLine(targetVersion);
    }
  }
  return materialized;
}

export function assertChangesetPrediction(status, options) {
  parseStableVersion(options.targetVersion);
  if (!Array.isArray(status?.releases)) {
    failRelease("CHANGESET_STATUS_INVALID", "Changesets status has no releases array");
  }
  const observed = new Map();
  for (const release of status.releases) {
    if (
      typeof release?.name !== "string" ||
      typeof release?.newVersion !== "string" ||
      observed.has(release.name)
    ) {
      failRelease("CHANGESET_STATUS_INVALID", "Changesets status has an invalid release entry");
    }
    observed.set(release.name, release.newVersion);
  }
  const predictionMatches = options.advances
    ? observed.size === options.fixedNames.size &&
      [...options.fixedNames].every((name) => observed.get(name) === options.targetVersion)
    : observed.size === 0;
  if (!predictionMatches) {
    failRelease(
      "CHANGESET_PREDICTION_MISMATCH",
      "Changesets prediction does not exactly equal the explicit fixed-group target",
    );
  }
}

function parseTomlString(rawValue, field) {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    failRelease("CARGO_MANIFEST_PARSE_FAILED", `invalid TOML string for ${field}`, {
      cause: error,
    });
  }
}

function scanCargoPackageLine(rawLine, state) {
  const assignment = /^\s*(name|version)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(rawLine);
  if (assignment === null) {
    return;
  }
  const stateField = assignment[1] === "name" ? "crateName" : "currentVersion";
  if (state[stateField] !== undefined) {
    failRelease("CARGO_MANIFEST_PARSE_FAILED", `Cargo manifest repeats package.${assignment[1]}`);
  }
  state[stateField] = parseTomlString(assignment[2], `package.${assignment[1]}`);
}

function scanCargoMarkerLine(rawLine, marker) {
  const assignment = /^\s*([A-Za-z0-9-]+)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(rawLine);
  if (assignment === null) {
    if (rawLine.trim() !== "") {
      failRelease("CARGO_MANIFEST_PARSE_FAILED", "Cargo manifest has an invalid release marker");
    }
    return;
  }
  if (Object.hasOwn(marker, assignment[1])) {
    failRelease("CARGO_MANIFEST_PARSE_FAILED", "Cargo manifest repeats a release marker key");
  }
  marker[assignment[1]] = parseTomlString(assignment[2], assignment[1]);
}

function scanCargoManifest(contents) {
  const state = { crateName: undefined, currentVersion: undefined, section: "" };
  const marker = {};
  for (const rawLine of contents.split("\n")) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine);
    if (sectionMatch !== null) {
      state.section = sectionMatch[1];
      continue;
    }
    if (state.section === "package") {
      scanCargoPackageLine(rawLine, state);
    } else if (state.section === "package.metadata.boundsvg-release") {
      scanCargoMarkerLine(rawLine, marker);
    }
  }
  if (state.crateName === undefined || state.currentVersion === undefined) {
    failRelease("CARGO_MANIFEST_PARSE_FAILED", "Cargo manifest has no package name/version");
  }
  parseStableVersion(state.currentVersion);
  return {
    crateName: state.crateName,
    currentVersion: state.currentVersion,
    marker: Object.keys(marker).length === 0 ? undefined : marker,
  };
}

function trimTrailingBlankLines(lines) {
  while (lines.at(-1) === "") {
    lines.pop();
  }
}

function trimDuplicateTrailingBlankLines(lines) {
  while (lines.length > 1 && lines.at(-1) === "" && lines.at(-2) === "") {
    lines.pop();
  }
}

function removeReleaseMarker(lines) {
  const output = [];
  let inMarker = false;
  for (const rawLine of lines) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine);
    if (sectionMatch !== null) {
      if (sectionMatch[1] === "package.metadata.boundsvg-release") {
        inMarker = true;
        trimTrailingBlankLines(output);
        continue;
      }
      if (inMarker) {
        if (output.length > 0 && output.at(-1) !== "") {
          output.push("");
        }
        inMarker = false;
      }
    }
    if (!inMarker) {
      output.push(rawLine);
    }
  }
  trimDuplicateTrailingBlankLines(output);
  return output;
}

function materializeCargoDependencyLine(rawLine, options) {
  const dependencyMatch = /^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(.+)$/.exec(rawLine);
  const dependencyTarget =
    dependencyMatch === null ? undefined : options.publicTargets.get(dependencyMatch[2]);
  if (dependencyMatch === null || dependencyTarget === undefined) {
    return { changed: false, line: rawLine };
  }
  const pathMatch = /\bpath\s*=\s*"(?:[^"\\]|\\.)*"/.exec(dependencyMatch[4]);
  const versionMatch = /\bversion\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(dependencyMatch[4]);
  if (pathMatch === null || versionMatch === null) {
    failRelease(
      "CARGO_PUBLIC_DEPENDENCY_INVALID",
      `${options.crateName} has an unbounded public path dependency ${dependencyMatch[2]}`,
    );
  }
  const value = dependencyMatch[4].replace(versionMatch[0], `version = "${dependencyTarget}"`);
  return {
    changed: versionMatch[1] !== dependencyTarget,
    line: `${dependencyMatch[1]}${dependencyMatch[2]}${dependencyMatch[3]}${value}`,
  };
}

function materializeCargoLines(contents, options) {
  const lines = [];
  let changedDependency = false;
  let section = "";
  for (const rawLine of contents.split("\n")) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine);
    if (sectionMatch !== null) {
      section = sectionMatch[1];
      lines.push(rawLine);
      continue;
    }
    if (section === "package") {
      const versionMatch = /^(\s*version\s*=\s*)"(?:[^"\\]|\\.)*"(\s*)$/.exec(rawLine);
      lines.push(
        versionMatch === null
          ? rawLine
          : `${versionMatch[1]}"${options.targetVersion}"${versionMatch[2]}`,
      );
      continue;
    }
    if (/^(?:target\..+\.)?(?:dev-|build-)?dependencies$/.test(section)) {
      const result = materializeCargoDependencyLine(rawLine, options);
      changedDependency ||= result.changed;
      lines.push(result.line);
      continue;
    }
    lines.push(rawLine);
  }
  return { changedDependency, lines };
}

export function materializeCargoManifest(contents, options) {
  const scanned = scanCargoManifest(contents);
  if (scanned.crateName !== options.crateName) {
    failRelease("CARGO_MANIFEST_IDENTITY_MISMATCH", `${options.crateName} manifest changed name`);
  }
  const targetVersion = options.publicTargets.get(options.crateName);
  if (targetVersion === undefined) {
    failRelease("CARGO_TARGET_MISSING", `no target was supplied for ${options.crateName}`);
  }
  parseStableVersion(targetVersion);
  const versionComparison = compareStableVersions(targetVersion, scanned.currentVersion);
  if (versionComparison < 0) {
    failRelease("CARGO_TARGET_NOT_GREATER", `${options.crateName} target regresses its version`);
  }

  const materialized = materializeCargoLines(contents, {
    crateName: options.crateName,
    publicTargets: options.publicTargets,
    targetVersion,
  });
  let { lines } = materialized;

  if (versionComparison > 0) {
    if (scanned.marker !== undefined) {
      if (scanned.marker["pending-version"] !== targetVersion) {
        failRelease(
          "CARGO_MARKER_TARGET_MISMATCH",
          `${options.crateName} marker does not equal the explicit target`,
        );
      }
    } else if (!materialized.changedDependency) {
      failRelease(
        "CARGO_UNMARKED_ADVANCE",
        `${options.crateName} has no marker or public dependency reason to advance`,
      );
    }
    lines = removeReleaseMarker(lines);
  } else {
    if (scanned.marker !== undefined) {
      failRelease(
        "CARGO_MARKER_UNSATISFIED",
        `${options.crateName} cannot remain current with a pending release marker`,
      );
    }
    if (materialized.changedDependency) {
      failRelease(
        "CARGO_CONSUMER_NOT_ADVANCED",
        `${options.crateName} must advance when its public dependency target changes`,
      );
    }
  }
  return lines.join("\n");
}
