import type { AnimationEasing, IR, IRNode, IRTextNode } from "@boundsvg/core";

export type TextUnitPlaygroundControls = {
  by: "cluster" | "line";
  delayStepMs: number;
  order: "logical" | "visual";
  ruby: "with-base" | "separate";
  durationMs: number;
  easing: Extract<AnimationEasing, string>;
  writingMode: "horizontal-tb" | "vertical-rl";
};

export type LayoutReactivePlaygroundControls = {
  durationMs: number;
  fit: "none" | "shrink";
  wrap: "word" | "char";
  writingMode: "horizontal-tb" | "vertical-rl";
  canvasFit: "pad" | "crop";
};

export type AnimationUnitDebugEntry = {
  nodeId: string;
  unitId: string;
  bbox: { x: number; y: number; w: number; h: number };
};

export type AnimationIrMetrics = {
  textNodeCount: number;
  lineCount: number;
  glyphCount: number;
  missingGlyphCount: number;
  outlineCount: number;
  unitCount: number;
  unitBboxes: AnimationUnitDebugEntry[];
  shapingFingerprint: string;
};

export const DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS: TextUnitPlaygroundControls = {
  by: "cluster",
  delayStepMs: 55,
  order: "logical",
  ruby: "with-base",
  durationMs: 900,
  easing: "ease-out",
  writingMode: "horizontal-tb",
};

export const DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS: LayoutReactivePlaygroundControls = {
  durationMs: 2_400,
  fit: "shrink",
  wrap: "char",
  writingMode: "horizontal-tb",
  canvasFit: "pad",
};

export const TEXT_UNIT_EASING_OPTIONS: Array<{
  value: TextUnitPlaygroundControls["easing"];
  label: string;
}> = [
  { value: "linear", label: "Linear" },
  { value: "ease", label: "Ease" },
  { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" },
  { value: "ease-in-out", label: "Ease in/out" },
];

function visitTextNodes(node: IRNode, visitor: (textNode: IRTextNode) => void): void {
  if (node.type === "text") {
    visitor(node);
    return;
  }
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      visitTextNodes(child, visitor);
    }
  }
}

/**
 * Summarizes the renderer-owned text data used by the animation playground.
 * The fingerprint intentionally excludes animation samples and paint bounds:
 * it changes only when line breaking, glyph selection, advances, or the
 * resolved font size changes.
 */
export function inspectAnimationIr(ir: IR): AnimationIrMetrics {
  const textFingerprint: unknown[] = [];
  const unitBboxes: AnimationUnitDebugEntry[] = [];
  let textNodeCount = 0;
  let lineCount = 0;
  let glyphCount = 0;
  let missingGlyphCount = 0;
  let outlineCount = 0;
  let unitCount = 0;

  visitTextNodes(ir.root, (textNode) => {
    textNodeCount += 1;
    lineCount += textNode.lines.length;
    outlineCount += textNode.glyphPaths?.length ?? 0;
    unitCount += textNode.unitMap?.units.length ?? 0;

    for (const sample of textNode.unitAnimationSamples ?? []) {
      if (sample.bbox) {
        unitBboxes.push({ nodeId: textNode.nodeId, unitId: sample.unitId, bbox: sample.bbox });
      }
    }

    textFingerprint.push({
      nodeId: textNode.nodeId,
      fontSizePx: textNode.fontSizePx,
      lines: textNode.lines.map((line) => {
        const glyphs =
          line.positionedGlyphs && line.positionedGlyphs.length > 0
            ? line.positionedGlyphs
            : line.glyphs;
        glyphCount += glyphs.length;
        missingGlyphCount += glyphs.filter((glyph) => glyph.glyphId === 0).length;
        return {
          text: line.text,
          glyphs: glyphs.map((glyph) => ({
            glyphId: glyph.glyphId,
            xAdvance: glyph.xAdvance,
            yAdvance: glyph.yAdvance,
          })),
        };
      }),
    });
  });

  return {
    textNodeCount,
    lineCount,
    glyphCount,
    missingGlyphCount,
    outlineCount,
    unitCount,
    unitBboxes,
    shapingFingerprint: JSON.stringify(textFingerprint),
  };
}

export function formatAnimationBytes(byteLength: number): string {
  return new Intl.NumberFormat("en-US").format(byteLength);
}
