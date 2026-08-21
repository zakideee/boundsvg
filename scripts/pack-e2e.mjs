#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = join(repoRoot, "packages");
const workDir = mkdtempSync(join(tmpdir(), "boundsvg-pack-e2e-"));
const fontPath = join(repoRoot, "fixtures", "fonts", "NotoSansJP-Regular.subset.ttf");
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
function fail(message) {
  throw new Error(`[pack-e2e] ${message}`);
}
function log(message) {
  process.stdout.write(`[pack-e2e] ${message}\n`);
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    fail(
      [
        `${command} ${args.join(" ")} failed with status ${String(result.status)}`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}
function discoverPublicPackages() {
  const packages = [];
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = join(packagesRoot, entry.name);
    const manifestPath = join(directory, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = readJson(manifestPath);
    if (manifest.private === true) {
      continue;
    }
    if (manifest.publishConfig?.access !== "public" || typeof manifest.name !== "string") {
      fail(`${relative(repoRoot, manifestPath)} is not explicitly publishable`);
    }
    packages.push({ directory, manifest });
  }
  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}
function packPackage(packageInfo) {
  log(`packing ${packageInfo.manifest.name}`);
  const metadata = JSON.parse(
    run("pnpm", ["pack", "--json", "--pack-destination", workDir], {
      cwd: packageInfo.directory,
    }).stdout,
  );
  if (
    metadata.name !== packageInfo.manifest.name ||
    metadata.version !== packageInfo.manifest.version ||
    typeof metadata.filename !== "string"
  ) {
    fail(`pnpm pack returned invalid metadata for ${packageInfo.manifest.name}`);
  }
  const path = join(workDir, basename(metadata.filename));
  if (!existsSync(path)) {
    fail(`pnpm pack did not create ${path}`);
  }
  const entries = run("tar", ["-tzf", path]).stdout.trim().split("\n").filter(Boolean).sort();
  return { ...packageInfo, entries, path };
}
function dependencyFields(manifest) {
  return [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies].filter(
    (field) => field && typeof field === "object",
  );
}
function assertNoWorkspaceProtocols(packageName, manifest) {
  for (const dependencies of dependencyFields(manifest)) {
    for (const [dependencyName, specification] of Object.entries(dependencies)) {
      if (typeof specification === "string" && specification.startsWith("workspace:")) {
        fail(`${packageName} retained ${dependencyName}: ${specification} after packing`);
      }
    }
  }
}
function assertInternalDependencyVersions(manifest, candidateVersions) {
  // Candidate packages intentionally use workspace:* so the release artifact pins
  // every internal edge to the exact version packed in this batch. Peer edges
  // use workspace:^ instead: consumers may hold a newer compatible dependency,
  // so the packed range must contain the candidate version rather than pin it.
  const peers = manifest.peerDependencies ?? {};
  for (const dependencies of dependencyFields(manifest)) {
    for (const [dependencyName, specification] of Object.entries(dependencies)) {
      const candidateVersion = candidateVersions.get(dependencyName);
      if (!candidateVersion) {
        continue;
      }
      const accepted =
        dependencies === peers ? [candidateVersion, `^${candidateVersion}`] : [candidateVersion];
      if (!accepted.includes(specification)) {
        fail(
          `${manifest.name} requires ${dependencyName}@${String(specification)}, expected candidate ${candidateVersion}`,
        );
      }
    }
  }
}
function collectRelativeTargets(value, targets = []) {
  if (typeof value === "string") {
    if (value.startsWith("./")) {
      targets.push(value);
    }
    return targets;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRelativeTargets(item, targets);
    }
    return targets;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectRelativeTargets(item, targets);
    }
  }
  return targets;
}
function supportsRuntimeCondition(value, mode) {
  if (typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => supportsRuntimeCondition(item, mode));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const activeConditions = new Set([mode, "node", "node-addons", "module-sync", "default"]);
  for (const [condition, item] of Object.entries(value)) {
    if (activeConditions.has(condition)) {
      return supportsRuntimeCondition(item, mode);
    }
  }
  return false;
}
function publicEntries(manifest) {
  if (!manifest.exports || typeof manifest.exports !== "object") {
    fail(`${manifest.name} has no exports map`);
  }
  return Object.entries(manifest.exports).flatMap(([subpath, target]) => {
    if (target === null || subpath === "./package.json") {
      return [];
    }
    // Asset subpaths (a .wasm a consumer resolves by URL) are not modules:
    // they have no types and cannot be imported. runVideoSmoke resolves them.
    if (typeof target === "string" && target.endsWith(".wasm")) {
      return [];
    }
    const specifier = subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    return [{ specifier, subpath, target }];
  });
}
function installedPackageDirectory(packageName) {
  return join(workDir, "node_modules", ...packageName.split("/"));
}
function assertContainedTarget(packageName, packageDirectory, target) {
  const targetPath = resolve(packageDirectory, target);
  const relativePath = relative(packageDirectory, targetPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    fail(`${packageName} target escapes its package: ${target}`);
  }
  if (!existsSync(targetPath)) {
    fail(`${packageName} is missing packed target ${target}`);
  }
  const canonicalPackage = `${realpathSync(packageDirectory)}${sep}`;
  const canonicalTarget = realpathSync(targetPath);
  if (!`${canonicalTarget}${sep}`.startsWith(canonicalPackage)) {
    fail(`${packageName} target resolves outside its installed package: ${target}`);
  }
}
function hasWasmPayload(directory) {
  return readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? hasWasmPayload(path)
      : entry.isFile() && entry.name.endsWith(".wasm");
  });
}
function validateInstalledPackage(packedPackage, candidateVersions) {
  const { name, version } = packedPackage.manifest;
  const directory = installedPackageDirectory(name);
  const manifest = readJson(join(directory, "package.json"));
  if (manifest.name !== name || manifest.version !== version) {
    fail(`${name} installed identity does not match its candidate tarball`);
  }
  assertNoWorkspaceProtocols(name, manifest);
  assertInternalDependencyVersions(manifest, candidateVersions);
  const targets = new Set([
    ...collectRelativeTargets(manifest.exports),
    ...collectRelativeTargets(manifest.types),
    ...collectRelativeTargets(manifest.typesVersions),
    ...collectRelativeTargets(manifest.bin),
  ]);
  for (const target of targets) {
    assertContainedTarget(name, directory, target);
  }
  for (const licenseName of ["LICENSE-MIT", "LICENSE-APACHE"]) {
    const installedLicense = join(directory, licenseName);
    if (
      !existsSync(installedLicense) ||
      !readFileSync(installedLicense).equals(readFileSync(join(repoRoot, licenseName)))
    ) {
      fail(`${name} does not ship canonical ${licenseName}`);
    }
  }
  if (hasWasmPayload(directory)) {
    const notice = join(directory, "THIRD-PARTY-LICENSES");
    if (
      !existsSync(notice) ||
      !readFileSync(notice).equals(readFileSync(join(repoRoot, "THIRD-PARTY-LICENSES")))
    ) {
      fail(`${name} ships WASM without the canonical third-party notice`);
    }
  }
  if (packedPackage.entries.some((entry) => /\/src\/|\/tests?\//.test(entry))) {
    fail(`${name} tarball contains source or test files`);
  }
  return manifest;
}
function externalPackagePath(workspacePackage, dependencyName) {
  const dependencyPath = join(
    repoRoot,
    "packages",
    workspacePackage,
    "node_modules",
    ...dependencyName.split("/"),
  );
  if (!existsSync(dependencyPath)) {
    fail(`missing installed external provider ${dependencyName}`);
  }
  return realpathSync(dependencyPath);
}
function externalProviders() {
  const react = externalPackagePath("react", "react");
  const reactDom = externalPackagePath("react", "react-dom");
  const reactTypes = externalPackagePath("react", "@types/react");
  const reactDomTypes = externalPackagePath("react", "@types/react-dom");
  const tinyglobby = externalPackagePath("cli", "tinyglobby");
  const providers = {
    react,
    "react-dom": reactDom,
    scheduler: realpathSync(join(dirname(reactDom), "scheduler")),
    "@types/react": reactTypes,
    "@types/react-dom": reactDomTypes,
    csstype: realpathSync(join(dirname(dirname(reactTypes)), "csstype")),
    tinyglobby,
    fdir: realpathSync(join(dirname(tinyglobby), "fdir")),
    picomatch: realpathSync(join(dirname(tinyglobby), "picomatch")),
  };
  for (const [name, path] of Object.entries(providers)) {
    if (readJson(join(path, "package.json")).name !== name) {
      fail(`external provider path does not contain ${name}`);
    }
  }
  return providers;
}
function installConsumer(packedPackages) {
  const dependencies = Object.fromEntries(
    packedPackages.map((item) => [item.manifest.name, `file:${item.path}`]),
  );
  const providers = externalProviders();
  for (const [name, path] of Object.entries(providers)) {
    dependencies[name] = `file:${path}`;
  }
  writeFileSync(
    join(workDir, "package.json"),
    `${JSON.stringify({ name: "boundsvg-packed-consumer", private: true, type: "module", dependencies }, null, 2)}\n`,
  );
  const overrides = [
    ...packedPackages.map((item) => [item.manifest.name, `file:${item.path}`]),
    ...Object.entries(providers).map(([name, path]) => [name, `file:${path}`]),
  ];
  writeFileSync(
    join(workDir, "pnpm-workspace.yaml"),
    `packages:\n  - .\noverrides:\n${overrides
      .map(([name, specification]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specification)}`)
      .join("\n")}\n`,
  );
  log(`installing ${packedPackages.length} candidate packages into a fresh offline consumer`);
  run(
    "pnpm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--strict-peer-dependencies",
      "--frozen-lockfile=false",
    ],
    { cwd: workDir },
  );
}
function collectPackageIdentities(node, identities = new Map()) {
  if (!node || typeof node !== "object") {
    return identities;
  }
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    if (name.startsWith("@boundsvg/") && dependency && typeof dependency === "object") {
      const values = identities.get(name) ?? new Set();
      values.add(
        typeof dependency.path === "string" ? dependency.path : String(dependency.version),
      );
      identities.set(name, values);
    }
    collectPackageIdentities(dependency, identities);
  }
  return identities;
}
function validateInstalledGraph(packedPackages) {
  const graph = JSON.parse(
    run("pnpm", ["list", "--depth", "Infinity", "--json"], { cwd: workDir }).stdout,
  );
  const identities = collectPackageIdentities(graph[0]);
  for (const item of packedPackages) {
    const packageIdentities = identities.get(item.manifest.name);
    if (!packageIdentities || packageIdentities.size !== 1) {
      fail(`${item.manifest.name} did not resolve to one candidate identity`);
    }
  }
}
function writeTypeConsumers(installedPackages) {
  const entries = installedPackages.flatMap(({ manifest }) => publicEntries(manifest));
  const source = (mode) =>
    entries
      .filter((entry) => mode === "import" || supportsRuntimeCondition(entry.target, "require"))
      .map(
        (entry, index) =>
          `import type * as Entry${index} from ${JSON.stringify(entry.specifier)};\ntype Use${index} = keyof typeof Entry${index};`,
      )
      .concat("export {};", "")
      .join("\n");
  writeFileSync(join(workDir, "consumer.mts"), source("import"));
  writeFileSync(join(workDir, "consumer.cts"), source("require"));
  writeFileSync(
    join(workDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
          types: [],
        },
        include: ["consumer.mts", "consumer.cts"],
      },
      null,
      2,
    )}\n`,
  );
  run("pnpm", ["exec", "tsc", "--project", join(workDir, "tsconfig.json")]);
  return entries;
}
function runtimeSource(specifiers, mode) {
  const loader =
    mode === "esm" ? "(specifier) => import(specifier)" : "async (specifier) => require(specifier)";
  const prefix =
    mode === "esm"
      ? "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);"
      : "";
  return `${prefix}
(async () => {
  const load = ${loader};
  const specifiers = ${JSON.stringify(specifiers)};
  for (const specifier of specifiers) {
    await load(specifier);
  }
  const core = await load('@boundsvg/core');
  const shape = await load('@boundsvg/shape');
  const extras = await load('@boundsvg/extras');
  const testing = await load('@boundsvg/testing');
  const worker = await load('@boundsvg/worker');
  const reactPackage = await load('@boundsvg/react');
  const provider = await load('@boundsvg/react/provider');
  const React = await load('react');
  const ReactDOMServer = await load('react-dom/server');
  const { readFileSync } = await load('node:fs');
  const geometry = shape.geometryDoc(
    { width: 10, height: 10 },
    shape.pathGeometry('M0 0H10V10Z', { nodeId: 'packed-shape' }),
  );
  if (geometry.viewBox.width !== 10 || geometry.root.kind !== 'path') {
    throw new Error('shape runtime failed');
  }
  const scene = core.Canvas(
    { width: 64, height: 32 },
    extras.HStack(
      { width: 64, height: 32, gap: 4 },
      core.Box({ id: 'left', width: 30, height: 32, background: '#dc2626' }),
      core.Text({ id: 'right', font: 'NotoSansJP', fontSizePx: 12 }, '検証'),
    ),
  );
  testing.assertStableNodeIds(scene);
  const engine = await core.createEngineAsync({
    fonts: [{ alias: 'NotoSansJP', data: readFileSync(${JSON.stringify(fontPath)}), weight: 400, style: 'normal' }],
  });
  try {
    const svg = testing.renderSvgSnapshot(engine, scene);
    const png = testing.renderPngSnapshot(engine, scene).bytes;
    if (!svg.startsWith('<svg') || !svg.includes('data-boundsvg-text') || JSON.stringify(Array.from(png.slice(0, 8))) !== ${JSON.stringify(JSON.stringify(pngSignature))}) {
      throw new Error('core/testing render failed');
    }
  } finally {
    engine.dispose();
  }
  const shared = new ArrayBuffer(4);
  const transferables = worker.collectRequestTransferables({
    id: 1,
    type: 'init',
    fonts: [
      { alias: 'a', data: shared, weight: 400, style: 'normal' },
      { alias: 'b', data: shared, weight: 700, style: 'normal' },
    ],
  });
  if (transferables.length !== 1 || transferables[0] !== shared) {
    throw new Error('worker transferable runtime failed');
  }
  const element = React.createElement(
    reactPackage.Canvas,
    { width: 64, height: 32 },
    React.createElement(reactPackage.Box, { width: 64, height: 32 }),
  );
  if (reactPackage.toVNode(element).type !== 'Canvas') {
    throw new Error('React conversion failed');
  }
  const markup = ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      provider.BoundSvgProvider,
      { config: { fonts: [] }, fallback: React.createElement('span', null, 'loading') },
      React.createElement('div', null, 'ready'),
    ),
  );
  if (markup !== '<span>loading</span>') {
    throw new Error('React provider fallback failed');
  }
  console.log(JSON.stringify({ mode: ${JSON.stringify(mode)}, entries: specifiers.length }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}
function runRuntimeConsumers(entries) {
  const esmSpecifiers = entries
    .filter((entry) => entry.specifier !== "@boundsvg/worker/worker")
    .map((entry) => entry.specifier);
  const cjsSpecifiers = entries
    .filter((entry) => supportsRuntimeCondition(entry.target, "require"))
    .map((entry) => entry.specifier);
  writeFileSync(join(workDir, "runtime.mjs"), runtimeSource(esmSpecifiers, "esm"));
  writeFileSync(join(workDir, "runtime.cjs"), runtimeSource(cjsSpecifiers, "cjs"));
  const esm = JSON.parse(run("node", ["runtime.mjs"], { cwd: workDir }).stdout.trim());
  const cjs = JSON.parse(run("node", ["runtime.cjs"], { cwd: workDir }).stdout.trim());
  return { cjs, esm };
}
function runBrowserSmoke() {
  const source = `
import { readFileSync } from 'node:fs';
const mode = process.argv[2];
const browser = await import('@boundsvg/browser');
const core = await import('@boundsvg/core');
const coreWasm = await import('@boundsvg/core/wasm');
const wasmBytes = readFileSync('node_modules/@boundsvg/browser/dist/boundsvg_bg.wasm');
const fontBytes = readFileSync(${JSON.stringify(fontPath)});
let fetchCount = 0;
let requestedUrl = '';
globalThis.fetch = async (input) => {
  fetchCount += 1;
  requestedUrl = input instanceof URL ? input.href : String(input);
  return new Response(wasmBytes, { headers: { 'Content-Type': 'application/wasm' } });
};
const options = mode === 'precompiled' ? { wasmModule: new WebAssembly.Module(wasmBytes) } : undefined;
const module = await browser.loadWasmModule(options);
coreWasm.initWasm(module);
const engine = await core.createEngineAsync({
  fonts: [{ alias: 'NotoSansJP', data: fontBytes, weight: 400, style: 'normal' }],
});
try {
  const scene = core.Canvas({ width: 64, height: 32 }, core.Text({ font: 'NotoSansJP', fontSizePx: 12 }, '検証'));
  const svg = engine.renderToSvg(scene);
  const png = engine.renderToPng(scene);
  if (!svg.includes('data-boundsvg-text') || JSON.stringify(Array.from(png.slice(0, 8))) !== ${JSON.stringify(JSON.stringify(pngSignature))}) {
    throw new Error('browser WASM render failed');
  }
} finally {
  engine.dispose();
}
if (fetchCount !== (mode === 'default' ? 1 : 0) || (fetchCount === 1 && !requestedUrl.endsWith('/@boundsvg/browser/dist/boundsvg_bg.wasm'))) {
  throw new Error('browser WASM loading route failed');
}
console.log('[pack-e2e] browser WASM ' + mode + ' OK');
`;
  writeFileSync(join(workDir, "browser.mjs"), source);
  run("node", ["browser.mjs", "default"], { cwd: workDir });
  run("node", ["browser.mjs", "precompiled"], { cwd: workDir });
}
function runVideoSmoke() {
  const source = `
import { readFileSync } from 'node:fs';
const video = await import('@boundsvg/video');
// The documented bundler escape hatch imports the binary by subpath, which
// only works if the exports map lists it.
const wasmUrl = import.meta.resolve('@boundsvg/video/dist/boundmp4_bg.wasm');
const wasmBytes = readFileSync(new URL(wasmUrl));
let requestedUrl = '';
globalThis.fetch = async (input) => {
  requestedUrl = input instanceof URL ? input.href : String(input);
  return new Response(wasmBytes, { headers: { 'Content-Type': 'application/wasm' } });
};
await video.initVideoWasm();
if (!requestedUrl.endsWith('/@boundsvg/video/dist/boundmp4_bg.wasm')) {
  throw new Error('video WASM loading route failed: ' + requestedUrl);
}
console.log('[pack-e2e] video WASM default OK');
`;
  writeFileSync(join(workDir, "video.mjs"), source);
  run("node", ["video.mjs"], { cwd: workDir });
}
function runWorkerSubpathSmoke() {
  const source = `
const responses = [];
globalThis.self = { onmessage: null, postMessage: (response) => responses.push(response) };
await import('@boundsvg/worker/worker');
self.onmessage({ data: { id: 71, unexpected: true } });
if (responses[0]?.id !== 71 || responses[0]?.type !== 'error' || responses[0]?.error?.code !== 'WORKER_INVALID_MESSAGE') {
  throw new Error('worker subpath protocol failed');
}
console.log('[pack-e2e] worker subpath OK');
`;
  writeFileSync(join(workDir, "worker.mjs"), source);
  run("node", ["worker.mjs"], { cwd: workDir });
}
function runCliSmoke() {
  const binDirectory = join(workDir, "node_modules", ".bin");
  for (const bin of ["boundsvg", "boundsvg-convert"]) {
    const result = run(join(binDirectory, bin), ["--help"], { cwd: workDir });
    if (!`${result.stdout}\n${result.stderr}`.includes("Usage:")) {
      fail(`${bin} did not execute its packed help route`);
    }
  }
}
try {
  const publicPackages = discoverPublicPackages();
  const packedPackages = publicPackages.map(packPackage);
  const candidateVersions = new Map(
    packedPackages.map((item) => [item.manifest.name, item.manifest.version]),
  );
  installConsumer(packedPackages);
  validateInstalledGraph(packedPackages);
  const installedPackages = packedPackages.map((item) => ({
    manifest: validateInstalledPackage(item, candidateVersions),
  }));
  const entries = writeTypeConsumers(installedPackages);
  const runtimes = runRuntimeConsumers(entries);
  runBrowserSmoke();
  runVideoSmoke();
  runWorkerSubpathSmoke();
  runCliSmoke();
  log(
    `PASS: ${packedPackages.length} packages, ${entries.length} entries, ` +
      `${runtimes.esm.entries} ESM and ${runtimes.cjs.entries} CJS runtime loads`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
