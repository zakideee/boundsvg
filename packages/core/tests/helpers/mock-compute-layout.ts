import type { ComputeLayoutFn } from "../../src/layout/taffy-layout-adapter.js";
import type { GlyphPathFn } from "../../src/wasm/index.js";

// ---------------------------------------------------------------------------
// Shared mock compute_layout functions for deterministic testing
// ---------------------------------------------------------------------------

/**
 * Simple mock: stacks root children vertically. No text layout, no recursion.
 * Suitable for tests that only need basic Box/Flex/Grid positioning.
 */
export function mockComputeLayoutSimple(): ComputeLayoutFn {
  return (inputJson: string) => {
    const input = JSON.parse(inputJson) as {
      root: {
        nodeId: string;
        style: Record<string, unknown>;
        children: Array<{
          nodeId: string;
          style: Record<string, unknown>;
          children?: Array<{ nodeId: string; style: Record<string, unknown> }>;
        }>;
      };
    };

    const rootW = (input.root.style.width as number) ?? 400;
    const rootH = (input.root.style.height as number) ?? 300;
    const nodes: Array<Record<string, unknown>> = [
      { nodeId: input.root.nodeId, x: 0, y: 0, width: rootW, height: rootH },
    ];

    let localY = 0;
    for (const child of input.root.children ?? []) {
      const cw = (child.style.width as number) ?? rootW;
      const ch = (child.style.height as number) ?? 50;
      nodes.push({ nodeId: child.nodeId, x: 0, y: localY, width: cw, height: ch });
      localY += ch;

      for (const grandchild of child.children ?? []) {
        const gw = (grandchild.style.width as number) ?? cw;
        const gh = (grandchild.style.height as number) ?? 50;
        nodes.push({ nodeId: grandchild.nodeId, x: 0, y: localY, width: gw, height: gh });
        localY += gh;
      }
    }

    return JSON.stringify({ nodes, measureCallCount: 0 });
  };
}

// ---------------------------------------------------------------------------
// Recursive child node type for text-enabled mocks
// ---------------------------------------------------------------------------

type MockChildNode = {
  nodeId: string;
  nodeType?: string;
  style: Record<string, unknown>;
  children?: MockChildNode[];
  text?: { content: string; fontSizePx: number };
};

/**
 * Full mock: recursive child processing with text layout generation.
 * Produces textLayout objects with glyphs, lines, and bbox data.
 * Suitable for e2e and snapshot tests that exercise the full pipeline.
 */
export function mockComputeLayoutWithText(): ComputeLayoutFn {
  return (inputJson: string) => {
    const input = JSON.parse(inputJson) as {
      root: {
        nodeId: string;
        nodeType: string;
        style: Record<string, unknown>;
        children: MockChildNode[];
      };
    };

    const rootW = (input.root.style.width as number) ?? 1280;
    const rootH = (input.root.style.height as number) ?? 720;
    const nodes: Array<Record<string, unknown>> = [
      { nodeId: input.root.nodeId, x: 0, y: 0, width: rootW, height: rootH },
    ];

    let measureCallCount = 0;

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test mock simulates full layout engine behavior.
    function processChildren(
      children: MockChildNode[],
      parentX: number,
      parentY: number,
      parentW: number,
    ): void {
      let localY = 0;
      for (const child of children) {
        const cw = (child.style.width as number) ?? parentW;
        let ch = (child.style.height as number) ?? 50;

        if (child.text) {
          measureCallCount += 2;
          const fontSize = child.text.fontSizePx;
          ch = fontSize * 1.2;
          const content = child.text.content;
          const advance = fontSize * 0.6;
          const tw = Math.min(content.length * advance, parentW);
          const glyphs = [...content].map((_, i) => ({
            glyphId: i + 1,
            xAdvance: advance,
            yAdvance: 0,
            xOffset: 0,
            yOffset: 0,
            cluster: i,
          }));
          nodes.push({
            nodeId: child.nodeId,
            x: parentX,
            y: parentY + localY,
            width: tw,
            height: ch,
            textLayout: {
              glyphs: [],
              measuredWidth: tw,
              measuredHeight: ch,
              lines: [{ text: content, glyphs, width: tw, baselineY: fontSize * 0.8 }],
              bbox: { x: 0, y: 0, w: tw, h: ch },
              chosenFontSizePx: fontSize,
              overflow: { type: "none" },
            },
          });
        } else {
          nodes.push({
            nodeId: child.nodeId,
            x: parentX,
            y: parentY + localY,
            width: cw,
            height: ch,
          });

          if (child.children && child.children.length > 0) {
            const dir = child.style.flexDirection as string | undefined;
            if (dir === "row") {
              let xOff = 0;
              for (const sc of child.children) {
                const scw = (sc.style.width as number) ?? 100;
                const sch = (sc.style.height as number) ?? ch;
                nodes.push({
                  nodeId: sc.nodeId,
                  x: parentX + xOff,
                  y: parentY + localY,
                  width: scw,
                  height: sch,
                });
                xOff += scw;
              }
            } else {
              processChildren(child.children, parentX, parentY + localY, cw);
            }
          }
        }
        localY += ch;
      }
    }

    processChildren(input.root.children, 0, 0, rootW);

    return JSON.stringify({ nodes, measureCallCount });
  };
}

// ---------------------------------------------------------------------------
// Shared mock glyph path function
// ---------------------------------------------------------------------------

/**
 * Mock glyph path function that returns a simple path for each text input.
 * Consistent across all test files that need deterministic SVG output.
 */
export function mockGlyphPathFn(): GlyphPathFn {
  return (text: string, params) => {
    if (!text) {
      return [];
    }
    return [
      {
        d: `M${params.startX},${params.baselineY} L${params.startX + 10},${params.baselineY}`,
        x: params.startX,
        y: params.baselineY,
      },
    ];
  };
}
