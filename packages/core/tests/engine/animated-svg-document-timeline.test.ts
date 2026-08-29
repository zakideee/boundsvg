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

function semanticIdentityScene(
  owner: EndpointOwner,
  timing: {
    durationMs: number;
    delayMs?: number;
    iterations: AnimationIterationCount;
    fill: "none" | "both";
  } = { durationMs: 1_000, iterations: 1, fill: "both" },
) {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, transform: {} },
      {
        at: 1,
        transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 },
      },
    ],
    durationMs: timing.durationMs,
    ...(timing.delayMs === undefined ? {} : { delayMs: timing.delayMs }),
    easing: "linear",
    iterations: timing.iterations,
    fill: timing.fill,
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "identity-transform-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "identity-transform-text",
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

function tinyTriangleScene() {
  return createElement(
    "Canvas",
    { width: 96, height: 48 },
    createElement("Box", {
      id: "tiny-triangle-node",
      width: 32,
      height: 20,
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 0.5, opacity: 1 },
          { at: 1, opacity: 0 },
        ],
        durationMs: 2e-300,
        easing: "linear",
        iterations: "infinite",
        fill: "both",
      },
    }),
  );
}

function documentEndStepCutScene(owner: EndpointOwner) {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 1_000,
    easing: { type: "steps", count: 2, position: "jump-end" },
    iterations: "infinite",
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "document-end-step-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "document-end-step-text",
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

function largeSourcePositionScene(
  owner: EndpointOwner,
  iterations: AnimationIterationCount,
  endpoint?: {
    keyframeOpacities: readonly [number, number];
    fill: "none" | "both";
  },
  timing: { durationMs: number; delayMs: number } = {
    durationMs: 1,
    delayMs: -(2 ** 52 + 1),
  },
) {
  const keyframeOpacities = endpoint?.keyframeOpacities ?? [0, 1];
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: keyframeOpacities[0] },
      { at: 1, opacity: keyframeOpacities[1] },
    ],
    durationMs: timing.durationMs,
    delayMs: timing.delayMs,
    easing: { type: "steps", count: 1, position: "jump-end" },
    iterations,
    fill: endpoint?.fill ?? "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "large-source-position-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "large-source-position-text",
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

function overshootCubicScene(
  owner: EndpointOwner,
  withTransform: boolean,
  clampTiming: {
    durationMs: number;
    delayMs?: number;
    easing: [number, number, number, number];
  } = { durationMs: 1_000, easing: [0.3, 2.3, 0.7, -0.2] },
) {
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
    durationMs: clampTiming.durationMs,
    ...(clampTiming.delayMs === undefined ? {} : { delayMs: clampTiming.delayMs }),
    easing: clampTiming.easing,
    iterations: 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "overshoot-cubic-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "overshoot-cubic-text",
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

function boundaryProgramCutScene(
  owner: EndpointOwner,
  timing: { durationMs: number; delayMs: number; stepCount: number },
) {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: timing.durationMs,
    delayMs: timing.delayMs,
    easing: { type: "steps", count: timing.stepCount, position: "jump-end" },
    iterations: 1,
    fill: "both",
  };
  const animated =
    owner === "node"
      ? createElement("Box", {
          id: "boundary-program-node",
          width: 32,
          height: 20,
          animate: animation,
        })
      : createElement(
          "Text",
          {
            id: "boundary-program-text",
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

function continuousDecimalCubicScene(durationMs: number) {
  return createElement(
    "Canvas",
    { width: 96, height: 48 },
    createElement("Box", {
      id: "continuous-decimal-cubic",
      width: 32,
      height: 20,
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 0.5, opacity: 0.5 },
          { at: 1, opacity: 0 },
        ],
        durationMs,
        easing: [0.3, 0.3, 0.7, 0.7],
        iterations: 4,
        fill: "both",
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

  it("rejects non-canonical document-cut extrema across public render paths", () => {
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
    for (const render of [
      () => engine.renderToAnimatedSvg(scene, options),
      () => engine.renderToAnimatedSvgAndIR(scene, options),
      () => engine.renderCompiledToAnimatedSvg(compiled, options),
    ]) {
      expect(captureFatal(render)).toMatchObject({
        code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
        context: { reason: "cubic-subcurve-unrepresentable", boundaryTimeMs: 1_100 },
      });
    }
  });

  it("rejects mixed-channel clamped overshoot across public render paths", () => {
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
    for (const render of [
      () => engine.renderToAnimatedSvg(scene, options),
      () => engine.renderToAnimatedSvgAndIR(scene, options),
      () => engine.renderCompiledToAnimatedSvg(compiled, options),
    ]) {
      expect(captureFatal(render)).toMatchObject({
        code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
        context: {
          reason: "clamped-overshoot-cubic",
          migration: "Use playback mode independent for this animation track.",
        },
      });
    }
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

  it("treats sparse and explicit identity transforms as continuous across public render paths", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1_000, iterations: 2 ** -21 },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const scene = semanticIdentityScene(owner);
      const compiled = engine.compile(scene);
      const direct = engine.renderToAnimatedSvg(scene, options);
      expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
      expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
    }
  });

  it("preserves document-end step values across owners, times, and public render paths", () => {
    for (const owner of ["node", "textUnit"] as const) {
      const scene = documentEndStepCutScene(owner);
      const compiled = engine.compile(scene);
      for (const timeMs of [0, 500]) {
        const options = {
          playback: { mode: "timeline", durationMs: 500, iterations: 1 },
          timeMs,
        } as const satisfies RenderAnimatedSvgOptions;
        const direct = engine.renderToAnimatedSvg(scene, options);
        expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
        expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
        expect(direct).toContain("100% { opacity: 0.5; }");
      }
    }
  });

  it("accepts a passing compressed pair beyond the source-position guard", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const scene = largeSourcePositionScene(owner, "infinite");
      const compiled = engine.compile(scene);
      const direct = engine.renderToAnimatedSvg(scene, options);
      expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
      expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
      expect(direct).toContain("0% { opacity: 0; }");
      expect(direct).toContain("100% { opacity: 0; }");
    }
  });

  it("accepts nonobservable finite, infinite, and sparse-identity source endpoints", () => {
    const sourceStart = 2 ** 52 + 1;
    const finiteInteriorOptions = {
      playback: { mode: "timeline", durationMs: 2, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;
    const infiniteOptions = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      for (const [scene, options] of [
        [
          largeSourcePositionScene(owner, sourceStart + 1, {
            keyframeOpacities: [0, 0],
            fill: "both",
          }),
          finiteInteriorOptions,
        ],
        [
          largeSourcePositionScene(
            owner,
            "infinite",
            { keyframeOpacities: [0, 0], fill: "both" },
            { durationMs: 1, delayMs: -Number.MAX_VALUE },
          ),
          infiniteOptions,
        ],
        [
          semanticIdentityScene(owner, {
            durationMs: 1,
            delayMs: -sourceStart,
            iterations: sourceStart + 1,
            fill: "none",
          }),
          finiteInteriorOptions,
        ],
      ] as const) {
        const compiled = engine.compile(scene);
        const direct = engine.renderToAnimatedSvg(scene, options);
        expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
        expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
      }
    }
  });

  it("preserves fill values when normalized document positions overflow", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.5,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const [durationMs, delayMs, iterations, fill, keyframeOpacities, expectedOpacity] of [
      [1e-300, -1e308, 1, "both", [0, 1], 1],
      [1e-300, -1e308, 1, "none", [0, 1], 1],
      [1e-300, 1e308, 1, "both", [0, 1], 0],
      [1e-300, 1e308, 1, "none", [0, 1], 1],
      [1e-300, -1e308, "infinite", "none", [0, 0], 0],
      [2 ** 53, -(2 ** 53), 1, "both", [0, 1], 1],
      [2 ** 53, -(2 ** 53), 1, "none", [0, 1], 1],
    ] as const) {
      for (const owner of ["node", "textUnit"] as const) {
        const scene = largeSourcePositionScene(
          owner,
          iterations,
          { keyframeOpacities, fill },
          { durationMs, delayMs },
        );
        const compiled = engine.compile(scene);
        const direct = engine.renderToAnimatedSvg(scene, options);
        expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
        expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
        expect(direct).toContain(`0% { opacity: ${expectedOpacity}; }`);
        expect(direct).toContain(`100% { opacity: ${expectedOpacity}; }`);
      }
    }
  });

  it("rejects a finite source end whose merged D-cut loses mapping precision", () => {
    const sourceStart = 2 ** 52 + 1;
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const scene = largeSourcePositionScene(owner, sourceStart + 1);
      const compiled = engine.compile(scene);
      for (const render of [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        expect(captureFatal(render)).toMatchObject({
          code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
          context: {
            kind: "separation",
            leftTimeMs: 0,
            rightTimeMs: 1,
          },
        });
      }
    }
  });

  it("rejects a constant finite source end whose explicit pair loses mapping precision", () => {
    const sourceStart = 2 ** 52 + 1;
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const scene = largeSourcePositionScene(owner, sourceStart + 1, {
        keyframeOpacities: [0, 0],
        fill: "none",
      });
      const compiled = engine.compile(scene);
      for (const render of [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        expect(captureFatal(render)).toMatchObject({
          code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
          context: {
            kind: "separation",
            leftTimeMs: 0,
            rightTimeMs: 1,
          },
        });
      }
    }
  });

  it("accepts safe constant tracks beyond the source-position guard", () => {
    const sourceStart = 2 ** 52 + 1;
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const [iterations, keyframeOpacity, fill] of [
      ["infinite", 0, "none"],
      [sourceStart + 1, 0, "both"],
      [sourceStart + 1, 1, "none"],
    ] as const) {
      for (const owner of ["node", "textUnit"] as const) {
        const scene = largeSourcePositionScene(owner, iterations, {
          keyframeOpacities: [keyframeOpacity, keyframeOpacity],
          fill,
        });
        const compiled = engine.compile(scene);
        const direct = engine.renderToAnimatedSvg(scene, options);
        expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
        expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
      }
    }
  });

  it("reports the first concrete pair before the construction precision guard", () => {
    const scene = tinyTriangleScene();
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
    } as const satisfies RenderAnimatedSvgOptions;
    const compiled = engine.compile(scene);

    for (const render of [
      () => engine.renderToAnimatedSvg(scene, options),
      () => engine.renderToAnimatedSvgAndIR(scene, options),
      () => engine.renderCompiledToAnimatedSvg(compiled, options),
    ]) {
      expect(captureFatal(render)).toMatchObject({
        code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
        context: {
          kind: "f32-order",
          leftTimeMs: 0,
          rightTimeMs: 1e-300,
        },
      });
    }
  });

  it.each([
    1_234.567_8, 999.666, 3.3, 31_415.926_535,
  ])("accepts a continuous cubic with decimal duration %d across public render paths", (durationMs) => {
    const scene = continuousDecimalCubicScene(durationMs);
    const options: RenderAnimatedSvgOptions = {
      playback: {
        mode: "timeline",
        durationMs: 4 * durationMs,
        iterations: "infinite",
      },
    };
    const compiled = engine.compile(scene);
    const direct = engine.renderToAnimatedSvg(scene, options);

    expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
    expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
    expect((direct.match(/^\s*\d+(?:\.\d+)?%\s*\{/gm) ?? []).length).toBe(9);
  });

  it("rejects clamped overshoot cubics across owners and public render paths", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1_000, iterations: 0.3952 },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      for (const withTransform of [false, true]) {
        const scene = overshootCubicScene(owner, withTransform);
        const compiled = engine.compile(scene);
        for (const render of [
          () => engine.renderToAnimatedSvg(scene, options),
          () => engine.renderToAnimatedSvgAndIR(scene, options),
          () => engine.renderCompiledToAnimatedSvg(compiled, options),
        ]) {
          expect(captureFatal(render)).toMatchObject({
            code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
            context: {
              reason: "clamped-overshoot-cubic",
              migration: "Use playback mode independent for this animation track.",
            },
          });
        }
      }
    }
  });

  it("rejects extreme clamped overshoot before precision across owners and paths", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1_000_000, iterations: "infinite" },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      for (const withTransform of [false, true]) {
        const scene = overshootCubicScene(owner, withTransform, {
          durationMs: 1_000_000,
          easing: [0, -1e16, 1, 1e16],
        });
        const compiled = engine.compile(scene);
        for (const render of [
          () => engine.renderToAnimatedSvg(scene, options),
          () => engine.renderToAnimatedSvgAndIR(scene, options),
          () => engine.renderCompiledToAnimatedSvg(compiled, options),
        ]) {
          expect(captureFatal(render)).toMatchObject({
            code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
            context: { reason: "clamped-overshoot-cubic" },
          });
        }
      }
    }
  });

  it("rejects canonical program cut singularities across public render paths", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1_000, iterations: "infinite" },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      for (const timing of [
        {
          durationMs: 3,
          delayMs: -2.099_999_999_999_999_6,
          stepCount: 10,
        },
        {
          durationMs: 1,
          delayMs: 999.666_666_666_666_6,
          stepCount: 3,
        },
      ]) {
        const scene = boundaryProgramCutScene(owner, timing);
        const compiled = engine.compile(scene);
        for (const render of [
          () => engine.renderToAnimatedSvg(scene, options),
          () => engine.renderToAnimatedSvgAndIR(scene, options),
          () => engine.renderCompiledToAnimatedSvg(compiled, options),
        ]) {
          expect(captureFatal(render)).toMatchObject({
            code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
            context: { kind: "separation" },
          });
        }
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
