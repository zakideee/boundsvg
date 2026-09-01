/**
 * Contract test: compile-once → render-many is stable.
 *
 * `CompiledScene` is an opaque, reusable artifact. Emitting from the same
 * compiled scene repeatedly — including across the PNG path, which emits with
 * rasterizer-compat options — must never change the SVG bytes. A failure here
 * means emit mutated its private compiled state.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../src/engine.js";
import { FatalError, RecoverableError } from "../src/errors.js";
import { createElement } from "../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "./helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function createTestEngine(): Engine {
  return createEngineFromHandle(handle, {
    svgToPngFn: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    svgsToAnimatedWebpFn: () => new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    svgsToAnimatedGifFn: () => new Uint8Array([0x47, 0x49, 0x46, 0x38]),
  });
}

function expectFatal(run: () => unknown, code: string, message: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    expect(error).toMatchObject({ code, message, stage: "engine" });
    expect((error as FatalError).context).toBeUndefined();
    return;
  }
  throw new TypeError(`Expected FatalError ${code}`);
}

function renderUnknownCompiled(engine: Engine, candidate: unknown): unknown {
  return Reflect.apply(engine.renderCompiledToSvg, engine, [candidate, { scale: 0 }]);
}

function collectObjectReferences(value: unknown, references = new Set<object>()): Set<object> {
  if (typeof value !== "object" || value === null || references.has(value)) {
    return references;
  }
  references.add(value);
  for (const nestedValue of Object.values(value)) {
    collectObjectReferences(nestedValue, references);
  }
  return references;
}

// The URL-string image is deliberate: it produces an IMAGE_SRC_NOT_EMBEDDED
// warning at compile time, so the warning-accumulation assertion below starts
// from a non-empty warnings array instead of vacuously comparing 0 to 0.
const scene = createElement(
  "Canvas",
  { width: 320, height: 180 },
  createElement("Box", { width: 320, height: 90, background: "#336699" }),
  createElement("Image", {
    src: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mediaType: "image/png",
    width: 64,
    height: 64,
  }),
  createElement("Image", {
    src: "https://example.test/remote.png",
    width: 64,
    height: 64,
  }),
);

describe("CompiledScene reuse", () => {
  it("exposes only frozen readonly metadata", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);
    const snapshot = engine.snapshotCompiledIR(compiled);

    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.keys(compiled)).toEqual(["width", "height", "textPathMode"]);
    expect(Object.getOwnPropertySymbols(compiled)).toHaveLength(1);
    expect("ir" in compiled).toBe(false);
    expect("dispose" in compiled).toBe(false);
    expect(compiled).toMatchObject({
      width: snapshot.width,
      height: snapshot.height,
      textPathMode: "merged",
    });
    for (const metadataName of ["width", "height", "textPathMode"]) {
      const descriptor = Object.getOwnPropertyDescriptor(compiled, metadataName);
      expect(descriptor?.get).toBeTypeOf("function");
      expect(descriptor?.set).toBeUndefined();
    }
  });

  it("returns semantically equal, deeply detached snapshots", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);
    const firstSnapshot = engine.snapshotCompiledIR(compiled);
    const secondSnapshot = engine.snapshotCompiledIR(compiled);

    expect(firstSnapshot).toEqual(secondSnapshot);
    expect(firstSnapshot).not.toBe(secondSnapshot);
    const firstReferences = collectObjectReferences(firstSnapshot);
    for (const secondReference of collectObjectReferences(secondSnapshot)) {
      expect(firstReferences.has(secondReference)).toBe(false);
    }
    const firstWarning = firstSnapshot.warnings[0];
    const secondWarning = secondSnapshot.warnings[0];
    expect(firstWarning).toBeInstanceOf(RecoverableError);
    expect(secondWarning).toBeInstanceOf(RecoverableError);
    expect(firstWarning).not.toBe(secondWarning);
    expect(firstWarning?.toJSON()).toEqual(secondWarning?.toJSON());

    firstSnapshot.width = 1;
    firstSnapshot.root.bbox.w = 1;
    firstSnapshot.drawOrder.push("snapshot-only");
    firstSnapshot.warnings.length = 0;

    const svgBefore = engine.renderCompiledToSvg(compiled);
    const thirdSnapshot = engine.snapshotCompiledIR(compiled);
    expect(thirdSnapshot).toEqual(secondSnapshot);
    expect(engine.renderCompiledToSvg(compiled)).toBe(svgBefore);
    expect(compiled.width).toBe(secondSnapshot.width);
  });

  it("rejects every unauthentic clone form with the stable error", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);
    const candidates: unknown[] = [
      { ...compiled },
      structuredClone(compiled),
      JSON.parse(JSON.stringify(compiled)),
      { width: compiled.width, height: compiled.height, textPathMode: compiled.textPathMode },
    ];

    for (const candidate of candidates) {
      expectFatal(
        () => renderUnknownCompiled(engine, candidate),
        "COMPILED_SCENE_INVALID",
        "Compiled scene is not an authentic artifact",
      );
    }
  });

  it("authenticates before every compiled-route option or resource check", () => {
    const ownerEngine = createTestEngine();
    const receivingEngine = createTestEngine();
    const compiled = ownerEngine.compile(scene);
    const routes: Array<{ name: string; run: () => unknown }> = [
      {
        name: "snapshot",
        run: () => receivingEngine.snapshotCompiledIR(compiled),
      },
      {
        name: "svg",
        run: () => receivingEngine.renderCompiledToSvg(compiled, { scale: 0 }),
      },
      {
        name: "animated SVG",
        run: () =>
          receivingEngine.renderCompiledToAnimatedSvg(compiled, {
            playback: { mode: "independent" },
            scale: 0,
          }),
      },
      {
        name: "text outlines",
        run: () => receivingEngine.renderCompiledToTextOutlines(compiled),
      },
      {
        name: "PNG",
        run: () => receivingEngine.renderCompiledToPng(compiled, { scale: 0 }),
      },
      {
        name: "frames",
        run: () =>
          receivingEngine.renderCompiledFrames(compiled, {
            format: "svg",
            timesMs: [-1],
          }),
      },
      {
        name: "animated WebP",
        run: () =>
          receivingEngine.renderCompiledToAnimatedWebp(compiled, {
            durationMs: -1,
            fps: 0,
            iterations: 1,
          }),
      },
      {
        name: "animated GIF",
        run: () =>
          receivingEngine.renderCompiledToAnimatedGif(compiled, {
            durationMs: -1,
            fps: 0,
            iterations: 1,
          }),
      },
    ];

    for (const route of routes) {
      expectFatal(
        route.run,
        "COMPILED_SCENE_WRONG_ENGINE",
        "Compiled scene belongs to a different Engine",
      );
    }
  });

  it("binds ownership to Engine identity regardless of font registry similarity", () => {
    const ownerEngine = createTestEngine();
    const compiled = ownerEngine.compile(scene);
    const receivingEngines = [
      createTestEngine(),
      new Engine({
        computeLayoutFn: () => "{}",
        fonts: [{ alias: "NotoSansJP", data: new Uint8Array([1, 2, 3]) }],
      }),
      new Engine({ computeLayoutFn: () => "{}" }),
    ];

    for (const receivingEngine of receivingEngines) {
      expectFatal(
        () => receivingEngine.renderCompiledToSvg(compiled),
        "COMPILED_SCENE_WRONG_ENGINE",
        "Compiled scene belongs to a different Engine",
      );
    }
  });

  it("reports disposed receiver state before authenticity and options", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);
    engine.dispose();

    expectFatal(
      () => engine.renderCompiledToSvg(compiled),
      "ENGINE_DISPOSED",
      "Engine has been disposed",
    );
    expectFatal(
      () => Reflect.apply(engine.renderCompiledToSvg, engine, [{ width: 1 }, { scale: 0 }]),
      "ENGINE_DISPOSED",
      "Engine has been disposed",
    );
  });

  it("emits byte-identical SVG from the same CompiledScene twice", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);

    const firstSvg = engine.renderCompiledToSvg(compiled);
    const secondSvg = engine.renderCompiledToSvg(compiled);

    expect(secondSvg).toBe(firstSvg);
  });

  it("matches the single-shot renderToSvg output", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);

    expect(engine.renderCompiledToSvg(compiled)).toBe(engine.renderToSvg(scene));
  });

  it("keeps SVG output stable after rendering PNG from the same CompiledScene", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);

    const svgBefore = engine.renderCompiledToSvg(compiled);
    engine.renderCompiledToPng(compiled);
    engine.renderCompiledToPng(compiled);
    const svgAfter = engine.renderCompiledToSvg(compiled);

    expect(svgAfter).toBe(svgBefore);
  });

  it("does not accumulate warnings in private state across renders", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);
    const warningCount = engine.snapshotCompiledIR(compiled).warnings.length;
    expect(warningCount).toBeGreaterThan(0);

    engine.renderCompiledToSvg(compiled);
    engine.renderCompiledToPng(compiled);
    engine.renderCompiledToSvg(compiled);

    expect(engine.snapshotCompiledIR(compiled).warnings.length).toBe(warningCount);
  });

  it("detaches callback warnings across every compiled render route", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);
    const baselineWarnings = engine
      .snapshotCompiledIR(compiled)
      .warnings.map((warning) => warning.toJSON());
    expect(baselineWarnings).toHaveLength(1);

    const deliveredWarnings: RecoverableError[] = [];
    const mutateWarning = (warning: RecoverableError): void => {
      expect(warning).toBeInstanceOf(RecoverableError);
      expect(warning.toJSON()).toEqual(baselineWarnings[0]);
      warning.message = "callback mutation";
      Object.setPrototypeOf(warning, null);
      deliveredWarnings.push(warning);
    };
    const routes: Array<{
      name: string;
      run: (onWarning: (warning: RecoverableError) => void) => unknown;
    }> = [
      {
        name: "SVG",
        run: (onWarning) => engine.renderCompiledToSvg(compiled, { onWarning }),
      },
      {
        name: "animated SVG",
        run: (onWarning) =>
          engine.renderCompiledToAnimatedSvg(compiled, {
            playback: { mode: "independent" },
            onWarning,
          }),
      },
      {
        name: "text outlines",
        run: (onWarning) => engine.renderCompiledToTextOutlines(compiled, { onWarning }),
      },
      {
        name: "PNG",
        run: (onWarning) => engine.renderCompiledToPng(compiled, { onWarning }),
      },
      {
        name: "frames",
        run: (onWarning) => [
          ...engine.renderCompiledFrames(compiled, {
            timesMs: [0],
            format: "svg",
            onWarning,
          }),
        ],
      },
      {
        name: "animated WebP",
        run: (onWarning) =>
          engine.renderCompiledToAnimatedWebp(compiled, {
            timesMs: [0],
            frameDurationsMs: [100],
            iterations: 1,
            onWarning,
          }),
      },
      {
        name: "animated GIF",
        run: (onWarning) =>
          engine.renderCompiledToAnimatedGif(compiled, {
            timesMs: [0],
            frameDurationsMs: [100],
            iterations: 1,
            onWarning,
          }),
      },
    ];

    for (const route of routes) {
      route.run(mutateWarning);
      expect(
        engine.snapshotCompiledIR(compiled).warnings.map((warning) => warning.toJSON()),
      ).toEqual(baselineWarnings);
    }

    expect(deliveredWarnings).toHaveLength(routes.length);
    expect(new Set(deliveredWarnings).size).toBe(routes.length);
  });
});
