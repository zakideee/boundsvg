/**
 * Conformance IR structure assertions rendered through the real WASM engine.
 * Prerequisite: `pnpm build:wasm`.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { IR, IRNode } from "../../src/ir/types.js";
import { validateNodeIds } from "../../src/node-ids.js";
import { parsePathBBox } from "../../src/path/utils.js";
import { buildHitTestIndex, hitTestWithIndex } from "../../src/scene.js";
import type { VNode } from "../../src/vnode/types.js";
import { createConformanceEngine } from "./conformance-engine.js";
import { FONT_LATIN } from "./scenes/assets.js";
import { CONFORMANCE_SCENES, type ConformanceScene } from "./scenes/index.js";

const EXPLICIT_IDS_MIN = 5;
/** Sub-pixel slack for measured text blocks against the canvas edge. */
const BBOX_EPSILON_PX = 1;

function collectExplicitIds(vnode: VNode): string[] {
  const ids: string[] = [];
  const stack: VNode[] = [vnode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      continue;
    }
    const explicitId = (node.props as { id?: string }).id;
    if (explicitId) {
      ids.push(explicitId);
    }
    for (const child of node.children) {
      if (typeof child === "object" && child !== null) {
        stack.push(child as VNode);
      }
    }
  }
  return ids;
}

function collectIRNodes(ir: IR): IRNode[] {
  const nodes: IRNode[] = [];
  const stack: IRNode[] = [ir.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    nodes.push(node);
    for (const child of node.children ?? []) {
      stack.push(child);
    }
  }
  return nodes;
}

/** An explicit VNode id appears in the IR either verbatim or as a derived paint node (`id:bg` etc.). */
function hasIRNodeForId(nodes: IRNode[], id: string): boolean {
  return nodes.some((node) => node.nodeId === id || node.nodeId.startsWith(`${id}:`));
}

describe("conformance IR structure", () => {
  let engine: Engine;
  const irById = new Map<string, IR>();

  beforeAll(async () => {
    engine = await createConformanceEngine();
    for (const scene of CONFORMANCE_SCENES) {
      irById.set(scene.id, engine.renderToIR(scene.build(), scene.renderOptions));
    }
  });

  function irFor(scene: ConformanceScene): IR {
    const ir = irById.get(scene.id);
    if (!ir) {
      throw new Error(`IR missing for scene ${scene.id}`);
    }
    return ir;
  }

  const cases = CONFORMANCE_SCENES.map((scene) => [scene.id, scene] as const);

  it.each(cases)("%s carries unique stable node ids", (_id, scene) => {
    const validation = validateNodeIds(scene.build());
    expect(validation.valid, JSON.stringify(validation.duplicates)).toBe(true);
  });

  it.each(cases)("%s exposes its explicit node ids in the IR", (_id, scene) => {
    const explicitIds = collectExplicitIds(scene.build());
    expect(explicitIds.length).toBeGreaterThanOrEqual(EXPLICIT_IDS_MIN);

    const nodes = collectIRNodes(irFor(scene));
    for (const explicitId of explicitIds) {
      expect(hasIRNodeForId(nodes, explicitId), `id "${explicitId}" missing from IR`).toBe(true);
    }
  });

  it.each(cases)("%s keeps every node bbox inside the canvas", (_id, scene) => {
    const ir = irFor(scene);
    for (const node of collectIRNodes(ir)) {
      const { x, y, w, h } = node.bbox;
      expect(x, `${node.nodeId} x`).toBeGreaterThanOrEqual(-BBOX_EPSILON_PX);
      expect(y, `${node.nodeId} y`).toBeGreaterThanOrEqual(-BBOX_EPSILON_PX);
      expect(x + w, `${node.nodeId} right edge`).toBeLessThanOrEqual(ir.width + BBOX_EPSILON_PX);
      expect(y + h, `${node.nodeId} bottom edge`).toBeLessThanOrEqual(ir.height + BBOX_EPSILON_PX);
    }
  });

  it.each(cases)("%s has a duplicate-free drawOrder that covers all paint nodes", (_id, scene) => {
    const ir = irFor(scene);
    expect(new Set(ir.drawOrder).size).toBe(ir.drawOrder.length);

    const nodeIds = new Set(collectIRNodes(ir).map((node) => node.nodeId));
    for (const drawId of ir.drawOrder) {
      expect(nodeIds.has(drawId), `drawOrder entry "${drawId}" not in IR tree`).toBe(true);
    }

    const drawSet = new Set(ir.drawOrder);
    for (const node of collectIRNodes(ir)) {
      if (node.type !== "group") {
        expect(drawSet.has(node.nodeId), `paint node "${node.nodeId}" missing`).toBe(true);
      }
    }
  });

  it.each(cases)("%s produces no unexpected warnings", (_id, scene) => {
    const allowed = new Set(scene.allowedWarningCodes ?? []);
    const unexpected = irFor(scene).warnings.filter((warning) => !allowed.has(warning.code));
    expect(unexpected.map((warning) => `${warning.code}: ${warning.message}`)).toEqual([]);
  });
});

describe("conformance scene-specific contracts", () => {
  let engine: Engine;

  beforeAll(async () => {
    engine = await createConformanceEngine();
  });

  function sceneById(id: string): ConformanceScene {
    const scene = CONFORMANCE_SCENES.find((entry) => entry.id === id);
    if (!scene) {
      throw new Error(`Scene ${id} not registered`);
    }
    return scene;
  }

  it("native-glyph-selection carries glyph source metadata in the resolved IR", () => {
    const scene = sceneById("native-glyph-selection");
    const { ir } = engine.renderToSvgAndIR(scene.build(), scene.renderOptions);

    const glyphPaths = collectIRNodes(ir).flatMap((node) => node.glyphPaths ?? []);
    expect(glyphPaths.length).toBeGreaterThan(0);

    const contentGlyphs = glyphPaths.filter((path) => path.sourceRole === "content");
    const baseGlyphs = glyphPaths.filter((path) => path.sourceRole === "rubyBase");
    const annotationGlyphs = glyphPaths.filter((path) => path.sourceRole === "rubyAnnotation");
    expect(contentGlyphs.length).toBeGreaterThan(0);
    expect(baseGlyphs.length).toBeGreaterThan(0);
    expect(annotationGlyphs.length).toBeGreaterThan(0);

    for (const glyphPath of glyphPaths) {
      if (glyphPath.sourceStart != null && glyphPath.sourceEnd != null) {
        expect(glyphPath.sourceEnd).toBeGreaterThan(glyphPath.sourceStart);
      }
    }
  });

  it("native-text-decoration resolves mixed-font metrics into separate paint paths", () => {
    const scene = sceneById("native-text-decoration");
    const nodes = collectIRNodes(engine.renderToIR(scene.build()));
    const mixedText = nodes.find(
      (node) => node.nodeId.startsWith("ntd-mixed") && (node.textDecorations?.length ?? 0) > 0,
    );
    const underline = mixedText?.textDecorations?.find((fragment) => fragment.line === "underline");

    expect(underline?.style).toBe("double");
    expect(underline?.paths.length).toBeGreaterThanOrEqual(4);
    expect(new Set(underline?.paths.map((path) => path.originY)).size).toBeGreaterThanOrEqual(2);

    const patternExpectations = [
      ["ntd-order", "dashed"],
      ["ntd-scope", "dotted"],
      ["ntd-vertical", "wavy"],
    ] as const;
    for (const [nodeId, style] of patternExpectations) {
      const patternText = nodes.find(
        (node): node is Extract<IRNode, { type: "text" }> =>
          node.type === "text" && node.nodeId === nodeId,
      );
      expect(patternText?.textDecorations?.some((fragment) => fragment.style === style)).toBe(true);
      expect(patternText?.textDecorations?.some((fragment) => fragment.skipInk === "all")).toBe(
        true,
      );
      expect(patternText?.textDecorations?.every((fragment) => fragment.paths.length > 0)).toBe(
        true,
      );
    }
  });

  it("native-inline-rect keeps generated groups out of source text and orders their paint leaves", () => {
    const scene = sceneById("native-inline-rect");
    const ir = engine.renderToIR(scene.build(), scene.renderOptions);
    const nodes = collectIRNodes(ir);
    const fragments = nodes.filter(
      (node) => node.type === "group" && node.nodeId.includes(":inline-rect:"),
    );
    const horizontalText = nodes.find(
      (node) => node.type === "text" && node.nodeId === "nir-horizontal",
    );
    const verticalRect = nodes.find((node) => node.nodeId === "nir-vertical:inline-rect:0");

    expect(fragments).toHaveLength(6);
    for (const fragment of fragments) {
      expect(ir.drawOrder).not.toContain(fragment.nodeId);
      expect(ir.drawOrder).toContain(`${fragment.nodeId}:rect`);
    }
    expect(horizontalText?.lines?.map((line) => line.text).join("")).toBe("typed block underline");
    expect(verticalRect?.bbox).toMatchObject({ w: 4, h: 18 });
  });

  it("native-typing-composition resolves terminal, IME, vertical, and cluster fixtures", () => {
    const scene = sceneById("native-typing-composition");
    const nodes = collectIRNodes(engine.renderToIR(scene.build(), scene.renderOptions));
    const textById = (nodeId: string) =>
      nodes.find(
        (node): node is Extract<IRNode, { type: "text" }> =>
          node.type === "text" && node.nodeId === nodeId,
      );
    const terminal = textById("ntc-terminal");
    const hiragana = textById("ntc-ime-hiragana");
    const converted = textById("ntc-ime-converted");
    const committed = textById("ntc-ime-commit");
    const vertical = textById("ntc-vertical");
    const clusterPlain = textById("ntc-cluster-plain");
    const clusterDecorated = textById("ntc-cluster-decorated");
    const terminalCaret = nodes.find((node) => node.nodeId === "ntc-terminal:inline-rect:0");
    const verticalCaret = nodes.find((node) => node.nodeId === "ntc-vertical:inline-rect:0");

    expect(terminal?.lines.length).toBeGreaterThan(1);
    expect(terminalCaret?.bbox).toMatchObject({ w: 2, h: 25 });
    expect(terminalCaret?.type === "group" ? terminalCaret.opacity : undefined).toBe(0);
    expect(hiragana?.textDecorations).toEqual([
      expect.objectContaining({ line: "underline", style: "solid" }),
    ]);
    expect(converted?.textDecorations).toEqual([
      expect.objectContaining({ line: "underline", style: "double" }),
    ]);
    expect(committed?.textDecorations ?? []).toEqual([]);
    expect(vertical?.textDecorations?.flatMap((fragment) => fragment.paths)).toEqual(
      expect.arrayContaining([expect.objectContaining({ originX: expect.any(Number) })]),
    );
    expect(
      vertical?.textDecorations?.every((fragment) =>
        fragment.paths.every((path) => {
          const bbox = parsePathBBox(path.d);
          return bbox !== null && bbox.maxY - bbox.minY > bbox.maxX - bbox.minX;
        }),
      ),
    ).toBe(true);
    expect(verticalCaret?.bbox).toMatchObject({ w: 3, h: 16 });
    const outlineIdentity = (textNode: typeof clusterPlain) =>
      textNode?.glyphPaths?.map(({ nodeId: _nodeId, ...path }) => path);
    expect(outlineIdentity(clusterDecorated)).toEqual(outlineIdentity(clusterPlain));
    expect(clusterDecorated?.textDecorations).toHaveLength(2);
  });

  it("native-glyph-selection exposes standalone glyph outline output", () => {
    const scene = sceneById("native-glyph-selection");
    const outlines = engine.renderToTextOutlines(scene.build(), scene.renderOptions);

    expect(
      outlines.map(({ nodeId, text, paths }) => ({ nodeId, text, pathCount: paths.length })),
    ).toEqual([
      { nodeId: "ngs-latin", text: "Glyph selection", pathCount: 14 },
      { nodeId: "ngs-ruby", text: "選択可能な文字列を保持する。", pathCount: 18 },
      { nodeId: "ngs-mixed", text: "各グリフが元テキストの位置情報を持つ。", pathCount: 19 },
      {
        nodeId: "ngs-mono",
        text: "sourceStart / sourceEnd / sourceRole",
        pathCount: 32,
      },
    ]);

    const outlinePaths = outlines.flatMap((outline) => outline.paths);
    expect(new Set(outlinePaths.map((path) => path.sourceRole))).toEqual(
      new Set(["content", "rubyBase", "rubyAnnotation"]),
    );
    for (const outline of outlines) {
      expect(outline.bbox.w, `${outline.nodeId} bbox width`).toBeGreaterThan(0);
      expect(outline.bbox.h, `${outline.nodeId} bbox height`).toBeGreaterThan(0);
      expect(outline.bbox.x + outline.bbox.w).toBeLessThanOrEqual(scene.width);
      expect(outline.bbox.y + outline.bbox.h).toBeLessThanOrEqual(scene.height);
      expect(outline.writingMode).toBeUndefined();
      expect(outline.worldTransform).toBeUndefined();
      for (const path of outline.paths) {
        expect(path.nodeId).toBe(outline.nodeId);
        expect(path.d.length).toBeGreaterThan(0);
        expect(path.fill).toMatch(/^#[0-9a-f]{6}$/);
        expect(path.glyphIds.length).toBeGreaterThan(0);
        expect(path.text.length).toBeGreaterThan(0);
        expect(path.bbox.w).toBeGreaterThan(0);
        expect(path.bbox.h).toBeGreaterThan(0);
        expect(path.missingGlyph).toBeUndefined();
        if (path.sourceStart == null || path.sourceEnd == null) {
          throw new Error(`Source range missing for ${path.nodeId}`);
        }
        expect(path.sourceEnd).toBeGreaterThan(path.sourceStart);
      }
    }
  });

  it("native-layered-parts exports its declared layers with arrow parts", () => {
    const scene = sceneById("native-layered-parts");
    const layered = engine.renderToLayeredSvg(scene.build());

    const layerIds = layered.manifest.layers.map((layer) => layer.id);
    for (const expected of ["background", "content", "badge"]) {
      expect(layerIds, `layer "${expected}"`).toContain(expected);
    }

    const badgeLayer = layered.manifest.layers.find((layer) => layer.id === "badge");
    const partIds = (badgeLayer?.parts ?? []).map((part) => part.partId);
    for (const expected of ["tail", "shaft", "head"]) {
      expect(partIds, `arrow part "${expected}"`).toContain(expected);
    }
  });

  it("native-layered-parts keeps handler references on interactive IR nodes", () => {
    const scene = sceneById("native-layered-parts");
    const ir = engine.renderToIR(scene.build());
    const nodes = collectIRNodes(ir);

    const interactiveNodes = nodes.filter((node) => node.on);
    expect(interactiveNodes.map((node) => node.nodeId).sort()).toEqual([
      "nlp-arrow",
      "nlp-cta-button",
      "nlp-title",
      "nlp-z-back",
      "nlp-z-front",
      "nlp-z-middle",
    ]);
    expect(
      Object.fromEntries(interactiveNodes.map((node) => [node.nodeId, node.on])),
    ).toMatchObject({
      "nlp-arrow": {
        onClick: "handleArrowClick",
        onPointerEnter: "handleArrowEnter",
      },
      "nlp-cta-button": {
        onClick: "handleCtaClick",
        onPointerEnter: "handleCtaEnter",
        onPointerLeave: "handleCtaLeave",
      },
      "nlp-title": { onClick: "handleTitleClick" },
      "nlp-z-back": { onClick: "handleZBackClick" },
      "nlp-z-front": { onClick: "handleZFrontClick" },
      "nlp-z-middle": { onClick: "handleZMiddleClick" },
    });

    const nodeById = new Map(nodes.map((node) => [node.nodeId, node] as const));
    const isolatedTargetIds = ["nlp-title", "nlp-arrow", "nlp-cta-button"];
    const hitCases = isolatedTargetIds.map((nodeId) => {
      const node = nodeById.get(nodeId);
      if (!node) {
        throw new Error(`IR node missing for hit-test target ${nodeId}`);
      }
      return { nodeId, x: node.bbox.x + node.bbox.w / 2, y: node.bbox.y + node.bbox.h / 2 };
    });

    const zFrontNode = nodeById.get("nlp-z-front");
    const zMiddleNode = nodeById.get("nlp-z-middle");
    if (!zFrontNode || !zMiddleNode) {
      throw new Error("Overlapping z-index hit-test nodes missing from IR");
    }
    const overlapLeft = Math.max(zFrontNode.bbox.x, zMiddleNode.bbox.x);
    const overlapTop = Math.max(zFrontNode.bbox.y, zMiddleNode.bbox.y);
    const overlapRight = Math.min(
      zFrontNode.bbox.x + zFrontNode.bbox.w,
      zMiddleNode.bbox.x + zMiddleNode.bbox.w,
    );
    const overlapBottom = Math.min(
      zFrontNode.bbox.y + zFrontNode.bbox.h,
      zMiddleNode.bbox.y + zMiddleNode.bbox.h,
    );
    expect(overlapRight).toBeGreaterThan(overlapLeft);
    expect(overlapBottom).toBeGreaterThan(overlapTop);
    hitCases.push({
      nodeId: "nlp-z-front",
      x: (overlapLeft + overlapRight) / 2,
      y: (overlapTop + overlapBottom) / 2,
    });

    const hitTestIndex = buildHitTestIndex(ir);
    for (const { nodeId, x, y } of hitCases) {
      expect(engine.hitTest(ir, x, y), `direct hit for "${nodeId}"`).toBe(nodeId);
      expect(hitTestWithIndex(hitTestIndex, x, y), `indexed hit for "${nodeId}"`).toBe(nodeId);
    }
  });

  it("native-text-unit-animation retains resolved units and sampled outline poses", () => {
    const scene = sceneById("native-text-unit-animation");
    const { ir, svg } = engine.renderToSvgAndIR(scene.build(), scene.renderOptions);
    const nodes = collectIRNodes(ir);
    const horizontal = nodes.find(
      (node): node is Extract<IRNode, { type: "text" }> =>
        node.type === "text" && node.nodeId === "ntua-horizontal",
    );
    const vertical = nodes.find(
      (node): node is Extract<IRNode, { type: "text" }> =>
        node.type === "text" && node.nodeId === "ntua-vertical",
    );
    if (!horizontal || !vertical) {
      throw new Error("Text unit conformance nodes missing from IR");
    }

    expect(horizontal.unitAnimation).toMatchObject({
      by: "cluster",
      order: "logical",
      ruby: "separate",
    });
    expect(vertical.unitAnimation).toMatchObject({ by: "line", order: "visual" });
    expect(horizontal.unitMap?.units.length).toBeGreaterThan(horizontal.lines.length);
    expect(vertical.unitMap?.units).toHaveLength(vertical.lines.length);
    for (const textNode of [horizontal, vertical]) {
      expect(textNode.unitAnimationSamples).toHaveLength(textNode.unitMap?.units.length);
      expect(
        textNode.unitAnimationSamples?.every(
          (sample) => sample.bbox !== undefined && sample.opacity !== undefined,
        ),
      ).toBe(true);
    }
    expect(
      new Set(
        horizontal.unitMap?.units.flatMap((unit) =>
          unit.members.map((member) => member.sourceRole),
        ),
      ),
    ).toEqual(new Set(["content", "rubyBase", "rubyAnnotation"]));
    expect(svg).not.toContain("@keyframes");
    expect(engine.renderCompiledToSvg(engine.compile(scene.build()), scene.renderOptions)).toBe(
      svg,
    );
  });

  it("native-text-on-path covers curves, reverse tangents, effects, and sampled units", () => {
    const scene = sceneById("native-text-on-path");
    const { ir, svg } = engine.renderToSvgAndIR(scene.build(), scene.renderOptions);
    const nodes = collectIRNodes(ir);
    const pathTexts = ["ntop-cubic", "ntop-arc", "ntop-reverse", "ntop-ellipsis"].map((nodeId) =>
      nodes.find(
        (node): node is Extract<IRNode, { type: "text" }> =>
          node.type === "text" && node.nodeId === nodeId,
      ),
    );
    if (pathTexts.some((node) => node === undefined)) {
      throw new Error("TextOnPath conformance nodes missing from IR");
    }
    const [cubic, arc, reverse, ellipsis] = pathTexts;
    if (!cubic || !arc || !reverse || !ellipsis) {
      throw new Error("TextOnPath conformance nodes are incomplete");
    }

    for (const textNode of [cubic, arc, reverse, ellipsis]) {
      expect(textNode.textLayoutKind).toBe("path");
      expect(textNode.textPath?.d).toBeTruthy();
      expect(textNode.lines).toHaveLength(1);
    }
    for (const textNode of [cubic, arc, reverse]) {
      expect(
        textNode.lines[0]?.positionedGlyphs?.some(
          (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
        ),
      ).toBe(true);
    }
    expect(cubic.textPath?.pathFit).toBe("spacing");
    expect(cubic.lines[0]?.width).toBeGreaterThan(600);
    const cubicDecorations =
      cubic.textDecorations?.filter((fragment) => fragment.line === "underline") ?? [];
    expect(cubic.sourceText).toBe("CURVED TYPE / 曲線");
    expect(cubicDecorations.map((fragment) => fragment.style)).toEqual(["dashed", "wavy"]);
    expect(cubicDecorations.map((fragment) => [fragment.sourceStart, fragment.sourceEnd])).toEqual([
      [0, 14],
      [14, 16],
    ]);
    expect(cubicDecorations.every((fragment) => fragment.skipInk === "all")).toBe(true);
    expect(cubicDecorations.flatMap((fragment) => fragment.paths).length).toBeGreaterThan(1);
    const richCubicGlyph = cubic.lines[0]?.positionedGlyphs?.find((glyph) => glyph.text === "曲");
    expect(richCubicGlyph).toMatchObject({ fill: "#fb7185", fontAlias: "NotoSansJP" });
    expect(richCubicGlyph?.textStrokes?.[0]?.color).toBe("#9f1239");
    expect(richCubicGlyph?.textShadows?.[0]?.color).toBe("#4c051980");
    expect(arc.textPath?.pathFit).toBe("shrink");
    expect(arc.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) < 1)).toBe(
      true,
    );
    expect(arc.lines[0]?.positionedGlyphs?.find((glyph) => glyph.text === "S")?.fontAlias).toBe(
      FONT_LATIN,
    );
    const arcDecoration = arc.textDecorations?.find((fragment) => fragment.line === "underline");
    expect(arcDecoration?.style).toBe("double");
    expect(arcDecoration?.skipInk ?? "none").toBe("none");
    expect(
      arcDecoration?.paths.reduce((sum, decorationPath) => sum + decorationPath.contourCount, 0),
    ).toBeGreaterThanOrEqual(2);
    for (const decorationPath of [
      ...cubicDecorations.flatMap((fragment) => fragment.paths),
      ...(arcDecoration?.paths ?? []),
    ]) {
      expect(decorationPath.d).toBeTruthy();
      expect(decorationPath.pathDistanceStartPx).toEqual(expect.any(Number));
      expect(decorationPath.pathDistanceEndPx).toEqual(expect.any(Number));
      expect(decorationPath.pathDistanceEndPx ?? 0).toBeGreaterThan(
        decorationPath.pathDistanceStartPx ?? 0,
      );
    }
    expect(reverse.textPath).toMatchObject({
      pathDirection: "reverse",
      pathNormal: "right",
      pathOffsetPx: 5,
      pathFit: "scale",
    });
    expect(reverse.textPath?.d.trimEnd().endsWith("Z")).toBe(true);
    expect(reverse.unitAnimation).toMatchObject({ by: "cluster", order: "logical" });
    expect(reverse.unitAnimationSamples).toHaveLength(reverse.unitMap?.units.length);
    expect(
      reverse.lines[0]?.positionedGlyphs?.some(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 90,
      ),
    ).toBe(true);
    const paintedUnitIds = new Set(
      reverse.glyphPaths?.flatMap((path) => (path.unitId ? [path.unitId] : [])),
    );
    expect(
      new Set(
        reverse.unitAnimationSamples?.flatMap((sample) => (sample.bbox ? [sample.unitId] : [])),
      ),
    ).toEqual(paintedUnitIds);
    const ellipsisGlyphs = ellipsis.lines[0]?.positionedGlyphs ?? [];
    const ellipsisGlyphIndex = ellipsisGlyphs.length - 1;
    expect(ellipsis.textPath?.pathOverflow).toBe("ellipsis");
    expect(ellipsis.sourceText).toBe("ELLIPSIS は元の文章と論理単位を保持する");
    expect(ellipsis.displayText).toMatch(/…$/u);
    expect(ellipsisGlyphs[ellipsisGlyphIndex]?.syntheticKind).toBe("ellipsis");
    expect(
      ellipsis.unitMap?.units.some((unit) =>
        unit.members.some((member) => member.glyphIndex === ellipsisGlyphIndex),
      ),
    ).toBe(false);
    expect(ellipsis.unitMap?.units.some((unit) => unit.members.length === 0)).toBe(true);
    expect(svg).not.toContain("<textPath");
    expect(svg).not.toContain("@keyframes");
    expect(svg).toContain('fill="#fb7185" stroke="none"');
    expect(svg).toContain('fill="#38bdf8" stroke="none"');
    expect(svg).toContain('stroke-dasharray="5,5"');
    expect(engine.renderCompiledToSvg(engine.compile(scene.build()), scene.renderOptions)).toBe(
      svg,
    );
  });
});
