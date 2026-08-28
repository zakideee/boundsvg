import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Canvas,
  createEngineAsync,
  type Engine,
  type IRNode,
  type IRTextNode,
  TextOnPath,
} from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { findVNodeById } from "@boundsvg/core/vnode";
import { beforeAll, describe, expect, it } from "vitest";
import { FONT_ALIAS, JETBRAINS_ALIAS } from "../src/config";
import { PRESET_GROUPS } from "../src/presets/groups";
import { presets } from "../src/presets/index";

function font(path: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(__dirname, "../../../fixtures/fonts", path)));
}

function collectTextNodes(node: IRNode): IRTextNode[] {
  const textNodes = node.type === "text" ? [node] : [];
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      textNodes.push(...collectTextNodes(child));
    }
  }
  return textNodes;
}

describe("text motion playground presets", () => {
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
        {
          alias: JETBRAINS_ALIAS,
          weight: 400,
          style: "normal",
          data: font("JetBrainsMono-Regular.woff2"),
        },
      ],
    });
  });

  it("keeps the five samples together in the Text Motion group", () => {
    const textMotionGroup = PRESET_GROUPS.find((group) => group.key === "text-motion");

    expect(textMotionGroup?.label).toBe("Text Motion");
    expect(textMotionGroup?.presetKeys).toEqual([
      "typing-ime-timeline",
      "text-on-path-basics",
      "decoration-path-fit",
      "rich-text-on-path",
      "text-path-motion",
    ]);
  });

  it("renders eight terminal/IME snapshots with composition and diagnostics", () => {
    const preset = presets["typing-ime-timeline"]!;
    const { svg, ir } = engine.renderToAnimatedSvgAndIR(preset.build(engine), {
      playback: { mode: "independent" },
    });
    const timelineNodes = collectTextNodes(ir.root).filter((node) =>
      node.nodeId.startsWith("timeline-"),
    );
    const compositionNodes = timelineNodes.filter(
      (node) => (node.textDecorations?.length ?? 0) > 0,
    );

    expect(timelineNodes.map((node) => node.nodeId)).toEqual([
      "timeline-terminal-0",
      "timeline-terminal-240",
      "timeline-terminal-480",
      "timeline-terminal-720",
      "timeline-ime-0",
      "timeline-ime-240",
      "timeline-ime-480",
      "timeline-ime-720",
    ]);
    expect(compositionNodes.map((node) => node.nodeId)).toEqual([
      "timeline-ime-240",
      "timeline-ime-480",
    ]);
    expect(svg).toContain("steps(2, jump-none)");
    expect(preset.source).toContain("svgBytes");
    expect(preset.source).toContain("authored state");
  });

  it("covers straight, cubic, arc, effects, and hidden path overflow", () => {
    const preset = presets["text-on-path-basics"]!;
    const vnode = preset.build(engine);
    const { svg, ir } = engine.renderToSvgAndIR(vnode, { timeMs: 0 });
    const pathTextNodes = collectTextNodes(ir.root).filter(
      (node) => node.textLayoutKind === "path",
    );

    expect(pathTextNodes.map((node) => node.nodeId)).toEqual([
      "path-basics-straight",
      "path-basics-cubic",
      "path-basics-arc",
      "path-basics-overflow-hidden",
    ]);
    const [straight, cubic, arc, hidden] = pathTextNodes;
    expect(straight?.lines[0]?.positionedGlyphs?.length).toBeGreaterThan(0);
    expect(
      straight?.lines[0]?.positionedGlyphs?.every(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) < 0.001,
      ),
    ).toBe(true);
    for (const curved of [cubic, arc]) {
      expect(
        curved?.lines[0]?.positionedGlyphs?.some(
          (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
        ),
      ).toBe(true);
    }

    const anchorBbox = (nodeId: string, textAnchor: "start" | "middle" | "end") => {
      const pathVNode = findVNodeById(vnode, nodeId);
      expect(pathVNode?.type).toBe("TextOnPath");
      if (pathVNode?.type === "TextOnPath") {
        const anchorScene = Canvas(
          { width: 960, height: 540 },
          TextOnPath(
            { ...pathVNode.props, textAnchor, pathOverflow: "hidden" },
            ...pathVNode.children,
          ),
        );
        return collectTextNodes(engine.renderToIR(anchorScene).root).find(
          (node) => node.nodeId === pathVNode.props.id,
        )?.bbox;
      }
      return undefined;
    };
    for (const [pathNode, nodeId, leadingAnchor, trailingAnchor, selectedAnchor] of [
      [straight, "path-basics-straight", "start", "middle", "start"],
      [cubic, "path-basics-cubic", "middle", "end", "middle"],
      [arc, "path-basics-arc", "middle", "end", "end"],
    ] as const) {
      const leadingBbox = anchorBbox(nodeId, leadingAnchor);
      const trailingBbox = anchorBbox(nodeId, trailingAnchor);
      expect(leadingBbox).toBeDefined();
      expect(trailingBbox).toBeDefined();
      expect(leadingBbox?.x).toBeGreaterThan(trailingBbox?.x ?? Number.POSITIVE_INFINITY);
      expect(pathNode?.bbox).toEqual(selectedAnchor === leadingAnchor ? leadingBbox : trailingBbox);
    }

    const shapedGlyphs = hidden?.lines[0]?.glyphs ?? [];
    const positionedGlyphs = hidden?.lines[0]?.positionedGlyphs ?? [];
    expect(hidden?.sourceText).toBe("LEADING GLYPHS ARE HIDDEN BUT LOGICAL TEXT REMAINS");
    expect(hidden?.displayText).toBe(hidden?.sourceText);
    expect(positionedGlyphs.length).toBeLessThan(shapedGlyphs.length);
    expect(positionedGlyphs[0]?.sourceStart).toBeGreaterThan(0);
    expect(pathTextNodes[1]?.strokes).toHaveLength(2);
    expect(pathTextNodes[1]?.shadows).toHaveLength(1);
    expect(svg).not.toContain("<textPath");
    expect(preset.source).toContain('pathOverflow: "error"');
  });

  it("shows V2 decoration, closed traversal, fitting, and ellipsis without widening scope", () => {
    const preset = presets["decoration-path-fit"]!;
    const vnode = preset.build(engine);
    const svg = engine.renderToSvg(vnode, { timeMs: 0 });
    const ir = engine.renderToIR(vnode);
    const textNodes = collectTextNodes(ir.root);
    const decorationNodes = textNodes.filter((node) => node.nodeId.startsWith("path-decoration-"));
    const pathTextNodes = textNodes.filter((node) => node.textLayoutKind === "path");
    const closedNodes = pathTextNodes.filter((node) => node.nodeId.startsWith("closed-path-"));
    const fitNodes = pathTextNodes.filter((node) => node.nodeId.startsWith("path-fit-"));
    expect(fitNodes.map((node) => node.nodeId)).toEqual([
      "path-fit-spacing",
      "path-fit-scale",
      "path-fit-shrink",
      "path-fit-ellipsis",
    ]);

    expect(decorationNodes.map((node) => node.textDecorations?.[0]?.style)).toEqual([
      "dotted",
      "dotted",
      "dashed",
      "dashed",
      "wavy",
      "wavy",
    ]);
    for (const style of ["dotted", "dashed", "wavy"] as const) {
      const authored = findVNodeById(vnode, `path-decoration-${style}-all`);
      expect(authored?.type).toBe("Text");
      if (authored?.type === "Text") {
        expect(authored.props.textDecoration).toEqual(
          expect.objectContaining({ style, skipInk: "all" }),
        );
      }
      const plain = decorationNodes.find((node) => node.nodeId === `path-decoration-${style}-none`);
      const skipped = decorationNodes.find(
        (node) => node.nodeId === `path-decoration-${style}-all`,
      );
      expect(skipped?.textDecorations?.[0]?.paths).not.toEqual(plain?.textDecorations?.[0]?.paths);
    }
    expect(closedNodes.map((node) => node.textPath)).toEqual([
      expect.objectContaining({
        pathDirection: "forward",
        pathNormal: "left",
        pathOffsetPx: 8,
        startOffsetPx: 180,
      }),
      expect.objectContaining({
        pathDirection: "reverse",
        pathNormal: "right",
        startOffsetPx: 880,
      }),
    ]);
    expect(closedNodes.every((node) => node.textPath?.d.endsWith("Z"))).toBe(true);
    const [spacing, scale, shrink, ellipsis] = fitNodes;
    const fittedPathLength = 204 - 12;
    for (const fitted of [spacing, scale, shrink]) {
      expect(fitted?.lines[0]?.width).toBeCloseTo(fittedPathLength, 9);
      expect(fitted?.lines[0]?.positionedGlyphs).toHaveLength(fitted?.lines[0]?.glyphs.length);
    }
    const spacingGlyphs = spacing?.lines[0]?.positionedGlyphs ?? [];
    expect(spacingGlyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0)).toBeCloseTo(
      fittedPathLength,
      9,
    );
    expect(spacingGlyphs.every((glyph) => glyph.inlineScale === undefined)).toBe(true);
    expect(scale?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) > 1)).toBe(
      true,
    );
    expect(shrink?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) < 1)).toBe(
      true,
    );
    expect(ellipsis?.sourceText).toBe("ELLIPSIS PRESERVES SOURCE");
    expect(ellipsis?.displayText).toMatch(/…$/u);
    expect(ellipsis?.lines[0]?.positionedGlyphs?.at(-1)?.syntheticKind).toBe("ellipsis");
    for (const textNode of [...decorationNodes, ...pathTextNodes]) {
      expect(textNode.bbox.x).toBeGreaterThanOrEqual(0);
      expect(textNode.bbox.y).toBeGreaterThanOrEqual(0);
      expect(textNode.bbox.x + textNode.bbox.w).toBeLessThanOrEqual(960);
      expect(textNode.bbox.y + textNode.bbox.h).toBeLessThanOrEqual(710);
    }
    expect(svg).not.toContain("<textPath");
    expect(preset.source).toContain("Rich Inline path text");
    expect(preset.description).toContain("explicit capability boundaries");
  });

  it("shows rich path identity, curved decoration, and materialized frames", () => {
    const preset = presets["rich-text-on-path"]!;
    const vnode = preset.build(engine);
    const { svg, ir } = engine.renderToSvgAndIR(vnode, { timeMs: 0 });
    const textNodes = collectTextNodes(ir.root);
    const plain = textNodes.find((node) => node.nodeId === "path-identity-plain");
    const singleInline = textNodes.find((node) => node.nodeId === "path-identity-inline");
    const mixed = textNodes.find((node) => node.nodeId === "rich-path-mixed");
    const decorated = textNodes.find((node) => node.nodeId === "rich-path-decorated-closed");
    const a2Frames = textNodes.filter((node) => node.nodeId.startsWith("materialized-path-frame-"));
    const shapingIdentity = (node: IRTextNode | undefined) =>
      node?.lines[0]?.positionedGlyphs?.map((glyph) => ({
        glyphId: glyph.glyphId,
        sourceStart: glyph.sourceStart,
        sourceEnd: glyph.sourceEnd,
        xAdvance: glyph.xAdvance,
        fontAlias: glyph.fontAlias,
        rotation: glyph.baselineRotationDeg,
      }));

    expect(plain?.sourceText).toBe("Shaping fidelity 日本語");
    expect(singleInline?.sourceText).toBe(plain?.sourceText);
    expect(singleInline?.displayText).toBe(plain?.displayText);
    expect(singleInline?.unitMap).toEqual(plain?.unitMap);
    expect(shapingIdentity(singleInline)).toEqual(shapingIdentity(plain));

    expect(new Set(mixed?.lines[0]?.positionedGlyphs?.map((glyph) => glyph.fontAlias))).toEqual(
      new Set([FONT_ALIAS, JETBRAINS_ALIAS]),
    );
    expect(mixed?.lines[0]?.positionedGlyphs?.some((glyph) => glyph.fill === "#f0abfc")).toBe(true);
    expect(
      mixed?.lines[0]?.positionedGlyphs?.some(
        (glyph) => glyph.textStrokes?.[0]?.color === "#92400e",
      ),
    ).toBe(true);

    expect(decorated?.textPath).toEqual(
      expect.objectContaining({
        pathDirection: "reverse",
        pathNormal: "right",
        pathFit: "scale",
      }),
    );
    expect(decorated?.textPath?.d.endsWith("Z")).toBe(true);
    expect(decorated?.textDecorations?.map(({ style, skipInk }) => [style, skipInk])).toEqual([
      ["dashed", "all"],
      ["wavy", "all"],
    ]);
    expect(decorated?.lines[0]?.positionedGlyphs?.length).toBeGreaterThan(0);
    expect(
      decorated?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) > 1),
    ).toBe(true);
    // `scale` fit stretches the clusters to the whole path length, so text that is
    // far shorter than the path silently demands a double-digit inline scale.
    expect(
      decorated?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) < 2),
    ).toBe(true);
    // The sample must stay inside its own card.
    expect(decorated?.bbox.x).toBeGreaterThanOrEqual(480);
    expect(decorated?.bbox.y).toBeGreaterThanOrEqual(252);
    expect((decorated?.bbox.x ?? 0) + (decorated?.bbox.w ?? 0)).toBeLessThanOrEqual(1016);
    expect((decorated?.bbox.y ?? 0) + (decorated?.bbox.h ?? 0)).toBeLessThanOrEqual(466);
    expect(decorated?.textDecorations?.every((fragment) => fragment.paths.length > 0)).toBe(true);
    expect(decorated?.unitAnimation).toBeUndefined();

    expect(a2Frames.map((node) => node.textPath?.d)).toEqual([
      "M12 92L260 92",
      "M12 112C70 20 202 20 260 112",
      "M260 104A124 70 0 0 0 12 104",
    ]);
    expect(a2Frames.map((node) => node.textPath?.pathFit)).toEqual(["none", "spacing", "shrink"]);
    expect(a2Frames.map((node) => node.textPath?.pathDirection)).toEqual([
      "forward",
      "forward",
      "reverse",
    ]);
    expect(a2Frames.every((node) => node.unitAnimation?.by === "cluster")).toBe(true);
    expect(a2Frames.every((node) => (node.textDecorations?.length ?? 0) === 0)).toBe(true);
    expect(new Set(a2Frames.map((node) => node.sourceText)).size).toBe(3);
    const a2Poses = a2Frames.map((node) =>
      JSON.stringify(
        node.lines[0]?.positionedGlyphs?.map((glyph) => ({
          originX: glyph.originX,
          originY: glyph.originY,
          baselineRotationDeg: glyph.baselineRotationDeg,
          inlineScale: glyph.inlineScale,
        })),
      ),
    );
    expect(new Set(a2Poses).size).toBe(3);
    expect(
      a2Frames[0]?.lines[0]?.positionedGlyphs?.every(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) < 0.001,
      ),
    ).toBe(true);
    for (const curvedFrame of a2Frames.slice(1)) {
      expect(
        curvedFrame.lines[0]?.positionedGlyphs?.some(
          (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
        ),
      ).toBe(true);
    }

    for (const textNode of [plain, singleInline, mixed, decorated, ...a2Frames]) {
      expect(textNode).toBeDefined();
      expect(textNode?.bbox.x).toBeGreaterThanOrEqual(0);
      expect(textNode?.bbox.y).toBeGreaterThanOrEqual(0);
      expect((textNode?.bbox.x ?? 0) + (textNode?.bbox.w ?? 0)).toBeLessThanOrEqual(1024);
      expect((textNode?.bbox.y ?? 0) + (textNode?.bbox.h ?? 0)).toBeLessThanOrEqual(740);
    }
    expect(svg).not.toContain("<textPath");
    expect(preset.source).toContain("animateUnits requires effective decoration to be absent");
    expect(preset.description).toContain("downstream-materialized checkpoints");
  });

  it("shows materialized path geometry instead of a native layout channel", () => {
    const preset = presets["text-path-motion"]!;
    const ir = engine.renderToIR(preset.build(engine));
    const pathTextNodes = collectTextNodes(ir.root).filter((node) =>
      node.nodeId.startsWith("materialized-path-frame-"),
    );

    expect(pathTextNodes.map((node) => node.nodeId)).toEqual([
      "materialized-path-frame-0",
      "materialized-path-frame-1",
      "materialized-path-frame-2",
    ]);
    expect(pathTextNodes.map((node) => node.textPath?.d)).toEqual([
      "M16 110L264 110",
      "M16 146C70 24 210 24 264 146",
      "M264 120A124 68 0 0 0 16 120",
    ]);
    expect(pathTextNodes.map((node) => node.textPath?.startOffsetPx)).toEqual([76, 142, 194]);
    expect(new Set(pathTextNodes.map((node) => node.textPath?.d)).size).toBe(3);
    expect(pathTextNodes.every((node) => node.unitAnimation?.by === "cluster")).toBe(true);
    const positionedPoses = pathTextNodes.map((node) =>
      JSON.stringify(
        node.lines[0]?.positionedGlyphs?.map((glyph) => ({
          originX: glyph.originX,
          originY: glyph.originY,
          baselineRotationDeg: glyph.baselineRotationDeg,
        })),
      ),
    );
    expect(new Set(positionedPoses).size).toBe(3);
    expect(
      pathTextNodes[0]?.lines[0]?.positionedGlyphs?.every(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) < 0.001,
      ),
    ).toBe(true);
    for (const curvedFrame of pathTextNodes.slice(1)) {
      expect(
        curvedFrame.lines[0]?.positionedGlyphs?.some(
          (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
        ),
      ).toBe(true);
    }
    expect(preset.source).toContain("Rebuild the scene with authored geometry");
    expect(preset.description).toContain("state reconstruction from native opacity/transform");
  });
});
