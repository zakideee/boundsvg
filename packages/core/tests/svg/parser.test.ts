import { describe, expect, it } from "vitest";
import { extractSvgText, svgTextToTextProps, svgTextToVNode } from "../../src/svg/parser.js";
import type { CanvasVNode, FlexVNode, TextVNode, VNode } from "../../src/vnode/types.js";

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

describe("extractSvgText", () => {
  it("extracts a simple <text> element", () => {
    const svg = `<svg><text font-family="Inter" font-size="24px" fill="#333" x="10" y="40">Hello World</text></svg>`;
    const result = extractSvgText(svg);

    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("Hello World");
    expect(result[0]!.fontFamily).toBe("Inter");
    expect(result[0]!.fontSizePx).toBe(24);
    expect(result[0]!.fill).toBe("#333");
    expect(result[0]!.x).toBe(10);
    expect(result[0]!.y).toBe(40);
  });

  it("extracts multiple <text> elements", () => {
    const svg = `
      <svg>
        <text font-size="32" fill="#000">Title</text>
        <text font-size="16" fill="#666">Subtitle</text>
      </svg>
    `;
    const result = extractSvgText(svg);

    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("Title");
    expect(result[0]!.fontSizePx).toBe(32);
    expect(result[1]!.text).toBe("Subtitle");
    expect(result[1]!.fontSizePx).toBe(16);
  });

  it("extracts <tspan> children", () => {
    const svg = `
      <svg>
        <text font-family="Arial" font-size="20">
          <tspan x="10" y="30">Line one</tspan>
          <tspan x="10" dy="24">Line two</tspan>
          <tspan x="10" dy="24">Line three</tspan>
        </text>
      </svg>
    `;
    const result = extractSvgText(svg);

    expect(result).toHaveLength(1);
    expect(result[0]!.tspans).toHaveLength(3);
    expect(result[0]!.tspans[0]!.text).toBe("Line one");
    expect(result[0]!.tspans[0]!.y).toBe(30);
    expect(result[0]!.tspans[1]!.text).toBe("Line two");
    expect(result[0]!.tspans[1]!.dy).toBe(24);
    expect(result[0]!.text).toBe("Line one\nLine two\nLine three");
  });

  it("estimates lineHeightPx from tspan dy values", () => {
    const svg = `
      <svg>
        <text font-size="16">
          <tspan x="0" y="20">A</tspan>
          <tspan x="0" dy="22">B</tspan>
          <tspan x="0" dy="22">C</tspan>
        </text>
      </svg>
    `;
    const result = extractSvgText(svg);
    expect(result[0]!.lineHeightPx).toBe(22);
  });

  it("parses inline style attributes", () => {
    const svg = `<svg><text style="font-family: 'Noto Sans JP'; font-size: 28px; fill: #ff0000; font-weight: bold">Styled</text></svg>`;
    const result = extractSvgText(svg);

    expect(result[0]!.fontFamily).toBe("Noto Sans JP");
    expect(result[0]!.fontSizePx).toBe(28);
    expect(result[0]!.fill).toBe("#ff0000");
    expect(result[0]!.fontWeight).toBe(700);
  });

  it("prefers explicit attributes over style", () => {
    const svg = `<svg><text font-size="32" style="font-size: 16px">Text</text></svg>`;
    const result = extractSvgText(svg);
    // Explicit attribute wins over style
    expect(result[0]!.fontSizePx).toBe(32);
  });

  it("handles font-size in pt units", () => {
    const svg = `<svg><text font-size="12pt">Text</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.fontSizePx).toBe(16); // 12pt * 4/3 = 16px
  });

  it("parses font-weight numeric values", () => {
    const svg = `<svg><text font-weight="600">Semi Bold</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.fontWeight).toBe(600);
  });

  it("parses font-style italic", () => {
    const svg = `<svg><text font-style="italic">Italic</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.fontStyle).toBe("italic");
  });

  it("parses text-anchor", () => {
    const svg = `<svg><text text-anchor="middle">Centered</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.textAnchor).toBe("middle");
  });

  it("parses writing-mode vertical", () => {
    const svg = `<svg><text writing-mode="tb">縦書き</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.writingMode).toBe("vertical-rl");
  });

  it("parses stroke attributes", () => {
    const svg = `<svg><text stroke="#000" stroke-width="2">Stroked</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.stroke).toBe("#000");
    expect(result[0]!.strokeWidth).toBe(2);
  });

  it("parses stroke style attributes", () => {
    const svg = `<svg><text stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="5,3" stroke-miterlimit="8">Styled</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.strokeLinecap).toBe("round");
    expect(result[0]!.strokeLinejoin).toBe("bevel");
    expect(result[0]!.strokeDasharray).toBe("5,3");
    expect(result[0]!.strokeMiterlimit).toBe(8);
  });

  it("parses xml:lang attribute", () => {
    const svg = `<svg><text xml:lang="ja">日本語</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.language).toBe("ja");
  });

  it("unescapes XML entities in text content", () => {
    const svg = `<svg><text>A &amp; B &lt; C</text></svg>`;
    const result = extractSvgText(svg);
    expect(result[0]!.text).toBe("A & B < C");
  });

  it("returns empty array for SVG without text", () => {
    const svg = `<svg><rect width="100" height="100" fill="red"/></svg>`;
    const result = extractSvgText(svg);
    expect(result).toHaveLength(0);
  });

  it("handles tspan with per-tspan overrides", () => {
    const svg = `
      <svg>
        <text font-family="Arial" font-size="16" fill="#000">
          <tspan fill="#f00" font-weight="700">Bold Red</tspan>
          <tspan>Normal</tspan>
        </text>
      </svg>
    `;
    const result = extractSvgText(svg);
    expect(result[0]!.tspans[0]!.fill).toBe("#f00");
    expect(result[0]!.tspans[0]!.fontWeight).toBe(700);
    expect(result[0]!.tspans[1]!.fill).toBeUndefined();
  });
});

describe("svgTextToTextProps", () => {
  it("converts basic SvgTextElement to TextProps", () => {
    const props = svgTextToTextProps(
      {
        text: "Hello",
        fontFamily: "Inter",
        fontSizePx: 24,
        fontWeight: 700,
        fill: "#333",
        tspans: [],
      },
      { defaultFont: "NotoSansJP" },
    );

    expect(props.font).toBe("Inter");
    expect(props.fontSizePx).toBe(24);
    expect(props.fontWeight).toBe(700);
    expect(props.color).toBe("#333");
    expect(props.children).toBe("Hello");
  });

  it("uses fontAliasMap to resolve font family", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontFamily: "Noto Sans JP", fontSizePx: 16, tspans: [] },
      {
        defaultFont: "Fallback",
        fontAliasMap: { "Noto Sans JP": "NotoSansJP" },
      },
    );

    expect(props.font).toBe("NotoSansJP");
  });

  it("falls back to defaultFont when fontFamily is missing", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontSizePx: 16, tspans: [] },
      { defaultFont: "NotoSansJP" },
    );

    expect(props.font).toBe("NotoSansJP");
  });

  it("falls back to defaultFont for unresolved alias", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontFamily: "serif", fontSizePx: 16, tspans: [] },
      { defaultFont: "MyFont", fontAliasMap: {} },
    );

    // "serif" is a generic family, falls through to defaultFont
    expect(props.font).toBe("MyFont");
  });

  it("maps text-anchor middle → textAlign center", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontSizePx: 16, textAnchor: "middle", tspans: [] },
      { defaultFont: "Font" },
    );

    expect(props.textAlign).toBe("center");
  });

  it("maps text-anchor end → textAlign end", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontSizePx: 16, textAnchor: "end", tspans: [] },
      { defaultFont: "Font" },
    );

    expect(props.textAlign).toBe("end");
  });

  it("maps writing-mode vertical-rl", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontSizePx: 16, writingMode: "vertical-rl", tspans: [] },
      { defaultFont: "Font" },
    );

    expect(props.writingMode).toBe("vertical-rl");
  });

  it("maps stroke to textStroke", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontSizePx: 16, stroke: "#000", strokeWidth: 2, tspans: [] },
      { defaultFont: "Font" },
    );

    expect(props.textStroke).toBe("#000");
    expect(props.textStrokeWidth).toBe(2);
  });

  it("maps stroke style attrs to textStroke props", () => {
    const props = svgTextToTextProps(
      {
        text: "Text",
        fontSizePx: 16,
        stroke: "#000",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "bevel",
        strokeDasharray: "5,3",
        strokeMiterlimit: 8,
        tspans: [],
      },
      { defaultFont: "Font" },
    );

    expect(props.textStrokeLinecap).toBe("round");
    expect(props.textStrokeLinejoin).toBe("bevel");
    expect(props.textStrokeDasharray).toBe("5,3");
    expect(props.textStrokeMiterlimit).toBe(8);
  });

  it("maps language ja", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontSizePx: 16, language: "ja", tspans: [] },
      { defaultFont: "Font" },
    );

    expect(props.language).toBe("ja");
  });

  it("passes wrap and fit options", () => {
    const props = svgTextToTextProps(
      { text: "Text", fontSizePx: 16, tspans: [] },
      { defaultFont: "Font", wrap: "word", fit: "shrink" },
    );

    expect(props.wrap).toBe("word");
    expect(props.fit).toBe("shrink");
  });

  it("defaults fontSizePx to 16 when missing", () => {
    const props = svgTextToTextProps({ text: "Text", tspans: [] }, { defaultFont: "Font" });

    expect(props.fontSizePx).toBe(16);
  });

  it("resolves comma-separated font-family via alias map", () => {
    const props = svgTextToTextProps(
      {
        text: "Text",
        fontFamily: "'Helvetica Neue', Helvetica, sans-serif",
        fontSizePx: 14,
        tspans: [],
      },
      {
        defaultFont: "Fallback",
        fontAliasMap: { Helvetica: "HelveticaAlias" },
      },
    );
    // First match in alias map should win
    expect(props.font).toBe("HelveticaAlias");
  });
});

describe("svgTextToVNode", () => {
  it("produces a Canvas > Flex > Text VNode tree", () => {
    const svg = `<svg><text font-size="20" fill="#000">Hello</text></svg>`;
    const vnode = svgTextToVNode(svg, {
      width: 800,
      height: 600,
      defaultFont: "NotoSansJP",
    });

    const canvas = expectCanvasVNode(vnode);
    expect(canvas.props.width).toBe(800);
    expect(canvas.props.height).toBe(600);
    expect(canvas.children).toHaveLength(1);

    const flex = expectVNodeChild(canvas.children[0]) as FlexVNode;
    expect(flex.type).toBe("Flex");
    expect(flex.children).toHaveLength(1);

    const text = expectVNodeChild(flex.children[0]) as TextVNode;
    expect(text.type).toBe("Text");
    expect(text.props.fontSizePx).toBe(20);
    expect(text.props.font).toBe("NotoSansJP");
  });

  it("handles multiple text elements", () => {
    const svg = `
      <svg>
        <text font-size="32">Title</text>
        <text font-size="16">Subtitle</text>
      </svg>
    `;
    const vnode = svgTextToVNode(svg, {
      width: 400,
      height: 300,
      defaultFont: "Font",
    });

    const canvas = expectCanvasVNode(vnode);
    const flex = expectVNodeChild(canvas.children[0]) as FlexVNode;
    expect(flex.children).toHaveLength(2);
  });

  it("sets background on Canvas when provided", () => {
    const svg = `<svg><text>Hi</text></svg>`;
    const vnode = svgTextToVNode(svg, {
      width: 100,
      height: 100,
      background: "#fff",
      defaultFont: "Font",
    });

    const canvas = expectCanvasVNode(vnode);
    expect(canvas.props.background).toBe("#fff");
  });

  it("returns empty Flex when no text elements found", () => {
    const svg = `<svg><rect width="100" height="50"/></svg>`;
    const vnode = svgTextToVNode(svg, {
      width: 200,
      height: 200,
      defaultFont: "Font",
    });

    const canvas = expectCanvasVNode(vnode);
    const flex = expectVNodeChild(canvas.children[0]) as FlexVNode;
    expect(flex.children).toHaveLength(0);
  });
});
