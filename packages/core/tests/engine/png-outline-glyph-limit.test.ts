import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine.js";
import { FatalError, type RecoverableError } from "../../src/errors.js";
import type { IR, IRNode, IRTextNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { collectAnimatedRaster, createMockRasterSession } from "../helpers/animation-collector.js";
import {
  createEngineFromHandle,
  createFontedWasmHandle,
  engineOptionsFromHandle,
} from "../helpers/wasm-render-engine.js";

/** Existing raster outline limit exercised at its exact glyph boundary. */
const MAX_OUTLINE_GLYPHS = 16_384;

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function createTextScene(text: string, canvas = { width: 32, height: 32 }) {
  return createElement(
    "Canvas",
    canvas,
    createElement(
      "Text",
      {
        id: "subject",
        layer: "text",
        // Monospace Latin face registered on the fixture handle: each "A"
        // shapes to exactly one glyph, so glyph counts are exact.
        font: "JetBrainsMono",
        fontSizePx: 16,
        wrap: "none",
      },
      text,
    ),
  );
}

function createScene(glyphCount: number) {
  return createTextScene("A".repeat(glyphCount));
}

function findTextNode(node: IRNode): IRTextNode {
  if (node.type === "text") {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.children) {
      if (child.type === "text" || child.type === "group") {
        try {
          return findTextNode(child);
        } catch {
          // Continue through sibling groups until the fixture text is found.
        }
      }
    }
  }
  throw new Error("Expected compiled fixture IR to contain a text node");
}

function replacePositionedGlyphs(ir: IR, glyphCount: number): void {
  const textNode = findTextNode(ir.root);
  const line = textNode.lines[0];
  const glyph = line?.positionedGlyphs?.[0];
  if (!line || !glyph) {
    throw new Error("Expected compiled fixture IR to contain one positioned glyph");
  }
  line.positionedGlyphs = Array.from({ length: glyphCount }, () => ({ ...glyph }));
}

function replacePositionedGlyphFontAlias(ir: IR, fontAlias: string): void {
  const textNode = findTextNode(ir.root);
  for (const line of textNode.lines) {
    for (const glyph of line.positionedGlyphs ?? []) {
      glyph.fontAlias = fontAlias;
    }
  }
}

function positionedGlyphCount(irJson: string): number {
  const ir = JSON.parse(irJson) as IR;
  return findTextNode(ir.root).lines.reduce(
    (count, line) => count + (line.positionedGlyphs?.length ?? 0),
    0,
  );
}

function createHarness() {
  // Exercise the real Rust preflight inside the retained transport while
  // skipping 16k-path materialization in exact-boundary unit cases.
  const rasterResolveAndEmitFn = vi.fn(() => "<svg/>");
  const preflightRasterSceneFn = vi.fn((irJson: string) => {
    const exceeded = JSON.parse(handle.preflightIr(irJson)) as {
      actualGlyphs: number;
      maxGlyphs: number;
      nodeId: string;
    } | null;
    if (exceeded) {
      throw JSON.stringify({
        severity: "fatal",
        code: "PNG_OUTLINE_GLYPH_LIMIT",
        message: `PNG rendering exceeds the outline glyph limit of ${exceeded.maxGlyphs}.`,
        stage: "emit",
        nodeId: exceeded.nodeId,
        context: {
          maxGlyphs: exceeded.maxGlyphs,
          actualGlyphs: exceeded.actualGlyphs,
        },
      });
    }
    const rasterScene = handle.preflightRasterScene(irJson, "{}");
    return Object.assign(rasterScene, {
      resolveAndEmitToSvg: rasterResolveAndEmitFn,
      resolveToIr: () => JSON.stringify({ ir: JSON.parse(irJson), warnings: [] }),
      resolve: () => undefined,
      renderToSvg: () => "<svg/>",
    });
  });
  const resolveAndEmitSvgFromIrFn = vi.fn((irJson: string, optionsJson: string) =>
    handle.resolveAndEmitSvgFromIr(irJson, optionsJson),
  );
  const resolveIrFn = vi.fn((irJson: string, optionsJson: string) =>
    handle.resolveIr(irJson, optionsJson),
  );
  const preflightIrFn = vi.fn((irJson: string) => handle.preflightIr(irJson));
  const svgToPngFn = vi.fn(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  const svgToWebpFn = vi.fn(() => new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  const openAnimatedRasterSessionFn = vi.fn(createMockRasterSession);
  const engine = createEngineFromHandle(handle, {
    resolveAndEmitSvgFromIrFn,
    preflightRasterSceneFn,
    resolveIrFn,
    preflightIrFn,
    svgToPngFn,
    svgToWebpFn,
    openAnimatedRasterSessionFn,
  });
  return {
    engine,
    preflightIrFn,
    preflightRasterSceneFn,
    rasterResolveAndEmitFn,
    resolveAndEmitSvgFromIrFn,
    resolveIrFn,
    svgToPngFn,
    svgToWebpFn,
    openAnimatedRasterSessionFn,
  };
}

async function expectOutlineGlyphLimitError(run: () => unknown): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FatalError);
  const error = thrown as FatalError;
  expect(error.code).toBe("PNG_OUTLINE_GLYPH_LIMIT");
  expect(error.stage).toBe("emit");
  expect(error.nodeId).toBe("subject");
  expect(error.context).toEqual({
    maxGlyphs: MAX_OUTLINE_GLYPHS,
    actualGlyphs: MAX_OUTLINE_GLYPHS + 1,
  });
}

async function captureFatalError(run: () => unknown): Promise<FatalError> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FatalError);
  return thrown as FatalError;
}

function createCapturingRasterTransport(emittedGlyphCounts: number[]) {
  return vi.fn((irJson: string, optionsJson: string) => {
    const scene = handle.preflightRasterScene(irJson, optionsJson);
    return {
      resolveAndEmitToSvg: () => {
        emittedGlyphCounts.push(positionedGlyphCount(irJson));
        return scene.resolveAndEmitToSvg();
      },
      resolveToIr: () => scene.resolveToIr(),
      resolve: () => scene.resolve(),
      renderToSvg: (renderOptionsJson: string) => scene.renderToSvg(renderOptionsJson),
      dispose: () => scene.dispose(),
    };
  });
}

describe("PNG outline glyph limit", () => {
  it.each([false, true])("accepts exactly 16,384 glyphs (skipValidation=%s)", (skipValidation) => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();

    const png = engine.renderToPng(createScene(MAX_OUTLINE_GLYPHS), { skipValidation });

    expect(png).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).toHaveBeenCalledTimes(1);
    expect(svgToPngFn).toHaveBeenCalledTimes(1);
  });

  it("does not count invisible glyphId=0 entries as outline requests", () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const scene = createTextScene(`${"A".repeat(MAX_OUTLINE_GLYPHS)}${"\n".repeat(32)}`);

    expect(engine.renderToPng(scene)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).toHaveBeenCalledTimes(1);
    expect(svgToPngFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    false,
    true,
  ])("rejects the 16,385th direct PNG glyph before extraction or rasterization (skipValidation=%s)", async (skipValidation) => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();

    await expectOutlineGlyphLimitError(() =>
      engine.renderToPng(createScene(MAX_OUTLINE_GLYPHS + 1), { skipValidation }),
    );

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).not.toHaveBeenCalled();
    expect(svgToPngFn).not.toHaveBeenCalled();
  });

  it("rejects batch PNG before delivering recoverable warnings", async () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const warningCodes: string[] = [];
    const scene = createTextScene(`${"A".repeat(MAX_OUTLINE_GLYPHS + 1)}日本語`);

    await expectOutlineGlyphLimitError(() =>
      engine.renderFrames(scene, {
        timesMs: [0],
        format: "png",
        onWarning: (warning) => warningCodes.push(warning.code),
      }),
    );

    expect(warningCodes).toEqual([]);
    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).not.toHaveBeenCalled();
    expect(svgToPngFn).not.toHaveBeenCalled();
  });

  it("keeps glyph preflight ahead of the strict pixel limit for every raster path", async () => {
    const { engine } = createHarness();
    const scene = createTextScene("A".repeat(MAX_OUTLINE_GLYPHS + 1), {
      width: 5_000,
      height: 1_000,
    });
    const compiled = engine.compile(scene);
    const rasterOptions = {
      scale: 2,
      rasterOversizeBehavior: "error" as const,
    };
    const routes: Array<{ label: string; render: () => unknown }> = [
      { label: "still PNG", render: () => engine.renderToPng(scene, rasterOptions) },
      { label: "still WebP", render: () => engine.renderToWebp(scene, rasterOptions) },
      {
        label: "compiled PNG",
        render: () => engine.renderCompiledToPng(compiled, rasterOptions),
      },
      {
        label: "frame PNG",
        render: () => [
          ...engine.renderFrames(scene, {
            timesMs: [0],
            format: "png",
            ...rasterOptions,
          }),
        ],
      },
      {
        label: "layered PNG",
        render: () => engine.renderToLayeredPng(scene, rasterOptions),
      },
      {
        label: "animated GIF",
        render: async () =>
          await collectAnimatedRaster((sink) =>
            engine.renderToAnimatedGif(
              scene,
              {
                iterations: "infinite",
                timesMs: [0],
                frameDurationsMs: [20],
                ...rasterOptions,
              },
              sink,
            ),
          ),
      },
      {
        label: "animated WebP",
        render: async () =>
          await collectAnimatedRaster((sink) =>
            engine.renderToAnimatedWebp(
              scene,
              {
                iterations: "infinite",
                timesMs: [0],
                frameDurationsMs: [20],
                ...rasterOptions,
              },
              sink,
            ),
          ),
      },
    ];

    for (const route of routes) {
      expect((await captureFatalError(route.render)).code, route.label).toBe(
        "PNG_OUTLINE_GLYPH_LIMIT",
      );
    }
  }, 30_000);

  it("delivers the same missing-glyph warning before strict pixel rejection on every path", async () => {
    const { engine } = createHarness();
    const scene = createTextScene("A日本語", { width: 5_000, height: 1_000 });
    const compiled = engine.compile(scene);

    for (const route of [
      "still PNG",
      "still WebP",
      "compiled PNG",
      "frame PNG",
      "layered PNG",
      "animated GIF",
      "animated WebP",
    ] as const) {
      const warningCodes: string[] = [];
      const commonOptions = {
        scale: 2,
        rasterOversizeBehavior: "error" as const,
        onWarning: (warning: RecoverableError) => warningCodes.push(warning.code),
      };
      const render = async (): Promise<unknown> => {
        switch (route) {
          case "still PNG":
            return engine.renderToPng(scene, commonOptions);
          case "still WebP":
            return engine.renderToWebp(scene, commonOptions);
          case "compiled PNG":
            return engine.renderCompiledToPng(compiled, commonOptions);
          case "frame PNG":
            return [
              ...engine.renderFrames(scene, {
                timesMs: [0],
                format: "png",
                ...commonOptions,
              }),
            ];
          case "layered PNG":
            return engine.renderToLayeredPng(scene, commonOptions);
          case "animated GIF":
            return await collectAnimatedRaster((sink) =>
              engine.renderToAnimatedGif(
                scene,
                {
                  iterations: "infinite",
                  timesMs: [0],
                  frameDurationsMs: [20],
                  ...commonOptions,
                },
                sink,
              ),
            );
          case "animated WebP":
            return await collectAnimatedRaster((sink) =>
              engine.renderToAnimatedWebp(
                scene,
                {
                  iterations: "infinite",
                  timesMs: [0],
                  frameDurationsMs: [20],
                  ...commonOptions,
                },
                sink,
              ),
            );
        }
      };

      expect((await captureFatalError(render)).code, route).toBe("PNG_PIXEL_LIMIT");
      expect(warningCodes, route).toContain("MISSING_GLYPH");
    }
  });

  it("reports strict pixel overflow before resolving a missing compiled font alias", async () => {
    const resolveAndEmitToSvg = vi.fn(() => "<svg/>");
    const preflightRasterSceneFn = vi.fn((irJson: string, optionsJson: string) => {
      const ir = JSON.parse(irJson) as IR;
      replacePositionedGlyphFontAlias(ir, "review-missing-font-alias");
      const sceneHandle = handle.preflightRasterScene(JSON.stringify(ir), optionsJson);
      const emit = sceneHandle.resolveAndEmitToSvg.bind(sceneHandle);
      const resolveToIr = sceneHandle.resolveToIr.bind(sceneHandle);
      const resolve = sceneHandle.resolve.bind(sceneHandle);
      const renderToSvg = sceneHandle.renderToSvg.bind(sceneHandle);
      return Object.assign(sceneHandle, {
        resolveAndEmitToSvg: () => {
          resolveAndEmitToSvg();
          return emit();
        },
        resolveToIr,
        resolve,
        renderToSvg,
      });
    });
    const strictEngine = createEngineFromHandle(handle, {
      preflightRasterSceneFn,
      svgToPngFn: () => new Uint8Array(),
    });
    const compiled = strictEngine.compile(createTextScene("A", { width: 5_000, height: 1_000 }));

    expect(
      (
        await captureFatalError(() =>
          strictEngine.renderCompiledToPng(compiled, {
            scale: 2,
            rasterOversizeBehavior: "error",
          }),
        )
      ).code,
    ).toBe("PNG_PIXEL_LIMIT");
    expect(resolveAndEmitToSvg).not.toHaveBeenCalled();
    strictEngine.dispose();
  });

  it("rejects compiled PNG before extraction or rasterization", async () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const compiled = engine.compile(createScene(MAX_OUTLINE_GLYPHS + 1));

    await expectOutlineGlyphLimitError(() => engine.renderCompiledToPng(compiled));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).not.toHaveBeenCalled();
    expect(svgToPngFn).not.toHaveBeenCalled();
  });

  it("ignores a detached snapshot mutated from below to above the glyph limit", () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const compiled = engine.compile(createScene(1));

    expect(engine.renderCompiledToPng(compiled)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    replacePositionedGlyphs(engine.snapshotCompiledIR(compiled), MAX_OUTLINE_GLYPHS + 1);

    expect(engine.renderCompiledToPng(compiled)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(2);
    expect(rasterResolveAndEmitFn).toHaveBeenCalledTimes(2);
    expect(svgToPngFn).toHaveBeenCalledTimes(2);
  });

  it("ignores a detached snapshot mutated from above to below the glyph limit", async () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const compiled = engine.compile(createScene(MAX_OUTLINE_GLYPHS + 1));

    await expectOutlineGlyphLimitError(() => engine.renderCompiledToPng(compiled));
    replacePositionedGlyphs(engine.snapshotCompiledIR(compiled), 1);

    await expectOutlineGlyphLimitError(() => engine.renderCompiledToPng(compiled));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(2);
    expect(rasterResolveAndEmitFn).not.toHaveBeenCalled();
    expect(svgToPngFn).not.toHaveBeenCalled();
  });

  it("keeps detached snapshot mutation out of onPngResolutionAdjusted", () => {
    const emittedGlyphCounts: number[] = [];
    const preflightRasterSceneFn = createCapturingRasterTransport(emittedGlyphCounts);
    const svgToPngFn = vi.fn(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const snapshotEngine = createEngineFromHandle(handle, {
      preflightRasterSceneFn,
      svgToPngFn,
    });
    const compiled = snapshotEngine.compile(createScene(1));
    const detachedSnapshot = snapshotEngine.snapshotCompiledIR(compiled);

    expect(
      snapshotEngine.renderCompiledToPng(compiled, {
        scale: 200,
        onPngResolutionAdjusted: () =>
          replacePositionedGlyphs(detachedSnapshot, MAX_OUTLINE_GLYPHS + 1),
      }),
    ).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(emittedGlyphCounts).toEqual([1]);
  });

  it("keeps detached snapshot mutation out of onWarning", () => {
    const emittedGlyphCounts: number[] = [];
    const preflightRasterSceneFn = createCapturingRasterTransport(emittedGlyphCounts);
    const svgToPngFn = vi.fn(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const snapshotEngine = createEngineFromHandle(handle, {
      preflightRasterSceneFn,
      svgToPngFn,
    });
    const compiled = snapshotEngine.compile(createTextScene("A日本語"));
    const detachedSnapshot = snapshotEngine.snapshotCompiledIR(compiled);
    const snapshotGlyphCount = findTextNode(detachedSnapshot.root).lines.reduce(
      (count, line) => count + (line.positionedGlyphs?.length ?? 0),
      0,
    );
    expect(detachedSnapshot.warnings.length).toBeGreaterThan(0);

    expect(
      snapshotEngine.renderCompiledToPng(compiled, {
        onWarning: () => replacePositionedGlyphs(detachedSnapshot, MAX_OUTLINE_GLYPHS + 1),
      }),
    ).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(emittedGlyphCounts).toEqual([snapshotGlyphCount]);
  });

  it.each([
    "onWarning",
    "onPngResolutionAdjusted",
  ] as const)("keeps the compiled PNG encoder captured before %s mutation", (callbackName) => {
    const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const replacementPng = new Uint8Array([9]);
    const originalEncoder = vi.fn(() => originalPng);
    const replacementEncoder = vi.fn(() => replacementPng);
    const engineOptions = engineOptionsFromHandle(handle, { svgToPngFn: originalEncoder });
    const snapshotEngine = new Engine(engineOptions);
    const compiled = snapshotEngine.compile(
      createTextScene("A日本語", { width: 5_000, height: 1_000 }),
    );
    const mutateEncoder = (): void => {
      engineOptions.svgToPngFn = replacementEncoder;
    };
    const renderOptions = {
      scale: 2,
      ...(callbackName === "onWarning"
        ? { onWarning: mutateEncoder }
        : { onPngResolutionAdjusted: mutateEncoder }),
    };

    expect(snapshotEngine.renderCompiledToPng(compiled, renderOptions)).toEqual(originalPng);
    expect(originalEncoder).toHaveBeenCalledOnce();
    expect(replacementEncoder).not.toHaveBeenCalled();
  });

  it("rejects layered PNG before extraction or rasterization", async () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, resolveIrFn, svgToPngFn } =
      createHarness();

    await expectOutlineGlyphLimitError(() =>
      engine.renderToLayeredPng(createScene(MAX_OUTLINE_GLYPHS + 1)),
    );

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).not.toHaveBeenCalled();
    expect(resolveIrFn).not.toHaveBeenCalled();
    expect(svgToPngFn).not.toHaveBeenCalled();
  });

  // Renders a scene past MAX_OUTLINE_GLYPHS through four consumers; under
  // coverage instrumentation on a 2-core CI runner this exceeds the default
  // 5s test timeout.
  it(
    "does not apply the PNG limit to SVG, layered SVG, or text-outline consumers",
    { timeout: 30_000 },
    () => {
      const { engine, resolveAndEmitSvgFromIrFn, resolveIrFn, svgToPngFn } = createHarness();
      const scene = createScene(MAX_OUTLINE_GLYPHS + 1);

      // renderToSvgAndIR resolves outlines on the returned IR (renderToSvg is a
      // string-only fast path that skips that redundant pass).
      expect(engine.renderToSvgAndIR(scene).svg).toContain("<svg");
      expect(engine.renderToLayeredSvg(scene).layers).toHaveLength(1);
      expect(engine.renderToTextOutlines(scene)).toHaveLength(1);

      expect(resolveIrFn).toHaveBeenCalledTimes(2);
      expect(resolveAndEmitSvgFromIrFn).not.toHaveBeenCalled();
      expect(svgToPngFn).not.toHaveBeenCalled();
    },
  );
});
