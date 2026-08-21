#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED_VENDOR_DIRECTORIES = new Set(["ttf-parser"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "tmp"]);

function relativePath(rootDirectory, targetPath) {
  return relative(rootDirectory, targetPath).split(sep).join("/") || ".";
}

function stripTomlComment(line) {
  let quote;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? undefined : (quote ?? character);
      continue;
    }
    if (character === "#" && quote === undefined) {
      return line.slice(0, index);
    }
  }
  return line;
}

function collectCargoManifests(rootDirectory, currentDirectory = rootDirectory, manifests = []) {
  for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const entryPath = resolve(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      collectCargoManifests(rootDirectory, entryPath, manifests);
    } else if (entry.isFile() && entry.name === "Cargo.toml") {
      manifests.push(entryPath);
    }
  }
  return manifests;
}

function isApprovedTtfParserPatch(isWorkspaceManifest, section, line) {
  return (
    isWorkspaceManifest &&
    section === "patch.crates-io" &&
    /^ttf-parser\s*=\s*\{\s*path\s*=\s*["']vendor\/ttf-parser["']\s*}$/.test(line)
  );
}

function auditManifestEntry({
  isWorkspaceManifest,
  line,
  lineNumber,
  manifestRelativePath,
  section,
}) {
  const violations = [];

  if (/\bgit\s*=/.test(line)) {
    violations.push(`${manifestRelativePath}:${lineNumber}: Cargo git dependency is not approved`);
  }

  const vendorPathMatch = line.match(/\bpath\s*=\s*["']([^"']*vendor\/[^"']+)["']/);
  const approvedTtfParserPatch = isApprovedTtfParserPatch(isWorkspaceManifest, section, line);
  if (vendorPathMatch && !approvedTtfParserPatch) {
    violations.push(
      `${manifestRelativePath}:${lineNumber}: vendored Cargo dependency ${vendorPathMatch[1]} is not approved`,
    );
  }

  if (section === "patch.crates-io" && !approvedTtfParserPatch) {
    violations.push(
      `${manifestRelativePath}:${lineNumber}: crates.io patch is not on the explicit allowlist`,
    );
  }

  return violations;
}

function auditManifest(rootDirectory, manifestPath) {
  const violations = [];
  const manifestRelativePath = relativePath(rootDirectory, manifestPath);
  const isWorkspaceManifest = manifestRelativePath === "Cargo.toml";
  let section = "";

  for (const [lineIndex, sourceLine] of readFileSync(manifestPath, "utf8").split("\n").entries()) {
    const line = stripTomlComment(sourceLine).trim();
    if (line.length === 0) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (
        (section.startsWith("patch.") || section === "replace") &&
        !(isWorkspaceManifest && section === "patch.crates-io")
      ) {
        violations.push(
          `${manifestRelativePath}:${lineIndex + 1}: unauthorized [${section}] section`,
        );
      }
      continue;
    }
    violations.push(
      ...auditManifestEntry({
        isWorkspaceManifest,
        line,
        lineNumber: lineIndex + 1,
        manifestRelativePath,
        section,
      }),
    );
  }

  return violations;
}

function auditCargoSourceConfiguration(rootDirectory) {
  const violations = [];
  for (const fileName of ["config", "config.toml"]) {
    const configPath = resolve(rootDirectory, ".cargo", fileName);
    if (!existsSync(configPath)) {
      continue;
    }
    for (const [lineIndex, sourceLine] of readFileSync(configPath, "utf8").split("\n").entries()) {
      const line = stripTomlComment(sourceLine).trim();
      if (/^\[source\./.test(line) || /^replace-with\s*=/.test(line)) {
        violations.push(
          `${relativePath(rootDirectory, configPath)}:${lineIndex + 1}: Cargo source replacement is not approved`,
        );
      }
    }
  }
  return violations;
}

export function auditThirdPartySourceOverrides(rootDirectory) {
  const resolvedRoot = resolve(rootDirectory);
  const violations = [];
  const vendorDirectory = resolve(resolvedRoot, "vendor");

  if (existsSync(vendorDirectory)) {
    for (const entry of readdirSync(vendorDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && !APPROVED_VENDOR_DIRECTORIES.has(entry.name)) {
        violations.push(`vendor/${entry.name}: vendored third-party source is not approved`);
      }
    }
  }

  for (const manifestPath of collectCargoManifests(resolvedRoot)) {
    violations.push(...auditManifest(resolvedRoot, manifestPath));
  }
  violations.push(...auditCargoSourceConfiguration(resolvedRoot));

  return [...new Set(violations)].sort();
}

function runCli() {
  const rootOptionIndex = process.argv.indexOf("--root");
  const rootDirectory = rootOptionIndex === -1 ? process.cwd() : process.argv[rootOptionIndex + 1];
  if (!rootDirectory) {
    process.stderr.write("--root requires a directory\n");
    process.exit(2);
  }

  const violations = auditThirdPartySourceOverrides(rootDirectory);
  if (violations.length === 0) {
    process.stdout.write("third-party source override check: passed\n");
    return;
  }

  process.stderr.write("third-party source override check: failed\n");
  process.stderr.write(
    "A fork, vendored patch, Cargo source override, or Cargo git dependency requires explicit maintainer approval before implementation.\n",
  );
  process.stderr.write(`${violations.map((violation) => `- ${violation}`).join("\n")}\n`);
  process.exit(1);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runCli();
}
