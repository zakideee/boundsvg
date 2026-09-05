import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { compareCanonicalStrings, sha256 } from "./canonical.mjs";
import { releaseReadCommandTimeoutMs } from "./command-limits.mjs";
import { failRelease } from "./errors.mjs";
import { buildCargoModel, buildNpmModel, parseChangeset } from "./model.mjs";
import * as topology from "./topology.mjs";

export const canonicalRepository = "zakideee/boundsvg";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failRelease("REPOSITORY_JSON_INVALID", `cannot parse ${path}`, { cause: error });
  }
}

function toRepositoryPath(repositoryRoot, absolutePath) {
  const repositoryPath = relative(repositoryRoot, absolutePath).split(sep).join("/");
  if (repositoryPath === ".." || repositoryPath.startsWith("../")) {
    failRelease("REPOSITORY_PATH_ESCAPE", "repository metadata names a path outside the worktree");
  }
  return repositoryPath;
}

function expandSingleSegmentPattern(repositoryRoot, pattern) {
  if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
    const parent = join(repositoryRoot, pattern.slice(0, -2));
    if (!existsSync(parent)) {
      return [];
    }
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name));
  }
  if (pattern.includes("*")) {
    failRelease("WORKSPACE_PATTERN_UNSUPPORTED", `unsupported workspace pattern: ${pattern}`);
  }
  return [join(repositoryRoot, pattern)];
}

function discoverWorkspaceManifests(repositoryRoot) {
  const workspaceText = readFileSync(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  const manifestPaths = new Set();
  for (const pattern of topology.parsePnpmWorkspacePatterns(workspaceText)) {
    for (const packageDirectory of expandSingleSegmentPattern(repositoryRoot, pattern)) {
      const manifestPath = join(packageDirectory, "package.json");
      if (existsSync(manifestPath) && statSync(manifestPath).isFile()) {
        manifestPaths.add(manifestPath);
      }
    }
  }
  return [...manifestPaths].sort().map((manifestPath) => ({
    path: toRepositoryPath(repositoryRoot, manifestPath),
    value: readJson(manifestPath),
  }));
}

function normalizeCargoMetadata(repositoryRoot, metadata) {
  const workspaceIds = new Set(metadata.workspace_members);
  return metadata.packages.map((cargoPackage) => ({
    dependencies: cargoPackage.dependencies,
    manifestPath: toRepositoryPath(repositoryRoot, cargoPackage.manifest_path),
    metadata: cargoPackage.metadata,
    name: cargoPackage.name,
    publish: cargoPackage.publish,
    version: cargoPackage.version,
    workspace: workspaceIds.has(cargoPackage.id),
  }));
}

function readCargoMetadata(repositoryRoot, execute = execFileSync) {
  let stdout;
  try {
    stdout = execute("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: releaseReadCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    failRelease("CARGO_METADATA_FAILED", "cargo metadata --locked failed", {
      cause: error,
      exitCode: error?.status ?? 1,
    });
  }
  try {
    return normalizeCargoMetadata(repositoryRoot, JSON.parse(stdout));
  } catch (error) {
    failRelease("CARGO_METADATA_INVALID", "cargo metadata returned invalid JSON", { cause: error });
  }
}

function readPendingChangesets(repositoryRoot) {
  const changesetDirectory = join(repositoryRoot, ".changeset");
  return readdirSync(changesetDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => {
      const path = `.changeset/${entry.name}`;
      const contents = readFileSync(join(repositoryRoot, path), "utf8");
      return { ...parseChangeset(path, contents), sha256: sha256(contents) };
    })
    .sort((left, right) => compareCanonicalStrings(left.path, right.path));
}

function parseCargoPatchNames(contents) {
  const patchNames = new Set();
  let inPatchSection = false;
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section !== null) {
      inPatchSection = section[1].startsWith("patch.");
      continue;
    }
    if (!inPatchSection) {
      continue;
    }
    const assignment = /^(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*=/.exec(line);
    if (assignment !== null) {
      patchNames.add(assignment[1] ?? assignment[2]);
    }
  }
  return patchNames;
}

function repositoryIdentity(rootManifest) {
  const rawUrl =
    typeof rootManifest.repository === "string"
      ? rootManifest.repository
      : rootManifest.repository?.url;
  if (typeof rawUrl !== "string") {
    failRelease("REPOSITORY_IDENTITY_MISSING", "root package.json has no repository URL");
  }
  const normalized = rawUrl
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const prefix = "https://github.com/";
  if (!normalized.startsWith(prefix)) {
    failRelease("REPOSITORY_IDENTITY_INVALID", "root repository is not hosted on GitHub");
  }
  return normalized.slice(prefix.length);
}

export function loadRepositoryState(repositoryRoot, options = {}) {
  const normalizedRoot = resolve(repositoryRoot);
  const rootManifest = readJson(join(normalizedRoot, "package.json"));
  const repository = repositoryIdentity(rootManifest);
  if (repository !== canonicalRepository) {
    failRelease(
      "REPOSITORY_IDENTITY_MISMATCH",
      `expected ${canonicalRepository}, got ${repository}`,
    );
  }
  const changesetConfig = readJson(join(normalizedRoot, ".changeset/config.json"));
  const npmTopology = topology.projectNpmTopology(
    discoverWorkspaceManifests(normalizedRoot),
    changesetConfig,
  );
  const npm = buildNpmModel({
    changesetConfig,
    manifests: npmTopology.manifests,
  });
  const cargoPackages = options.cargoPackages ?? readCargoMetadata(normalizedRoot, options.execute);
  const rootCargoManifest = readFileSync(join(normalizedRoot, "Cargo.toml"), "utf8");
  topology.assertCargoMetadataTopology(
    topology.projectCargoTopology(rootCargoManifest, (manifestPath) =>
      readFileSync(join(normalizedRoot, manifestPath), "utf8"),
    ),
    cargoPackages.filter(({ workspace }) => workspace !== false),
  );
  const cargo = buildCargoModel({ packages: cargoPackages });
  const changesets = readPendingChangesets(normalizedRoot);
  const markers = cargo.markers.map((marker) => {
    const crateEntry = cargo.crates.find(({ name }) => name === marker.crateName);
    const contents = readFileSync(join(normalizedRoot, crateEntry.manifestPath), "utf8");
    return { ...marker, path: crateEntry.manifestPath, sha256: sha256(contents) };
  });
  return {
    cargo,
    cargoPackages,
    changesetConfig,
    inputs: { changesets, markers },
    npm,
    patchNames: parseCargoPatchNames(rootCargoManifest),
    repository,
    repositoryRoot: normalizedRoot,
    rootManifest,
  };
}
