import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  EmitAnimatedSvgOptions,
  Engine,
  RenderAnimatedSvgOptions,
  RenderPngOptions,
  RenderSvgOptions,
} from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  engine.dispose();
  handle.dispose();
});

function staticScene() {
  return createElement(
    "Canvas",
    { width: 80, height: 40, background: "#f8fafc" },
    createElement("Box", {
      id: "static-box",
      width: 20,
      height: 16,
      background: "#2563eb",
    }),
  );
}

function animatedScene() {
  return createElement(
    "Canvas",
    { width: 80, height: 40, background: "#f8fafc" },
    createElement("Box", {
      id: "animated-box",
      width: 20,
      height: 16,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0.25 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 400,
        easing: "linear",
        iterations: "infinite",
      },
    }),
  );
}

function scaleScene() {
  return createElement(
    "Canvas",
    { width: 80, height: 40 },
    createElement("Box", {
      id: "canvas-stroke-box",
      width: 24,
      height: 16,
      borderWidth: 1,
      borderColor: "#0f172a",
      strokeScaling: "canvas",
      animate: {
        keyframes: [
          { at: 0, opacity: 1 },
          { at: 1, opacity: 0.5 },
        ],
        durationMs: 400,
        easing: "linear",
      },
    }),
    createElement("Path", {
      id: "ordinary-stroke-path",
      d: "M0 0H10",
      width: 10,
      height: 4,
      fill: "none",
      stroke: "#ef4444",
      strokeWidth: 3,
    }),
  );
}

function metadataScene() {
  return createElement(
    "Canvas",
    { width: 80, height: 40, meta: { scope: "kept-meta" } },
    createElement("Svg", {
      id: "raw-wrapper",
      width: 20,
      height: 20,
      viewBox: "0 0 20 20",
      content:
        '<path data-boundsvg-node-id="raw-authored" data-boundsvg-part-id="raw-part" d="M0 0H20V20Z"/>',
    }),
  );
}

function captureFatal(run: () => unknown): FatalError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("Expected a FatalError");
}

function expectFatalCode(run: () => unknown, code: string): void {
  expect(captureFatal(run).code).toBe(code);
}

describe("SVG document emission 0.3 contract", () => {
  it("separates static sampling from independent animated SVG emission", () => {
    expect(engine.renderToSvg(staticScene())).toContain("<svg");

    const source = animatedScene();
    const compiled = engine.compile(source);
    for (const render of [
      () => engine.renderToSvg(source),
      () => engine.renderToSvgAndIR(source),
      () => engine.renderCompiledToSvg(compiled),
      () => engine.renderToLayeredSvg(source),
    ]) {
      expectFatalCode(render, "STATIC_ANIMATION_TIME_REQUIRED");
    }

    const staticSvg = engine.renderToSvg(source, { timeMs: 0 });
    expect(engine.renderToSvgAndIR(source, { timeMs: 0 }).svg).toBe(staticSvg);
    expect(engine.renderCompiledToSvg(compiled, { timeMs: 0 })).toBe(staticSvg);
    expect(engine.renderToLayeredSvg(source, { timeMs: 0 }).manifest.animated).toBe(true);
    expect(staticSvg).not.toContain("@keyframes");

    const animatedOptions = { playback: { mode: "independent" } } as const;
    const animatedSvg = engine.renderToAnimatedSvg(source, animatedOptions);
    expect(engine.renderToAnimatedSvgAndIR(source, animatedOptions).svg).toBe(animatedSvg);
    expect(engine.renderCompiledToAnimatedSvg(compiled, animatedOptions)).toBe(animatedSvg);
    expect(animatedSvg).toContain("@keyframes");
  });

  it("rejects malformed playback, legacy, and unknown options", () => {
    const source = animatedScene();
    const compiled = engine.compile(source);

    expectFatalCode(
      () => engine.renderToAnimatedSvg(source, {} as RenderAnimatedSvgOptions),
      "UNSUPPORTED_ANIMATED_SVG_PLAYBACK",
    );
    expectFatalCode(
      () =>
        engine.renderToAnimatedSvg(source, {
          playback: { mode: "timeline" },
        } as unknown as RenderAnimatedSvgOptions),
      "ANIMATED_SVG_INVALID_TIMELINE",
    );
    expectFatalCode(
      () =>
        engine.renderCompiledToAnimatedSvg(compiled, {
          playback: { mode: "independent", timeline: [] },
        } as unknown as EmitAnimatedSvgOptions),
      "UNSUPPORTED_RENDER_OPTION",
    );
    expectFatalCode(
      () =>
        engine.renderToAnimatedSvg(source, {
          playback: { mode: "independent" },
          timeline: [],
        } as unknown as RenderAnimatedSvgOptions),
      "UNSUPPORTED_RENDER_OPTION",
    );
    for (const documentOption of [{ durationMs: 400 }, { iterations: 2 }]) {
      expectFatalCode(
        () =>
          engine.renderToAnimatedSvg(source, {
            playback: { mode: "independent" },
            ...documentOption,
          } as unknown as RenderAnimatedSvgOptions),
        "UNSUPPORTED_RENDER_OPTION",
      );
    }
    expectFatalCode(
      () =>
        engine.renderToSvg(source, {
          timeMs: 0,
          animation: "static",
        } as unknown as RenderSvgOptions),
      "UNSUPPORTED_LEGACY_RENDER_OPTION",
    );
    expectFatalCode(
      () =>
        engine.renderToPng(staticScene(), {
          loop: 0,
        } as unknown as RenderPngOptions),
      "UNSUPPORTED_LEGACY_RENDER_OPTION",
    );
    expectFatalCode(
      () =>
        engine.renderToSvg(staticScene(), {
          unknownOption: true,
        } as unknown as RenderSvgOptions),
      "UNSUPPORTED_RENDER_OPTION",
    );
    expectFatalCode(
      () =>
        engine.renderToPng(staticScene(), {
          resourceIdPrefix: "svg-only",
        } as unknown as RenderPngOptions),
      "UNSUPPORTED_RENDER_OPTION",
    );
    expectFatalCode(
      () =>
        engine.renderFrames(staticScene(), {
          format: "png",
          timesMs: [0],
          nodeIdMetadata: "omit",
        } as never),
      "UNSUPPORTED_RENDER_OPTION",
    );
  });

  it("rehydrates the same structured failures from the Rust option boundary", () => {
    const staticGuardEngine = createEngineFromHandle(handle, {
      renderToSvgFn: (inputJson, optionsJson) => {
        const options = JSON.parse(optionsJson) as Record<string, unknown>;
        return handle.renderToSvg(
          inputJson,
          JSON.stringify({ ...options, reducedMotion: "pause" }),
        );
      },
    });
    const animatedGuardEngine = createEngineFromHandle(handle, {
      renderToAnimatedSvgFn: (inputJson, optionsJson) => {
        const options = JSON.parse(optionsJson) as Record<string, unknown>;
        return handle.renderToAnimatedSvg(inputJson, JSON.stringify({ ...options, timeline: [] }));
      },
    });
    const playbackGuardEngine = createEngineFromHandle(handle, {
      renderToAnimatedSvgFn: (inputJson, optionsJson) => {
        const options = JSON.parse(optionsJson) as Record<string, unknown>;
        return handle.renderToAnimatedSvg(
          inputJson,
          JSON.stringify({ ...options, playback: { mode: "timeline" } }),
        );
      },
    });

    try {
      expectFatalCode(
        () => staticGuardEngine.renderToSvg(staticScene()),
        "UNSUPPORTED_RENDER_OPTION",
      );
      expectFatalCode(
        () =>
          animatedGuardEngine.renderToAnimatedSvg(animatedScene(), {
            playback: { mode: "independent" },
          }),
        "UNSUPPORTED_RENDER_OPTION",
      );
      expectFatalCode(
        () =>
          playbackGuardEngine.renderToAnimatedSvg(animatedScene(), {
            playback: { mode: "independent" },
          }),
        "ANIMATED_SVG_INVALID_TIMELINE",
      );
    } finally {
      staticGuardEngine.dispose();
      animatedGuardEngine.dispose();
      playbackGuardEngine.dispose();
    }
  });

  it("defaults node metadata to include and toggles one compiled scene without mutating IR", () => {
    const source = metadataScene();
    const generator = { name: "metadata-test", version: "0.3.0" };
    const defaultResult = engine.renderToSvgAndIR(source, { generator });
    const includedResult = engine.renderToSvgAndIR(source, {
      generator,
      nodeIdMetadata: "include",
    });
    const omittedResult = engine.renderToSvgAndIR(source, {
      generator,
      nodeIdMetadata: "omit",
    });

    expect(includedResult.svg).toBe(defaultResult.svg);
    expect(omittedResult.ir).toEqual(includedResult.ir);
    expect(defaultResult.svg).toContain('data-boundsvg-node-id="auto:0"');
    expect(omittedResult.svg).not.toContain('data-boundsvg-node-id="auto:0"');
    expect(omittedResult.svg).not.toContain('data-boundsvg-node-id="raw-wrapper"');
    expect(omittedResult.svg).toContain('data-boundsvg-node-id="raw-authored"');
    expect(omittedResult.svg).toContain('data-boundsvg-part-id="raw-part"');
    expect(omittedResult.svg).toContain('data-boundsvg-meta-scope="kept-meta"');
    expect(omittedResult.svg).toContain('data-boundsvg-generator="metadata-test"');

    const compiled = engine.compile(source);
    const compiledIrBefore = JSON.stringify(engine.snapshotCompiledIR(compiled));
    const compiledIncluded = engine.renderCompiledToSvg(compiled, {
      generator,
      nodeIdMetadata: "include",
    });
    const compiledOmitted = engine.renderCompiledToSvg(compiled, {
      generator,
      nodeIdMetadata: "omit",
    });
    expect(compiledIncluded).toBe(defaultResult.svg);
    expect(compiledOmitted).toBe(omittedResult.svg);
    expect(JSON.stringify(engine.snapshotCompiledIR(compiled))).toBe(compiledIrBefore);
  });

  it("keeps SVG scale semantics identical across static and animated direct/compiled paths", () => {
    const source = scaleScene();
    const compiled = engine.compile(source);
    const playback = { mode: "independent" } as const;
    const outputPairs = [
      [
        engine.renderToSvg(source, { scale: 1, timeMs: 0 }),
        engine.renderToSvg(source, { scale: 2, timeMs: 0 }),
      ],
      [
        engine.renderCompiledToSvg(compiled, { scale: 1, timeMs: 0 }),
        engine.renderCompiledToSvg(compiled, { scale: 2, timeMs: 0 }),
      ],
      [
        engine.renderToAnimatedSvg(source, { scale: 1, playback }),
        engine.renderToAnimatedSvg(source, { scale: 2, playback }),
      ],
      [
        engine.renderCompiledToAnimatedSvg(compiled, { scale: 1, playback }),
        engine.renderCompiledToAnimatedSvg(compiled, { scale: 2, playback }),
      ],
    ] as const;

    for (const [unitSvg, doubledSvg] of outputPairs) {
      expect(unitSvg).toContain('width="80" height="40"');
      expect(doubledSvg).toContain('width="160" height="80"');
      expect(unitSvg).toContain('viewBox="0 0 80 40"');
      expect(doubledSvg).toContain('viewBox="0 0 80 40"');
      expect(unitSvg).toContain('d="M0 0H10"');
      expect(doubledSvg).toContain('d="M0 0H10"');
      expect(unitSvg).toContain('stroke="#ef4444" stroke-width="3"');
      expect(doubledSvg).toContain('stroke="#ef4444" stroke-width="3"');
      expect(unitSvg).toContain("stroke-width: 1;");
      expect(doubledSvg).toContain("stroke-width: 2;");
    }
    expect(outputPairs[0]).toEqual(outputPairs[1]);
    expect(outputPairs[2]).toEqual(outputPairs[3]);
  });
});
