import type { Frame, LayoutTransitionInput, SceneNode } from "@boundsvg/core";
import { encodePngFramesToMp4 } from "@boundsvg/video";
import {
  MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES,
  WorkerEngine,
  type WorkerLayoutTransitionInput,
  WorkerPool,
} from "@boundsvg/worker";
import { createPortableLayoutTransitionInput } from "../src/layout-transition-fixture.js";

const FONT_URL = new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url);
const CHECKPOINT_TIMES_MS = [0, 300, 700, 1_000] as const;
const CHECKPOINT_DURATIONS_MS = [300, 400, 300, 100] as const;
const MP4_TIMES_MS = Array.from({ length: 11 }, (_, index) => index * 100);

type BrowserScenario =
  | { kind: "animated-webp" }
  | { kind: "animated-gif" }
  | { kind: "pool-compile-svg"; workerCount: 1 | 2 | 4 }
  | { kind: "pool-png"; workerCount: 1 | 2 | 4 }
  | { kind: "pool-mp4"; workerCount: 2 };

type BrowserScenarioResult = {
  scenario: BrowserScenario;
  wallMs: number;
  outputBytes: number;
  checksumSha256: string;
  transitionPayloadBytes: number;
  transitionPayloadCapBytes: number;
  transitionPayloadCapRatio: number;
  activeWorkers: number;
  frameCount: number;
  wasmLinearMemoryBytes: null;
  wasmMemoryAvailability: "worker-owned-memory-not-exposed-to-main-realm";
  jsHeapUsedBytes: number | null;
};

declare global {
  var runBoundsvgLayoutTransitionBenchmarkScenario:
    | ((scenario: BrowserScenario) => Promise<BrowserScenarioResult>)
    | undefined;
  var boundsvgLayoutTransitionBenchmarkReady: boolean | undefined;
}

function toWorkerInput(input: LayoutTransitionInput): WorkerLayoutTransitionInput {
  const reference = input.states.A;
  const target = input.states.B;
  if (!reference || !target || typeof reference === "function" || typeof target === "function") {
    throw new TypeError("Browser benchmark requires concrete A/B SceneNodes");
  }
  if (!("type" in reference) || !("type" in target)) {
    throw new TypeError("Browser benchmark requires flattened SceneNode states");
  }
  return {
    states: { A: reference as SceneNode, B: target as SceneNode },
    checkpoints: [...input.checkpoints],
  };
}

async function digestBytes(chunks: readonly Uint8Array[]): Promise<string> {
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function loadFontBytes(): Promise<ArrayBuffer> {
  const response = await fetch(FONT_URL);
  if (!response.ok) {
    throw new TypeError(`Font request failed: ${response.status}`);
  }
  return response.arrayBuffer();
}

function fontTransfer(fontBytes: ArrayBuffer) {
  return [
    {
      alias: "NotoSansJP",
      weight: 400,
      style: "normal" as const,
      data: fontBytes.slice(0),
    },
  ];
}

function workerFactory(): Worker {
  return new Worker(new URL("@boundsvg/worker/worker", import.meta.url), { type: "module" });
}

async function collectFrames(frames: AsyncIterable<Frame>): Promise<Frame[]> {
  const collected: Frame[] = [];
  for await (const frame of frames) {
    collected.push(frame);
  }
  return collected;
}

function frameChunks(frames: readonly Frame[]): Uint8Array[] {
  return frames.map((frame) =>
    typeof frame.data === "string" ? encodeText(frame.data) : frame.data,
  );
}

async function* pngFrameSource(frames: AsyncIterable<Frame>) {
  for await (const frame of frames) {
    if (frame.format !== "png" || !(frame.data instanceof Uint8Array)) {
      throw new TypeError("MP4 worker producer returned a non-PNG frame");
    }
    yield { data: frame.data, timeMs: frame.timeMs };
  }
}

function jsHeapUsedBytes(): number | null {
  const memory = Reflect.get(performance as object, "memory");
  if (typeof memory !== "object" || memory === null) {
    return null;
  }
  const used = Reflect.get(memory, "usedJSHeapSize");
  return typeof used === "number" ? used : null;
}

async function runScenario(scenario: BrowserScenario): Promise<BrowserScenarioResult> {
  const transition = toWorkerInput(createPortableLayoutTransitionInput());
  const transitionPayloadBytes = encodeText(JSON.stringify(transition)).byteLength;
  const fontBytes = await loadFontBytes();
  let outputChunks: Uint8Array[] = [];
  let frameCount = 0;
  const activeWorkers = "workerCount" in scenario ? scenario.workerCount : 1;
  const startTime = performance.now();

  if (scenario.kind === "animated-webp" || scenario.kind === "animated-gif") {
    const worker = workerFactory();
    const engine = await WorkerEngine.create({
      worker,
      fonts: fontTransfer(fontBytes),
      timeout: 120_000,
    });
    try {
      const options = {
        timesMs: [...CHECKPOINT_TIMES_MS],
        frameDurationsMs: [...CHECKPOINT_DURATIONS_MS],
        iterations: 2,
      };
      const bytes =
        scenario.kind === "animated-webp"
          ? await engine.renderLayoutTransitionToAnimatedWebp(transition, options)
          : await engine.renderLayoutTransitionToAnimatedGif(transition, options);
      outputChunks = [bytes];
      frameCount = CHECKPOINT_TIMES_MS.length;
    } finally {
      engine.dispose();
      worker.terminate();
    }
  } else {
    const pool = await WorkerPool.create({
      worker: workerFactory,
      concurrency: scenario.workerCount,
      fonts: fontTransfer(fontBytes),
      timeout: 120_000,
    });
    try {
      if (scenario.kind === "pool-compile-svg") {
        const timesMs = Array.from({ length: scenario.workerCount }, (_, index) => index);
        const frames = await collectFrames(
          pool.renderLayoutTransitionFrames(transition, { timesMs, format: "svg" }),
        );
        outputChunks = frameChunks(frames);
        frameCount = frames.length;
      } else if (scenario.kind === "pool-png") {
        const frames = await collectFrames(
          pool.renderLayoutTransitionFrames(transition, {
            timesMs: MP4_TIMES_MS,
            format: "png",
            rasterBackground: "#0b1020",
          }),
        );
        outputChunks = frameChunks(frames);
        frameCount = frames.length;
      } else {
        const bytes = await encodePngFramesToMp4(
          pngFrameSource(
            pool.renderLayoutTransitionFrames(transition, {
              timesMs: MP4_TIMES_MS,
              format: "png",
              rasterBackground: "#0b1020",
            }),
          ),
          {
            frameRate: 10,
            frameCount: MP4_TIMES_MS.length,
            background: "#0b1020",
          },
        );
        outputChunks = [bytes];
        frameCount = MP4_TIMES_MS.length;
      }
    } finally {
      pool.dispose();
    }
  }

  const wallMs = performance.now() - startTime;
  const outputBytes = outputChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  return {
    scenario,
    wallMs,
    outputBytes,
    checksumSha256: await digestBytes(outputChunks),
    transitionPayloadBytes,
    transitionPayloadCapBytes: MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES,
    transitionPayloadCapRatio: transitionPayloadBytes / MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES,
    activeWorkers,
    frameCount,
    wasmLinearMemoryBytes: null,
    wasmMemoryAvailability: "worker-owned-memory-not-exposed-to-main-realm",
    jsHeapUsedBytes: jsHeapUsedBytes(),
  };
}

globalThis.runBoundsvgLayoutTransitionBenchmarkScenario = runScenario;
globalThis.boundsvgLayoutTransitionBenchmarkReady = true;
const status = document.querySelector("#status");
if (status) {
  status.textContent = "ready";
}
