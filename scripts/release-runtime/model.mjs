import { compareCanonicalStrings } from "./canonical.mjs";
import { failRelease } from "./errors.mjs";
import { compareStableVersions, formatMinorLine, parseStableVersion } from "./semver.mjs";

const npmDependencySections = [
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
];
const cargoMarkerKeys = ["change-kind", "obligation-id", "pending-version"];
const kebabCasePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function sameSortedMembers(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function topologicalOrder(nodeNames, dependencyEdges) {
  const nodes = [...new Set(nodeNames)].sort();
  const dependencies = new Map(nodes.map((name) => [name, new Set()]));
  const consumers = new Map(nodes.map((name) => [name, new Set()]));
  for (const [consumer, dependency] of dependencyEdges) {
    if (!dependencies.has(consumer) || !dependencies.has(dependency)) {
      failRelease("DEPENDENCY_NODE_UNKNOWN", `${consumer} -> ${dependency} names an unknown node`);
    }
    dependencies.get(consumer).add(dependency);
    consumers.get(dependency).add(consumer);
  }

  const ready = nodes.filter((name) => dependencies.get(name).size === 0);
  const ordered = [];
  while (ready.length > 0) {
    ready.sort();
    const next = ready.shift();
    ordered.push(next);
    for (const consumer of consumers.get(next)) {
      dependencies.get(consumer).delete(next);
      if (dependencies.get(consumer).size === 0) {
        ready.push(consumer);
      }
    }
  }
  if (ordered.length !== nodes.length) {
    const unresolved = nodes.filter((name) => !ordered.includes(name));
    failRelease("DEPENDENCY_CYCLE", `dependency graph contains a cycle: ${unresolved.join(", ")}`);
  }
  return ordered;
}

function publicNpmManifest(manifest) {
  return manifest.private !== true && manifest.publishConfig?.access === "public";
}

function publicNpmPackages(manifests) {
  const packages = manifests
    .filter(({ value }) => publicNpmManifest(value))
    .map(({ path, value }) => ({ manifest: structuredClone(value), name: value.name, path }))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));
  if (packages.some(({ name }) => typeof name !== "string" || name.length === 0)) {
    failRelease("NPM_PACKAGE_NAME_INVALID", "a public package has no valid name");
  }
  const names = packages.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    failRelease("NPM_PACKAGE_DUPLICATE", "the public npm package set contains duplicate names");
  }
  return packages;
}

function validateNpmFixedGroup(changesetConfig, names) {
  if (!Array.isArray(changesetConfig.fixed) || changesetConfig.fixed.length !== 1) {
    failRelease("NPM_FIXED_GROUP_INVALID", "Changesets must define exactly one fixed group");
  }
  if (!sameSortedMembers(names, [...changesetConfig.fixed[0]].sort())) {
    failRelease(
      "NPM_FIXED_GROUP_MISMATCH",
      "the fixed npm group does not exactly equal the public package set",
    );
  }
}

function uniformNpmModelVersion(packages) {
  if (packages.length === 0) {
    failRelease("NPM_PUBLIC_SET_EMPTY", "the public npm package set is empty");
  }
  const versions = new Set(packages.map(({ manifest }) => manifest.version));
  if (versions.size !== 1) {
    failRelease("NPM_FIXED_VERSION_MISMATCH", "fixed npm packages do not share one version");
  }
  const currentVersion = packages[0].manifest.version;
  parseStableVersion(currentVersion);
  return currentVersion;
}

function validateNpmModelEdge(options) {
  if (options.section === "peerDependencies") {
    const expectedPeer = formatMinorLine(options.currentVersion);
    if (options.requirement !== expectedPeer) {
      failRelease(
        "NPM_INTERNAL_PEER_MISMATCH",
        `${options.packageName} requires ${options.dependencyName} ${options.requirement}; expected ${expectedPeer}`,
      );
    }
    return false;
  }
  if (typeof options.requirement !== "string" || !options.requirement.startsWith("workspace:")) {
    failRelease(
      "NPM_INTERNAL_WORKSPACE_RANGE_INVALID",
      `${options.packageName} ${options.section} edge to ${options.dependencyName} is not a workspace range`,
    );
  }
  return options.section === "dependencies" || options.section === "optionalDependencies";
}

function buildNpmModelEdges(packages, currentVersion) {
  const names = packages.map(({ name }) => name);
  const fixedNameSet = new Set(names);
  const edges = [];
  const dependencyEdges = [];
  for (const npmPackage of packages) {
    for (const section of npmDependencySections) {
      for (const [dependencyName, requirement] of Object.entries(
        npmPackage.manifest[section] ?? {},
      )) {
        if (!fixedNameSet.has(dependencyName)) {
          continue;
        }
        edges.push({
          from: npmPackage.name,
          requirement,
          section,
          to: dependencyName,
        });
        if (
          validateNpmModelEdge({
            currentVersion,
            dependencyName,
            packageName: npmPackage.name,
            requirement,
            section,
          })
        ) {
          dependencyEdges.push([npmPackage.name, dependencyName]);
        }
      }
    }
  }
  return {
    dependencyEdges,
    edges: edges.sort((left, right) =>
      compareCanonicalStrings(
        `${left.from}\0${left.section}\0${left.to}`,
        `${right.from}\0${right.section}\0${right.to}`,
      ),
    ),
  };
}

export function buildNpmModel({ changesetConfig, manifests }) {
  const packages = publicNpmPackages(manifests);
  const names = packages.map(({ name }) => name);
  validateNpmFixedGroup(changesetConfig, names);
  const currentVersion = uniformNpmModelVersion(packages);
  const { dependencyEdges, edges } = buildNpmModelEdges(packages, currentVersion);
  return {
    currentVersion,
    edges,
    fixedNames: names,
    packages,
    publishOrder: topologicalOrder(names, dependencyEdges),
  };
}

export function validateReleaseMarker(crateName, options) {
  if (!options.isPublic) {
    failRelease("CARGO_MARKER_PRIVATE_CRATE", `${crateName} is private but has a release marker`);
  }
  if (
    options.marker === null ||
    typeof options.marker !== "object" ||
    Array.isArray(options.marker)
  ) {
    failRelease("CARGO_MARKER_INVALID", `${crateName} release marker is not a table`);
  }
  const actualKeys = Object.keys(options.marker).sort();
  if (!sameSortedMembers(actualKeys, cargoMarkerKeys)) {
    failRelease(
      "CARGO_MARKER_KEYS_INVALID",
      `${crateName} release marker must contain exactly ${cargoMarkerKeys.join(", ")}`,
    );
  }
  const pendingVersion = options.marker["pending-version"];
  parseStableVersion(options.currentVersion);
  parseStableVersion(pendingVersion);
  if (compareStableVersions(pendingVersion, options.currentVersion) <= 0) {
    failRelease(
      "CARGO_MARKER_NOT_ADVANCING",
      `${crateName} pending version must be greater than its current version`,
    );
  }
  for (const key of ["change-kind", "obligation-id"]) {
    if (typeof options.marker[key] !== "string" || !kebabCasePattern.test(options.marker[key])) {
      failRelease(
        "CARGO_MARKER_IDENTIFIER_INVALID",
        `${crateName} release marker ${key} is not kebab-case`,
      );
    }
  }
  return {
    changeKind: options.marker["change-kind"],
    obligationId: options.marker["obligation-id"],
    pendingVersion,
  };
}

function cargoPackageIsPublic(cargoPackage) {
  return !Array.isArray(cargoPackage.publish) || cargoPackage.publish.length > 0;
}

export function buildCargoModel({ packages }) {
  const workspaceNames = new Set(packages.map(({ name }) => name));
  const publicPackages = packages.filter(cargoPackageIsPublic);
  const publicNames = new Set(publicPackages.map(({ name }) => name));
  const dependencyEdges = [];
  const crates = publicPackages
    .map((cargoPackage) => {
      parseStableVersion(cargoPackage.version);
      const dependencies = [];
      for (const dependency of cargoPackage.dependencies ?? []) {
        if (!workspaceNames.has(dependency.name) || dependency.path === null) {
          continue;
        }
        if (!publicNames.has(dependency.name)) {
          failRelease(
            "CARGO_PUBLIC_DEPENDS_ON_PRIVATE",
            `${cargoPackage.name} has a path dependency on private ${dependency.name}`,
          );
        }
        const dependencyPackage = publicPackages.find(({ name }) => name === dependency.name);
        const expectedRequirement = `^${dependencyPackage.version}`;
        if (dependency.req !== expectedRequirement) {
          failRelease(
            "CARGO_INTERNAL_RANGE_MISMATCH",
            `${cargoPackage.name} requires ${dependency.name} ${dependency.req}; expected ${expectedRequirement}`,
          );
        }
        dependencies.push({
          kind: dependency.kind ?? null,
          name: dependency.name,
          requirement: dependency.req,
        });
        dependencyEdges.push([cargoPackage.name, dependency.name]);
      }
      return {
        dependencies: dependencies.sort((left, right) =>
          compareCanonicalStrings(left.name, right.name),
        ),
        manifestPath: cargoPackage.manifestPath ?? cargoPackage.manifest_path,
        marker: cargoPackage.metadata?.["boundsvg-release"],
        name: cargoPackage.name,
        version: cargoPackage.version,
      };
    })
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));

  const markers = [];
  for (const cargoPackage of packages) {
    const marker = cargoPackage.metadata?.["boundsvg-release"];
    if (marker === undefined) {
      continue;
    }
    markers.push({
      crateName: cargoPackage.name,
      ...validateReleaseMarker(cargoPackage.name, {
        currentVersion: cargoPackage.version,
        isPublic: cargoPackageIsPublic(cargoPackage),
        marker,
      }),
    });
  }
  markers.sort((left, right) => compareCanonicalStrings(left.crateName, right.crateName));
  return {
    crates,
    markers,
    publishOrder: topologicalOrder(
      crates.map(({ name }) => name),
      dependencyEdges,
    ),
  };
}

export function parseChangeset(path, contents) {
  const match = /^---\n([\s\S]*?)\n---\n(?:\n)?([\s\S]*)$/.exec(contents);
  if (match === null) {
    failRelease("CHANGESET_PARSE_FAILED", `${path} has invalid Changeset frontmatter`);
  }
  const releases = [];
  for (const line of match[1].split("\n")) {
    const releaseMatch = /^"([^"]+)": (patch|minor|major)$/.exec(line);
    if (releaseMatch === null) {
      failRelease("CHANGESET_PARSE_FAILED", `${path} has an invalid release declaration`);
    }
    releases.push({ name: releaseMatch[1], type: releaseMatch[2] });
  }
  if (releases.length === 0 || new Set(releases.map(({ name }) => name)).size !== releases.length) {
    failRelease("CHANGESET_PARSE_FAILED", `${path} has an empty or duplicate release set`);
  }
  const summary = match[2].trim();
  if (summary.length === 0) {
    failRelease("CHANGESET_PARSE_FAILED", `${path} has no summary`);
  }
  releases.sort((left, right) => compareCanonicalStrings(left.name, right.name));
  return { path, releases, summary };
}
