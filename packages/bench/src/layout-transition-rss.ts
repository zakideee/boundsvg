import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createEngineAsync, type Engine, type LayoutTransitionInput } from "@boundsvg/core";
import {
  createFlatFanOutTransition,
  createNestedFanOutTransition,
  createPortableLayoutTransitionInput,
  FLAT_FAN_OUT_COUNTS,
  NESTED_FAN_OUT_COUNTS,
} from "./layout-transition-fixture.js";

const execFileAsync = promisify(execFile);
const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(PACKAGE_DIRECTORY, "../..");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const FONT_PATH = resolve(REPOSITORY_ROOT, "fixtures/fonts/NotoSansJP-Regular.subset.ttf");
const DEFAULT_OUTPUT_PATH = resolve(
  REPOSITORY_ROOT,
  "_build/bench/layout-transition/node-rss.json",
);

type Profile = "official" | "smoke";
type OperationKind = "ordinary-pair" | "transition";
type FixtureKind = "flat" | "nested" | "portable";

type RssScenario = {
  fixture: FixtureKind;
  nodeCount: number | null;
  operation: OperationKind;
};

type CliOptions = {
  childScenario: RssScenario | null;
  outputPath: string;
  profile: Profile;
};

type MemorySnapshot = {
  arrayBuffersBytes: number;
  externalBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  rssBytes: number;
};

type ChildResult = {
  scenario: RssScenario;
  sourceTransitionJsonBytes: number;
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  outputIrJsonBytes: number;
  outputChecksumSha256: string;
  memoryBefore: MemorySnapshot;
  memoryAfter: MemorySnapshot;
  processMaxRssBytes: number;
  wasmLinearMemoryBytes: null;
  wasmMemoryAvailability: "node-wasm-pack-wrapper-does-not-export-memory";
};

type ScenarioResult = {
  scenario: RssScenario;
  warmupChildRuns: number;
  measuredChildRuns: number;
  samples: ChildResult[];
};

function parseScenario(value: string): RssScenario {
  const [fixture, nodeCountRaw, operation] = value.split(":");
  if (fixture !== "portable" && fixture !== "flat" && fixture !== "nested") {
    throw new TypeError(`Unknown RSS fixture: ${fixture}`);
  }
  if (operation !== "ordinary-pair" && operation !== "transition") {
    throw new TypeError(`Unknown RSS operation: ${operation}`);
  }
  const nodeCount = fixture === "portable" ? null : Number(nodeCountRaw);
  if (fixture !== "portable" && (!Number.isInteger(nodeCount) || (nodeCount ?? 0) < 1)) {
    throw new TypeError(`Invalid RSS node count: ${nodeCountRaw}`);
  }
  return { fixture, nodeCount, operation };
}

function serializeScenario(scenario: RssScenario): string {
  return `${scenario.fixture}:${scenario.nodeCount ?? "portable"}:${scenario.operation}`;
}

function parseCliOptions(arguments_: readonly string[]): CliOptions {
  let childScenario: RssScenario | null = null;
  let outputPath = DEFAULT_OUTPUT_PATH;
  let profile: Profile = "official";
  for (let argumentIndex = 0; argumentIndex < arguments_.length; argumentIndex += 1) {
    const argument = arguments_[argumentIndex];
    if (argument === "--") {
      continue;
    }
    const value = arguments_[argumentIndex + 1];
    if (argument === "--child" && value) {
      childScenario = parseScenario(value);
      argumentIndex += 1;
      continue;
    }
    if (argument === "--output" && value) {
      outputPath = resolve(process.cwd(), value);
      argumentIndex += 1;
      continue;
    }
    if (argument === "--profile" && (value === "official" || value === "smoke")) {
      profile = value;
      argumentIndex += 1;
      continue;
    }
    throw new TypeError(`Unknown or incomplete RSS argument: ${argument}`);
  }
  return { childScenario, outputPath, profile };
}

function memorySnapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    arrayBuffersBytes: usage.arrayBuffers,
    externalBytes: usage.external,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitOutput(arguments_: readonly string[]): string {
  return execFileSync("git", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
}

async function fileDigest(paths: readonly string[]): Promise<string> {
  const digest = createHash("sha256");
  for (const path of paths) {
    digest.update(path);
    digest.update("\0");
    digest.update(await readFile(resolve(REPOSITORY_ROOT, path)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function scenarioInput(scenario: RssScenario): LayoutTransitionInput {
  switch (scenario.fixture) {
    case "portable":
      return createPortableLayoutTransitionInput();
    case "flat":
      return createFlatFanOutTransition(scenario.nodeCount ?? 0);
    case "nested":
      return createNestedFanOutTransition(scenario.nodeCount ?? 0);
  }
}

function executeScenario(
  engine: Engine,
  scenario: RssScenario,
  input: LayoutTransitionInput,
): string {
  if (scenario.operation === "transition") {
    return JSON.stringify(engine.compileLayoutTransition(input).ir);
  }
  const referenceInput = input.states.A;
  const targetInput = input.states.B;
  if (!referenceInput || !targetInput) {
    throw new TypeError("RSS fixture must define A and B states");
  }
  const reference = engine.compile(referenceInput);
  const target = engine.compile(targetInput);
  return JSON.stringify([reference.ir, target.ir]);
}

async function runChild(scenario: RssScenario): Promise<ChildResult> {
  const fontData = new Uint8Array(await readFile(FONT_PATH));
  const engine = await createEngineAsync({
    fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: fontData }],
  });
  try {
    const input = scenarioInput(scenario);
    const sourceTransitionJsonBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
    const memoryBefore = memorySnapshot();
    const cpuStart = process.cpuUsage();
    const startTime = performance.now();
    const serializedOutput = executeScenario(engine, scenario, input);
    const wallMs = performance.now() - startTime;
    const cpu = process.cpuUsage(cpuStart);
    const memoryAfter = memorySnapshot();
    return {
      scenario,
      sourceTransitionJsonBytes,
      wallMs,
      cpuUserMs: cpu.user / 1_000,
      cpuSystemMs: cpu.system / 1_000,
      outputIrJsonBytes: Buffer.byteLength(serializedOutput, "utf8"),
      outputChecksumSha256: sha256(serializedOutput),
      memoryBefore,
      memoryAfter,
      processMaxRssBytes: process.resourceUsage().maxRSS * 1_024,
      wasmLinearMemoryBytes: null,
      wasmMemoryAvailability: "node-wasm-pack-wrapper-does-not-export-memory",
    };
  } finally {
    engine.dispose();
  }
}

function allScenarios(): RssScenario[] {
  const scenarios: RssScenario[] = [
    { fixture: "portable", nodeCount: null, operation: "ordinary-pair" },
    { fixture: "portable", nodeCount: null, operation: "transition" },
  ];
  for (const nodeCount of FLAT_FAN_OUT_COUNTS) {
    scenarios.push(
      { fixture: "flat", nodeCount, operation: "ordinary-pair" },
      { fixture: "flat", nodeCount, operation: "transition" },
    );
  }
  for (const nodeCount of NESTED_FAN_OUT_COUNTS) {
    scenarios.push(
      { fixture: "nested", nodeCount, operation: "ordinary-pair" },
      { fixture: "nested", nodeCount, operation: "transition" },
    );
  }
  return scenarios;
}

async function spawnChild(scenario: RssScenario): Promise<ChildResult> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", SCRIPT_PATH, "--child", serializeScenario(scenario)],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1_024 * 1_024,
    },
  );
  if (stderr.trim() !== "") {
    const unexpected = stderr
      .split("\n")
      .filter((line) => line.trim() !== "")
      .filter((line) => !line.includes("DEP0205"))
      .filter((line) => !line.includes("module.register()"))
      .filter((line) => !line.includes("trace-deprecation"));
    if (unexpected.length > 0) {
      throw new TypeError(`RSS child stderr: ${unexpected.join(" | ")}`);
    }
  }
  return JSON.parse(stdout) as ChildResult;
}

async function runParent(options: CliOptions): Promise<void> {
  const warmupChildRuns = 1;
  const measuredChildRuns = options.profile === "official" ? 5 : 1;
  const scenarioResults: ScenarioResult[] = [];
  for (const scenario of allScenarios()) {
    for (let warmupIndex = 0; warmupIndex < warmupChildRuns; warmupIndex += 1) {
      await spawnChild(scenario);
    }
    const samples: ChildResult[] = [];
    for (let measuredIndex = 0; measuredIndex < measuredChildRuns; measuredIndex += 1) {
      samples.push(await spawnChild(scenario));
    }
    scenarioResults.push({ scenario, warmupChildRuns, measuredChildRuns, samples });
    console.log(`${serializeScenario(scenario)}: ${measuredChildRuns} fresh process sample(s)`);
  }
  const wasmArtifact = new Uint8Array(
    await readFile(resolve(REPOSITORY_ROOT, "packages/core/wasm-pkg/boundsvg_bg.wasm")),
  );
  const runtimeDirtyOutput = gitOutput([
    "status",
    "--short",
    "--",
    "crates",
    "packages/core",
    "packages/video",
    "packages/worker",
  ]);
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
        "packages/bench/src/layout-transition-rss.ts",
      ]),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      wasmNodeArtifact: { bytes: wasmArtifact.byteLength, sha256: sha256(wasmArtifact) },
    },
    definition: {
      processMaxRssBytes: "Linux getrusage high-water mark for the fresh Node child",
      rawTypedCoexistence:
        "transition versus two ordinary compiles is an inclusive comparison; wrapper/output work is not subtracted or attributed to the raw Value clone",
      wasmMemory:
        "unavailable from the Node wasm-pack CJS wrapper; external/ArrayBuffer values remain separately labelled",
    },
    scenarios: scenarioResults,
  };
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`report: ${options.outputPath}`);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.childScenario) {
    const result = await runChild(options.childScenario);
    process.stdout.write(JSON.stringify(result));
    return;
  }
  await runParent(options);
}

await main();
