import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadInterVariableFont } from "./test-prerequisites.js";

/**
 * Every ellipsis path shaped the "…" and its truncation candidates with
 * default shaping options, so `fontVariationSettings` never reached the
 * measurement. The body rendered at the requested weight while the truncation
 * was measured at the default weight: the single-line and shrink paths emitted
 * byte-identical lines for `"wght" 400` and `"wght" 900`, and the multi-line
 * path under-measured its last line by ~24px, overflowing the box.
 *
 * The existing `variable-font.test.ts` only covered the CSS parser, so nothing
 * checked that the parsed settings changed any rendered output.
 */

type TextProps = Record<string, unknown>;

const TEXT = "The quick brown fox jumps over the lazy dog and keeps running far away";
const FONT_SIZE_PX = 32;

const ELLIPSIS_PATHS: Array<{ name: string; props: TextProps }> = [
  { name: "single-line", props: { width: 300, maxLines: 1, ellipsis: true } },
  { name: "multi-line", props: { width: 300, maxLines: 2, ellipsis: true } },
  {
    name: "shrink fit",
    props: {
      width: 300,
      height: 60,
      fit: "shrink",
      maxLines: 1,
      ellipsis: true,
      minFontSizePx: 10,
    },
  },
];

type IrNode = Record<string, unknown> & { type?: string; children?: IrNode[] };
type IrLine = {
  text: string;
  width: number;
  positionedGlyphs?: Array<{ xAdvance: number; syntheticKind?: string }>;
};

describe("ellipsis honors fontVariationSettings", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "VF", weight: 400, style: "normal", data: loadInterVariableFont() }],
    });
  });

  function linesOf(props: TextProps, variationSettings: string, text: string = TEXT): IrLine[] {
    const { ir } = engine.renderToSvgAndIR(
      createElement(
        "Canvas",
        { width: 900, height: 400, background: "#ffffff" },
        createElement(
          "Text",
          {
            font: "VF",
            fontSizePx: FONT_SIZE_PX,
            fontVariationSettings: variationSettings,
            ...props,
          } as TextProps,
          text,
        ),
      ),
    );

    const textNodes: IrNode[] = [];
    const walk = (node: IrNode) => {
      if (node.type === "text") {
        textNodes.push(node);
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
    };
    walk(ir.root as unknown as IrNode);

    return (textNodes[0]?.lines ?? []) as IrLine[];
  }

  for (const path of ELLIPSIS_PATHS) {
    it(`${path.name}: truncation reacts to the requested weight`, () => {
      const light = linesOf(path.props, '"wght" 400');
      const heavy = linesOf(path.props, '"wght" 900');

      expect(
        JSON.stringify(heavy),
        `${path.name}: fontVariationSettings had no effect on the ellipsized line`,
      ).not.toBe(JSON.stringify(light));
    });
  }

  it("the ellipsized line's reported width matches its materialized glyph plan", () => {
    // The synthetic marker is intentionally shaped as an isolated run. The
    // authoritative width is therefore the positioned plan that is emitted,
    // not a fresh whole-string shape of `prefix + ellipsis`.
    for (const path of ELLIPSIS_PATHS) {
      const lines = linesOf(path.props, '"wght" 900');
      const last = lines.at(-1);
      expect(last, `${path.name}: expected at least one line`).toBeDefined();

      const truth = last?.positionedGlyphs?.reduce((width, glyph) => width + glyph.xAdvance, 0);
      expect(truth, `${path.name}: expected a materialized glyph plan`).toBeDefined();
      expect(last?.positionedGlyphs?.some((glyph) => glyph.syntheticKind === "ellipsis")).toBe(
        true,
      );
      expect(
        Math.abs((last?.width ?? 0) - (truth ?? Number.NaN)),
        `${path.name}: reported ${last?.width} but materialized ${truth}`,
      ).toBeLessThan(0.5);
    }
  });
});
