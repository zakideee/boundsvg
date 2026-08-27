import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CompiledScene,
  createEngineAsync,
  type Engine,
  type Frame,
  type IR,
  type IRNode,
  type LayoutTransitionInput,
  type SceneNode,
} from "@boundsvg/core";
import { createWasmEngineInstance } from "@boundsvg/core/wasm";
import {
  collectSceneNodeDepths,
  createFlatFanOutTransition,
  createNestedFanOutTransition,
  createPortableLayoutTransitionInput,
  createPortableLayoutTransitionState,
  FAN_OUT_SAMPLE_TIMES_MS,
  FLAT_FAN_OUT_COUNTS,
  LAYOUT_TRANSITION_CHECKPOINTS,
  NEAR_IDENTITY_DELTA_PX,
  NESTED_FAN_OUT_COUNTS,
  PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS,
} from "./layout-transition-fixture.js";

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(PACKAGE_DIRECTORY, "../..");
const FONT_RELATIVE_PATH = "fixtures/fonts/NotoSansJP-Regular.subset.ttf";
const DEFAULT_OUTPUT_PATH = resolve(
  REPOSITORY_ROOT,
  "_build/bench/layout-transition/node-main.json",
);
const GENERATED_WRAPPER_PROVENANCE = "layout-transition-wrapper";
const NEAR_IDENTITY_THRESHOLD = 0.001;

type Profile = "official" | "smoke";

type CliOptions = {
  outputPath: string;
  profile: Profile;
};

type MemorySnapshot = {
  arrayBuffersBytes: number;
  externalBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  rssBytes: number;
  wasmLinearMemoryBytes: number | null;
};

type TimedSample = {
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  checksum: string;
  outputBytes: number;
  memoryBefore: MemorySnapshot;
  memoryAfter: MemorySnapshot;
};

type Aggregate = {
  count: number;
  meanMs: number;
  sampleStandardDeviationMs: number;
  coefficientOfVariation: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

type TimedScenario = {
  iterations: number;
  name: string;
  run: () => unknown;
  summarize: (result: unknown) => { checksum: string; outputBytes: number };
  warmupIterations: number;
};

type ScenarioReport = {
  name: string;
  warmupIterations: number;
  iterations: number;
  samples: TimedSample[];
  aggregate: Aggregate;
};

type WrapperMetrics = {
  generatedWrapperCount: number;
  nearIdentityWrapperCount: number;
  wrapperCountBySourceDepth: Record<string, number>;
};

type SizeMetrics = WrapperMetrics & {
  compiledIrJsonBytes: number;
  declarativeSvgBytes: number;
  sampledPngBytes: number;
  sampledSvgBytes: number;
  sourceTransitionJsonBytes: number;
};

type BBox = { x: number; y: number; width: number; height: number };
type AffineMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type RawAnimationStateSample = { nodeId: string; transform?: AffineMatrix };

type ErrorMetrics = {
  endpointMaxErrorPx: number;
  holdMaxErrorPx: number;
  midFlightErrorsPx: number[];
  midFlightMaxErrorPx: number;
  midFlightP95ErrorPx: number;
};

type FanOutMetrics = {
  topology: "flat" | "nested";
  nodeCount: number;
  regular: SizeMetrics;
  nearIdentity: SizeMetrics;
  errors?: ErrorMetrics;
};

type LayoutTransitionBenchmarkReport = {
  schemaVersion: 1;
  generatedAt: string;
  profile: Profile;
  repository: {
    head: string;
    branch: string;
    runtimeDirtyPaths: string[];
    harnessDigestSha256: string;
  };
  runtime: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
    wasmNodeArtifact: { bytes: number; sha256: string };
  };
  fixture: {
    font: string;
    checkpoints: typeof LAYOUT_TRANSITION_CHECKPOINTS;
    fanOutSampleTimesMs: number[];
    nearIdentityDeltaPx: number;
    nearIdentityThreshold: number;
  };
  scenarios: ScenarioReport[];
  portable: SizeMetrics & ErrorMetrics;
  fanOut: FanOutMetrics[];
};

function parseCliOptions(arguments_: readonly string[]): CliOptions {
  let outputPath = DEFAULT_OUTPUT_PATH;
  let profile: Profile = "official";
  for (let argumentIndex = 0; argumentIndex < arguments_.length; argumentIndex += 1) {
    const argument = arguments_[argumentIndex];
    if (argument === "--") {
      continue;
    }
    if (argument === "--output") {
      const value = arguments_[argumentIndex + 1];
      if (!value) {
        throw new TypeError("--output requires a path");
      }
      outputPath = resolve(process.cwd(), value);
      argumentIndex += 1;
      continue;
    }
    if (argument === "--profile") {
      const value = arguments_[argumentIndex + 1];
      if (value !== "official" && value !== "smoke") {
        throw new TypeError("--profile must be official or smoke");
      }
      profile = value;
      argumentIndex += 1;
      continue;
    }
    throw new TypeError(`Unknown benchmark argument: ${argument}`);
  }
  return { outputPath, profile };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function checksumBytes(bytes: Uint8Array): string {
  return sha256(bytes);
}

function checksumString(value: string): string {
  return sha256(value);
}

function wasmLinearMemoryBytes(): number | null {
  // wasm-pack's Node.js CJS wrapper does not expose its `WebAssembly.Memory`.
  // Browser reports collect it from the web target's `InitOutput`; do not
  // mislabel process external/ArrayBuffer memory as a WASM-only value here.
  return null;
}

function memorySnapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    arrayBuffersBytes: usage.arrayBuffers,
    externalBytes: usage.external,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
    wasmLinearMemoryBytes: wasmLinearMemoryBytes(),
  };
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) {
    throw new RangeError("percentile requires at least one value");
  }
  const index = Math.min(sortedValues.length - 1, Math.ceil(fraction * sortedValues.length) - 1);
  return sortedValues[index] ?? 0;
}

function aggregate(samples: readonly TimedSample[]): Aggregate {
  const values = samples.map((sample) => sample.wallMs);
  const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / (values.length - 1)
      : 0;
  const sortedValues = [...values].sort((left, right) => left - right);
  const sampleStandardDeviationMs = Math.sqrt(variance);
  return {
    count: values.length,
    meanMs,
    sampleStandardDeviationMs,
    coefficientOfVariation: meanMs === 0 ? 0 : sampleStandardDeviationMs / meanMs,
    minMs: sortedValues[0] ?? 0,
    p50Ms: percentile(sortedValues, 0.5),
    p95Ms: percentile(sortedValues, 0.95),
    maxMs: sortedValues.at(-1) ?? 0,
  };
}

function measureScenario(scenario: TimedScenario): ScenarioReport {
  for (let warmupIndex = 0; warmupIndex < scenario.warmupIterations; warmupIndex += 1) {
    const result = scenario.run();
    scenario.summarize(result);
  }

  const samples: TimedSample[] = [];
  for (let iteration = 0; iteration < scenario.iterations; iteration += 1) {
    const memoryBefore = memorySnapshot();
    const cpuStart = process.cpuUsage();
    const startTime = performance.now();
    const result = scenario.run();
    const wallMs = performance.now() - startTime;
    const cpu = process.cpuUsage(cpuStart);
    const memoryAfter = memorySnapshot();
    const summary = scenario.summarize(result);
    samples.push({
      wallMs,
      cpuUserMs: cpu.user / 1_000,
      cpuSystemMs: cpu.system / 1_000,
      checksum: summary.checksum,
      outputBytes: summary.outputBytes,
      memoryBefore,
      memoryAfter,
    });
  }
  return {
    name: scenario.name,
    warmupIterations: scenario.warmupIterations,
    iterations: scenario.iterations,
    samples,
    aggregate: aggregate(samples),
  };
}

function scenarioCounts(
  profile: Profile,
  scenarioClass: "normal" | "png" | "animated",
): { warmupIterations: number; iterations: number } {
  if (profile === "smoke") {
    return { warmupIterations: 1, iterations: 1 };
  }
  switch (scenarioClass) {
    case "normal":
      return { warmupIterations: 5, iterations: 20 };
    case "png":
      return { warmupIterations: 3, iterations: 10 };
    case "animated":
      return { warmupIterations: 2, iterations: 8 };
  }
}

function summarizeCompiled(result: unknown): { checksum: string; outputBytes: number } {
  const compiled = result as CompiledScene;
  const serialized = JSON.stringify(compiled.ir);
  return { checksum: checksumString(serialized), outputBytes: byteLength(serialized) };
}

function summarizeString(result: unknown): { checksum: string; outputBytes: number } {
  if (typeof result !== "string") {
    throw new TypeError("Expected string benchmark result");
  }
  return { checksum: checksumString(result), outputBytes: byteLength(result) };
}

function summarizeBytes(result: unknown): { checksum: string; outputBytes: number } {
  if (!(result instanceof Uint8Array)) {
    throw new TypeError("Expected byte benchmark result");
  }
  return { checksum: checksumBytes(result), outputBytes: result.byteLength };
}

function summarizeFrames(result: unknown): { checksum: string; outputBytes: number } {
  const frames = result as Frame[];
  let outputBytes = 0;
  const digest = createHash("sha256");
  for (const frame of frames) {
    digest.update(`${frame.index}:${frame.timeMs}:${frame.format}:`);
    if (typeof frame.data === "string") {
      outputBytes += byteLength(frame.data);
      digest.update(frame.data);
    } else {
      outputBytes += frame.data.byteLength;
      digest.update(frame.data);
    }
  }
  return { checksum: digest.digest("hex"), outputBytes };
}

function irChildren(node: IRNode): readonly IRNode[] {
  return node.type === "group" ? (node.children ?? []) : [];
}

function allIrNodes(root: IRNode): IRNode[] {
  const nodes: IRNode[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.shift();
    if (!node) {
      continue;
    }
    nodes.push(node);
    pending.unshift(...irChildren(node));
  }
  return nodes;
}

function maxTransformIdentityDeviation(node: IRNode): number {
  if (node.type !== "group" || !node.animation) {
    return 0;
  }
  let maximum = 0;
  for (const keyframe of node.animation.keyframes) {
    const transform = keyframe.transform;
    if (!transform) {
      continue;
    }
    maximum = Math.max(
      maximum,
      Math.abs(transform.translateX ?? 0),
      Math.abs(transform.translateY ?? 0),
      Math.abs((transform.scaleX ?? 1) - 1),
      Math.abs((transform.scaleY ?? 1) - 1),
    );
  }
  return maximum;
}

function wrapperMetrics(ir: IR, sourceDepths: ReadonlyMap<string, number>): WrapperMetrics {
  const wrappers = allIrNodes(ir.root).filter(
    (node) =>
      node.type === "group" && node.meta?.["boundsvg.generated"] === GENERATED_WRAPPER_PROVENANCE,
  );
  const wrapperCountBySourceDepth: Record<string, number> = {};
  let nearIdentityWrapperCount = 0;
  for (const wrapper of wrappers) {
    if (wrapper.type !== "group") {
      continue;
    }
    const sourceNodeId = wrapper.meta?.["boundsvg.sourceNodeId"];
    const depth = typeof sourceNodeId === "string" ? sourceDepths.get(sourceNodeId) : undefined;
    const depthKey = depth === undefined ? "unknown" : String(depth);
    wrapperCountBySourceDepth[depthKey] = (wrapperCountBySourceDepth[depthKey] ?? 0) + 1;
    const deviation = maxTransformIdentityDeviation(wrapper);
    if (deviation > 0 && deviation <= NEAR_IDENTITY_THRESHOLD) {
      nearIdentityWrapperCount += 1;
    }
  }
  return {
    generatedWrapperCount: wrappers.length,
    nearIdentityWrapperCount,
    wrapperCountBySourceDepth,
  };
}

function collectOutputMetrics(
  engine: Engine,
  input: LayoutTransitionInput,
  timesMs: readonly number[],
): SizeMetrics {
  const compiled = engine.compileLayoutTransition(input);
  const declarativeSvg = engine.renderCompiledToSvg(compiled);
  const svgFrames = [
    ...engine.renderCompiledFrames(compiled, { timesMs: [...timesMs], format: "svg" }),
  ];
  const pngFrames = [
    ...engine.renderCompiledFrames(compiled, { timesMs: [...timesMs], format: "png" }),
  ];
  const sourceDepths = collectSceneNodeDepths(input.states.A as SceneNode);
  return {
    ...wrapperMetrics(compiled.ir, sourceDepths),
    compiledIrJsonBytes: byteLength(JSON.stringify(compiled.ir)),
    declarativeSvgBytes: byteLength(declarativeSvg),
    sampledSvgBytes: summarizeFrames(svgFrames).outputBytes,
    sampledPngBytes: summarizeFrames(pngFrames).outputBytes,
    sourceTransitionJsonBytes: byteLength(JSON.stringify(input)),
  };
}

function findIrNode(root: IRNode, nodeId: string): IRNode {
  const node = allIrNodes(root).find((candidate) => candidate.nodeId === nodeId);
  if (!node) {
    throw new RangeError(`Missing IR node ${nodeId}`);
  }
  return node;
}

function identityMatrix(): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplyMatrices(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformPoint(matrix: AffineMatrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function sampleGeneratedBBoxes(ir: IR, timeMs: number): Map<string, BBox> {
  const handle = createWasmEngineInstance();
  try {
    const samples = JSON.parse(
      handle.sampleAnimationState(JSON.stringify(ir), timeMs),
    ) as RawAnimationStateSample[];
    const transforms = new Map(
      samples
        .filter((sample) => sample.nodeId.startsWith("__boundsvg:layout-transition-wrapper:"))
        .map((sample) => [sample.nodeId, sample.transform ?? identityMatrix()]),
    );
    const bboxes = new Map<string, BBox>();
    const walk = (node: IRNode, ancestorMatrix: AffineMatrix): void => {
      const worldMatrix = multiplyMatrices(
        ancestorMatrix,
        transforms.get(node.nodeId) ?? identityMatrix(),
      );
      const corners = [
        transformPoint(worldMatrix, node.bbox.x, node.bbox.y),
        transformPoint(worldMatrix, node.bbox.x + node.bbox.w, node.bbox.y),
        transformPoint(worldMatrix, node.bbox.x, node.bbox.y + node.bbox.h),
        transformPoint(worldMatrix, node.bbox.x + node.bbox.w, node.bbox.y + node.bbox.h),
      ];
      const xValues = corners.map((point) => point.x);
      const yValues = corners.map((point) => point.y);
      if (node.type === "group") {
        bboxes.set(node.nodeId, {
          x: Math.min(...xValues),
          y: Math.min(...yValues),
          width: Math.max(...xValues) - Math.min(...xValues),
          height: Math.max(...yValues) - Math.min(...yValues),
        });
      }
      for (const child of irChildren(node)) {
        walk(child, worldMatrix);
      }
    };
    walk(ir.root, identityMatrix());
    return bboxes;
  } finally {
    handle.dispose();
  }
}

function bboxFromIr(node: IRNode): BBox {
  return { x: node.bbox.x, y: node.bbox.y, width: node.bbox.w, height: node.bbox.h };
}

function bboxError(observed: BBox, expected: BBox): number {
  return Math.max(
    Math.abs(observed.x - expected.x),
    Math.abs(observed.y - expected.y),
    Math.abs(observed.width - expected.width),
    Math.abs(observed.height - expected.height),
  );
}

function midpointBBox(reference: BBox, target: BBox): BBox {
  return {
    x: (reference.x + target.x) / 2,
    y: (reference.y + target.y) / 2,
    width: (reference.width + target.width) / 2,
    height: (reference.height + target.height) / 2,
  };
}

function measureErrors(engine: Engine, input: LayoutTransitionInput): ErrorMetrics {
  const referenceInput = input.states.A as SceneNode;
  const targetInput = input.states.B as SceneNode;
  const reference = engine.compile(referenceInput);
  const target = engine.compile(targetInput);
  const transition = engine.compileLayoutTransition(input);
  const sourceNodeIds = [...collectSceneNodeDepths(referenceInput).keys()];
  let endpointMaxErrorPx = 0;
  let holdMaxErrorPx = 0;
  const midFlightErrorsPx: number[] = [];

  const checkpointExpectations = LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => ({
    timeMs: checkpoint.timeMs,
    expectedIr: checkpoint.state === "A" ? reference.ir : target.ir,
    isTargetCheckpoint: checkpoint.state === "B",
  }));
  for (const { timeMs, expectedIr, isTargetCheckpoint } of checkpointExpectations) {
    const sampled = sampleGeneratedBBoxes(transition.ir, timeMs);
    for (const nodeId of sourceNodeIds) {
      const observed = sampled.get(nodeId);
      if (!observed) {
        throw new RangeError(`Missing sampled bbox ${nodeId} at ${timeMs}`);
      }
      const error = bboxError(observed, bboxFromIr(findIrNode(expectedIr.root, nodeId)));
      endpointMaxErrorPx = Math.max(endpointMaxErrorPx, error);
      if (isTargetCheckpoint) {
        holdMaxErrorPx = Math.max(holdMaxErrorPx, error);
      }
    }
  }

  const midFlightTimesMs = LAYOUT_TRANSITION_CHECKPOINTS.slice(1).flatMap((checkpoint, index) => {
    const previous = LAYOUT_TRANSITION_CHECKPOINTS[index];
    return previous && previous.state !== checkpoint.state
      ? [(previous.timeMs + checkpoint.timeMs) / 2]
      : [];
  });
  for (const timeMs of midFlightTimesMs) {
    const sampled = sampleGeneratedBBoxes(transition.ir, timeMs);
    for (const nodeId of sourceNodeIds) {
      const observed = sampled.get(nodeId);
      if (!observed) {
        throw new RangeError(`Missing sampled flight bbox ${nodeId} at ${timeMs}`);
      }
      const ideal = midpointBBox(
        bboxFromIr(findIrNode(reference.ir.root, nodeId)),
        bboxFromIr(findIrNode(target.ir.root, nodeId)),
      );
      midFlightErrorsPx.push(bboxError(observed, ideal));
    }
  }
  const sortedFlightErrors = [...midFlightErrorsPx].sort((left, right) => left - right);
  return {
    endpointMaxErrorPx,
    holdMaxErrorPx,
    midFlightErrorsPx,
    midFlightMaxErrorPx: sortedFlightErrors.at(-1) ?? 0,
    midFlightP95ErrorPx: percentile(sortedFlightErrors, 0.95),
  };
}

function addPortableScenarios(scenarios: TimedScenario[], engine: Engine, profile: Profile): void {
  const input = createPortableLayoutTransitionInput();
  const compiled = engine.compileLayoutTransition(input);
  const timesMs = LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => checkpoint.timeMs);
  const normal = scenarioCounts(profile, "normal");
  const png = scenarioCounts(profile, "png");
  const animated = scenarioCounts(profile, "animated");
  scenarios.push(
    {
      name: "portable:ordinary-compile-A",
      run: () =>
        engine.compile(
          createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A),
        ),
      summarize: summarizeCompiled,
      ...normal,
    },
    {
      name: "portable:ordinary-compile-B",
      run: () =>
        engine.compile(
          createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B),
        ),
      summarize: summarizeCompiled,
      ...normal,
    },
    {
      name: "portable:transition-compile-inclusive",
      run: () => engine.compileLayoutTransition(input),
      summarize: summarizeCompiled,
      ...normal,
    },
    {
      name: "portable:declarative-svg",
      run: () => engine.renderCompiledToSvg(compiled),
      summarize: summarizeString,
      ...normal,
    },
    {
      name: "portable:compiled-svg-frames-4",
      run: () => [...engine.renderCompiledFrames(compiled, { timesMs, format: "svg" })],
      summarize: summarizeFrames,
      ...normal,
    },
    {
      name: "portable:compiled-png-frames-4",
      run: () => [...engine.renderCompiledFrames(compiled, { timesMs, format: "png" })],
      summarize: summarizeFrames,
      ...png,
    },
    {
      name: "portable:compiled-animated-webp-4",
      run: () =>
        engine.renderCompiledToAnimatedWebp(compiled, {
          timesMs,
          frameDurationsMs: [300, 400, 300, 100],
          iterations: 2,
        }),
      summarize: summarizeBytes,
      ...animated,
    },
    {
      name: "portable:compiled-animated-gif-4",
      run: () =>
        engine.renderCompiledToAnimatedGif(compiled, {
          timesMs,
          frameDurationsMs: [300, 400, 300, 100],
          iterations: 2,
        }),
      summarize: summarizeBytes,
      ...animated,
    },
  );
}

function addFanOutScenarios(
  scenarios: TimedScenario[],
  engine: Engine,
  profile: Profile,
  topology: "flat" | "nested",
  nodeCount: number,
  input: LayoutTransitionInput,
): void {
  const compiled = engine.compileLayoutTransition(input);
  const normal = scenarioCounts(profile, "normal");
  const png = scenarioCounts(profile, "png");
  scenarios.push(
    {
      name: `${topology}-${nodeCount}:transition-compile-inclusive`,
      run: () => engine.compileLayoutTransition(input),
      summarize: summarizeCompiled,
      ...normal,
    },
    {
      name: `${topology}-${nodeCount}:compiled-svg-frames-12`,
      run: () => [
        ...engine.renderCompiledFrames(compiled, {
          timesMs: FAN_OUT_SAMPLE_TIMES_MS,
          format: "svg",
        }),
      ],
      summarize: summarizeFrames,
      ...normal,
    },
    {
      name: `${topology}-${nodeCount}:compiled-png-frames-12`,
      run: () => [
        ...engine.renderCompiledFrames(compiled, {
          timesMs: FAN_OUT_SAMPLE_TIMES_MS,
          format: "png",
        }),
      ],
      summarize: summarizeFrames,
      ...png,
    },
  );
}

async function fileDigest(relativePaths: readonly string[]): Promise<string> {
  const digest = createHash("sha256");
  for (const relativePath of [...relativePaths].sort()) {
    digest.update(relativePath);
    digest.update(await readFile(resolve(REPOSITORY_ROOT, relativePath)));
  }
  return digest.digest("hex");
}

function gitOutput(arguments_: readonly string[]): string {
  return execFileSync("git", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
}

async function runBenchmark(options: CliOptions): Promise<LayoutTransitionBenchmarkReport> {
  const fontData = new Uint8Array(await readFile(resolve(REPOSITORY_ROOT, FONT_RELATIVE_PATH)));
  const engine = await createEngineAsync({
    fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: fontData }],
  });
  try {
    const scenarios: TimedScenario[] = [];
    addPortableScenarios(scenarios, engine, options.profile);
    for (const nodeCount of FLAT_FAN_OUT_COUNTS) {
      addFanOutScenarios(
        scenarios,
        engine,
        options.profile,
        "flat",
        nodeCount,
        createFlatFanOutTransition(nodeCount),
      );
    }
    for (const nodeCount of NESTED_FAN_OUT_COUNTS) {
      addFanOutScenarios(
        scenarios,
        engine,
        options.profile,
        "nested",
        nodeCount,
        createNestedFanOutTransition(nodeCount),
      );
    }

    const portableInput = createPortableLayoutTransitionInput();
    const portable = {
      ...collectOutputMetrics(
        engine,
        portableInput,
        LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => checkpoint.timeMs),
      ),
      ...measureErrors(engine, portableInput),
    };
    const fanOut: FanOutMetrics[] = [];
    for (const nodeCount of FLAT_FAN_OUT_COUNTS) {
      const regularInput = createFlatFanOutTransition(nodeCount);
      const nearIdentityInput = createFlatFanOutTransition(nodeCount, NEAR_IDENTITY_DELTA_PX);
      fanOut.push({
        topology: "flat",
        nodeCount,
        regular: collectOutputMetrics(engine, regularInput, FAN_OUT_SAMPLE_TIMES_MS),
        nearIdentity: collectOutputMetrics(engine, nearIdentityInput, FAN_OUT_SAMPLE_TIMES_MS),
      });
    }
    for (const nodeCount of NESTED_FAN_OUT_COUNTS) {
      const regularInput = createNestedFanOutTransition(nodeCount);
      const nearIdentityInput = createNestedFanOutTransition(nodeCount, NEAR_IDENTITY_DELTA_PX);
      fanOut.push({
        topology: "nested",
        nodeCount,
        regular: collectOutputMetrics(engine, regularInput, FAN_OUT_SAMPLE_TIMES_MS),
        nearIdentity: collectOutputMetrics(engine, nearIdentityInput, FAN_OUT_SAMPLE_TIMES_MS),
        errors: measureErrors(engine, regularInput),
      });
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
    return {
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
          "packages/bench/src/layout-transition.ts",
        ]),
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        wasmNodeArtifact: { bytes: wasmArtifact.byteLength, sha256: sha256(wasmArtifact) },
      },
      fixture: {
        font: FONT_RELATIVE_PATH,
        checkpoints: LAYOUT_TRANSITION_CHECKPOINTS,
        fanOutSampleTimesMs: FAN_OUT_SAMPLE_TIMES_MS,
        nearIdentityDeltaPx: NEAR_IDENTITY_DELTA_PX,
        nearIdentityThreshold: NEAR_IDENTITY_THRESHOLD,
      },
      scenarios: scenarios.map(measureScenario),
      portable,
      fanOut,
    };
  } finally {
    engine.dispose();
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const report = await runBenchmark(options);
  if (report.repository.runtimeDirtyPaths.length > 0) {
    throw new TypeError(
      `Runtime source is dirty: ${report.repository.runtimeDirtyPaths.join(", ")}`,
    );
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  JSON.parse(serialized);
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, serialized, "utf8");
  for (const scenario of report.scenarios) {
    console.log(
      `${scenario.name}: ${scenario.aggregate.meanMs.toFixed(3)} ms, n=${scenario.iterations}`,
    );
  }
  console.log(`report: ${options.outputPath}`);
}

await main();
