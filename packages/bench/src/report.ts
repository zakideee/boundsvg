export const BENCHMARK_SCHEMA_VERSION = 3 as const;

export const BENCHMARK_SCENARIO_NAMES = [
  "renderToSvg",
  "renderToPng",
  "renderToPng:outline-heavy",
  "compile+renderCompiledToSvg",
  "renderToTextOutlines:outline-heavy",
  "measureTextBlock",
] as const;

export type BenchmarkScenarioName = (typeof BENCHMARK_SCENARIO_NAMES)[number];

export type BenchmarkConfig = {
  iterations: number;
  warmupIterations: number;
  compiledRenderCount: number;
  measurementCount: number;
};

export type BenchmarkTransportCounts = {
  wasmCalls: number;
  fullIrInputs: number;
  fullIrOutputs: number;
};

export type BenchmarkScenarioResult = {
  name: BenchmarkScenarioName;
  iterations: number;
  operationsPerIteration: number;
  samplesMs: number[];
  totalMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  checksum: number;
  transport?: BenchmarkTransportCounts;
};

export type BenchmarkReport = {
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  generatedAt: string;
  runtime: {
    node: string;
    platform: string;
    arch: string;
  };
  fixture: {
    font: string;
    canvasWidth: number;
    canvasHeight: number;
  };
  config: BenchmarkConfig;
  scenarios: BenchmarkScenarioResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, path: string, minimum = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new TypeError(`${path} must be a finite number >= ${minimum}`);
  }
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  assertFiniteNumber(value, path, 1);
  if (!Number.isInteger(value)) {
    throw new TypeError(`${path} must be an integer`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
}

function isScenarioName(value: unknown): value is BenchmarkScenarioName {
  return BENCHMARK_SCENARIO_NAMES.some((scenarioName) => scenarioName === value);
}

function assertScenario(
  scenario: unknown,
  scenarioIndex: number,
  observedNames: Set<BenchmarkScenarioName>,
): void {
  const path = `scenarios[${scenarioIndex}]`;
  if (!isRecord(scenario)) {
    throw new TypeError(`${path} must be an object`);
  }
  if (!isScenarioName(scenario.name)) {
    throw new TypeError(`${path}.name is not a known scenario`);
  }
  if (observedNames.has(scenario.name)) {
    throw new TypeError(`${path}.name is duplicated`);
  }
  observedNames.add(scenario.name);
  assertPositiveInteger(scenario.iterations, `${path}.iterations`);
  assertPositiveInteger(scenario.operationsPerIteration, `${path}.operationsPerIteration`);
  assertFiniteNumber(scenario.totalMs, `${path}.totalMs`);
  assertFiniteNumber(scenario.meanMs, `${path}.meanMs`);
  assertFiniteNumber(scenario.minMs, `${path}.minMs`);
  assertFiniteNumber(scenario.maxMs, `${path}.maxMs`);
  assertFiniteNumber(scenario.checksum, `${path}.checksum`);
  if (!Number.isInteger(scenario.checksum)) {
    throw new TypeError(`${path}.checksum must be an integer`);
  }
  if (scenario.transport !== undefined) {
    if (!isRecord(scenario.transport)) {
      throw new TypeError(`${path}.transport must be an object`);
    }
    for (const field of ["wasmCalls", "fullIrInputs", "fullIrOutputs"] as const) {
      assertFiniteNumber(scenario.transport[field], `${path}.transport.${field}`);
      if (!Number.isInteger(scenario.transport[field])) {
        throw new TypeError(`${path}.transport.${field} must be an integer`);
      }
    }
  }
  if (!Array.isArray(scenario.samplesMs) || scenario.samplesMs.length !== scenario.iterations) {
    throw new TypeError(`${path}.samplesMs must contain one entry per iteration`);
  }
  for (const [sampleIndex, sampleMs] of scenario.samplesMs.entries()) {
    assertFiniteNumber(sampleMs, `${path}.samplesMs[${sampleIndex}]`);
  }
}

/** Validate the persisted wire format independently of TypeScript's static types. */
export function assertBenchmarkReport(value: unknown): asserts value is BenchmarkReport {
  if (!isRecord(value)) {
    throw new TypeError("benchmark report must be an object");
  }
  if (value.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
    throw new TypeError(`benchmark report schemaVersion must be ${BENCHMARK_SCHEMA_VERSION}`);
  }
  assertString(value.generatedAt, "generatedAt");

  if (!isRecord(value.runtime)) {
    throw new TypeError("runtime must be an object");
  }
  assertString(value.runtime.node, "runtime.node");
  assertString(value.runtime.platform, "runtime.platform");
  assertString(value.runtime.arch, "runtime.arch");

  if (!isRecord(value.fixture)) {
    throw new TypeError("fixture must be an object");
  }
  assertString(value.fixture.font, "fixture.font");
  assertPositiveInteger(value.fixture.canvasWidth, "fixture.canvasWidth");
  assertPositiveInteger(value.fixture.canvasHeight, "fixture.canvasHeight");

  if (!isRecord(value.config)) {
    throw new TypeError("config must be an object");
  }
  assertPositiveInteger(value.config.iterations, "config.iterations");
  assertPositiveInteger(value.config.warmupIterations, "config.warmupIterations");
  assertPositiveInteger(value.config.compiledRenderCount, "config.compiledRenderCount");
  assertPositiveInteger(value.config.measurementCount, "config.measurementCount");

  if (!Array.isArray(value.scenarios)) {
    throw new TypeError("scenarios must be an array");
  }
  if (value.scenarios.length !== BENCHMARK_SCENARIO_NAMES.length) {
    throw new TypeError(`scenarios must contain ${BENCHMARK_SCENARIO_NAMES.length} entries`);
  }

  const observedNames = new Set<BenchmarkScenarioName>();
  for (const [scenarioIndex, scenario] of value.scenarios.entries()) {
    assertScenario(scenario, scenarioIndex, observedNames);
  }
}
