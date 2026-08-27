import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { MAX_LAYOUT_TREE_DEPTH } from "../../src/layout/limits.js";
import { type ComputeLayoutFn, computeLayout } from "../../src/layout/taffy-layout-adapter.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";

function createNestedLayoutTree(depth: number): VNode {
  let child: VNode = createElement("Box", { width: 1, height: 1 });
  for (let currentDepth = depth - 1; currentDepth >= 1; currentDepth -= 1) {
    child = createElement("Box", { width: 1, height: 1 }, child);
  }
  return createElement("Canvas", { width: 20, height: 20 }, child);
}

/**
 * Mock WASM compute_layout function.
 *
 * This simulates the WASM layout engine behavior for testing the TS wrapper.
 * In production, this would be the actual WASM function.
 */
function createMockComputeLayout(): {
  computeLayoutFn: ComputeLayoutFn;
  lastInput: () => unknown;
} {
  let captured: unknown = null;

  const computeLayoutFn: ComputeLayoutFn = (inputJson: string) => {
    const input = JSON.parse(inputJson) as {
      root: {
        nodeId: string;
        nodeType: string;
        style: Record<string, unknown>;
        children: Array<{
          nodeId: string;
          nodeType: string;
          style: Record<string, unknown>;
          children: unknown[];
          text?: { content: string; fontSizePx: number };
          image?: { width: number; height: number };
        }>;
      };
    };
    captured = input;

    // Simple layout simulation: stack children vertically
    const rootW = (input.root.style.width as number) ?? 400;
    const rootH = (input.root.style.height as number) ?? 300;

    const nodes: Array<Record<string, unknown>> = [
      { nodeId: input.root.nodeId, x: 0, y: 0, width: rootW, height: rootH },
    ];

    let yOffset = 0;
    let measureCallCount = 0;

    for (const child of input.root.children) {
      const childW = (child.style.width as number) ?? rootW;
      let childH = (child.style.height as number) ?? 50;

      if (child.text) {
        measureCallCount += 2; // Simulate 2 measure calls
        const fontSize = child.text.fontSizePx;
        const content = child.text.content;
        const advance = fontSize * 0.6;
        const estWidth = content.length * advance;
        const measuredWidth = Math.min(estWidth, rootW);
        const measuredHeight = fontSize * 1.2;
        childH = measuredHeight;
        const glyphs = [...content].map((_: string, i: number) => ({
          glyphId: i + 1,
          xAdvance: advance,
          yAdvance: 0,
          xOffset: 0,
          yOffset: 0,
          cluster: i,
        }));

        nodes.push({
          nodeId: child.nodeId,
          x: 0,
          y: yOffset,
          width: measuredWidth,
          height: childH,
          textLayout: {
            glyphs: [],
            measuredWidth,
            measuredHeight,
            lines: [{ text: content, glyphs, width: measuredWidth, baselineY: fontSize * 0.8 }],
            bbox: { x: 0, y: 0, w: measuredWidth, h: measuredHeight },
            chosenFontSizePx: fontSize,
            overflow: { type: "none" },
          },
        });
      } else if (child.image) {
        measureCallCount += 1;
        nodes.push({
          nodeId: child.nodeId,
          x: 0,
          y: yOffset,
          width: child.image.width,
          height: child.image.height,
        });
        childH = child.image.height;
      } else {
        nodes.push({
          nodeId: child.nodeId,
          x: 0,
          y: yOffset,
          width: childW,
          height: childH,
        });
      }

      yOffset += childH;
    }

    return JSON.stringify({ nodes, measureCallCount });
  };

  return { computeLayoutFn, lastInput: () => captured };
}

describe("computeLayout", () => {
  it("rejects over-depth trees before invoking the WASM transport", () => {
    let transportCalled = false;
    const computeLayoutFn: ComputeLayoutFn = () => {
      transportCalled = true;
      return JSON.stringify({ nodes: [], measureCallCount: 0 });
    };

    expect(() =>
      computeLayout(createNestedLayoutTree(MAX_LAYOUT_TREE_DEPTH + 1), { computeLayoutFn }),
    ).toThrow(FatalError);
    expect(transportCalled).toBe(false);
  });

  it("computes layout for Canvas > Box + Box", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Box", { width: 400, height: 200, id: "box1" }),
      createElement("Box", { width: 400, height: 150, id: "box2" }),
    );

    const result = computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    expect(result.root.nodeId).toBe("auto:0");
    expect(result.root.bbox.width).toBe(800);
    expect(result.root.bbox.height).toBe(600);
    expect(result.root.children).toHaveLength(2);

    const box1 = result.root.children[0]!;
    expect(box1.nodeId).toBe("box1");
    expect(box1.bbox.x).toBe(0);
    expect(box1.bbox.y).toBe(0);
    expect(box1.bbox.width).toBe(400);
    expect(box1.bbox.height).toBe(200);

    const box2 = result.root.children[1]!;
    expect(box2.nodeId).toBe("box2");
    expect(box2.bbox.y).toBe(200); // Stacked below box1
  });

  it("handles Text node with measure", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          id: "text1",
        },
        "Hello World",
      ),
    );

    const result = computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    expect(result.measureCallCount).toBeGreaterThan(0);
    const textNode = result.root.children[0]!;
    expect(textNode.nodeId).toBe("text1");
    expect(textNode.textLayout).toBeDefined();
    expect(textNode.textLayout!.measuredWidth).toBeGreaterThan(0);
  });

  it("serializes the exact flow-fit probe budget", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 100 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          width: 120,
          height: 80,
          flowExclusions: [],
          fit: "shrink",
          fitMaxProbes: 77,
        },
        "flow text",
      ),
    );

    computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });
    const input = mock.lastInput() as {
      root: { children: Array<{ text?: { fitMaxProbes?: number } }> };
    };
    expect(input.root.children[0]?.text?.fitMaxProbes).toBe(77);
  });

  it("serializes inline text spans for WASM measurement", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          id: "text-inline",
        },
        "A",
        createElement("Inline", { color: "#ff0000", fontWeight: 700 }, "B"),
      ),
    );

    computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    const input = mock.lastInput() as {
      root: {
        children: Array<{
          text?: {
            content: string;
            spans?: Array<{ text: string; fontWeight: number }>;
          };
        }>;
      };
    };

    const textInput = input.root.children[0]?.text;
    expect(textInput?.content).toBe("AB");
    expect(textInput?.spans).toHaveLength(2);
    expect(textInput?.spans?.[0]?.text).toBe("A");
    expect(textInput?.spans?.[1]?.text).toBe("B");
    expect(textInput?.spans?.[1]?.fontWeight).toBe(700);
  });

  it("serializes extended inline span style fields for WASM measurement", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          id: "text-inline-style",
        },
        "A",
        createElement(
          "Inline",
          {
            color: "#ff0000",
            fontVariationSettings: '"wght" 700',
            textOrientation: "upright",
          },
          "B",
        ),
      ),
    );

    computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    const input = mock.lastInput() as {
      root: {
        children: Array<{
          text?: {
            spans?: Array<{
              text: string;
              textOrientation?: "mixed" | "upright";
              color?: string;
              fontVariationSettings?: string;
            }>;
          };
        }>;
      };
    };

    const spans = input.root.children[0]?.text?.spans;
    expect(spans).toHaveLength(2);
    expect(spans?.[1]).toMatchObject({
      text: "B",
      textOrientation: "upright",
      color: "#ff0000",
      fontVariationSettings: '"wght" 700',
    });
  });

  it("serializes ruby line sizing and multi-level annotations for WASM measurement", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          id: "text-ruby",
        },
        "A",
        createElement(
          "Ruby",
          {
            rubyPosition: "alternate",
            rubyAlign: "space-around",
            rubyGapPx: 1,
            rubyOffsetPx: 2,
            rubyLineSizing: "css",
          },
          "東京",
          createElement("Rt", { color: "#fca5a5" }, "とうきょう"),
          createElement("Rt", { color: "#93c5fd" }, "Tokyo"),
        ),
      ),
    );

    computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    const input = mock.lastInput() as {
      root: {
        children: Array<{
          text?: {
            richText?: Array<{
              kind: string;
              rubyPosition?: string;
              rubyAlign?: string;
              rubyGapPx?: number;
              rubyOffsetPx?: number;
              rubyLineSizing?: string;
              rtLevels?: unknown[][];
            }>;
          };
        }>;
      };
    };

    const ruby = input.root.children[0]?.text?.richText?.find((node) => node.kind === "ruby");
    expect(ruby).toMatchObject({
      kind: "ruby",
      rubyPosition: "alternate",
      rubyAlign: "space-around",
      rubyGapPx: 1,
      rubyOffsetPx: 2,
      rubyLineSizing: "css",
    });
    expect(ruby?.rtLevels).toHaveLength(2);
  });

  it("preserves fragment styles returned by WASM", () => {
    const computeLayoutFn: ComputeLayoutFn = (inputJson: string) => {
      const input = JSON.parse(inputJson) as {
        root: {
          nodeId: string;
          children: Array<{ nodeId: string }>;
        };
      };
      const textNodeId = input.root.children[0]!.nodeId;

      return JSON.stringify({
        nodes: [
          { nodeId: input.root.nodeId, x: 0, y: 0, width: 800, height: 600 },
          {
            nodeId: textNodeId,
            x: 0,
            y: 0,
            width: 100,
            height: 24,
            textLayout: {
              glyphs: [],
              measuredWidth: 100,
              measuredHeight: 24,
              lines: [
                {
                  text: "AB",
                  glyphs: [],
                  width: 100,
                  baselineY: 18,
                  fragments: [
                    {
                      text: "AB",
                      glyphs: [],
                      width: 100,
                      style: {
                        font: "NotoSansJP",
                        fallback: ["FallbackFont"],
                        fontWeight: 700,
                        fontStyle: "italic",
                        fontSizePx: 24,
                        letterSpacingPx: 1.5,
                        textOrientation: "upright",
                        fontVariationSettings: '"wght" 700',
                        color: "#ff0000",
                        language: "ja",
                      },
                    },
                  ],
                },
              ],
              bbox: { x: 0, y: 0, w: 100, h: 24 },
              chosenFontSizePx: 24,
              overflow: { type: "none" },
            },
          },
        ],
        measureCallCount: 1,
      });
    };

    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          id: "text-inline-style-output",
        },
        "AB",
      ),
    );

    const result = computeLayout(vnode, { computeLayoutFn });
    const fragmentStyle =
      result.root.children[0]?.textLayout?.resolvedTextLayout.lines[0]?.fragments?.[0]?.style;

    expect(fragmentStyle).toEqual({
      font: "NotoSansJP",
      fallback: ["FallbackFont"],
      fontWeight: 700,
      fontStyle: "italic",
      fontSizePx: 24,
      letterSpacingPx: 1.5,
      textOrientation: "upright",
      fontVariationSettings: '"wght" 700',
      color: "#ff0000",
      language: "ja",
    });
  });

  it("preserves omission for color-less fragment styles returned by WASM", () => {
    const computeLayoutFn: ComputeLayoutFn = (inputJson: string) => {
      const input = JSON.parse(inputJson) as {
        root: { nodeId: string; children: Array<{ nodeId: string }> };
      };
      const textNodeId = input.root.children[0]!.nodeId;
      return JSON.stringify({
        nodes: [
          { nodeId: input.root.nodeId, x: 0, y: 0, width: 200, height: 80 },
          {
            nodeId: textNodeId,
            x: 0,
            y: 0,
            width: 100,
            height: 24,
            textLayout: {
              glyphs: [],
              measuredWidth: 100,
              measuredHeight: 24,
              lines: [
                {
                  text: "AB",
                  glyphs: [],
                  width: 100,
                  baselineY: 18,
                  fragments: [{ text: "AB", glyphs: [], width: 100 }],
                },
              ],
              bbox: { x: 0, y: 0, w: 100, h: 24 },
              chosenFontSizePx: 24,
              overflow: { type: "none" },
            },
          },
        ],
        measureCallCount: 1,
      });
    };
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 80 },
      createElement("Text", { font: "NotoSansJP", fontSizePx: 24 }, "AB"),
    );

    const fragment = computeLayout(vnode, { computeLayoutFn }).root.children[0]?.textLayout
      ?.resolvedTextLayout.lines[0]?.fragments?.[0];
    expect(fragment).not.toHaveProperty("style");
  });

  it("preserves opt-in text unit metadata returned by WASM", () => {
    const computeLayoutFn: ComputeLayoutFn = (inputJson: string) => {
      const input = JSON.parse(inputJson) as {
        root: { nodeId: string; children: Array<{ nodeId: string }> };
      };
      const textNodeId = input.root.children[0]!.nodeId;
      return JSON.stringify({
        nodes: [
          { nodeId: input.root.nodeId, x: 0, y: 0, width: 200, height: 80 },
          {
            nodeId: textNodeId,
            x: 0,
            y: 0,
            width: 100,
            height: 24,
            textLayout: {
              glyphs: [],
              measuredWidth: 100,
              measuredHeight: 24,
              lines: [{ text: "AB", glyphs: [], width: 100, baselineY: 18 }],
              bbox: { x: 0, y: 0, w: 100, h: 24 },
              chosenFontSizePx: 24,
              overflow: { type: "none" },
              unitMap: {
                kind: "cluster",
                ruby: "with-base",
                units: [
                  {
                    unitId: "opaque-cluster-id",
                    kind: "cluster",
                    sourceStart: 0,
                    sourceEnd: 1,
                    lineId: "opaque-line-id",
                    logicalOrder: 0,
                    visualOrder: 0,
                    members: [{ lineIndex: 0, glyphIndex: 0, sourceRole: "content" }],
                  },
                ],
              },
            },
          },
        ],
        measureCallCount: 1,
      });
    };
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 80 },
      createElement("Text", { font: "NotoSansJP", fontSizePx: 24 }, "AB"),
    );

    const unitMap = computeLayout(vnode, { computeLayoutFn }).root.children[0]?.textLayout
      ?.resolvedTextLayout.unitMap;
    expect(unitMap).toEqual({
      kind: "cluster",
      ruby: "with-base",
      units: [
        {
          unitId: "opaque-cluster-id",
          kind: "cluster",
          sourceStart: 0,
          sourceEnd: 1,
          lineId: "opaque-line-id",
          logicalOrder: 0,
          visualOrder: 0,
          members: [{ lineIndex: 0, glyphIndex: 0, sourceRole: "content" }],
        },
      ],
    });
  });

  it("handles Image node with measure", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Image", {
        src: new Uint8Array([1, 2, 3]),
        width: 200,
        height: 150,
        id: "img1",
      }),
    );

    const result = computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    const imgNode = result.root.children[0]!;
    expect(imgNode.nodeId).toBe("img1");
    expect(imgNode.bbox.width).toBe(200);
    expect(imgNode.bbox.height).toBe(150);
  });

  it("serializes VNode tree to correct WASM input format", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 1280, height: 720 },
      createElement(
        "Flex",
        { direction: "row", gap: 10, id: "flex1" },
        createElement("Box", { width: 100, height: 100, id: "a" }),
        createElement("Box", { width: 100, height: 100, id: "b" }),
      ),
    );

    computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    const input = mock.lastInput() as {
      root: {
        nodeId: string;
        nodeType: string;
        style: Record<string, unknown>;
        children: Array<{
          nodeId: string;
          style: Record<string, unknown>;
          children: Array<{ nodeId: string }>;
        }>;
      };
    };

    expect(input.root.nodeType).toBe("canvas");
    expect(input.root.style.width).toBe(1280);
    expect(input.root.children).toHaveLength(1);

    const flex = input.root.children[0]!;
    expect(flex.nodeId).toBe("flex1");
    expect(flex.style.flexDirection).toBe("row");
    expect(flex.style.gap).toBe(10);
    expect(flex.children).toHaveLength(2);
    expect(flex.children[0]!.nodeId).toBe("a");
    expect(flex.children[1]!.nodeId).toBe("b");
  });

  it("passes font data to WASM input", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement("Canvas", { width: 400, height: 300 });
    const fontData = new Uint8Array([0, 1, 2, 3]);

    computeLayout(vnode, {
      computeLayoutFn: mock.computeLayoutFn,
      fonts: [{ alias: "TestFont", weight: 700, data: fontData }],
    });

    const input = mock.lastInput() as {
      fonts: Array<{ alias: string; weight: number; data: number[] }>;
    };
    expect(input.fonts).toHaveLength(1);
    expect(input.fonts[0]!.alias).toBe("TestFont");
    expect(input.fonts[0]!.weight).toBe(700);
    expect(input.fonts[0]!.data).toEqual([0, 1, 2, 3]);
  });

  it("preserves VNode references in LayoutNode", () => {
    const mock = createMockComputeLayout();
    const box1 = createElement("Box", { id: "box1", width: 100, height: 100 });
    const vnode = createElement("Canvas", { width: 400, height: 300 }, box1);

    const result = computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    expect(result.root.vnode).toBe(vnode);
    expect(result.root.children[0]!.vnode).toBe(box1);
  });

  it("generates auto nodeIds when id prop is missing", () => {
    const mock = createMockComputeLayout();
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", { width: 100, height: 100 }),
      createElement("Box", { width: 100, height: 100 }),
    );

    const result = computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });

    // Auto-generated IDs should be unique
    const child0Id = result.root.children[0]!.nodeId;
    const child1Id = result.root.children[1]!.nodeId;
    expect(child0Id).not.toBe(child1Id);
    expect(child0Id).toMatch(/^auto:/);
    expect(child1Id).toMatch(/^auto:/);
  });
});

// The `visual` field carries raw VNode props for the IR builder across the
// WASM boundary. Values must arrive uninterpreted (raw gradient / box-shadow
// strings, raw border radius) — interpretation stays with the IR builder.
describe("computeLayout visual transport", () => {
  type CapturedNode = {
    nodeId: string;
    visual?: Record<string, unknown>;
    children: CapturedNode[];
  };

  function captureRoot(vnode: VNode): CapturedNode {
    const mock = createMockComputeLayout();
    computeLayout(vnode, { computeLayoutFn: mock.computeLayoutFn });
    return (mock.lastInput() as { root: CapturedNode }).root;
  }

  it("carries raw box visuals, meta, and handlers", () => {
    const root = captureRoot(
      createElement(
        "Canvas",
        { width: 400, height: 300, background: "#fff", debug: true },
        createElement("Box", {
          id: "styled",
          width: 100,
          height: 100,
          background: "linear-gradient(to right, #f00, #00f)",
          borderWidth: 2,
          borderColor: "#333",
          borderRadius: [1, 2, 3, 4],
          boxShadow: "0 4 8 0 rgba(0,0,0,0.2)",
          overflow: "clip",
          opacity: 0.5,
          zIndex: 3,
          transform: { rotateDeg: 45, originX: 50, originY: 50 },
          meta: { role: "card" },
          onClick: "select-card",
        }),
      ),
    );

    expect(root.visual).toEqual({ background: "#fff", debug: true });
    expect(root.children[0]!.visual).toEqual({
      background: "linear-gradient(to right, #f00, #00f)",
      borderWidth: 2,
      borderColor: "#333",
      borderRadius: [1, 2, 3, 4],
      boxShadow: "0 4 8 0 rgba(0,0,0,0.2)",
      overflow: "clip",
      opacity: 0.5,
      zIndex: 3,
      transform: { rotateDeg: 45, originX: 50, originY: 50 },
      meta: { role: "card" },
      handlers: { onClick: "select-card" },
    });
  });

  it("omits visual entirely when a node has no visual props", () => {
    const root = captureRoot(
      createElement(
        "Canvas",
        { width: 400, height: 300 },
        createElement("Box", { width: 100, height: 100 }),
      ),
    );

    expect(root.visual).toBeUndefined();
    expect(root.children[0]!.visual).toBeUndefined();
  });

  it("transports only the opt-in canvas stroke scaling value", () => {
    const root = captureRoot(
      createElement(
        "Canvas",
        { width: 100, height: 100 },
        createElement("Flex", { strokeScaling: "canvas" }),
        createElement("Grid", { strokeScaling: "transform" }),
        createElement("Box", { borderWidth: 1, borderColor: "#fff" }),
        createElement("Path", {
          d: "M0 0L10 10",
          width: 10,
          height: 10,
          strokeScaling: "canvas",
        }),
      ),
    );

    expect(root.children[0]!.visual).toEqual({ strokeScaling: "canvas" });
    expect(root.children[1]!.visual).toBeUndefined();
    expect(root.children[2]!.visual).toEqual({ borderWidth: 1, borderColor: "#fff" });
    expect(root.children[3]!.visual).toEqual({
      d: "M0 0L10 10",
      strokeScaling: "canvas",
    });
  });

  it("carries text visuals that the text pipeline does not transport", () => {
    const root = captureRoot(
      createElement(
        "Canvas",
        { width: 400, height: 300 },
        createElement(
          "Text",
          {
            font: "TestFont",
            fallback: ["FallbackFont"],
            fontSizePx: 16,
            fontWeight: 700,
            color: "#123456",
            textAlign: "center",
            textStroke: "#000",
            textStrokeWidth: 2,
            textShadows: [{ dx: 1, dy: 2, blurPx: 3, color: "#0008" }],
          },
          "hello",
        ),
      ),
    );

    expect(root.children[0]!.visual).toEqual({
      color: "#123456",
      textAlign: "center",
      fontWeight: 700,
      fontFallback: ["FallbackFont"],
      textStroke: "#000",
      textStrokeWidth: 2,
      textShadows: [{ dx: 1, dy: 2, blurPx: 3, color: "#0008" }],
    });
  });

  it("converts image byte sources to data URIs and keeps references raw", () => {
    const root = captureRoot(
      createElement(
        "Canvas",
        { width: 400, height: 300 },
        createElement("Image", {
          src: new Uint8Array([137, 80, 78, 71]),
          mediaType: "image/png",
          width: 10,
          height: 10,
        }),
        createElement("Image", {
          src: "https://example.com/image.png",
          width: 10,
          height: 10,
          objectFit: "cover",
        }),
        createElement("Image", {
          // Byte source without a media type cannot be embedded: src must be
          // absent so the IR builder keeps its load-failure fallback.
          src: new Uint8Array([1, 2, 3]),
          width: 10,
          height: 10,
        }),
      ),
    );

    expect(root.children[0]!.visual?.src).toBe("data:image/png;base64,iVBORw==");
    expect(root.children[1]!.visual).toEqual({
      src: "https://example.com/image.png",
      objectFit: "cover",
    });
    expect(root.children[2]!.visual).toBeUndefined();
  });

  it("carries path and nested-svg content raw", () => {
    const root = captureRoot(
      createElement(
        "Canvas",
        { width: 400, height: 300 },
        createElement("Path", {
          d: "M0 0 L10 10",
          width: 10,
          height: 10,
          fill: "#f00",
          fillRule: "evenodd",
          strokeDasharray: "5,5",
        }),
        createElement("Svg", {
          content: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
          width: 10,
          height: 10,
          preserveAspectRatio: "slice",
          contentIdPrefix: "nested-",
        }),
      ),
    );

    expect(root.children[0]!.visual).toEqual({
      d: "M0 0 L10 10",
      fill: "#f00",
      fillRule: "evenodd",
      strokeDasharray: "5,5",
    });
    expect(root.children[1]!.visual).toEqual({
      svgContent: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      preserveAspectRatio: "slice",
      contentIdPrefix: "nested-",
    });
  });

  it("carries inline shape geometry and resolves registry references leniently", () => {
    const geometry = {
      viewBox: { width: 10, height: 10 },
      root: { kind: "path" as const, d: "M0 0 H10 V10 Z" },
    };
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Shape", { geometry, width: 10, height: 10, fill: "#0f0" }),
      createElement("Shape", { geometryId: "registered", width: 10, height: 10 }),
      createElement("Shape", { geometryId: "unknown", width: 10, height: 10 }),
    );

    const mock = createMockComputeLayout();
    computeLayout(vnode, {
      computeLayoutFn: mock.computeLayoutFn,
      shapeRegistry: {
        geometries: new Map([["registered", geometry]]),
        symbols: new Map(),
      },
    });
    const root = (mock.lastInput() as { root: CapturedNode }).root;

    expect(root.children[0]!.visual).toEqual({ shapeGeometry: geometry, fill: "#0f0" });
    expect(root.children[1]!.visual).toEqual({
      shapeGeometry: geometry,
      shapeGeometryId: "registered",
    });
    // Unresolvable reference: the doc is omitted (not thrown) but the raw id
    // is carried for diagnostics — failures keep surfacing at IR build so
    // layout-only rendering stays reference-tolerant.
    expect(root.children[2]!.visual).toEqual({ shapeGeometryId: "unknown" });
  });
});
