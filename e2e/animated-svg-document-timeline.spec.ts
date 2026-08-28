import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AnimationSpec,
  animatedSvgTimelineLimits,
  createElement,
  createEngineAsync,
  type Engine,
  type VNode,
} from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";

const DOCUMENT_DURATION_MS = 200;
const PROBE_DISTANCE_MS = Math.max(DOCUMENT_DURATION_MS * 2 ** -20, 0.001);
const OPACITY_TOLERANCE = 1e-5;
const MATRIX_TOLERANCE = 5e-4;
const PAUSED_ANIMATION_CSS = "svg * { animation-play-state: paused !important; }";

type VisualState = {
  opacity: number;
  matrix: [number, number, number, number, number, number];
  opacityAttribute: string | null;
  transformAttribute: string | null;
  animationName: string;
};

type VisualStateInput = {
  page: Page;
  svg: string;
  selector: string;
  pauseAnimations: boolean;
  injectPauseStyle: boolean;
};

let engine: Engine;

test.beforeAll(async () => {
  engine = await createEngineAsync({});
  engine.registerFonts([
    {
      alias: "NotoSansJP",
      weight: 400,
      style: "normal",
      data: new Uint8Array(
        await readFile(resolve(__dirname, "../fixtures/fonts/NotoSansJP-Regular.subset.ttf")),
      ),
    },
  ]);
});

test.afterAll(() => {
  engine.dispose();
});

function timelineOptions(
  timeMs: number,
  iterations: number | "infinite" = "infinite",
  reducedMotion?: "keep" | "pause",
) {
  return {
    playback: { mode: "timeline", durationMs: DOCUMENT_DURATION_MS, iterations },
    timeMs,
    reducedMotion,
  } as const;
}

async function collectVisualState({
  page,
  svg,
  selector,
  pauseAnimations,
  injectPauseStyle,
}: VisualStateInput): Promise<VisualState> {
  const pauseStyle = injectPauseStyle ? `<style>${PAUSED_ANIMATION_CSS}</style>` : "";
  await page.setContent(`${pauseStyle}<main>${svg}</main>`);
  const element = page.locator(selector);
  await expect(element).toHaveCount(1);
  if (pauseAnimations) {
    await page.evaluate(async () => {
      const animations = document.getAnimations();
      for (const animation of animations) {
        animation.pause();
      }
      await Promise.all(animations.map((animation) => animation.ready));
      for (const animation of animations) {
        animation.currentTime = 0;
      }
    });
  }
  return element.evaluate((target) => {
    const style = getComputedStyle(target);
    const matrix =
      style.transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    return {
      opacity: Number(style.opacity),
      matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
      opacityAttribute: target.getAttribute("opacity"),
      transformAttribute: target.getAttribute("transform"),
      animationName: style.animationName,
    };
  });
}

function readVisualState(page: Page, svg: string, selector: string): Promise<VisualState> {
  return collectVisualState({
    page,
    svg,
    selector,
    pauseAnimations: true,
    injectPauseStyle: true,
  });
}

function readUnpausedVisualState(page: Page, svg: string, selector: string): Promise<VisualState> {
  return collectVisualState({
    page,
    svg,
    selector,
    pauseAnimations: false,
    injectPauseStyle: false,
  });
}

function readReducedMotionVisualState(
  page: Page,
  svg: string,
  selector: string,
): Promise<VisualState> {
  return collectVisualState({
    page,
    svg,
    selector,
    pauseAnimations: true,
    injectPauseStyle: false,
  });
}

function expectNear(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectNearEither(actual: number, expected: readonly number[], tolerance: number): void {
  expect(
    Math.min(...expected.map((candidate) => Math.abs(actual - candidate))),
  ).toBeLessThanOrEqual(tolerance);
}

function cubicCoordinate(parameter: number, control1: number, control2: number): number {
  const inverse = 1 - parameter;
  return (
    3 * inverse * inverse * parameter * control1 +
    3 * inverse * parameter * parameter * control2 +
    parameter * parameter * parameter
  );
}

function cubicEasing(
  progress: number,
  [x1, y1, x2, y2]: readonly [number, number, number, number],
): number {
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const parameter = (lower + upper) / 2;
    if (cubicCoordinate(parameter, x1, x2) < progress) {
      lower = parameter;
    } else {
      upper = parameter;
    }
  }
  return cubicCoordinate((lower + upper) / 2, y1, y2);
}

function stepScene(): VNode {
  const stepEasing = { type: "steps", count: 1, position: "jump-end" } as const;
  return createElement(
    "Canvas",
    { width: 120, height: 48 },
    createElement("Box", {
      id: "step-opacity",
      position: "absolute",
      width: 24,
      height: 24,
      opacity: 0,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 0.25, opacity: 0.5 },
          { at: 0.5, opacity: 0.25 },
          { at: 0.75, opacity: 1 },
          { at: 1, opacity: 0 },
        ],
        durationMs: DOCUMENT_DURATION_MS,
        easing: stepEasing,
        iterations: "infinite",
        fill: "both",
      },
    }),
    createElement("Box", {
      id: "step-transform",
      position: "absolute",
      width: 24,
      height: 24,
      background: "#f97316",
      animate: {
        keyframes: [
          { at: 0, transform: { translateX: 0 } },
          { at: 0.25, transform: { translateX: 20 } },
          { at: 0.5, transform: { translateX: 10 } },
          { at: 0.75, transform: { translateX: 40 } },
          { at: 1, transform: { translateX: 0 } },
        ],
        durationMs: DOCUMENT_DURATION_MS,
        easing: stepEasing,
        iterations: "infinite",
        fill: "both",
      },
    }),
  );
}

function continuousScene(): VNode {
  return createElement(
    "Canvas",
    { width: 64, height: 32 },
    createElement("Box", {
      id: "continuous-opacity",
      width: 24,
      height: 24,
      opacity: 0,
      background: "#16a34a",
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: DOCUMENT_DURATION_MS,
        easing: "linear",
        iterations: 1,
        fill: "both",
      },
    }),
  );
}

function linearJumpScene(): VNode {
  return createElement(
    "Canvas",
    { width: 64, height: 32 },
    createElement("Box", {
      id: "linear-jump",
      width: 24,
      height: 24,
      opacity: 0.5,
      background: "#7c3aed",
      animate: {
        keyframes: [
          { at: 0, opacity: 0.1 },
          { at: 1, opacity: 0.9 },
        ],
        durationMs: 150,
        easing: "linear",
        iterations: 1,
        fill: "none",
      },
    }),
  );
}

function cubicCutScene(): VNode {
  const animation = (easing: readonly [number, number, number, number]): AnimationSpec => ({
    keyframes: [
      { at: 0, opacity: 0, transform: { translateX: 0 } },
      { at: 1, opacity: 1, transform: { translateX: 100 } },
    ],
    durationMs: 200,
    delayMs: 120,
    easing,
    iterations: 1,
    fill: "both",
  });
  return createElement(
    "Canvas",
    { width: 160, height: 48 },
    createElement("Box", {
      id: "cubic-overshoot",
      position: "absolute",
      width: 20,
      height: 20,
      background: "#dc2626",
      animate: animation([0.3, 1.6, 0.7, 1.4]),
    }),
    createElement("Box", {
      id: "cubic-monotone",
      position: "absolute",
      width: 20,
      height: 20,
      background: "#0891b2",
      animate: animation([0.42, 0, 0.58, 1]),
    }),
  );
}

test("classifies discontinuities with off-instant and two-valued probes", async ({ page }) => {
  const scene = stepScene();
  const boundaries = [
    { timeMs: 50, opacity: [0, 0.5], translateX: [0, 20] },
    { timeMs: 100, opacity: [0.5, 0.25], translateX: [20, 10] },
    { timeMs: 150, opacity: [0.25, 1], translateX: [10, 40] },
  ] as const;

  for (const boundary of boundaries) {
    for (const [offset, expectedIndex] of [
      [-PROBE_DISTANCE_MS, 0],
      [PROBE_DISTANCE_MS, 1],
    ] as const) {
      const svg = engine.renderToAnimatedSvg(scene, timelineOptions(boundary.timeMs + offset));
      const opacity = await readVisualState(page, svg, '[data-boundsvg-node-id="step-opacity"]');
      const transform = await readVisualState(
        page,
        svg,
        '[data-boundsvg-node-id="step-transform"]',
      );
      expectNear(opacity.opacity, boundary.opacity[expectedIndex], OPACITY_TOLERANCE);
      expectNear(transform.matrix[4], boundary.translateX[expectedIndex], MATRIX_TOLERANCE);
    }

    const exactSvg = engine.renderToAnimatedSvg(scene, timelineOptions(boundary.timeMs));
    const exactOpacity = await readVisualState(
      page,
      exactSvg,
      '[data-boundsvg-node-id="step-opacity"]',
    );
    const exactTransform = await readVisualState(
      page,
      exactSvg,
      '[data-boundsvg-node-id="step-transform"]',
    );
    expectNearEither(exactOpacity.opacity, boundary.opacity, OPACITY_TOLERANCE);
    expectNearEither(exactTransform.matrix[4], boundary.translateX, MATRIX_TOLERANCE);
  }
});

test("preserves output-scaled linear jumps and cubic subcurves", async ({ page }) => {
  const jumpScene = linearJumpScene();
  for (const [timeMs, expected] of [
    [150 - PROBE_DISTANCE_MS, 0.9 - (0.8 * PROBE_DISTANCE_MS) / 150],
    [150 + PROBE_DISTANCE_MS, 0.5],
  ] as const) {
    const state = await readVisualState(
      page,
      engine.renderToAnimatedSvg(jumpScene, timelineOptions(timeMs)),
      '[data-boundsvg-node-id="linear-jump"]',
    );
    expectNear(state.opacity, expected, OPACITY_TOLERANCE);
  }
  const exactJump = await readVisualState(
    page,
    engine.renderToAnimatedSvg(jumpScene, timelineOptions(150)),
    '[data-boundsvg-node-id="linear-jump"]',
  );
  expectNearEither(exactJump.opacity, [0.9, 0.5], OPACITY_TOLERANCE);

  const cubicScene = cubicCutScene();
  const cubicFixtures = [
    { nodeId: "cubic-overshoot", curve: [0.3, 1.6, 0.7, 1.4] },
    { nodeId: "cubic-monotone", curve: [0.42, 0, 0.58, 1] },
  ] as const;
  for (const timeMs of [130, 160, 199.999]) {
    const animatedSvg = engine.renderToAnimatedSvg(cubicScene, timelineOptions(timeMs));
    const progress = (timeMs - 120) / 200;
    for (const fixture of cubicFixtures) {
      const selector = `[data-boundsvg-node-id="${fixture.nodeId}"]`;
      const animated = await readVisualState(page, animatedSvg, selector);
      const eased = cubicEasing(progress, fixture.curve);
      expectNear(animated.opacity, Math.min(1, Math.max(0, eased)), OPACITY_TOLERANCE);
      expectNear(animated.matrix[4], eased * 100, MATRIX_TOLERANCE);
    }
  }
});

test("keeps finite final holds, base pose, and reduced motion on the document sampler", async ({
  page,
}) => {
  const scene = continuousScene();
  for (const iterations of [0.5, 1, 2, 2.5]) {
    const endTimeMs = iterations * DOCUMENT_DURATION_MS;
    for (const timeMs of [Math.max(0, endTimeMs - PROBE_DISTANCE_MS), endTimeMs, endTimeMs + 200]) {
      const fraction = iterations % 1;
      const sampleTimeMs =
        timeMs >= endTimeMs
          ? fraction === 0
            ? DOCUMENT_DURATION_MS
            : fraction * DOCUMENT_DURATION_MS
          : timeMs % DOCUMENT_DURATION_MS;
      const expected = sampleTimeMs / DOCUMENT_DURATION_MS;
      const state = await readVisualState(
        page,
        engine.renderToAnimatedSvg(scene, timelineOptions(timeMs, iterations)),
        '[data-boundsvg-node-id="continuous-opacity"]',
      );
      expectNear(state.opacity, expected, OPACITY_TOLERANCE);
    }
  }

  const activeTimeMs = 650;
  const timelineSvg = engine.renderToAnimatedSvg(scene, timelineOptions(activeTimeMs));
  const sampledSvg = engine.renderToSvg(scene, { timeMs: activeTimeMs % DOCUMENT_DURATION_MS });
  const timelineBase = await readVisualState(
    page,
    timelineSvg,
    '[data-boundsvg-node-id="continuous-opacity"]',
  );
  const sampledBase = await readUnpausedVisualState(
    page,
    sampledSvg,
    '[data-boundsvg-node-id="continuous-opacity"]',
  );
  expect(timelineBase.opacityAttribute).toBe(sampledBase.opacityAttribute);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedTimeMs = 124;
  const reduced = await readReducedMotionVisualState(
    page,
    engine.renderToAnimatedSvg(scene, timelineOptions(reducedTimeMs, "infinite", "pause")),
    '[data-boundsvg-node-id="continuous-opacity"]',
  );
  expect(reduced.animationName).toBe("none");
  expectNear(reduced.opacity, 0.62, OPACITY_TOLERANCE);
});

test("keeps node and text-unit tracks on the same document clock", async ({ page }) => {
  const unitAnimation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 120,
    easing: "linear",
    iterations: 1,
    fill: "both",
  };
  const scene = createElement(
    "Canvas",
    { width: 180, height: 72 },
    createElement("Box", {
      id: "mixed-node",
      width: 20,
      height: 20,
      opacity: 0,
      animate: unitAnimation,
    }),
    createElement(
      "Text",
      {
        id: "mixed-text",
        font: "NotoSansJP",
        fontSizePx: 24,
        lineHeightPx: 28,
        opacity: 0,
        animateUnits: {
          by: "cluster",
          delayStepMs: 40,
          animation: unitAnimation,
        },
      },
      "ABC",
    ),
  );
  const timeMs = 100;
  const animatedSvg = engine.renderToAnimatedSvg(scene, timelineOptions(timeMs));
  const fixtures = [
    { selector: '[data-boundsvg-node-id="mixed-node"]', expected: 100 / 120 },
    { selector: '[class*="unit:0"]', expected: 100 / 120 },
    { selector: '[class*="unit:1"]', expected: 60 / 120 },
    { selector: '[class*="unit:2"]', expected: 20 / 120 },
  ] as const;
  for (const fixture of fixtures) {
    const animated = await readVisualState(page, animatedSvg, fixture.selector);
    expectNear(animated.opacity, fixture.expected, OPACITY_TOLERANCE);
  }
});

function representativeAnimation(trackIndex: number): AnimationSpec {
  const selectorCount = trackIndex < 294 ? 4 : 3;
  const keyframes = Array.from({ length: selectorCount }, (_, selectorIndex) => ({
    at: selectorIndex / (selectorCount - 1),
    opacity: selectorIndex % 2,
    transform: { translateX: selectorIndex },
  }));
  return {
    keyframes,
    durationMs: DOCUMENT_DURATION_MS,
    delayMs: (trackIndex % 509) * 0.05,
    easing: trackIndex < 814 ? { type: "steps", count: 1, position: "jump-end" } : "linear",
    iterations: trackIndex < 13 ? "infinite" : 1,
    fill: "both",
  };
}

function representativeScene(): VNode {
  const children = Array.from({ length: 828 }, (_, trackIndex) => {
    const animation = representativeAnimation(trackIndex);
    if (trackIndex % 2 === 0) {
      return createElement("Box", {
        id: `representative-node-${trackIndex}`,
        position: "absolute",
        width: 1,
        height: 1,
        opacity: 0,
        animate: animation,
      });
    }
    return createElement(
      "Text",
      {
        id: `representative-unit-${trackIndex}`,
        position: "absolute",
        width: 8,
        height: 8,
        font: "NotoSansJP",
        fontSizePx: 8,
        lineHeightPx: 8,
        opacity: 0,
        animateUnits: { by: "cluster", delayStepMs: 0, animation },
      },
      "A",
    );
  });
  return createElement("Canvas", { width: 64, height: 64 }, ...children);
}

test("loads a representative 828-track timeline within the published budget", async ({ page }) => {
  const svg = engine.renderToAnimatedSvg(representativeScene(), timelineOptions(125));
  const style = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? "";
  const animationCount = (style.match(/@keyframes /g) ?? []).length;
  const keyframeStopCount = (style.match(/^\s*(?:\d+(?:\.\d+)?%)\s*\{/gm) ?? []).length;
  expect(animationCount).toBe(828);
  expect(keyframeStopCount).toBeLessThanOrEqual(animatedSvgTimelineLimits.maxKeyframeStops);
  expect(new TextEncoder().encode(style).byteLength).toBeLessThanOrEqual(
    animatedSvgTimelineLimits.maxCssBytes,
  );

  await page.setContent(`<style>${PAUSED_ANIMATION_CSS}</style><main>${svg}</main>`);
  await expect(page.locator('[class*="bsvg-anim-"]')).toHaveCount(828);
  const first = await page
    .locator('[data-boundsvg-node-id="representative-node-0"]')
    .evaluate((element) => getComputedStyle(element).animationName);
  const last = await page
    .locator('[class*="unit:0"]')
    .last()
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(first).not.toBe("none");
  expect(last).not.toBe("none");
});
