#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = join(repoRoot, "packages");

function fail(message) {
  throw new Error(`[public-declarations] ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Export targets that ship as data rather than as a module. */
const ASSET_EXPORT_PATTERN = /\.wasm$/;

function assertAssetExportExists({ packageDirectory, manifest, subpath, target }) {
  const assetPath = join(packageDirectory, target.replace(/^\.\//, ""));
  if (!existsSync(assetPath)) {
    fail(`${manifest.name} export ${subpath} points at a missing asset: ${target}`);
  }
  const files = manifest.files ?? [];
  const isShipped = files.some((file) =>
    target.replace(/^\.\//, "").startsWith(file.replace(/^\.\//, "")),
  );
  if (!isShipped) {
    fail(`${manifest.name} export ${subpath} is not covered by files`);
  }
}

function collectTypesTargets(value, conditionPath = [], targets = []) {
  if (!value || typeof value === "string") {
    return targets;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTypesTargets(item, conditionPath, targets);
    }
    return targets;
  }
  if (typeof value !== "object") {
    return targets;
  }
  for (const [condition, target] of Object.entries(value)) {
    if (condition === "types" && typeof target === "string") {
      targets.push({ conditionPath: [...conditionPath, condition].join("."), target });
      continue;
    }
    collectTypesTargets(target, [...conditionPath, condition], targets);
  }
  return targets;
}

function normalizeManifestTarget(target) {
  return target.startsWith("./") ? target : `./${target}`;
}

function validateConditionalTypesRoute(manifest, subpath, route) {
  const conditions = route.conditionPath.split(".");
  const importRoute = conditions.includes("import");
  const requireRoute = conditions.includes("require");
  if (!/\.d\.(?:c|m)?ts$/.test(route.target)) {
    fail(`${manifest.name} export ${subpath} types route must target a declaration file`);
  }
  if (importRoute && requireRoute) {
    fail(`${manifest.name} export ${subpath} has an ambiguous import/require types route`);
  }
  if (importRoute && route.target.endsWith(".d.cts")) {
    fail(`${manifest.name} export ${subpath} maps its import types route to CJS declarations`);
  }
  if (
    requireRoute &&
    (route.target.endsWith(".d.mts") ||
      (manifest.type === "module" && route.target.endsWith(".d.ts")))
  ) {
    fail(`${manifest.name} export ${subpath} maps its require types route to ESM declarations`);
  }
}

function validateTypesTarget({ packageDirectory, manifest, subpath, typesTarget }) {
  if (!typesTarget.startsWith("./")) {
    fail(`${manifest.name} export ${subpath} has a non-relative types target: ${typesTarget}`);
  }
  const declarationPath = resolve(packageDirectory, typesTarget);
  const relativePath = relative(packageDirectory, declarationPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    fail(`${manifest.name} export ${subpath} resolves outside its package`);
  }
  if (!existsSync(declarationPath)) {
    fail(
      `${manifest.name} export ${subpath} is missing built declaration ${relative(repoRoot, declarationPath)}`,
    );
  }
  const canonicalPackagePrefix = `${realpathSync(packageDirectory)}${sep}`;
  const canonicalDeclarationPath = realpathSync(declarationPath);
  if (!`${canonicalDeclarationPath}${sep}`.startsWith(canonicalPackagePrefix)) {
    fail(`${manifest.name} export ${subpath} resolves through a symlink outside its package`);
  }
  return canonicalDeclarationPath;
}

function validateTopLevelTypes(manifest, entries) {
  const rootEntry = entries.find((entry) => entry.subpath === ".");
  if (typeof manifest.types === "string") {
    const rootTypesTarget = normalizeManifestTarget(manifest.types);
    if (!rootEntry?.typesTargets.includes(rootTypesTarget)) {
      fail(`${manifest.name} top-level types does not match its root export: ${manifest.types}`);
    }
  }
}

function validateTypesVersionEntry({
  packageDirectory,
  manifest,
  entries,
  legacySubpath,
  targetList,
}) {
  if (legacySubpath.includes("*")) {
    fail(`${manifest.name} has unsupported wildcard typesVersions key ${legacySubpath}`);
  }
  if (!Array.isArray(targetList) || targetList.length === 0) {
    fail(`${manifest.name} typesVersions ${legacySubpath} has no targets`);
  }
  const subpath = legacySubpath === "." ? "." : `./${legacySubpath}`;
  const entry = entries.find((candidate) => candidate.subpath === subpath);
  if (!entry) {
    fail(`${manifest.name} typesVersions ${legacySubpath} has no matching export`);
  }
  for (const target of targetList) {
    if (typeof target !== "string") {
      fail(`${manifest.name} typesVersions ${legacySubpath} contains a non-string target`);
    }
    const normalizedTarget = normalizeManifestTarget(target);
    if (!entry.typesTargets.includes(normalizedTarget)) {
      fail(
        `${manifest.name} typesVersions ${legacySubpath} target ${target} does not match its export`,
      );
    }
    validateTypesTarget({
      packageDirectory,
      manifest,
      subpath,
      typesTarget: normalizedTarget,
    });
  }
}

function validateLegacyTypes(packageDirectory, manifest, entries) {
  validateTopLevelTypes(manifest, entries);
  if (!manifest.typesVersions || typeof manifest.typesVersions !== "object") {
    return;
  }
  for (const [versionRange, mappings] of Object.entries(manifest.typesVersions)) {
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
      fail(`${manifest.name} typesVersions ${versionRange} must be an object`);
    }
    for (const [legacySubpath, targetList] of Object.entries(mappings)) {
      validateTypesVersionEntry({
        entries,
        legacySubpath,
        manifest,
        packageDirectory,
        targetList,
      });
    }
  }
}

function declarationEntries(packageDirectory, manifest) {
  if (!manifest.exports || typeof manifest.exports !== "object") {
    fail(`${manifest.name} must declare an exports map`);
  }

  const entries = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (target === null || subpath === "./package.json") {
      continue;
    }
    if (subpath !== "." && !subpath.startsWith("./")) {
      fail(`${manifest.name} has unsupported export key ${subpath}`);
    }
    // Asset subpaths (a .wasm binary a consumer resolves by URL) are not
    // modules, so there is nothing to declare types for.
    if (typeof target === "string" && ASSET_EXPORT_PATTERN.test(target)) {
      assertAssetExportExists({ packageDirectory, manifest, subpath, target });
      continue;
    }
    const typesRoutes = collectTypesTargets(target);
    if (typesRoutes.length === 0) {
      fail(`${manifest.name} export ${subpath} has no types target`);
    }
    for (const route of typesRoutes) {
      validateConditionalTypesRoute(manifest, subpath, route);
    }
    const typesTargets = [...new Set(typesRoutes.map((route) => route.target))];
    const declarationPaths = typesTargets.map((typesTarget) =>
      validateTypesTarget({ packageDirectory, manifest, subpath, typesTarget }),
    );
    entries.push({
      declarationPaths,
      specifier: subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
      subpath,
      typesRoutes: typesRoutes.map((route) => ({
        ...route,
        declarationPath: declarationPaths[typesTargets.indexOf(route.target)],
      })),
      typesTargets,
    });
  }
  validateLegacyTypes(packageDirectory, manifest, entries);
  return entries;
}

function publicPackages() {
  const packages = [];
  for (const directoryEntry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!directoryEntry.isDirectory()) {
      continue;
    }
    const packageDirectory = join(packagesRoot, directoryEntry.name);
    const manifestPath = join(packageDirectory, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = readJson(manifestPath);
    if (manifest.private === true) {
      continue;
    }
    if (manifest.publishConfig?.access !== "public") {
      fail(
        `${relative(repoRoot, manifestPath)} is non-private but not configured for public publishing`,
      );
    }
    if (typeof manifest.name !== "string") {
      fail(`${relative(repoRoot, manifestPath)} has no package name`);
    }
    packages.push({
      directory: packageDirectory,
      entries: declarationEntries(packageDirectory, manifest),
      manifest,
    });
  }
  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

const compilerOptions = {
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: false,
  strict: true,
  target: ts.ScriptTarget.ES2022,
};

function assertNoDiagnostics(program, label) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length === 0) {
    return;
  }
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => "\n",
  });
  fail(`${label} failed:\n${formatted}`);
}

function exportNames(checker, source, specifier) {
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) {
    fail(`${specifier} declaration is not an external module`);
  }
  const names = checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName())
    .sort((left, right) => left.localeCompare(right));
  const unsupportedName = names.find(
    (name) => name !== "default" && !ts.isIdentifierText(name, ts.ScriptTarget.ESNext),
  );
  if (unsupportedName) {
    fail(`${specifier} exposes unsupported export name ${unsupportedName}`);
  }
  return names;
}

function moduleExports(program, entries) {
  const checker = program.getTypeChecker();
  const result = new Map();
  for (const entry of entries) {
    let expectedNames;
    for (const declarationPath of entry.declarationPaths) {
      const source = program.getSourceFile(declarationPath);
      if (!source) {
        fail(`TypeScript did not load ${relative(repoRoot, declarationPath)}`);
      }
      const names = exportNames(checker, source, entry.specifier);
      if (expectedNames && names.join("\0") !== expectedNames.join("\0")) {
        fail(`${entry.specifier} exposes different names across its declaration routes`);
      }
      expectedNames = names;
    }
    result.set(entry.specifier, expectedNames ?? []);
  }
  return result;
}

function createConsumerSource(entries, exportsBySpecifier) {
  const lines = ["// Generated in a temporary installed-style consumer; do not edit."];
  let exportCount = 0;
  for (const [entryIndex, entry] of entries.entries()) {
    const names = exportsBySpecifier.get(entry.specifier) ?? [];
    const defaultExport = names.includes("default");
    const namedExports = names.filter((name) => name !== "default");
    if (defaultExport) {
      lines.push(`import type __default_${entryIndex} from ${JSON.stringify(entry.specifier)};`);
    }
    if (namedExports.length > 0) {
      const imports = namedExports
        .map((name, exportIndex) => `${name} as __export_${entryIndex}_${exportIndex}`)
        .join(", ");
      lines.push(`import type { ${imports} } from ${JSON.stringify(entry.specifier)};`);
    }
    lines.push(`type __module_${entryIndex} = typeof import(${JSON.stringify(entry.specifier)});`);
    exportCount += names.length;
  }
  lines.push("export {};", "");
  return { exportCount, source: lines.join("\n") };
}

function linkPublicPackages(consumerRoot, packages) {
  const scopeDirectory = join(consumerRoot, "node_modules", "@boundsvg");
  mkdirSync(scopeDirectory, { recursive: true });
  for (const packageInfo of packages) {
    const packageName = packageInfo.manifest.name.slice("@boundsvg/".length);
    if (!packageInfo.manifest.name.startsWith("@boundsvg/") || packageName.length === 0) {
      fail(`unsupported public package name ${packageInfo.manifest.name}`);
    }
    // CI runs on Unix-like hosts, where directory symlinks need no elevation.
    symlinkSync(packageInfo.directory, join(scopeDirectory, packageName), "dir");
  }
}

function resolvedDeclaration(entry, consumerPath, resolutionMode) {
  const resolution = ts.resolveModuleName(
    entry.specifier,
    consumerPath,
    compilerOptions,
    ts.sys,
    undefined,
    undefined,
    resolutionMode,
  );
  const resolvedPath = resolution.resolvedModule?.resolvedFileName;
  if (!resolvedPath || !existsSync(resolvedPath)) {
    fail(`installed-style consumer cannot resolve ${entry.specifier} from ${consumerPath}`);
  }
  const canonicalPath = realpathSync(resolvedPath);
  if (!entry.declarationPaths.includes(canonicalPath)) {
    fail(
      `${entry.specifier} resolved to ${resolvedPath}, expected one of ${entry.typesTargets.join(", ")}`,
    );
  }
  const incompatibleCondition = resolutionMode === ts.ModuleKind.ESNext ? "require" : "import";
  const selectedByMode = entry.typesRoutes.some(
    (route) =>
      route.declarationPath === canonicalPath &&
      !route.conditionPath.split(".").includes(incompatibleCondition),
  );
  if (!selectedByMode) {
    const modeName = resolutionMode === ts.ModuleKind.ESNext ? "ESM" : "CJS";
    fail(
      `${entry.specifier} resolved a declaration route incompatible with its ${modeName} consumer`,
    );
  }
  return canonicalPath;
}

function createConsumerProgram({ consumerRoot, extension, source, entries, resolvedRoutes }) {
  const consumerPath = join(consumerRoot, `consumer.${extension}`);
  writeFileSync(consumerPath, source);
  const resolutionMode = extension === "mts" ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS;
  for (const entry of entries) {
    resolvedRoutes.add(resolvedDeclaration(entry, consumerPath, resolutionMode));
  }
  const program = ts.createProgram({ options: compilerOptions, rootNames: [consumerPath] });
  assertNoDiagnostics(program, `installed-style ${extension} consumer`);
  return program;
}

const packages = publicPackages();
if (packages.length === 0) {
  fail("no publishable packages were discovered");
}
const entries = packages.flatMap((packageInfo) => packageInfo.entries);
if (entries.length === 0) {
  fail("no publishable declaration entries were discovered");
}

const declarationPaths = [...new Set(entries.flatMap((entry) => entry.declarationPaths))];
const declarationProgram = ts.createProgram({
  options: compilerOptions,
  rootNames: declarationPaths,
});
assertNoDiagnostics(declarationProgram, "built declaration graph");
const exportsBySpecifier = moduleExports(declarationProgram, entries);
const { exportCount, source } = createConsumerSource(entries, exportsBySpecifier);

const consumerRoot = mkdtempSync(join(tmpdir(), "boundsvg-public-declarations-"));
try {
  linkPublicPackages(consumerRoot, packages);
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "public-declaration-consumer", private: true, type: "module" }, null, 2)}\n`,
  );
  const resolvedRoutes = new Set();
  const consumerPrograms = [
    createConsumerProgram({ consumerRoot, entries, extension: "mts", resolvedRoutes, source }),
    createConsumerProgram({ consumerRoot, entries, extension: "cts", resolvedRoutes, source }),
  ];
  const unresolvedRoutes = declarationPaths.filter((path) => !resolvedRoutes.has(path));
  if (unresolvedRoutes.length > 0) {
    fail(
      `declaration routes are not selected by ESM or CJS consumers: ${unresolvedRoutes
        .map((path) => relative(repoRoot, path))
        .join(", ")}`,
    );
  }

  const publicPackagePrefixes = packages.map(
    (packageInfo) => `${realpathSync(packageInfo.directory)}${sep}`,
  );
  const reachableDeclarations = new Set(
    consumerPrograms
      .flatMap((program) => program.getSourceFiles())
      .filter(
        (sourceFile) =>
          sourceFile.isDeclarationFile &&
          publicPackagePrefixes.some((prefix) =>
            `${realpathSync(sourceFile.fileName)}${sep}`.startsWith(prefix),
          ),
      )
      .map((sourceFile) => realpathSync(sourceFile.fileName)),
  );
  process.stdout.write(
    `[public-declarations] PASS: ${packages.length} packages, ${entries.length} entries, ` +
      `${exportCount} named exports, ${reachableDeclarations.size} declaration files, ESM+CJS consumers\n`,
  );
} finally {
  rmSync(consumerRoot, { force: true, recursive: true });
}
