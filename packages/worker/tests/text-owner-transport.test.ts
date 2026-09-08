import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { textLayoutRawSuccessFixtures } from "../../core/tests/wasm/text-layout-success-fixtures.js";
import { textOwnerResultFixtures } from "../../core/tests/wasm/text-owner-result-fixtures.js";
import { WorkerEngine, type WorkerLike } from "../src/worker-engine.js";

vi.mock("@boundsvg/browser/wasm", () => ({
  loadWasmModule: async () => {
    const require = createRequire(import.meta.url);
    return require(resolve(__dirname, "../../core/wasm-pkg/boundsvg.js")) as unknown;
  },
}));

describe("real text results through WorkerEngine and worker dispatch", () => {
  let engine: WorkerEngine;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const scope = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(message: unknown) {
      const event = new MessageEvent("message", { data: structuredClone(message) });
      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
  };

  beforeAll(async () => {
    vi.stubGlobal("self", scope);
    await import("../src/worker-script.js");
    // Keep the real dispatch and both structured-clone boundaries; only scheduling is local.
    const worker: WorkerLike = {
      postMessage(message: unknown) {
        const cloned = structuredClone(message);
        queueMicrotask(() => scope.onmessage?.(new MessageEvent("message", { data: cloned })));
      },
      addEventListener(type, listener) {
        if (type === "message") {
          listeners.add(listener);
        }
      },
      removeEventListener(type, listener) {
        if (type === "message") {
          listeners.delete(listener);
        }
      },
      terminate() {},
    };
    const fontBytes = new Uint8Array(
      readFileSync(resolve(__dirname, "../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf")),
    );
    engine = await WorkerEngine.create({
      worker,
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: fontBytes.buffer }],
    });
  });
  afterAll(async () => {
    engine.dispose();
    await new Promise<void>((resolveDisposed) => queueMicrotask(resolveDisposed));
    vi.unstubAllGlobals();
  });

  for (const fixture of [...textLayoutRawSuccessFixtures, ...textOwnerResultFixtures]) {
    it(`${fixture.operation}: ${fixture.inputJson}`, async () => {
      const invoke = engine[fixture.operation] as (input: unknown) => Promise<unknown>;
      await expect(invoke.call(engine, JSON.parse(fixture.inputJson))).resolves.toEqual(
        JSON.parse(fixture.expectedOutputJson),
      );
    });
  }
});
