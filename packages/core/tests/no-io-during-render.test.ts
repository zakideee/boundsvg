/**
 * Contract test: the render pipeline never calls `globalThis.fetch`.
 *
 * All image and font bytes must be injected by the caller. This test replaces
 * `globalThis.fetch` with a throwing stub and exercises the render entry
 * points to detect a future "convenience fetch" creeping into the pipeline.
 * Scope: it guards runtime `fetch` lookups only — a module-scope alias of
 * `fetch` captured before the stub, or other I/O channels, would need their
 * own detection.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Engine } from "../src/engine.js";
import { createElement } from "../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "./helpers/wasm-render-engine.js";

const fetchStub = vi.fn(() => {
  throw new Error("core must not perform network I/O during render");
});

let handle: WasmEngineHandle;

// WASM loading happens here, before fetch is stubbed — the stub guards the
// render calls only.
beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchStub.mockClear();
});

function createTestEngine(): Engine {
  return createEngineFromHandle(handle, {
    svgToPngFn: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });
}

// Covers the two image paths that could tempt an implicit fetch: embedded
// bytes (data URI encoding) and an external URL reference (pass-through).
const sceneWithImages = createElement(
  "Canvas",
  { width: 200, height: 200 },
  createElement("Image", {
    src: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mediaType: "image/png",
    width: 50,
    height: 50,
  }),
  createElement("Image", {
    src: "https://example.test/remote.png",
    width: 50,
    height: 50,
  }),
);

describe("no I/O during render", () => {
  it("renderToSvg does not call fetch", () => {
    vi.stubGlobal("fetch", fetchStub);
    const engine = createTestEngine();

    const svg = engine.renderToSvg(sceneWithImages);

    expect(svg).toContain("<svg");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("renderToPng does not call fetch", () => {
    vi.stubGlobal("fetch", fetchStub);
    const engine = createTestEngine();

    const png = engine.renderToPng(sceneWithImages);

    expect(png[0]).toBe(0x89);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("compile does not call fetch", () => {
    vi.stubGlobal("fetch", fetchStub);
    const engine = createTestEngine();

    const compiled = engine.compile(sceneWithImages);

    expect(engine.snapshotCompiledIR(compiled).root).toBeDefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
