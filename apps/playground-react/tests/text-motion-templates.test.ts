import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import {
  Canvas,
  createEngineAsync,
  type Engine,
  type IRNode,
  type IRTextNode,
  TextOnPath,
  type VNode,
} from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { findVNodeById } from "@boundsvg/core/vnode";
import { TEMPLATE_DEFINITIONS, TEMPLATE_GROUPS } from "../src/pages/templates/definitions.tsx";

let engine: Engine;

function fontData(fileName: string): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`../../../fixtures/fonts/${fileName}`, import.meta.url)),
  );
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

/** Card that hosts the closed reverse/right scale/skip-ink sample. */
const CURVED_DECORATION_CARD = { left: 480, top: 252, right: 1016, bottom: 466 };

function assertBBoxWithin(
  textNode: IRTextNode | undefined,
  card: { left: number; top: number; right: number; bottom: number },
  nodeId: string,
): void {
  assert.ok(textNode, `missing ${nodeId}`);
  const { x, y, w, h } = textNode.bbox;
  assert.ok(x >= card.left, `${nodeId} overflows the card on the left: ${x} < ${card.left}`);
  assert.ok(y >= card.top, `${nodeId} overflows the card on top: ${y} < ${card.top}`);
  assert.ok(x + w <= card.right, `${nodeId} overflows the card on the right: ${x + w}`);
  assert.ok(y + h <= card.bottom, `${nodeId} overflows the card on the bottom: ${y + h}`);
}

function buildTemplate(templateKey: string): VNode {
  const definition = TEMPLATE_DEFINITIONS[templateKey];
  assert.ok(definition, `missing template ${templateKey}`);
  return definition.vnode ?? definition.build(engine);
}

before(async () => {
  await initNodeWasm();
  engine = await createEngineAsync({
    fonts: [
      {
        alias: "NotoSansJP-woff2",
        weight: 400,
        style: "normal",
        data: fontData("NotoSansJP-Regular.subset.woff2"),
      },
      {
        alias: "JetBrainsMono-woff2",
        weight: 400,
        style: "normal",
        data: fontData("JetBrainsMono-Regular.woff2"),
      },
    ],
  });
});

after(() => engine.dispose());

test("React Templates groups the same five Text Motion samples as core", () => {
  const textMotionGroup = TEMPLATE_GROUPS.find((group) => group.key === "text-motion");

  assert.equal(textMotionGroup?.label, "Text Motion");
  assert.deepEqual(textMotionGroup?.templateKeys, [
    "typing-ime-timeline",
    "text-on-path-basics",
    "decoration-path-fit",
    "rich-text-on-path",
    "text-path-motion",
  ]);
});

test("React Terminal / IME Timeline renders all authored states and composition decoration", () => {
  const { svg, ir } = engine.renderToSvgAndIR(buildTemplate("typing-ime-timeline"));
  const timelineNodes = collectTextNodes(ir.root).filter((node) =>
    node.nodeId.startsWith("timeline-"),
  );
  const compositionNodes = timelineNodes.filter((node) => (node.textDecorations?.length ?? 0) > 0);

  assert.deepEqual(
    timelineNodes.map((node) => node.nodeId),
    [
      "timeline-terminal-0",
      "timeline-terminal-240",
      "timeline-terminal-480",
      "timeline-terminal-720",
      "timeline-ime-0",
      "timeline-ime-240",
      "timeline-ime-480",
      "timeline-ime-720",
    ],
  );
  assert.deepEqual(
    compositionNodes.map((node) => node.nodeId),
    ["timeline-ime-240", "timeline-ime-480"],
  );
  assert.match(svg, /steps\(2, jump-none\)/);
  assert.match(svg, /SVG bytes/);
});

test("React Text on Path Basics covers guide geometry, effects, and hidden overflow", () => {
  const vnode = buildTemplate("text-on-path-basics");
  const { svg, ir } = engine.renderToSvgAndIR(vnode);
  const pathTextNodes = collectTextNodes(ir.root).filter((node) => node.textLayoutKind === "path");

  assert.deepEqual(
    pathTextNodes.map((node) => node.nodeId),
    ["path-basics-straight", "path-basics-cubic", "path-basics-arc", "path-basics-overflow-hidden"],
  );
  const [straight, cubic, arc, hidden] = pathTextNodes;
  assert.ok((straight?.lines[0]?.positionedGlyphs?.length ?? 0) > 0);
  assert.ok(
    straight?.lines[0]?.positionedGlyphs?.every(
      (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) < 0.001,
    ),
  );
  for (const curved of [cubic, arc]) {
    assert.ok(
      curved?.lines[0]?.positionedGlyphs?.some(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
      ),
    );
  }

  const anchorBbox = (nodeId: string, textAnchor: "start" | "middle" | "end") => {
    const pathVNode = findVNodeById(vnode, nodeId);
    assert.equal(pathVNode?.type, "TextOnPath");
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
    assert.ok(leadingBbox);
    assert.ok(trailingBbox);
    assert.ok(leadingBbox.x > trailingBbox.x);
    assert.deepEqual(pathNode?.bbox, selectedAnchor === leadingAnchor ? leadingBbox : trailingBbox);
  }

  const shapedGlyphs = hidden?.lines[0]?.glyphs ?? [];
  const positionedGlyphs = hidden?.lines[0]?.positionedGlyphs ?? [];
  assert.equal(hidden?.sourceText, "LEADING GLYPHS ARE HIDDEN BUT LOGICAL TEXT REMAINS");
  assert.equal(hidden?.displayText, hidden?.sourceText);
  assert.ok(positionedGlyphs.length < shapedGlyphs.length);
  assert.ok((positionedGlyphs[0]?.sourceStart ?? 0) > 0);
  assert.equal(pathTextNodes[1]?.strokes.length, 2);
  assert.equal(pathTextNodes[1]?.shadows.length, 1);
  assert.doesNotMatch(svg, /<textPath/);
});

test("React Decoration & Path Fit keeps the capability boundary explicit", () => {
  const vnode = buildTemplate("decoration-path-fit");
  const svg = engine.renderToSvg(vnode);
  const ir = engine.renderToIR(vnode);
  const textNodes = collectTextNodes(ir.root);
  const decorationNodes = textNodes.filter((node) => node.nodeId.startsWith("path-decoration-"));
  const pathTextNodes = textNodes.filter((node) => node.textLayoutKind === "path");
  const closedNodes = pathTextNodes.filter((node) => node.nodeId.startsWith("closed-path-"));
  const fitNodes = pathTextNodes.filter((node) => node.nodeId.startsWith("path-fit-"));

  assert.deepEqual(
    decorationNodes.map((node) => node.textDecorations?.[0]?.style),
    ["dotted", "dotted", "dashed", "dashed", "wavy", "wavy"],
  );
  for (const style of ["dotted", "dashed", "wavy"] as const) {
    const authored = findVNodeById(vnode, `path-decoration-${style}-all`);
    assert.equal(authored?.type, "Text");
    if (authored?.type === "Text") {
      assert.equal(
        typeof authored.props.textDecoration === "object"
          ? authored.props.textDecoration.skipInk
          : undefined,
        "all",
      );
    }
    const plain = decorationNodes.find((node) => node.nodeId === `path-decoration-${style}-none`);
    const skipped = decorationNodes.find((node) => node.nodeId === `path-decoration-${style}-all`);
    assert.notDeepEqual(skipped?.textDecorations?.[0]?.paths, plain?.textDecorations?.[0]?.paths);
  }
  assert.deepEqual(
    closedNodes.map((node) => [
      node.textPath?.pathDirection,
      node.textPath?.pathNormal,
      node.textPath?.startOffsetPx,
    ]),
    [
      ["forward", "left", 180],
      ["reverse", "right", 880],
    ],
  );
  assert.ok(closedNodes.every((node) => node.textPath?.d.endsWith("Z")));
  assert.deepEqual(
    fitNodes.map((node) => node.nodeId),
    ["path-fit-spacing", "path-fit-scale", "path-fit-shrink", "path-fit-ellipsis"],
  );
  const [spacing, scale, shrink, ellipsis] = fitNodes;
  const fittedPathLength = 204 - 12;
  for (const fitted of [spacing, scale, shrink]) {
    assert.equal(fitted?.lines[0]?.width, fittedPathLength);
    assert.equal(fitted?.lines[0]?.positionedGlyphs?.length, fitted?.lines[0]?.glyphs.length);
  }
  const spacingGlyphs = spacing?.lines[0]?.positionedGlyphs ?? [];
  assert.ok(
    Math.abs(spacingGlyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) - fittedPathLength) <
      1e-9,
  );
  assert.ok(spacingGlyphs.every((glyph) => glyph.inlineScale === undefined));
  assert.ok(scale?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) > 1));
  assert.ok(shrink?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) < 1));
  assert.equal(ellipsis?.sourceText, "ELLIPSIS PRESERVES SOURCE");
  assert.match(ellipsis?.displayText ?? "", /…$/u);
  assert.equal(ellipsis?.lines[0]?.positionedGlyphs?.at(-1)?.syntheticKind, "ellipsis");
  for (const textNode of [...decorationNodes, ...pathTextNodes]) {
    assert.ok(textNode.bbox.x >= 0);
    assert.ok(textNode.bbox.y >= 0);
    assert.ok(textNode.bbox.x + textNode.bbox.w <= 960);
    assert.ok(textNode.bbox.y + textNode.bbox.h <= 710);
  }
  assert.doesNotMatch(svg, /<textPath/);
});

test("React Rich Text on Path preserves identity and separates decoration from unit animation", () => {
  const { svg, ir } = engine.renderToSvgAndIR(buildTemplate("rich-text-on-path"));
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

  assert.equal(plain?.sourceText, "Shaping fidelity 日本語");
  assert.equal(singleInline?.sourceText, plain?.sourceText);
  assert.equal(singleInline?.displayText, plain?.displayText);
  assert.deepEqual(singleInline?.unitMap, plain?.unitMap);
  assert.deepEqual(shapingIdentity(singleInline), shapingIdentity(plain));

  assert.deepEqual(
    new Set(mixed?.lines[0]?.positionedGlyphs?.map((glyph) => glyph.fontAlias)),
    new Set(["NotoSansJP-woff2", "JetBrainsMono-woff2"]),
  );
  assert.ok(mixed?.lines[0]?.positionedGlyphs?.some((glyph) => glyph.fill === "#f0abfc"));
  assert.ok(
    mixed?.lines[0]?.positionedGlyphs?.some((glyph) => glyph.textStrokes?.[0]?.color === "#92400e"),
  );

  assert.equal(decorated?.textPath?.pathDirection, "reverse");
  assert.equal(decorated?.textPath?.pathNormal, "right");
  assert.equal(decorated?.textPath?.pathFit, "scale");
  assert.ok(decorated?.textPath?.d.endsWith("Z"));
  assert.deepEqual(
    decorated?.textDecorations?.map(({ style, skipInk }) => [style, skipInk]),
    [
      ["dashed", "all"],
      ["wavy", "all"],
    ],
  );
  assert.ok((decorated?.lines[0]?.positionedGlyphs?.length ?? 0) > 0);
  assert.ok(decorated?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) > 1));
  // `scale` fit stretches the clusters to the whole path length, so text that is
  // far shorter than the path silently demands a double-digit inline scale.
  assert.ok(decorated?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) < 2));
  assertBBoxWithin(decorated, CURVED_DECORATION_CARD, "rich-path-decorated-closed");
  assert.ok(decorated?.textDecorations?.every((fragment) => fragment.paths.length > 0));
  assert.equal(decorated?.unitAnimation, undefined);

  assert.deepEqual(
    a2Frames.map((node) => node.textPath?.d),
    ["M12 92L260 92", "M12 112C70 20 202 20 260 112", "M260 104A124 70 0 0 0 12 104"],
  );
  assert.deepEqual(
    a2Frames.map((node) => node.textPath?.pathFit),
    ["none", "spacing", "shrink"],
  );
  assert.deepEqual(
    a2Frames.map((node) => node.textPath?.pathDirection),
    ["forward", "forward", "reverse"],
  );
  assert.ok(a2Frames.every((node) => node.unitAnimation?.by === "cluster"));
  assert.ok(a2Frames.every((node) => (node.textDecorations?.length ?? 0) === 0));
  assert.equal(new Set(a2Frames.map((node) => node.sourceText)).size, 3);
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
  assert.equal(new Set(a2Poses).size, 3);
  assert.ok(
    a2Frames[0]?.lines[0]?.positionedGlyphs?.every(
      (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) < 0.001,
    ),
  );
  for (const curvedFrame of a2Frames.slice(1)) {
    assert.ok(
      curvedFrame.lines[0]?.positionedGlyphs?.some(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
      ),
    );
  }

  for (const textNode of [plain, singleInline, mixed, decorated, ...a2Frames]) {
    assert.ok(textNode);
    assert.ok(textNode.bbox.x >= 0);
    assert.ok(textNode.bbox.y >= 0);
    assert.ok(textNode.bbox.x + textNode.bbox.w <= 1024);
    assert.ok(textNode.bbox.y + textNode.bbox.h <= 740);
  }
  assert.doesNotMatch(svg, /<textPath/);
});

test("React Text Path Motion keeps three materialized geometry checkpoints", () => {
  const ir = engine.renderToIR(buildTemplate("text-path-motion"));
  const pathTextNodes = collectTextNodes(ir.root).filter((node) =>
    node.nodeId.startsWith("materialized-path-frame-"),
  );

  assert.deepEqual(
    pathTextNodes.map((node) => node.textPath?.d),
    ["M16 110L264 110", "M16 146C70 24 210 24 264 146", "M264 120A124 68 0 0 0 16 120"],
  );
  assert.deepEqual(
    pathTextNodes.map((node) => node.textPath?.startOffsetPx),
    [76, 142, 194],
  );
  assert.ok(pathTextNodes.every((node) => node.unitAnimation?.by === "cluster"));
  const positionedPoses = pathTextNodes.map((node) =>
    JSON.stringify(
      node.lines[0]?.positionedGlyphs?.map((glyph) => ({
        originX: glyph.originX,
        originY: glyph.originY,
        baselineRotationDeg: glyph.baselineRotationDeg,
      })),
    ),
  );
  assert.equal(new Set(positionedPoses).size, 3);
  assert.ok(
    pathTextNodes[0]?.lines[0]?.positionedGlyphs?.every(
      (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) < 0.001,
    ),
  );
  for (const curvedFrame of pathTextNodes.slice(1)) {
    assert.ok(
      curvedFrame.lines[0]?.positionedGlyphs?.some(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
      ),
    );
  }
});
