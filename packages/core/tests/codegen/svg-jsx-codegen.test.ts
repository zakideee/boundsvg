import { describe, expect, it } from "vitest";
import {
  generatePlainSvgComponent,
  parseSvgString,
  svgStringToJsx,
} from "../../src/codegen/svg-jsx-codegen.js";

// ---------------------------------------------------------------------------
// parseSvgString
// ---------------------------------------------------------------------------

describe("parseSvgString", () => {
  it("parses a simple SVG with attributes", () => {
    const tree = parseSvgString(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>',
    );
    expect(tree.tag).toBe("svg");
    expect(tree.attrs).toEqual([
      ["xmlns", "http://www.w3.org/2000/svg"],
      ["viewBox", "0 0 100 50"],
    ]);
    expect(tree.children).toEqual([]);
  });

  it("parses self-closing elements", () => {
    const tree = parseSvgString('<svg><rect x="0" y="0" width="10" height="10"/></svg>');
    expect(tree.children).toHaveLength(1);
    const rect = tree.children[0] as { tag: string; selfClosing: boolean };
    expect(rect.tag).toBe("rect");
    expect(rect.selfClosing).toBe(true);
  });

  it("parses nested elements", () => {
    const tree = parseSvgString('<svg><g><path d="M0 0"/></g></svg>');
    expect(tree.children).toHaveLength(1);
    const g = tree.children[0] as { tag: string; children: unknown[] };
    expect(g.tag).toBe("g");
    expect(g.children).toHaveLength(1);
  });

  it("parses text content", () => {
    const tree = parseSvgString("<svg><title>Hello</title></svg>");
    const title = tree.children[0] as { tag: string; children: unknown[] };
    expect(title.tag).toBe("title");
    expect(title.children).toHaveLength(1);
    expect(title.children[0]).toBe("Hello");
  });
});

// ---------------------------------------------------------------------------
// svgStringToJsx — attribute conversion
// ---------------------------------------------------------------------------

describe("svgStringToJsx", () => {
  it("removes xmlns from root svg", () => {
    const jsx = svgStringToJsx(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    );
    expect(jsx).not.toContain("xmlns");
    expect(jsx).toContain("viewBox");
  });

  it("converts kebab-case attributes to camelCase", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      '  <path d="M0 0" fill-rule="evenodd" stroke-width="2"/>',
      "</svg>",
    ].join("\n");
    const jsx = svgStringToJsx(svg);
    expect(jsx).toContain("fillRule");
    expect(jsx).toContain("strokeWidth");
    expect(jsx).not.toContain("fill-rule");
    expect(jsx).not.toContain("stroke-width");
  });

  it("converts all mapped SVG attributes", () => {
    const attrPairs: Array<[string, string]> = [
      ["clip-path", "clipPath"],
      ["clip-rule", "clipRule"],
      ["fill-opacity", "fillOpacity"],
      ["fill-rule", "fillRule"],
      ["flood-color", "floodColor"],
      ["flood-opacity", "floodOpacity"],
      ["paint-order", "paintOrder"],
      ["stop-color", "stopColor"],
      ["stop-opacity", "stopOpacity"],
      ["stroke-dasharray", "strokeDasharray"],
      ["stroke-linecap", "strokeLinecap"],
      ["stroke-linejoin", "strokeLinejoin"],
      ["stroke-miterlimit", "strokeMiterlimit"],
      ["stroke-opacity", "strokeOpacity"],
      ["stroke-width", "strokeWidth"],
    ];

    for (const [svgAttr, jsxAttr] of attrPairs) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect ${svgAttr}="1"/></svg>`;
      const jsx = svgStringToJsx(svg);
      expect(jsx).toContain(jsxAttr);
      expect(jsx).not.toContain(`${svgAttr}=`);
    }
  });

  it("preserves data-* attributes as-is", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><g data-boundsvg-node-id="n1" data-boundsvg-text="hello"></g></svg>';
    const jsx = svgStringToJsx(svg);
    expect(jsx).toContain("data-boundsvg-node-id");
    expect(jsx).toContain("data-boundsvg-text");
  });

  it("preserves aria-* attributes as-is", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g aria-label="test"></g></svg>';
    const jsx = svgStringToJsx(svg);
    expect(jsx).toContain("aria-label");
  });

  it("preserves already-camelCase attributes", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image preserveAspectRatio="xMidYMid meet"/></svg>';
    const jsx = svgStringToJsx(svg);
    expect(jsx).toContain("viewBox");
    expect(jsx).toContain("preserveAspectRatio");
  });

  it("adds {...props} spread on root svg", () => {
    const jsx = svgStringToJsx(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    );
    expect(jsx).toContain("{...props}");
  });

  it("handles self-closing elements", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0"/></svg>';
    const jsx = svgStringToJsx(svg);
    expect(jsx).toContain("<rect");
    expect(jsx).toContain("/>");
  });

  it("handles nested groups and defs", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
      "  <defs>",
      '    <clipPath id="clip-1">',
      '      <rect x="0" y="0" width="100" height="100"/>',
      "    </clipPath>",
      "  </defs>",
      '  <g clip-path="url(#clip-1)">',
      '    <rect x="0" y="0" fill="#000"/>',
      "  </g>",
      "</svg>",
    ].join("\n");
    const jsx = svgStringToJsx(svg);
    expect(jsx).toContain("<defs>");
    expect(jsx).toContain("</defs>");
    expect(jsx).toContain('clipPath="url(#clip-1)"');
  });
});

// ---------------------------------------------------------------------------
// generatePlainSvgComponent
// ---------------------------------------------------------------------------

describe("generatePlainSvgComponent", () => {
  const simpleSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120"><rect x="0" y="0" width="240" height="120" fill="#101010"/></svg>';

  it("generates a valid React component with default export", () => {
    const code = generatePlainSvgComponent(simpleSvg, { componentName: "Card" });
    expect(code).toContain('import type { SVGProps } from "react"');
    expect(code).toContain("export default function Card(props: SVGProps<SVGSVGElement>)");
    expect(code).toContain("{...props}");
    expect(code).toContain("return (");
  });

  it("does not include @boundsvg imports", () => {
    const code = generatePlainSvgComponent(simpleSvg, { componentName: "Card" });
    expect(code).not.toContain("@boundsvg");
    expect(code).not.toContain("boundsvg");
  });

  it("strips xmlns from root svg", () => {
    const code = generatePlainSvgComponent(simpleSvg, { componentName: "Card" });
    expect(code).not.toContain("xmlns");
  });

  it("preserves viewBox and dimensions", () => {
    const code = generatePlainSvgComponent(simpleSvg, { componentName: "Card" });
    expect(code).toContain('viewBox="0 0 240 120"');
    expect(code).toContain('width="240"');
    expect(code).toContain('height="120"');
  });

  it("converts SVG attributes to JSX camelCase", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0" fill-rule="evenodd" stroke-width="2"/></svg>';
    const code = generatePlainSvgComponent(svg, { componentName: "Icon" });
    expect(code).toContain("fillRule");
    expect(code).toContain("strokeWidth");
  });

  it("uses PascalCase component name", () => {
    const code = generatePlainSvgComponent(simpleSvg, { componentName: "MyAwesomeCard" });
    expect(code).toContain("function MyAwesomeCard(");
  });

  it("handles complex SVG with groups and glyph paths", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 100" width="480" height="100">',
      '  <rect x="0" y="0" width="480" height="100" fill="#ffffff"/>',
      '  <g data-boundsvg-node-id="text-0" data-boundsvg-text="Hello" aria-label="Hello">',
      '    <path d="M10 20L30 40" fill="#000000"/>',
      '    <path d="M35 20L55 40" fill="#000000"/>',
      "  </g>",
      "</svg>",
    ].join("\n");
    const code = generatePlainSvgComponent(svg, { componentName: "TextCard" });
    expect(code).toContain("data-boundsvg-node-id");
    expect(code).toContain("aria-label");
    expect(code).toContain("<path");
    expect(code).not.toContain("xmlns");
  });
});

describe("generated JSX validity", () => {
  it("drops comments and processing instructions", () => {
    // These were parsed as elements and emitted as `<!-- c="" --="">`, which
    // is not valid TSX — the generated component would not even compile.
    const code = generatePlainSvgComponent(
      `<svg viewBox="0 0 10 10"><!-- note --><?pi x?><rect width="10" height="10"/></svg>`,
      { componentName: "C" },
    );
    expect(code).not.toContain("<!--");
    expect(code).not.toContain("<?");
    expect(code).toContain('<rect width="10" height="10" />');
  });

  it("preserves CDATA content as text instead of dropping it", () => {
    const code = generatePlainSvgComponent(
      `<svg viewBox="0 0 10 10"><style><![CDATA[.accent { fill: red; content: "&amp;"; }]]></style></svg>`,
      { componentName: "C" },
    );
    expect(code).toContain('content: \\"&amp;\\"');
    expect(code).not.toContain("CDATA");
  });

  it("converts class to className", () => {
    const code = generatePlainSvgComponent(
      `<svg viewBox="0 0 10 10"><rect class="c" width="10" height="10"/></svg>`,
      { componentName: "C" },
    );
    expect(code).toContain('className="c"');
    expect(code).not.toMatch(/\sclass="/);
  });

  it("converts a style string into a JSX style object", () => {
    // React throws on a string `style` prop: "The `style` prop expects a
    // mapping from style properties to values, not a string."
    const code = generatePlainSvgComponent(
      `<svg viewBox="0 0 10 10"><rect style="fill:red;stroke-width:2;--x:1" width="10" height="10"/></svg>`,
      { componentName: "C" },
    );
    expect(code).toContain('style={{ fill: "red", strokeWidth: "2", "--x": "1" }}');
    expect(code).not.toContain('style="fill');
  });

  it("preserves semicolons and colons inside CSS values", () => {
    const code = generatePlainSvgComponent(
      `<svg viewBox="0 0 10 10"><rect style="fill:url(data:image/svg+xml;base64,PHN2Zz47PC9zdmc+);font-family:'A;B';stroke:red!important"/></svg>`,
      { componentName: "C" },
    );
    expect(code).toContain('fill: "url(data:image/svg+xml;base64,PHN2Zz47PC9zdmc+)"');
    expect(code).toContain(`fontFamily: "'A;B'"`);
    expect(code).toContain('stroke: "red!important"');
  });

  it("skips an XML declaration and a doctype before the root", () => {
    const code = generatePlainSvgComponent(
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY label "ok">]><svg viewBox="0 0 10 10"><rect dominant-baseline="middle"/></svg>`,
      { componentName: "C" },
    );
    expect(code).toContain('<svg viewBox="0 0 10 10"');
    expect(code).toContain('dominantBaseline="middle"');
    expect(code).not.toContain("DOCTYPE");
  });

  it("emits text as a string expression so braces are not executable JSX", () => {
    const code = generatePlainSvgComponent(
      `<svg viewBox="0 0 10 10"><text>{label} &amp; literal</text></svg>`,
      { componentName: "C" },
    );
    expect(code).toContain('{"{label} & literal"}');
  });

  it("rejects unterminated non-element markup", () => {
    expect(() =>
      generatePlainSvgComponent(`<svg viewBox="0 0 10 10"><!-- broken</svg>`, {
        componentName: "C",
      }),
    ).toThrow(/unterminated/);
  });
});
