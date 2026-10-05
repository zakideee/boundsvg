/** Exercise real web WASM, Worker transport and caller-owned OPFS output. */
import {
  createAnimatedRasterFileSink,
  createAnimatedRasterSpool,
  loadWasmModule,
} from "@boundsvg/browser";
import {
  type AnimatedRasterWriteResult,
  type AnimatedWebpSink,
  createAnimatedWebpSpoolSink,
  createElement,
  createEngineAsync,
  toSceneDocument,
} from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";
import { WorkerEngine } from "@boundsvg/worker";

/** Fixed scene lengths and storage routes shared with the browser measurement spec. */
type RasterFixture = {
  format: "webp" | "gif";
  frameCount: 60 | 326 | 1001;
  route: "core-file" | "worker-forward";
};

/** Completed storage observation; chunk counters exclude the verification read. */
type RasterObservation = AnimatedRasterWriteResult & {
  elapsedMs: number;
  storedBytes: number;
  sha256: string;
  maximumChunk: number;
  maximumPendingWrites: number;
  writes: number;
  patches: number;
  finishCalls: number;
  temporaryEntriesAfter: number;
  isRiffSizeCorrect: boolean;
  isGifTrailerCorrect: boolean;
};

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: browser harness uses Window augmentation
  interface Window {
    boundsvgAnimatedRaster?: { render(input: RasterFixture): Promise<RasterObservation> };
  }
}

/** Open each fixture independently, preserving file/spool cleanup ownership. */
async function render(input: RasterFixture): Promise<RasterObservation> {
  const root = await navigator.storage.getDirectory();
  const directoryName = `raster-fixture-${crypto.randomUUID()}`;
  const directory = await root.getDirectoryHandle(directoryName, { create: true });
  const file = await directory.getFileHandle("output", { create: true });
  const fileSink = await createAnimatedRasterFileSink(file);
  const engine = await createEngineAsync({});
  let worker: Worker | undefined;
  let workerEngine: WorkerEngine | undefined;
  let spool: Awaited<ReturnType<typeof createAnimatedRasterSpool>> | undefined;
  let maximumChunk = 0;
  let maximumPendingWrites = 0;
  let pendingWrites = 0;
  let writes = 0;
  let patches = 0;
  let finishCalls = 0;
  const tracked: AnimatedWebpSink = {
    async write(chunk) {
      writes += 1;
      maximumChunk = Math.max(maximumChunk, chunk.length);
      pendingWrites += 1;
      maximumPendingWrites = Math.max(maximumPendingWrites, pendingWrites);
      try {
        if (input.route === "worker-forward") {
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
        }
        await fileSink.write(chunk);
      } finally {
        pendingWrites -= 1;
      }
    },
    async patch(offset, chunk) {
      patches += 1;
      await fileSink.patch(offset, chunk);
    },
    async finish() {
      finishCalls += 1;
      await fileSink.finish();
    },
    abort: (reason) => fileSink.abort(reason),
  };
  const scene = createElement("Canvas", { width: 8, height: 8, background: "#e32" });
  const options = { durationMs: input.frameCount * 50, fps: 20, iterations: 1 };
  try {
    let destination = tracked;
    if (input.route === "worker-forward") {
      worker = new Worker(new URL("@boundsvg/worker/worker", import.meta.url), { type: "module" });
      workerEngine = await WorkerEngine.create({ worker, fonts: [], timeout: 30_000 });
      if (input.format === "webp") {
        spool = await createAnimatedRasterSpool(directory);
        destination = createAnimatedWebpSpoolSink(spool, tracked);
      }
    }
    const started = performance.now();
    const result = workerEngine
      ? input.format === "webp"
        ? await workerEngine.renderToAnimatedWebp(toSceneDocument(scene), options, destination)
        : await workerEngine.renderToAnimatedGif(toSceneDocument(scene), options, destination)
      : input.format === "webp"
        ? await engine.renderToAnimatedWebp(scene, options, destination)
        : await engine.renderToAnimatedGif(scene, options, destination);
    const elapsedMs = performance.now() - started;
    if (workerEngine) {
      await workerEngine.drain();
    }
    const completed = await file.getFile();
    const bytes = new Uint8Array(await completed.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const names: string[] = [];
    const entries = Reflect.get(directory, "keys") as () => AsyncIterableIterator<string>;
    for await (const name of entries.call(directory)) {
      names.push(name);
    }
    await fileSink.abort("cleanup after completed output");
    const preserved = await file.getFile();
    if (preserved.size !== completed.size) {
      throw new Error("Completed file changed during late abort");
    }
    return {
      ...result,
      elapsedMs,
      storedBytes: completed.size,
      sha256,
      maximumChunk,
      maximumPendingWrites,
      writes,
      patches,
      finishCalls,
      temporaryEntriesAfter: names.filter((name) => name !== "output").length,
      isRiffSizeCorrect:
        input.format === "gif" ||
        new DataView(bytes.buffer).getUint32(4, true) === bytes.length - 8,
      isGifTrailerCorrect: input.format === "webp" || bytes.at(-1) === 0x3b,
    };
  } finally {
    await spool?.dispose();
    await fileSink.abort("fixture cleanup");
    workerEngine?.dispose();
    worker?.terminate();
    engine.dispose();
    await root.removeEntry(directoryName, { recursive: true });
  }
}

/** Expose only the renderer once the actual browser WASM is initialized. */
async function main(): Promise<void> {
  const status = document.getElementById("status");
  const error = document.getElementById("error");
  try {
    await initWasm(await loadWasmModule());
    window.boundsvgAnimatedRaster = { render };
    if (status) {
      status.textContent = "ready";
    }
  } catch (cause) {
    if (error) {
      error.textContent = String(cause);
    }
    if (status) {
      status.textContent = "failed";
    }
  }
}

void main();
