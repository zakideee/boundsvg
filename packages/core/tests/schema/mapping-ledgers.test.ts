import { describe, expect, it } from "vitest";
import { buildLayoutTransportJson } from "../../src/layout/taffy-layout-adapter.js";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import {
  RUST_IR_TO_PUBLIC_IR_MAPPING,
  SCENE_TO_WASM_MAPPING,
  VNODE_SCENE_KEY_MISMATCH_LEDGER,
  VNODE_TO_SCENE_MAPPING,
} from "../../src/schema/mapping-ledgers.js";
import { createElement } from "../../src/vnode/create-element.js";

type WireNode = {
  nodeId: string;
  nodeType: string;
  authoredId: boolean;
  style: Record<string, unknown>;
  children: WireNode[];
  text?: Record<string, unknown>;
  textPath?: Record<string, unknown>;
  visual?: Record<string, unknown>;
};

function collectWireNodes(root: WireNode): WireNode[] {
  return [root, ...root.children.flatMap(collectWireNodes)];
}

function containsProperty(value: unknown, propertyName: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsProperty(item, propertyName));
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Object.hasOwn(value, propertyName)) {
    return true;
  }
  return Object.values(value).some((nestedValue) => containsProperty(nestedValue, propertyName));
}

function buildMappingFixture() {
  const animation = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 120,
  } as const;
  const geometry = {
    viewBox: { width: 10, height: 10 },
    root: { kind: "path" as const, d: "M0 0H10V10H0Z" },
  };

  return createElement(
    "Canvas",
    {
      id: "root",
      meta: { fixture: "mapping-ledger" },
      width: 640,
      height: 360,
      background: "#010203",
      debug: true,
      language: "ja",
      onPointerCancel: "root-cancel",
    },
    createElement(
      "Flex",
      {
        id: "flex",
        direction: "row",
        wrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        width: 200,
        height: 80,
        background: "#111111",
        borderWidth: 1,
        borderColor: "#ffffff",
        transform: { translateX: 2 },
        animate: animation,
        layer: "foreground",
        onClick: "flex-click",
      },
      createElement(
        "Grid",
        {
          id: "grid",
          templateColumns: "1fr 1fr",
          templateRows: "auto",
          gap: 4,
          gridColumn: "1 / 2",
        },
        createElement("Box", {
          id: "box",
          width: 20,
          height: 10,
          position: "absolute",
          top: 1,
          right: 2,
          padding: [1, 2, 3, 4],
          margin: 1,
          borderRadius: 2,
          strokeScaling: "canvas",
          onPointerCancel: "box-cancel",
        }),
      ),
    ),
    createElement(
      "Text",
      {
        id: "text",
        font: "FixtureFont",
        fallback: ["FallbackFont"],
        fontSizePx: 18,
        fontWeight: 700,
        color: "#223344",
        textAlign: "center",
        textStroke: "#ffffff",
        textStrokeWidth: 1,
        textStrokes: [{ color: "#000000", widthPx: 2 }],
        textShadows: [{ dx: 1, dy: 2, color: "#00000080" }],
        animateUnits: { by: "cluster", animation },
        onPointerCancel: "text-cancel",
      },
      "plain",
      createElement(
        "Inline",
        {
          fontStyle: "italic",
          textDecoration: { line: "underline" },
          background: "#334455",
          animate: animation,
        },
        "inline",
        createElement("InlineRect", {
          inlineSizePx: 4,
          blockSizePx: "line",
          color: "#ff0000",
        }),
      ),
      createElement("InlineBox", { paddingInline: [2, 3], background: "#445566" }, "box"),
      createElement(
        "Ruby",
        { rubyPosition: "over", rubyAlign: "center" },
        "漢字",
        createElement("Rt", { fontSizePx: 9, language: "ja" }, "かんじ"),
      ),
    ),
    createElement(
      "TextOnPath",
      {
        id: "text-path",
        d: "M0 20L200 20",
        width: 200,
        height: 40,
        font: "FixtureFont",
        fontSizePx: 16,
        pathFit: "spacing",
        pathOverflow: "ellipsis",
        color: "#556677",
      },
      createElement("Inline", { fontWeight: 600, color: "#667788" }, "path"),
    ),
    createElement("Image", {
      id: "image",
      src: new Uint8Array([137, 80, 78, 71]),
      mediaType: "image/png",
      width: 10,
      height: 10,
      objectFit: "cover",
    }),
    createElement("Path", {
      id: "path",
      d: "M0 0L10 10",
      width: 10,
      height: 10,
      stroke: "#778899",
      strokeWidth: 2,
      strokeScaling: "canvas",
    }),
    createElement("Svg", {
      id: "svg",
      content: '<rect width="10" height="10"/>',
      width: 10,
      height: 10,
      preserveAspectRatio: "meet",
      contentIdPrefix: "fixture",
    }),
    createElement("Shape", {
      id: "shape",
      geometry,
      geometryId: "shape-geometry",
      width: 10,
      height: 10,
      fill: "#8899aa",
      emitPartIds: true,
    }),
    createElement("Symbol", {
      id: "symbol",
      symbol: { geometry },
      symbolId: "shape-symbol",
      width: 10,
      height: 10,
      fill: "#99aabb",
    }),
  );
}

describe("semantic mapping ledgers", () => {
  it("enumerates every current source field at all three mapping edges", () => {
    expect(VNODE_SCENE_KEY_MISMATCH_LEDGER).toEqual({});
    expect(Object.keys(VNODE_TO_SCENE_MAPPING)).toHaveLength(16);
    expect(
      Object.values(VNODE_TO_SCENE_MAPPING).reduce(
        (fieldCount, nodeLedger) => fieldCount + Object.keys(nodeLedger).length,
        0,
      ),
    ).toBe(683);
    expect(
      Object.values(SCENE_TO_WASM_MAPPING).reduce(
        (fieldCount, nodeLedger) => fieldCount + Object.keys(nodeLedger).length,
        0,
      ),
    ).toBe(709);
    expect(Object.keys(RUST_IR_TO_PUBLIC_IR_MAPPING)).toHaveLength(8);
    expect(
      Object.values(RUST_IR_TO_PUBLIC_IR_MAPPING).reduce(
        (fieldCount, nodeLedger) => fieldCount + Object.keys(nodeLedger).length,
        0,
      ),
    ).toBe(107);
  });

  it("round-trips every VNode variant and exercises each WASM mapping category", () => {
    const vnode = buildMappingFixture();
    const scene = toSceneDocument(vnode);
    expect(toSceneDocument(fromSceneDocument(scene))).toEqual(scene);

    const transport = JSON.parse(
      buildLayoutTransportJson(fromSceneDocument(scene), { fonts: [] }),
    ) as { root: WireNode; fonts: unknown[] };
    const wireNodes = collectWireNodes(transport.root);
    const wireNodesById = new Map(wireNodes.map((node) => [node.nodeId, node]));

    expect(transport.fonts).toEqual([]);
    expect(wireNodes.every((node) => node.authoredId)).toBe(true);
    expect(new Set(wireNodes.map((node) => node.nodeType))).toEqual(
      new Set([
        "canvas",
        "flex",
        "grid",
        "box",
        "text",
        "textonpath",
        "image",
        "path",
        "svg",
        "shape",
        "symbol",
      ]),
    );
    expect(wireNodesById.get("box")?.style).toMatchObject({
      width: 20,
      height: 10,
      position: "absolute",
      padding: [1, 2, 3, 4],
    });
    expect(wireNodesById.get("box")?.visual).toMatchObject({
      borderRadius: 2,
      strokeScaling: "canvas",
      handlers: { onPointerCancel: "box-cancel" },
    });
    expect(wireNodesById.get("text")?.text).toMatchObject({
      fontFamily: ["FixtureFont", "FallbackFont"],
      fontWeight: 700,
      unitMap: { kind: "cluster", ruby: "with-base" },
    });
    expect(wireNodesById.get("text")?.visual).toMatchObject({
      color: "#223344",
      textAlign: "center",
      textStroke: "#ffffff",
      handlers: { onPointerCancel: "text-cancel" },
    });
    expect(wireNodesById.get("text-path")?.textPath).toMatchObject({
      d: "M0 20L200 20",
      pathFit: "spacing",
      pathOverflow: "ellipsis",
    });
    expect(wireNodesById.get("image")?.visual?.src).toBe("data:image/png;base64,iVBORw==");
    expect(wireNodesById.get("shape")?.visual).toMatchObject({
      shapeGeometryId: "shape-geometry",
      emitPartIds: true,
    });
    expect(wireNodesById.get("symbol")?.visual).toMatchObject({
      symbolId: "shape-symbol",
    });
    expect(containsProperty(transport, "layer")).toBe(false);
  });

  it("preserves authored ID provenance independently from the resolved ID string", () => {
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", { id: "auto:0.0", width: 40, height: 30 }),
    );
    const transport = JSON.parse(buildLayoutTransportJson(vnode, {})) as { root: WireNode };

    expect(transport.root).toMatchObject({ nodeId: "auto:0", authoredId: false });
    expect(transport.root.children[0]).toMatchObject({
      nodeId: "auto:0.0",
      authoredId: true,
    });
  });
});
