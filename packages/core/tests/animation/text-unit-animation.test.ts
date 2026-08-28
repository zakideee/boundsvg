import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const UNIT_TRACK: AnimationSpec = {
  keyframes: [
    { at: 0, opacity: 0, transform: { translateY: 12, scaleX: 0.8, scaleY: 0.8 } },
    { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
  ],
  durationMs: 100,
  easing: "linear",
  fill: "both",
};

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

function extractTextGroup(svg: string, label: string): string {
  const match = svg.match(new RegExp(`<g[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?</g>`));
  if (!match) {
    throw new TypeError(`Missing SVG Text group ${label}`);
  }
  return match[0];
}

function clusterScene(options?: {
  animateUnits?: boolean;
  content?: string;
  effects?: boolean;
  fontSizePx?: number;
  outer?: boolean;
}) {
  return createElement(
    "Canvas",
    { width: 240, height: 100 },
    createElement(
      "Text",
      {
        id: "units",
        font: "NotoSansJP",
        fontSizePx: options?.fontSizePx ?? 40,
        color: "#ffffff",
        ...(options?.effects
          ? {
              textShadows: [
                { dx: 2, dy: 3, blurPx: 1, color: "#000000" },
                { dx: -1, dy: 1, blurPx: 0, color: "#00ffff" },
              ],
              textStrokes: [
                { color: "#ff0000", widthPx: 4 },
                { color: "#0000ff", widthPx: 2 },
              ],
            }
          : {}),
        ...(options?.outer
          ? {
              animate: {
                keyframes: [
                  { at: 0, opacity: 0.5, transform: { translateX: 0 } },
                  { at: 1, opacity: 1, transform: { translateX: 10 } },
                ],
                durationMs: 100,
                easing: "linear" as const,
                fill: "both" as const,
              },
            }
          : {}),
        ...(options?.animateUnits === false
          ? {}
          : {
              animateUnits: {
                by: "cluster" as const,
                animation: UNIT_TRACK,
                delayStepMs: 50,
                order: "logical" as const,
                ruby: "with-base" as const,
              },
            }),
      },
      options?.content ?? "AB",
    ),
  );
}

describe("Text animateUnits", () => {
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

  it("retains stable membership, actual outline bounds, and staggered sampled poses", () => {
    const scene = clusterScene();
    const ir = engine.renderToIR(scene, { timeMs: 25 });
    const text = findText(ir.root, "units");

    expect(text.unitAnimation).toMatchObject({ by: "cluster", delayStepMs: 50 });
    expect(text.unitMap?.units).toHaveLength(2);
    expect(text.glyphPaths).toHaveLength(2);
    expect(text.unitAnimationSamples).toHaveLength(2);
    expect(text.unitAnimationSamples?.[0]?.opacity).toBeCloseTo(0.25);
    expect(text.unitAnimationSamples?.[1]?.opacity).toBeCloseTo(0);
    expect(text.unitAnimationSamples?.[0]?.bbox?.w).toBeGreaterThan(0);
    expect(text.unitAnimationSamples?.[0]?.bbox?.h).toBeGreaterThan(0);
    expect(ir.drawOrder.filter((nodeId) => nodeId === "units")).toHaveLength(1);
    expect(ir.drawOrder.some((nodeId) => nodeId.includes(":unit:"))).toBe(false);
    expect(text.glyphPaths?.map((path) => path.unitId)).toEqual(
      text.unitMap?.units.map((unit) => unit.unitId),
    );
    const resolvedText = findText(engine.renderToSvgAndIR(scene, { timeMs: 25 }).ir.root, "units");
    expect(resolvedText.unitAnimationSamples?.[0]?.opacity).toBeCloseTo(0.25);
    expect(resolvedText.unitAnimationSamples?.[0]?.bbox).toEqual(
      text.unitAnimationSamples?.[0]?.bbox,
    );
  });

  it("keeps shaping, line layout, advances, and chosen size additive", () => {
    const animated = findText(engine.renderToIR(clusterScene()).root, "units");
    const plain = findText(engine.renderToIR(clusterScene({ animateUnits: false })).root, "units");

    expect(animated.lines).toEqual(plain.lines);
    expect(animated.fontSizePx).toBe(plain.fontSizePx);
    expect(animated.lineHeightPx).toBe(plain.lineHeightPx);
    expect(animated.bbox).toEqual(plain.bbox);
    expect(animated.layoutBox).toEqual(plain.layoutBox);
  });

  it("uses real shaped clusters across rich inline runs without splitting atomic units", () => {
    const buildScene = (animateUnits: boolean) =>
      createElement(
        "Canvas",
        { width: 360, height: 100 },
        createElement(
          "Text",
          {
            id: "rich-shaped-units",
            font: "NotoSansJP",
            fontSizePx: 32,
            wrap: "none",
            ...(animateUnits
              ? { animateUnits: { by: "cluster" as const, animation: UNIT_TRACK } }
              : {}),
          },
          createElement("Inline", { color: "#ef4444", language: "en" }, "fi"),
          createElement("Inline", { color: "#22c55e" }, "e\u0301"),
          createElement("Inline", { color: "#38bdf8" }, "漢"),
          createElement("Inline", { color: "#f8fafc" }, "👨‍👩‍👧"),
        ),
      );
    const animated = findText(engine.renderToIR(buildScene(true)).root, "rich-shaped-units");
    const plain = findText(engine.renderToIR(buildScene(false)).root, "rich-shaped-units");
    const units = animated.unitMap?.units ?? [];
    const positionedGlyphCount = animated.lines.reduce(
      (sum, line) => sum + (line.positionedGlyphs?.length ?? 0),
      0,
    );

    expect(units).toHaveLength(4);
    expect(positionedGlyphCount).toBeGreaterThan(units.length);
    expect(
      units.every((unit) => unit.members.every((member) => member.sourceRole === "content")),
    ).toBe(true);
    const withoutPositionedGlyphs = (lines: IRTextNode["lines"]) =>
      lines.map(({ positionedGlyphs: _positionedGlyphs, ...line }) => line);
    expect(withoutPositionedGlyphs(animated.lines)).toEqual(withoutPositionedGlyphs(plain.lines));
  });

  it("keeps fit and ellipsis layout additive", () => {
    const buildScene = (animateUnits: boolean) =>
      createElement(
        "Canvas",
        { width: 180, height: 50 },
        createElement(
          "Text",
          {
            id: "fit-units",
            font: "NotoSansJP",
            fontSizePx: 42,
            minFontSizePx: 24,
            width: 120,
            height: 32,
            wrap: "char",
            fit: "shrink",
            maxLines: 1,
            ellipsis: true,
            ...(animateUnits
              ? { animateUnits: { by: "cluster" as const, animation: UNIT_TRACK } }
              : {}),
          },
          "字幕アニメーションの長い文章",
        ),
      );
    const animatedIr = engine.renderToIR(buildScene(true));
    const plainIr = engine.renderToIR(buildScene(false));
    const animated = findText(animatedIr.root, "fit-units");
    const plain = findText(plainIr.root, "fit-units");

    expect(animated.fontSizePx).toBe(plain.fontSizePx);
    expect(animated.lines).toEqual(plain.lines);
    for (const [lineIndex, animatedLine] of animated.lines.entries()) {
      const plainLine = plain.lines[lineIndex];
      expect(animatedLine.positionedGlyphs).toHaveLength(plainLine?.positionedGlyphs?.length ?? 0);
      for (const [glyphIndex, positionedGlyph] of (animatedLine.positionedGlyphs ?? []).entries()) {
        const plainGlyph = plainLine?.positionedGlyphs?.[glyphIndex];
        if (!plainGlyph) {
          throw new TypeError(`Missing plain glyph ${lineIndex}:${glyphIndex}`);
        }
        expect(positionedGlyph).toEqual(plainGlyph);
      }
    }
    expect(animated.bbox).toEqual(plain.bbox);
    expect(animatedIr.warnings).toEqual(plainIr.warnings);
    expect(animated.lines.map((line) => line.text).join("\n")).toContain("…");
  });

  it("keeps raw tracks and outline bounds in compiled scenes and samples each emit", () => {
    const scene = clusterScene();
    const compiled = engine.compile(scene);
    const text = findText(compiled.ir.root, "units");

    expect(text.glyphPaths).toHaveLength(2);
    expect(text.unitAnimationSamples?.every((sample) => sample.bbox !== undefined)).toBe(true);
    expect(text.unitAnimationSamples?.every((sample) => sample.opacity === undefined)).toBe(true);
    expect(engine.renderCompiledToSvg(compiled, { timeMs: 75 })).toBe(
      engine.renderToSvg(scene, { timeMs: 75 }),
    );
  });

  it("reuses compile-time unit outlines unless emit options require new missing glyphs", () => {
    const resolveAndEmitSvgFromIrFn = vi.fn((irJson: string, optionsJson: string) =>
      handle.resolveAndEmitSvgFromIr(irJson, optionsJson),
    );
    const countingEngine = createEngineFromHandle(handle, { resolveAndEmitSvgFromIrFn });
    const compiled = countingEngine.compile(clusterScene(), { textPathMode: "glyphs" });

    countingEngine.renderCompiledToSvg(compiled, { timeMs: 25 });
    expect(JSON.parse(resolveAndEmitSvgFromIrFn.mock.calls[0]?.[1] ?? "{}")).toMatchObject({
      preserveResolvedUnitOutlines: true,
    });

    countingEngine.renderCompiledToSvg(compiled, {
      timeMs: 25,
      showMissingGlyphs: true,
    });
    expect(JSON.parse(resolveAndEmitSvgFromIrFn.mock.calls[1]?.[1] ?? "{}")).toMatchObject({
      preserveResolvedUnitOutlines: false,
      showMissingGlyphs: true,
    });
    countingEngine.dispose();
  });

  it("keeps showMissingGlyphs per-call and compiled output identical", () => {
    const scene = clusterScene({ content: "A🦄" });
    const options = { timeMs: 25, showMissingGlyphs: true };

    expect(engine.renderCompiledToSvg(engine.compile(scene), options)).toBe(
      engine.renderToSvg(scene, options),
    );
  });

  it("rejects a legacy glyph index space when unit membership is active", () => {
    const compiled = engine.compile(clusterScene());
    const text = findText(compiled.ir.root, "units");
    const firstLine = text.lines[0];
    if (!firstLine) {
      throw new TypeError("Missing Text line");
    }
    firstLine.positionedGlyphs = undefined;

    expect(() =>
      engine.renderCompiledToSvg(compiled, {
        timeMs: 25,
        showMissingGlyphs: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEXT_UNIT_INDEX_SPACE_MISMATCH", stage: "text" }),
    );
  });

  it("rejects out-of-range positioned glyph membership", () => {
    const compiled = engine.compile(clusterScene());
    const text = findText(compiled.ir.root, "units");
    const firstMember = text.unitMap?.units[0]?.members[0];
    if (!firstMember) {
      throw new TypeError("Missing Text unit member");
    }
    firstMember.glyphIndex = Number.MAX_SAFE_INTEGER;

    expect(() =>
      engine.renderCompiledToSvg(compiled, {
        timeMs: 25,
        showMissingGlyphs: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEXT_UNIT_INDEX_SPACE_MISMATCH", stage: "text" }),
    );
  });

  it("rejects a finite stagger whose effective unit delay overflows", () => {
    const scene = createElement(
      "Canvas",
      { width: 240, height: 100 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 40,
          animateUnits: {
            by: "cluster",
            animation: { ...UNIT_TRACK, delayMs: Number.MAX_VALUE },
            delayStepMs: Number.MAX_VALUE,
          },
        },
        "AB",
      ),
    );

    expect(() => engine.renderToIR(scene)).toThrowError(
      expect.objectContaining({ code: "ANIMATION_INVALID_SPEC", stage: "validate" }),
    );
  });

  it("keeps prepared batch frames equal to per-call static SVG", () => {
    const scene = clusterScene();
    const timesMs = [0, 25, 75, 200];
    const frames = [...engine.renderFrames(scene, { timesMs, format: "svg" })];

    expect(frames.map((frame) => frame.data)).toEqual(
      timesMs.map((timeMs) => engine.renderToSvg(scene, { timeMs })),
    );
  });

  it.each([
    0, 75, 200,
  ])("rasterizes declarative and static unit animation identically at timeMs=%i", (timeMs) => {
    const scene = clusterScene();
    const declarativeSvg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs,
    });
    const staticSvg = engine.renderToSvg(scene, { timeMs });
    const staticPng = engine.renderToPng(scene, { timeMs });

    expect(declarativeSvg).toContain("@keyframes");
    expect(rasterize(declarativeSvg)).toEqual(rasterize(staticSvg));
    expect(rasterize(staticSvg)).toEqual(staticPng);
  });

  it("neutralizes the browser transform origin after baking each unit bbox center", () => {
    const svg = engine.renderToAnimatedSvg(clusterScene(), {
      playback: { mode: "independent" },
      timeMs: 25,
    });

    expect(svg).toContain("transform-box: view-box;");
    expect(svg).toContain("transform-origin: 0 0;");
  });

  it("keeps node animation outside unit animation and emits one accessibility label", () => {
    const svg = engine.renderToAnimatedSvg(clusterScene({ outer: true }), {
      playback: { mode: "independent" },
      timeMs: 25,
    });

    expect(svg.indexOf('class="bsvg-anim-units"')).toBeLessThan(
      svg.indexOf('class="bsvg-anim-units:unit:0"'),
    );
    expect(svg.match(/aria-label="AB"/g)).toHaveLength(1);
  });

  it("preserves layer-first shadow, stroke, fill order", () => {
    const scene = clusterScene({ content: "字幕", effects: true, fontSizePx: 34 });
    const svg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs: 25,
    });
    const firstShadowIndex = svg.indexOf('filter="url(#filter-units:ts0)"');
    const secondShadowIndex = svg.indexOf('filter="url(#filter-units:ts1)"');
    const firstStrokeIndex = svg.indexOf('stroke="#ff0000"');
    const secondStrokeIndex = svg.indexOf('stroke="#0000ff"');
    const fillIndex = svg.indexOf('fill="#ffffff"');
    const allShadowIndices = [...svg.matchAll(/filter="url\(#filter-units:ts[01]\)"/g)].map(
      (match) => match.index,
    );
    const allStrokeIndices = [...svg.matchAll(/stroke="(?:#ff0000|#0000ff)"/g)].map(
      (match) => match.index,
    );
    const allFillIndices = [...svg.matchAll(/fill="#ffffff"/g)].map((match) => match.index);

    expect(firstShadowIndex).toBeGreaterThan(-1);
    expect(secondShadowIndex).toBeGreaterThan(firstShadowIndex);
    expect(firstStrokeIndex).toBeGreaterThan(secondShadowIndex);
    expect(secondStrokeIndex).toBeGreaterThan(firstStrokeIndex);
    expect(fillIndex).toBeGreaterThan(secondStrokeIndex);
    expect(allShadowIndices).toHaveLength(2);
    expect(allStrokeIndices).toHaveLength(2);
    expect(allFillIndices).toHaveLength(2);
    expect(Math.max(...allShadowIndices)).toBeLessThan(Math.min(...allStrokeIndices));
    expect(Math.max(...allStrokeIndices)).toBeLessThan(Math.min(...allFillIndices));
    expect(engine.renderCompiledToSvg(engine.compile(scene), { timeMs: 0 })).toBe(
      engine.renderToSvg(scene, { timeMs: 0 }),
    );
  });

  it("targets resolved lines without changing the logical Text node", () => {
    const scene = createElement(
      "Canvas",
      { width: 100, height: 140 },
      createElement(
        "Text",
        {
          id: "lines",
          font: "NotoSansJP",
          fontSizePx: 28,
          width: 70,
          wrap: "char",
          animateUnits: { by: "line", animation: UNIT_TRACK },
        },
        "ABCDE",
      ),
    );
    const text = findText(engine.renderToIR(scene, { timeMs: 50 }).root, "lines");

    expect(text.lines.length).toBeGreaterThan(1);
    expect(text.unitMap?.units).toHaveLength(text.lines.length);
    expect(new Set(text.glyphPaths?.map((path) => path.unitId)).size).toBe(text.lines.length);
  });

  it("keeps cluster identity and ruby association while materialized widths reflow lines", () => {
    const buildScene = (width: number) =>
      createElement(
        "Canvas",
        { width: 300, height: 180 },
        createElement(
          "Text",
          {
            id: "reactive-units",
            font: "NotoSansJP",
            fontSizePx: 30,
            width,
            wrap: "char",
            animateUnits: {
              by: "cluster",
              animation: UNIT_TRACK,
              ruby: "separate",
            },
          },
          createElement("Ruby", {}, "東京", createElement("Rt", { fontSizePx: 14 }, "とうきょう")),
          "から字幕アニメーション",
        ),
      );
    const narrowScene = buildScene(90);
    const wideScene = buildScene(240);
    const narrow = findText(engine.renderToIR(narrowScene).root, "reactive-units");
    const wide = findText(engine.renderToIR(wideScene).root, "reactive-units");

    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.unitMap?.units.map((unit) => unit.unitId)).toEqual(
      wide.unitMap?.units.map((unit) => unit.unitId),
    );
    expect(narrow.unitMap?.units.map((unit) => unit.lineId)).not.toEqual(
      wide.unitMap?.units.map((unit) => unit.lineId),
    );
    expect(
      new Set(
        narrow.unitMap?.units.flatMap((unit) => unit.members.map((member) => member.sourceRole)),
      ),
    ).toEqual(new Set(["content", "rubyBase", "rubyAnnotation"]));
    expect(engine.renderCompiledToSvg(engine.compile(narrowScene), { timeMs: 0 })).toBe(
      engine.renderToSvg(narrowScene, { timeMs: 0 }),
    );
    expect(engine.renderCompiledToSvg(engine.compile(wideScene), { timeMs: 0 })).toBe(
      engine.renderToSvg(wideScene, { timeMs: 0 }),
    );
  });

  it("keeps vertical ruby identity while materialized heights reflow columns", () => {
    const buildScene = (height: number) =>
      createElement(
        "Canvas",
        { width: 260, height: 280 },
        createElement(
          "Text",
          {
            id: "vertical-reactive-units",
            font: "NotoSansJP",
            fontSizePx: 26,
            width: 180,
            height,
            writingMode: "vertical-rl",
            wrap: "char",
            animateUnits: {
              by: "cluster",
              animation: UNIT_TRACK,
              ruby: "with-base",
            },
          },
          createElement("Ruby", {}, "東京", createElement("Rt", { fontSizePx: 12 }, "とうきょう")),
          "から縦組字幕アニメーション",
        ),
      );
    const shortScene = buildScene(90);
    const tallScene = buildScene(230);
    const short = findText(engine.renderToIR(shortScene).root, "vertical-reactive-units");
    const tall = findText(engine.renderToIR(tallScene).root, "vertical-reactive-units");

    expect(short.lines.length).toBeGreaterThan(tall.lines.length);
    expect(short.unitMap?.units.map((unit) => unit.unitId)).toEqual(
      tall.unitMap?.units.map((unit) => unit.unitId),
    );
    expect(short.unitMap?.units.map((unit) => unit.lineId)).not.toEqual(
      tall.unitMap?.units.map((unit) => unit.lineId),
    );
    expect(
      new Set(
        short.unitMap?.units.flatMap((unit) => unit.members.map((member) => member.sourceRole)),
      ),
    ).toEqual(new Set(["content", "rubyBase", "rubyAnnotation"]));
    expect(engine.renderCompiledToSvg(engine.compile(shortScene), { timeMs: 0 })).toBe(
      engine.renderToSvg(shortScene, { timeMs: 0 }),
    );
    expect(engine.renderCompiledToSvg(engine.compile(tallScene), { timeMs: 0 })).toBe(
      engine.renderToSvg(tallScene, { timeMs: 0 }),
    );
  });

  it("renders ruby with-base and separate membership without splitting the logical label", () => {
    const buildRubyScene = (ruby: "with-base" | "separate") =>
      createElement(
        "Canvas",
        { width: 240, height: 100 },
        createElement(
          "Text",
          {
            id: `ruby-${ruby}`,
            font: "NotoSansJP",
            fontSizePx: 36,
            animateUnits: { by: "cluster", animation: UNIT_TRACK, ruby },
          },
          createElement("Ruby", {}, "東京", createElement("Rt", { fontSizePx: 16 }, "とうきょう")),
        ),
      );
    const withBase = findText(
      engine.renderToIR(buildRubyScene("with-base")).root,
      "ruby-with-base",
    );
    const separate = findText(engine.renderToIR(buildRubyScene("separate")).root, "ruby-separate");

    expect(separate.unitMap?.units.length).toBeGreaterThan(withBase.unitMap?.units.length ?? 0);
    const svg = engine.renderToSvg(buildRubyScene("separate"), { timeMs: 50 });
    expect(svg.match(/aria-label=/g)).toHaveLength(1);
  });

  it("keeps preceding content from creating empty ruby-annotation units", () => {
    const scene = createElement(
      "Canvas",
      { width: 240, height: 100 },
      createElement(
        "Text",
        {
          id: "ruby-after-content",
          font: "NotoSansJP",
          fontSizePx: 36,
          animateUnits: {
            by: "cluster",
            animation: UNIT_TRACK,
            delayStepMs: 20,
            order: "logical",
            ruby: "separate",
          },
        },
        "AB",
        createElement("Ruby", {}, "漢", createElement("Rt", { fontSizePx: 16 }, "かん")),
      ),
    );
    const text = findText(engine.renderToIR(scene, { timeMs: 25 }).root, "ruby-after-content");
    const units = text.unitMap?.units ?? [];

    expect(units).toHaveLength(5);
    expect(units.every((unit) => unit.members.length > 0)).toBe(true);
    expect(units.map((unit) => unit.logicalOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(text.unitAnimationSamples).toHaveLength(5);
  });

  it("keeps nested inline and multi-level ruby source units distinct", () => {
    const scene = createElement(
      "Canvas",
      { width: 320, height: 140 },
      createElement(
        "Text",
        {
          id: "nested-rich-units",
          font: "NotoSansJP",
          fontSizePx: 36,
          animateUnits: {
            by: "cluster",
            animation: UNIT_TRACK,
            order: "logical",
            ruby: "separate",
          },
        },
        createElement(
          "InlineBox",
          {},
          "AB",
          createElement("InlineBox", { color: "#60a5fa" }, "CD"),
        ),
        createElement(
          "Ruby",
          { rubyPosition: "alternate" },
          createElement("Inline", { color: "#fca5a5" }, "漢"),
          createElement("Inline", { color: "#fde68a" }, "字"),
          createElement(
            "Rt",
            { fontSizePx: 16 },
            createElement("Inline", { color: "#fca5a5" }, "か"),
            createElement("Inline", { color: "#fde68a" }, "ん"),
          ),
          createElement("Rt", { fontSizePx: 16 }, "かん"),
        ),
      ),
    );
    const text = findText(engine.renderToIR(scene, { timeMs: 25 }).root, "nested-rich-units");
    const units = text.unitMap?.units ?? [];
    const annotationUnits = units.filter((unit) =>
      unit.members.some((member) => member.sourceRole === "rubyAnnotation"),
    );

    expect(units).toHaveLength(10);
    expect(annotationUnits).toHaveLength(4);
    expect(new Set(units.map((unit) => unit.unitId))).toHaveProperty("size", 10);
    expect(units.every((unit) => unit.members.length > 0)).toBe(true);
    expect(text.unitAnimationSamples).toHaveLength(10);
  });

  it.each([
    { order: "logical" as const, ruby: "with-base" as const },
    { order: "logical" as const, ruby: "separate" as const },
    { order: "visual" as const, ruby: "with-base" as const },
    { order: "visual" as const, ruby: "separate" as const },
  ])("renders $order × $ruby through one-shot and compiled paths", ({ order, ruby }) => {
    const scene = createElement(
      "Canvas",
      { width: 240, height: 100 },
      createElement(
        "Text",
        {
          id: "ruby-order",
          font: "NotoSansJP",
          fontSizePx: 36,
          animateUnits: {
            by: "cluster",
            animation: UNIT_TRACK,
            delayStepMs: 20,
            order,
            ruby,
          },
        },
        createElement("Ruby", {}, "東京", createElement("Rt", { fontSizePx: 16 }, "とうきょう")),
      ),
    );
    const text = findText(engine.renderToIR(scene, { timeMs: 25 }).root, "ruby-order");
    const units = text.unitMap?.units ?? [];
    const samplesById = new Map(
      text.unitAnimationSamples?.map((sample) => [sample.unitId, sample]) ?? [],
    );

    expect(text.unitAnimation).toMatchObject({ order, ruby });
    expect(text.unitMap).toMatchObject({ ruby });
    expect(
      new Set(units.map((unit) => (order === "logical" ? unit.logicalOrder : unit.visualOrder))),
    ).toHaveProperty("size", units.length);
    for (const unit of units) {
      const orderIndex = order === "logical" ? unit.logicalOrder : unit.visualOrder;
      const expectedOpacity = Math.max(0, (25 - orderIndex * 20) / 100);
      expect(samplesById.get(unit.unitId)?.opacity).toBeCloseTo(expectedOpacity);
    }
    expect(engine.renderCompiledToSvg(engine.compile(scene), { timeMs: 25 })).toBe(
      engine.renderToSvg(scene, { timeMs: 25 }),
    );
  });

  it("uses sampled unit outline bounds for Text hit testing", () => {
    const scene = createElement(
      "Canvas",
      { width: 240, height: 100 },
      createElement(
        "Text",
        {
          id: "moving-unit",
          font: "NotoSansJP",
          fontSizePx: 40,
          animateUnits: {
            by: "cluster",
            animation: {
              keyframes: [
                { at: 0, transform: { translateX: 80 } },
                { at: 1, transform: { translateX: 80 } },
              ],
              durationMs: 100,
              easing: "linear",
              fill: "both",
            },
          },
        },
        "A",
      ),
    );
    const ir = engine.renderToIR(scene, { timeMs: 50 });
    const sample = findText(ir.root, "moving-unit").unitAnimationSamples?.[0];
    if (!sample?.bbox) {
      throw new TypeError("Missing moving unit bbox");
    }
    const originalX = sample.bbox.x + sample.bbox.w / 2;
    const centerY = sample.bbox.y + sample.bbox.h / 2;

    expect(engine.hitTest(ir, originalX, centerY)).toBeNull();
    expect(engine.hitTest(ir, originalX + 80, centerY)).toBe("moving-unit");
  });

  it("keeps unit fragments inside one Text layer and marks static manifests animated", () => {
    const sampled = engine.renderToLayeredSvg(clusterScene(), {
      timeMs: 25,
    });

    expect(sampled.layers).toHaveLength(1);
    expect(sampled.layers[0]?.nodeIds).toEqual(["units"]);
    expect(sampled.layers[0]?.svg).not.toContain("@keyframes");
    expect(sampled.layers[0]?.svg.match(/aria-label="AB"/g)).toHaveLength(1);
    expect(sampled.manifest).toMatchObject({ animated: true, timeMs: 25 });
  });

  it("keeps non-target Text SVG bytes unchanged in a mixed scene", () => {
    const buildScene = (animateUnits: boolean) =>
      createElement(
        "Canvas",
        { width: 320, height: 120 },
        createElement(
          "Flex",
          { direction: "column" },
          createElement(
            "Text",
            {
              id: "optional-units",
              font: "NotoSansJP",
              fontSizePx: 28,
              ...(animateUnits
                ? { animateUnits: { by: "cluster" as const, animation: UNIT_TRACK } }
                : {}),
            },
            "ANIMATED",
          ),
          createElement(
            "Text",
            { id: "plain-neighbor", font: "NotoSansJP", fontSizePx: 28 },
            "PLAIN",
          ),
        ),
      );
    const animatedSvg = engine.renderToSvg(buildScene(true), { timeMs: 25 });
    const plainSvg = engine.renderToSvg(buildScene(false), { timeMs: 25 });

    expect(extractTextGroup(animatedSvg, "PLAIN")).toBe(extractTextGroup(plainSvg, "PLAIN"));
  });

  it("warns above the unit threshold and fails before outlines above the hard limit", () => {
    const warnings: string[] = [];
    const warningScene = createElement(
      "Canvas",
      { width: 40_000, height: 40 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 16,
          wrap: "none",
          animateUnits: { by: "cluster", animation: UNIT_TRACK },
        },
        "A".repeat(1_025),
      ),
    );
    engine.renderToSvg(warningScene, {
      timeMs: 0,
      onWarning: (warning) => warnings.push(warning.code),
    });
    expect(warnings).toEqual(["TEXT_ANIMATION_UNIT_COUNT_HIGH"]);

    const irWarnings: string[] = [];
    engine.renderToIR(warningScene, {
      onWarning: (warning) => irWarnings.push(warning.code),
    });
    expect(irWarnings).toEqual(["TEXT_ANIMATION_UNIT_COUNT_HIGH"]);

    const outlineWarnings: string[] = [];
    engine.renderToTextOutlines(warningScene, {
      onWarning: (warning) => outlineWarnings.push(warning.code),
    });
    expect(outlineWarnings).toEqual(["TEXT_ANIMATION_UNIT_COUNT_HIGH"]);

    const compiledWarnings: string[] = [];
    const warningCompiled = engine.compile(warningScene);
    engine.renderCompiledToSvg(warningCompiled, {
      timeMs: 0,
      onWarning: (warning) => compiledWarnings.push(warning.code),
    });
    expect(compiledWarnings).toEqual(["TEXT_ANIMATION_UNIT_COUNT_HIGH"]);

    const compiledOutlineWarnings: string[] = [];
    engine.renderCompiledToTextOutlines(warningCompiled, {
      onWarning: (warning) => compiledOutlineWarnings.push(warning.code),
    });
    expect(compiledOutlineWarnings).toEqual(["TEXT_ANIMATION_UNIT_COUNT_HIGH"]);

    const preparedWarnings: string[] = [];
    const preparedFrames = [
      ...engine.renderFrames(warningScene, {
        timesMs: [0, 100],
        format: "svg",
        onWarning: (warning) => preparedWarnings.push(warning.code),
      }),
    ];
    expect(preparedFrames).toHaveLength(2);
    expect(preparedWarnings).toEqual(["TEXT_ANIMATION_UNIT_COUNT_HIGH"]);

    const atWarningThresholdScene = createElement(
      "Canvas",
      { width: 40_000, height: 40 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 16,
          wrap: "none",
          animateUnits: { by: "cluster", animation: UNIT_TRACK },
        },
        "A".repeat(1_024),
      ),
    );
    expect(
      engine.renderToIR(atWarningThresholdScene).warnings.map((warning) => warning.code),
    ).not.toContain("TEXT_ANIMATION_UNIT_COUNT_HIGH");

    const atLimitScene = createElement(
      "Canvas",
      { width: 160_000, height: 40 },
      createElement(
        "Text",
        {
          id: "at-unit-limit",
          font: "NotoSansJP",
          fontSizePx: 16,
          wrap: "none",
          animateUnits: { by: "cluster", animation: UNIT_TRACK },
        },
        "A".repeat(4_096),
      ),
    );
    expect(
      findText(engine.renderToIR(atLimitScene).root, "at-unit-limit").unitMap?.units,
    ).toHaveLength(4_096);

    const oversizedScene = createElement(
      "Canvas",
      { width: 160_000, height: 40 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 16,
          wrap: "none",
          animateUnits: { by: "cluster", animation: UNIT_TRACK },
        },
        "A".repeat(4_097),
      ),
    );
    let caught: unknown;
    try {
      engine.renderToIR(oversizedScene);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FatalError);
    expect(caught).toMatchObject({
      code: "TEXT_ANIMATION_UNIT_LIMIT_EXCEEDED",
      stage: "layout",
    });
  });

  it("delivers fragment warnings and fatal limits through the Engine boundary", () => {
    const textShadows = Array.from({ length: 7 }, (_, index) => ({
      dx: index,
      dy: index,
      blurPx: 0,
      color: "#000000",
    }));
    const buildScene = (unitCount: number) =>
      createElement(
        "Canvas",
        { width: 80_000, height: 40 },
        createElement(
          "Text",
          {
            id: "fragment-budget",
            font: "NotoSansJP",
            fontSizePx: 16,
            wrap: "none",
            textShadows,
            animateUnits: { by: "cluster", animation: UNIT_TRACK },
          },
          "A".repeat(unitCount),
        ),
      );

    const warnings: string[] = [];
    const atWarningThreshold = engine.renderToIR(buildScene(256));
    expect(atWarningThreshold.warnings.map((warning) => warning.code)).not.toContain(
      "TEXT_ANIMATION_FRAGMENT_COUNT_HIGH",
    );
    engine.renderToSvg(buildScene(257), {
      timeMs: 0,
      onWarning: (warning) => warnings.push(warning.code),
    });
    expect(warnings).toContain("TEXT_ANIMATION_FRAGMENT_COUNT_HIGH");

    const compiledWarnings: string[] = [];
    const warningScene = buildScene(257);
    engine.renderCompiledToSvg(engine.compile(warningScene), {
      timeMs: 0,
      onWarning: (warning) => compiledWarnings.push(warning.code),
    });
    expect(compiledWarnings).toEqual(["TEXT_ANIMATION_FRAGMENT_COUNT_HIGH"]);

    const preparedWarnings: string[] = [];
    const preparedFrames = [
      ...engine.renderFrames(warningScene, {
        timesMs: [0, 100],
        format: "svg",
        onWarning: (warning) => preparedWarnings.push(warning.code),
      }),
    ];
    expect(preparedFrames).toHaveLength(2);
    expect(preparedWarnings).toEqual(["TEXT_ANIMATION_FRAGMENT_COUNT_HIGH"]);

    expect(
      findText(engine.renderToIR(buildScene(1_024)).root, "fragment-budget").unitMap?.units,
    ).toHaveLength(1_024);

    let caught: unknown;
    try {
      engine.renderToIR(buildScene(1_025));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FatalError);
    expect(caught).toMatchObject({
      code: "TEXT_ANIMATION_FRAGMENT_LIMIT_EXCEEDED",
      stage: "emit",
    });
  });
  it("emits one spring linear() rule per animated unit", () => {
    // Spring on a unit track duplicates the whole 65-stop list per unit,
    // because every unit gets its own rule. The guide documents that cost, so
    // pin the multiplier rather than leaving it to prose.
    const scene = createElement(
      "Canvas",
      { width: 240, height: 100 },
      createElement(
        "Text",
        {
          id: "spring-units",
          font: "NotoSansJP",
          fontSizePx: 40,
          color: "#ffffff",
          animateUnits: {
            by: "cluster" as const,
            delayStepMs: 50,
            animation: { ...UNIT_TRACK, easing: { type: "spring" as const, stiffness: 170 } },
          },
        },
        "AB",
      ),
    );
    const svg = engine.renderToAnimatedSvg(scene, { playback: { mode: "independent" }, timeMs: 0 });
    const linearRules = svg.match(/animation-timing-function: linear\(/g) ?? [];
    const unitCount = findText(engine.renderToIR(scene).root, "spring-units").unitMap?.units.length;

    expect(unitCount).toBe(2);
    expect(linearRules).toHaveLength(unitCount ?? 0);
  });

  it("staggers spring units without changing the curve between them", () => {
    const scene = createElement(
      "Canvas",
      { width: 240, height: 100 },
      createElement(
        "Text",
        {
          id: "spring-stagger",
          font: "NotoSansJP",
          fontSizePx: 40,
          color: "#ffffff",
          animateUnits: {
            by: "cluster" as const,
            delayStepMs: 50,
            animation: { ...UNIT_TRACK, easing: { type: "spring" as const, stiffness: 170 } },
          },
        },
        "AB",
      ),
    );
    const svg = engine.renderToAnimatedSvg(scene, { playback: { mode: "independent" }, timeMs: 0 });
    const curves = [...svg.matchAll(/animation-timing-function: (linear\([^)]*\));/g)].map(
      (match) => match[1],
    );
    const delays = [...svg.matchAll(/animation-delay: (-?[\d.]+)ms;/g)].map((match) => match[1]);

    // Same segment duration for every unit, so the curve is shared; only the
    // delay differs, which is what delayStepMs is supposed to move.
    expect(new Set(curves).size).toBe(1);
    expect(delays).toEqual(["0", "50"]);
  });
});
