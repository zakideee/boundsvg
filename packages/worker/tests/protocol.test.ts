import { describe, expect, it } from "vitest";
import { formatUnknownWorkerFailure } from "../src/diagnostic-format.js";
import type { WorkerLayoutTransitionInput } from "../src/layout-transition-transport.js";
import {
  collectRequestTransferables,
  collectResponseTransferables,
  decodeWorkerResponse,
  type FontTransfer,
  getWorkerMessageId,
  type InitRequest,
  isWorkerRequest,
  isWorkerResponse,
  type RenderAnimatedGifOkResponse,
  type RenderAnimatedSvgOkResponse,
  type RenderAnimatedWebpOkResponse,
  type RenderLayeredPngOkResponse,
  type RenderLayeredSvgOkResponse,
  type RenderPngOkResponse,
  type RenderSvgOkResponse,
  type RenderWebpOkResponse,
  type WorkerRequest,
  type WorkerResponse,
} from "../src/protocol.js";

const TRANSITION: WorkerLayoutTransitionInput = {
  states: {
    A: { type: "Canvas", width: 100, height: 100, children: [] },
    B: { type: "Canvas", width: 100, height: 100, children: [] },
  },
  checkpoints: [
    { timeMs: 0, state: "A" },
    { timeMs: 100, state: "B" },
    { timeMs: 200, state: "B" },
    { timeMs: 300, state: "A" },
  ],
};

describe("formatUnknownWorkerFailure", () => {
  it("is total for hostile proxies, symbols, BigInts, and null-prototype values", () => {
    const hostile = new Proxy(Object.create(null) as object, {
      get() {
        throw new Error("hostile get");
      },
      getOwnPropertyDescriptor() {
        throw new Error("hostile descriptor");
      },
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });

    expect(formatUnknownWorkerFailure(hostile, "fallback")).toBe("fallback");
    expect(formatUnknownWorkerFailure(Object.create(null), "fallback")).toBe("fallback");
    expect(formatUnknownWorkerFailure(Symbol("wire"), "fallback")).toBe("Symbol(wire)");
    expect(formatUnknownWorkerFailure(7n, "fallback")).toBe("7");
  });

  it("does not invoke getters, JSON hooks, or object coercion hooks", () => {
    let hookCalls = 0;
    const hostile = {
      get payload() {
        hookCalls += 1;
        return "secret";
      },
      toJSON() {
        hookCalls += 1;
        return "serialized";
      },
      toString() {
        hookCalls += 1;
        return "coerced";
      },
      [Symbol.toPrimitive]() {
        hookCalls += 1;
        return "primitive";
      },
    };
    const accessorMessage = Object.defineProperty({}, "message", {
      enumerable: true,
      get() {
        hookCalls += 1;
        return "accessed";
      },
    });

    expect(formatUnknownWorkerFailure(hostile, "fallback")).toBe("fallback");
    expect(formatUnknownWorkerFailure(accessorMessage, "fallback")).toBe("fallback");
    expect(formatUnknownWorkerFailure({ message: "owned" }, "fallback")).toBe("owned");
    expect(hookCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isWorkerRequest
// ---------------------------------------------------------------------------

describe("isWorkerRequest", () => {
  it("returns true for valid init request", () => {
    const request: WorkerRequest = {
      id: 1,
      type: "init",
      fonts: [],
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("accepts valid geometry and symbol registrations on init", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "init",
        fonts: [],
        geometries: [{ id: "rect", doc: { viewBox: {}, root: {} } }],
        symbols: [{ id: "symbol", def: { geometry: {} } }],
      }),
    ).toBe(true);
  });

  it("rejects malformed geometry and symbol registrations on init", () => {
    expect(
      isWorkerRequest({ id: 1, type: "init", fonts: [], geometries: [{ id: 1, doc: {} }] }),
    ).toBe(false);
    expect(
      isWorkerRequest({ id: 1, type: "init", fonts: [], symbols: [{ id: "x", def: null }] }),
    ).toBe(false);
  });

  it("returns true for valid render-svg request", () => {
    const request: WorkerRequest = {
      id: 2,
      type: "render-svg",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("requires options for animated SVG request kinds", () => {
    const scene = { type: "Canvas", width: 100, height: 100, children: [] } as const;
    expect(
      isWorkerRequest({
        id: 20,
        type: "render-animated-svg",
        scene,
        options: { playback: { mode: "independent" } },
      }),
    ).toBe(true);
    expect(
      isWorkerRequest({
        id: 21,
        type: "render-animated-svg-and-ir",
        scene,
        options: {
          playback: { mode: "timeline", durationMs: 800, iterations: 2.25 },
          timeMs: 950,
          nodeIdMetadata: "omit",
        },
      }),
    ).toBe(true);
    expect(isWorkerRequest({ id: 22, type: "render-animated-svg", scene })).toBe(false);
    expect(isWorkerRequest({ id: 23, type: "render-animated-svg-and-ir", scene })).toBe(false);
  });

  it("returns true for valid render-png request", () => {
    const request: WorkerRequest = {
      id: 3,
      type: "render-png",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("returns true for valid render-webp request", () => {
    const request: WorkerRequest = {
      id: 4,
      type: "render-webp",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("returns false for render-webp without scene", () => {
    expect(isWorkerRequest({ id: 4, type: "render-webp" })).toBe(false);
  });

  it("returns true for valid render-animated-webp request", () => {
    const request: WorkerRequest = {
      id: 6,
      type: "render-animated-webp",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
      options: { durationMs: 500 },
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("returns false for render-animated-webp without options", () => {
    expect(
      isWorkerRequest({
        id: 6,
        type: "render-animated-webp",
        scene: { type: "Canvas", width: 100, height: 100, children: [] },
      }),
    ).toBe(false);
  });

  it("returns true for valid render-animated-gif request", () => {
    const request: WorkerRequest = {
      id: 8,
      type: "render-animated-gif",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
      options: { durationMs: 500 },
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("accepts bounded layout-transition raster and frame-stream requests", () => {
    expect(
      isWorkerRequest({
        id: 20,
        type: "render-layout-transition-animated-webp",
        transition: TRANSITION,
        options: { durationMs: 300 },
      }),
    ).toBe(true);
    expect(
      isWorkerRequest({
        id: 21,
        type: "render-layout-transition-animated-gif",
        transition: TRANSITION,
        options: { durationMs: 300 },
      }),
    ).toBe(true);
    expect(
      isWorkerRequest({
        id: 22,
        type: "open-layout-transition-frame-stream",
        transition: TRANSITION,
        schedule: [{ index: 0, timeMs: 0 }],
        options: { format: "png" },
      }),
    ).toBe(true);
  });

  it("rejects invalid layout-transition Worker payloads", () => {
    expect(
      isWorkerRequest({
        id: 20,
        type: "render-layout-transition-animated-webp",
        transition: { states: { A: TRANSITION.states.A }, checkpoints: [] },
        options: {},
      }),
    ).toBe(false);
    expect(
      isWorkerRequest({
        id: 22,
        type: "open-layout-transition-frame-stream",
        transition: TRANSITION,
        schedule: [{ index: -1, timeMs: 0 }],
        options: { format: "png" },
      }),
    ).toBe(false);
  });

  it("returns false for render-animated-gif without options", () => {
    expect(
      isWorkerRequest({
        id: 8,
        type: "render-animated-gif",
        scene: { type: "Canvas", width: 100, height: 100, children: [] },
      }),
    ).toBe(false);
  });

  it("returns true for valid render-layered-svg request", () => {
    const request: WorkerRequest = {
      id: 30,
      type: "render-layered-svg",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("returns true for valid render-layered-png request", () => {
    const request: WorkerRequest = {
      id: 31,
      type: "render-layered-png",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it("returns true for valid dispose request", () => {
    const request: WorkerRequest = { id: 4, type: "dispose" };
    expect(isWorkerRequest(request)).toBe(true);
  });

  it.each([
    "layout-text-flow",
    "layout-text-flow-with-exclusions",
    "measure-text-block",
    "shrinkwrap-text",
    "shrinkwrap-flow",
    "measure-intrinsic-inline-size",
  ] as const)("accepts a structured %s request", (type) => {
    expect(isWorkerRequest({ id: 40, type, input: { fontFamily: "NotoSansJP" } })).toBe(true);
    expect(isWorkerRequest({ id: 40, type, input: null })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isWorkerRequest(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isWorkerRequest("string")).toBe(false);
    expect(isWorkerRequest(42)).toBe(false);
  });

  it("returns false for object without id", () => {
    expect(isWorkerRequest({ type: "init" })).toBe(false);
  });

  it("returns false for object without type", () => {
    expect(isWorkerRequest({ id: 1 })).toBe(false);
  });

  it("returns false for object with non-number id", () => {
    expect(isWorkerRequest({ id: "abc", type: "init" })).toBe(false);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
  ])("rejects non-correlatable request id %s", (id) => {
    expect(isWorkerRequest({ id, type: "init", fonts: [] })).toBe(false);
    expect(getWorkerMessageId({ id })).toBeUndefined();
  });

  it("validates a top-level Proxy without invoking its get trap", () => {
    let getCalls = 0;
    const request = new Proxy(
      { id: 1, type: "init", fonts: [] },
      {
        get() {
          getCalls += 1;
          throw new Error("get trap must not run");
        },
      },
    );

    expect(isWorkerRequest(request)).toBe(true);
    expect(getCalls).toBe(0);
  });

  it("keeps unrelated union keys outside the active request shape", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "render-svg",
        scene: { type: "Canvas", width: 10, height: 10, children: [] },
        fonts: "ignored unknown field",
      }),
    ).toBe(true);
    expect(
      isWorkerRequest({ id: 1, type: "init", fonts: [], schedule: "ignored unknown field" }),
    ).toBe(true);
  });

  it("returns false for object with non-string type", () => {
    expect(isWorkerRequest({ id: 1, type: 42 })).toBe(false);
  });

  it("returns false for unknown type value", () => {
    expect(isWorkerRequest({ id: 1, type: "bogus" })).toBe(false);
    expect(isWorkerRequest({ id: 1, type: "init-ok" })).toBe(false);
  });

  it("returns false for init without fonts array", () => {
    expect(isWorkerRequest({ id: 1, type: "init" })).toBe(false);
    expect(isWorkerRequest({ id: 1, type: "init", fonts: "not-array" })).toBe(false);
  });

  it("rejects sparse and accessor-backed request arrays without invoking accessors", () => {
    const sparseFonts = new Array(1);
    expect(isWorkerRequest({ id: 1, type: "init", fonts: sparseFonts })).toBe(false);

    let getterCalls = 0;
    const accessorFonts = new Array(1);
    Object.defineProperty(accessorFonts, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { alias: "sans", weight: 400, style: "normal", data: new ArrayBuffer(8) };
      },
    });
    expect(isWorkerRequest({ id: 1, type: "init", fonts: accessorFonts })).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("returns false for render-svg without scene", () => {
    expect(isWorkerRequest({ id: 1, type: "render-svg" })).toBe(false);
    expect(isWorkerRequest({ id: 1, type: "render-svg", scene: null })).toBe(false);
    expect(isWorkerRequest({ id: 1, type: "render-svg", scene: "string" })).toBe(false);
  });

  it("returns false for render-png without scene", () => {
    expect(isWorkerRequest({ id: 1, type: "render-png" })).toBe(false);
    expect(isWorkerRequest({ id: 1, type: "render-png", scene: null })).toBe(false);
  });

  it("returns false for render requests with non-SceneNode object payload", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "render-svg",
        scene: { props: {}, children: [] },
      }),
    ).toBe(false);
    expect(
      isWorkerRequest({
        id: 1,
        type: "render-png",
        scene: { children: [] },
      }),
    ).toBe(false);
  });

  it("returns false for init with null font entry", () => {
    expect(isWorkerRequest({ id: 1, type: "init", fonts: [null] })).toBe(false);
  });

  it("returns false for init with malformed font (non-string alias)", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "init",
        fonts: [{ alias: 1, weight: 400, style: "normal", data: new ArrayBuffer(8) }],
      }),
    ).toBe(false);
  });

  it("returns false for init with malformed font (non-number weight)", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "init",
        fonts: [{ alias: "sans", weight: "400", style: "normal", data: new ArrayBuffer(8) }],
      }),
    ).toBe(false);
  });

  it("returns false for init with malformed font (invalid style)", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "init",
        fonts: [{ alias: "sans", weight: 400, style: "bold", data: new ArrayBuffer(8) }],
      }),
    ).toBe(false);
  });

  it("returns false for init with malformed font (non-ArrayBuffer data)", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "init",
        fonts: [{ alias: "sans", weight: 400, style: "normal", data: new Uint8Array(8) }],
      }),
    ).toBe(false);
  });

  it("returns true for init with valid FontTransfer entries", () => {
    expect(
      isWorkerRequest({
        id: 1,
        type: "init",
        fonts: [
          { alias: "sans", weight: 400, style: "normal", data: new ArrayBuffer(8) },
          { alias: "mono", weight: 700, style: "italic", data: new ArrayBuffer(16) },
        ],
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isWorkerResponse
// ---------------------------------------------------------------------------

describe("isWorkerResponse", () => {
  it("returns true for valid init-ok response", () => {
    const response: WorkerResponse = { id: 1, type: "init-ok" };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns true for valid render-svg-ok response", () => {
    const response: RenderSvgOkResponse = {
      id: 2,
      type: "render-svg-ok",
      svg: "<svg></svg>",
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns true for valid render-animated-svg-ok response", () => {
    const response: RenderAnimatedSvgOkResponse = {
      id: 20,
      type: "render-animated-svg-ok",
      svg: "<svg></svg>",
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("validates nested IR in render-svg-and-ir-ok responses", () => {
    const response = {
      id: 3,
      type: "render-svg-and-ir-ok",
      svg: "<svg></svg>",
      ir: {
        root: {
          type: "group",
          nodeId: "root",
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          children: [
            {
              type: "rect",
              nodeId: "child",
              bbox: { x: 4, y: 4, w: 20, h: 10 },
              fill: "#123456",
            },
          ],
        },
        drawOrder: ["child", "root"],
        width: 100,
        height: 100,
      },
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);

    const malformedNestedIr = structuredClone(response);
    Reflect.set(malformedNestedIr.ir.root.children[0]?.bbox ?? {}, "w", "20");
    expect(isWorkerResponse(malformedNestedIr)).toBe(false);

    const unknownNestedVariant = structuredClone(response);
    Reflect.set(unknownNestedVariant.ir.root.children[0] ?? {}, "type", "video");
    expect(isWorkerResponse(unknownNestedVariant)).toBe(false);

    const duplicatedNestedWarnings = structuredClone(response);
    Reflect.set(duplicatedNestedWarnings.ir, "warnings", []);
    expect(isWorkerResponse(duplicatedNestedWarnings)).toBe(false);
  });

  it.each([
    "layout-text-flow-ok",
    "layout-text-flow-with-exclusions-ok",
    "measure-text-block-ok",
    "shrinkwrap-text-ok",
    "shrinkwrap-flow-ok",
    "measure-intrinsic-inline-size-ok",
  ] as const)("rejects a malformed %s measurement result", (type) => {
    expect(isWorkerResponse({ id: 8, type, result: { marker: type } })).toBe(false);
  });

  it("returns true for valid error response", () => {
    const response: WorkerResponse = {
      id: 3,
      type: "error",
      error: { severity: "fatal", code: "TEST", message: "test error" },
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isWorkerResponse(null)).toBe(false);
  });

  it("returns false for invalid objects", () => {
    expect(isWorkerResponse({})).toBe(false);
    expect(isWorkerResponse({ id: "abc", type: "ok" })).toBe(false);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    2 ** 53,
  ])("rejects non-correlatable response id %s", (id) => {
    expect(isWorkerResponse({ id, type: "dispose-ok" })).toBe(false);
    expect(getWorkerMessageId({ id })).toBeUndefined();
  });

  it("validates a top-level Proxy without invoking its get trap", () => {
    let getCalls = 0;
    const response = new Proxy(
      { id: 1, type: "render-svg-ok", svg: "<svg/>", warnings: [] },
      {
        get() {
          getCalls += 1;
          throw new Error("get trap must not run");
        },
      },
    );

    expect(isWorkerResponse(response)).toBe(true);
    expect(getCalls).toBe(0);
  });

  it("keeps unrelated union keys outside the active response shape", () => {
    expect(isWorkerResponse({ id: 1, type: "dispose-ok", warnings: "ignored unknown field" })).toBe(
      true,
    );
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-svg-ok",
        svg: "<svg/>",
        warnings: [],
        gif: "ignored unknown field",
      }),
    ).toBe(true);
  });

  it("returns false for unknown type value", () => {
    expect(isWorkerResponse({ id: 1, type: "bogus" })).toBe(false);
    expect(isWorkerResponse({ id: 1, type: "init" })).toBe(false);
  });

  it("returns true for dispose-ok response", () => {
    expect(isWorkerResponse({ id: 1, type: "dispose-ok" })).toBe(true);
  });

  it("returns true for valid render-png-ok response", () => {
    const response: RenderPngOkResponse = {
      id: 4,
      type: "render-png-ok",
      png: new Uint8Array([1, 2, 3]),
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns true for valid render-webp-ok response", () => {
    const response: RenderWebpOkResponse = {
      id: 5,
      type: "render-webp-ok",
      webp: new Uint8Array([1, 2, 3]),
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns false for render-webp-ok with non-Uint8Array webp", () => {
    expect(isWorkerResponse({ id: 5, type: "render-webp-ok", webp: [1, 2], warnings: [] })).toBe(
      false,
    );
  });

  it("returns true for valid render-animated-webp-ok response", () => {
    const response: RenderAnimatedWebpOkResponse = {
      id: 7,
      type: "render-animated-webp-ok",
      webp: new Uint8Array([1, 2, 3]),
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns false for render-animated-webp-ok with non-Uint8Array webp", () => {
    expect(
      isWorkerResponse({ id: 7, type: "render-animated-webp-ok", webp: [1, 2], warnings: [] }),
    ).toBe(false);
  });

  it("returns true for valid render-animated-gif-ok response", () => {
    const response: RenderAnimatedGifOkResponse = {
      id: 9,
      type: "render-animated-gif-ok",
      gif: new Uint8Array([1, 2, 3]),
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns false for render-animated-gif-ok with non-Uint8Array gif", () => {
    expect(
      isWorkerResponse({ id: 9, type: "render-animated-gif-ok", gif: [1, 2], warnings: [] }),
    ).toBe(false);
  });

  it("returns true for valid render-layered-svg-ok response", () => {
    const response: RenderLayeredSvgOkResponse = {
      id: 40,
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
            svg: "<svg></svg>",
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
          ],
        },
      },
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns false for render-layered-svg-ok with non-string layer svg", () => {
    expect(
      isWorkerResponse({
        id: 1,
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
              svg: 42,
            },
          ],
          manifest: {
            width: 100,
            height: 100,
            layers: [],
          },
        },
        warnings: [],
      }),
    ).toBe(false);
  });

  it("returns true for valid render-layered-png-ok response", () => {
    const response: RenderLayeredPngOkResponse = {
      id: 41,
      type: "render-layered-png-ok",
      result: {
        width: 100,
        height: 100,
        pixelWidth: 100,
        pixelHeight: 100,
        layers: [
          {
            id: "background",
            bbox: { x: 0, y: 0, width: 100, height: 100 },
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
          pixelWidth: 100,
          pixelHeight: 100,
          layers: [
            {
              id: "background",
              bbox: { x: 0, y: 0, width: 100, height: 100 },
              nodeIds: ["bg"],
              mode: "independent",
              paintOrder: 0,
              warnings: [],
            },
          ],
        },
      },
      warnings: [],
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("returns false for render-svg-ok missing svg", () => {
    expect(isWorkerResponse({ id: 1, type: "render-svg-ok", warnings: [] })).toBe(false);
  });

  it("returns false for render-svg-ok missing warnings", () => {
    expect(isWorkerResponse({ id: 1, type: "render-svg-ok", svg: "<svg/>" })).toBe(false);
  });

  it("returns false for render-svg-ok with non-string svg", () => {
    expect(isWorkerResponse({ id: 1, type: "render-svg-ok", svg: 42, warnings: [] })).toBe(false);
  });

  it("returns false for render-png-ok missing png", () => {
    expect(isWorkerResponse({ id: 1, type: "render-png-ok", warnings: [] })).toBe(false);
  });

  it("returns false for render-png-ok missing warnings", () => {
    expect(isWorkerResponse({ id: 1, type: "render-png-ok", png: new Uint8Array([1]) })).toBe(
      false,
    );
  });

  it("returns false for render-png-ok with non-Uint8Array png", () => {
    expect(isWorkerResponse({ id: 1, type: "render-png-ok", png: [1, 2], warnings: [] })).toBe(
      false,
    );
  });

  it("returns false for error response missing error object", () => {
    expect(isWorkerResponse({ id: 1, type: "error" })).toBe(false);
  });

  it("returns false for error response with null error", () => {
    expect(isWorkerResponse({ id: 1, type: "error", error: null })).toBe(false);
  });

  it("returns false for error response with non-object error", () => {
    expect(isWorkerResponse({ id: 1, type: "error", error: "string" })).toBe(false);
  });

  it("returns false for error response with empty object (missing severity/code/message)", () => {
    expect(isWorkerResponse({ id: 1, type: "error", error: {} })).toBe(false);
  });

  it("returns false for a partial serialized fatal diagnostic", () => {
    expect(
      isWorkerResponse({ id: 1, type: "error", error: { severity: "fatal", code: "X" } }),
    ).toBe(false);
  });

  it("returns false for render-svg-ok with malformed recoverable warnings", () => {
    expect(isWorkerResponse({ id: 1, type: "render-svg-ok", svg: "<svg/>", warnings: [123] })).toBe(
      false,
    );
    expect(
      isWorkerResponse({ id: 1, type: "render-svg-ok", svg: "<svg/>", warnings: [null] }),
    ).toBe(false);
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-svg-ok",
        svg: "<svg/>",
        warnings: [{ severity: "fatal" }],
      }),
    ).toBe(false);
  });

  it("rejects sparse, accessor-backed, and hostile warning arrays without reading them", () => {
    const response = { id: 1, type: "render-svg-ok", svg: "<svg/>" };
    const sparseWarnings = new Array(1);
    expect(isWorkerResponse({ ...response, warnings: sparseWarnings })).toBe(false);

    let getterCalls = 0;
    const accessorWarnings = new Array(1);
    Object.defineProperty(accessorWarnings, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {
          severity: "recoverable",
          code: "WARN",
          message: "warning",
          fallback: "continued",
          stage: "emit",
        };
      },
    });
    expect(isWorkerResponse({ ...response, warnings: accessorWarnings })).toBe(false);
    expect(getterCalls).toBe(0);

    let descriptorCalls = 0;
    const hostileWarnings = new Proxy([], {
      getOwnPropertyDescriptor() {
        descriptorCalls += 1;
        throw new Error("descriptor must be contained");
      },
    });
    expect(isWorkerResponse({ ...response, warnings: hostileWarnings })).toBe(false);
    expect(descriptorCalls).toBe(1);
  });

  it("returns true for render-svg-ok with valid serialized recoverable warnings", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-svg-ok",
        svg: "<svg/>",
        warnings: [
          {
            severity: "recoverable",
            code: "WARN",
            message: "test",
            fallback: "continued",
            stage: "emit",
          },
        ],
      }),
    ).toBe(true);
  });

  it("snapshots each warning descriptor once and detaches the validated payload", () => {
    const warning = {
      severity: "recoverable" as const,
      code: "WARN",
      message: "original warning",
      fallback: "continued",
      stage: "emit" as const,
      context: { owner: { id: "original" } },
    };
    let entryDescriptorCalls = 0;
    const warnings = new Proxy([warning] as unknown[], {
      getOwnPropertyDescriptor(target, key) {
        if (key === "0") {
          entryDescriptorCalls += 1;
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: entryDescriptorCalls === 1 ? warning : 0,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    const decoded = decodeWorkerResponse({
      id: 1,
      type: "render-svg-ok",
      svg: "<svg/>",
      warnings,
    });

    expect(decoded?.type).toBe("render-svg-ok");
    if (decoded?.type !== "render-svg-ok") {
      throw new TypeError("expected a decoded SVG response");
    }
    expect(entryDescriptorCalls).toBe(1);
    expect(decoded.warnings[0]).toEqual(warning);
    expect(decoded.warnings[0]).not.toBe(warning);
    expect(decoded.warnings[0]?.context).not.toBe(warning.context);

    warning.message = "mutated warning";
    warning.context.owner.id = "mutated";
    expect(decoded.warnings[0]?.message).toBe("original warning");
    expect(decoded.warnings[0]?.context).toEqual({ owner: { id: "original" } });
  });

  it("returns false for render-png-ok with malformed recoverable warnings", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-png-ok",
        png: new Uint8Array([1]),
        warnings: ["not an error"],
      }),
    ).toBe(false);
  });

  it("returns true for render-png-ok with valid serialized recoverable warnings", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-png-ok",
        png: new Uint8Array([1]),
        warnings: [
          {
            severity: "recoverable",
            code: "W",
            message: "w",
            fallback: "continued",
            stage: "emit",
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false for error with invalid severity value", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "oops", code: "X", message: "m" },
      }),
    ).toBe(false);
  });

  it("returns false for error with invalid stage value", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", stage: "bogus" },
      }),
    ).toBe(false);
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", stage: 123 },
      }),
    ).toBe(false);
  });

  it("returns true for error with valid optional stage", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", stage: "engine" },
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", stage: "validate" },
      }),
    ).toBe(true);
  });

  it("detaches a validated fatal diagnostic from the response payload", () => {
    const error = {
      severity: "fatal" as const,
      code: "WORKER_FAILURE",
      message: "original failure",
      stage: "engine" as const,
      context: { owner: { id: "original" } },
    };

    const decoded = decodeWorkerResponse({ id: 1, type: "error", error });

    expect(decoded?.type).toBe("error");
    if (decoded?.type !== "error") {
      throw new TypeError("expected a decoded error response");
    }
    expect(decoded.error).toEqual(error);
    expect(decoded.error).not.toBe(error);
    expect(decoded.error.context).not.toBe(error.context);

    error.message = "mutated failure";
    error.context.owner.id = "mutated";
    expect(decoded.error.message).toBe("original failure");
    expect(decoded.error.context).toEqual({ owner: { id: "original" } });
  });

  it("returns false for warning with invalid severity", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-svg-ok",
        svg: "<svg/>",
        warnings: [{ severity: "warning", code: "W", message: "w" }],
      }),
    ).toBe(false);
  });

  it("returns false for error with non-string nodeId", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", nodeId: 123 },
      }),
    ).toBe(false);
  });

  it("returns false for error with non-string fallback", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", fallback: true },
      }),
    ).toBe(false);
  });

  it("returns false for error with non-object context", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", context: "string" },
      }),
    ).toBe(false);
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: { severity: "fatal", code: "X", message: "m", context: null },
      }),
    ).toBe(false);
  });

  it("returns true for a fatal error with all permitted optional fields", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "error",
        error: {
          severity: "fatal",
          code: "X",
          message: "m",
          stage: "emit",
          nodeId: "node-1",
          context: { key: "value" },
        },
      }),
    ).toBe(true);
  });

  it("returns false for render-svg-ok with fatal warning", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-svg-ok",
        svg: "<svg/>",
        warnings: [{ severity: "fatal", code: "X", message: "m" }],
      }),
    ).toBe(false);
  });

  it("returns false for render-png-ok with fatal warning", () => {
    expect(
      isWorkerResponse({
        id: 1,
        type: "render-png-ok",
        png: new Uint8Array([1]),
        warnings: [{ severity: "fatal", code: "X", message: "m" }],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectRequestTransferables
// ---------------------------------------------------------------------------

describe("collectRequestTransferables", () => {
  it("returns font ArrayBuffers for init request", () => {
    const buf1 = new ArrayBuffer(10);
    const buf2 = new ArrayBuffer(20);
    const fonts: FontTransfer[] = [
      { alias: "sans", weight: 400, style: "normal", data: buf1 },
      { alias: "mono", weight: 700, style: "normal", data: buf2 },
    ];
    const request: InitRequest = { id: 1, type: "init", fonts };
    const transferables = collectRequestTransferables(request);
    expect(transferables).toEqual([buf1, buf2]);
  });

  it("deduplicates shared font ArrayBuffers in first-appearance order", () => {
    const buf1 = new ArrayBuffer(10);
    const buf2 = new ArrayBuffer(20);
    const fonts: FontTransfer[] = [
      { alias: "sans", weight: 400, style: "normal", data: buf1 },
      { alias: "mono", weight: 400, style: "normal", data: buf2 },
      { alias: "sans-bold", weight: 700, style: "normal", data: buf1 },
      { alias: "mono-bold", weight: 700, style: "normal", data: buf2 },
    ];
    const request: InitRequest = { id: 1, type: "init", fonts };

    expect(collectRequestTransferables(request)).toEqual([buf1, buf2]);
  });

  it("returns empty array for render-svg request", () => {
    const request: WorkerRequest = {
      id: 2,
      type: "render-svg",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(collectRequestTransferables(request)).toEqual([]);
  });

  it("returns empty array for render-png request", () => {
    const request: WorkerRequest = {
      id: 3,
      type: "render-png",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(collectRequestTransferables(request)).toEqual([]);
  });

  it("returns empty array for render-layered-svg request", () => {
    const request: WorkerRequest = {
      id: 32,
      type: "render-layered-svg",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(collectRequestTransferables(request)).toEqual([]);
  });

  it("returns empty array for render-layered-png request", () => {
    const request: WorkerRequest = {
      id: 33,
      type: "render-layered-png",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
    };
    expect(collectRequestTransferables(request)).toEqual([]);
  });

  it("returns empty array for dispose request", () => {
    const request: WorkerRequest = { id: 4, type: "dispose" };
    expect(collectRequestTransferables(request)).toEqual([]);
  });

  it("returns empty array for init with no fonts", () => {
    const request: InitRequest = { id: 5, type: "init", fonts: [] };
    expect(collectRequestTransferables(request)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectResponseTransferables
// ---------------------------------------------------------------------------

describe("collectResponseTransferables", () => {
  it("returns PNG buffer for render-png-ok response", () => {
    const png = new Uint8Array([1, 2, 3]);
    const response: RenderPngOkResponse = {
      id: 1,
      type: "render-png-ok",
      png,
      warnings: [],
    };
    const transferables = collectResponseTransferables(response);
    expect(transferables).toHaveLength(1);
    expect(transferables[0]).toBe(png.buffer);
  });

  it("returns WebP buffer for render-webp-ok response", () => {
    const webp = new Uint8Array([1, 2, 3]);
    const response: RenderWebpOkResponse = {
      id: 2,
      type: "render-webp-ok",
      webp,
      warnings: [],
    };
    const transferables = collectResponseTransferables(response);
    expect(transferables).toHaveLength(1);
    expect(transferables[0]).toBe(webp.buffer);
  });

  it("returns WebP buffer for render-animated-webp-ok response", () => {
    const webp = new Uint8Array([1, 2, 3]);
    const response: RenderAnimatedWebpOkResponse = {
      id: 3,
      type: "render-animated-webp-ok",
      webp,
      warnings: [],
    };
    const transferables = collectResponseTransferables(response);
    expect(transferables).toHaveLength(1);
    expect(transferables[0]).toBe(webp.buffer);
  });

  it("returns GIF buffer for render-animated-gif-ok response", () => {
    const gif = new Uint8Array([1, 2, 3]);
    const response: RenderAnimatedGifOkResponse = {
      id: 4,
      type: "render-animated-gif-ok",
      gif,
      warnings: [],
    };
    const transferables = collectResponseTransferables(response);
    expect(transferables).toHaveLength(1);
    expect(transferables[0]).toBe(gif.buffer);
  });

  it("returns all layer PNG buffers for render-layered-png-ok response", () => {
    const layerPngA = new Uint8Array([1]);
    const layerPngB = new Uint8Array([2]);
    const response: WorkerResponse = {
      id: 11,
      type: "render-layered-png-ok",
      result: {
        width: 100,
        height: 100,
        pixelWidth: 100,
        pixelHeight: 100,
        layers: [
          {
            id: "background",
            bbox: null,
            nodeIds: ["bg"],
            mode: "independent",
            paintOrder: 0,
            warnings: [],
            png: layerPngA,
          },
          {
            id: "text",
            bbox: null,
            nodeIds: ["title"],
            mode: "independent",
            paintOrder: 1,
            warnings: [],
            png: layerPngB,
          },
        ],
        manifest: {
          width: 100,
          height: 100,
          pixelWidth: 100,
          pixelHeight: 100,
          layers: [
            {
              id: "background",
              bbox: null,
              nodeIds: ["bg"],
              mode: "independent",
              paintOrder: 0,
              warnings: [],
            },
            {
              id: "text",
              bbox: null,
              nodeIds: ["title"],
              mode: "independent",
              paintOrder: 1,
              warnings: [],
            },
          ],
        },
      },
      warnings: [],
    };

    const transferables = collectResponseTransferables(response);
    expect(transferables).toEqual([layerPngA.buffer, layerPngB.buffer]);
  });

  it("returns empty array for init-ok response", () => {
    const response: WorkerResponse = { id: 1, type: "init-ok" };
    expect(collectResponseTransferables(response)).toEqual([]);
  });

  it("returns empty array for render-svg-ok response", () => {
    const response: RenderSvgOkResponse = {
      id: 2,
      type: "render-svg-ok",
      svg: "<svg></svg>",
      warnings: [],
    };
    expect(collectResponseTransferables(response)).toEqual([]);
  });

  it("returns empty array for render-layered-svg-ok response", () => {
    const response: WorkerResponse = {
      id: 12,
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
            svg: "<svg></svg>",
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
          ],
        },
      },
      warnings: [],
    };
    expect(collectResponseTransferables(response)).toEqual([]);
  });

  it("returns empty array for error response", () => {
    const response: WorkerResponse = {
      id: 3,
      type: "error",
      error: { severity: "fatal", code: "TEST", message: "test" },
    };
    expect(collectResponseTransferables(response)).toEqual([]);
  });

  it("returns empty array for dispose-ok response", () => {
    const response: WorkerResponse = { id: 4, type: "dispose-ok" };
    expect(collectResponseTransferables(response)).toEqual([]);
  });
});

describe("prepared frame stream protocol", () => {
  it("accepts valid open, next, and close requests", () => {
    expect(
      isWorkerRequest({
        id: 10,
        type: "open-frame-stream",
        scene: { type: "Canvas", width: 100, height: 100, children: [] },
        schedule: [
          { index: 4, timeMs: 600 },
          { index: 1, timeMs: 0 },
        ],
        options: { format: "svg" },
      }),
    ).toBe(true);
    expect(isWorkerRequest({ id: 11, type: "next-frame-stream", streamId: 10 })).toBe(true);
    expect(isWorkerRequest({ id: 12, type: "close-frame-stream", streamId: 10 })).toBe(true);
  });

  it("rejects malformed frame stream requests", () => {
    const scene = { type: "Canvas", width: 100, height: 100, children: [] };
    expect(
      isWorkerRequest({
        id: 10,
        type: "open-frame-stream",
        scene,
        schedule: [{ index: 0, timeMs: Number.NaN }],
        options: { format: "svg" },
      }),
    ).toBe(false);
    expect(
      isWorkerRequest({
        id: 10,
        type: "open-frame-stream",
        scene,
        schedule: [{ index: -1, timeMs: 0 }],
        options: { format: "svg" },
      }),
    ).toBe(false);
    expect(
      isWorkerRequest({
        id: 10,
        type: "open-frame-stream",
        scene,
        schedule: [],
        options: { format: "webp" },
      }),
    ).toBe(false);
    expect(isWorkerRequest({ id: 11, type: "next-frame-stream", streamId: 0 })).toBe(false);
  });

  it("validates open, SVG next, PNG next, done, and close responses", () => {
    expect(
      isWorkerResponse({
        id: 10,
        type: "open-frame-stream-ok",
        streamId: 10,
        warnings: [],
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        id: 11,
        type: "next-frame-stream-ok",
        streamId: 10,
        done: false,
        frame: { index: 0, timeMs: 0, format: "svg", data: "<svg/>" },
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        id: 12,
        type: "next-frame-stream-ok",
        streamId: 10,
        done: false,
        frame: { index: 1, timeMs: 10, format: "png", data: new Uint8Array([1]) },
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        id: 13,
        type: "next-frame-stream-ok",
        streamId: 10,
        done: true,
      }),
    ).toBe(true);
    expect(isWorkerResponse({ id: 14, type: "close-frame-stream-ok", streamId: 10 })).toBe(true);
  });

  it("rejects malformed next responses and transfers PNG frame bytes", () => {
    expect(
      isWorkerResponse({
        id: 11,
        type: "next-frame-stream-ok",
        streamId: 10,
        done: false,
        frame: { index: 0, timeMs: 0, format: "svg", data: new Uint8Array([1]) },
      }),
    ).toBe(false);
    expect(
      isWorkerResponse({
        id: 11,
        type: "next-frame-stream-ok",
        streamId: 10,
        done: false,
      }),
    ).toBe(false);

    const png = new Uint8Array([1, 2, 3]);
    expect(
      collectResponseTransferables({
        id: 12,
        type: "next-frame-stream-ok",
        streamId: 10,
        done: false,
        frame: { index: 0, timeMs: 0, format: "png", data: png },
      }),
    ).toEqual([png.buffer]);
  });
});
