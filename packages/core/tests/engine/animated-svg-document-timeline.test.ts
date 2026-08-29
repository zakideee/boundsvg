import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AnimationIterationCount,
  AnimationSpec,
  AnimationTimeline,
  EmitAnimatedSvgOptions,
  Engine,
  RenderAnimatedSvgOptions,
} from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { animatedSvgTimelineLimits } from "../../src/render-capabilities.js";
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

function timelineScene(easing: "linear" | { type: "spring" } = "linear") {
  return createElement(
    "Canvas",
    { width: 96, height: 48, background: "#f8fafc" },
    createElement("Box", {
      id: "timeline-box",
      width: 32,
      height: 20,
      background: "#2563eb",
      opacity: 0.25,
      animate: {
        keyframes: [
          { at: 0, opacity: 0.2 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 400,
        easing,
        iterations: 1,
        fill: "none",
      },
    }),
  );
}

type EndpointOwner = "node" | "textUnit";
type EndpointChannel = "opacity" | "transform";

function exactEndpointScene(owner: EndpointOwner, channel: EndpointChannel, seam: boolean) {
  const valueA = 0.5;
  const valueB = valueA + Number.EPSILON / 2;
  const keyframe = (at: number, value: number) =>
    channel === "opacity" ? { at, opacity: value } : { at, transform: { translateX: value } };
  const animation: AnimationSpec = {
    keyframes: seam
      ? [keyframe(0, valueA), keyframe(1, valueB)]
      : [keyframe(0, valueA), keyframe(0.5, valueB), keyframe(1, valueB)],
    durationMs: seam ? 100 : 200,
    easing: "linear",
    iterations: seam ? "infinite" : 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: `${channel}-endpoint-node`,
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: `${channel}-endpoint-text`,
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
}

function clampRootScene(owner: EndpointOwner, withTransform: boolean) {
  const animation: AnimationSpec = {
    keyframes: [
      {
        at: 0,
        opacity: 0,
        ...(withTransform ? { transform: { translateX: 7 } } : {}),
      },
      {
        at: 1,
        opacity: 1,
        ...(withTransform ? { transform: { translateX: 7 } } : {}),
      },
    ],
    durationMs: 1_000,
    easing: [0.3, 2.3, 0.7, -0.2],
    iterations: 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "clamp-root-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "clamp-root-text",
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return createElement("Canvas", { width: 96, height: 48 }, animated);
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

const iterationCount: AnimationIterationCount = 2.25;
const timeline: AnimationTimeline = { durationMs: 800, iterations: iterationCount };
const timelineOptions = {
  playback: { mode: "timeline", ...timeline },
  timeMs: 950,
  resourceIdPrefix: "timeline-test-",
  nodeIdMetadata: "omit",
} as const satisfies RenderAnimatedSvgOptions;

describe("animated SVG document timeline", () => {
  it("keeps direct, SVG+IR, and compiled bytes identical", () => {
    const scene = timelineScene();
    const compiled = engine.compile(scene);
    const direct = engine.renderToAnimatedSvg(scene, timelineOptions);

    expect(engine.renderToAnimatedSvgAndIR(scene, timelineOptions).svg).toBe(direct);
    expect(engine.renderCompiledToAnimatedSvg(compiled, timelineOptions)).toBe(direct);
    expect(direct).toContain("animation-duration: 800ms;");
    expect(direct).toContain("animation-delay: -150ms;");
    expect(direct).toContain("animation-iteration-count: 1.25;");
  });

  it("keeps document-cut cubic extrema identical across public render paths", () => {
    const scene = createElement(
      "Canvas",
      { width: 160, height: 48 },
      createElement("Box", {
        id: "cut-cubic-box",
        width: 32,
        height: 20,
        animate: {
          keyframes: [
            { at: 0, transform: { translateX: 0 } },
            { at: 1, transform: { translateX: 100 } },
          ],
          durationMs: 1_600,
          delayMs: -250,
          easing: [0, 13 / 9, 1, 0],
          iterations: 1,
          fill: "both",
        },
      }),
    );
    const options = {
      playback: { mode: "timeline", durationMs: 1_100, iterations: "infinite" },
      resourceIdPrefix: "cut-cubic-",
      nodeIdMetadata: "omit",
    } as const satisfies RenderAnimatedSvgOptions;
    const compiled = engine.compile(scene);
    const direct = engine.renderToAnimatedSvg(scene, options);

    expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
    expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
    expect((direct.match(/^\s*\d+(?:\.\d+)?%\s*\{/gm) ?? []).length).toBe(4);
    expect((direct.match(/animation-timing-function: cubic-bezier\(/g) ?? []).length).toBe(3);
  });

  it("keeps mixed-channel clamp extrema identical across public render paths", () => {
    const scene = createElement(
      "Canvas",
      { width: 160, height: 48 },
      createElement("Box", {
        id: "mixed-cubic-box",
        width: 32,
        height: 20,
        animate: {
          keyframes: [
            { at: 0, opacity: 0, transform: { translateX: 0 } },
            { at: 1, opacity: 1, transform: { translateX: 100 } },
          ],
          durationMs: 1_000,
          easing: [0, 2, 1, 1],
          iterations: 1,
          fill: "both",
        },
      }),
    );
    const options = {
      playback: { mode: "timeline", durationMs: 1_000, iterations: "infinite" },
      resourceIdPrefix: "mixed-cubic-",
      nodeIdMetadata: "omit",
    } as const satisfies RenderAnimatedSvgOptions;
    const compiled = engine.compile(scene);
    const direct = engine.renderToAnimatedSvg(scene, options);

    expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
    expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
    expect((direct.match(/^\s*\d+(?:\.\d+)?%\s*\{/gm) ?? []).length).toBe(4);
    expect(direct).toContain("15.625%");
    expect(direct).toContain("50%");
  });

  it("preserves exact linear endpoints across owners, channels, and public render paths", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 200, iterations: 0.5 },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      for (const channel of ["opacity", "transform"] as const) {
        const seamScene = exactEndpointScene(owner, channel, true);
        const seamCompiled = engine.compile(seamScene);
        for (const render of [
          () => engine.renderToAnimatedSvg(seamScene, options),
          () => engine.renderToAnimatedSvgAndIR(seamScene, options),
          () => engine.renderCompiledToAnimatedSvg(seamCompiled, options),
        ]) {
          expect(captureFatal(render)).toMatchObject({
            code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
            context: { reason: "zero-delta-jump", boundaryTimeMs: 100 },
          });
        }

        const continuousScene = exactEndpointScene(owner, channel, false);
        const continuousCompiled = engine.compile(continuousScene);
        const direct = engine.renderToAnimatedSvg(continuousScene, options);
        expect(engine.renderToAnimatedSvgAndIR(continuousScene, options).svg).toBe(direct);
        expect(engine.renderCompiledToAnimatedSvg(continuousCompiled, options)).toBe(direct);
      }
    }
  });

  it("canonicalizes clamp-root endpoints across owners and public render paths", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1_000, iterations: 0.3952 },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      for (const withTransform of [false, true]) {
        const scene = clampRootScene(owner, withTransform);
        const compiled = engine.compile(scene);
        const direct = engine.renderToAnimatedSvg(scene, options);
        expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
        expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
        expect(direct).toMatch(/39\.52\d*% \{ opacity: 1/);
      }
    }
  });

  it("enforces the published inclusive keyframe stop limit", () => {
    const stepScene = (count: number) =>
      createElement(
        "Canvas",
        { width: 48, height: 24 },
        createElement("Box", {
          id: "timeline-step-limit",
          width: 16,
          height: 16,
          animate: {
            keyframes: [
              { at: 0, opacity: 0 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 800,
            easing: { type: "steps", count, position: "jump-end" },
            iterations: 1,
            fill: "both",
          },
        }),
      );
    const playback = {
      playback: { mode: "timeline", durationMs: 800, iterations: "infinite" },
    } as const satisfies RenderAnimatedSvgOptions;
    const atLimit = engine.renderToAnimatedSvg(
      stepScene(animatedSvgTimelineLimits.maxKeyframeStops - 1),
      playback,
    );
    expect((atLimit.match(/^\s*\d+(?:\.\d+)?%\s*\{/gm) ?? []).length).toBe(
      animatedSvgTimelineLimits.maxKeyframeStops,
    );

    const error = captureFatal(() =>
      engine.renderToAnimatedSvg(stepScene(animatedSvgTimelineLimits.maxKeyframeStops), playback),
    );
    expect(error).toMatchObject({
      code: "ANIMATED_SVG_TIMELINE_LIMIT",
      context: {
        metric: "keyframeStops",
        actual: animatedSvgTimelineLimits.maxKeyframeStops + 1,
        limit: animatedSvgTimelineLimits.maxKeyframeStops,
      },
    });
  });

  it.each([
    ["durationMs", { mode: "timeline", durationMs: Number.NaN, iterations: 1 }, "NaN"],
    ["durationMs", { mode: "timeline", durationMs: 1n, iterations: 1 }, "1"],
    ["durationMs", { mode: "timeline", durationMs: 2 ** 32 + 1, iterations: 1 }, "4294967297"],
    ["iterations", { mode: "timeline", durationMs: 800, iterations: 0 }, "0"],
    ["iterations", { mode: "timeline", durationMs: 800, iterations: undefined }, "undefined"],
    ["iterations", { mode: "timeline", durationMs: 800, iterations: 2 ** 20 + 1 }, "1048577"],
  ] as const)("rejects invalid %s at the TypeScript boundary", (field, playback, received) => {
    const error = captureFatal(() =>
      engine.renderToAnimatedSvg(timelineScene(), {
        playback,
      } as unknown as RenderAnimatedSvgOptions),
    );
    expect(error).toMatchObject({
      code: "ANIMATED_SVG_INVALID_TIMELINE",
      stage: "validate",
      context: { stage: "validate", field, received },
    });
  });

  it("uses timeline-specific time validation without changing independent mode", () => {
    const timelineError = captureFatal(() =>
      engine.renderToAnimatedSvg(timelineScene(), {
        playback: { mode: "timeline", durationMs: 800, iterations: "infinite" },
        timeMs: Number.POSITIVE_INFINITY,
      }),
    );
    expect(timelineError).toMatchObject({
      code: "ANIMATED_SVG_INVALID_TIMELINE",
      context: { field: "timeMs", received: "Infinity" },
    });

    const independentError = captureFatal(() =>
      engine.renderToAnimatedSvg(timelineScene(), {
        playback: { mode: "independent" },
        timeMs: Number.POSITIVE_INFINITY,
      }),
    );
    expect(independentError.code).toBe("ANIMATION_INVALID_TIME");
  });

  it("rejects explicit null timeMs before every animated SVG transport", () => {
    const renderTransport = vi.fn((inputJson: string, optionsJson: string) =>
      handle.renderToAnimatedSvg(inputJson, optionsJson),
    );
    const compiledTransport = vi.fn((irJson: string, optionsJson: string) =>
      handle.resolveAndEmitAnimatedSvgFromIr(irJson, optionsJson),
    );
    const boundaryEngine = createEngineFromHandle(handle, {
      renderToAnimatedSvgFn: renderTransport,
      resolveAndEmitAnimatedSvgFromIrFn: compiledTransport,
    });
    const scene = timelineScene();
    const compiled = boundaryEngine.compile(scene);
    const nullTimeOptions = {
      playback: { mode: "timeline", durationMs: 800, iterations: "infinite" },
      timeMs: null,
    } as unknown as RenderAnimatedSvgOptions;

    try {
      for (const render of [
        () => boundaryEngine.renderToAnimatedSvg(scene, nullTimeOptions),
        () => boundaryEngine.renderToAnimatedSvgAndIR(scene, nullTimeOptions),
        () => boundaryEngine.renderCompiledToAnimatedSvg(compiled, nullTimeOptions),
      ]) {
        const error = captureFatal(render);
        expect(error).toMatchObject({
          code: "ANIMATED_SVG_INVALID_TIMELINE",
          stage: "validate",
          context: { stage: "validate", field: "timeMs", received: "null" },
        });
      }
      expect(renderTransport).not.toHaveBeenCalled();
      expect(compiledTransport).not.toHaveBeenCalled();
    } finally {
      boundaryEngine.dispose();
    }
  });

  it("rejects document clock precision loss with the fixed context", () => {
    const error = captureFatal(() =>
      engine.renderToAnimatedSvg(timelineScene(), {
        playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
        timeMs: 2 ** 31 + 1,
      }),
    );
    expect(error).toMatchObject({
      code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
      stage: "validate",
      context: {
        stage: "validate",
        kind: "time-ratio",
        timeMs: 2 ** 31 + 1,
        durationMs: 1,
        limitRatio: 2 ** 31,
      },
    });
  });

  it("preserves Rust representability context through direct and compiled paths", () => {
    const scene = timelineScene({ type: "spring" });
    const compiled = engine.compile(scene);
    const options = {
      playback: { mode: "timeline", durationMs: 800, iterations: "infinite" },
      timeMs: 0,
    } as const;
    for (const render of [
      () => engine.renderToAnimatedSvg(scene, options),
      () => engine.renderToAnimatedSvgAndIR(scene, options),
      () => engine.renderCompiledToAnimatedSvg(compiled, options),
    ]) {
      const error = captureFatal(render);
      expect(error).toMatchObject({
        code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
        stage: "emit",
        nodeId: "timeline-box",
        context: {
          stage: "emit",
          nodeId: "timeline-box",
          ownerKind: "node",
          ownerId: "timeline-box",
          reason: "spring-easing",
          boundaryTimeMs: 0,
        },
      });
      expect(error.context?.migration).toContain("independent");
    }
  });

  it("rejects unknown nested playback fields after fixed timeline validation", () => {
    const error = captureFatal(() =>
      engine.renderCompiledToAnimatedSvg(engine.compile(timelineScene()), {
        playback: {
          mode: "timeline",
          durationMs: 800,
          iterations: 1,
          timeline: [],
        },
      } as unknown as EmitAnimatedSvgOptions),
    );
    expect(error.code).toBe("UNSUPPORTED_RENDER_OPTION");
  });
});
