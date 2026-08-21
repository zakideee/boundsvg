import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { IRNode } from "../../src/ir/types.js";
import { mapToLayoutStyle } from "../../src/layout/taffy-style-mapper.js";
import { validate } from "../../src/validate/index.js";
import { Path } from "../../src/vnode/components.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const STAR_PATH = "M50,0 L65,35 L100,40 L75,65 L80,100 L50,80 L20,100 L25,65 L0,40 L35,35 Z";

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

function findNodeById(node: IRNode, nodeId: string): IRNode | undefined {
  if (node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findNodeById(child, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe("Path component — VNode", () => {
  it("creates Path VNode via createElement", () => {
    const node = createElement("Path", {
      d: STAR_PATH,
      width: 100,
      height: 100,
      fill: "#ff0000",
    });
    expect(node.type).toBe("Path");
    expect(node.props.d).toBe(STAR_PATH);
    expect(node.children).toHaveLength(0);
  });

  it("creates Path VNode via factory function", () => {
    const node = Path({
      d: STAR_PATH,
      width: 100,
      height: 100,
      fill: "#ff0000",
    });
    expect(node.type).toBe("Path");
  });
});

describe("Path component — validation", () => {
  it("passes validation with valid Path props", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Path", {
        d: STAR_PATH,
        width: 100,
        height: 100,
        fill: "#ff0000",
      }),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("throws if Path has children", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        // @ts-expect-error intentional invalid runtime validation case
        "Path",
        {
          d: STAR_PATH,
          width: 100,
          height: 100,
        },
        "bad child",
      ),
    );
    expect(() => validate(tree)).toThrow("Path must not have children");
  });

  it("throws if Path has no d prop", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      // @ts-expect-error intentional invalid runtime validation case
      createElement("Path", { width: 100, height: 100 }),
    );
    expect(() => validate(tree)).toThrow("Path requires a non-empty 'd' prop");
  });

  it("throws if Path has empty d prop", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Path", { d: "", width: 100, height: 100 }),
    );
    expect(() => validate(tree)).toThrow("Path requires a non-empty 'd' prop");
  });

  it("throws if Path has no width", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      // @ts-expect-error intentional invalid runtime validation case
      createElement("Path", { d: STAR_PATH, height: 100 }),
    );
    expect(() => validate(tree)).toThrow("Path requires a 'width' prop");
  });

  it("throws if Path has no height", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      // @ts-expect-error intentional invalid runtime validation case
      createElement("Path", { d: STAR_PATH, width: 100 }),
    );
    expect(() => validate(tree)).toThrow("Path requires a 'height' prop");
  });
});

describe("Path component — style mapper", () => {
  it("maps Path to fixed-size leaf node", () => {
    const node = createElement("Path", {
      d: STAR_PATH,
      width: 100,
      height: 80,
    });
    const style = mapToLayoutStyle(node);
    expect(style.size.width).toBe(100);
    expect(style.size.height).toBe(80);
    expect(style.display).toBe("flex");
  });

  it("respects flex item props", () => {
    const node = createElement("Path", {
      d: STAR_PATH,
      width: 100,
      height: 80,
      flexGrow: 1,
      flexShrink: 0,
    });
    const style = mapToLayoutStyle(node);
    expect(style.flexGrow).toBe(1);
    expect(style.flexShrink).toBe(0);
  });
});

describe("Path component — IR builder", () => {
  it("creates path IR node", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Path", {
        id: "star",
        d: STAR_PATH,
        width: 100,
        height: 100,
        fill: "#ff0000",
        stroke: "#000000",
        strokeWidth: 2,
      }),
    );

    const ir = engine.renderToIR(tree);
    expect(ir.drawOrder).toContain("star");

    // A Path with an id renders as a wrapping group "star" holding the path leaf.
    const starGroup = findNodeById(ir.root, "star");
    const pathNode = starGroup?.children?.find((child) => child.type === "path");
    expect(pathNode).toBeDefined();
    expect(pathNode!.type).toBe("path");
    expect(pathNode!.pathData).toBe(STAR_PATH);
    expect(pathNode!.fill).toBe("#ff0000");
    expect(pathNode!.stroke).toBe("#000000");
    expect(pathNode!.strokeWidth).toBe(2);
  });
});

describe("Path component — SVG emitter", () => {
  it("emits <path> element with d, fill, stroke", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Path", {
        id: "star-svg",
        d: STAR_PATH,
        width: 100,
        height: 100,
        fill: "#ff0000",
        stroke: "#000000",
        strokeWidth: 2,
      }),
    );

    const svg = engine.renderToSvg(tree);
    expect(svg).toContain("<path ");
    expect(svg).toContain(`d="${STAR_PATH}"`);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
  });

  it("Path in Flex layout", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        "Flex",
        { id: "flex-container", direction: "row" },
        createElement("Path", {
          id: "flex-path",
          d: "M0,0 L100,100",
          width: 100,
          height: 100,
          stroke: "#333",
        }),
      ),
    );

    const svg = engine.renderToSvg(tree);
    expect(svg).toContain("<path ");
    expect(svg).toContain('d="M0,0 L100,100"');
  });

  it("Path + Text mixed in layout", () => {
    const tree = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        "Flex",
        { id: "mixed", direction: "column" },
        createElement("Path", {
          id: "icon",
          d: "M10,10 L90,90",
          width: 50,
          height: 50,
          fill: "#888",
        }),
        createElement(
          "Text",
          { id: "label", font: "InterVariable", fontSizePx: 16, color: "#000" },
          "Hello",
        ),
      ),
    );

    const svg = engine.renderToSvg(tree);
    expect(svg).toContain("<path ");
    expect(svg).toContain('data-boundsvg-text="Hello"');
    expect(svg).not.toContain("<text ");
  });
});
