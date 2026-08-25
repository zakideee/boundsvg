import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEngineAsync, type Engine } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CJK_VARFONT_ALIAS,
  FONT_ALIAS,
  JETBRAINS_ALIAS,
  MONASPACE_ALIAS,
  VARFONT_ALIAS,
} from "../src/config";
import { presets } from "../src/presets/index";

/** Presets that exercise distinct text-layout entry paths in the render smoke test. */
const representativePresets = [
  "fit",
  "text-on-path-basics",
  "vertical",
  "vertical-rich-ellipsis",
] as const;

function font(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(__dirname, "../../../fixtures/fonts", filename)));
}

function findTextNodes(node: {
  type: string;
  writingMode?: string;
  lineHeightPx?: number;
  fontSizePx?: number;
  textLayoutKind?: string;
  sourceText?: string;
  displayText?: string;
  textPath?: {
    textAnchor: string;
    pathFit: string;
    pathOverflow: string;
  };
  glyphPaths?: Array<{ text: string }>;
  children?: unknown[];
}): Array<{
  type: string;
  writingMode?: string;
  lineHeightPx?: number;
  fontSizePx?: number;
  textLayoutKind?: string;
  sourceText?: string;
  displayText?: string;
  textPath?: {
    textAnchor: string;
    pathFit: string;
    pathOverflow: string;
  };
  glyphPaths?: Array<{ text: string }>;
  children?: unknown[];
}> {
  const nodes = node.type === "text" ? [node] : [];
  for (const child of node.children ?? []) {
    nodes.push(...findTextNodes(child as Parameters<typeof findTextNodes>[0]));
  }
  return nodes;
}

describe("playground-core public preset smoke", () => {
  let engine: Engine;

  beforeAll(async () => {
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        {
          alias: FONT_ALIAS,
          weight: 400,
          style: "normal",
          data: font("NotoSansJP-Regular.subset.woff2"),
        },
        { alias: VARFONT_ALIAS, weight: 400, style: "normal", data: font("Inter-Variable.ttf") },
        {
          alias: CJK_VARFONT_ALIAS,
          weight: 400,
          style: "normal",
          data: font("NotoSansCJKjp-VF.subset.ttf"),
        },
        {
          alias: JETBRAINS_ALIAS,
          weight: 400,
          style: "normal",
          data: font("JetBrainsMono-Regular.woff2"),
        },
        {
          alias: MONASPACE_ALIAS,
          weight: 400,
          style: "normal",
          data: font("MonaspaceNeon-Regular.woff2"),
        },
      ],
    });
  });

  for (const presetKey of representativePresets) {
    it(`renders the ${presetKey} representative to SVG and PNG`, () => {
      const vnode = presets[presetKey].build(engine);
      const { svg, ir } = engine.renderToSvgAndIR(vnode, {
        showMissingGlyphs: true,
        textPathMode: "merged",
      });
      const png = engine.renderToPng(vnode, {
        showMissingGlyphs: true,
        textPathMode: "merged",
      });

      expect(svg).toContain("<svg");
      expect(png.byteLength).toBeGreaterThan(100);
      expect(ir.drawOrder.length).toBeGreaterThan(0);
    });
  }

  it("keeps vertical preset columns separated", () => {
    const outlines = engine.renderToTextOutlines(presets.vertical.build(engine), {
      showMissingGlyphs: true,
      textPathMode: "glyphs",
    });
    const verticalNodes = outlines.filter((node) => node.writingMode === "vertical-rl");
    const distinctColumnCenters = new Set(
      verticalNodes
        .flatMap((node) => node.paths)
        .map((path) => Math.round(path.bbox.x + path.bbox.w / 2)),
    );

    expect(verticalNodes.length).toBeGreaterThan(0);
    expect(distinctColumnCenters.size).toBeGreaterThan(4);
  });

  it("keeps the fit preset inside its declared font-size bounds", () => {
    const textNodes = findTextNodes(engine.renderToIR(presets.fit.build(engine)).root);
    const fittedText = textNodes.find((node) => node.fontSizePx !== undefined);

    expect(fittedText).toBeDefined();
    expect(fittedText!.fontSizePx).toBeGreaterThanOrEqual(18);
    expect(fittedText!.fontSizePx).toBeLessThan(64);
  });

  it("retains path-layout semantics and resolved glyph outlines", () => {
    const { ir } = engine.renderToSvgAndIR(presets["text-on-path-basics"].build(engine), {
      textPathMode: "merged",
    });
    const pathTextNodes = findTextNodes(ir.root).filter((node) => node.textLayoutKind === "path");

    expect(pathTextNodes).toHaveLength(4);
    expect(pathTextNodes.map((node) => node.textPath?.textAnchor)).toEqual([
      "start",
      "middle",
      "end",
      "start",
    ]);
    expect(pathTextNodes.map((node) => node.sourceText)).toEqual([
      "START OFFSET",
      "CURVED TYPE",
      "円弧の日本語",
      "LEADING GLYPHS ARE HIDDEN BUT LOGICAL TEXT REMAINS",
    ]);
    expect(pathTextNodes.every((node) => (node.glyphPaths?.length ?? 0) > 0)).toBe(true);
    expect(pathTextNodes[3]?.textPath?.pathOverflow).toBe("hidden");
  });

  it("stores sane vertical lineHeightPx in rendered IR", () => {
    const textNodes = findTextNodes(engine.renderToIR(presets.vertical.build(engine)).root);
    const verticalText = textNodes.find((node) => node.writingMode === "vertical-rl");

    expect(verticalText).toBeDefined();
    expect(verticalText!.lineHeightPx).toBeGreaterThan(20);
    expect(verticalText!.lineHeightPx).toBeLessThan(60);
  });

  it("renders the vertical rich preset with a synthetic ellipsis", () => {
    const textNodes = findTextNodes(
      engine.renderToIR(presets["vertical-rich-ellipsis"].build(engine)).root,
    );
    const verticalText = textNodes.find((node) => node.writingMode === "vertical-rl");

    expect(verticalText?.sourceText).toContain("省略された末尾の装飾や警告");
    expect(verticalText?.displayText).toMatch(/…$/u);
    expect(verticalText?.displayText).not.toContain("警告");
  });
});
