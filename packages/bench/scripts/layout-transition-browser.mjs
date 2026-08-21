#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIRECTORY = path.resolve(HERE, "..");
const REPOSITORY_ROOT = path.resolve(PACKAGE_DIRECTORY, "../..");
const DIST_DIRECTORY = path.resolve(REPOSITORY_ROOT, "_build/bench/layout-transition-browser");
const DEFAULT_OUTPUT = path.resolve(
  REPOSITORY_ROOT,
  "_build/bench/layout-transition/browser-worker.json",
);
const CLOCK_TICKS_PER_SECOND = 100;
const SAMPLE_INTERVAL_MS = 100;

function gitOutput(arguments_) {
  return execFileSync("git", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
}

async function fileDigest(paths) {
  const digest = createHash("sha256");
  for (const relativePath of paths) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(await readFile(path.resolve(REPOSITORY_ROOT, relativePath)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
]);

function defaultChromiumExecutable() {
  for (const candidate of ["chromium", "chromium-browser"]) {
    try {
      const resolved = execFileSync("which", [candidate], { encoding: "utf8" }).trim();
      if (resolved) {
        return resolved;
      }
    } catch {
      // Keep probing the remaining candidates.
    }
  }
  throw new Error(
    "No Chromium/Chrome binary found on PATH; pass --chromium <path>. (This benchmark is Linux-only: it reads /proc for CPU/RSS sampling.)",
  );
}

function parseArguments(arguments_) {
  const options = {
    chromium: null,
    output: DEFAULT_OUTPUT,
    profile: "official",
    workerCounts: [1, 2, 4],
  };
  for (let argumentIndex = 0; argumentIndex < arguments_.length; argumentIndex += 1) {
    const argument = arguments_[argumentIndex];
    if (argument === "--") {
      continue;
    }
    const value = arguments_[argumentIndex + 1];
    if (argument === "--chromium" && value) {
      options.chromium = value;
      argumentIndex += 1;
      continue;
    }
    if (argument === "--output" && value) {
      options.output = path.resolve(value);
      argumentIndex += 1;
      continue;
    }
    if (argument === "--profile" && (value === "official" || value === "smoke")) {
      options.profile = value;
      argumentIndex += 1;
      continue;
    }
    if (argument === "--worker-counts" && value) {
      const workerCounts = value.split(",").map(Number);
      if (
        workerCounts.length === 0 ||
        workerCounts.some((workerCount) => ![1, 2, 4].includes(workerCount))
      ) {
        throw new TypeError("--worker-counts must contain only 1,2,4");
      }
      options.workerCounts = [...new Set(workerCounts)];
      argumentIndex += 1;
      continue;
    }
    throw new TypeError(`Unknown or incomplete browser benchmark argument: ${argument}`);
  }
  options.chromium ??= defaultChromiumExecutable();
  return options;
}

function scenarios(workerCounts) {
  const values = [{ kind: "animated-webp" }, { kind: "animated-gif" }];
  for (const workerCount of workerCounts) {
    values.push({ kind: "pool-compile-svg", workerCount });
    values.push({ kind: "pool-png", workerCount });
  }
  if (workerCounts.includes(2)) {
    values.push({ kind: "pool-mp4", workerCount: 2 });
  }
  return values;
}

function scenarioName(scenario) {
  return "workerCount" in scenario
    ? `${scenario.kind}:workers-${scenario.workerCount}`
    : scenario.kind;
}

async function buildBrowserHarness() {
  await build({
    configFile: path.resolve(PACKAGE_DIRECTORY, "vite.layout-transition.config.ts"),
    logLevel: "warn",
  });
}

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new TypeError("Could not allocate an HTTP port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startStaticServer() {
  await stat(path.resolve(DIST_DIRECTORY, "layout-transition.html"));
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      const relativePath =
        requestPath === "/" ? "layout-transition.html" : requestPath.replace(/^\/+/, "");
      const resolvedPath = path.resolve(DIST_DIRECTORY, relativePath);
      if (
        resolvedPath !== DIST_DIRECTORY &&
        !resolvedPath.startsWith(`${DIST_DIRECTORY}${path.sep}`)
      ) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const contents = await readFile(resolvedPath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES.get(path.extname(resolvedPath)) ?? "application/octet-stream",
      });
      response.end(contents);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new TypeError("Static server has no TCP address");
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data));
      if (!payload.id) {
        return;
      }
      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }
      this.pending.delete(payload.id);
      clearTimeout(pending.timer);
      if (payload.error) {
        pending.reject(new TypeError(payload.error.message));
      } else {
        pending.resolve(payload.result);
      }
    });
    const rejectPending = () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new TypeError("DevTools connection closed"));
      }
      this.pending.clear();
    };
    this.socket.addEventListener("close", rejectPending);
    this.socket.addEventListener("error", rejectPending);
  }

  send(method, parameters = {}, timeoutMs = 180_000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TypeError(`DevTools request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params: parameters }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitFor(check, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const startedAt = performance.now();
  let lastError;
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError ?? new TypeError(`Timed out after ${timeoutMs}ms`);
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new TypeError(detail || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function launchBrowser(options, origin) {
  const debugPort = await findOpenPort();
  const profileDirectory = await mkdtemp(
    path.join(os.tmpdir(), "boundsvg-layout-transition-browser-"),
  );
  const browser = spawn(
    options.chromium,
    [
      "--headless=new",
      // Local benchmark harness only; sandbox adds noise and needs privileges.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-precise-memory-info",
      "--window-size=1280,720",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDirectory}`,
      `${origin}/layout-transition.html`,
    ],
    { stdio: "ignore" },
  );
  const endpoint = `http://127.0.0.1:${debugPort}`;
  const target = await waitFor(
    async () => {
      const response = await fetch(`${endpoint}/json/list`);
      if (!response.ok) {
        return null;
      }
      const targets = await response.json();
      return targets.find((entry) => entry.type === "page" && entry.url.startsWith(origin));
    },
    { timeoutMs: 30_000 },
  );
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await waitFor(
    () => evaluate(client, "globalThis.boundsvgLayoutTransitionBenchmarkReady === true"),
    { timeoutMs: 60_000 },
  );
  return { browser, client, profileDirectory, rootPid: browser.pid };
}

async function closeBrowser(instance) {
  instance.client.close();
  if (instance.browser.exitCode === null) {
    instance.browser.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => instance.browser.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  await rm(instance.profileDirectory, { recursive: true, force: true });
}

async function allProcessStats() {
  const source = await readFile("/proc/stat", "utf8");
  const cpuValues = source.split("\n")[0].trim().split(/\s+/u).slice(1).map(Number);
  const idle = (cpuValues[3] ?? 0) + (cpuValues[4] ?? 0);
  const total = cpuValues.reduce((sum, value) => sum + value, 0);
  const entries = await readdir("/proc", { withFileTypes: true });
  const rows = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
      .map(async (entry) => {
        const pid = Number(entry.name);
        try {
          const processSource = await readFile(`/proc/${pid}/stat`, "utf8");
          const end = processSource.lastIndexOf(")");
          const fields = processSource.slice(end + 2).split(" ");
          rows.push({
            cpuTicks: Number(fields[11]) + Number(fields[12]),
            pid,
            ppid: Number(fields[1]),
            rssBytes: Number(fields[21]) * 4_096,
          });
        } catch {
          // Process exited during enumeration.
        }
      }),
  );
  return { host: { idle, total }, rows };
}

function descendants(rows, rootPid) {
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!selected.has(row.pid) && selected.has(row.ppid)) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => selected.has(row.pid));
}

async function proportionalBytes(pid) {
  try {
    const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
    return Number(/^Pss:\s+(\d+)\s+kB$/mu.exec(rollup)?.[1] ?? 0) * 1_024;
  } catch {
    return 0;
  }
}

async function processSnapshot(rootPid) {
  const state = await allProcessStats();
  const processes = descendants(state.rows, rootPid);
  const pssValues = await Promise.all(
    processes.map((processEntry) => proportionalBytes(processEntry.pid)),
  );
  return {
    cpuByPid: Object.fromEntries(
      processes.map((processEntry) => [processEntry.pid, processEntry.cpuTicks]),
    ),
    host: state.host,
    processCount: processes.length,
    pssBytes: pssValues.reduce((sum, value) => sum + value, 0),
    rssBytes: processes.reduce((sum, processEntry) => sum + processEntry.rssBytes, 0),
  };
}

async function monitorProcesses(rootPid, task) {
  const start = await processSnapshot(rootPid);
  const samples = [start];
  const maximumCpuByPid = new Map(
    Object.entries(start.cpuByPid).map(([pid, ticks]) => [Number(pid), ticks]),
  );
  let running = true;
  const sampler = (async () => {
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
      const sample = await processSnapshot(rootPid);
      samples.push(sample);
      for (const [pid, ticks] of Object.entries(sample.cpuByPid)) {
        maximumCpuByPid.set(Number(pid), Math.max(maximumCpuByPid.get(Number(pid)) ?? 0, ticks));
      }
    }
  })();
  const startedAt = performance.now();
  let value;
  let failure;
  try {
    value = await task();
  } catch (error) {
    failure = error;
  } finally {
    running = false;
    await sampler;
  }
  const end = await processSnapshot(rootPid);
  samples.push(end);
  for (const [pid, ticks] of Object.entries(end.cpuByPid)) {
    maximumCpuByPid.set(Number(pid), Math.max(maximumCpuByPid.get(Number(pid)) ?? 0, ticks));
  }
  const wallMs = performance.now() - startedAt;
  const processCpuTicks = [...maximumCpuByPid.entries()].reduce(
    (sum, [pid, ticks]) => sum + Math.max(0, ticks - (start.cpuByPid[pid] ?? 0)),
    0,
  );
  const processCpuMs = (processCpuTicks / CLOCK_TICKS_PER_SECOND) * 1_000;
  const metrics = {
    monitorWallMs: wallMs,
    processCpuMs,
    averageCpuCores: processCpuMs / wallMs,
    startPssBytes: start.pssBytes,
    endPssBytes: end.pssBytes,
    peakPssBytes: Math.max(...samples.map((sample) => sample.pssBytes)),
    peakRssBytes: Math.max(...samples.map((sample) => sample.rssBytes)),
    peakProcessCount: Math.max(...samples.map((sample) => sample.processCount)),
  };
  if (failure) {
    failure.processMetrics = metrics;
    throw failure;
  }
  return { metrics, value };
}

function serializeError(error) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function runSample(options, origin, scenario) {
  const browser = await launchBrowser(options, origin);
  try {
    const expression = `globalThis.runBoundsvgLayoutTransitionBenchmarkScenario(${JSON.stringify(scenario)})`;
    try {
      const monitored = await monitorProcesses(browser.rootPid, () =>
        evaluate(browser.client, expression, true),
      );
      return { status: "ok", browser: monitored.value, process: monitored.metrics };
    } catch (error) {
      return {
        status: "error",
        error: serializeError(error),
        process: error.processMetrics ?? null,
      };
    }
  } finally {
    await closeBrowser(browser);
  }
}

async function artifactMetadata() {
  const entries = await readdir(path.resolve(DIST_DIRECTORY, "assets"));
  const wasmFiles = entries.filter((entry) => entry.endsWith(".wasm")).sort();
  const wasmArtifacts = [];
  for (const fileName of wasmFiles) {
    const contents = await readFile(path.resolve(DIST_DIRECTORY, "assets", fileName));
    wasmArtifacts.push({
      fileName,
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }
  return wasmArtifacts;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runtimeDirtyOutput = gitOutput([
    "status",
    "--short",
    "--",
    "crates",
    "packages/core",
    "packages/video",
    "packages/worker",
  ]);
  await buildBrowserHarness();
  const { server, origin } = await startStaticServer();
  const warmupRuns = 1;
  const measuredRuns = options.profile === "official" ? 3 : 1;
  const results = [];
  try {
    for (const scenario of scenarios(options.workerCounts)) {
      for (let warmupIndex = 0; warmupIndex < warmupRuns; warmupIndex += 1) {
        await runSample(options, origin, scenario);
      }
      const samples = [];
      for (let measuredIndex = 0; measuredIndex < measuredRuns; measuredIndex += 1) {
        samples.push(await runSample(options, origin, scenario));
      }
      results.push({ scenario, warmupRuns, measuredRuns, samples });
      process.stdout.write(`${scenarioName(scenario)}: ${measuredRuns} browser sample(s)\n`);
    }
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    repository: {
      head: gitOutput(["rev-parse", "HEAD"]),
      branch: gitOutput(["branch", "--show-current"]),
      runtimeDirtyPaths: runtimeDirtyOutput ? runtimeDirtyOutput.split("\n") : [],
      harnessDigestSha256: await fileDigest([
        "packages/bench/package.json",
        "packages/bench/src/layout-transition-fixture.ts",
        "packages/bench/browser/layout-transition.ts",
        "packages/bench/scripts/layout-transition-browser.mjs",
        "packages/bench/vite.layout-transition.config.ts",
      ]),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      chromiumExecutable: options.chromium,
      chromiumVersion: execFileSync(options.chromium, ["--version"], { encoding: "utf8" }).trim(),
    },
    workerCounts: options.workerCounts,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    processMetrics:
      "fresh Chromium process-tree CPU, PSS, and RSS; one measured scenario per fresh profile",
    wasmMemory:
      "worker-owned WebAssembly.Memory is not exposed to the main realm; process-tree PSS/RSS remain separately labelled",
    wasmArtifacts: await artifactMetadata(),
    results,
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`report: ${options.output}\n`);
}

await main();
