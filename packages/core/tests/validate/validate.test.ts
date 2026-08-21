import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { MAX_LAYOUT_TREE_DEPTH } from "../../src/layout/limits.js";
import { MAX_INLINE_RECTS } from "../../src/text/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";

function createNestedLayoutTree(
  depth: number,
  deepestNode: VNode = createElement("Box", { width: 1, height: 1 }),
): VNode {
  let child = deepestNode;
  for (let currentDepth = depth - 1; currentDepth >= 1; currentDepth -= 1) {
    child = createElement("Box", { width: 1, height: 1 }, child);
  }
  return createElement("Canvas", { width: 20, height: 20 }, child);
}

describe("validate", () => {
  it("passes for a valid Canvas root", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Flex", { direction: "row" }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("accepts canvas-stable box and Path strokes plus inert reusable styles", () => {
    const tree = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Flex", { strokeScaling: "canvas" }),
      createElement("Grid", { borderWidth: 1, borderColor: "#fff", strokeScaling: "canvas" }),
      createElement("Box", { borderWidth: 1, borderColor: "#fff", strokeScaling: "transform" }),
      createElement("Path", {
        d: "M0 0L10 10",
        width: 10,
        height: 10,
        stroke: "#fff",
        strokeScaling: "canvas",
      }),
      createElement("Path", { d: "M0 0L10 10", width: 10, height: 10, strokeScaling: "canvas" }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("rejects dashed canvas-stable Path strokes with the dedicated fatal code", () => {
    for (const strokeDasharray of ["4,2", "   "]) {
      const tree = createElement(
        "Canvas",
        { width: 100, height: 100 },
        createElement("Path", {
          id: "path-hairline",
          d: "M0 0L10 10",
          width: 10,
          height: 10,
          stroke: "#fff",
          strokeScaling: "canvas",
          strokeDasharray,
        }),
      );
      expect(() => validate(tree)).toThrowError(
        expect.objectContaining({
          code: "CANVAS_STROKE_DASH_UNSUPPORTED",
          stage: "validate",
          nodeId: "path-hairline",
        }),
      );
    }
  });

  it("allows inert canvas-stable Path dash props when no stroke is painted", () => {
    for (const stroke of [undefined, "none", " NONE "]) {
      const tree = createElement(
        "Canvas",
        { width: 100, height: 100 },
        createElement("Path", {
          d: "M0 0L10 10",
          width: 10,
          height: 10,
          stroke,
          strokeScaling: "canvas",
          strokeDasharray: "4,2",
        }),
      );
      expect(() => validate(tree)).not.toThrow();
    }
  });

  it("rejects an invalid strokeScaling literal", () => {
    const tree = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", { strokeScaling: "viewport" as unknown as "canvas" }),
    );
    expect(() => validate(tree)).toThrowError(
      expect.objectContaining({ code: "VALIDATION", stage: "validate", nodeId: "<Box>" }),
    );
  });

  it("rejects dashed canvas-stable borders with the dedicated fatal code", () => {
    for (const strokeDasharray of ["5,5", "   "]) {
      const tree = createElement(
        "Canvas",
        { width: 100, height: 100 },
        createElement("Box", {
          id: "hairline",
          borderWidth: 1,
          borderColor: "#fff",
          strokeScaling: "canvas",
          strokeDasharray,
        }),
      );
      expect(() => validate(tree)).toThrowError(
        expect.objectContaining({
          code: "CANVAS_STROKE_DASH_UNSUPPORTED",
          stage: "validate",
          nodeId: "hairline",
        }),
      );
    }
  });

  it("accepts the maximum layout-tree depth", () => {
    expect(() => validate(createNestedLayoutTree(MAX_LAYOUT_TREE_DEPTH))).not.toThrow();
  });

  it("does not count embedded rich-text nodes against the layout-tree depth", () => {
    const deepestText = createElement(
      "Text",
      { font: "NotoSansJP", fontSizePx: 12 },
      createElement("Inline", { color: "#ff0000" }, "境界"),
      createElement("InlineRect", { inlineSizePx: 2, color: "#ff0000" }),
    );
    expect(() =>
      validate(createNestedLayoutTree(MAX_LAYOUT_TREE_DEPTH, deepestText)),
    ).not.toThrow();
  });

  it("rejects a layout tree beyond the maximum depth with a structured fatal error", () => {
    expect.assertions(6);
    try {
      validate(createNestedLayoutTree(MAX_LAYOUT_TREE_DEPTH + 1));
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("LAYOUT_TREE_MAX_DEPTH");
      expect((error as FatalError).stage).toBe("validate");
      expect((error as FatalError).nodeId).toBe("<Box>");
      expect((error as FatalError).context?.maxDepth).toBe(MAX_LAYOUT_TREE_DEPTH);
      expect((error as FatalError).context?.actualDepth).toBe(MAX_LAYOUT_TREE_DEPTH + 1);
    }
  });

  it("throws FatalError if root is not Canvas", () => {
    const tree = createElement("Flex", { direction: "row" });
    expect(() => validate(tree)).toThrow("root node must be Canvas");
    try {
      validate(tree);
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("VALIDATION");
    }
  });

  it("throws for nested Canvas", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Canvas", { width: 400, height: 300 }),
    );
    expect(() => validate(tree)).toThrow("Canvas cannot be nested");
  });

  it("throws for deeply nested Canvas", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Flex",
        { direction: "row" },
        createElement("Canvas", { width: 200, height: 200 }),
      ),
    );
    expect(() => validate(tree)).toThrow("Canvas cannot be nested");
  });

  it("throws for non-string Text children", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      // @ts-expect-error intentional invalid runtime validation case
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement("Box", { width: 10, height: 10 }),
      ),
    );
    expect(() => validate(tree)).toThrow(
      "Text children must be strings, Inline, InlineBox, InlineRect, or Ruby only",
    );
  });

  it("passes for Text with string children", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Text", { font: "Arial", fontSizePx: 16 }, "Hello"),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("passes for Text with Inline children", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        "Hello ",
        createElement("Inline", { color: "#ff0000" }, "World"),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("passes for Inline and Ruby children throughout InlineBox, Ruby, and Rt", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement(
          "InlineBox",
          { background: "#f0f0f0" },
          createElement("Inline", { color: "#ff0000" }, "prefix"),
          createElement(
            "Ruby",
            { rubyPosition: "alternate" },
            createElement("Inline", { color: "#008000" }, "東京"),
            createElement("Rt", {}, createElement("Inline", { color: "#ff0000" }, "とうきょう")),
            createElement("Rt", {}, "Tokyo"),
          ),
        ),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("passes for all props declared by InlineBoxProps", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement(
          "InlineBox",
          {
            font: "Arial",
            fallback: ["sans-serif"],
            fontWeight: 700,
            fontStyle: "italic",
            fontSizePx: 18,
            letterSpacingPx: 1,
            color: "#111111",
            language: "en",
            paddingInline: [4, 6],
            background: "#f0f0f0",
            borderColor: "#333333",
            borderWidth: 1,
            borderRadius: 3,
          },
          "valid",
        ),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("throws for unsupported InlineBox props", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        // @ts-expect-error intentional invalid runtime validation case
        createElement("InlineBox", { textCombineUpright: "all" }, "bad"),
      ),
    );
    expect(() => validate(tree)).toThrow('InlineBox does not support prop "textCombineUpright"');
  });

  it("throws for unsupported InlineBox children", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        // @ts-expect-error intentional invalid runtime validation case
        createElement("InlineBox", {}, createElement("Box", { width: 10, height: 10 })),
      ),
    );
    expect(() => validate(tree)).toThrow(
      "InlineBox children must be strings, Inline, InlineBox, InlineRect, or Ruby only",
    );
  });

  it("accepts InlineRect in Text, Inline, and InlineBox", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement("InlineRect", { inlineSizePx: 2, color: "#111827" }),
        createElement(
          "Inline",
          {},
          createElement("InlineRect", {
            inlineSizePx: 8,
            blockSizePx: 2,
            advancePx: 8,
            blockAlign: "end",
            color: "red",
            borderRadiusPx: 1,
            opacity: 0.5,
            paintOrder: "behind",
            animate: {
              keyframes: [
                { at: 0, opacity: 0 },
                { at: 1, opacity: 1 },
              ],
              durationMs: 500,
            },
          }),
        ),
        createElement(
          "InlineBox",
          {},
          createElement("InlineRect", {
            inlineSizePx: 4,
            blockSizePx: "line",
            color: "#2563eb",
          }),
        ),
      ),
    );

    expect(() => validate(tree)).not.toThrow();
  });

  it.each([
    ["inlineSizePx", { inlineSizePx: 0, color: "#000" }],
    ["finite inlineSizePx", { inlineSizePx: Number.NaN, color: "#000" }],
    ["blockSizePx", { inlineSizePx: 2, blockSizePx: 0, color: "#000" }],
    ["advancePx", { inlineSizePx: 2, advancePx: -1, color: "#000" }],
    ["blockAlign", { inlineSizePx: 2, blockAlign: "baseline", color: "#000" }],
    ["color", { inlineSizePx: 2, color: "not-a-color" }],
    ["borderRadiusPx", { inlineSizePx: 2, borderRadiusPx: -1, color: "#000" }],
    ["opacity", { inlineSizePx: 2, opacity: 1.1, color: "#000" }],
    ["paintOrder", { inlineSizePx: 2, paintOrder: "middle", color: "#000" }],
  ] as const)("rejects invalid InlineRect %s with a stable error code", (_label, props) => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement("InlineRect", props as never),
      ),
    );

    expect(() => validate(tree)).toThrow(expect.objectContaining({ code: "INLINE_RECT_INVALID" }));
  });

  it("rejects InlineRect children and direct Ruby/Rt placement", () => {
    const withChild = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement("InlineRect", {
          inlineSizePx: 2,
          color: "#000",
          children: ["bad"],
        } as never),
      ),
    );
    expect(() => validate(withChild)).toThrow(
      expect.objectContaining({ code: "INLINE_RECT_INVALID" }),
    );

    const invalidRect = createElement("InlineRect", {
      inlineSizePx: 2,
      color: "#000",
    }) as unknown as VNode;
    const ruby = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement("Ruby", {}, invalidRect as never, createElement("Rt", {}, "annotation")),
      ),
    );
    expect(() => validate(ruby)).toThrow(
      expect.objectContaining({ code: "INLINE_RECT_INVALID_PARENT" }),
    );
  });

  it("enforces the per-Text InlineRect resource limit", () => {
    const rects = Array.from({ length: MAX_INLINE_RECTS + 1 }, () =>
      createElement("InlineRect", { inlineSizePx: 1, color: "#000" }),
    );
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Text", { font: "Arial", fontSizePx: 16 }, ...rects),
    );

    expect(() => validate(tree)).toThrow(
      expect.objectContaining({ code: "INLINE_RECT_COMPLEXITY_LIMIT" }),
    );
  });

  it("throws when Inline is outside an inline text container", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Inline", { color: "#ff0000" }, "bad"),
    );
    expect(() => validate(tree)).toThrow(
      "Inline can only be nested inside Text, TextOnPath, Inline, InlineBox, Ruby, or Rt",
    );
  });

  it("throws for unsupported Inline props", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        // @ts-expect-error intentional invalid runtime validation case
        createElement("Inline", { margin: 8 }, "bad"),
      ),
    );
    expect(() => validate(tree)).toThrow('Inline does not support prop "margin"');
  });

  it("passes for Inline decoration props declared by InlineProps", () => {
    // Regression: the hand-maintained allowlist once rejected the typed
    // decoration props even though the pipeline supports them end-to-end.
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement(
          "Inline",
          {
            background: "#ffe082",
            borderColor: "#f57f17",
            borderWidth: 1,
            borderRadius: [2, 2, 2, 2],
            paddingInline: [4, 4],
            textCombineUpright: "all",
          },
          "decorated",
        ),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("passes for vertical Text that uses Inline", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16, writingMode: "vertical-rl" },
        "A",
        createElement("Inline", { color: "#ff0000" }, "B"),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("validates Text-local flow exclusions and tab policy", () => {
    const valid = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          font: "Arial",
          fontSizePx: 16,
          width: 240,
          height: 160,
          tabSize: 2,
          flowMinRegionWidthPx: 12,
          flowExclusions: [{ kind: "rect", x: 40, y: 20, width: 80, height: 60, marginPx: 4 }],
        },
        "flow",
      ),
    );
    expect(() => validate(valid)).not.toThrow();

    const invalidTab = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Text", { font: "Arial", fontSizePx: 16, tabSize: 0 }, "flow"),
    );
    expect(() => validate(invalidTab)).toThrow(/tabSize/);

    const missingFrame = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          font: "Arial",
          fontSizePx: 16,
          flowExclusions: [{ kind: "circle", cx: 40, cy: 40, r: 20 }],
        },
        "flow",
      ),
    );
    expect(() => validate(missingFrame)).toThrow(/requires positive finite/);
  });

  it("passes for Text with Ruby children", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        "東京",
        createElement(
          "Ruby",
          { rubyAlign: "space-between" },
          "都",
          createElement("Rt", { lineHeight: 1 }, "と"),
        ),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("passes for multi-level Ruby children and placement tuning props", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement(
          "Ruby",
          {
            rubyPosition: "alternate",
            rubyGapPx: -1,
            rubyOffsetPx: 2,
          },
          "大学",
          createElement("Rt", {}, "だいがく"),
          createElement("Rt", {}, "University"),
        ),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("passes for inter-character Ruby with fallback handled by the engine", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement(
          "Ruby",
          { rubyPosition: "inter-character" },
          "案",
          createElement("Rt", {}, "あん"),
        ),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("throws for invalid rubyAlign", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        // @ts-expect-error intentional invalid runtime validation case
        createElement("Ruby", { rubyAlign: "stretch" }, "都", createElement("Rt", {}, "と")),
      ),
    );
    expect(() => validate(tree)).toThrow(
      'Ruby "rubyAlign" must be "start", "center", "space-between", or "space-around"',
    );
  });

  it("throws for invalid rubyLineSizing", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        // @ts-expect-error intentional invalid runtime validation case
        createElement("Ruby", { rubyLineSizing: "loose" }, "都", createElement("Rt", {}, "と")),
      ),
    );
    expect(() => validate(tree)).toThrow('Ruby "rubyLineSizing" must be "stable" or "css"');
  });

  it("throws when Ruby is outside Text, Inline, or InlineBox", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Ruby", {}, "東", createElement("Rt", {}, "とう")),
    );
    expect(() => validate(tree)).toThrow(
      "Ruby can only be nested inside Text, Inline, or InlineBox",
    );
  });

  it("throws when Rt is outside Ruby", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Flex", {}, createElement("Rt", {}, "とう")),
    );
    expect(() => validate(tree)).toThrow("Rt can only be nested inside Ruby");
  });

  it("throws when Ruby does not contain an Rt", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Text", { font: "Arial", fontSizePx: 16 }, createElement("Ruby", {}, "東")),
    );
    expect(() => validate(tree)).toThrow("Ruby must contain at least one Rt child");
  });

  it("throws when Ruby is missing base text", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        { font: "Arial", fontSizePx: 16 },
        createElement("Ruby", {}, createElement("Rt", {}, "とう")),
      ),
    );
    expect(() => validate(tree)).toThrow("Ruby must contain base text before its Rt child");
  });

  it("throws for duplicate ids", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Box", { id: "dup", width: 10, height: 10 }),
      createElement("Box", { id: "dup", width: 20, height: 20 }),
    );
    expect(() => validate(tree)).toThrow('duplicate id "dup"');
  });

  it("throws for invalid color in background", () => {
    const tree = createElement("Canvas", {
      width: 800,
      height: 600,
      background: "not-a-color",
    });
    expect(() => validate(tree)).toThrow("Invalid color format");
  });

  it("accepts CSS named color in background", () => {
    const tree = createElement("Canvas", {
      width: 800,
      height: 600,
      background: "red",
    });
    expect(() => validate(tree)).not.toThrow();
  });

  it("passes for finite transform values on supported nodes", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Box", {
        width: 120,
        height: 40,
        transform: { translateX: 10, scaleX: -1, originX: 60 },
      }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("throws for non-finite transform values", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Box", {
        width: 120,
        height: 40,
        transform: { rotateDeg: Number.POSITIVE_INFINITY },
      }),
    );
    expect(() => validate(tree)).toThrow('transform "rotateDeg" must be a finite number');
  });

  it("throws when Canvas receives transform", () => {
    // @ts-expect-error intentional invalid runtime validation case
    const tree = createElement("Canvas", {
      width: 800,
      height: 600,
      transform: { translateX: 10 },
    });
    expect(() => validate(tree)).toThrow('Canvas does not support prop "transform"');
  });

  it("passes for valid hex color", () => {
    const tree = createElement("Canvas", {
      width: 800,
      height: 600,
      background: "#ff0000",
    });
    expect(() => validate(tree)).not.toThrow();
  });

  it("throws for Image with children", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        // @ts-expect-error intentional invalid runtime validation case
        "Image",
        {
          src: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
          width: 100,
          height: 100,
        },
        "bad child",
      ),
    );
    expect(() => validate(tree)).toThrow("Image must not have children");
  });

  it.each(["width", "height"] as const)("throws when Image is missing %s", (dimension) => {
    const props: { src: string; width?: number; height?: number } = {
      src: "data:image/png;base64,AA==",
      width: 100,
      height: 100,
    };
    delete props[dimension];
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      // @ts-expect-error intentional missing required runtime prop
      createElement("Image", props),
    );
    expect(() => validate(tree)).toThrow(`Image requires a '${dimension}' prop`);
  });

  it("passes for Shape with inline geometry", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Shape", {
        geometry: {
          viewBox: { width: 10, height: 10 },
          root: { kind: "path", d: "M0 0H10V10Z" },
        },
        width: 100,
        height: 100,
      }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("throws when Shape is missing geometry", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      // @ts-expect-error intentional invalid runtime validation case
      createElement("Shape", { width: 100, height: 100 }),
    );
    expect(() => validate(tree)).toThrow("Shape requires either 'geometry' or 'geometryId'");
  });

  it("passes for Symbol with inline definition", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Symbol", {
        symbol: {
          geometry: {
            viewBox: { width: 10, height: 10 },
            root: { kind: "path", d: "M0 0H10V10Z" },
          },
        },
        width: 100,
        height: 100,
      }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("allows Path fill='none'", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Path", {
        d: "M 0 0 L 100 100",
        width: 100,
        height: 100,
        fill: "none",
      }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("allows Path stroke='none'", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Path", {
        d: "M 0 0 L 100 100",
        width: 100,
        height: 100,
        stroke: "none",
      }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("rejects Svg content with script tag", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Svg", {
        content: `<svg><script>alert("x")</script></svg>`,
        width: 100,
        height: 100,
      }),
    );
    expect(() => validate(tree)).toThrow("Svg content contains disallowed markup");
  });

  it("rejects Svg content with inline event handler", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Svg", {
        content: `<svg><g onload="alert(1)"/></svg>`,
        width: 100,
        height: 100,
      }),
    );
    expect(() => validate(tree)).toThrow("Svg content contains disallowed markup");
  });

  it("rejects Svg content with javascript URI", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Svg", {
        content: `<svg><a href="javascript:alert(1)">x</a></svg>`,
        width: 100,
        height: 100,
      }),
    );
    expect(() => validate(tree)).toThrow("Svg content contains disallowed markup");
  });

  it("rejects Svg content with foreignObject", () => {
    const tree = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Svg", {
        content: `<svg><foreignObject width="10" height="10"/></svg>`,
        width: 100,
        height: 100,
      }),
    );
    expect(() => validate(tree)).toThrow("Svg content contains disallowed markup");
  });
});
