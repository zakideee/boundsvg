import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine, RenderSvgOptions } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import type { IRNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationEasing } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { nativeAnimatedScene } from "../conformance/scenes/native-animated.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function findNode(node: IRNode, nodeId: string): IRNode | undefined {
  if (node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findNode(child, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function stepScene(easing: AnimationEasing, options?: { delayMs?: number; iterations?: number }) {
  return createElement(
    "Canvas",
    { width: 80, height: 40 },
    createElement("Box", {
      id: "step-box",
      width: 40,
      height: 40,
      background: "#2563eb",
      opacity: 0.75,
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 100,
        delayMs: options?.delayMs ?? 100,
        easing,
        iterations: options?.iterations,
        fill: "both",
      },
    }),
  );
}

function stepBoundaryScene() {
  return createElement(
    "Canvas",
    { width: 80, height: 40 },
    createElement("Box", {
      id: "step-boundary-box",
      width: 40,
      height: 40,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 0.5, opacity: 0.4 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 100,
        delayMs: 100,
        easing: "step-start",
        fill: "both",
      },
    }),
  );
}

/**
 * Byte-for-byte mirror of SPRING_LINEAR_400MS_GOLDEN in
 * crates/boundsvg/src/svg_emit/emitter.rs. The Rust copy pins the native
 * build; this one pins the shipped wasm32 build. They must stay identical.
 */
const SPRING_LINEAR_400MS_GOLDEN =
  "linear(0.000000, 0.001912, 0.007487, 0.016481, 0.028654, 0.043765, 0.061581, 0.081870, 0.104405, 0.128966, 0.155335, 0.183304, 0.212670, 0.243237, 0.274817, 0.307229, 0.340300, 0.373864, 0.407765, 0.441854, 0.475990, 0.510042, 0.543885, 0.577404, 0.610493, 0.643051, 0.674987, 0.706219, 0.736671, 0.766275, 0.794970, 0.822702, 0.849426, 0.875100, 0.899692, 0.923173, 0.945522, 0.966724, 0.986767, 1.005646, 1.023360, 1.039912, 1.055310, 1.069565, 1.082694, 1.094714, 1.105648, 1.115519, 1.124355, 1.132184, 1.139039, 1.144953, 1.149959, 1.154094, 1.157396, 1.159901, 1.161650, 1.162681, 1.163033, 1.162747, 1.161862, 1.160418, 1.158454, 1.156010, 1.000000)";

function springScene(easing: AnimationEasing) {
  return createElement(
    "Canvas",
    { width: 80, height: 40 },
    createElement("Box", {
      id: "spring-box",
      width: 40,
      height: 40,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 400,
        easing,
        fill: "both",
      },
    }),
  );
}

function springKeyframeScene(
  offsets: readonly number[],
  easing: AnimationEasing,
  options?: { durationMs?: number },
) {
  const opacities = [0, 0.25, 1];
  return createElement(
    "Canvas",
    { width: 80, height: 40 },
    createElement("Box", {
      id: "spring-frames",
      width: 40,
      height: 40,
      background: "#2563eb",
      animate: {
        keyframes: offsets.map((at, index) => ({ at, opacity: opacities[index] ?? 1 })),
        durationMs: options?.durationMs ?? 400,
        easing,
        fill: "both",
      },
    }),
  );
}

function springBoxOpacity(
  engine: Engine,
  easing: AnimationEasing,
  timeMs: number,
): number | undefined {
  const node = findNode(engine.renderToIR(springScene(easing), { timeMs }).root, "spring-box");
  return node?.type === "group" ? node.opacity : undefined;
}

function stepBoxOpacity(
  engine: Engine,
  easing: AnimationEasing,
  timeMs: number,
): number | undefined {
  const node = findNode(engine.renderToIR(stepScene(easing), { timeMs }).root, "step-box");
  return node?.type === "group" ? node.opacity : undefined;
}

describe("declarative animation v1", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;
  let rasterize: (svg: string) => Uint8Array;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    rasterize = handle.createSvgToPngFn();
    engine = createEngineFromHandle(handle, { svgToPngFn: rasterize });
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it("emits semantic CSS only in declarative mode", () => {
    const declarative = engine.renderToAnimatedSvg(nativeAnimatedScene.build(), {
      playback: { mode: "independent" },
      timeMs: 600,
    });
    const sampled = engine.renderToSvg(nativeAnimatedScene.build(), {
      timeMs: 600,
    });

    expect(declarative).toContain("<style>");
    expect(declarative).toContain("@keyframes");
    expect(declarative).toContain("animation-delay: -600ms");
    expect(declarative).toContain("translate(180px, 113px)");
    expect(sampled).not.toContain("<style>");
    expect(sampled).not.toContain("@keyframes");
  });

  it("serializes resource ids as CSS identifiers without changing class tokens", () => {
    const svg = engine.renderToAnimatedSvg(nativeAnimatedScene.build(), {
      playback: { mode: "independent" },
      resourceIdPrefix: "scope:one.",
    });

    expect(svg).toContain('class="bsvg-scope:one.anim-na-card"');
    expect(svg).toContain("@keyframes scope\\:one\\.anim-na-card-keyframes");
    expect(svg).toContain(".bsvg-scope\\:one\\.anim-na-card {");
    expect(svg).toContain("animation-name: scope\\:one\\.anim-na-card-keyframes;");
  });

  it("samples step keywords across the delay and active-start boundary", () => {
    expect(stepBoxOpacity(engine, "step-start", 99)).toBe(0);
    expect(stepBoxOpacity(engine, "step-start", 100)).toBe(1);
    expect(stepBoxOpacity(engine, "step-end", 100)).toBe(0);
  });

  it("samples and canonically serializes typed steps easing", () => {
    const easing = { type: "steps", count: 2, position: "jump-both" } as const;
    expect(stepBoxOpacity(engine, easing, 100)).toBeCloseTo(1 / 3);
    expect(stepBoxOpacity(engine, easing, 150)).toBeCloseTo(2 / 3);

    const defaultPositionSvg = engine.renderToAnimatedSvg(stepScene({ type: "steps", count: 4 }), {
      playback: { mode: "independent" },
      timeMs: 100,
    });
    const keywordSvg = engine.renderToAnimatedSvg(stepScene("step-start"), {
      playback: { mode: "independent" },
      timeMs: 100,
    });
    const largeCountSvg = engine.renderToAnimatedSvg(stepScene({ type: "steps", count: 1e21 }), {
      playback: { mode: "independent" },
      timeMs: 100,
    });
    expect(defaultPositionSvg).toContain("animation-timing-function: steps(4, jump-end);");
    expect(keywordSvg).toContain("animation-timing-function: step-start;");
    expect(largeCountSvg).toContain(
      "animation-timing-function: steps(1000000000000000000000, jump-end);",
    );

    const compiled = engine.compile(stepScene(easing));
    expect(engine.renderCompiledToSvg(compiled, { timeMs: 150 })).toBe(
      engine.renderToSvg(stepScene(easing), { timeMs: 150 }),
    );
  });

  it.each([
    99, 100, 150, 200,
  ])("rasterizes declarative steps identically to static PNG at timeMs=%i", (timeMs) => {
    const scene = stepScene({ type: "steps", count: 2, position: "jump-both" });
    const declarativeSvg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs,
    });
    expect(rasterize(declarativeSvg)).toEqual(engine.renderToPng(scene, { timeMs }));
  });

  it("keeps the declarative SVG base pose identical to static output at an exact boundary", () => {
    const scene = stepBoundaryScene();
    const declarativeSvg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs: 150,
    });
    expect(rasterize(declarativeSvg)).toEqual(engine.renderToPng(scene, { timeMs: 150 }));
    const node = findNode(engine.renderToIR(scene, { timeMs: 150 }).root, "step-boundary-box");
    expect(node?.type === "group" ? node.opacity : undefined).toBe(0.4);
  });

  it("keeps semantic tracks in IR while sampling the requested pose", () => {
    const start = engine.renderToIR(nativeAnimatedScene.build(), { timeMs: 0 });
    const middle = engine.renderToIR(nativeAnimatedScene.build(), { timeMs: 600 });
    const startCard = findNode(start.root, "na-card");
    const middleCard = findNode(middle.root, "na-card");

    expect(startCard?.type).toBe("group");
    expect(middleCard?.type).toBe("group");
    if (startCard?.type !== "group" || middleCard?.type !== "group") {
      throw new Error("Animated card group missing from sampled IR");
    }
    expect(startCard.animation?.durationMs).toBe(1200);
    expect(startCard.opacity).toBeCloseTo(0.35);
    expect(startCard.transform?.translateX).toBeCloseTo(-28);
    expect(middleCard.animation?.keyframes).toHaveLength(3);
    expect(middleCard.opacity).toBeCloseTo(1);
    expect(middleCard.transform?.translateX).toBeCloseTo(0);
    expect(middleCard.transform?.originX).toBeCloseTo(56);
    expect(middleCard.transform?.originY).toBeCloseTo(56);
  });

  it("is byte-deterministic for the same scene and time and changes PNG across times", () => {
    const scene = nativeAnimatedScene.build();
    const firstSvg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs: 600,
    });
    const secondSvg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs: 600,
    });
    const startPng = engine.renderToPng(scene, { timeMs: 0 });
    const middlePng = engine.renderToPng(scene, { timeMs: 600 });

    expect(secondSvg).toBe(firstSvg);
    expect(sha256(middlePng)).not.toBe(sha256(startPng));
    expect(sha256(engine.renderToPng(scene, { timeMs: 600 }))).toBe(sha256(middlePng));
  });

  it("retains raw tracks in CompiledScene and samples them at each emit", () => {
    const scene = nativeAnimatedScene.build();
    const compiled = engine.compile(scene);
    const rawCard = findNode(engine.snapshotCompiledIR(compiled).root, "na-card");
    expect(rawCard?.type).toBe("group");
    if (rawCard?.type !== "group") {
      throw new Error("Animated card group missing from compiled IR");
    }
    expect(rawCard.animation?.durationMs).toBe(1200);
    expect(rawCard.opacity).toBeUndefined();
    expect(rawCard.transform).toBeUndefined();

    expect(
      engine.renderCompiledToAnimatedSvg(compiled, {
        playback: { mode: "independent" },
        timeMs: 600,
      }),
    ).toBe(engine.renderToAnimatedSvg(scene, { playback: { mode: "independent" }, timeMs: 600 }));
    expect(engine.renderCompiledToPng(compiled, { timeMs: 600 })).toEqual(
      engine.renderToPng(scene, { timeMs: 600 }),
    );
  });

  it.each([
    0, 600, 1400,
  ])("rasterizes declarative SVG identically to static PNG at timeMs=%i", (timeMs) => {
    const scene = nativeAnimatedScene.build();
    const declarativeSvg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs,
    });
    const declarativePng = rasterize(declarativeSvg);
    const staticPng = engine.renderToPng(scene, { timeMs });

    expect(declarativePng).toEqual(staticPng);
  });

  it("marks layered manifests with animation sampling metadata", () => {
    const result = engine.renderToLayeredSvg(nativeAnimatedScene.build(), {
      timeMs: 600,
    });

    expect(result.manifest.animated).toBe(true);
    expect(result.manifest.timeMs).toBe(600);
  });

  it("samples an animated ancestor into every static layer", () => {
    const scene = createElement(
      "Canvas",
      { width: 120, height: 60 },
      createElement(
        "Flex",
        {
          id: "animated-parent",
          direction: "row",
          animate: {
            keyframes: [
              { at: 0, transform: { translateX: 0 } },
              { at: 1, transform: { translateX: 20 } },
            ],
            durationMs: 500,
            fill: "both",
          },
        },
        createElement("Box", {
          id: "layer-a-node",
          layer: "a",
          width: 40,
          height: 40,
          background: "#ff0000",
        }),
        createElement("Box", {
          id: "layer-b-node",
          layer: "b",
          width: 40,
          height: 40,
          background: "#0000ff",
        }),
      ),
    );

    const result = engine.renderToLayeredSvg(scene, { timeMs: 250 });
    expect(result.layers.map((layer) => layer.id)).toEqual(["a", "b"]);
    for (const layer of result.layers) {
      expect(layer.svg).not.toContain("@keyframes");
      expect(layer.svg).not.toContain('class="bsvg-anim-animated-parent"');
    }
  });

  it("keeps opacity animation compositing islands stable across timeline phases", () => {
    const scene = createElement(
      "Canvas",
      { width: 120, height: 60 },
      createElement(
        "Flex",
        {
          id: "opacity-parent",
          direction: "row",
          animate: {
            keyframes: [
              { at: 0, opacity: 0.2 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 500,
            delayMs: 100,
            fill: "none",
          },
        },
        createElement("Box", {
          id: "opacity-layer-a",
          layer: "a",
          width: 40,
          height: 40,
          background: "#ff0000",
        }),
        createElement("Box", {
          id: "opacity-layer-b",
          layer: "b",
          width: 40,
          height: 40,
          background: "#0000ff",
        }),
      ),
    );

    for (const timeMs of [0, 250, 700]) {
      const result = engine.renderToLayeredSvg(scene, { timeMs });
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0]?.mode).toBe("atomic");
      expect(result.layers[0]?.warnings).toContainEqual({
        code: "PARENT_OPACITY_PREVENTED_SPLIT",
        nodeId: "opacity-layer-a",
        parentNodeId: "opacity-parent",
      });
    }
  });

  it.each([
    { animation: "invalid" as "static", timeMs: 0 },
    { timeMs: -1 },
    { timeMs: Number.NaN },
  ])("rejects invalid render timeline options", (options) => {
    expect(() => engine.renderToSvg(nativeAnimatedScene.build(), options)).toThrow(FatalError);
  });

  describe("spring easing", () => {
    it("expands spring easing into a CSS linear() timing function", () => {
      const svg = engine.renderToAnimatedSvg(springScene({ type: "spring" }), {
        playback: { mode: "independent" },
        timeMs: 0,
      });
      const timingFunction = /animation-timing-function: (linear\([^)]*\));/.exec(svg)?.[1];

      expect(timingFunction, svg).toBeDefined();
      expect(timingFunction?.split(", ")).toHaveLength(65);
      expect(timingFunction?.endsWith(", 1.000000)")).toBe(true);
    });

    it("emits the exact linear() bytes through the shipped WASM build", () => {
      // The closed form uses exp/sin/cos, so the native Rust golden in
      // emitter.rs only pins the host libm. This pins the wasm32 build at full
      // precision; the conformance SVG snapshot rounds to two decimals and
      // cannot catch a last-digit drift.
      const svg = engine.renderToAnimatedSvg(springScene({ type: "spring" }), {
        playback: { mode: "independent" },
        timeMs: 0,
      });
      const timingFunction = /animation-timing-function: (linear\([^)]*\));/.exec(svg)?.[1];

      expect(timingFunction).toBe(SPRING_LINEAR_400MS_GOLDEN);
    });

    it.each([
      // Closed-form values at u = 250/700, verified independently of the engine.
      { label: "underdamped", stiffness: 170, damping: 14, progress: 1.118_414_292_043_680_8 },
      { label: "critical", stiffness: 100, damping: 20, progress: 0.712_702_504_816_354_2 },
      { label: "overdamped", stiffness: 100, damping: 40, progress: 0.448_647_459_162_823_1 },
    ])("samples the $label closed form through WASM at full precision", (params) => {
      // The linear() golden only covers sample_spring_progress. This pins
      // sample_spec, including segment_duration_ms = durationMs * (to.at - from.at),
      // which the CSS path never exercises.
      // translateX carries the raw progress: opacity is clamped to 0..1, so it
      // cannot show an overshooting curve's true value.
      const scene = createElement(
        "Canvas",
        { width: 80, height: 40 },
        createElement("Box", {
          id: "spring-box",
          width: 40,
          height: 40,
          background: "#2563eb",
          animate: {
            keyframes: [
              { at: 0, transform: { translateX: 0 } },
              { at: 1, transform: { translateX: 1 } },
            ],
            durationMs: 700,
            easing: { type: "spring", stiffness: params.stiffness, damping: params.damping },
            fill: "both",
          },
        }),
      );
      const node = findNode(engine.renderToIR(scene, { timeMs: 250 }).root, "spring-box");
      const progress = node?.type === "group" ? node.transform?.translateX : undefined;

      expect(progress).toBeDefined();
      expect(progress).toBeCloseTo(params.progress, 12);
    });

    it("scales the sampled value with the keyframe segment, not the iteration", () => {
      // Two evenly spaced segments over 800ms sample the same physical time as
      // one 400ms segment, so a broken segment_duration_ms would show here.
      const twoSegments = findNode(
        engine.renderToIR(
          springKeyframeScene([0, 0.5, 1], { type: "spring" }, { durationMs: 800 }),
          { timeMs: 200 },
        ).root,
        "spring-frames",
      );
      const sampled = twoSegments?.type === "group" ? twoSegments.opacity : undefined;

      // 200ms into a 400ms first segment interpolating opacity 0 -> 0.25. The
      // progress is the same 0.849426 the emitter golden carries at stop 32.
      expect(sampled).toBeCloseTo(0.212_356_408_713_528_07, 12);
    });

    it("carries overshoot through emit and rasterizes it consistently", () => {
      // Progress above 1 extrapolates the keyframe pair, so the emitted
      // attribute is deliberately outside 0..1. cubic-bezier can already do
      // this, but spring makes it the default shape. Viewers clamp, and the
      // base pose must still match the static PNG at the same time.
      const scene = createElement(
        "Canvas",
        { width: 80, height: 40 },
        createElement("Box", {
          id: "spring-box",
          width: 40,
          height: 40,
          background: "#2563eb",
          animate: {
            keyframes: [
              { at: 0, opacity: 0, transform: { translateX: 0 } },
              { at: 1, opacity: 1, transform: { translateX: 10 } },
            ],
            durationMs: 400,
            easing: { type: "spring", stiffness: 170, damping: 14 },
            fill: "both",
          },
        }),
      );
      const timeMs = 250;
      const node = findNode(engine.renderToIR(scene, { timeMs }).root, "spring-box");

      // Transform channels extrapolate past the keyframe pair...
      expect(node?.type === "group" ? node.transform?.translateX : undefined).toBeGreaterThan(10);
      // ...while opacity stays inside the range its own validation enforces.
      expect(node?.type === "group" ? node.opacity : undefined).toBe(1);

      const declarativeSvg = engine.renderToAnimatedSvg(scene, {
        playback: { mode: "independent" },
        timeMs,
      });
      expect(declarativeSvg).not.toMatch(/opacity="1\.\d+"/);
      expect(rasterize(declarativeSvg)).toEqual(engine.renderToPng(scene, { timeMs }));
    });

    it("declares a linear fallback before the linear() curve", () => {
      // A viewer without linear() support drops that declaration at parse time.
      // Without a preceding one the property would revert to `ease`; ordering
      // these two degrades the spring to straight interpolation instead.
      const svg = engine.renderToAnimatedSvg(springScene({ type: "spring" }), {
        playback: { mode: "independent" },
        timeMs: 0,
      });
      const declarations = [...svg.matchAll(/animation-timing-function: ([^;]*);/g)].map(
        (match) => match[1],
      );

      expect(declarations).toHaveLength(2);
      expect(declarations[0]).toBe("linear");
      expect(declarations[1]?.startsWith("linear(")).toBe(true);
    });

    it("emits no fallback declaration for non-spring easing", () => {
      const svg = engine.renderToAnimatedSvg(springScene({ type: "steps", count: 4 }), {
        playback: { mode: "independent" },
        timeMs: 0,
      });
      const declarations = [...svg.matchAll(/animation-timing-function: ([^;]*);/g)];

      expect(declarations).toHaveLength(1);
    });

    it("keeps declarative spring output byte identical across renders", () => {
      const render = () =>
        engine.renderToAnimatedSvg(springScene({ type: "spring", stiffness: 170, damping: 14 }), {
          playback: { mode: "independent" },
          timeMs: 0,
        });
      expect(render()).toBe(render());
    });

    it("samples a different static pose than the default easing", () => {
      const springOpacity = springBoxOpacity(engine, { type: "spring" }, 150);
      const easeOpacity = springBoxOpacity(engine, "ease", 150);

      expect(springOpacity).toBeDefined();
      expect(springOpacity).not.toBe(easeOpacity);
    });

    it("reaches the final keyframe value at the segment end", () => {
      expect(springBoxOpacity(engine, { type: "spring" }, 500)).toBe(1);
    });

    it("clamps to the interior keyframe value at an exact segment boundary", () => {
      // keyframe_segment short-circuits at the last keyframe, so the u=1 clamp
      // is only reachable through a segment that ends mid-timeline.
      const scene = springKeyframeScene([0, 0.5, 1], { type: "spring" });
      const node = findNode(engine.renderToIR(scene, { timeMs: 200 }).root, "spring-frames");

      expect(node?.type === "group" ? node.opacity : undefined).toBe(0.25);
    });

    it("derives the emitted linear() from the first authored segment", () => {
      const timing = (offsets: readonly number[]) =>
        /animation-timing-function: (linear\([^)]*\));/.exec(
          engine.renderToAnimatedSvg(springKeyframeScene(offsets, { type: "spring" }), {
            playback: { mode: "independent" },
            timeMs: 0,
          }),
        )?.[1];

      // 0..0.25 of 400ms is a 100ms first segment; 0..0.5 is a 200ms one, so
      // uneven keyframes must not produce the evenly spaced curve.
      expect(timing([0, 0.5, 1])).toBeDefined();
      expect(timing([0, 0.25, 1])).not.toBe(timing([0, 0.5, 1]));
      expect(timing([0, 0.5, 1])).toBe(timing([0, 0.5, 1]));
    });

    it.each([
      0, 120, 400, 900,
    ])("keeps the declarative spring base pose identical to static PNG at timeMs=%i", (timeMs) => {
      const scene = springScene({ type: "spring", stiffness: 170, damping: 14 });
      const declarativeSvg = engine.renderToAnimatedSvg(scene, {
        playback: { mode: "independent" },
        timeMs,
      });
      expect(rasterize(declarativeSvg)).toEqual(engine.renderToPng(scene, { timeMs }));
    });

    it.each([
      { type: "spring", stiffness: 0.5 },
      { type: "spring", stiffness: 1001 },
      { type: "spring", damping: 0.5 },
      { type: "spring", damping: 101 },
      { type: "spring", mass: 0.05 },
      { type: "spring", mass: 10.5 },
      { type: "spring", stiffness: Number.NaN },
      { type: "spring", stiffness: Number.POSITIVE_INFINITY },
    ] as const)("rejects out-of-range spring parameters (%o)", (easing) => {
      expect(() =>
        engine.renderToAnimatedSvg(springScene(easing), { playback: { mode: "independent" } }),
      ).toThrow(FatalError);
    });

    it("rejects unknown spring keys", () => {
      const easing = { type: "spring", velocity: 2 } as unknown as AnimationEasing;
      expect(() =>
        engine.renderToAnimatedSvg(springScene(easing), { playback: { mode: "independent" } }),
      ).toThrow(FatalError);
    });

    it("still accepts steps easing objects", () => {
      const svg = engine.renderToAnimatedSvg(springScene({ type: "steps", count: 4 }), {
        playback: { mode: "independent" },
        timeMs: 0,
      });
      expect(svg).toContain("animation-timing-function: steps(4, jump-end);");
    });
  });
  describe("reducedMotion", () => {
    const REDUCED_MOTION_BLOCK = "@media (prefers-reduced-motion: reduce) {";

    it("leaves output byte identical when unspecified or explicitly kept", () => {
      const scene = () => nativeAnimatedScene.build();
      const base = engine.renderToAnimatedSvg(scene(), {
        playback: { mode: "independent" },
        timeMs: 250,
      });

      expect(
        engine.renderToAnimatedSvg(scene(), {
          playback: { mode: "independent" },
          timeMs: 250,
          reducedMotion: "keep",
        }),
      ).toBe(base);
      expect(base).not.toContain(REDUCED_MOTION_BLOCK);
    });

    it("appends exactly one media block covering every animated class", () => {
      const svg = engine.renderToAnimatedSvg(nativeAnimatedScene.build(), {
        playback: { mode: "independent" },
        timeMs: 250,
        reducedMotion: "pause",
      });
      const blocks = svg.match(/@media \(prefers-reduced-motion: reduce\) \{/g) ?? [];
      const selectors = /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*([^\n]*?) \{/.exec(
        svg,
      )?.[1];
      const animatedClasses = [...svg.matchAll(/^\s*\.([\w\\:.-]+) \{$/gm)].map(
        (match) => match[1],
      );

      expect(blocks).toHaveLength(1);
      expect(animatedClasses.length).toBeGreaterThan(0);
      // Every class that got animation-* rules must also be paused.
      for (const className of animatedClasses) {
        expect(selectors, className).toContain(`.${className}`);
      }
      expect(svg).toContain("animation: none !important;");
    });

    it("keeps the pause block inside the single style element", () => {
      const svg = engine.renderToAnimatedSvg(nativeAnimatedScene.build(), {
        playback: { mode: "independent" },
        reducedMotion: "pause",
      });
      const styleBlocks = svg.match(/<style>/g) ?? [];

      expect(styleBlocks).toHaveLength(1);
      // Last rule wins in the cascade, so it has to come after the per-class rules.
      expect(svg.indexOf(REDUCED_MOTION_BLOCK)).toBeGreaterThan(svg.indexOf("animation-name:"));
      expect(svg.indexOf(REDUCED_MOTION_BLOCK)).toBeLessThan(svg.indexOf("</style>"));
    });

    it("covers text unit animation classes too", () => {
      const scene = createElement(
        "Canvas",
        { width: 240, height: 100 },
        createElement(
          "Text",
          {
            id: "reduced-units",
            font: "NotoSansJP",
            fontSizePx: 40,
            color: "#ffffff",
            animateUnits: {
              by: "cluster" as const,
              delayStepMs: 50,
              animation: {
                keyframes: [
                  { at: 0, opacity: 0 },
                  { at: 1, opacity: 1 },
                ],
                durationMs: 300,
                easing: "linear" as const,
                fill: "both" as const,
              },
            },
          },
          "AB",
        ),
      );
      const svg = engine.renderToAnimatedSvg(scene, {
        playback: { mode: "independent" },
        reducedMotion: "pause",
      });
      const selectors = /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*([^\n]*?) \{/.exec(
        svg,
      )?.[1];

      // Two clusters, so two unit classes have to appear in the selector list.
      expect(selectors?.split(", ")).toHaveLength(2);
    });

    it("rejects reducedMotion on the static SVG entry point", () => {
      expect(() =>
        engine.renderToSvg(nativeAnimatedScene.build(), {
          timeMs: 0,
          reducedMotion: "pause",
        } as unknown as RenderSvgOptions),
      ).toThrow(expect.objectContaining({ code: "UNSUPPORTED_RENDER_OPTION" }));
    });

    it("honors reducedMotion through the compiled emit path", () => {
      // Animated SVG emit options declare reducedMotion, so it must not be
      // dropped on the way to the emitter.
      const compiled = engine.compile(nativeAnimatedScene.build());
      const svg = engine.renderCompiledToAnimatedSvg(compiled, {
        playback: { mode: "independent" },
        timeMs: 200,
        reducedMotion: "pause",
      });

      expect(svg).toContain("@media (prefers-reduced-motion: reduce) {");
    });

    it("keeps the base pose identical to static PNG with the pause block", () => {
      // The whole safety argument for `animation: none` is the base pose
      // invariant, so pin it with the block present.
      const scene = nativeAnimatedScene.build();
      const declarativeSvg = engine.renderToAnimatedSvg(scene, {
        playback: { mode: "independent" },
        timeMs: 250,
        reducedMotion: "pause",
      });

      expect(rasterize(declarativeSvg)).toEqual(engine.renderToPng(scene, { timeMs: 250 }));
    });

    it("rejects an unknown reducedMotion mode", () => {
      expect(() =>
        engine.renderToAnimatedSvg(nativeAnimatedScene.build(), {
          playback: { mode: "independent" },
          reducedMotion: "off" as "keep",
        }),
      ).toThrow(FatalError);
    });
  });
  describe("sampleAnimationState", () => {
    function twoNodeScene() {
      return createElement(
        "Canvas",
        { width: 120, height: 60 },
        createElement("Box", {
          id: "moving",
          width: 40,
          height: 40,
          background: "#2563eb",
          animate: {
            keyframes: [
              { at: 0, opacity: 0, transform: { translateX: 0 } },
              { at: 1, opacity: 1, transform: { translateX: 20 } },
            ],
            durationMs: 400,
            easing: "linear",
            fill: "both",
          },
        }),
        createElement("Box", { id: "still", width: 40, height: 40, background: "#e11d48" }),
      );
    }

    it("returns only the animated node", () => {
      const samples = engine.sampleAnimationState(twoNodeScene(), 0);

      expect(samples.map((sample) => sample.nodeId)).toEqual(["moving"]);
    });

    it("resolves start, middle, and end values", () => {
      const scene = twoNodeScene();
      const at = (timeMs: number) => engine.sampleAnimationState(scene, timeMs)[0];

      expect(at(0)?.opacity).toBe(0);
      expect(at(200)?.opacity).toBeCloseTo(0.5, 10);
      expect(at(400)?.opacity).toBe(1);
      expect(at(0)?.transform?.e).toBeCloseTo(0, 10);
      expect(at(200)?.transform?.e).toBeCloseTo(10, 10);
      expect(at(400)?.transform?.e).toBeCloseTo(20, 10);
    });

    it("agrees with the sampled IR at the same time", () => {
      // The inspector must not disagree with what the render actually drew.
      const scene = twoNodeScene();
      const sample = engine.sampleAnimationState(scene, 150)[0];
      const node = findNode(engine.renderToIR(scene, { timeMs: 150 }).root, "moving");
      const irOpacity = node?.type === "group" ? node.opacity : undefined;

      expect(sample?.opacity).toBeCloseTo(irOpacity ?? Number.NaN, 12);
    });

    it("reports a null transform when only opacity animates", () => {
      const scene = springScene("linear");
      const sample = engine.sampleAnimationState(scene, 200)[0];

      expect(sample?.opacity).toBeCloseTo(0.5, 10);
      expect(sample?.transform).toBeNull();
    });

    it("keeps the layout bbox centre fixed when only scale animates", () => {
      // Scaling about the node centre must leave that centre where it is. The
      // sampler stores a node-local origin while the emitter paints about the
      // absolute centre, so a missing rebase shows up here and nowhere else.
      const scene = createElement(
        "Canvas",
        { width: 300, height: 200 },
        createElement("Box", { width: 60, height: 40, background: "#eeeeee" }),
        createElement("Box", {
          id: "card",
          width: 120,
          height: 60,
          background: "#2563eb",
          animate: {
            keyframes: [
              { at: 0, opacity: 0, transform: { scaleX: 0.8, scaleY: 0.8 } },
              { at: 1, opacity: 1, transform: { scaleX: 1, scaleY: 1 } },
            ],
            durationMs: 400,
            easing: "linear",
            fill: "both",
          },
        }),
      );
      const node = findNode(engine.renderToIR(scene, { timeMs: 100 }).root, "card");
      const bbox = node?.bbox;
      const matrix = engine.sampleAnimationState(scene, 100)[0]?.transform;
      const centreX = (bbox?.x ?? 0) + (bbox?.w ?? 0) / 2;
      const centreY = (bbox?.y ?? 0) + (bbox?.h ?? 0) / 2;

      expect(matrix).toBeDefined();
      expect(matrix!.a * centreX + matrix!.c * centreY + matrix!.e).toBeCloseTo(centreX, 6);
      expect(matrix!.b * centreX + matrix!.d * centreY + matrix!.f).toBeCloseTo(centreY, 6);
    });

    it("maps a probe point exactly like the emitted transform attribute", () => {
      const scene = createElement(
        "Canvas",
        { width: 300, height: 200 },
        createElement("Box", { width: 60, height: 40, background: "#eeeeee" }),
        createElement("Box", {
          id: "card",
          width: 120,
          height: 60,
          background: "#2563eb",
          animate: {
            keyframes: [
              { at: 0, opacity: 0, transform: { scaleX: 0.5, scaleY: 0.5, rotateDeg: 0 } },
              { at: 1, opacity: 1, transform: { scaleX: 2, scaleY: 2, rotateDeg: 90 } },
            ],
            durationMs: 400,
            easing: "linear",
            fill: "both",
          },
        }),
      );
      const svg = engine.renderToSvg(scene, { timeMs: 400 });
      const attr = /data-boundsvg-node-id="card" transform="([^"]*)"/.exec(svg)?.[1];
      const rotate = /rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)/.exec(attr ?? "");
      const scale = /scale\(([-\d.]+) ([-\d.]+)\)/.exec(attr ?? "");
      const matrix = engine.sampleAnimationState(scene, 400)[0]?.transform;

      expect(attr, svg).toBeDefined();
      expect(rotate, attr).not.toBeNull();
      expect(scale, attr).not.toBeNull();

      // Rebuild the emitter's list independently and compare mapped points.
      const angle = (Number(rotate?.[1]) * Math.PI) / 180;
      const originX = Number(rotate?.[2]);
      const originY = Number(rotate?.[3]);
      const scaleX = Number(scale?.[1]);
      const scaleY = Number(scale?.[2]);
      const expected = (x: number, y: number) => {
        const localX = (x - originX) * scaleX;
        const localY = (y - originY) * scaleY;
        return [
          originX + localX * Math.cos(angle) - localY * Math.sin(angle),
          originY + localX * Math.sin(angle) + localY * Math.cos(angle),
        ];
      };
      for (const [probeX, probeY] of [
        [0, 0],
        [120, 40],
        [37, 91],
      ]) {
        const [wantX, wantY] = expected(probeX, probeY);
        expect(matrix!.a * probeX + matrix!.c * probeY + matrix!.e).toBeCloseTo(wantX, 6);
        expect(matrix!.b * probeX + matrix!.d * probeY + matrix!.f).toBeCloseTo(wantY, 6);
      }
    });

    it("is deterministic for the same time", () => {
      const scene = twoNodeScene();
      expect(engine.sampleAnimationState(scene, 137)).toEqual(
        engine.sampleAnimationState(scene, 137),
      );
    });

    it("rejects a negative or non-finite time", () => {
      const scene = twoNodeScene();
      expect(() => engine.sampleAnimationState(scene, -1)).toThrow(FatalError);
      expect(() => engine.sampleAnimationState(scene, Number.NaN)).toThrow(FatalError);
    });
  });
});
