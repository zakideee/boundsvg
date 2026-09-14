import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initNodeWasm } from "../../src/node.js";
import { getWasm } from "../../src/wasm/index.js";
import type { WasmEngineInstance } from "../../src/wasm/types.js";

/** A text-free valid scene keeps option failures independent of font setup. */
const LAYOUT_JSON = JSON.stringify({
  root: {
    nodeId: "scene",
    nodeType: "canvas",
    authoredId: true,
    style: { width: 100, height: 80 },
    children: [],
  },
});

const commonOptions = {
  scale: 1,
  debug: false,
  rasterizerCompat: false,
  resourceIdPrefix: "scene-",
  nodeIdMetadata: "include",
  textPathMode: "merged",
  showMissingGlyphs: false,
  timeMs: 0,
  returnResolvedIr: false,
  preserveResolvedUnitOutlines: false,
  generator: { name: "example", version: "1.0.0" },
};

describe("render option wire presence", () => {
  let instance: WasmEngineInstance | undefined;

  beforeAll(async () => {
    await initNodeWasm();
  });

  afterEach(() => {
    instance?.free();
    instance = undefined;
  });

  it.each([
    "static",
    "animated",
    "ir",
  ] as const)("rejects present null through %s decoding", (route) => {
    instance = new (getWasm().BoundSvgEngine)();
    const backend = instance;
    const options: Record<string, unknown> = { ...commonOptions };
    if (route === "animated") {
      options.playback = { mode: "independent" };
      options.reducedMotion = "keep";
    } else if (route === "ir") {
      options.animation = "static";
      options.reducedMotion = "keep";
      options.sampleAnimation = false;
    }
    const renderMethod =
      route === "static"
        ? backend.render_to_svg
        : route === "animated"
          ? backend.render_to_animated_svg
          : backend.render_to_ir;
    if (!renderMethod) {
      throw new Error(`Missing render method for ${route}`);
    }
    const render = (optionsJson: string): string =>
      renderMethod.call(backend, LAYOUT_JSON, optionsJson);
    expect(render(JSON.stringify(options))).not.toBe("");
    for (const field of Object.keys(options).filter((key) => key !== "playback")) {
      const omitted = { ...options };
      delete omitted[field];
      expect(render(JSON.stringify(omitted))).not.toBe("");
      const presentNull = JSON.stringify({ ...options, [field]: null });
      expect(() => render(presentNull)).toThrow(
        route === "ir" ? /Invalid SVG emit options JSON/u : /UNSUPPORTED_RENDER_OPTION/u,
      );
    }
    expect(() => render(JSON.stringify({ ...options, debug: { parts: null } }))).toThrow();
  });

  it("keeps timeline diagnostic priority over optional decode failures", () => {
    instance = new (getWasm().BoundSvgEngine)();
    const backend = instance;
    const renderAnimatedSvg = backend.render_to_animated_svg;
    if (!renderAnimatedSvg) {
      throw new Error("Missing animated SVG render method");
    }
    expect(() =>
      renderAnimatedSvg.call(
        backend,
        LAYOUT_JSON,
        JSON.stringify({
          playback: { mode: "timeline", durationMs: null, iterations: 1 },
          scale: null,
        }),
      ),
    ).toThrow(/ANIMATED_SVG_INVALID_TIMELINE/u);
    expect(() =>
      renderAnimatedSvg.call(
        backend,
        LAYOUT_JSON,
        JSON.stringify({
          playback: { mode: "timeline", durationMs: 1000, iterations: 1 },
          timeMs: null,
        }),
      ),
    ).toThrow(/ANIMATED_SVG_INVALID_TIMELINE/u);
  });
});
