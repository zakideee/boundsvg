// @vitest-environment happy-dom
import { bindIRToSvg, nativePathCandidates, resolveHitTarget } from "@boundsvg/browser/events";
import type { IR, IRNode } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import {
  buildHitTestIndex,
  buildInspectHitTestIndex,
  buildIRSourceIndex,
} from "@boundsvg/core/scene";
import { createWasmEngineInstance, type WasmEngineHandle } from "@boundsvg/core/wasm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let handle: WasmEngineHandle;
const bbox = { x: 0, y: 0, w: 80, h: 60 };
function group(nodeId: string, children: IRNode[]): IRNode {
  return { type: "group", nodeId, bbox, ownership: { role: "source" }, children };
}
function rect(nodeId: string): IRNode {
  return { type: "rect", nodeId, bbox, ownership: { role: "source" }, fill: "red" };
}
function mount(root: IRNode) {
  const ir: IR = { root, width: 80, height: 60, warnings: [] };
  const index = buildInspectHitTestIndex(ir);
  const host = document.createElement("div");
  host.innerHTML = handle.emitSvgFromIr(
    JSON.stringify({ root, width: 80, height: 60 }),
    JSON.stringify({ timeMs: 50 }),
  );
  document.body.append(host);
  const svg = host.querySelector("svg");
  if (!svg) {
    throw new TypeError("Missing emitted SVG");
  }
  return { ir, index, svg, binding: bindIRToSvg(svg, index.sourceIndex) };
}
beforeAll(async () => {
  await initNodeWasm();
  handle = createWasmEngineInstance();
});
afterAll(() => handle.dispose());
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("emitted IR ownership binding", () => {
  it("distinguishes duplicate labels, authored suffixes and generated wrapper/paint endpoints", () => {
    const inner: IRNode = {
      ...group("card:content", [
        { ...rect("card"), ownership: { role: "content", ownerNodeId: "card" } },
      ]),
      ownership: { role: "wrapper", placement: "inner", ownerNodeId: "card" },
    };
    const { index, binding, svg } = mount(
      group("card", [inner, rect("card:content"), rect("card:outline"), rect("card")]),
    );
    expect(svg.hasAttribute("data-boundsvg-node-id")).toBe(false);
    expect([...index.sourceIndex.sources.keys()]).toEqual([0, 3, 4, 5]);
    for (const occurrence of index.sourceIndex.nodes.values()) {
      const endpoint = binding.elementForNode(occurrence.nodeIndex);
      expect(endpoint).not.toBeNull();
      expect(binding.sourceForElement(endpoint!)).toBe(occurrence.source);
      expect(endpoint?.hasAttribute("data-boundsvg-node-id")).toBe(
        occurrence.node.ownership.role === "source",
      );
    }
    expect(resolveHitTarget(binding, index.queryCandidates(10, 10), 10, 10)).toEqual({
      sourceIndex: 5,
      nodeId: "card",
    });
  });

  it("keeps embedded fake association markers opaque and other SVG scopes foreign", () => {
    const embedded: IRNode = {
      type: "svg",
      nodeId: "embedded",
      bbox,
      ownership: { role: "source" },
      svgContent:
        '<g data-boundsvg-role="source" data-boundsvg-node-index="2" data-boundsvg-source-index="2" data-boundsvg-node-id="victim"><path d="M0 0H20V20Z"/></g>',
      svgViewBox: "0 0 80 60",
      preserveAspectRatio: "xMidYMid meet",
    };
    const first = mount(group("root", [embedded, rect("victim")]));
    const second = mount(group("root", [embedded, rect("victim")]));
    const fake = first.svg.querySelector('[data-boundsvg-node-id="embedded"] path');
    expect(fake).not.toBeNull();
    expect(first.binding.sourceForElement(fake!)).toEqual({ sourceIndex: 1, nodeId: "embedded" });
    expect(first.binding.sourceForElement(second.binding.elementForNode(2)!)).toBeNull();
    const otherIndex = buildHitTestIndex(second.ir);
    expect(
      nativePathCandidates(first.binding, otherIndex, { clientX: 1, clientY: 1, x: 1, y: 1 }),
    ).toEqual([]);
  });

  it("rejects partial documents, noncanonical ordinals and stale candidate references", () => {
    for (const token of ["01", "-1", "1.0", "9007199254740992", "2"]) {
      const current = mount(group("root", [rect("target")]));
      current.binding.elementForNode(1)?.setAttribute("data-boundsvg-node-index", token);
      const broken = bindIRToSvg(current.svg, current.index.sourceIndex);
      expect(broken.elementForNode(0)).toBeNull();
    }
    const previous = mount(group("root", [rect("old")]));
    const current = mount(group("root", [rect("new")]));
    expect(
      resolveHitTarget(current.binding, previous.index.queryCandidates(10, 10), 10, 10),
    ).toBeNull();
    expect(buildIRSourceIndex(current.ir).sources.get(1)?.source.nodeId).toBe("new");
  });

  it("binds empty paint endpoints and an outer root to their direct source child", () => {
    const empty: IRNode = {
      type: "path",
      nodeId: "empty",
      ownership: { role: "source" },
      bbox,
      pathData: "",
      fill: "red",
    };
    const outer: IRNode = {
      ...group("frame", [group("same", [empty])]),
      ownership: { role: "wrapper", placement: "outer", ownerNodeId: "same" },
    };
    const { binding } = mount(outer);
    expect(binding.sourceForElement(binding.elementForNode(0)!)).toEqual({
      sourceIndex: 1,
      nodeId: "same",
    });
    expect(binding.elementForNode(2)?.localName).toBe("g");
    expect(binding.sourceForElement(binding.elementForNode(2)!)).toEqual({
      sourceIndex: 2,
      nodeId: "empty",
    });
  });
});

it("resolves unit ownership without treating a unit carrier as a source animation endpoint", () => {
  const text: IRNode = {
    type: "text",
    nodeId: "standalone",
    ownership: { role: "source" },
    bbox,
    layoutBox: bbox,
    font: "F",
    fontSizePx: 12,
    lineHeightPx: 14,
    color: "black",
    textAlign: "start",
    lines: [{ text: "A", glyphs: [], width: 10, baselineY: 12 }],
    glyphPaths: [
      {
        nodeId: "standalone",
        d: "M0 0H10V10Z",
        fill: "black",
        glyphIds: [1],
        text: "A",
        bbox,
        unitId: "unit-0",
      },
    ],
    unitMap: {
      kind: "cluster",
      ruby: "with-base",
      units: [
        {
          unitId: "unit-0",
          kind: "cluster",
          sourceStart: 0,
          sourceEnd: 1,
          lineId: "line-0",
          logicalOrder: 0,
          visualOrder: 0,
          members: [{ lineIndex: 0, glyphIndex: 0, sourceRole: "content" }],
        },
      ],
    },
    unitAnimation: {
      by: "cluster",
      animation: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 100,
      },
    },
    unitAnimationSamples: [{ unitId: "unit-0", bbox, opacity: 0.5 }],
  };
  const { binding, svg } = mount(text);
  const carrier = svg.querySelector("[data-boundsvg-unit-source-index]");
  expect(carrier).not.toBeNull();
  const occurrence = binding.occurrenceForElement(carrier!);
  expect(occurrence?.node.ownership.role).toBe("source");
  expect(binding.sourceForElement(carrier!)).toEqual({ sourceIndex: 0, nodeId: "standalone" });
  expect(binding.elementForNode(occurrence!.nodeIndex)).not.toBe(carrier);
  expect(carrier?.hasAttribute("data-boundsvg-role")).toBe(false);
});
