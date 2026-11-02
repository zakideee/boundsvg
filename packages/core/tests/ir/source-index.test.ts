import { describe, expect, it } from "vitest";
import { collectInspectionBBoxes } from "../../src/inspect.js";
import { buildHitTestIndex, hitTest } from "../../src/ir/hit-test.js";
import { buildInspectHitTestIndex } from "../../src/ir/inspect-hit-test.js";
import { buildIRSourceIndex } from "../../src/ir/source-index.js";
import { createSpatialIndex } from "../../src/ir/spatial-index.js";
import { buildTextMap, getAllText } from "../../src/ir/text-map.js";
import { buildTextSelectionMap } from "../../src/ir/text-selection.js";
import type { IR, IRNode } from "../../src/ir/types.js";
import { renderLayeredSvg } from "../../src/layered-svg.js";
import { projectResolvedTextOutlines } from "../../src/text/outline-projection.js";

const bbox = { x: 0, y: 0, w: 100, h: 100 };
function group(nodeId: string, children: IRNode[] = []): IRNode {
  return { type: "group", nodeId, bbox, ownership: { role: "source" }, children };
}
function paint(nodeId: string, ownership: IRNode["ownership"] = { role: "source" }): IRNode {
  return { type: "rect", nodeId, bbox, ownership, fill: "red" };
}
function document(root: IRNode): IR {
  return { root, width: 100, height: 100, warnings: [] };
}

describe("source occurrence ownership", () => {
  it("resolves identical labels and source/suffix collisions structurally", () => {
    const inner: IRNode = {
      ...group("card:content", [paint("card", { role: "content", ownerNodeId: "card" })]),
      ownership: { role: "wrapper", placement: "inner", ownerNodeId: "card" },
    };
    const tree = document(
      group("card", [
        inner,
        group("card", [paint("card", { role: "content", ownerNodeId: "card" })]),
        paint("card:content"),
        paint("card:outline"),
      ]),
    );
    const index = buildIRSourceIndex(tree);
    expect(index.nodes.get(2)?.source.sourceIndex).toBe(0);
    expect(index.nodes.get(4)?.source.sourceIndex).toBe(3);
    expect(index.sources.get(0)?.primaryNodeIndex).toBe(2);
    expect(index.sources.get(3)?.primaryNodeIndex).toBe(4);
    expect(index.sources.size).toBe(4);
    expect(hitTest(tree, 10, 10)).toEqual({ nodeId: "card:outline", sourceIndex: 6 });
    const boxes = collectInspectionBBoxes(index);
    expect(boxes.map((entry) => entry.nodeIndex)).toEqual([0, 2, 3, 4, 5, 6]);
    expect(boxes.map((entry) => entry.paintOrder)).toEqual([null, 0, null, 1, 2, 3]);
  });

  it("does not let decoration replace primary selection or a clipped primary fall back to its source frame", () => {
    const content = paint("same", { role: "content", ownerNodeId: "same" });
    content.bbox = { x: 10, y: 10, w: 10, h: 10 };
    const source = group("same", [
      content,
      paint("same:outline", { role: "decoration", ownerNodeId: "same" }),
    ]);
    source.ownership = { role: "source", on: { onClick: "select" } };
    const ir = document(source);
    expect(hitTest(ir, 15, 15)?.sourceIndex).toBe(0);
    expect(hitTest(ir, 90, 90)).toBeNull();
    expect(buildInspectHitTestIndex(ir).queryTopmost(90, 90)).toBeNull();
  });

  it("places handler-only source frames after children while inspection prefers descendants", () => {
    const root = group("parent", [paint("child")]);
    root.ownership = { role: "source", on: { onClick: "parent" } };
    const ir = document(root);
    expect(buildHitTestIndex(ir).queryTopmost(10, 10)?.nodeId).toBe("parent");
    expect(buildInspectHitTestIndex(ir).queryTopmost(10, 10)?.nodeId).toBe("child");
  });

  it("uses the direct source child for an outer wrapper even when its label equals an ancestor", () => {
    const outer: IRNode = {
      ...group("frame", [group("same")]),
      ownership: { role: "wrapper", placement: "outer", ownerNodeId: "same" },
    };
    const index = buildIRSourceIndex(document(group("same", [outer])));
    expect(index.nodes.get(1)?.source.sourceIndex).toBe(2);
    expect(index.sources.get(2)?.parentSourceIndex).toBe(0);
  });

  it("rejects dangling owners, duplicate content, wrong kind, invalid outer placement and metadata", () => {
    for (const root of [
      group("a", [paint("x", { role: "content", ownerNodeId: "b" })]),
      group("a", [
        paint("x", { role: "content", ownerNodeId: "a" }),
        paint("y", { role: "content", ownerNodeId: "a" }),
      ]),
      { ...group("a"), ownership: { role: "content", ownerNodeId: "a" } },
      { ...group("outer"), ownership: { role: "wrapper", placement: "outer", ownerNodeId: "a" } },
      { ...group("a"), ownership: { role: "source", meta: { 'a" data-extra="value': "x" } } },
    ] satisfies IRNode[]) {
      expect(() => buildIRSourceIndex(document(root))).toThrow();
    }
    const root = group("a");
    root.ownership = { role: "source", meta: { text: "😀".repeat(128) } };
    expect(() => buildIRSourceIndex(document(root))).not.toThrow();
    root.ownership.meta = { text: "😀".repeat(129) };
    expect(() => buildIRSourceIndex(document(root))).toThrow();
  });

  it("leaves generic inserted IDs opaque, including generated-looking suffixes", () => {
    const index = createSpatialIndex(bbox);
    index.insert("card:outline", bbox, 0);
    index.insert("card:content", bbox, 1);
    expect(index.queryCandidates(10, 10)).toEqual(["card:content", "card:outline"]);
  });
});

it("keeps all physical text outlines while copying and selecting only primary source text", () => {
  const text: Extract<IRNode, { type: "text" }> = {
    type: "text",
    nodeId: "same",
    ownership: { role: "content", ownerNodeId: "same" },
    bbox,
    font: "F",
    fontSizePx: 12,
    color: "black",
    textAlign: "start",
    layoutBox: bbox,
    lineHeightPx: 14,
    lines: [{ text: "primary", glyphs: [], width: 20, baselineY: 12 }],
    glyphPaths: [
      {
        nodeId: "same",
        d: "M0 0H10V10Z",
        fill: "black",
        glyphIds: [1],
        text: "primary",
        bbox,
        sourceStart: 0,
        sourceEnd: 7,
        sourceRole: "content",
      },
    ],
  };
  const decoration: IRNode = {
    ...text,
    glyphPaths: [],
    ownership: { role: "decoration", ownerNodeId: "same" },
    lines: [{ text: "ornament", glyphs: [], width: 20, baselineY: 12 }],
  };
  const ir = document(group("same", [text, decoration]));
  const sourceIndex = buildIRSourceIndex(ir);
  expect(getAllText(buildTextMap(sourceIndex))).toBe("primary");
  expect([...buildTextSelectionMap(sourceIndex).nodes.keys()]).toEqual([0]);
  expect(
    projectResolvedTextOutlines(ir).map((entry) => ({
      nodeIndex: entry.nodeIndex,
      source: entry.source,
      role: entry.ownership.role,
      paths: entry.paths.map((path) => path.d),
    })),
  ).toEqual([
    {
      nodeIndex: 1,
      source: { sourceIndex: 0, nodeId: "same" },
      role: "content",
      paths: ["M0 0H10V10Z"],
    },
    { nodeIndex: 2, source: { sourceIndex: 0, nodeId: "same" }, role: "decoration", paths: [] },
  ]);
});

it("indexes reused JS node values as separate tree occurrences across inspection, selection and layers", () => {
  const textBox = { x: 0, y: 0, w: 10, h: 10 };
  const sharedText: IRNode = {
    type: "text",
    nodeId: "repeat",
    ownership: { role: "source" },
    bbox: textBox,
    layoutBox: textBox,
    font: "F",
    fontSizePx: 10,
    lineHeightPx: 10,
    color: "black",
    textAlign: "start",
    lines: [{ text: "A", glyphs: [], width: 10, baselineY: 8 }],
    glyphPaths: [
      {
        nodeId: "repeat",
        d: "M0 0H10V10Z",
        fill: "black",
        glyphIds: [1],
        text: "A",
        bbox: textBox,
        sourceStart: 0,
        sourceEnd: 1,
        sourceRole: "content",
      },
    ],
  };
  const ir = document(
    group("root", [
      group("first", [sharedText]),
      { ...group("second", [sharedText]), transform: { translateX: 20 } },
    ]),
  );
  const index = buildIRSourceIndex(ir);
  const boxes = collectInspectionBBoxes(index).filter((entry) => entry.type === "text");
  expect(
    boxes.map((entry) => [
      entry.nodeIndex,
      entry.source.sourceIndex,
      entry.transformBox.points[0]?.x,
    ]),
  ).toEqual([
    [2, 2, 0],
    [4, 4, 20],
  ]);
  const selection = buildTextSelectionMap(index);
  expect([...selection.nodes.keys()]).toEqual([2, 4]);
  expect(selection.nodes.get(4)?.glyphs[0]?.points[0].x).toBe(20);
  expect(hitTest(ir, 1, 1)).toEqual({ sourceIndex: 2, nodeId: "repeat" });
  expect(hitTest(ir, 21, 1)).toEqual({ sourceIndex: 4, nodeId: "repeat" });
  const layered = renderLayeredSvg({
    ir,
    sourceNodeMap: new Map(),
    emitLayerSvg: (layerIr) => JSON.stringify(layerIr),
  });
  expect(layered.layers[0]?.sources.map((entry) => entry.source)).toEqual([
    { sourceIndex: 2, nodeId: "repeat" },
    { sourceIndex: 4, nodeId: "repeat" },
  ]);
});
