import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine, type Engine } from "../../src/engine.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;
let renderEngine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  renderEngine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

/**
 * Mock compute_layout: returns flat node list with canvas bbox
 */
function mockComputeLayoutFn(inputJson: string): string {
  const input = JSON.parse(inputJson);
  const nodes: Array<Record<string, unknown>> = [];

  function collect(node: {
    nodeId: string;
    style: Record<string, unknown>;
    children?: unknown[];
    text?: { content: string; fontSizePx: number };
  }): void {
    const w = (node.style as Record<string, number>).width ?? 400;
    const h = (node.style as Record<string, number>).height ?? 300;

    if (node.text) {
      const fontSize = node.text.fontSizePx;
      const content = node.text.content;
      const advance = fontSize * 0.6;
      const tw = Math.min(content.length * advance, w);
      const ch = fontSize * 1.2;
      const glyphs = [...content].map((_, i) => ({
        glyphId: i + 1,
        xAdvance: advance,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
        cluster: i,
      }));
      nodes.push({
        nodeId: node.nodeId,
        x: 0,
        y: 0,
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
      nodes.push({ nodeId: node.nodeId, x: 0, y: 0, width: w, height: h });
    }

    if (node.children) {
      for (const c of node.children as Array<{
        nodeId: string;
        style: Record<string, unknown>;
        children?: unknown[];
        text?: { content: string; fontSizePx: number };
      }>) {
        collect(c);
      }
    }
  }
  collect(input.root);
  return JSON.stringify({ nodes, measureCallCount: 0 });
}

describe("renderToLayoutTree", () => {
  it("returns layout result with bbox and children", () => {
    const engine = createEngine({
      computeLayoutFn: mockComputeLayoutFn,
    });

    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Box", { id: "box1", width: 200, height: 100 }),
    );

    const layoutTree = engine.renderToLayoutTree(vnode);
    expect(layoutTree.root).toBeDefined();
    expect(layoutTree.root.bbox).toBeDefined();
    expect(layoutTree.root.children).toHaveLength(1);
    expect(typeof layoutTree.measureCallCount).toBe("number");
  });

  it("throws when engine is disposed", () => {
    const engine = createEngine({
      computeLayoutFn: mockComputeLayoutFn,
    });
    engine.dispose();
    const vnode = createElement("Canvas", { width: 100, height: 100 });
    expect(() => engine.renderToLayoutTree(vnode)).toThrow("disposed");
  });
});

describe("HandlersRef on leaf nodes", () => {
  it("text node carries on field with handlers", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        "Text",
        {
          id: "t1",
          font: "NotoSansJP",
          fontSizePx: 16,
          onClick: "handleClick",
          onPointerEnter: "handleEnter",
          onPointerCancel: "handleCancel",
        },
        "Hello",
      ),
    );

    const ir = renderEngine.renderToIR(vnode, { skipValidation: true });
    // Find the text IRNode
    const textNode = findNode(ir.root, "text");
    expect(textNode).toBeDefined();
    expect(textNode!.on).toBeDefined();
    expect(textNode!.on!.onClick).toBe("handleClick");
    expect(textNode!.on!.onPointerEnter).toBe("handleEnter");
    expect(textNode!.on!.onPointerCancel).toBe("handleCancel");
  });

  it("image node carries on field", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Image", {
        id: "img1",
        src: "data:image/png;base64,abc",
        width: 100,
        height: 100,
        onClick: "imgClick",
      }),
    );

    const ir = renderEngine.renderToIR(vnode, { skipValidation: true });
    const imgNode = findNode(ir.root, "image");
    expect(imgNode).toBeDefined();
    expect(imgNode!.on).toBeDefined();
    expect(imgNode!.on!.onClick).toBe("imgClick");
  });

  it("path node carries on field", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Path", {
        id: "p1",
        d: "M0 0 L100 100",
        width: 100,
        height: 100,
        onClick: "pathClick",
      }),
    );

    const ir = renderEngine.renderToIR(vnode, { skipValidation: true });
    const pathNode = findNode(ir.root, "path");
    expect(pathNode).toBeDefined();
    expect(pathNode!.on).toBeDefined();
    expect(pathNode!.on!.onClick).toBe("pathClick");
  });

  it("container group nodes carry on field when handlers are set", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", {
        id: "box1",
        width: 200,
        height: 100,
        onClick: "boxClick",
      }),
    );

    const ir = renderEngine.renderToIR(vnode, { skipValidation: true });
    const boxGroup = ir.root.children![0]!;
    expect(boxGroup.type).toBe("group");
    expect(boxGroup.on).toBeDefined();
    expect(boxGroup.on!.onClick).toBe("boxClick");
  });

  it("container group nodes without handlers have no on field", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", {
        id: "box2",
        width: 200,
        height: 100,
      }),
    );

    const ir = renderEngine.renderToIR(vnode, { skipValidation: true });
    const boxGroup = ir.root.children![0]!;
    expect(boxGroup.type).toBe("group");
    expect(boxGroup.on).toBeUndefined();
  });
});

/** Helper: recursively find first IRNode of a given type */
function findNode(
  node: { type: string; children?: Array<{ type: string; children?: unknown[]; on?: unknown }> },
  type: string,
):
  | {
      type: string;
      on?: {
        onClick?: string;
        onPointerMove?: string;
        onPointerEnter?: string;
        onPointerLeave?: string;
        onPointerCancel?: string;
      };
    }
  | undefined {
  if (node.type === type) {
    return node as {
      type: string;
      on?: {
        onClick?: string;
        onPointerMove?: string;
        onPointerEnter?: string;
        onPointerLeave?: string;
        onPointerCancel?: string;
      };
    };
  }
  if (node.children) {
    for (const c of node.children) {
      const found = findNode(
        c as {
          type: string;
          children?: Array<{ type: string; children?: unknown[]; on?: unknown }>;
        },
        type,
      );
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}
