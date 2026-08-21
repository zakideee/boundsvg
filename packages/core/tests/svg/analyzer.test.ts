import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RecoverableError } from "../../src/errors.js";
import {
  type AnalyzeSvgOptions,
  analyzeSvg,
  buildHybridVNode,
  svgToHybridVNode,
} from "../../src/svg/analyzer.js";
import type { BoxVNode, CanvasVNode, SvgVNode, TextVNode, VNode } from "../../src/vnode/types.js";

function expectCanvasVNode(vnode: VNode): CanvasVNode {
  expect(vnode.type).toBe("Canvas");
  if (vnode.type !== "Canvas") {
    throw new Error("Expected Canvas VNode");
  }
  return vnode;
}

function expectVNodeChild(child: VNode["children"][number] | undefined): VNode {
  expect(child).toBeDefined();
  if (!child || typeof child === "string") {
    throw new Error("Expected VNode child");
  }
  return child;
}

const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf-8");

const defaultOptions: AnalyzeSvgOptions = {
  defaultFont: "NotoSansJP",
  wrap: "word",
  fit: "shrink",
};

describe("analyzeSvg", () => {
  it("extracts text elements from simple SVG", () => {
    const svg = fixture("simple-text.svg");
    const result = analyzeSvg(svg, defaultOptions);

    expect(result.textElements.length).toBe(1);
    expect(result.textElements[0]!.text).toBe("Hello World");
    expect(result.viewBox).toEqual({ minX: 0, minY: 0, width: 400, height: 200 });
    expect(result.dimensions).toEqual({ width: 400, height: 200 });
  });

  it("extracts multiple text elements", () => {
    const svg = fixture("multi-text.svg");
    const result = analyzeSvg(svg, defaultOptions);

    expect(result.textElements.length).toBe(3);
    expect(result.textElements[0]!.text).toBe("Title Text");
    expect(result.textElements[1]!.text).toBe("Subtitle description goes here");
    expect(result.textElements[2]!.text).toBe("Footer note");
  });

  it("classifies elements correctly", () => {
    const svg = fixture("simple-text.svg");
    const result = analyzeSvg(svg, defaultOptions);

    expect(result.elements.length).toBe(1);
    expect(result.elements[0]!.kind).toBe("text");
    expect(result.elements[0]!.textElement).toBeDefined();
  });

  it("generates non-text SVG content (text stripped)", () => {
    const svg = fixture("text-with-rect.svg");
    const result = analyzeSvg(svg, defaultOptions);

    expect(result.nonTextSvgContent).toContain("<rect");
    expect(result.nonTextSvgContent).not.toContain("<text");
  });

  it("infers BBOX from surrounding rect elements", () => {
    const svg = fixture("text-with-rect.svg");
    const result = analyzeSvg(svg, defaultOptions);

    // First text (x=20, y=48) should be in the first rect (x=10, y=10, w=480, h=60)
    const firstText = result.elements[0]!;
    expect(firstText.bbox).toBeDefined();
    expect(firstText.bboxSource).toBe("rect-inferred");
    expect(firstText.bbox!.x).toBe(10);
    expect(firstText.bbox!.y).toBe(10);
    expect(firstText.bbox!.width).toBe(480);
    expect(firstText.bbox!.height).toBe(60);
  });

  it("uses explicit BBOX when provided", () => {
    const svg = fixture("simple-text.svg");
    const bbox = { x: 50, y: 50, width: 200, height: 100 };
    const result = analyzeSvg(svg, {
      ...defaultOptions,
      textBBoxes: { 0: bbox },
    });

    expect(result.elements[0]!.bbox).toEqual(bbox);
    expect(result.elements[0]!.bboxSource).toBe("explicit");
  });

  it("falls back to viewBox when no rect contains text", () => {
    const svg = fixture("simple-text.svg");
    const result = analyzeSvg(svg, defaultOptions);

    // simple-text.svg has no rects, so should fall back to viewBox
    const element = result.elements[0]!;
    expect(element.bboxSource).toBe("viewbox-fallback");
    expect(element.bbox).toEqual({ x: 0, y: 0, width: 400, height: 200 });

    // Should emit warning with stage
    const vbWarning = result.warnings.find((w) => w.code === "BBOX_INFERRED_FROM_VIEWBOX");
    expect(vbWarning).toBeDefined();
    expect(vbWarning!.stage).toBe("analyzer");
  });

  it("detects unsupported text properties", () => {
    const svg = fixture("unsupported-props.svg");
    const result = analyzeSvg(svg, defaultOptions);

    const unsupported = result.warnings.filter((w) => w.code === "SVG_UNSUPPORTED_PROPERTY");
    expect(unsupported.length).toBeGreaterThan(0);
    for (const w of unsupported) {
      expect(w.stage).toBe("analyzer");
    }
    const attrs = unsupported.map((w) => w.context?.attribute);
    expect(attrs).toContain("transform");
    expect(attrs).toContain("textLength");
    expect(attrs).toContain("text-decoration");
  });

  it("handles vertical text", () => {
    const svg = fixture("vertical-text.svg");
    const result = analyzeSvg(svg, defaultOptions);

    expect(result.textElements.length).toBe(1);
    expect(result.textElements[0]!.writingMode).toBe("vertical-rl");
    expect(result.textElements[0]!.language).toBe("ja");
  });

  it("detects style blocks and warns", () => {
    const svg = `<svg viewBox="0 0 100 100"><style>.cls { fill: red; }</style><text class="cls" x="10" y="20">Styled</text></svg>`;
    const result = analyzeSvg(svg, defaultOptions);

    const styleWarning = result.warnings.find((w) => w.code === "SVG_STYLE_BLOCK_DETECTED");
    expect(styleWarning).toBeDefined();
    expect(styleWarning!.stage).toBe("analyzer");
  });

  it("detects nested svg elements and warns", () => {
    const svg = `<svg viewBox="0 0 100 100"><svg viewBox="0 0 20 20"><rect width="20" height="20" /></svg></svg>`;
    const result = analyzeSvg(svg, defaultOptions);

    const nestedWarning = result.warnings.find((w) => w.code === "SVG_NESTED_SVG_DETECTED");
    expect(nestedWarning).toBeDefined();
    expect(nestedWarning!.stage).toBe("analyzer");
  });

  it("disables BBOX inference with inferBBox=false", () => {
    const svg = fixture("text-with-rect.svg");
    const result = analyzeSvg(svg, { ...defaultOptions, inferBBox: false });

    for (const el of result.elements) {
      expect(el.bbox).toBeUndefined();
    }
  });

  it("handles SVG with no text elements", () => {
    const svg = `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="red" /></svg>`;
    const result = analyzeSvg(svg, defaultOptions);

    expect(result.textElements.length).toBe(0);
    expect(result.elements.length).toBe(0);
    expect(result.nonTextSvgContent).toContain("<rect");
  });
});

describe("buildHybridVNode", () => {
  it("builds VNode tree with Canvas > Box > [Svg, Box+Text...]", () => {
    const svg = fixture("text-with-rect.svg");
    const analysis = analyzeSvg(svg, defaultOptions);
    const { vnode } = buildHybridVNode(analysis, defaultOptions);
    const canvas = expectCanvasVNode(vnode);

    expect(canvas.props.width).toBe(500);
    expect(canvas.props.height).toBe(300);

    // First child: Box wrapper
    const wrapper = expectVNodeChild(canvas.children[0]);
    expect(wrapper.type).toBe("Box");
    if (wrapper.type !== "Box") {
      throw new Error("Expected Box wrapper");
    }
    expect(wrapper.props.position).toBe("relative");

    // Children: Svg + text boxes
    expect(wrapper.children.length).toBeGreaterThan(1);

    // First child should be Svg (non-text background)
    const svgChild = expectVNodeChild(wrapper.children[0]) as SvgVNode;
    if (svgChild.type !== "Svg") {
      throw new Error("Expected Svg child");
    }
    expect(svgChild.type).toBe("Svg");

    // Remaining children should be Box(absolute) > Text
    const textBoxes = wrapper.children.slice(1);
    for (const child of textBoxes) {
      if (typeof child === "string") {
        continue;
      }
      expect(child.type).toBe("Box");
      if (child.type !== "Box") {
        throw new Error("Expected absolute Box child");
      }
      expect(child.props.position).toBe("absolute");
      expect(child.children.length).toBe(1);
      const textNode = expectVNodeChild(child.children[0]) as TextVNode;
      if (textNode.type !== "Text") {
        throw new Error("Expected Text node");
      }
      expect(textNode.type).toBe("Text");
    }
  });

  it("applies background to Canvas", () => {
    const svg = fixture("simple-text.svg");
    const analysis = analyzeSvg(svg, defaultOptions);
    const { vnode } = buildHybridVNode(analysis, {
      ...defaultOptions,
      background: "#ffffff",
    });

    const canvas = expectCanvasVNode(vnode);
    expect(canvas.props.background).toBe("#ffffff");
  });

  it("sets text props from SVG attributes", () => {
    const svg = fixture("multi-text.svg");
    const options: AnalyzeSvgOptions = {
      ...defaultOptions,
      fontAliasMap: { "Noto Sans JP": "NotoSansJP" },
    };
    const analysis = analyzeSvg(svg, options);
    const { vnode } = buildHybridVNode(analysis, options);

    const canvas = expectCanvasVNode(vnode);
    const wrapper = expectVNodeChild(canvas.children[0]) as BoxVNode;
    const firstTextBox = expectVNodeChild(wrapper.children[1]) as BoxVNode;
    const textNode = expectVNodeChild(firstTextBox.children[0]) as TextVNode;
    expect(textNode.type).toBe("Text");
    expect(textNode.props.font).toBe("NotoSansJP");
    expect(textNode.props.fontSizePx).toBe(28);
    expect(textNode.props.fontWeight).toBe(700);
    expect(textNode.props.color).toBe("#111111");
  });
});

describe("svgToHybridVNode", () => {
  it("convenience function works end-to-end", () => {
    const svg = fixture("simple-text.svg");
    const { vnode, warnings } = svgToHybridVNode(svg, defaultOptions);
    const canvas = expectCanvasVNode(vnode);
    expect(canvas.props.width).toBe(400);
    expect(canvas.props.height).toBe(200);

    // Should have viewBox fallback warning
    expect(warnings.some((w) => w instanceof RecoverableError)).toBe(true);
  });

  it("uses font alias map", () => {
    const svg = fixture("multi-text.svg");
    const { vnode } = svgToHybridVNode(svg, {
      ...defaultOptions,
      fontAliasMap: { "Noto Sans JP": "NotoSansJP", Arial: "ArialAlias" },
    });
    const canvas = expectCanvasVNode(vnode);
    const wrapper = expectVNodeChild(canvas.children[0]) as BoxVNode;
    const thirdTextBox = expectVNodeChild(wrapper.children[3]) as BoxVNode;
    const textNode = expectVNodeChild(thirdTextBox.children[0]) as TextVNode;
    expect(textNode.props.font).toBe("ArialAlias");
  });
});

describe("analyzeSvg — external image warnings", () => {
  it("warns on <image> with relative href", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <image href="background.png" width="100" height="100"/>
    </svg>`;
    const result = analyzeSvg(svg, defaultOptions);
    const imageWarnings = result.warnings.filter((w) => w.code === "SVG_EXTERNAL_IMAGE_DETECTED");
    expect(imageWarnings.length).toBe(1);
    expect(imageWarnings[0]!.message).toContain("background.png");
    expect(imageWarnings[0]!.stage).toBe("analyzer");
  });

  it("warns on <image> with absolute URL href", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <image href="https://example.com/image.png" width="100" height="100"/>
    </svg>`;
    const result = analyzeSvg(svg, defaultOptions);
    const imageWarnings = result.warnings.filter((w) => w.code === "SVG_EXTERNAL_IMAGE_DETECTED");
    expect(imageWarnings.length).toBe(1);
    expect(imageWarnings[0]!.message).toContain("https://example.com/image.png");
  });

  it("does not warn on <image> with data URI", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <image href="data:image/png;base64,AAAA" width="100" height="100"/>
    </svg>`;
    const result = analyzeSvg(svg, defaultOptions);
    const imageWarnings = result.warnings.filter((w) => w.code === "SVG_EXTERNAL_IMAGE_DETECTED");
    expect(imageWarnings.length).toBe(0);
  });

  it("does not warn when no <image> elements exist", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="red"/>
    </svg>`;
    const result = analyzeSvg(svg, defaultOptions);
    const imageWarnings = result.warnings.filter((w) => w.code === "SVG_EXTERNAL_IMAGE_DETECTED");
    expect(imageWarnings.length).toBe(0);
  });
});
