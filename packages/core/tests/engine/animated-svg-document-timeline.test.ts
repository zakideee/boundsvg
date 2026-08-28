import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AnimationTimeline,
  EmitAnimatedSvgOptions,
  Engine,
  RenderAnimatedSvgOptions,
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

function captureFatal(run: () => unknown): FatalError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("Expected a FatalError");
}

const timeline: AnimationTimeline = { durationMs: 800, iterations: 2.25 };
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
