import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Frame, RenderFramesOptions } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import { createWasmEngineInstance, getWasm, type WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const TINY_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function createAnimationFreeScene(): VNode {
  return createElement(
    "Canvas",
    { width: 240, height: 140, background: "#0f172a" },
    createElement("Box", {
      width: 96,
      height: 72,
      margin: [24, 0, 0, 32],
      borderRadius: 12,
      background: "#38bdf8",
    }),
  );
}

function createTextHeavyScene(): VNode {
  return createElement(
    "Canvas",
    { width: 480, height: 300, background: "#f8fafc" },
    createElement(
      "Flex",
      {
        direction: "column",
        gap: 6,
        width: 480,
        height: 300,
        padding: [16, 20, 16, 20],
      },
      ...Array.from({ length: 7 }, (_, index) =>
        createElement(
          "Text",
          {
            width: 440,
            font: "NotoSansJP",
            fallback: ["InterVariable"],
            fontSizePx: 18,
            color: index % 2 === 0 ? "#0f172a" : "#475569",
            wrap: "char",
          },
          `${index + 1}. 決定的フレーム Ligature office e\u0301 🎬`,
        ),
      ),
    ),
  );
}

function createImageHeavyScene(): VNode {
  return createElement(
    "Canvas",
    { width: 320, height: 220, background: "#111827" },
    createElement(
      "Flex",
      {
        direction: "row",
        wrap: "wrap",
        gap: 6,
        width: 320,
        height: 220,
        padding: [12, 12, 12, 12],
      },
      ...Array.from({ length: 12 }, (_, index) =>
        createElement("Image", {
          src: TINY_PNG_DATA_URI,
          width: 64,
          height: 56,
          borderRadius: index % 3,
          opacity: 0.6 + (index % 4) * 0.1,
          objectFit: "cover",
        }),
      ),
    ),
  );
}

function createMultipleTrackScene(): VNode {
  return createElement(
    "Canvas",
    { width: 360, height: 200, background: "#020617" },
    createElement(
      "Flex",
      {
        direction: "row",
        gap: 16,
        width: 360,
        height: 200,
        padding: [40, 32, 40, 32],
      },
      ...Array.from({ length: 3 }, (_, index) =>
        createElement("Box", {
          width: 80,
          height: 80,
          borderRadius: 12,
          background: index % 2 === 0 ? "#22d3ee" : "#a78bfa",
          animate: {
            keyframes: [
              {
                at: 0,
                opacity: 0.2,
                transform: { translateX: -12, rotateDeg: -8, scaleX: 0.8, scaleY: 0.8 },
              },
              {
                at: 1,
                opacity: 1,
                transform: { translateX: 16, rotateDeg: 10, scaleX: 1.1, scaleY: 1.1 },
              },
            ],
            durationMs: 800 + index * 200,
            delayMs: index * 75,
            easing: index % 2 === 0 ? "ease-in-out" : "linear",
            fill: "both",
          },
        }),
      ),
    ),
  );
}

function expectFatalCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`Expected FatalError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    expect((error as FatalError).code).toBe(code);
  }
}

const PARITY_CASES: ReadonlyArray<{ name: string; build: () => VNode }> = [
  { name: "animation-free", build: createAnimationFreeScene },
  { name: "text-heavy", build: createTextHeavyScene },
  { name: "image-heavy", build: createImageHeavyScene },
  { name: "multiple-track", build: createMultipleTrackScene },
];

describe("Engine.renderFrames", () => {
  let handle: WasmEngineHandle;
  let engine: ReturnType<typeof createEngineFromHandle>;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    engine = createEngineFromHandle(handle, { svgToPngFn: handle.createSvgToPngFn() });
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it.each(PARITY_CASES)("keeps $name SVG frames byte-equal and input-ordered", ({ build }) => {
    const scene = build();
    const timesMs = [600, 0, 1_400, 600] as const;
    const frames = [...engine.renderFrames(scene, { timesMs, format: "svg" })];

    expect(frames).toHaveLength(timesMs.length);
    for (const [index, frame] of frames.entries()) {
      const timeMs = timesMs[index];
      expect(frame).toMatchObject({ index, timeMs, format: "svg" });
      expect(frame.data).toBe(engine.renderToSvg(scene, { timeMs }));
    }
  });

  it.each(PARITY_CASES)("keeps $name PNG frames byte-equal", ({ build }) => {
    const scene = build();
    const timesMs = [600, 0, 1_400, 600] as const;
    const frames = [...engine.renderFrames(scene, { timesMs, format: "png" })];

    for (const [index, frame] of frames.entries()) {
      const timeMs = timesMs[index];
      expect(frame).toMatchObject({ index, timeMs, format: "png" });
      expect(frame.data).toEqual(engine.renderToPng(scene, { timeMs }));
    }
  });

  it("keeps an empty PNG background byte-equal with one-shot rendering", () => {
    const scene = createAnimationFreeScene();
    const [frame] = [
      ...engine.renderFrames(scene, { timesMs: [0], format: "png", rasterBackground: "" }),
    ];

    expect(frame?.data).toEqual(engine.renderToPng(scene, { timeMs: 0, rasterBackground: "" }));
  });

  it("preserves format-specific SVG and PNG emit options on every frame", () => {
    const scene = createTextHeavyScene();
    const timesMs = [0, 600] as const;
    const svgFrames = [
      ...engine.renderFrames(scene, {
        timesMs,
        format: "svg",
        scale: 1.5,
        debug: true,
        resourceIdPrefix: "frame prefix",
        textPathMode: "glyphs",
        showMissingGlyphs: true,
      }),
    ];
    const pngFrames = [
      ...engine.renderFrames(scene, {
        timesMs,
        format: "png",
        scale: 1.25,
        textPathMode: "glyphs",
        showMissingGlyphs: true,
        rasterBackground: "#0f172a",
        rasterOversizeBehavior: "error",
      }),
    ];

    for (const [index, timeMs] of timesMs.entries()) {
      expect(svgFrames[index]?.data).toBe(
        engine.renderToSvg(scene, {
          timeMs,
          scale: 1.5,
          debug: true,
          resourceIdPrefix: "frame prefix",
          textPathMode: "glyphs",
          showMissingGlyphs: true,
        }),
      );
      expect(pngFrames[index]?.data).toEqual(
        engine.renderToPng(scene, {
          timeMs,
          scale: 1.25,
          textPathMode: "glyphs",
          showMissingGlyphs: true,
          rasterBackground: "#0f172a",
          rasterOversizeBehavior: "error",
        }),
      );
    }
  });

  it("copies the schedule before iteration", () => {
    const mutableTimes = [0, 600];
    const iterable = engine.renderFrames(createMultipleTrackScene(), {
      timesMs: mutableTimes,
      format: "svg",
    });
    mutableTimes[0] = 1_400;
    mutableTimes.push(2_000);

    expect([...iterable].map((frame) => frame.timeMs)).toEqual([0, 600]);
  });

  it("snapshots format and emit options before iteration", () => {
    const mutableOptions: RenderFramesOptions = {
      timesMs: [0],
      format: "svg",
      scale: 1,
      debug: false,
    };
    const scene = createMultipleTrackScene();
    const iterable = engine.renderFrames(scene, mutableOptions);
    mutableOptions.format = "png";
    mutableOptions.scale = 2;
    mutableOptions.debug = true;

    const frames = [...iterable];
    expect(frames[0]?.format).toBe("svg");
    expect(frames[0]?.data).toBe(engine.renderToSvg(scene, { timeMs: 0, scale: 1, debug: false }));
  });

  it("keeps detached snapshot mutations out of compiled iteration", () => {
    const compiled = engine.compile(createMultipleTrackScene());
    const detachedSnapshot = engine.snapshotCompiledIR(compiled);
    detachedSnapshot.debug = false;
    const expected = engine.renderCompiledToSvg(compiled, { timeMs: 0 });
    const iterable = engine.renderCompiledFrames(compiled, {
      timesMs: [0],
      format: "svg",
    });
    detachedSnapshot.debug = true;
    detachedSnapshot.width = 999;
    detachedSnapshot.root.bbox.w = 999;

    expect([...iterable]).toEqual([{ index: 0, timeMs: 0, format: "svg", data: expected }]);
  });

  it("prepares native state once and samples it once per frame", () => {
    let prepareCount = 0;
    let nativeRenderCount = 0;
    const countedEngine = createEngineFromHandle(handle, {
      prepareSceneFn: (irJson) => {
        prepareCount += 1;
        const prepared = handle.prepareScene(irJson);
        const release = (): void => prepared.dispose();
        return {
          renderToSvg: (optionsJson) => {
            nativeRenderCount += 1;
            return prepared.renderToSvg(optionsJson);
          },
          dispose: release,
        };
      },
    });
    try {
      expect([
        ...countedEngine.renderFrames(createTextHeavyScene(), {
          timesMs: [0, 600, 1_400, 600],
          format: "svg",
        }),
      ]).toHaveLength(4);
      expect(prepareCount).toBe(1);
      expect(nativeRenderCount).toBe(4);
    } finally {
      countedEngine.dispose();
    }
  });

  it("compiles source input once and does not recompile compiled input", () => {
    let compileCount = 0;
    let prepareCount = 0;
    const countedEngine = createEngineFromHandle(handle, {
      renderToIrFn: (inputJson, optionsJson) => {
        compileCount += 1;
        return handle.renderToIr(inputJson, optionsJson);
      },
      prepareSceneFn: (irJson, optionsJson) => {
        prepareCount += 1;
        return handle.prepareScene(irJson, optionsJson);
      },
    });
    try {
      const scene = createMultipleTrackScene();
      const compiled = countedEngine.compile(scene);
      expect(compileCount).toBe(1);

      compileCount = 0;
      const sourceFrames = [
        ...countedEngine.renderFrames(scene, { timesMs: [0, 600], format: "svg" }),
      ];
      expect(compileCount).toBe(1);
      expect(prepareCount).toBe(1);

      compileCount = 0;
      const compiledFrames = [
        ...countedEngine.renderCompiledFrames(compiled, {
          timesMs: [0, 600],
          format: "svg",
        }),
      ];
      expect(compileCount).toBe(0);
      expect(prepareCount).toBe(2);
      expect(compiledFrames).toEqual(sourceFrames);
    } finally {
      countedEngine.dispose();
    }
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
  ])("rejects every invalid time before preparing any frame (%s)", (invalidTime) => {
    let prepareCount = 0;
    const validationEngine = createEngineFromHandle(handle, {
      prepareSceneFn: (irJson) => {
        prepareCount += 1;
        return handle.prepareScene(irJson);
      },
    });
    try {
      expectFatalCode(
        () =>
          validationEngine.renderFrames(createAnimationFreeScene(), {
            timesMs: [0, invalidTime, 600],
            format: "svg",
          }),
        "ANIMATION_INVALID_TIME",
      );
      expect(prepareCount).toBe(0);
    } finally {
      validationEngine.dispose();
    }
  });

  it("rejects an invalid runtime format before preparing", () => {
    let prepareCount = 0;
    const validationEngine = createEngineFromHandle(handle, {
      prepareSceneFn: (irJson) => {
        prepareCount += 1;
        return handle.prepareScene(irJson);
      },
    });
    try {
      expectFatalCode(
        () =>
          validationEngine.renderFrames(createAnimationFreeScene(), {
            timesMs: [0],
            format: "webp",
          } as unknown as { timesMs: readonly number[]; format: "svg" }),
        "ANIMATION_INVALID_FRAME_FORMAT",
      );
      expect(prepareCount).toBe(0);
    } finally {
      validationEngine.dispose();
    }
  });

  it.each([
    { format: "svg" as const, scale: 0, code: "SVG_INVALID_SCALE" },
    { format: "svg" as const, scale: Number.NaN, code: "SVG_INVALID_SCALE" },
    { format: "png" as const, scale: -1, code: "PNG_INVALID_SCALE" },
    { format: "png" as const, scale: Number.POSITIVE_INFINITY, code: "PNG_INVALID_SCALE" },
  ])("rejects invalid $format scale $scale before preparing", ({ format, scale, code }) => {
    let prepareCount = 0;
    const validationEngine = createEngineFromHandle(handle, {
      svgToPngFn: handle.createSvgToPngFn(),
      prepareSceneFn: (irJson) => {
        prepareCount += 1;
        return handle.prepareScene(irJson);
      },
    });
    try {
      expectFatalCode(
        () =>
          validationEngine.renderFrames(createAnimationFreeScene(), {
            timesMs: [0],
            format,
            scale,
          }),
        code,
      );
      expect(prepareCount).toBe(0);
    } finally {
      validationEngine.dispose();
    }
  });

  it("rejects PNG without a rasterizer before preparing", () => {
    let prepareCount = 0;
    const validationEngine = createEngineFromHandle(handle, {
      prepareSceneFn: (irJson) => {
        prepareCount += 1;
        return handle.prepareScene(irJson);
      },
    });
    try {
      expectFatalCode(
        () =>
          validationEngine.renderFrames(createAnimationFreeScene(), {
            timesMs: [0],
            format: "png",
          }),
        "PNG_NO_RASTERIZER",
      );
      expect(prepareCount).toBe(0);
    } finally {
      validationEngine.dispose();
    }
  });

  it.each([
    "source",
    "compiled",
  ] as const)("preflights and releases before rejecting strict PNG oversize (%s)", (entryKind) => {
    let preflightCount = 0;
    let resolveCount = 0;
    let disposeCount = 0;
    const validationEngine = createEngineFromHandle(handle, {
      svgToPngFn: handle.createSvgToPngFn(),
      preflightRasterSceneFn: (irJson, optionsJson) => {
        preflightCount += 1;
        const rasterScene = handle.preflightRasterScene(irJson, optionsJson);
        return {
          resolveAndEmitToSvg: () => rasterScene.resolveAndEmitToSvg(),
          resolveToIr: () => rasterScene.resolveToIr(),
          resolve: () => {
            resolveCount += 1;
            rasterScene.resolve();
          },
          renderToSvg: (renderOptionsJson) => rasterScene.renderToSvg(renderOptionsJson),
          dispose: () => {
            disposeCount += 1;
            rasterScene.dispose();
          },
        };
      },
    });
    const oversizedScene = createElement("Canvas", {
      width: 4_000,
      height: 4_000,
      background: "#000",
    });
    const renderOversizedFrames =
      entryKind === "source"
        ? () =>
            validationEngine.renderFrames(oversizedScene, {
              timesMs: [0],
              format: "png",
              scale: 2,
              rasterOversizeBehavior: "error",
            })
        : () =>
            validationEngine.renderCompiledFrames(validationEngine.compile(oversizedScene), {
              timesMs: [0],
              format: "png",
              scale: 2,
              rasterOversizeBehavior: "error",
            });
    try {
      expectFatalCode(renderOversizedFrames, "PNG_PIXEL_LIMIT");
      expect(preflightCount).toBe(1);
      expect(resolveCount).toBe(0);
      expect(disposeCount).toBe(1);
    } finally {
      validationEngine.dispose();
    }
  });

  it("authenticates compiled artifacts before native frame preparation", () => {
    let prepareCount = 0;
    let rasterPreflightCount = 0;
    const validationEngine = createEngineFromHandle(handle, {
      svgToPngFn: handle.createSvgToPngFn(),
      prepareSceneFn: (irJson, optionsJson) => {
        prepareCount += 1;
        return handle.prepareScene(irJson, optionsJson);
      },
      preflightRasterSceneFn: (irJson, optionsJson) => {
        rasterPreflightCount += 1;
        return handle.preflightRasterScene(irJson, optionsJson);
      },
    });
    try {
      const authentic = validationEngine.compile(createAnimationFreeScene());
      const forged = { ...authentic };
      expectFatalCode(
        () =>
          Reflect.apply(validationEngine.renderCompiledFrames, validationEngine, [
            forged,
            { timesMs: [Number.NaN], format: "svg" },
          ]),
        "COMPILED_SCENE_INVALID",
      );

      const otherEngine = createEngineFromHandle(handle);
      expectFatalCode(
        () =>
          otherEngine.renderCompiledFrames(authentic, {
            timesMs: [Number.NaN],
            format: "png",
          }),
        "COMPILED_SCENE_WRONG_ENGINE",
      );
      otherEngine.dispose();
      expect(prepareCount).toBe(0);
      expect(rasterPreflightCount).toBe(0);
    } finally {
      validationEngine.dispose();
    }
  });

  it("delivers compiled warnings once and preserves PNG resolution adjustment", () => {
    const compiled = engine.compile(
      createElement(
        "Canvas",
        { width: 240, height: 140 },
        createElement("Image", {
          src: "https://example.test/frame-warning.png",
          width: 20,
          height: 20,
        }),
      ),
    );
    const warningCodes: string[] = [];
    const adjustments: Array<{ requestedScale: number; appliedScale: number }> = [];
    const frames = [
      ...engine.renderCompiledFrames(compiled, {
        timesMs: [0, 10],
        format: "png",
        scale: 2,
        onWarning: (warning) => warningCodes.push(warning.code),
        onPngResolutionAdjusted: ({ requestedScale, appliedScale }) =>
          adjustments.push({ requestedScale, appliedScale }),
      }),
    ];

    expect(frames).toHaveLength(2);
    expect(warningCodes).toEqual(["IMAGE_SRC_NOT_EMBEDDED"]);
    expect(adjustments).toEqual([]);

    const oversized = engine.compile(
      createElement("Canvas", { width: 4_000, height: 4_000, background: "#000" }),
    );
    const originalWarnings = engine.snapshotCompiledIR(oversized).warnings;
    const oversizedWarningCodes: string[] = [];
    for (let renderIndex = 0; renderIndex < 2; renderIndex += 1) {
      expect([
        ...engine.renderCompiledFrames(oversized, {
          timesMs: [],
          format: "png",
          scale: 2,
          onWarning: (warning) => oversizedWarningCodes.push(warning.code),
          onPngResolutionAdjusted: ({ requestedScale, appliedScale }) =>
            adjustments.push({ requestedScale, appliedScale }),
        }),
      ]).toEqual([]);
      expect(engine.snapshotCompiledIR(oversized).warnings).toEqual(originalWarnings);
    }
    expect(oversizedWarningCodes).toEqual(["PNG_RESOLUTION_ADJUSTED", "PNG_RESOLUTION_ADJUSTED"]);
    expect(adjustments).toHaveLength(2);
    expect(adjustments[0]?.requestedScale).toBe(2);
    expect(adjustments[0]?.appliedScale).toBeLessThan(2);
  });
});

describe("prepared frame lifetime", () => {
  let handle: WasmEngineHandle;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
  });

  afterAll(() => {
    handle.dispose();
  });

  function createTrackedEngine(options?: { failAtRender?: number }): {
    engine: ReturnType<typeof createEngineFromHandle>;
    disposeCount: () => number;
  } {
    let disposed = 0;
    let renderCount = 0;
    const trackedEngine = createEngineFromHandle(handle, {
      prepareSceneFn: (irJson) => {
        const prepared = handle.prepareScene(irJson);
        const release = (): void => {
          if (!prepared.isDisposed) {
            disposed += 1;
          }
          prepared.dispose();
        };
        return {
          renderToSvg: (optionsJson) => {
            if (renderCount === options?.failAtRender) {
              throw new FatalError("TEST_RENDER_FAILURE", "Injected frame failure", {
                stage: "emit",
              });
            }
            renderCount += 1;
            return prepared.renderToSvg(optionsJson);
          },
          dispose: release,
        };
      },
    });
    return { engine: trackedEngine, disposeCount: () => disposed };
  }

  const frameEntryKinds = ["source", "compiled"] as const;

  function renderTrackedFrames(
    trackedEngine: ReturnType<typeof createEngineFromHandle>,
    entryKind: (typeof frameEntryKinds)[number],
    scene: VNode,
    options: RenderFramesOptions,
  ): Iterable<Frame> {
    if (entryKind === "source") {
      return trackedEngine.renderFrames(scene, options);
    }
    return trackedEngine.renderCompiledFrames(trackedEngine.compile(scene), options);
  }

  it.each(
    frameEntryKinds,
  )("releases after normal completion and an empty schedule (%s)", (entryKind) => {
    const normal = createTrackedEngine();
    expect([
      ...renderTrackedFrames(normal.engine, entryKind, createAnimationFreeScene(), {
        timesMs: [0, 10],
        format: "svg",
      }),
    ]).toHaveLength(2);
    expect(normal.disposeCount()).toBe(1);
    normal.engine.dispose();

    const empty = createTrackedEngine();
    expect([
      ...renderTrackedFrames(empty.engine, entryKind, createAnimationFreeScene(), {
        timesMs: [],
        format: "svg",
      }),
    ]).toEqual([]);
    expect(empty.disposeCount()).toBe(1);
    empty.engine.dispose();
  });

  it.each(frameEntryKinds)("releases on early return and iterator throw (%s)", (entryKind) => {
    const early = createTrackedEngine();
    for (const _frame of renderTrackedFrames(early.engine, entryKind, createAnimationFreeScene(), {
      timesMs: [0, 10],
      format: "svg",
    })) {
      break;
    }
    expect(early.disposeCount()).toBe(1);
    early.engine.dispose();

    const thrown = createTrackedEngine();
    const iterator = renderTrackedFrames(thrown.engine, entryKind, createAnimationFreeScene(), {
      timesMs: [0, 10],
      format: "svg",
    })[Symbol.iterator]();
    const sentinel = new Error("consumer stopped");
    expect(() => iterator.throw?.(sentinel)).toThrow(sentinel);
    expect(thrown.disposeCount()).toBe(1);
    thrown.engine.dispose();
  });

  it.each(frameEntryKinds)("releases on render failure (%s)", (entryKind) => {
    const tracked = createTrackedEngine({ failAtRender: 1 });
    const iterator = renderTrackedFrames(tracked.engine, entryKind, createAnimationFreeScene(), {
      timesMs: [0, 10],
      format: "svg",
    })[Symbol.iterator]();
    expect(iterator.next().done).toBe(false);
    expectFatalCode(() => iterator.next(), "TEST_RENDER_FAILURE");
    expect(tracked.disposeCount()).toBe(1);
    tracked.engine.dispose();
  });

  it.each(frameEntryKinds)("tracks multiple active iterators independently (%s)", (entryKind) => {
    const tracked = createTrackedEngine();
    const scene = createAnimationFreeScene();
    const first = renderTrackedFrames(tracked.engine, entryKind, scene, {
      timesMs: [0, 10],
      format: "svg",
    })[Symbol.iterator]();
    const second = renderTrackedFrames(tracked.engine, entryKind, scene, {
      timesMs: [20, 30],
      format: "svg",
    })[Symbol.iterator]();

    expect(first.next().value?.timeMs).toBe(0);
    expect(second.next().value?.timeMs).toBe(20);
    expect(tracked.disposeCount()).toBe(0);
    first.return?.();
    expect(tracked.disposeCount()).toBe(1);
    expect(second.next().value?.timeMs).toBe(30);
    expect(tracked.disposeCount()).toBe(2);
    tracked.engine.dispose();
    expect(tracked.disposeCount()).toBe(2);
  });

  it.each(
    frameEntryKinds,
  )("Engine.dispose invalidates an active iterator without double disposal (%s)", (entryKind) => {
    const tracked = createTrackedEngine();
    const iterator = renderTrackedFrames(tracked.engine, entryKind, createAnimationFreeScene(), {
      timesMs: [0, 10],
      format: "svg",
    })[Symbol.iterator]();
    expect(iterator.next().done).toBe(false);
    tracked.engine.dispose();
    expect(tracked.disposeCount()).toBe(1);
    expectFatalCode(() => iterator.next(), "ENGINE_DISPOSED");
    iterator.return?.();
    tracked.engine.dispose();
    expect(tracked.disposeCount()).toBe(1);

    const notStarted = createTrackedEngine();
    const notStartedIterator = renderTrackedFrames(
      notStarted.engine,
      entryKind,
      createAnimationFreeScene(),
      { timesMs: [0], format: "svg" },
    )[Symbol.iterator]();
    notStarted.engine.dispose();
    expect(notStarted.disposeCount()).toBe(1);
    expectFatalCode(() => notStartedIterator.next(), "ENGINE_DISPOSED");
  });
});

describe("WASM prepared scene ownership", () => {
  beforeAll(async () => {
    await createFontedWasmHandle().then((handle) => handle.dispose());
  });

  function preparedIrJson(handle: WasmEngineHandle): string {
    const ownerEngine = createEngineFromHandle(handle);
    try {
      const compiled = ownerEngine.compile(createMultipleTrackScene());
      return JSON.stringify({ ...ownerEngine.snapshotCompiledIR(compiled), warnings: [] });
    } finally {
      ownerEngine.dispose();
    }
  }

  it("rejects cross-engine and stale handles, with idempotent disposal", () => {
    const owner = createWasmEngineInstance();
    const other = createWasmEngineInstance();
    try {
      const prepared = owner.prepareScene(preparedIrJson(owner));
      expect(prepared.renderToSvg('{"animation":"static","timeMs":0}')).toContain("<svg");
      expectFatalCode(
        () => other.renderPreparedToSvg(prepared, '{"animation":"static","timeMs":0}'),
        "WASM_PREPARED_SCENE_WRONG_ENGINE",
      );

      prepared.dispose();
      prepared.dispose();
      const symbolDispose = Reflect.get(Symbol, "dispose");
      expect(typeof symbolDispose).toBe("symbol");
      const symbolDisposeMethod = Reflect.get(prepared, symbolDispose as symbol);
      expect(symbolDisposeMethod).toBeTypeOf("function");
      Reflect.apply(symbolDisposeMethod as (...args: never[]) => void, prepared, []);
      expect(prepared.isDisposed).toBe(true);
      expectFatalCode(
        () => prepared.renderToSvg('{"animation":"static","timeMs":0}'),
        "WASM_PREPARED_SCENE_DISPOSED",
      );
    } finally {
      owner.dispose();
      other.dispose();
    }
  });

  it("invalidates child handles when the owning WASM engine is disposed", () => {
    const owner = createWasmEngineInstance();
    const prepared = owner.prepareScene(preparedIrJson(owner));
    owner.dispose();

    expect(prepared.isDisposed).toBe(true);
    expectFatalCode(
      () => prepared.renderToSvg('{"animation":"static","timeMs":0}'),
      "WASM_PREPARED_SCENE_DISPOSED",
    );
    owner.dispose();
  });

  it("enforces ownership inside the native transport", () => {
    const sourceHandle = createWasmEngineInstance();
    const wasm = getWasm();
    const rawOwner = new wasm.BoundSvgEngine();
    const rawOther = new wasm.BoundSvgEngine();
    const rawPrepared = rawOwner.prepare_scene?.(preparedIrJson(sourceHandle), "{}");
    try {
      expect(rawPrepared).toBeDefined();
      expect(() =>
        rawOther.render_prepared_to_svg?.(
          rawPrepared as NonNullable<typeof rawPrepared>,
          '{"animation":"static","timeMs":0}',
        ),
      ).toThrow(/PREPARED_SCENE_WRONG_ENGINE/);
    } finally {
      rawPrepared?.free();
      rawOwner.free();
      rawOther.free();
      sourceHandle.dispose();
    }
  });
});
