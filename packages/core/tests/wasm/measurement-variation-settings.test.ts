import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadInterVariableFont } from "./test-prerequisites.js";

/**
 * The measurement APIs had no `fontVariationSettings` / `fontFeatureSettings`
 * input at all, so for a variable font they silently disagreed with the renderer.
 * `measureTextBlock` reported 679.64px for text the renderer laid out at 711.41px
 * at `"wght" 900` — a 31.77px gap a caller could not close, because the setting
 * the renderer accepts could not be expressed on the measurement surface.
 */

const TEXT = "The quick brown fox jumps over the lazy dog";
const FONT_SIZE_PX = 32;
const LIGHT = '"wght" 400';
const HEAVY = '"wght" 900';

describe("measurement APIs honor fontVariationSettings", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    const variableFont = loadInterVariableFont();
    engine = await createEngineAsync({
      fonts: [
        { alias: "VF", weight: 400, style: "normal", data: variableFont },
        {
          alias: "UnusedFallback",
          weight: 400,
          style: "normal",
          data: variableFont.slice(),
        },
      ],
    });
  });

  const base = {
    text: TEXT,
    fontFamily: "VF",
    fallback: ["UnusedFallback"],
    fontSizePx: FONT_SIZE_PX,
    language: "en",
  } as const;

  const surfaces: Array<{ name: string; measure: (settings: string) => unknown }> = [
    {
      name: "measureTextBlock",
      measure: (settings) =>
        engine.measureTextBlock({ ...base, maxWidth: 880, fontVariationSettings: settings }),
    },
    {
      name: "layoutTextFlow",
      measure: (settings) =>
        engine.layoutTextFlow({
          ...base,
          lineWidths: [300, 300, 300],
          fontVariationSettings: settings,
        }),
    },
    {
      name: "layoutTextFlowWithExclusions",
      measure: (settings) =>
        engine.layoutTextFlowWithExclusions({
          ...base,
          flowBox: { x: 0, y: 0, width: 400, height: 300 },
          exclusions: [],
          fontVariationSettings: settings,
        }),
    },
    {
      name: "measureIntrinsicInlineSize",
      measure: (settings) =>
        engine.measureIntrinsicInlineSize({ ...base, fontVariationSettings: settings }),
    },
    {
      name: "shrinkwrapText",
      measure: (settings) =>
        engine.shrinkwrapText({
          ...base,
          maxWidth: 300,
          maxHeight: 100,
          minFontSizePx: 8,
          maxFontSizePx: 40,
          fontVariationSettings: settings,
        }),
    },
    {
      name: "shrinkwrapFlow",
      measure: (settings) =>
        engine.shrinkwrapFlow({
          ...base,
          flowBox: { x: 0, y: 0, width: 300, height: 100 },
          exclusions: [],
          minFontSizePx: 8,
          maxFontSizePx: 40,
          fontVariationSettings: settings,
        }),
    },
  ];

  for (const surface of surfaces) {
    it(`${surface.name}: a heavier weight changes the measurement`, () => {
      const light = JSON.stringify(surface.measure(LIGHT));
      const heavy = JSON.stringify(surface.measure(HEAVY));

      expect(heavy, `${surface.name} ignored fontVariationSettings`).not.toBe(light);
    });
  }

  it("measureTextBlock agrees with what the renderer lays out", () => {
    for (const settings of [LIGHT, HEAVY]) {
      const measured = engine.measureTextBlock({
        ...base,
        maxWidth: 880,
        fontVariationSettings: settings,
      }).usedWidth;

      const { ir } = engine.renderToSvgAndIR(
        createElement(
          "Canvas",
          { width: 900, height: 200, background: "#ffffff" },
          createElement(
            "Text",
            {
              font: "VF",
              fontSizePx: FONT_SIZE_PX,
              width: 880,
              language: "en",
              fontVariationSettings: settings,
            } as Record<string, unknown>,
            TEXT,
          ),
        ),
      );

      type IrNode = Record<string, unknown> & { type?: string; children?: IrNode[] };
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
      const rendered = (textNodes[0]?.lines as Array<{ width: number }>)[0]?.width ?? Number.NaN;

      expect(
        Math.abs(measured - rendered),
        `${settings}: measured ${measured} but rendered ${rendered}`,
      ).toBeLessThan(0.5);
    }
  });

  it("rich-text flow APIs inherit variation settings in unstyled text nodes", () => {
    const richText = [{ kind: "text" as const, text: TEXT }];
    const surfaces: Array<{ name: string; measure: (settings: string) => unknown }> = [
      {
        name: "layoutTextFlowWithExclusions",
        measure: (settings) =>
          engine.layoutTextFlowWithExclusions({
            ...base,
            text: "",
            richText,
            flowBox: { x: 0, y: 0, width: 300, height: 200 },
            exclusions: [],
            fontVariationSettings: settings,
          }),
      },
      {
        name: "shrinkwrapText",
        measure: (settings) =>
          engine.shrinkwrapText({
            ...base,
            text: "",
            richText,
            maxWidth: 300,
            maxHeight: 100,
            minFontSizePx: 8,
            maxFontSizePx: 40,
            fontVariationSettings: settings,
          }),
      },
      {
        name: "shrinkwrapFlow",
        measure: (settings) =>
          engine.shrinkwrapFlow({
            ...base,
            text: "",
            richText,
            flowBox: { x: 0, y: 0, width: 300, height: 100 },
            exclusions: [],
            minFontSizePx: 8,
            maxFontSizePx: 40,
            fontVariationSettings: settings,
          }),
      },
    ];

    for (const surface of surfaces) {
      const light = JSON.stringify(surface.measure(LIGHT));
      const heavy = JSON.stringify(surface.measure(HEAVY));
      expect(heavy, `${surface.name} dropped inherited fontVariationSettings`).not.toBe(light);
    }
  });

  it("plain and rich-text measurement paths honor fontFeatureSettings", () => {
    const featureText = "111111 office affinity";
    const proportional = '"pnum" 1';
    const tabular = '"tnum" 1';

    const plainWidth = (settings: string) =>
      engine.measureTextBlock({
        ...base,
        text: featureText,
        maxWidth: 880,
        fontFeatureSettings: settings,
      }).usedWidth;
    expect(plainWidth(tabular)).not.toBe(plainWidth(proportional));

    const richWidth = (settings: string) => {
      const result = engine.layoutTextFlowWithExclusions({
        ...base,
        text: "",
        richText: [{ kind: "text", text: featureText }],
        flowBox: { x: 0, y: 0, width: 500, height: 200 },
        exclusions: [],
        fontFeatureSettings: settings,
      });
      return result.lines[0]?.fragments.reduce(
        (sum, fragment) => sum + fragment.inlineAdvancePx,
        0,
      );
    };
    expect(richWidth(tabular)).not.toBe(richWidth(proportional));
  });
});
