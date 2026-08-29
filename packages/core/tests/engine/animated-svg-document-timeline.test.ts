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
import type { IRNode } from "../../src/ir/types.js";
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

type AuthoredDomainField = "durationMs" | "delayMs" | "iterations";

function authoredDomainProbeScene(
  owner: EndpointOwner,
  authoredField?: AuthoredDomainField,
  received?: number,
): { scene: ReturnType<typeof createElement>; ownerId: string } {
  const ownerId = `transport-domain-${owner}`;
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 100,
    delayMs: 0,
    easing: "linear",
    iterations: 1,
    fill: "both",
  };
  if (authoredField !== undefined && received !== undefined) {
    animation[authoredField] = received;
  }
  const animated =
    owner === "node"
      ? createElement("Box", { id: ownerId, width: 32, height: 20, animate: animation })
      : createElement(
          "Text",
          {
            id: ownerId,
            width: 32,
            height: 20,
            font: "NotoSansJP",
            fontSizePx: 16,
            lineHeightPx: 20,
            animateUnits: { by: "cluster", animation },
          },
          "A",
        );
  return {
    scene: createElement("Canvas", { width: 96, height: 48 }, animated),
    ownerId,
  };
}

function hiddenTextUnitDomainScene(delayStepMs: number) {
  return createElement(
    "Canvas",
    { width: 460, height: 220 },
    createElement(
      "TextOnPath",
      {
        id: "hidden-domain-units",
        d: "M20 170C100 20 350 20 440 170",
        width: 460,
        height: 220,
        font: "NotoSansJP",
        fontSizePx: 30,
        color: "#f8fafc",
        startOffsetPx: -10_000,
        pathOverflow: "hidden",
        animateUnits: {
          by: "cluster",
          animation: {
            keyframes: [
              { at: 0, opacity: 0 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 100,
            delayMs: 0,
            easing: "linear",
            iterations: 1,
            fill: "both",
          },
          delayStepMs,
          order: "logical",
        },
      },
      "AB",
    ),
  );
}

function findAuthoredAnimation(node: IRNode, ownerId: string): AnimationSpec {
  const find = (currentNode: IRNode): AnimationSpec | undefined => {
    if (currentNode.nodeId === ownerId) {
      if (currentNode.type === "group" && currentNode.animation !== undefined) {
        return currentNode.animation;
      }
      if (currentNode.type === "text" && currentNode.unitAnimation !== undefined) {
        return currentNode.unitAnimation.animation;
      }
    }
    if (currentNode.type === "group") {
      for (const child of currentNode.children ?? []) {
        const animation = find(child);
        if (animation !== undefined) {
          return animation;
        }
      }
    }
    return undefined;
  };
  const animation = find(node);
  if (animation !== undefined) {
    return animation;
  }
  throw new TypeError(`Missing animation owner ${ownerId}`);
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
        durationMs: 1 - 2 ** -53,
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
    delayMs: -(2 ** 32),
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

  it("accepts a passing compressed pair at the authored delay boundary", () => {
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

  it("accepts nonobservable finite, infinite, and sparse-identity endpoints inside the authored domain", () => {
    const sourceStart = 2 ** 32;
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
          largeSourcePositionScene(
            owner,
            2 ** 20,
            { keyframeOpacities: [0, 0], fill: "both" },
            { durationMs: 2 ** 12, delayMs: -sourceStart },
          ),
          finiteInteriorOptions,
        ],
        [
          largeSourcePositionScene(
            owner,
            "infinite",
            { keyframeOpacities: [0, 0], fill: "both" },
            { durationMs: 1, delayMs: -sourceStart },
          ),
          infiniteOptions,
        ],
        [
          semanticIdentityScene(owner, {
            durationMs: 2 ** 12,
            delayMs: -sourceStart,
            iterations: 2 ** 20,
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

  it("preserves fill values at the authored duration and delay boundaries", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.5,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const [durationMs, delayMs, iterations, fill, keyframeOpacities, expectedOpacity] of [
      [1, -(2 ** 32), 1, "both", [0, 1], 1],
      [1, -(2 ** 32), 1, "none", [0, 1], 1],
      [1, 2 ** 32, 1, "both", [0, 1], 0],
      [1, 2 ** 32, 1, "none", [0, 1], 1],
      [1, -(2 ** 32), "infinite", "none", [0, 0], 0],
      [2 ** 32, -(2 ** 32), 1, "both", [0, 1], 1],
      [2 ** 32, -(2 ** 32), 1, "none", [0, 1], 1],
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

  it("rejects observable tracks just below the authored delay lower boundary", () => {
    const belowDelayLowerBound = -(2 ** 32 + 2 ** -20);
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const scene = largeSourcePositionScene(owner, "infinite", undefined, {
        durationMs: 1,
        delayMs: belowDelayLowerBound,
      });
      const compiled = engine.compile(scene);
      for (const render of [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        const fatal = captureFatal(render);
        expect(fatal).toMatchObject({
          code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
          context: {
            reason: "authored-value-out-of-domain",
            field: "delayMs",
            received: String(belowDelayLowerBound),
          },
        });
        expect(fatal.context).not.toHaveProperty("boundaryTimeMs");
      }
    }
  });

  it("rejects constant tracks just above the authored iterations upper boundary", () => {
    const aboveIterationsUpperBound = 2 ** 20 + 2 ** -32;
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const scene = largeSourcePositionScene(
        owner,
        aboveIterationsUpperBound,
        { keyframeOpacities: [0, 0], fill: "none" },
        { durationMs: 1, delayMs: 0 },
      );
      const compiled = engine.compile(scene);
      for (const render of [
        () => engine.renderToAnimatedSvg(scene, options),
        () => engine.renderToAnimatedSvgAndIR(scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        const fatal = captureFatal(render);
        expect(fatal).toMatchObject({
          code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
          context: {
            reason: "authored-value-out-of-domain",
            field: "iterations",
            received: String(aboveIterationsUpperBound),
          },
        });
        expect(fatal.context).not.toHaveProperty("boundaryTimeMs");
      }
    }
  });

  it("accepts safe constant tracks at authored domain boundaries", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
      timeMs: 0.75,
    } as const satisfies RenderAnimatedSvgOptions;

    for (const [iterations, keyframeOpacity, fill] of [
      ["infinite", 0, "none"],
      [2 ** 20, 0, "both"],
      [2 ** 20, 1, "none"],
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

  it("validates effective delays for bbox-less text units at the authored boundary", () => {
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
    } as const satisfies RenderAnimatedSvgOptions;
    const boundaryScene = hiddenTextUnitDomainScene(2 ** 32);
    const boundaryCompiled = engine.compile(boundaryScene);
    expect(() => engine.renderToAnimatedSvg(boundaryScene, options)).not.toThrow();
    expect(() => engine.renderToAnimatedSvgAndIR(boundaryScene, options)).not.toThrow();
    expect(() => engine.renderCompiledToAnimatedSvg(boundaryCompiled, options)).not.toThrow();

    const aboveDelayUpperBound = 2 ** 32 + 2 ** -20;
    const outsideScene = hiddenTextUnitDomainScene(aboveDelayUpperBound);
    const outsideCompiled = engine.compile(outsideScene);
    for (const render of [
      () => engine.renderToAnimatedSvg(outsideScene, options),
      () => engine.renderToAnimatedSvgAndIR(outsideScene, options),
      () => engine.renderCompiledToAnimatedSvg(outsideCompiled, options),
    ]) {
      const fatal = captureFatal(render);
      expect(fatal).toMatchObject({
        code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
        context: {
          ownerKind: "textUnit",
          ownerId: "hidden-domain-units",
          unitId: expect.any(String),
          reason: "authored-value-out-of-domain",
          field: "delayMs",
          received: String(aboveDelayUpperBound),
        },
      });
      expect(fatal.context).not.toHaveProperty("boundaryTimeMs");
    }
  });

  it.each([
    ["durationMs", Number.NaN],
    ["delayMs", Number.POSITIVE_INFINITY],
    ["delayMs", Number.NEGATIVE_INFINITY],
    ["iterations", -0],
  ] as const)("routes authored %s=%s to the domain error across owners and public paths", (authoredField, received) => {
    const options = {
      playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const invalid = authoredDomainProbeScene(owner, authoredField, received);
      const valid = authoredDomainProbeScene(owner);
      const compiled = engine.compile(valid.scene);
      findAuthoredAnimation(compiled.ir.root, valid.ownerId)[authoredField] = received;
      for (const render of [
        () => engine.renderToAnimatedSvg(invalid.scene, options),
        () => engine.renderToAnimatedSvgAndIR(invalid.scene, options),
        () => engine.renderCompiledToAnimatedSvg(compiled, options),
      ]) {
        const fatal = captureFatal(render);
        expect(fatal.context).toEqual({
          ownerKind: owner,
          ownerId: invalid.ownerId,
          reason: "authored-value-out-of-domain",
          field: authoredField,
          received: String(received),
          migration:
            "Use playback mode independent or change the authored value to the supported timeline range.",
          stage: "emit",
          nodeId: invalid.ownerId,
        });
        expect(fatal.code).toBe("ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
      }
    }
  });

  it("preserves independent-mode validation for non-finite authored timing", () => {
    const invalid = authoredDomainProbeScene("node", "durationMs", Number.NaN);
    const fatal = captureFatal(() =>
      engine.renderToAnimatedSvg(invalid.scene, { playback: { mode: "independent" } }),
    );
    expect(fatal).toMatchObject({ code: "ANIMATION_INVALID_SPEC" });
  });

  it("keeps out-of-timeline-domain authored values available in independent mode", () => {
    const options = {
      playback: { mode: "independent" },
    } as const satisfies RenderAnimatedSvgOptions;

    for (const owner of ["node", "textUnit"] as const) {
      const scene = largeSourcePositionScene(
        owner,
        2 ** 20 + 1,
        { keyframeOpacities: [0, 0], fill: "both" },
        { durationMs: 0.5, delayMs: 2 ** 32 + 1 },
      );
      const compiled = engine.compile(scene);
      const direct = engine.renderToAnimatedSvg(scene, options);
      expect(engine.renderToAnimatedSvgAndIR(scene, options).svg).toBe(direct);
      expect(engine.renderCompiledToAnimatedSvg(compiled, options)).toBe(direct);
      expect(direct).toContain("animation-duration: 0.5ms;");
      expect(direct).toContain("animation-delay: 4294967297ms;");
      expect(direct).toContain("animation-iteration-count: 1048577;");
    }
  });

  it("returns the reason-specific wire shape below the authored duration lower boundary", () => {
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
      const fatal = captureFatal(render);
      expect(fatal.code).toBe("ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
      expect(fatal.context).toEqual({
        ownerKind: "node",
        ownerId: "tiny-triangle-node",
        reason: "authored-value-out-of-domain",
        field: "durationMs",
        received: String(1 - 2 ** -53),
        migration:
          "Use playback mode independent or change the authored value to the supported timeline range.",
        stage: "emit",
        nodeId: "tiny-triangle-node",
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
