// @vitest-environment happy-dom
/** @jsxImportSource react */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWasmModule } from "@boundsvg/browser/wasm";
import {
  createEngineAsync,
  type Engine,
  type RenderAnimatedSvgOptions,
  type VNode,
} from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";
import { WorkerEngine, type WorkerRequest, type WorkerResponse } from "@boundsvg/worker";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  useRenderToAnimatedSvgAndIrAsync,
  useRenderToAnimatedSvgAsync,
  useRenderToLayeredPngAsync,
  useRenderToLayeredSvgAsync,
  useRenderToPngAsync,
  useRenderToSvgAndIrAsync,
  useRenderToSvgAsync,
} from "../src/async.js";
import { BoundSvgContext } from "../src/context.js";
import { MainRenderSchedulerContext } from "../src/execution/context.js";
import { MainRenderScheduler } from "../src/execution/main-render-scheduler.js";

type MessageListener = (event: MessageEvent | ErrorEvent) => void;

/** Run the shipped Worker dispatch and transfer boundaries with a preloaded web WASM module. */
class ScriptTransport {
  private readonly listeners = new Map<string, Set<MessageListener>>();
  readonly requests: WorkerRequest[] = [];
  readonly scope = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (response: WorkerResponse, transfer: Transferable[] = []) => {
      const message = structuredClone(response, { transfer });
      queueMicrotask(() => {
        for (const listener of this.listeners.get("message") ?? []) {
          listener({ data: message } as MessageEvent);
        }
      });
    },
  };

  postMessage(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.requests.push(structuredClone(request));
    const message = structuredClone(request, { transfer });
    queueMicrotask(() => this.scope.onmessage?.({ data: message } as MessageEvent));
  }

  addEventListener(type: string, listener: MessageListener): void {
    const callbacks = this.listeners.get(type) ?? new Set();
    callbacks.add(listener);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type: string, listener: MessageListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.scope.onmessage = null;
    this.listeners.clear();
  }
}

const vnode: VNode = {
  type: "Canvas",
  props: { width: 240, height: 80, background: "#ffffff" },
  children: [
    {
      type: "Text",
      props: { id: "label", font: "NotoSansJP", fontSizePx: 24, color: "#111111" },
      children: ["リアル WASM"],
    },
  ],
};
const animatedOptions: RenderAnimatedSvgOptions = { playback: { mode: "independent" } };

const operations = [
  {
    name: "SVG",
    request: "render-svg",
    useResult() {
      const result = useRenderToSvgAsync(vnode);
      return { state: result, value: result.svg };
    },
    direct(engine: Engine) {
      return engine.renderToSvg(vnode);
    },
  },
  {
    name: "Animated SVG",
    request: "render-animated-svg",
    useResult() {
      const result = useRenderToAnimatedSvgAsync(vnode, animatedOptions);
      return { state: result, value: result.svg };
    },
    direct(engine: Engine) {
      return engine.renderToAnimatedSvg(vnode, animatedOptions);
    },
  },
  {
    name: "SVG and IR",
    request: "render-svg-and-ir",
    useResult() {
      const result = useRenderToSvgAndIrAsync(vnode);
      return { state: result, value: { svg: result.svg, ir: result.ir } };
    },
    direct(engine: Engine) {
      return engine.renderToSvgAndIR(vnode);
    },
  },
  {
    name: "Animated SVG and IR",
    request: "render-animated-svg-and-ir",
    useResult() {
      const result = useRenderToAnimatedSvgAndIrAsync(vnode, animatedOptions);
      return { state: result, value: { svg: result.svg, ir: result.ir } };
    },
    direct(engine: Engine) {
      return engine.renderToAnimatedSvgAndIR(vnode, animatedOptions);
    },
  },
  {
    name: "PNG",
    request: "render-png",
    useResult() {
      const result = useRenderToPngAsync(vnode);
      return { state: result, value: result.png };
    },
    direct(engine: Engine) {
      return engine.renderToPng(vnode);
    },
  },
  {
    name: "Layered SVG",
    request: "render-layered-svg",
    useResult() {
      const result = useRenderToLayeredSvgAsync(vnode);
      return { state: result, value: result.result };
    },
    direct(engine: Engine) {
      return engine.renderToLayeredSvg(vnode);
    },
  },
  {
    name: "Layered PNG",
    request: "render-layered-png",
    useResult() {
      const result = useRenderToLayeredPngAsync(vnode);
      return { state: result, value: result.result };
    },
    direct(engine: Engine) {
      return engine.renderToLayeredPng(vnode);
    },
  },
];

let mainEngine: Engine;
let workerEngine: WorkerEngine;
const transport = new ScriptTransport();

beforeAll(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const wasmModule = new WebAssembly.Module(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../crates/boundsvg/pkg-web/boundsvg_bg.wasm",
      ),
    ),
  );
  await initWasm(await loadWasmModule({ wasmModule }));
  const fontData = new Uint8Array(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf",
      ),
    ),
  );
  mainEngine = await createEngineAsync({ fonts: [{ alias: "NotoSansJP", data: fontData }] });
  vi.stubGlobal("self", transport.scope);
  await import("@boundsvg/worker/worker");
  workerEngine = await WorkerEngine.create({
    worker: transport,
    fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: fontData.slice().buffer }],
  });
});

afterAll(async () => {
  mainEngine?.dispose();
  workerEngine?.dispose();
  await Promise.resolve();
  transport.terminate();
  vi.unstubAllGlobals();
});

describe.each(["main", "worker"] as const)("real WASM async %s", (execution) => {
  it.each(operations)("matches the committed Core snapshot for $name", async (operation) => {
    const expected = operation.direct(mainEngine);
    const background = vnode.props.background;
    const scheduler = new MainRenderScheduler();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const initialPosts = transport.requests.length;
    let observed: unknown;
    function Probe() {
      const result = operation.useResult();
      useLayoutEffect(() => {
        observed = result.value;
      });
      return (
        <output data-execution={result.state.execution} data-status={result.state.status}>
          {result.state.error?.message}
        </output>
      );
    }
    try {
      act(() =>
        root.render(
          <BoundSvgContext.Provider
            value={{
              engine: execution === "main" ? mainEngine : null,
              workerEngine: execution === "worker" ? workerEngine : null,
              status: "ready",
              error: null,
            }}
          >
            <MainRenderSchedulerContext.Provider value={scheduler}>
              <Probe />
            </MainRenderSchedulerContext.Provider>
          </BoundSvgContext.Provider>,
        ),
      );
      vnode.props.background = "#ff0000";
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(container.querySelector("output")?.dataset).toMatchObject({
        status: "success",
        execution,
      });
      expect(observed).toEqual(expected);
      if (execution === "worker") {
        expect(transport.requests.slice(initialPosts).map((request) => request.type)).toEqual([
          operation.request,
        ]);
      }
    } finally {
      vnode.props.background = background;
      act(() => root.unmount());
      scheduler.dispose();
      container.remove();
    }
  });
});
