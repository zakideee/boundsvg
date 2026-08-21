import { describe, expect, it } from "vitest";
import {
  type CodegenFontDef,
  type GenerateComponentOptions,
  generateReactComponent,
} from "../../src/codegen/component-codegen.js";
import { createElement } from "../../src/vnode/create-element.js";

const testFonts: CodegenFontDef[] = [
  {
    alias: "NotoSansJP",
    weight: 400,
    style: "normal",
    source: "/fonts/NotoSansJP-Regular.woff2",
  },
];

function makeTestVNode() {
  const text = createElement("Text", { font: "NotoSansJP", fontSizePx: 24 }, "Hello World");
  const box = createElement("Box", { width: 400, height: 200 }, text);
  return createElement("Canvas", { width: 400, height: 200 }, box);
}

describe("generateReactComponent", () => {
  it("generates boundsvg renderer component", () => {
    const vnode = makeTestVNode();
    const options: GenerateComponentOptions = {
      componentName: "Card",
      renderer: "boundsvg",
      fonts: testFonts,
      exportDefault: true,
    };

    const code = generateReactComponent(vnode, options);
    expect(code).toContain("BoundSvgProvider");
    expect(code).toContain("BoundSvg");
    expect(code).toContain("export default function Card");
    expect(code).toContain('alias: "NotoSansJP"');
    expect(code).toContain("<Canvas");
    expect(code).toContain("<Text");
  });

  it("generates svg-hook renderer component", () => {
    const vnode = makeTestVNode();
    const code = generateReactComponent(vnode, {
      renderer: "svg-hook",
      fonts: testFonts,
    });

    expect(code).toContain("useRenderToSvg");
    expect(code).toContain("dangerouslySetInnerHTML");
    expect(code).toContain("SvgPreview");
  });

  it("generates png-hook renderer component", () => {
    const vnode = makeTestVNode();
    const code = generateReactComponent(vnode, {
      renderer: "png-hook",
      fonts: testFonts,
    });

    expect(code).toContain("useRenderToPng");
    expect(code).toContain("PngPreview");
    expect(code).toContain('alt="Rendered"');
  });

  it("uses default component name", () => {
    const vnode = makeTestVNode();
    const code = generateReactComponent(vnode, {
      renderer: "boundsvg",
      fonts: testFonts,
    });

    expect(code).toContain("function SvgComponent");
  });

  it("generates dynamic text props interface", () => {
    const vnode = makeTestVNode();
    const code = generateReactComponent(vnode, {
      componentName: "Card",
      renderer: "boundsvg",
      fonts: testFonts,
      dynamicTexts: [{ textIndex: 0, propName: "title", defaultValue: "Hello World" }],
    });

    expect(code).toContain("interface CardProps");
    expect(code).toContain("title?: string");
    expect(code).toContain("props.title");
  });

  it.each([
    "boundsvg",
    "svg-hook",
    "png-hook",
  ] as const)("renders resolved dynamic-text defaults in the %s component", (renderer) => {
    const vnode = makeTestVNode();
    const code = generateReactComponent(vnode, {
      componentName: "Card",
      renderer,
      fonts: testFonts,
      dynamicTexts: [{ textIndex: 0, propName: "title", defaultValue: "Default Title" }],
    });

    expect(code).toContain('const title = props.title ?? "Default Title";');
    expect(code).toContain("{title}");
    expect(code).not.toContain("{props.title}");
  });

  it("generates empty fonts array", () => {
    const vnode = makeTestVNode();
    const code = generateReactComponent(vnode, {
      renderer: "boundsvg",
      fonts: [],
    });

    expect(code).toContain("fonts");
    expect(code).toContain("[]");
  });

  it("generates multiple font definitions", () => {
    const vnode = makeTestVNode();
    const fonts: CodegenFontDef[] = [
      { alias: "NotoSansJP", weight: 400, style: "normal", source: "/fonts/noto-400.woff2" },
      { alias: "NotoSansJP", weight: 700, style: "normal", source: "/fonts/noto-700.woff2" },
    ];
    const code = generateReactComponent(vnode, {
      renderer: "boundsvg",
      fonts,
    });

    expect(code).toContain("weight: 400");
    expect(code).toContain("weight: 700");
  });

  it("handles exportDefault=false", () => {
    const vnode = makeTestVNode();
    const code = generateReactComponent(vnode, {
      renderer: "boundsvg",
      fonts: testFonts,
      exportDefault: false,
    });

    expect(code).toContain("export function SvgComponent");
    expect(code).not.toContain("export default");
  });

  it("keeps Inline children when dynamic text replacement is requested", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 200 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24 },
        "A",
        createElement("Inline", { color: "#f00" }, "B"),
      ),
    );
    const code = generateReactComponent(vnode, {
      renderer: "boundsvg",
      fonts: testFonts,
      dynamicTexts: [{ textIndex: 0, propName: "title", defaultValue: "X" }],
    });
    expect(code).toContain("<Inline");
    expect(code).not.toContain("{props.title}");
  });

  it("keeps Ruby and Rt imports in generated components", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 200 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24 },
        createElement("Ruby", {}, "東", createElement("Rt", {}, "とう")),
      ),
    );
    const code = generateReactComponent(vnode, {
      renderer: "boundsvg",
      fonts: testFonts,
    });
    expect(code).toContain("Ruby");
    expect(code).toContain("Rt");
    expect(code).toContain("<Ruby");
    expect(code).toContain("<Rt");
  });

  it("generates TextOnPath with dynamic text replacement", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 120 },
      createElement(
        "TextOnPath",
        {
          d: "M0 60L400 60",
          width: 400,
          height: 120,
          font: "NotoSansJP",
          fontSizePx: 24,
        },
        "Path title",
      ),
    );
    const code = generateReactComponent(vnode, {
      renderer: "boundsvg",
      fonts: testFonts,
      dynamicTexts: [{ textIndex: 0, propName: "title", defaultValue: "Path title" }],
    });
    expect(code).toContain("TextOnPath");
    expect(code).toContain("<TextOnPath");
    expect(code).toContain("{title}");
  });
});
