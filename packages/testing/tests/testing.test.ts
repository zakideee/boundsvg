import {
  Box,
  Canvas,
  type Engine,
  type EngineInput,
  type IR,
  type RenderOptions,
} from "@boundsvg/core";
import { describe, expect, it, vi } from "vitest";
import {
  assertNoWarnings,
  assertStableNodeIds,
  normalizeSvg,
  renderMatrix,
  renderPngSnapshot,
  renderSvgSnapshot,
} from "../src/index.js";
import { boundsvgMatchers } from "../src/vitest.js";

function createIr(warningMessages: readonly string[] = []): IR {
  return {
    root: { type: "group", nodeId: "root", bbox: { x: 0, y: 0, w: 1, h: 1 } },
    drawOrder: [],
    width: 1,
    height: 1,
    warnings: warningMessages.map((message) => ({ message })),
  } as unknown as IR;
}

describe("@boundsvg/testing", () => {
  it("normalizes SVG attributes and decimals", () => {
    expect(normalizeSvg('<rect y="2" x="1.2345"></rect>')).toBe('<rect x="1.23" y="2"></rect>');
  });

  it("asserts warnings and node ids", () => {
    assertNoWarnings(createIr());
    assertStableNodeIds(Canvas({ width: 100, height: 100 }, Box({ id: "box" })));
  });

  it("renders and normalizes SVG snapshots through the supplied Engine route", () => {
    const input = Canvas({ width: 10, height: 20 });
    const options: RenderOptions = { debug: { showLayout: true } };
    const renderToSvg = vi.fn(() => '<svg width="10.1234" height="20" x="2"></svg>');
    const engine = { renderToSvg } as unknown as Engine;

    expect(renderSvgSnapshot(engine, input, options)).toBe(
      '<svg height="20" width="10.12" x="2"></svg>',
    );
    expect(renderToSvg).toHaveBeenCalledWith(input, options);
  });

  it("preserves PNG view bytes and reads dimensions from a non-zero byte offset", () => {
    const storage = new Uint8Array(32);
    const png = storage.subarray(4, 28);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const pngView = new DataView(png.buffer, png.byteOffset, png.byteLength);
    pngView.setUint32(16, 321, false);
    pngView.setUint32(20, 123, false);
    const input = Canvas({ width: 1, height: 1 });
    const options: RenderOptions = { scale: 2 };
    const renderToPng = vi.fn(() => png);
    const engine = { renderToPng } as unknown as Engine;

    const snapshot = renderPngSnapshot(engine, input, options);

    expect(snapshot.bytes).toBe(png);
    expect(snapshot).toMatchObject({ width: 321, height: 123 });
    expect(snapshot.bytes.byteOffset).toBe(4);
    expect(renderToPng).toHaveBeenCalledWith(input, options);
  });

  it("renders named matrices with per-case options and warning counts", () => {
    const firstInput = Canvas({ width: 10, height: 10 });
    const secondInput = Canvas({ width: 20, height: 20 });
    const secondOptions: RenderOptions = { scale: 3 };
    const renderToSvgAndIR = vi.fn(
      (input: EngineInput, options?: RenderOptions): { svg: string; ir: IR } => {
        if (input === firstInput) {
          return { svg: '<svg y="2" x="1.2345"></svg>', ir: createIr(["first warning"]) };
        }
        expect(options).toBe(secondOptions);
        return { svg: '<svg width="20"></svg>', ir: createIr() };
      },
    );
    const engine = { renderToSvgAndIR } as unknown as Engine;

    const results = renderMatrix(engine, [
      { name: "first", input: firstInput },
      { name: "second", input: secondInput, options: secondOptions },
    ]);

    expect(results).toEqual([
      {
        name: "first",
        svg: '<svg y="2" x="1.2345"></svg>',
        normalizedSvg: '<svg x="1.23" y="2"></svg>',
        warnings: 1,
      },
      {
        name: "second",
        svg: '<svg width="20"></svg>',
        normalizedSvg: '<svg width="20"></svg>',
        warnings: 0,
      },
    ]);
    expect(renderToSvgAndIR).toHaveBeenNthCalledWith(1, firstInput, undefined);
    expect(renderToSvgAndIR).toHaveBeenNthCalledWith(2, secondInput, secondOptions);
  });

  it("returns useful pass and fail results from the public Vitest matchers", () => {
    const warningPass = boundsvgMatchers.toHaveNoBoundsvgWarnings(createIr());
    const warningFail = boundsvgMatchers.toHaveNoBoundsvgWarnings(createIr(["missing glyph"]));
    const stablePass = boundsvgMatchers.toHaveStableBoundsvgNodeIds(
      Canvas({ width: 10, height: 10 }, Box({ id: "unique" })),
    );
    const stableFail = boundsvgMatchers.toHaveStableBoundsvgNodeIds(
      Canvas({ width: 10, height: 10 }, Box({ id: "duplicate" }), Box({ id: "duplicate" })),
    );

    expect(warningPass.pass).toBe(true);
    expect(warningPass.message()).toContain("expected IR to contain");
    expect(warningFail.pass).toBe(false);
    expect(warningFail.message()).toContain("missing glyph");
    expect(stablePass.pass).toBe(true);
    expect(stablePass.message()).toContain("expected input to contain duplicate");
    expect(stableFail.pass).toBe(false);
    expect(stableFail.message()).toContain("got duplicates: duplicate");
  });
});
