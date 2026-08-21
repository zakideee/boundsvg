import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { FatalError, type RecoverableError } from "../../src/errors.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { initNodeWasm } from "../../src/node.js";
import { parsePathBBox } from "../../src/path/utils.js";
import type { TextDecoration, TextDecorationPaintPath } from "../../src/text/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import {
  assertWasmPkgAvailable,
  loadInterVariableFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

function findText(node: IRNode, nodeId: string): IRTextNode {
  if (node.type === "text" && node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    try {
      return findText(child, nodeId);
    } catch {
      // Continue the deterministic tree walk.
    }
  }
  throw new TypeError(`Missing Text IR node ${nodeId}`);
}

function canvasWithText(
  children: VNode["children"],
  textProps: Record<string, unknown> = {},
): VNode {
  return createElement(
    "Canvas",
    { width: 440, height: 240, background: "#ffffff" },
    createElement(
      "Text",
      {
        id: "decorated",
        font: "NotoSansJP",
        fallback: ["Inter"],
        fontSizePx: 32,
        lineHeight: 1.25,
        color: "#102030",
        width: 400,
        ...textProps,
      },
      ...children,
    ),
  );
}

function expectFatalCode(render: () => unknown, code: string): void {
  try {
    render();
    throw new TypeError(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    expect((error as FatalError).code).toBe(code);
  }
}

function expectAtomicVerticalDecoration(text: IRTextNode, expectedInlineSize: number): void {
  const fragment = text.textDecorations?.[0];
  expect(fragment?.paths).toHaveLength(1);
  const bbox = paintPathBBox(fragment?.paths[0]);
  expect(bbox.maxY - bbox.minY).toBeCloseTo(expectedInlineSize, 5);
}

function paintPathBBox(path: TextDecorationPaintPath | undefined): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (!path) {
    throw new TypeError("Missing text decoration paint path");
  }
  const bbox = parsePathBBox(path.d);
  if (!bbox) {
    throw new TypeError("Invalid text decoration paint path");
  }
  return {
    minX: bbox.minX + path.originX,
    minY: bbox.minY + path.originY,
    maxX: bbox.maxX + path.originX,
    maxY: bbox.maxY + path.originY,
  };
}

describe("textDecoration validation", () => {
  const invalidValues: unknown[] = [
    { line: [] },
    { line: ["underline", "underline"] },
    { line: "wavy" },
    { line: "underline", style: "zigzag" },
    { line: "underline", thicknessPx: 0 },
    { line: "underline", thicknessPx: Number.POSITIVE_INFINITY },
    { line: "underline", offsetPx: Number.NaN },
    { line: "underline", skipInk: "auto" },
    { line: "underline", skipInk: true },
    { line: "underline", color: "not-a-color" },
    { line: "underline", unknown: true },
  ];

  it.each(invalidValues)("rejects invalid value %# with one stable error code", (value) => {
    const tree = canvasWithText(["invalid"], {
      textDecoration: value as TextDecoration,
    });
    expectFatalCode(() => validate(tree), "TEXT_DECORATION_INVALID");
  });

  it.each([
    "solid",
    "double",
    "dotted",
    "dashed",
    "wavy",
  ] as const)("accepts the %s decoration style", (style) => {
    expect(() =>
      validate(canvasWithText([style], { textDecoration: { line: "underline", style } })),
    ).not.toThrow();
  });

  it("accepts explicit skipInk values and rejects line-through-only all", () => {
    expect(() =>
      validate(
        canvasWithText(["skip"], {
          textDecoration: { line: "underline", skipInk: "all" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validate(
        canvasWithText(["continuous"], {
          textDecoration: { line: "line-through", skipInk: "none" },
        }),
      ),
    ).not.toThrow();
    expectFatalCode(
      () =>
        validate(
          canvasWithText(["unsupported"], {
            textDecoration: { line: "line-through", skipInk: "all" },
          }),
        ),
      "TEXT_DECORATION_SKIP_INK_UNSUPPORTED",
    );
  });

  it("rejects authored ranges beyond 4,096", () => {
    const ranges = Array.from({ length: 4_097 }, (_, index) =>
      createElement("Inline", { textDecoration: { line: "underline" } }, String(index % 10)),
    );
    expectFatalCode(() => validate(canvasWithText(ranges)), "TEXT_DECORATION_RANGE_LIMIT");
  });

  it("rejects decoration combined with animateUnits", () => {
    const tree = canvasWithText(["animated"], {
      textDecoration: { line: "underline", skipInk: "all" },
      animateUnits: {
        by: "cluster",
        animation: {
          keyframes: [
            { at: 0, opacity: 0 },
            { at: 1, opacity: 1 },
          ],
          durationMs: 100,
        },
      },
    });
    expectFatalCode(() => validate(tree), "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED");
  });
});

describe("textDecoration real WASM rendering", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        { alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() },
        { alias: "Inter", weight: 400, style: "normal", data: loadInterVariableFont() },
      ],
    });
  });

  it("enforces invalid, range, and animateUnits errors in Rust when TS validation is skipped", () => {
    const invalidDecorations: unknown[] = [
      { line: [] },
      { line: ["underline", "underline"] },
      { line: "wavy" },
      { line: "underline", style: "zigzag" },
      { line: "underline", skipInk: "auto" },
      { line: "underline", unknown: true },
    ];
    for (const textDecoration of invalidDecorations) {
      expectFatalCode(
        () =>
          engine.renderToSvg(
            canvasWithText(["invalid"], {
              textDecoration: textDecoration as TextDecoration,
            }),
            { skipValidation: true },
          ),
        "TEXT_DECORATION_INVALID",
      );
    }
    expect(() =>
      engine.renderToSvg(canvasWithText(["metadata"], { meta: { textDecoration: "metadata" } }), {
        skipValidation: true,
      }),
    ).not.toThrow();
    expect(() =>
      engine.renderToSvg(
        canvasWithText(["color"], {
          textDecoration: { line: "underline", color: "hsl(200,100%,50%)" },
        }),
        { skipValidation: true },
      ),
    ).not.toThrow();

    const ranges = Array.from({ length: 4_097 }, () =>
      createElement("Inline", { textDecoration: { line: "underline" } }, "x"),
    );
    expectFatalCode(
      () => engine.renderToSvg(canvasWithText(ranges), { skipValidation: true }),
      "TEXT_DECORATION_RANGE_LIMIT",
    );

    expectFatalCode(
      () =>
        engine.renderToSvg(
          canvasWithText(["animated"], {
            textDecoration: { line: "underline", skipInk: "all" },
            animateUnits: {
              by: "cluster",
              animation: {
                keyframes: [
                  { at: 0, opacity: 0 },
                  { at: 1, opacity: 1 },
                ],
                durationMs: 100,
              },
            },
          }),
          { skipValidation: true },
        ),
      "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED",
    );

    expectFatalCode(
      () =>
        engine.renderToSvg(
          canvasWithText(["unsupported"], {
            textDecoration: { line: "line-through", skipInk: "all" },
          }),
          { skipValidation: true },
        ),
      "TEXT_DECORATION_SKIP_INK_UNSUPPORTED",
    );
  });

  it("materializes every style as deterministic filled path geometry", () => {
    const geometries = new Map<string, string>();
    for (const style of ["solid", "double", "dotted", "dashed", "wavy"] as const) {
      const tree = canvasWithText(["Pattern geometry"], {
        textDecoration: { line: "underline", style, thicknessPx: 2 },
      });
      const text = findText(engine.renderToIR(tree).root, "decorated");
      const fragment = text.textDecorations?.[0];
      expect(fragment?.style).toBe(style);
      expect(fragment?.paths.length).toBeGreaterThan(0);
      expect(fragment?.paths.every((path) => path.d.endsWith("Z"))).toBe(true);
      expect(fragment?.paths.every((path) => path.contourCount > 0)).toBe(true);
      expect(fragment?.paths.every((path) => path.segmentCount >= 4)).toBe(true);
      const svg = engine.renderToSvg(tree);
      expect(svg).toContain('fill="#102030" stroke="none"');
      expect(svg).not.toContain("stroke-dasharray");
      geometries.set(style, JSON.stringify(fragment?.paths));
    }
    expect(new Set(geometries.values())).toHaveLength(5);

    const repeatedSolid = findText(
      engine.renderToIR(
        canvasWithText(["Pattern geometry"], {
          textDecoration: { line: "underline", style: "solid", thicknessPx: 2 },
        }),
      ).root,
      "decorated",
    );
    expect(JSON.stringify(repeatedSolid.textDecorations?.[0]?.paths)).toBe(geometries.get("solid"));
  });

  it.each([
    "solid",
    "double",
    "dotted",
    "dashed",
    "wavy",
  ] as const)("subtracts actual glyph fill ink from %s geometry", (style) => {
    const baseDecoration = {
      line: "underline" as const,
      style,
      thicknessPx: 2,
      offsetPx: -12,
    };
    const continuous = findText(
      engine.renderToIR(
        canvasWithText(["HHHH"], {
          textDecoration: baseDecoration,
        }),
      ).root,
      "decorated",
    );
    const skippedTree = canvasWithText(["HHHH"], {
      textDecoration: { ...baseDecoration, skipInk: "all" },
    });
    const skipped = findText(engine.renderToIR(skippedTree).root, "decorated");

    expect(skipped.lines).toEqual(continuous.lines);
    expect(skipped.textDecorations?.[0]?.skipInk).toBe("all");
    expect(skipped.textDecorations?.[0]?.paths.map((path) => path.d)).not.toEqual(
      continuous.textDecorations?.[0]?.paths.map((path) => path.d),
    );
    expect(findText(engine.renderToIR(skippedTree).root, "decorated").textDecorations).toEqual(
      skipped.textDecorations,
    );
  });

  it("keeps no-intersection geometry byte-identical and line-through continuous", () => {
    const render = (skipInk: "none" | "all"): IRTextNode =>
      findText(
        engine.renderToIR(
          canvasWithText(["HHHH"], {
            textDecoration: {
              line: ["underline", "line-through"],
              thicknessPx: 2,
              offsetPx: 20,
              skipInk,
            },
          }),
        ).root,
        "decorated",
      );
    const none = render("none");
    const all = render("all");
    const pathsByLine = (text: IRTextNode): Map<string, readonly TextDecorationPaintPath[]> =>
      new Map(text.textDecorations?.map((fragment) => [fragment.line, fragment.paths]) ?? []);

    expect(pathsByLine(all).get("underline")).toEqual(pathsByLine(none).get("underline"));
    expect(pathsByLine(all).get("line-through")).toEqual(pathsByLine(none).get("line-through"));
  });

  it("excludes stroke and shadow from the skip-ink region", () => {
    const textDecoration = {
      line: "underline" as const,
      thicknessPx: 2,
      offsetPx: -12,
      skipInk: "all" as const,
    };
    const plain = findText(
      engine.renderToIR(canvasWithText(["HH"], { textDecoration })).root,
      "decorated",
    );
    const effected = findText(
      engine.renderToIR(
        canvasWithText(["HH"], {
          textDecoration,
          textStrokes: [{ color: "#ef4444", widthPx: 8 }],
          textShadows: [{ dx: 4, dy: 4, blurPx: 6, color: "#000000" }],
        }),
      ).root,
      "decorated",
    );

    expect(effected.textDecorations).toEqual(plain.textDecorations);
  });

  it("maps skip-ink subtraction to the vertical inline axis", () => {
    const props = {
      width: 100,
      height: 200,
      writingMode: "vertical-rl" as const,
      textOrientation: "upright" as const,
      textDecoration: {
        line: "underline" as const,
        thicknessPx: 2,
        offsetPx: -12,
      },
    };
    const continuous = findText(
      engine.renderToIR(canvasWithText(["日日"], props)).root,
      "decorated",
    );
    const skipped = findText(
      engine.renderToIR(
        canvasWithText(["日日"], {
          ...props,
          textDecoration: { ...props.textDecoration, skipInk: "all" },
        }),
      ).root,
      "decorated",
    );

    expect(skipped.lines).toEqual(continuous.lines);
    expect(skipped.textDecorations?.[0]?.paths.map((path) => path.d)).not.toEqual(
      continuous.textDecorations?.[0]?.paths.map((path) => path.d),
    );
  });

  it.each([
    {
      label: "Latin descender",
      text: "gyp",
      props: { font: "Inter", fallback: ["NotoSansJP"] },
    },
    {
      label: "CJK fallback",
      text: "日日",
      props: { font: "Inter", fallback: ["NotoSansJP"] },
    },
    {
      label: "combining cluster",
      text: "g\u0301g",
      props: { font: "Inter", fallback: ["NotoSansJP"] },
    },
  ])("uses final $label outlines for skip-ink", ({ text, props }) => {
    const decoration = { line: "underline" as const, thicknessPx: 2, offsetPx: -10 };
    const continuous = findText(
      engine.renderToIR(canvasWithText([text], { ...props, textDecoration: decoration })).root,
      "decorated",
    );
    const skipped = findText(
      engine.renderToIR(
        canvasWithText([text], {
          ...props,
          textDecoration: { ...decoration, skipInk: "all" },
        }),
      ).root,
      "decorated",
    );

    expect(skipped.lines).toEqual(continuous.lines);
    expect(skipped.textDecorations?.[0]?.paths.map((path) => path.d)).not.toEqual(
      continuous.textDecorations?.[0]?.paths.map((path) => path.d),
    );
    if (text.includes("日")) {
      expect(skipped.lines?.[0]?.positionedGlyphs?.map((glyph) => glyph.fontAlias)).toEqual([
        "NotoSansJP",
        "NotoSansJP",
      ]);
    }
  });

  it("uses the selected variable-font outline for skip-ink", () => {
    const render = (weight: number): IRTextNode =>
      findText(
        engine.renderToIR(
          canvasWithText(["HH"], {
            font: "Inter",
            fallback: ["NotoSansJP"],
            fontVariationSettings: `"wght" ${weight}`,
            textDecoration: {
              line: "underline",
              thicknessPx: 2,
              offsetPx: -10,
              skipInk: "all",
            },
          }),
        ).root,
        "decorated",
      );
    const light = render(300);
    const bold = render(800);

    expect(light.textDecorations?.[0]?.paths.map((path) => path.d)).not.toEqual(
      bold.textDecorations?.[0]?.paths.map((path) => path.d),
    );
  });

  it("uses synthetic tofu ink independently of its diagnostic visibility", () => {
    const text = "\u{10ffff}";
    const decoration = { line: "underline" as const, thicknessPx: 2, offsetPx: -10 };
    const continuous = findText(
      engine.renderToIR(canvasWithText([text], { textDecoration: decoration }), {
        showMissingGlyphs: false,
      }).root,
      "decorated",
    );
    const renderSkipped = (showMissingGlyphs: boolean): IRTextNode =>
      findText(
        engine.renderToIR(
          canvasWithText([text], {
            textDecoration: { ...decoration, skipInk: "all" },
          }),
          { showMissingGlyphs },
        ).root,
        "decorated",
      );
    const hiddenTofu = renderSkipped(false);
    const visibleTofu = renderSkipped(true);

    expect(hiddenTofu.lines?.[0]?.glyphs?.[0]?.glyphId).toBe(0);
    expect(hiddenTofu.textDecorations).toEqual(visibleTofu.textDecorations);
    expect(hiddenTofu.textDecorations?.[0]?.paths.map((path) => path.d)).not.toEqual(
      continuous.textDecorations?.[0]?.paths.map((path) => path.d),
    );
  });

  it("includes final decoration geometry in bbox without changing layoutBox", () => {
    const plain = findText(engine.renderToIR(canvasWithText(["bbox"])).root, "decorated");
    const decorated = findText(
      engine.renderToIR(
        canvasWithText(["bbox"], {
          textDecoration: {
            line: "underline",
            thicknessPx: 2,
            offsetPx: 20,
            skipInk: "all",
          },
        }),
      ).root,
      "decorated",
    );
    const decorationBBox = paintPathBBox(decorated.textDecorations?.[0]?.paths[0]);

    expect(decorated.layoutBox).toEqual(plain.layoutBox);
    expect(decorated.bbox.y + decorated.bbox.h).toBeCloseTo(decorationBBox.maxY, 5);
    expect(decorated.bbox.y + decorated.bbox.h).toBeGreaterThan(plain.bbox.y + plain.bbox.h);
  });

  it("falls back when wavy skip-ink reaches the candidate-pair limit for Japanese text", () => {
    const content = "あ".repeat(24);
    const fallbackWarnings: RecoverableError[] = [];
    const fallbackScene = canvasWithText([content], {
      fontSizePx: 28,
      width: 800,
      wrap: "none",
      textDecoration: { line: "underline", style: "wavy", skipInk: "all" },
    });
    const { svg, ir } = engine.renderToSvgAndIR(fallbackScene, {
      onWarning: (warning) => fallbackWarnings.push(warning),
    });
    const fallbackText = findText(ir.root, "decorated");
    const explicitNoneText = findText(
      engine.renderToIR(
        canvasWithText([content], {
          fontSizePx: 28,
          width: 800,
          wrap: "none",
          textDecoration: { line: "underline", style: "wavy", skipInk: "none" },
        }),
      ).root,
      "decorated",
    );

    expect(svg).toContain("<svg");
    expect(fallbackText.textDecorations?.[0]?.skipInk ?? "none").toBe("none");
    expect(fallbackText.textDecorations?.[0]?.paths).toEqual(
      explicitNoneText.textDecorations?.[0]?.paths,
    );
    expect(
      fallbackWarnings.map((warning) => ({
        code: warning.code,
        stage: warning.stage,
        nodeId: warning.nodeId,
        fallback: warning.fallback,
      })),
    ).toContainEqual({
      code: "TEXT_DECORATION_SKIP_INK_LIMIT",
      stage: "ir",
      nodeId: "decorated",
      fallback: "rendered text decoration without skip-ink",
    });
  });

  it("falls back at the skip-ink glyph preflight limit without poisoning later renders", () => {
    const healthyTree = canvasWithText(["HH"], {
      textDecoration: { line: "underline", offsetPx: -12, skipInk: "all" },
    });
    const healthyBefore = engine.renderToSvg(healthyTree);
    const warnings: RecoverableError[] = [];
    const fallbackText = findText(
      engine.renderToIR(
        canvasWithText(["H".repeat(16_385)], {
          wrap: "none",
          textDecoration: { line: "underline", offsetPx: -12, skipInk: "all" },
        }),
        { onWarning: (warning) => warnings.push(warning) },
      ).root,
      "decorated",
    );

    expect(fallbackText.textDecorations?.[0]?.skipInk ?? "none").toBe("none");
    expect(warnings.map((warning) => warning.code)).toContain("TEXT_DECORATION_SKIP_INK_LIMIT");
    expect(engine.renderToSvg(healthyTree)).toBe(healthyBefore);
  });

  it("rejects tiny pattern cells before materializing an unbounded path", () => {
    expectFatalCode(
      () =>
        engine.renderToSvg(
          canvasWithText(["budget"], {
            textDecoration: { line: "underline", style: "dotted", thicknessPx: 0.000001 },
          }),
        ),
      "TEXT_DECORATION_PATTERN_LIMIT",
    );
  });

  it("keeps cached layout results isolated between differently decorated Text nodes", () => {
    const buildTree = (decoratedFirst: boolean): VNode => {
      const text = (id: string, decorated: boolean): VNode =>
        createElement(
          "Text",
          {
            id,
            font: "NotoSansJP",
            fallback: ["Inter"],
            fontSizePx: 24,
            color: "#102030",
            width: 300,
            textDecoration: decorated
              ? { line: "underline", color: "#ef4444", thicknessPx: 2 }
              : undefined,
          },
          "Hello",
          createElement("Inline", {}, "World"),
        );
      const decorated = text("cache-decorated", true);
      const plain = text("cache-plain", false);
      return createElement(
        "Canvas",
        { width: 360, height: 160, background: "#ffffff" },
        createElement(
          "Flex",
          { direction: "column", width: 320, height: 140 },
          ...(decoratedFirst ? [decorated, plain] : [plain, decorated]),
        ),
      );
    };

    for (const decoratedFirst of [true, false]) {
      const root = engine.renderToIR(buildTree(decoratedFirst)).root;
      const decorated = findText(root, "cache-decorated");
      const plain = findText(root, "cache-plain");
      expect(decorated.textDecorations).toEqual([
        expect.objectContaining({ line: "underline", color: "#ef4444" }),
      ]);
      expect(plain.textDecorations ?? []).toEqual([]);
    }
  });

  it("accepts decorated inline containers that do not contain text", () => {
    const tree = canvasWithText([
      "plain text",
      createElement("Inline", { textDecoration: { line: "underline" } }),
      createElement("InlineBox", {
        paddingInline: [4, 4],
        background: "#eeeeee",
        textDecoration: { line: "underline", color: "#ef4444" },
      }),
    ]);

    expect(() => engine.renderToIR(tree)).not.toThrow();
  });

  it("keeps decoration-only ligature boundaries shaping-identical and rounds outward", () => {
    const plain = canvasWithText(["f", createElement("Inline", {}, "i")]);
    const decorated = canvasWithText([
      "f",
      createElement(
        "Inline",
        { textDecoration: { line: "underline", color: "#ef4444", thicknessPx: 2 } },
        "i",
      ),
    ]);
    const plainText = findText(engine.renderToIR(plain).root, "decorated");
    const decoratedText = findText(engine.renderToIR(decorated).root, "decorated");

    expect(decoratedText.lines).toEqual(plainText.lines);
    expect(decoratedText.glyphPaths).toEqual(plainText.glyphPaths);
    expect(decoratedText.textDecorations).toHaveLength(1);
    const fragment = decoratedText.textDecorations?.[0];
    expect(fragment?.sourceStart).toBe(1);
    expect(fragment?.sourceEnd).toBe(2);
    expect(fragment?.paths).toHaveLength(1);
    const fragmentBBox = paintPathBBox(fragment?.paths[0]);
    expect(fragmentBBox.minX).toBeLessThanOrEqual(
      decoratedText.lines?.[0]?.positionedGlyphs?.[0]?.originX ?? Number.NEGATIVE_INFINITY,
    );
    expect(fragmentBBox.maxX).toBeCloseTo(
      (decoratedText.bbox?.x ?? 0) + (decoratedText.lines?.[0]?.width ?? 0),
      2,
    );
  });

  it("keeps a combining sequence atomic when decoration starts on the mark", () => {
    const plain = canvasWithText(["e", createElement("Inline", {}, "\u0301")]);
    const decorated = canvasWithText([
      "e",
      createElement(
        "Inline",
        { textDecoration: { line: "underline", color: "#ef4444" } },
        "\u0301",
      ),
    ]);
    const plainText = findText(engine.renderToIR(plain).root, "decorated");
    const decoratedText = findText(engine.renderToIR(decorated).root, "decorated");

    expect(decoratedText.lines).toEqual(plainText.lines);
    expect(decoratedText.glyphPaths).toEqual(plainText.glyphPaths);
    expect(decoratedText.textDecorations?.[0]).toEqual(
      expect.objectContaining({ sourceStart: 0, sourceEnd: 1 }),
    );
    expect(decoratedText.textDecorations?.[0]?.paths).toHaveLength(1);
  });

  it("resolves inheritance, none override, InlineBox, ruby base, and explicit Rt scope", () => {
    const tree = canvasWithText(
      [
        "A",
        createElement("Inline", { textDecoration: "none" }, "B"),
        createElement(
          "InlineBox",
          { textDecoration: { line: "line-through", color: "#22c55e" } },
          "C",
        ),
        createElement(
          "Ruby",
          {},
          "漢",
          createElement("Rt", { textDecoration: { line: "overline", color: "#3b82f6" } }, "かん"),
        ),
        "D",
      ],
      { textDecoration: { line: "underline", color: "#ef4444" } },
    );
    const text = findText(engine.renderToIR(tree).root, "decorated");
    const fragments = text.textDecorations ?? [];

    expect(fragments.some((fragment) => fragment.line === "underline")).toBe(true);
    expect(
      fragments.some(
        (fragment) => fragment.line === "line-through" && fragment.color === "#22c55e",
      ),
    ).toBe(true);
    expect(
      fragments.some((fragment) => fragment.line === "overline" && fragment.color === "#3b82f6"),
    ).toBe(true);
    expect(
      fragments.some((fragment) => fragment.sourceStart === 1 && fragment.sourceEnd === 2),
    ).toBe(false);
  });

  it("creates per-line horizontal strips and physical vertical strips", () => {
    const horizontal = canvasWithText(["天地 玄黄 宇宙 洪荒"], {
      width: 110,
      wrap: "char",
      textDecoration: { line: "underline", style: "double", thicknessPx: 2 },
    });
    const vertical = canvasWithText(["天地玄黄宇宙洪荒"], {
      width: 180,
      height: 130,
      writingMode: "vertical-rl",
      textOrientation: "upright",
      textDecoration: { line: ["underline", "overline"] },
    });
    const horizontalText = findText(engine.renderToIR(horizontal).root, "decorated");
    const verticalText = findText(engine.renderToIR(vertical).root, "decorated");
    const horizontalPaths = horizontalText.textDecorations?.flatMap((fragment) => fragment.paths);
    const verticalPaths = verticalText.textDecorations?.flatMap((fragment) => fragment.paths);

    expect(new Set(horizontalPaths?.map((path) => path.originY)).size).toBeGreaterThan(1);
    expect(horizontalPaths?.length).toBe((horizontalText.lines?.length ?? 0) * 2);
    expect(verticalPaths?.length).toBeGreaterThan(0);
    expect(
      verticalPaths?.every((path) => {
        const bbox = paintPathBBox(path);
        return bbox.maxY - bbox.minY > bbox.maxX - bbox.minX;
      }),
    ).toBe(true);
  });

  it("preserves layout identity through nowrap, pre-wrap, fit shrink, and flow exclusion", () => {
    const cases: Array<{ children: VNode["children"]; props: Record<string, unknown> }> = [
      {
        children: ["f", createElement("Inline", {}, "i no wrap")],
        props: { wrap: "none" },
      },
      {
        children: ["A ", createElement("Inline", {}, "B\nC"), " D"],
        props: { whiteSpace: "pre-wrap", width: 90 },
      },
      {
        children: ["縮", createElement("Inline", {}, "小 fitting")],
        props: { width: 100, height: 48, fontSizePx: 48, fit: "shrink", minFontSizePx: 12 },
      },
      {
        children: ["flow ", createElement("Inline", {}, "decoration identity ".repeat(4))],
        props: {
          width: 250,
          height: 170,
          flowExclusions: [{ kind: "rect", x: 80, y: 20, width: 70, height: 60 }],
        },
      },
    ];

    for (const testCase of cases) {
      const plain = canvasWithText(testCase.children, testCase.props);
      const decoratedChildren = testCase.children.map((child) => {
        if (typeof child === "string" || child.type !== "Inline") {
          return child;
        }
        return createElement(
          "Inline",
          { ...child.props, textDecoration: { line: "underline", color: "#ef4444" } },
          ...child.children,
        );
      });
      const decorated = canvasWithText(decoratedChildren, testCase.props);
      const plainText = findText(engine.renderToIR(plain).root, "decorated");
      const decoratedText = findText(engine.renderToIR(decorated).root, "decorated");

      expect(decoratedText.lines).toEqual(plainText.lines);
      expect(decoratedText.chosenFontSizePx).toBe(plainText.chosenFontSizePx);
      expect(decoratedText.textDecorations?.length).toBeGreaterThan(0);
    }
  });

  it("keeps plain Text layout identical when decoration is the only paint change", () => {
    const cases: Array<{ text: string; props: Record<string, unknown> }> = [
      { text: "a\tb\n c  d", props: { whiteSpace: "pre-wrap", tabSize: 4 } },
      {
        text: "office fluffy waffle text overflow",
        props: { width: 220, maxLines: 1, ellipsis: true, wrap: "anywhere" },
      },
    ];

    for (const testCase of cases) {
      const plain = findText(
        engine.renderToIR(canvasWithText([testCase.text], testCase.props)).root,
        "decorated",
      );
      const decorated = findText(
        engine.renderToIR(
          canvasWithText([testCase.text], {
            ...testCase.props,
            textDecoration: { line: "underline", color: "#ef4444" },
          }),
        ).root,
        "decorated",
      );

      expect(decorated.lines).toEqual(plain.lines);
      expect(decorated.layoutBox).toEqual(plain.layoutBox);
      expect(decorated.bbox.w).toBeGreaterThanOrEqual(plain.bbox.w);
      expect(decorated.bbox.h).toBeGreaterThanOrEqual(plain.bbox.h);
      expect(decorated.textDecorations?.length).toBeGreaterThan(0);
    }
  });

  it("maps rich decoration ranges after whitespace normalization", () => {
    const rubyText = findText(
      engine.renderToIR(
        canvasWithText([
          " A  B",
          createElement(
            "Ruby",
            {},
            "漢",
            createElement("Rt", { textDecoration: { line: "overline", color: "#3b82f6" } }, "かん"),
          ),
        ]),
      ).root,
      "decorated",
    );
    expect(rubyText.textDecorations).toEqual([
      expect.objectContaining({ line: "overline", sourceStart: 0, sourceEnd: 2 }),
    ]);

    const inlineBoxText = findText(
      engine.renderToIR(
        canvasWithText([
          "A",
          createElement("InlineBox", {}, " B"),
          createElement(
            "Inline",
            { textDecoration: { line: "underline", color: "#00ff00" } },
            "CD",
          ),
        ]),
      ).root,
      "decorated",
    );
    const inlineBoxRange = inlineBoxText.textDecorations?.[0];
    expect(inlineBoxText.lines?.[0]?.text).toBe("ABCD");
    expect(inlineBoxRange).toEqual(
      expect.objectContaining({ line: "underline", sourceStart: 2, sourceEnd: 4 }),
    );
    expect(
      paintPathBBox(inlineBoxRange?.paths[0]).maxX - paintPathBBox(inlineBoxRange?.paths[0]).minX,
    ).toBeGreaterThan(30);
  });

  it("uses em-box centers for all vertical decoration lines", () => {
    const text = findText(
      engine.renderToIR(
        canvasWithText(["日本語"], {
          width: 60,
          height: 180,
          fontSizePx: 40,
          lineHeight: 1,
          writingMode: "vertical-rl",
          textOrientation: "upright",
          textDecoration: {
            line: ["underline", "overline", "line-through"],
            thicknessPx: 2,
          },
        }),
      ).root,
      "decorated",
    );
    const centerByLine = new Map(
      text.textDecorations?.map((fragment) => [fragment.line, fragment.paths[0]?.originX]),
    );
    const lineThrough = centerByLine.get("line-through") ?? 0;
    expect(centerByLine.get("underline")).toBeCloseTo(lineThrough - 20, 2);
    expect(centerByLine.get("overline")).toBeCloseTo(lineThrough + 20, 2);
  });

  it("preserves a uniform nested decoration inside text-combine-upright", () => {
    const text = findText(
      engine.renderToIR(
        canvasWithText(
          [
            createElement(
              "Inline",
              { textCombineUpright: "all" },
              createElement(
                "Inline",
                { textDecoration: { line: "underline", color: "#ef4444" } },
                "25",
              ),
            ),
          ],
          {
            width: 80,
            height: 180,
            writingMode: "vertical-rl",
            textOrientation: "upright",
          },
        ),
      ).root,
      "decorated",
    );
    expect(text.textDecorations).toEqual([
      expect.objectContaining({ line: "underline", color: "#ef4444" }),
    ]);
    expectAtomicVerticalDecoration(text, 32);
  });

  it("keeps inherited decoration continuous through text-combine-upright", () => {
    const text = findText(
      engine.renderToIR(
        canvasWithText(
          ["年", createElement("Inline", { textCombineUpright: "all" }, "2025"), "月"],
          {
            width: 80,
            height: 180,
            writingMode: "vertical-rl",
            textOrientation: "upright",
            textDecoration: { line: "underline", color: "#ef4444", thicknessPx: 2 },
          },
        ),
      ).root,
      "decorated",
    );

    expect(text.textDecorations).toEqual([
      expect.objectContaining({ line: "underline", color: "#ef4444" }),
    ]);
    expectAtomicVerticalDecoration(text, 96);
  });

  it("preserves mixed paint ranges while shaping text-combine-upright once", () => {
    const textProps = {
      width: 80,
      height: 180,
      writingMode: "vertical-rl",
      textOrientation: "upright",
    } as const;
    const decorated = findText(
      engine.renderToIR(
        canvasWithText(
          [
            createElement(
              "Inline",
              { textCombineUpright: "all" },
              createElement(
                "Inline",
                { textDecoration: { line: "underline", color: "#ef4444" } },
                "2",
              ),
              "5",
            ),
          ],
          textProps,
        ),
      ).root,
      "decorated",
    );
    const plain = findText(
      engine.renderToIR(
        canvasWithText([createElement("Inline", { textCombineUpright: "all" }, "25")], textProps),
      ).root,
      "decorated",
    );

    expect(decorated.lines).toEqual(plain.lines);
    expect(decorated.textDecorations).toEqual([
      expect.objectContaining({
        line: "underline",
        color: "#ef4444",
        sourceStart: 0,
        sourceEnd: 1,
      }),
    ]);
    expectAtomicVerticalDecoration(decorated, 32);
  });

  it("keeps mixed text-combine-upright ranges aligned after whitespace collapse", () => {
    const text = findText(
      engine.renderToIR(
        canvasWithText(
          [
            createElement(
              "Inline",
              { textCombineUpright: "all" },
              "2  ",
              createElement(
                "Inline",
                { textDecoration: { line: "underline", color: "#ef4444" } },
                "5",
              ),
            ),
          ],
          {
            width: 80,
            height: 180,
            writingMode: "vertical-rl",
            textOrientation: "upright",
          },
        ),
      ).root,
      "decorated",
    );

    expect(text.lines?.[0]?.text).toBe("2 5");
    expect(text.textDecorations).toEqual([
      expect.objectContaining({ sourceStart: 2, sourceEnd: 3 }),
    ]);
    expectAtomicVerticalDecoration(text, 32);
  });

  it("splits one inherited range when resolved font metrics differ", () => {
    const tree = canvasWithText(
      ["日", createElement("Inline", { font: "Inter", language: "en" }, "A"), "本"],
      { textDecoration: { line: "underline" } },
    );
    const text = findText(engine.renderToIR(tree).root, "decorated");
    const underline = text.textDecorations?.find((fragment) => fragment.line === "underline");
    expect(underline?.paths.length).toBeGreaterThan(1);
  });

  it("keeps spaces continuous and excludes InlineBox padding from the painted extent", () => {
    const spaced = findText(
      engine.renderToIR(
        canvasWithText(["A B"], {
          textDecoration: { line: "underline", thicknessPx: 2 },
        }),
      ).root,
      "decorated",
    );
    const spacedPath = spaced.textDecorations?.[0]?.paths[0];
    expect(spaced.textDecorations?.[0]?.paths).toHaveLength(1);
    const spacedBBox = paintPathBBox(spacedPath);
    expect(spacedBBox.maxX - spacedBBox.minX).toBeCloseTo(spaced.lines?.[0]?.width ?? 0, 2);

    const withoutPadding = findText(
      engine.renderToIR(
        canvasWithText([
          createElement(
            "InlineBox",
            { textDecoration: { line: "underline", thicknessPx: 2 } },
            "pad",
          ),
        ]),
      ).root,
      "decorated",
    );
    const withPadding = findText(
      engine.renderToIR(
        canvasWithText([
          createElement(
            "InlineBox",
            {
              paddingInline: [10, 10],
              textDecoration: { line: "underline", thicknessPx: 2 },
            },
            "pad",
          ),
        ]),
      ).root,
      "decorated",
    );
    const unpaddedBBox = paintPathBBox(withoutPadding.textDecorations?.[0]?.paths[0]);
    const paddedBBox = paintPathBBox(withPadding.textDecorations?.[0]?.paths[0]);
    const unpaddedExtent = unpaddedBBox.maxX - unpaddedBBox.minX;
    const paddedExtent = paddedBBox.maxX - paddedBBox.minX;

    expect(paddedExtent).toBeCloseTo(unpaddedExtent, 2);
    expect(
      (withPadding.lines?.[0]?.width ?? 0) - (withoutPadding.lines?.[0]?.width ?? 0),
    ).toBeCloseTo(20, 2);
  });

  it("applies offsetPx along the physical block-end axis", () => {
    const horizontalDefault = findText(
      engine.renderToIR(
        canvasWithText(["offset"], { textDecoration: { line: "underline", thicknessPx: 2 } }),
      ).root,
      "decorated",
    );
    const horizontalOffset = findText(
      engine.renderToIR(
        canvasWithText(["offset"], {
          textDecoration: { line: "underline", thicknessPx: 2, offsetPx: 5 },
        }),
      ).root,
      "decorated",
    );
    expect(horizontalOffset.textDecorations?.[0]?.paths[0]?.originY).toBeCloseTo(
      (horizontalDefault.textDecorations?.[0]?.paths[0]?.originY ?? 0) + 5,
      2,
    );

    const verticalProps = {
      width: 180,
      height: 130,
      writingMode: "vertical-rl",
      textOrientation: "upright",
    };
    const verticalDefault = findText(
      engine.renderToIR(
        canvasWithText(["天地"], {
          ...verticalProps,
          textDecoration: { line: "underline", thicknessPx: 2 },
        }),
      ).root,
      "decorated",
    );
    const verticalOffset = findText(
      engine.renderToIR(
        canvasWithText(["天地"], {
          ...verticalProps,
          textDecoration: { line: "underline", thicknessPx: 2, offsetPx: 5 },
        }),
      ).root,
      "decorated",
    );
    expect(verticalOffset.textDecorations?.[0]?.paths[0]?.originX).toBeCloseTo(
      (verticalDefault.textDecorations?.[0]?.paths[0]?.originX ?? 0) - 5,
      2,
    );
  });

  it("emits closed strips in shadow/decoration/stroke/fill/line-through order", () => {
    const tree = canvasWithText(["Order"], {
      textDecoration: {
        line: ["underline", "overline", "line-through"],
        color: "#12ab34",
        thicknessPx: 2,
        offsetPx: -10,
        skipInk: "all",
      },
      textStroke: "#7c3aed",
      textStrokeWidth: 3,
      textShadows: [{ dx: 2, dy: 2, blurPx: 2, color: "#f59e0b" }],
    });
    const svg = engine.renderToSvg(tree);
    const shadowIndex = svg.indexOf('filter="url(#');
    const firstDecorationIndex = svg.indexOf('fill="#12ab34" stroke="none"');
    const strokeIndex = svg.indexOf('stroke="#7c3aed" stroke-width="3"');
    const glyphFillIndex = svg.indexOf('fill="#102030"', strokeIndex);
    const lineThroughIndex = svg.lastIndexOf('fill="#12ab34" stroke="none"');

    expect(shadowIndex).toBeGreaterThan(-1);
    expect(firstDecorationIndex).toBeGreaterThan(shadowIndex);
    expect(strokeIndex).toBeGreaterThan(firstDecorationIndex);
    expect(glyphFillIndex).toBeGreaterThan(strokeIndex);
    expect(lineThroughIndex).toBeGreaterThan(glyphFillIndex);
    expect(svg).toMatch(
      /<path d="M[^"]+Z" transform="translate\([^"]+\)" fill="#12ab34" stroke="none"\/>/,
    );
  });

  it("keeps decorations below every multi-stroke layer", () => {
    const svg = engine.renderToSvg(
      canvasWithText(["Layers"], {
        textDecoration: { line: "underline", color: "#12ab34" },
        textStrokes: [
          { color: "#111111", widthPx: 6 },
          { color: "#eeeeee", widthPx: 2 },
        ],
      }),
    );
    const decorationIndex = svg.indexOf('fill="#12ab34" stroke="none"');
    const outerStrokeIndex = svg.indexOf('stroke="#111111" stroke-width="6"');
    const innerStrokeIndex = svg.indexOf('stroke="#eeeeee" stroke-width="2"');

    expect(decorationIndex).toBeGreaterThan(-1);
    expect(outerStrokeIndex).toBeGreaterThan(decorationIndex);
    expect(innerStrokeIndex).toBeGreaterThan(outerStrokeIndex);
  });

  it("keeps SVG deterministic and changes PNG pixels only when enabled", () => {
    const plain = canvasWithText(["Raster parity"]);
    const decorated = canvasWithText(["Raster parity"], {
      textDecoration: {
        line: ["underline", "overline", "line-through"],
        style: "double",
        color: "#ef4444",
        offsetPx: -10,
        skipInk: "all",
      },
    });
    const reordered = canvasWithText(["Raster parity"], {
      textDecoration: {
        line: ["line-through", "underline", "overline"],
        style: "double",
        color: "#ef4444",
        offsetPx: -10,
        skipInk: "all",
      },
    });
    const firstSvg = engine.renderToSvg(decorated);
    const secondSvg = engine.renderToSvg(decorated);
    const reorderedSvg = engine.renderToSvg(reordered);
    const plainPng = engine.renderToPng(plain);
    const decoratedPng = engine.renderToPng(decorated);

    expect(secondSvg).toBe(firstSvg);
    expect(reorderedSvg).toBe(firstSvg);
    expect(Buffer.from(decoratedPng).equals(Buffer.from(plainPng))).toBe(false);
  });
});
