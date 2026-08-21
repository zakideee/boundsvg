import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Box, Canvas, createEngineAsync, Engine, Flex, Text, type VNode } from "@boundsvg/core";
import { createWasmEngineInstance } from "@boundsvg/core/wasm";
import {
  assertBenchmarkReport,
  BENCHMARK_SCHEMA_VERSION,
  type BenchmarkConfig,
  type BenchmarkReport,
  type BenchmarkScenarioName,
  type BenchmarkScenarioResult,
  type BenchmarkTransportCounts,
} from "./report.js";

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(PACKAGE_DIRECTORY, "../..");
const FONT_RELATIVE_PATH = "fixtures/fonts/NotoSansJP-Regular.subset.ttf";
const FONT_PATH = resolve(REPOSITORY_ROOT, FONT_RELATIVE_PATH);
const DEFAULT_OUTPUT_PATH = resolve(REPOSITORY_ROOT, "_build/bench/latest.json");
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 360;
const DEFAULT_COMPILED_RENDER_COUNT = 8;
const DEFAULT_MEASUREMENT_COUNT = 32;

type CliOptions = {
  config: BenchmarkConfig;
  outputPath: string;
  smoke: boolean;
};

type TimedScenario = {
  name: BenchmarkScenarioName;
  operationsPerIteration: number;
  run: () => unknown;
  checksum: (result: unknown) => number;
  transportCounts?: () => BenchmarkTransportCounts;
};

function parsePositiveInteger(rawValue: string | undefined, flag: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${flag} requires a positive integer`);
  }
  return value;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let iterations = 10;
  let warmupIterations = 2;
  let outputPath = DEFAULT_OUTPUT_PATH;
  let smoke = false;

  for (let argumentIndex = 0; argumentIndex < argv.length; argumentIndex += 1) {
    const argument = argv[argumentIndex];
    if (argument === "--") {
      continue;
    }
    if (argument === "--smoke") {
      smoke = true;
      continue;
    }
    if (argument === "--iterations") {
      iterations = parsePositiveInteger(argv[argumentIndex + 1], argument);
      argumentIndex += 1;
      continue;
    }
    if (argument === "--warmup") {
      warmupIterations = parsePositiveInteger(argv[argumentIndex + 1], argument);
      argumentIndex += 1;
      continue;
    }
    if (argument === "--output") {
      const nextOutputPath = argv[argumentIndex + 1];
      if (!nextOutputPath) {
        throw new TypeError("--output requires a path");
      }
      outputPath = resolve(process.cwd(), nextOutputPath);
      argumentIndex += 1;
      continue;
    }
    throw new TypeError(`Unknown benchmark argument: ${argument}`);
  }

  return {
    config: {
      iterations,
      warmupIterations,
      compiledRenderCount: DEFAULT_COMPILED_RENDER_COUNT,
      measurementCount: DEFAULT_MEASUREMENT_COUNT,
    },
    outputPath,
    smoke,
  };
}

function buildFixtureScene(): VNode {
  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#f8fafc" },
    Flex(
      {
        direction: "column",
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        padding: [36, 40, 36, 40],
        gap: 18,
      },
      Text(
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          lineHeight: 1.25,
          color: "#111827",
        },
        "再現可能な SVG レイアウト",
      ),
      Box(
        {
          width: 560,
          padding: [20, 24, 20, 24],
          background: "#ede9fe",
          borderRadius: 16,
          borderWidth: 2,
          borderColor: "#7c3aed",
        },
        Text(
          {
            font: "NotoSansJP",
            fontSizePx: 20,
            lineHeight: 1.5,
            color: "#4c1d95",
            wrap: "word",
          },
          "WASM 内で shaping・計測・layout・rasterization を一貫して実行します。",
        ),
      ),
      Flex(
        { direction: "row", width: 560, gap: 12 },
        Box({ width: 176, height: 72, background: "#0f766e", borderRadius: 12 }),
        Box({ width: 176, height: 72, background: "#0369a1", borderRadius: 12 }),
        Box({ width: 176, height: 72, background: "#be123c", borderRadius: 12 }),
      ),
    ),
  );
}

function buildOutlineHeavyScene(): VNode {
  const line = "Outline ownership 日本語 fallback deterministic path ".repeat(12);
  return Canvas(
    { width: 720, height: 420 },
    Flex(
      { direction: "column", width: 680, height: 380 },
      ...Array.from({ length: 8 }, (_, index) =>
        Text(
          {
            id: `outline-heavy-${index}`,
            font: "NotoSansJP",
            fontSizePx: 16,
            width: 680,
            wrap: "word",
          },
          line,
        ),
      ),
    ),
  );
}

function buildRasterOutlineHeavyScene(): VNode {
  return Canvas(
    { width: 720, height: 420 },
    Text(
      {
        id: "raster-outline-heavy",
        font: "NotoSansJP",
        fontSizePx: 16,
        width: 720,
        wrap: "none",
      },
      "A".repeat(8_000),
    ),
  );
}

function checksumBytes(bytes: Uint8Array): number {
  let checksum = 2_166_136_261;
  for (const byte of bytes) {
    checksum ^= byte;
    checksum = Math.imul(checksum, 16_777_619) >>> 0;
  }
  return checksum;
}

function checksumString(value: string): number {
  let checksum = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    checksum ^= value.charCodeAt(index);
    checksum = Math.imul(checksum, 16_777_619) >>> 0;
  }
  return checksum;
}

function checksumByteResult(result: unknown): number {
  if (!(result instanceof Uint8Array)) {
    throw new TypeError("benchmark scenario did not return Uint8Array bytes");
  }
  return checksumBytes(result);
}

function checksumStringResult(result: unknown): number {
  if (typeof result !== "string") {
    throw new TypeError("benchmark scenario did not return a string");
  }
  return checksumString(result);
}

function checksumJsonResult(result: unknown): number {
  const serialized = JSON.stringify(result);
  if (serialized === undefined) {
    throw new TypeError("benchmark scenario result is not JSON serializable");
  }
  return checksumString(serialized);
}

function combineChecksums(current: number, next: number): number {
  return Math.imul(current ^ next, 16_777_619) >>> 0;
}

function assertOutlineTransportContract(report: BenchmarkReport): void {
  const outlineScenario = report.scenarios.find(
    (scenario) => scenario.name === "renderToTextOutlines:outline-heavy",
  );
  const expected: BenchmarkTransportCounts = {
    wasmCalls: 2,
    fullIrInputs: 1,
    fullIrOutputs: 2,
  };
  if (JSON.stringify(outlineScenario?.transport) !== JSON.stringify(expected)) {
    throw new TypeError(
      `outline-heavy transport counts changed: ${JSON.stringify(outlineScenario?.transport)}`,
    );
  }
}

function measureScenario(
  scenario: TimedScenario,
  config: BenchmarkConfig,
): BenchmarkScenarioResult {
  for (let warmupIndex = 0; warmupIndex < config.warmupIterations; warmupIndex += 1) {
    const warmupResult = scenario.run();
    scenario.checksum(warmupResult);
  }

  const samplesMs: number[] = [];
  let checksum = 0;
  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    const startTime = performance.now();
    const result = scenario.run();
    samplesMs.push(performance.now() - startTime);
    checksum = combineChecksums(checksum, scenario.checksum(result));
  }

  const totalMs = samplesMs.reduce((sum, sampleMs) => sum + sampleMs, 0);
  return {
    name: scenario.name,
    iterations: config.iterations,
    operationsPerIteration: scenario.operationsPerIteration,
    samplesMs,
    totalMs,
    meanMs: totalMs / samplesMs.length,
    minMs: Math.min(...samplesMs),
    maxMs: Math.max(...samplesMs),
    checksum,
    ...(scenario.transportCounts ? { transport: scenario.transportCounts() } : {}),
  };
}

function createScenarios(
  engine: Engine,
  outlineEngine: Engine,
  outlineTransportCounts: BenchmarkTransportCounts,
  fixtureScene: VNode,
  rasterOutlineHeavyScene: VNode,
  outlineHeavyScene: VNode,
  config: BenchmarkConfig,
): TimedScenario[] {
  return [
    {
      name: "renderToSvg",
      operationsPerIteration: 1,
      run: () => engine.renderToSvg(fixtureScene),
      checksum: checksumStringResult,
    },
    {
      name: "renderToPng",
      operationsPerIteration: 1,
      run: () => engine.renderToPng(fixtureScene),
      checksum: checksumByteResult,
    },
    {
      name: "renderToPng:outline-heavy",
      operationsPerIteration: 1,
      run: () => engine.renderToPng(rasterOutlineHeavyScene),
      checksum: checksumByteResult,
    },
    {
      name: "compile+renderCompiledToSvg",
      operationsPerIteration: config.compiledRenderCount + 1,
      run: () => {
        const compiled = engine.compile(fixtureScene);
        let renderedSvg = "";
        for (let renderIndex = 0; renderIndex < config.compiledRenderCount; renderIndex += 1) {
          renderedSvg = engine.renderCompiledToSvg(compiled);
        }
        return renderedSvg;
      },
      checksum: checksumStringResult,
    },
    {
      name: "renderToTextOutlines:outline-heavy",
      operationsPerIteration: 1,
      run: () => {
        outlineTransportCounts.wasmCalls = 0;
        outlineTransportCounts.fullIrInputs = 0;
        outlineTransportCounts.fullIrOutputs = 0;
        return outlineEngine.renderToTextOutlines(outlineHeavyScene, { textPathMode: "glyphs" });
      },
      checksum: checksumJsonResult,
      transportCounts: () => ({ ...outlineTransportCounts }),
    },
    {
      name: "measureTextBlock",
      operationsPerIteration: config.measurementCount,
      run: () => {
        const measure = () =>
          engine.measureTextBlock({
            text: "宣言的なレイアウトを再現可能な画像へ変換します。".repeat(3),
            fontFamily: "NotoSansJP",
            fontSizePx: 22,
            lineHeight: 1.4,
            language: "ja",
            wrap: "word",
            maxWidth: 420,
          });
        let measurement = measure();
        for (
          let measurementIndex = 1;
          measurementIndex < config.measurementCount;
          measurementIndex += 1
        ) {
          measurement = measure();
        }
        return measurement;
      },
      checksum: checksumJsonResult,
    },
  ];
}

async function runBenchmark(options: CliOptions): Promise<BenchmarkReport> {
  const fontData = new Uint8Array(await readFile(FONT_PATH));
  const engine = await createEngineAsync({
    fonts: [
      {
        alias: "NotoSansJP",
        weight: 400,
        style: "normal",
        data: fontData,
      },
    ],
  });
  const outlineHandle = createWasmEngineInstance();
  const outlineTransportCounts: BenchmarkTransportCounts = {
    wasmCalls: 0,
    fullIrInputs: 0,
    fullIrOutputs: 0,
  };
  const outlineEngine = new Engine({
    computeLayoutFn: outlineHandle.createComputeLayoutFn(),
    renderToIrFn: (inputJson, optionsJson) => {
      outlineTransportCounts.wasmCalls += 1;
      outlineTransportCounts.fullIrOutputs += 1;
      return outlineHandle.renderToIr(inputJson, optionsJson);
    },
    resolveIrFn: (irJson, optionsJson) => {
      outlineTransportCounts.wasmCalls += 1;
      outlineTransportCounts.fullIrInputs += 1;
      outlineTransportCounts.fullIrOutputs += 1;
      return outlineHandle.resolveIr(irJson, optionsJson);
    },
    registerFontFn: (font) =>
      outlineHandle.registerFont(font.data, {
        alias: font.alias,
        weight: font.weight,
        style: font.style,
      }),
    wasmHandle: outlineHandle,
  });
  outlineEngine.registerFonts([
    { alias: "NotoSansJP", weight: 400, style: "normal", data: fontData },
  ]);

  try {
    const fixtureScene = buildFixtureScene();
    const rasterOutlineHeavyScene = buildRasterOutlineHeavyScene();
    const outlineHeavyScene = buildOutlineHeavyScene();
    const scenarios = createScenarios(
      engine,
      outlineEngine,
      outlineTransportCounts,
      fixtureScene,
      rasterOutlineHeavyScene,
      outlineHeavyScene,
      options.config,
    );
    const report: BenchmarkReport = {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      fixture: {
        font: FONT_RELATIVE_PATH,
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
      },
      config: options.config,
      scenarios: scenarios.map((scenario) => measureScenario(scenario, options.config)),
    };
    assertBenchmarkReport(report);
    assertOutlineTransportContract(report);
    return report;
  } finally {
    outlineEngine.dispose();
    engine.dispose();
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const report = await runBenchmark(options);
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  const roundTrippedReport: unknown = JSON.parse(serializedReport);
  assertBenchmarkReport(roundTrippedReport);

  if (options.smoke) {
    if (report.config.iterations !== 1) {
      throw new TypeError("smoke benchmark must use exactly one measured iteration");
    }
    if (report.scenarios.some((scenario) => scenario.checksum === 0)) {
      throw new TypeError("smoke benchmark produced an empty checksum");
    }
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, serializedReport, "utf8");
  for (const scenario of report.scenarios) {
    console.log(
      `${scenario.name}: ${scenario.meanMs.toFixed(3)} ms/iteration (${scenario.operationsPerIteration} operation(s))`,
    );
  }
  console.log(`report: ${options.outputPath}`);
}

await main();
