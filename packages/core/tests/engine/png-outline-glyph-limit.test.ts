import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type CompiledScene, Engine } from "../../src/engine.js";
import { FatalError, type RecoverableError } from "../../src/errors.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createEngineFromHandle,
  createFontedWasmHandle,
  engineOptionsFromHandle,
} from "../helpers/wasm-render-engine.js";

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

function replacePositionedGlyphs(compiled: CompiledScene, glyphCount: number): void {
  const textNode = findTextNode(compiled.ir.root);
  const line = textNode.lines[0];
  const glyph = line?.positionedGlyphs?.[0];
  if (!line || !glyph) {
    throw new Error("Expected compiled fixture IR to contain one positioned glyph");
  }
  line.positionedGlyphs = Array.from({ length: glyphCount }, () => ({ ...glyph }));
}

function replacePositionedGlyphFontAlias(compiled: CompiledScene, fontAlias: string): void {
  const textNode = findTextNode(compiled.ir.root);
  for (const line of textNode.lines) {
    for (const glyph of line.positionedGlyphs ?? []) {
      glyph.fontAlias = fontAlias;
    }
  }
}

function positionedGlyphCount(irJson: string): number {
  const ir = JSON.parse(irJson) as CompiledScene["ir"];
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
        code: "PNG_OUTLINE_GLYPH_LIMIT",
        message: `PNG rendering exceeds the outline glyph limit of ${exceeded.maxGlyphs}.`,
        stage: "emit",
        nodeId: exceeded.nodeId,
        context: { stage: "emit", ...exceeded },
      });
    }
    return {
      resolveAndEmitToSvg: rasterResolveAndEmitFn,
      resolveToIr: () => JSON.stringify({ ir: JSON.parse(irJson), warnings: [] }),
      resolve: () => undefined,
      renderToSvg: () => "<svg/>",
      dispose: () => undefined,
    };
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
  const svgsToAnimatedGifFn = vi.fn(() => new Uint8Array([0x47, 0x49, 0x46]));
  const svgsToAnimatedWebpFn = vi.fn(() => new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  const engine = createEngineFromHandle(handle, {
    resolveAndEmitSvgFromIrFn,
    preflightRasterSceneFn,
    resolveIrFn,
    preflightIrFn,
    svgToPngFn,
    svgToWebpFn,
    svgsToAnimatedGifFn,
    svgsToAnimatedWebpFn,
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
    svgsToAnimatedGifFn,
    svgsToAnimatedWebpFn,
  };
}

function expectOutlineGlyphLimitError(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FatalError);
  const error = thrown as FatalError;
  expect(error.code).toBe("PNG_OUTLINE_GLYPH_LIMIT");
  expect(error.stage).toBe("emit");
  expect(error.nodeId).toBe("subject");
  expect(error.context).toEqual({
    stage: "emit",
    nodeId: "subject",
    maxGlyphs: MAX_OUTLINE_GLYPHS,
    actualGlyphs: MAX_OUTLINE_GLYPHS + 1,
  });
}

function captureFatalError(run: () => unknown): FatalError {
  let thrown: unknown;
  try {
    run();
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
  ])("rejects the 16,385th direct PNG glyph before extraction or rasterization (skipValidation=%s)", (skipValidation) => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();

    expectOutlineGlyphLimitError(() =>
      engine.renderToPng(createScene(MAX_OUTLINE_GLYPHS + 1), { skipValidation }),
    );

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).not.toHaveBeenCalled();
    expect(svgToPngFn).not.toHaveBeenCalled();
  });

  it("rejects batch PNG before delivering recoverable warnings", () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const warningCodes: string[] = [];
    const scene = createTextScene(`${"A".repeat(MAX_OUTLINE_GLYPHS + 1)}日本語`);

    expectOutlineGlyphLimitError(() =>
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

  it("keeps glyph preflight ahead of the strict pixel limit for every raster path", () => {
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
        render: () =>
          engine.renderToAnimatedGif(scene, {
            timesMs: [0],
            frameDurationsMs: [20],
            ...rasterOptions,
          }),
      },
      {
        label: "animated WebP",
        render: () =>
          engine.renderToAnimatedWebp(scene, {
            timesMs: [0],
            frameDurationsMs: [20],
            ...rasterOptions,
          }),
      },
    ];

    for (const route of routes) {
      expect(captureFatalError(route.render).code, route.label).toBe("PNG_OUTLINE_GLYPH_LIMIT");
    }
  }, 30_000);

  it("delivers the same missing-glyph warning before strict pixel rejection on every path", () => {
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
      const render = (): unknown => {
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
            return engine.renderToAnimatedGif(scene, {
              timesMs: [0],
              frameDurationsMs: [20],
              ...commonOptions,
            });
          case "animated WebP":
            return engine.renderToAnimatedWebp(scene, {
              timesMs: [0],
              frameDurationsMs: [20],
              ...commonOptions,
            });
        }
      };

      expect(captureFatalError(render).code, route).toBe("PNG_PIXEL_LIMIT");
      expect(warningCodes, route).toContain("MISSING_GLYPH");
    }
  });

  it("reports strict pixel overflow before resolving a missing compiled font alias", () => {
    const resolveAndEmitToSvg = vi.fn(() => "<svg/>");
    const preflightRasterSceneFn = vi.fn((irJson: string, optionsJson: string) => {
      const sceneHandle = handle.preflightRasterScene(irJson, optionsJson);
      return {
        resolveAndEmitToSvg: () => {
          resolveAndEmitToSvg();
          return sceneHandle.resolveAndEmitToSvg();
        },
        resolveToIr: () => sceneHandle.resolveToIr(),
        resolve: () => sceneHandle.resolve(),
        renderToSvg: (renderOptionsJson: string) => sceneHandle.renderToSvg(renderOptionsJson),
        dispose: () => sceneHandle.dispose(),
      };
    });
    const strictEngine = createEngineFromHandle(handle, {
      preflightRasterSceneFn,
      svgToPngFn: () => new Uint8Array(),
    });
    const compiled = strictEngine.compile(createTextScene("A", { width: 5_000, height: 1_000 }));
    replacePositionedGlyphFontAlias(compiled, "review-missing-font-alias");

    expect(
      captureFatalError(() =>
        strictEngine.renderCompiledToPng(compiled, {
          scale: 2,
          rasterOversizeBehavior: "error",
        }),
      ).code,
    ).toBe("PNG_PIXEL_LIMIT");
    expect(resolveAndEmitToSvg).not.toHaveBeenCalled();
    strictEngine.dispose();
  });

  it("rejects compiled PNG before extraction or rasterization", () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const compiled = engine.compile(createScene(MAX_OUTLINE_GLYPHS + 1));

    expectOutlineGlyphLimitError(() => engine.renderCompiledToPng(compiled));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(rasterResolveAndEmitFn).not.toHaveBeenCalled();
    expect(svgToPngFn).not.toHaveBeenCalled();
  });

  it("rechecks a compiled IR mutated from below to above the glyph limit", () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const compiled = engine.compile(createScene(1));

    expect(engine.renderCompiledToPng(compiled)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    replacePositionedGlyphs(compiled, MAX_OUTLINE_GLYPHS + 1);

    expectOutlineGlyphLimitError(() => engine.renderCompiledToPng(compiled));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(2);
    expect(rasterResolveAndEmitFn).toHaveBeenCalledTimes(1);
    expect(svgToPngFn).toHaveBeenCalledTimes(1);
  });

  it("rechecks a compiled IR mutated from above to below the glyph limit", () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, svgToPngFn } = createHarness();
    const compiled = engine.compile(createScene(MAX_OUTLINE_GLYPHS + 1));

    expectOutlineGlyphLimitError(() => engine.renderCompiledToPng(compiled));
    replacePositionedGlyphs(compiled, 1);

    expect(engine.renderCompiledToPng(compiled)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(2);
    expect(rasterResolveAndEmitFn).toHaveBeenCalledTimes(1);
    expect(svgToPngFn).toHaveBeenCalledTimes(1);
  });

  it("emits the same snapshot preflighted before onPngResolutionAdjusted mutates compiled IR", () => {
    const emittedGlyphCounts: number[] = [];
    const preflightRasterSceneFn = createCapturingRasterTransport(emittedGlyphCounts);
    const svgToPngFn = vi.fn(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const snapshotEngine = createEngineFromHandle(handle, {
      preflightRasterSceneFn,
      svgToPngFn,
    });
    const compiled = snapshotEngine.compile(createScene(1));

    expect(
      snapshotEngine.renderCompiledToPng(compiled, {
        scale: 200,
        onPngResolutionAdjusted: () => replacePositionedGlyphs(compiled, MAX_OUTLINE_GLYPHS + 1),
      }),
    ).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    expect(preflightRasterSceneFn).toHaveBeenCalledTimes(1);
    expect(emittedGlyphCounts).toEqual([1]);
  });

  it("emits the same snapshot preflighted before onWarning mutates compiled IR", () => {
    const emittedGlyphCounts: number[] = [];
    const preflightRasterSceneFn = createCapturingRasterTransport(emittedGlyphCounts);
    const svgToPngFn = vi.fn(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const snapshotEngine = createEngineFromHandle(handle, {
      preflightRasterSceneFn,
      svgToPngFn,
    });
    const compiled = snapshotEngine.compile(createTextScene("A日本語"));
    const snapshotGlyphCount = findTextNode(compiled.ir.root).lines.reduce(
      (count, line) => count + (line.positionedGlyphs?.length ?? 0),
      0,
    );
    expect(compiled.ir.warnings.length).toBeGreaterThan(0);

    expect(
      snapshotEngine.renderCompiledToPng(compiled, {
        onWarning: () => replacePositionedGlyphs(compiled, MAX_OUTLINE_GLYPHS + 1),
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

  it("rejects layered PNG before extraction or rasterization", () => {
    const { engine, preflightRasterSceneFn, rasterResolveAndEmitFn, resolveIrFn, svgToPngFn } =
      createHarness();

    expectOutlineGlyphLimitError(() =>
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
