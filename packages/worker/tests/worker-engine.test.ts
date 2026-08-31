import {
  FatalError,
  type IR,
  type PngResolutionAdjustedWarning,
  RecoverableError,
  type SceneNode,
} from "@boundsvg/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { WorkerLayoutTransitionInput } from "../src/layout-transition-transport.js";
import type { WorkerRequest, WorkerResponse } from "../src/protocol.js";
import { WorkerEngine } from "../src/worker-engine.js";

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------

type MockEventListener = (event: MessageEvent | ErrorEvent) => void;

class MockWorker {
  postMessage: Mock;
  terminate: Mock;

  private listeners = new Map<string, Set<MockEventListener>>();

  constructor() {
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
  }

  addEventListener(type: string, listener: MockEventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: MockEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Simulate the Worker responding */
  respond(data: WorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data } as MessageEvent);
    }
  }

  /** Simulate a malformed response that bypasses the test's protocol type. */
  respondUnknown(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data } as MessageEvent);
    }
  }

  /** Simulate a Worker error */
  emitError(message: string): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ message } as ErrorEvent);
    }
  }

  /** Get the last posted request */
  lastRequest(): WorkerRequest {
    const calls = this.postMessage.mock.calls;
    const last = calls[calls.length - 1];
    return last![0] as WorkerRequest;
  }

  /** Check whether any listeners remain for a given event type */
  hasListeners(type: string): boolean {
    const set = this.listeners.get(type);
    return set != null && set.size > 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCENE: SceneNode = { type: "Canvas", width: 100, height: 100, children: [] };
const WORKER_IR: Omit<IR, "warnings"> = {
  root: {
    type: "group",
    nodeId: "root",
    bbox: { x: 0, y: 0, w: 100, h: 100 },
    children: [],
  },
  drawOrder: ["root"],
  width: 100,
  height: 100,
};
const TRANSITION: WorkerLayoutTransitionInput = {
  states: {
    A: SCENE,
    B: {
      type: "Canvas",
      width: 100,
      height: 100,
      children: [{ type: "Box", id: "slot", width: 20, height: 40, children: [] }],
    },
  },
  checkpoints: [
    { timeMs: 0, state: "A" },
    { timeMs: 100, state: "B" },
    { timeMs: 200, state: "B" },
    { timeMs: 300, state: "A" },
  ],
};

function autoRespondInit(mockWorker: MockWorker): void {
  mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
    if (request.type === "init") {
      mockWorker.respond({ id: request.id, type: "init-ok" });
    }
  });
}

async function createEngine(mockWorker: MockWorker): Promise<WorkerEngine> {
  autoRespondInit(mockWorker);
  return WorkerEngine.create({
    worker: mockWorker,
    fonts: [],
    timeout: 1000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkerEngine", () => {
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = new MockWorker();
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe("create", () => {
    it("sends init request with fonts and resolves on init-ok", async () => {
      autoRespondInit(mockWorker);

      const buffer = new ArrayBuffer(8);
      const engine = await WorkerEngine.create({
        worker: mockWorker,
        fonts: [{ alias: "sans", weight: 400, style: "normal", data: buffer }],
        timeout: 1000,
      });

      expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
      const request = mockWorker.lastRequest();
      expect(request.type).toBe("init");
      if (request.type === "init") {
        expect(request.fonts).toHaveLength(1);
        expect(request.fonts[0]!.alias).toBe("sans");
      }
      engine.dispose();
    });

    it("initializes when font definitions share an ArrayBuffer", async () => {
      let clonedFonts: Extract<WorkerRequest, { type: "init" }>["fonts"] = [];
      mockWorker.postMessage.mockImplementation(
        (request: WorkerRequest, transferables: ArrayBuffer[]) => {
          // Match Worker.postMessage's identity-unique transfer-list enforcement.
          const clonedRequest = structuredClone(request, { transfer: transferables });
          if (clonedRequest.type === "init") {
            clonedFonts = clonedRequest.fonts;
            mockWorker.respond({ id: clonedRequest.id, type: "init-ok" });
          }
        },
      );
      const sharedBuffer = Uint8Array.from([1, 2, 3]).buffer;

      const engine = await WorkerEngine.create({
        worker: mockWorker,
        fonts: [
          { alias: "sans", weight: 400, style: "normal", data: sharedBuffer },
          { alias: "sans-bold", weight: 700, style: "normal", data: sharedBuffer },
        ],
        timeout: 1000,
      });

      expect(clonedFonts).toHaveLength(2);
      expect(clonedFonts[0]!.data).toBe(clonedFonts[1]!.data);
      expect(new Uint8Array(clonedFonts[0]!.data)).toEqual(new Uint8Array([1, 2, 3]));
      engine.dispose();
    });

    it("sends registered geometries and symbols in the init request", async () => {
      autoRespondInit(mockWorker);
      const geometry = {
        viewBox: { width: 20, height: 10 },
        root: { kind: "path" as const, d: "M0 0H20V10H0Z" },
      };
      const symbol = { geometry };

      const engine = await WorkerEngine.create({
        worker: mockWorker,
        fonts: [],
        geometries: [{ id: "rect", doc: geometry }],
        symbols: [{ id: "rect-symbol", def: symbol }],
        timeout: 1000,
      });

      const request = mockWorker.lastRequest();
      expect(request.type).toBe("init");
      if (request.type === "init") {
        expect(request.geometries).toEqual([{ id: "rect", doc: geometry }]);
        expect(request.symbols).toEqual([{ id: "rect-symbol", def: symbol }]);
      }
      engine.dispose();
    });

    it("throws FatalError when init returns error response", async () => {
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "init") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: { severity: "fatal", code: "WASM_LOAD_FAIL", message: "failed" },
          });
        }
      });

      await expect(
        WorkerEngine.create({
          worker: mockWorker,
          fonts: [],
          timeout: 1000,
        }),
      ).rejects.toThrow(FatalError);
    });

    it("rejects a correlated non-init response during initialization", async () => {
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "init") {
          mockWorker.respond({
            id: request.id,
            type: "measure-text-block-ok",
            result: {} as never,
          });
        }
      });

      await expect(
        WorkerEngine.create({
          worker: mockWorker,
          fonts: [],
          timeout: 1000,
        }),
      ).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_PROTOCOL_UNEXPECTED_RESPONSE",
        stage: "engine",
        context: expect.objectContaining({
          responseType: "measure-text-block-ok",
          expectedResponseType: "init-ok",
        }),
      });
    });

    it("rejects on timeout", async () => {
      // Don't respond — let it timeout
      await expect(
        WorkerEngine.create({
          worker: mockWorker,
          fonts: [],
          timeout: 50,
        }),
      ).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_REQUEST_TIMEOUT",
        stage: "engine",
        context: expect.objectContaining({ requestId: 1, requestType: "init", timeoutMs: 50 }),
      });
    });

    it("cleans up Worker on init timeout for externally-provided Worker", async () => {
      // Don't respond — let it timeout
      await expect(
        WorkerEngine.create({
          worker: mockWorker,
          fonts: [],
          timeout: 50,
        }),
      ).rejects.toThrow(/timed out/);
      // Externally-provided Worker should NOT be terminated
      expect(mockWorker.terminate).not.toHaveBeenCalled();
      // But dispose message should have been sent
      const lastReq = mockWorker.lastRequest();
      expect(lastReq.type).toBe("dispose");
    });

    it("terminates owned Worker on init timeout", async () => {
      const ownedMock = new MockWorker();
      // Stub global Worker so the URL path creates our mock
      const origWorker = globalThis.Worker;
      vi.stubGlobal(
        "Worker",
        vi.fn(() => ownedMock),
      );
      try {
        await expect(
          WorkerEngine.create({
            worker: new URL("file:///fake-worker.js"),
            fonts: [],
            timeout: 50,
          }),
        ).rejects.toThrow(/timed out/);
        // Owned Worker SHOULD be terminated on cleanup
        expect(ownedMock.terminate).toHaveBeenCalled();
      } finally {
        globalThis.Worker = origWorker;
      }
    });

    it("wraps Worker construction failures in the local transport taxonomy", async () => {
      const origWorker = globalThis.Worker;
      vi.stubGlobal(
        "Worker",
        vi.fn(() => {
          throw new Error("constructor blocked");
        }),
      );
      try {
        await expect(
          WorkerEngine.create({
            worker: new URL("file:///blocked-worker.js"),
            fonts: [],
            timeout: 1000,
          }),
        ).rejects.toMatchObject({
          name: "FatalError",
          code: "WORKER_CREATION_FAILED",
          stage: "engine",
          context: expect.objectContaining({ causeMessage: "constructor blocked" }),
        });
      } finally {
        globalThis.Worker = origWorker;
      }
    });
  });

  // -----------------------------------------------------------------------
  // renderToSvg
  // -----------------------------------------------------------------------

  describe("renderToSvg", () => {
    it("sends render-svg request and returns SVG string", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-svg") {
          mockWorker.respond({
            id: request.id,
            type: "render-svg-ok",
            svg: "<svg></svg>",
            warnings: [],
          });
        }
      });

      const svg = await engine.renderToSvg(SCENE);
      expect(svg).toBe("<svg></svg>");
      engine.dispose();
    });

    it("preserves animated InlineRect ownership in the SceneDocument request", async () => {
      const engine = await createEngine(mockWorker);
      const scene: SceneNode = {
        type: "Canvas",
        width: 120,
        height: 60,
        children: [
          {
            type: "Text",
            id: "typing",
            font: "NotoSansJP",
            fontSizePx: 24,
            children: [
              "A",
              {
                type: "InlineRect",
                inlineSizePx: 2,
                color: "#111827",
                animate: {
                  keyframes: [
                    { at: 0, opacity: 0 },
                    { at: 1, opacity: 1 },
                  ],
                  durationMs: 500,
                  easing: { type: "steps", count: 1, position: "jump-end" },
                },
              },
            ],
          },
        ],
      };

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-animated-svg") {
          mockWorker.respond({
            id: request.id,
            type: "render-animated-svg-ok",
            svg: "<svg></svg>",
            warnings: [],
          });
        }
      });

      await engine.renderToAnimatedSvg(scene, {
        playback: { mode: "independent" },
        timeMs: 250,
      });

      const request = mockWorker.lastRequest();
      expect(request.type).toBe("render-animated-svg");
      if (request.type === "render-animated-svg") {
        expect(request.scene).toEqual(scene);
        expect(request.options).toEqual({ playback: { mode: "independent" }, timeMs: 250 });
      }
      engine.dispose();
    });

    it("transfers timeline playback without changing the request family", async () => {
      const engine = await createEngine(mockWorker);
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-animated-svg") {
          mockWorker.respond({
            id: request.id,
            type: "render-animated-svg-ok",
            svg: '<svg data-playback="timeline"/>',
            warnings: [],
          });
        }
      });

      const svg = await engine.renderToAnimatedSvg(SCENE, {
        playback: { mode: "timeline", durationMs: 800, iterations: 2.25 },
        timeMs: 950,
      });

      expect(svg).toContain('data-playback="timeline"');
      expect(mockWorker.lastRequest()).toMatchObject({
        type: "render-animated-svg",
        options: {
          playback: { mode: "timeline", durationMs: 800, iterations: 2.25 },
          timeMs: 950,
        },
      });
      engine.dispose();
    });

    it("rehydrates timeline Fatal context without flattening it", async () => {
      const engine = await createEngine(mockWorker);
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-animated-svg") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: {
              severity: "fatal",
              code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
              message: "spring cannot be represented",
              stage: "emit",
              nodeId: "spring-box",
              context: {
                ownerKind: "node",
                ownerId: "spring-box",
                reason: "spring-easing",
                boundaryTimeMs: 0,
                migration: "Use independent playback.",
              },
            },
          });
        }
      });

      await expect(
        engine.renderToAnimatedSvg(SCENE, {
          playback: { mode: "timeline", durationMs: 800, iterations: "infinite" },
        }),
      ).rejects.toMatchObject({
        code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
        stage: "emit",
        nodeId: "spring-box",
        context: {
          ownerKind: "node",
          ownerId: "spring-box",
          reason: "spring-easing",
          boundaryTimeMs: 0,
          migration: "Use independent playback.",
        },
      });
      engine.dispose();
    });

    it("renders animated SVG + IR through its dedicated request family", async () => {
      const engine = await createEngine(mockWorker);
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-animated-svg-and-ir") {
          mockWorker.respond({
            id: request.id,
            type: "render-animated-svg-and-ir-ok",
            svg: '<svg data-animated="true"/>',
            ir: WORKER_IR,
            warnings: [],
          });
        }
      });

      const result = await engine.renderToAnimatedSvgAndIR(SCENE, {
        playback: { mode: "independent" },
        nodeIdMetadata: "include",
      });

      expect(result.svg).toContain("data-animated");
      expect(result.ir).toEqual({ ...WORKER_IR, warnings: [] });
      expect(mockWorker.lastRequest()).toMatchObject({
        type: "render-animated-svg-and-ir",
        options: { playback: { mode: "independent" }, nodeIdMetadata: "include" },
      });
      engine.dispose();
    });

    it("forwards warnings to onWarning callback", async () => {
      const engine = await createEngine(mockWorker);
      const warnings: unknown[] = [];

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-svg") {
          mockWorker.respond({
            id: request.id,
            type: "render-svg-ok",
            svg: "<svg/>",
            warnings: [
              {
                severity: "recoverable",
                code: "W1",
                message: "warn1",
                fallback: "fb",
                stage: "emit",
              },
            ],
          });
        }
      });

      await engine.renderToSvg(SCENE, {
        onWarning: (w) => warnings.push(w),
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toBeInstanceOf(RecoverableError);
      engine.dispose();
    });

    it("renders layered SVG and forwards warnings", async () => {
      const engine = await createEngine(mockWorker);
      const warnings: unknown[] = [];

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-layered-svg") {
          mockWorker.respond({
            id: request.id,
            type: "render-layered-svg-ok",
            result: {
              width: 100,
              height: 100,
              layers: [
                {
                  id: "background",
                  bbox: { x: 0, y: 0, width: 100, height: 100 },
                  nodeIds: ["bg"],
                  mode: "independent",
                  paintOrder: 0,
                  warnings: [],
                  svg: "<svg><!-- bg --></svg>",
                },
                {
                  id: "text",
                  bbox: { x: 0, y: 0, width: 100, height: 100 },
                  nodeIds: ["title"],
                  mode: "independent",
                  paintOrder: 1,
                  warnings: [],
                  svg: "<svg><!-- text --></svg>",
                },
              ],
              manifest: {
                width: 100,
                height: 100,
                layers: [
                  {
                    id: "background",
                    bbox: { x: 0, y: 0, width: 100, height: 100 },
                    nodeIds: ["bg"],
                    mode: "independent",
                    paintOrder: 0,
                    warnings: [],
                  },
                  {
                    id: "text",
                    bbox: { x: 0, y: 0, width: 100, height: 100 },
                    nodeIds: ["title"],
                    mode: "independent",
                    paintOrder: 1,
                    warnings: [],
                  },
                ],
              },
              warnings: [
                {
                  severity: "recoverable",
                  code: "W1",
                  message: "warn1",
                  fallback: "fb",
                  stage: "emit",
                },
              ],
            },
          });
        }
      });

      const result = await engine.renderToLayeredSvg(SCENE, {
        onWarning: (warning) => warnings.push(warning),
      });

      expect(result.layers).toHaveLength(2);
      expect(result.layers[0]?.svg).toContain("bg");
      expect(result.layers[1]?.svg).toContain("text");
      expect(result.manifest.layers).toHaveLength(2);
      // warnings field must be stripped from the returned result
      expect((result as { warnings?: unknown }).warnings).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toBeInstanceOf(RecoverableError);
      expect(mockWorker.lastRequest().type).toBe("render-layered-svg");
      engine.dispose();
    });

    it("renders layered PNG and forwards warnings", async () => {
      const engine = await createEngine(mockWorker);
      const warnings: unknown[] = [];

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-layered-png") {
          mockWorker.respond({
            id: request.id,
            type: "render-layered-png-ok",
            result: {
              width: 100,
              height: 100,
              pixelWidth: 200,
              pixelHeight: 200,
              layers: [
                {
                  id: "background",
                  bbox: null,
                  nodeIds: ["bg"],
                  mode: "independent",
                  paintOrder: 0,
                  warnings: [],
                  png: new Uint8Array([1, 2, 3]),
                },
              ],
              manifest: {
                width: 100,
                height: 100,
                pixelWidth: 200,
                pixelHeight: 200,
                layers: [
                  {
                    id: "background",
                    bbox: null,
                    nodeIds: ["bg"],
                    mode: "independent",
                    paintOrder: 0,
                    warnings: [],
                  },
                ],
              },
              warnings: [
                {
                  severity: "recoverable",
                  code: "PNG_RESOLUTION_ADJUSTED",
                  message: "adjusted",
                  fallback: "adjusted scale",
                  stage: "emit",
                  context: {
                    requestedScale: 2,
                    appliedScale: 1.5,
                    baseWidth: 100,
                    baseHeight: 100,
                    requestedWidth: 200,
                    requestedHeight: 200,
                    outputWidth: 150,
                    outputHeight: 150,
                    maxLongEdge: 3840,
                    maxPixels: 8294400,
                  },
                },
              ],
            },
          });
        }
      });

      const result = await engine.renderToLayeredPng(SCENE, {
        onWarning: (warning) => warnings.push(warning),
      });

      expect(result.layers).toHaveLength(1);
      expect(result.layers[0]?.png).toEqual(new Uint8Array([1, 2, 3]));
      expect(warnings).toHaveLength(1);
      expect(mockWorker.lastRequest().type).toBe("render-layered-png");
      engine.dispose();
    });

    it("passes worker-safe options (strips callbacks)", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-svg") {
          mockWorker.respond({
            id: request.id,
            type: "render-svg-ok",
            svg: "<svg/>",
            warnings: [],
          });
        }
      });

      await engine.renderToSvg(SCENE, {
        scale: 2,
        debug: true,
        resourceIdPrefix: "worker-doc-",
        onWarning: () => {},
      });

      const request = mockWorker.lastRequest();
      expect(request.type).toBe("render-svg");
      if (request.type === "render-svg") {
        expect(request.options).toEqual({
          scale: 2,
          debug: true,
          resourceIdPrefix: "worker-doc-",
        });
      }
      engine.dispose();
    });

    it("throws FatalError on error response", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-svg") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: { severity: "fatal", code: "RENDER_FAIL", message: "boom" },
          });
        }
      });

      await expect(engine.renderToSvg(SCENE)).rejects.toThrow(FatalError);
      engine.dispose();
    });

    it("throws after dispose", async () => {
      const engine = await createEngine(mockWorker);
      engine.dispose();
      await expect(engine.renderToSvg(SCENE)).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_ENGINE_DISPOSED",
        stage: "engine",
      });
    });

    it("cleans up pending state when postMessage throws synchronously", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation(() => {
        throw new Error("DataCloneError");
      });

      await expect(engine.renderToSvg(SCENE)).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_TRANSPORT_FAILED",
        stage: "engine",
        context: expect.objectContaining({
          requestType: "render-svg",
          causeMessage: "DataCloneError",
        }),
      });
      // Reset mock so dispose's postMessage doesn't throw
      mockWorker.postMessage.mockImplementation(() => {});
      // No lingering timers or pending entries — a subsequent dispose should be clean
      engine.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // renderToWebp
  // -----------------------------------------------------------------------

  describe("renderToWebp", () => {
    it("sends render-webp request and returns Uint8Array", async () => {
      const engine = await createEngine(mockWorker);
      const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-webp") {
          mockWorker.respond({
            id: request.id,
            type: "render-webp-ok",
            webp: webpBytes,
            warnings: [],
          });
        }
      });

      const webp = await engine.renderToWebp(SCENE);
      expect(webp).toBeInstanceOf(Uint8Array);
      expect(webp).toEqual(webpBytes);
      engine.dispose();
    });

    it("throws FatalError on error response", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-webp") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: { severity: "fatal", code: "WEBP_NO_ENCODER", message: "no encoder" },
          });
        }
      });

      await expect(engine.renderToWebp(SCENE)).rejects.toThrow(FatalError);
      engine.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // renderToAnimatedGif
  // -----------------------------------------------------------------------

  describe("renderToAnimatedGif", () => {
    it("sends the schedule with the request and returns Uint8Array", async () => {
      const engine = await createEngine(mockWorker);
      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38]);
      const requests: WorkerRequest[] = [];

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        requests.push(request);
        if (request.type === "render-animated-gif") {
          mockWorker.respond({
            id: request.id,
            type: "render-animated-gif-ok",
            gif: gifBytes,
            warnings: [],
          });
        }
      });

      const gif = await engine.renderToAnimatedGif(SCENE, {
        durationMs: 400,
        fps: 10,
        iterations: "infinite",
      });
      expect(gif).toEqual(gifBytes);
      const gifRequest = requests.find((req) => req.type === "render-animated-gif");
      expect(gifRequest?.type === "render-animated-gif" && gifRequest.options).toEqual({
        durationMs: 400,
        fps: 10,
        iterations: "infinite",
      });
      engine.dispose();
    });

    it("throws FatalError on error response", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-animated-gif") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: { severity: "fatal", code: "GIF_NO_ENCODER", message: "no encoder" },
          });
        }
      });

      await expect(
        engine.renderToAnimatedGif(SCENE, { iterations: "infinite", durationMs: 400 }),
      ).rejects.toThrow(FatalError);
      engine.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // renderToAnimatedWebp
  // -----------------------------------------------------------------------

  describe("renderToAnimatedWebp", () => {
    it("sends the schedule with the request and returns Uint8Array", async () => {
      const engine = await createEngine(mockWorker);
      const animatedBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
      const requests: WorkerRequest[] = [];

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        requests.push(request);
        if (request.type === "render-animated-webp") {
          mockWorker.respond({
            id: request.id,
            type: "render-animated-webp-ok",
            webp: animatedBytes,
            warnings: [],
          });
        }
      });

      const webp = await engine.renderToAnimatedWebp(SCENE, {
        durationMs: 500,
        fps: 10,
        iterations: 2,
      });
      expect(webp).toEqual(animatedBytes);
      const animatedRequest = requests.find((req) => req.type === "render-animated-webp");
      expect(animatedRequest?.type === "render-animated-webp" && animatedRequest.options).toEqual({
        durationMs: 500,
        fps: 10,
        iterations: 2,
      });
      engine.dispose();
    });

    it("throws FatalError on error response", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-animated-webp") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: {
              severity: "fatal",
              code: "ANIMATED_WEBP_INVALID_SCHEDULE",
              message: "bad schedule",
            },
          });
        }
      });

      await expect(
        engine.renderToAnimatedWebp(SCENE, { iterations: "infinite", durationMs: 500 }),
      ).rejects.toThrow(FatalError);
      engine.dispose();
    });
  });

  describe("layout transition animated raster", () => {
    it("snapshots the transition and uses the dedicated WebP request", async () => {
      const engine = await createEngine(mockWorker);
      const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-layout-transition-animated-webp") {
          mockWorker.respond({
            id: request.id,
            type: "render-animated-webp-ok",
            webp: bytes,
            warnings: [],
          });
        }
      });
      const input = structuredClone(TRANSITION);
      const pending = engine.renderLayoutTransitionToAnimatedWebp(input, {
        durationMs: 300,
        fps: 10,
        iterations: 2,
        textPathMode: "glyphs",
      });
      const firstState = input.states.A;
      if (firstState?.type === "Canvas") {
        firstState.width = 200;
      }

      await expect(pending).resolves.toEqual(bytes);
      const request = mockWorker.lastRequest();
      expect(request.type).toBe("render-layout-transition-animated-webp");
      if (request.type === "render-layout-transition-animated-webp") {
        expect(request.transition.states.A).toMatchObject({ width: 100 });
        expect(request.options).toMatchObject({
          durationMs: 300,
          fps: 10,
          iterations: 2,
          textPathMode: "glyphs",
        });
      }
      engine.dispose();
    });

    it("uses the GIF request and forwards recoverable warnings", async () => {
      const engine = await createEngine(mockWorker);
      const bytes = new Uint8Array([0x47, 0x49, 0x46]);
      const warningCodes: string[] = [];
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-layout-transition-animated-gif") {
          mockWorker.respond({
            id: request.id,
            type: "render-animated-gif-ok",
            gif: bytes,
            warnings: [
              {
                severity: "recoverable",
                code: "ANIMATED_GIF_TIMING_ADJUSTED",
                message: "adjusted",
                fallback: "adjusted timing",
                stage: "emit",
              },
            ],
          });
        }
      });

      await expect(
        engine.renderLayoutTransitionToAnimatedGif(TRANSITION, {
          durationMs: 300,
          iterations: "infinite",
          onWarning: (warning) => warningCodes.push(warning.code),
        }),
      ).resolves.toEqual(bytes);
      expect(mockWorker.lastRequest().type).toBe("render-layout-transition-animated-gif");
      expect(warningCodes).toEqual(["ANIMATED_GIF_TIMING_ADJUSTED"]);
      engine.dispose();
    });

    it("rehydrates Worker fatal errors for transition encoding", async () => {
      const engine = await createEngine(mockWorker);
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-layout-transition-animated-webp") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: { severity: "fatal", code: "LAYOUT_TRANSITION_INCOMPATIBLE", message: "bad" },
          });
        }
      });

      await expect(
        engine.renderLayoutTransitionToAnimatedWebp(TRANSITION, {
          durationMs: 300,
          iterations: "infinite",
        }),
      ).rejects.toMatchObject({ code: "LAYOUT_TRANSITION_INCOMPATIBLE" });
      engine.dispose();
    });

    it("times out a transition request through the shared request lifecycle", async () => {
      autoRespondInit(mockWorker);
      const engine = await WorkerEngine.create({ worker: mockWorker, fonts: [], timeout: 20 });
      mockWorker.postMessage.mockImplementation(() => {});

      await expect(
        engine.renderLayoutTransitionToAnimatedGif(TRANSITION, {
          durationMs: 300,
          iterations: "infinite",
        }),
      ).rejects.toMatchObject({
        code: "WORKER_REQUEST_TIMEOUT",
        context: expect.objectContaining({
          requestType: "render-layout-transition-animated-gif",
          timeoutMs: 20,
        }),
      });
      engine.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // renderToPng
  // -----------------------------------------------------------------------

  describe("renderToPng", () => {
    it("sends render-png request and returns Uint8Array", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-png") {
          mockWorker.respond({
            id: request.id,
            type: "render-png-ok",
            png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            warnings: [],
          });
        }
      });

      const png = await engine.renderToPng(SCENE);
      expect(png).toBeInstanceOf(Uint8Array);
      expect(png).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      engine.dispose();
    });

    it("throws FatalError on error response", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-png") {
          mockWorker.respond({
            id: request.id,
            type: "error",
            error: { severity: "fatal", code: "PNG_FAIL", message: "oom" },
          });
        }
      });

      await expect(engine.renderToPng(SCENE)).rejects.toThrow(FatalError);
      engine.dispose();
    });

    it("forwards PNG_RESOLUTION_ADJUSTED to onPngResolutionAdjusted callback", async () => {
      const engine = await createEngine(mockWorker);
      const pngWarnings: PngResolutionAdjustedWarning[] = [];
      const generalWarnings: unknown[] = [];
      const callbackOrder: string[] = [];

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-png") {
          mockWorker.respond({
            id: request.id,
            type: "render-png-ok",
            png: new Uint8Array([1]),
            warnings: [
              {
                severity: "recoverable",
                code: "PNG_RESOLUTION_ADJUSTED",
                message: "auto-adjusted",
                fallback: "auto-adjusted scale",
                stage: "emit",
                context: {
                  requestedScale: 4,
                  appliedScale: 2,
                  baseWidth: 1000,
                  baseHeight: 1000,
                  requestedWidth: 4000,
                  requestedHeight: 4000,
                  outputWidth: 2000,
                  outputHeight: 2000,
                  maxLongEdge: 4096,
                  maxPixels: 8294400,
                },
              },
            ],
          });
        }
      });

      await engine.renderToPng(SCENE, {
        onPngResolutionAdjusted: (w) => {
          callbackOrder.push("adjusted");
          pngWarnings.push(w);
        },
        onWarning: (w) => {
          callbackOrder.push("warning");
          generalWarnings.push(w);
        },
      });

      expect(pngWarnings).toHaveLength(1);
      expect(pngWarnings[0]!.requestedScale).toBe(4);
      expect(pngWarnings[0]!.appliedScale).toBe(2);
      expect(pngWarnings[0]!.outputWidth).toBe(2000);
      // Also forwarded to general onWarning
      expect(generalWarnings).toHaveLength(1);
      expect(generalWarnings[0]).toBeInstanceOf(RecoverableError);
      expect(callbackOrder).toEqual(["adjusted", "warning"]);
      engine.dispose();
    });

    it("skips onPngResolutionAdjusted but still calls onWarning when context is incomplete", async () => {
      const engine = await createEngine(mockWorker);
      const pngWarnings: PngResolutionAdjustedWarning[] = [];
      const generalWarnings: unknown[] = [];

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-png") {
          mockWorker.respond({
            id: request.id,
            type: "render-png-ok",
            png: new Uint8Array([1]),
            warnings: [
              {
                severity: "recoverable",
                code: "PNG_RESOLUTION_ADJUSTED",
                message: "auto-adjusted",
                fallback: "auto-adjusted scale",
                stage: "emit",
                context: {
                  requestedScale: 4,
                  // Missing appliedScale and other fields
                },
              },
            ],
          });
        }
      });

      await engine.renderToPng(SCENE, {
        onPngResolutionAdjusted: (w) => pngWarnings.push(w),
        onWarning: (w) => generalWarnings.push(w),
      });

      // onPngResolutionAdjusted NOT called (incomplete context)
      expect(pngWarnings).toHaveLength(0);
      // onWarning still called
      expect(generalWarnings).toHaveLength(1);
      expect(generalWarnings[0]).toBeInstanceOf(RecoverableError);
      engine.dispose();
    });
  });

  describe("measurement APIs", () => {
    it("round-trips every core measurement request and result", async () => {
      const engine = await createEngine(mockWorker);
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        switch (request.type) {
          case "layout-text-flow":
            mockWorker.respond({
              id: request.id,
              type: "layout-text-flow-ok",
              result: { marker: request.type } as never,
            });
            break;
          case "layout-text-flow-with-exclusions":
            mockWorker.respond({
              id: request.id,
              type: "layout-text-flow-with-exclusions-ok",
              result: { marker: request.type } as never,
            });
            break;
          case "measure-text-block":
            mockWorker.respond({
              id: request.id,
              type: "measure-text-block-ok",
              result: { marker: request.type } as never,
            });
            break;
          case "shrinkwrap-text":
            mockWorker.respond({
              id: request.id,
              type: "shrinkwrap-text-ok",
              result: { marker: request.type } as never,
            });
            break;
          case "shrinkwrap-flow":
            mockWorker.respond({
              id: request.id,
              type: "shrinkwrap-flow-ok",
              result: { marker: request.type } as never,
            });
            break;
          case "measure-intrinsic-inline-size":
            mockWorker.respond({
              id: request.id,
              type: "measure-intrinsic-inline-size-ok",
              result: { marker: request.type } as never,
            });
            break;
          default:
            break;
        }
      });

      await expect(engine.layoutTextFlow({} as never)).resolves.toMatchObject({
        marker: "layout-text-flow",
      });
      await expect(engine.layoutTextFlowWithExclusions({} as never)).resolves.toMatchObject({
        marker: "layout-text-flow-with-exclusions",
      });
      await expect(engine.measureTextBlock({} as never)).resolves.toMatchObject({
        marker: "measure-text-block",
      });
      await expect(engine.shrinkwrapText({} as never)).resolves.toMatchObject({
        marker: "shrinkwrap-text",
      });
      await expect(engine.shrinkwrapFlow({} as never)).resolves.toMatchObject({
        marker: "shrinkwrap-flow",
      });
      await expect(engine.measureIntrinsicInlineSize({} as never)).resolves.toMatchObject({
        marker: "measure-intrinsic-inline-size",
      });
      engine.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe("dispose", () => {
    it("sends dispose message to Worker", async () => {
      const engine = await createEngine(mockWorker);
      engine.dispose();

      const request = mockWorker.lastRequest();
      expect(request.type).toBe("dispose");
    });

    it("rejects pending requests on dispose", async () => {
      const engine = await createEngine(mockWorker);

      // Don't respond to render request
      mockWorker.postMessage.mockImplementation(() => {});
      const promise = engine.renderToSvg(SCENE);

      engine.dispose();
      await expect(promise).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_ENGINE_DISPOSED",
        stage: "engine",
      });
    });

    it("is idempotent", async () => {
      const engine = await createEngine(mockWorker);
      engine.dispose();
      engine.dispose(); // should not throw
    });

    it("does not terminate externally-provided Worker", async () => {
      const engine = await createEngine(mockWorker);
      engine.dispose();
      expect(mockWorker.terminate).not.toHaveBeenCalled();
    });

    it("removes event listeners from externally-provided Worker on dispose", async () => {
      const engine = await createEngine(mockWorker);
      expect(mockWorker.hasListeners("message")).toBe(true);
      expect(mockWorker.hasListeners("error")).toBe(true);

      engine.dispose();
      expect(mockWorker.hasListeners("message")).toBe(false);
      expect(mockWorker.hasListeners("error")).toBe(false);
    });

    it("completes cleanup even when dispose postMessage throws", async () => {
      const engine = await createEngine(mockWorker);

      // Make postMessage throw to simulate a broken Worker
      mockWorker.postMessage.mockImplementation(() => {
        throw new Error("Worker is dead");
      });

      // dispose should not throw and should still clean up
      expect(() => engine.dispose()).not.toThrow();
      expect(mockWorker.hasListeners("message")).toBe(false);
      expect(mockWorker.hasListeners("error")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Worker onerror
  // -----------------------------------------------------------------------

  describe("Worker error event", () => {
    it("rejects all pending requests on Worker error", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation(() => {});
      const p1 = engine.renderToSvg(SCENE);
      const p2 = engine.renderToPng(SCENE);

      mockWorker.emitError("Worker crashed");

      await expect(p1).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_CRASHED",
        stage: "engine",
        context: expect.objectContaining({ workerMessage: "Worker crashed" }),
      });
      await expect(p2).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_CRASHED",
        stage: "engine",
      });
      engine.dispose();
    });

    it("transitions to disposed state and rejects subsequent calls after crash", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.emitError("Worker crashed");

      // Subsequent calls should fail immediately with disposed error, not timeout
      await expect(engine.renderToSvg(SCENE)).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_ENGINE_DISPOSED",
        stage: "engine",
      });
      await expect(engine.renderToPng(SCENE)).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_ENGINE_DISPOSED",
        stage: "engine",
      });
    });

    it("removes listeners and cleans up after crash", async () => {
      const engine = await createEngine(mockWorker);
      expect(mockWorker.hasListeners("message")).toBe(true);

      mockWorker.emitError("Worker crashed");

      expect(mockWorker.hasListeners("message")).toBe(false);
      expect(mockWorker.hasListeners("error")).toBe(false);
      // dispose is idempotent after crash
      engine.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // ID correlation
  // -----------------------------------------------------------------------

  describe("request/response ID correlation", () => {
    it("rejects a correlated malformed response as a protocol FatalError", async () => {
      const engine = await createEngine(mockWorker);

      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        if (request.type === "render-svg") {
          mockWorker.respondUnknown({
            id: request.id,
            type: "render-svg-ok",
            svg: 42,
            warnings: [],
          });
        }
      });

      await expect(engine.renderToSvg(SCENE)).rejects.toMatchObject({
        name: "FatalError",
        code: "WORKER_PROTOCOL_INVALID_RESPONSE",
        stage: "engine",
        context: expect.objectContaining({ requestId: 2 }),
      });
      engine.dispose();
    });

    it("correlates responses to correct pending requests", async () => {
      const engine = await createEngine(mockWorker);

      const responses: WorkerResponse[] = [];
      mockWorker.postMessage.mockImplementation((request: WorkerRequest) => {
        // Buffer responses, don't respond immediately
        if (request.type === "render-svg") {
          responses.push({
            id: request.id,
            type: "render-svg-ok",
            svg: `<svg id="${request.id}"/>`,
            warnings: [],
          });
        }
      });

      const p1 = engine.renderToSvg(SCENE);
      const p2 = engine.renderToSvg(SCENE);

      // Respond in reverse order
      mockWorker.respond(responses[1]!);
      mockWorker.respond(responses[0]!);

      const [svg1, svg2] = await Promise.all([p1, p2]);
      // Each promise should get its matching ID response
      expect(svg1).toContain(`id="2"`); // id=1 was init, so render IDs are 2,3
      expect(svg2).toContain(`id="3"`);
      engine.dispose();
    });
  });
});
