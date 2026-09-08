import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { TextProps } from "../../src/vnode/types.js";
import { loadSubsetFont } from "./test-prerequisites.js";
import { textLayoutRawSuccessFixtures } from "./text-layout-success-fixtures.js";
import { textOwnerResultFixtures } from "./text-owner-result-fixtures.js";

describe("text owner results at the public engine boundary", () => {
  let engine: Engine;
  beforeAll(async () => {
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });
  afterAll(() => engine.dispose());

  it("preserves exact missing-glyph warnings in pre-wrap layout and rendering", () => {
    const scene = createElement(
      "Canvas",
      { width: 200, height: 80 },
      createElement(
        "Text",
        { id: "missing", font: "NotoSansJP", fontSizePx: 20, whiteSpace: "pre-wrap" },
        "Hello 🎉",
      ),
    );
    const expected = [
      {
        severity: "recoverable",
        code: "MISSING_GLYPH",
        message: 'Font "NotoSansJP" is missing glyphs for: U+1F389 (🎉)',
        stage: "text",
        nodeId: "missing",
        fallback: "blank",
      },
    ];
    const layout = engine.renderToLayoutTree(scene);
    expect(layout.root.children[0]?.textLayout?.resolvedTextLayout.warnings).toEqual(expected);
    const rendered = engine.renderToSvgAndIR(scene);
    expect(rendered.ir.warnings.map((warning) => warning.toJSON())).toEqual(expected);
    expect(rendered.svg).toBe(engine.renderToSvg(scene));
  });

  it("keeps same-content siblings equal to isolated layout in either order", () => {
    const styles: Partial<TextProps>[] = [
      {},
      { lineHeight: 2 },
      { fit: "shrink", minFontSizePx: 10 },
      { maxLines: 1, ellipsis: true },
      { hangingPunctuation: true },
      { preferredFrame: { w: 80, h: 60 } },
    ];
    const textNode = (index: number) =>
      createElement(
        "Text",
        {
          id: `sibling-${index}`,
          font: "NotoSansJP",
          fontSizePx: 20,
          width: 80,
          flexShrink: 0,
          ...styles[index],
        },
        "Hello あいうえお Hello",
      );
    const layout = (indices: number[]) =>
      engine.renderToLayoutTree(
        createElement("Canvas", { width: 120, height: 2000 }, ...indices.map(textNode)),
      ).root.children;
    const indices = styles.map((_, index) => index);
    const isolated = indices.map((index) => layout([index])[0]?.textLayout);
    for (const order of [indices, [...indices].reverse()]) {
      for (const [position, node] of layout(order).entries()) {
        expect(node.textLayout, node.nodeId).toEqual(isolated[order[position]!]);
      }
    }
  });

  it("seals authored input and expected output bytes for owner fixtures", () => {
    expect(textOwnerResultFixtures).toHaveLength(16);
    for (const fixture of textOwnerResultFixtures) {
      expect(createHash("sha256").update(fixture.inputJson).digest("hex"), fixture.operation).toBe(
        fixture.inputSha256,
      );
      expect(
        createHash("sha256").update(fixture.expectedOutputJson).digest("hex"),
        fixture.operation,
      ).toBe(fixture.outputSha256);
    }
  });

  for (const fixture of [...textLayoutRawSuccessFixtures, ...textOwnerResultFixtures]) {
    it(`${fixture.operation}: ${fixture.inputJson}`, () => {
      const invoke = engine[fixture.operation] as (input: unknown) => unknown;
      expect(invoke.call(engine, JSON.parse(fixture.inputJson))).toEqual(
        JSON.parse(fixture.expectedOutputJson),
      );
    });
  }
});
