import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { IRNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { BoxProps, VNode } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

function canvasWithBox(props: BoxProps): VNode {
  return createElement("Canvas", { width: 400, height: 300 }, createElement("Box", props));
}

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

describe("borderRadius — individual corners", () => {
  it("uniform number borderRadius produces number in IR (regression)", () => {
    const ir = engine.renderToIR(
      canvasWithBox({
        id: "uniform",
        width: 200,
        height: 100,
        background: "#ff0000",
        borderRadius: 8,
      }),
    );
    const bgRect = findNodeById(ir.root, "uniform:bg");
    expect(bgRect).toBeDefined();
    expect(bgRect!.borderRadius).toBe(8);
  });

  it("array borderRadius [10, 20, 30, 40] produces BorderRadii object in IR", () => {
    const ir = engine.renderToIR(
      canvasWithBox({
        id: "per-corner",
        width: 200,
        height: 100,
        background: "#00ff00",
        borderRadius: [10, 20, 30, 40],
      }),
    );
    const bgRect = findNodeById(ir.root, "per-corner:bg");
    expect(bgRect).toBeDefined();
    expect(bgRect!.borderRadius).toEqual({ tl: 10, tr: 20, br: 30, bl: 40 });
  });

  it("clamps borderRadius to min(w,h)/2", () => {
    const ir = engine.renderToIR(
      canvasWithBox({
        id: "clamped",
        width: 100,
        height: 60,
        background: "#0000ff",
        borderRadius: [50, 50, 50, 50], // max should be 30 (60/2)
      }),
    );
    const bgRect = findNodeById(ir.root, "clamped:bg");
    expect(bgRect!.borderRadius).toEqual({ tl: 30, tr: 30, br: 30, bl: 30 });
  });

  it("clamps uniform borderRadius to min(w,h)/2", () => {
    const ir = engine.renderToIR(
      canvasWithBox({
        id: "clamped-uniform",
        width: 100,
        height: 60,
        background: "#0000ff",
        borderRadius: 50, // max should be 30
      }),
    );
    const bgRect = findNodeById(ir.root, "clamped-uniform:bg");
    expect(bgRect!.borderRadius).toBe(30);
  });

  it("undefined borderRadius stays undefined in IR", () => {
    const ir = engine.renderToIR(
      canvasWithBox({
        id: "no-radius",
        width: 200,
        height: 100,
        background: "#ffff00",
      }),
    );
    const bgRect = findNodeById(ir.root, "no-radius:bg");
    expect(bgRect!.borderRadius).toBeUndefined();
  });
});

describe("SVG emission — per-corner borderRadius", () => {
  it("uniform borderRadius emits <rect rx ry>", () => {
    const svg = engine.renderToSvg(
      canvasWithBox({
        id: "uniform-svg",
        width: 200,
        height: 100,
        background: "#ff0000",
        borderRadius: 8,
      }),
    );
    expect(svg).toContain("<rect ");
    expect(svg).toContain('rx="8"');
    expect(svg).toContain('ry="8"');
    expect(svg).not.toContain("<path ");
  });

  it("per-corner borderRadius emits <path> with arcs", () => {
    const svg = engine.renderToSvg(
      canvasWithBox({
        id: "path-svg",
        width: 200,
        height: 100,
        background: "#00ff00",
        borderRadius: [10, 20, 30, 0],
      }),
    );
    expect(svg).toContain("<path ");
    expect(svg).toContain('d="M');
    expect(svg).toContain("A"); // Arc commands
    expect(svg).toContain('fill="#00ff00"');
  });

  it("per-corner borderRadius with border emits <path> with stroke", () => {
    const svg = engine.renderToSvg(
      canvasWithBox({
        id: "border-path",
        width: 200,
        height: 100,
        borderWidth: 2,
        borderColor: "#000000",
        borderRadius: [10, 20, 0, 0],
      }),
    );
    expect(svg).toContain("<path ");
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
  });
});
