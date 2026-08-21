import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import type { CanvasSceneNode, ShapeSceneNode, SymbolSceneNode } from "../../src/scene/types.js";
// biome-ignore lint/suspicious/noShadowRestrictedNames: matches VNodeType "Symbol"
import { Shape, Symbol } from "../../src/vnode/components.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const rectGeometry = {
  viewBox: { width: 20, height: 10 },
  root: {
    kind: "path" as const,
    d: "M0 0H20V10H0Z",
  },
};

const fullRectGeometry = {
  viewBox: { width: 200, height: 120 },
  root: {
    kind: "path" as const,
    d: "M0 0H200V120H0Z",
  },
};

const notchCardGeometry = {
  viewBox: { width: 300, height: 200 },
  root: {
    kind: "boolean" as const,
    op: "subtract" as const,
    children: [
      {
        kind: "path" as const,
        d: "M16 0H284C292.837 0 300 7.163 300 16V184C300 192.837 292.837 200 284 200H16C7.163 200 0 192.837 0 184V16C0 7.163 7.163 0 16 0Z",
      },
      {
        kind: "path" as const,
        d: "M150 0Q150 30 125 30Q100 30 100 0Z",
      },
    ],
  },
};

const arrowSymbol = {
  geometry: {
    viewBox: { width: 100, height: 20 },
    root: {
      kind: "group" as const,
      children: [
        { kind: "path" as const, nodeId: "tail", d: "M0 8H10V12H0Z" },
        { kind: "path" as const, nodeId: "shaft", d: "M10 8H70V12H10Z" },
        { kind: "path" as const, nodeId: "head", d: "M70 4L100 10L70 16Z" },
      ],
    },
  },
  elasticSegments: [
    {
      nodeId: "tail",
      axis: "x" as const,
      role: "fixed-start" as const,
      frame: { x: 0, y: 0, width: 10, height: 20 },
    },
    {
      nodeId: "shaft",
      axis: "x" as const,
      role: "stretch" as const,
      frame: { x: 10, y: 0, width: 60, height: 20 },
    },
    {
      nodeId: "head",
      axis: "x" as const,
      role: "fixed-end" as const,
      frame: { x: 70, y: 0, width: 30, height: 20 },
    },
  ],
};

describe("Shape integration", () => {
  it("round-trips Shape through SceneDocument", () => {
    const vnode = Shape({
      geometry: rectGeometry,
      width: 40,
      height: 20,
      fill: "#2563eb",
    });

    const scene = toSceneDocument(vnode) as ShapeSceneNode;
    expect(scene.type).toBe("Shape");
    expect(scene.geometry?.viewBox.width).toBe(20);

    const restored = fromSceneDocument(scene);
    expect(restored.type).toBe("Shape");
  });

  it("renders registered geometry through Shape", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "rect", doc: rectGeometry }],
    });
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 120,
      height: 60,
      children: [{ type: "Shape", geometryId: "rect", width: 80, height: 30, fill: "#2563eb" }],
    } as CanvasSceneNode);
    expect(svg).toContain("<svg");
    expect(svg).toContain("#2563eb");
    expect(svg).toContain("M0,0L80,0L80,30L0,30Z");
  });

  it("registers and unregisters geometry after engine construction", () => {
    const engine = createEngineFromHandle(handle);
    const scene = {
      type: "Canvas",
      width: 120,
      height: 60,
      children: [{ type: "Shape", geometryId: "runtime-rect", width: 80, height: 30 }],
    } as CanvasSceneNode;

    engine.registerGeometry("runtime-rect", rectGeometry);
    expect(engine.renderToSvg(scene)).toContain("M0,0L80,0L80,30L0,30Z");

    engine.unregisterGeometry("runtime-rect");
    expect(() => engine.renderToSvg(scene)).toThrowError(/unknown geometryId "runtime-rect"/);
  });

  it("attaches the Shape node id to unknown-geometryId errors", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "rect", doc: rectGeometry }],
    });
    try {
      engine.renderToSvg({
        type: "Canvas",
        width: 120,
        height: 60,
        children: [{ type: "Shape", id: "badge", geometryId: "nope", width: 80, height: 30 }],
      } as CanvasSceneNode);
      expect.unreachable("renderToSvg should throw");
    } catch (error) {
      const fatal = error as { code?: string; nodeId?: string };
      expect(fatal.code).toBe("SHAPE_GEOMETRY_NOT_FOUND");
      expect(fatal.nodeId).toBe("badge");
    }
  });

  it("labels missing-geometry errors with the <Shape> fallback id", () => {
    const engine = createEngineFromHandle(handle);
    try {
      engine.renderToSvg({
        type: "Canvas",
        width: 120,
        height: 60,
        children: [{ type: "Shape", width: 80, height: 30 }],
      } as CanvasSceneNode);
      expect.unreachable("renderToSvg should throw");
    } catch (error) {
      const fatal = error as { code?: string; nodeId?: string };
      expect(fatal.code).toBe("SHAPE_GEOMETRY_MISSING");
      expect(fatal.nodeId).toBe("<Shape>");
    }
  });

  it("renders subtract geometry as a resolved result boundary", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "notch-card", doc: notchCardGeometry }],
    });
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 420,
      height: 240,
      children: [
        {
          type: "Shape",
          geometryId: "notch-card",
          width: 300,
          height: 200,
          fill: "#1e293b",
          stroke: "#475569",
          strokeWidth: 2,
        },
      ],
    } as CanvasSceneNode);

    expect(svg).toContain('<path d="M');
    // Boolean evaluation flattens curves to line segments (robust topology
    // over curve fidelity; the notch stays accurate within the flatness
    // tolerance). A dense polyline proves the curve was subdivided, not
    // collapsed to its chord.
    const pathData = /<path d="([^"]*)"/.exec(svg)?.[1] ?? "";
    expect(pathData).not.toContain("Q");
    expect((pathData.match(/L/g) ?? []).length).toBeGreaterThan(20);
    expect(svg).not.toContain('clip-path="url(#');
    expect(svg).toContain('stroke="#475569"');
  });

  it("insets stroked shapes by half the stroke width across engine rendering", () => {
    const cases = [
      { strokeWidth: 1, expectedPath: "M0.5,0.5L399.5,0.5L399.5,239.5L0.5,239.5Z" },
      { strokeWidth: 2, expectedPath: "M1,1L399,1L399,239L1,239Z" },
      { strokeWidth: 4, expectedPath: "M2,2L398,2L398,238L2,238Z" },
      { strokeWidth: 8, expectedPath: "M4,4L396,4L396,236L4,236Z" },
    ] as const;

    for (const testCase of cases) {
      const engine = createEngineFromHandle(handle, {
        geometries: [{ id: "full-rect", doc: fullRectGeometry }],
      });
      const svg = engine.renderToSvg({
        type: "Canvas",
        width: 420,
        height: 260,
        children: [
          {
            type: "Shape",
            geometryId: "full-rect",
            width: 400,
            height: 240,
            fill: "#0f172a",
            stroke: "#475569",
            strokeWidth: testCase.strokeWidth,
          },
        ],
      } as CanvasSceneNode);

      expect(svg).toContain(`stroke-width="${testCase.strokeWidth}"`);
      expect(svg).toContain(testCase.expectedPath);
    }
  });
});

describe("Shape and Symbol opacity", () => {
  it("applies Shape opacity exactly once, on the wrapper only", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "rect", doc: rectGeometry }],
    });
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 120,
      height: 60,
      children: [
        {
          type: "Shape",
          geometryId: "rect",
          width: 80,
          height: 30,
          fill: "#2563eb",
          opacity: 0.5,
        },
      ],
    } as CanvasSceneNode);

    expect((svg.match(/opacity="0\.5"/g) ?? []).length).toBe(1);
    expect(svg).not.toMatch(/<path[^>]*\sopacity=/);
  });

  it("applies Symbol opacity exactly once, on the wrapper only", () => {
    const engine = createEngineFromHandle(handle, {
      symbols: [{ id: "arrow", def: arrowSymbol }],
    });
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 220,
      height: 80,
      children: [
        {
          type: "Symbol",
          symbolId: "arrow",
          width: 160,
          height: 20,
          fill: "#111827",
          opacity: 0.5,
        },
      ],
    } as CanvasSceneNode);

    expect((svg.match(/opacity="0\.5"/g) ?? []).length).toBe(1);
    expect(svg).not.toMatch(/<path[^>]*\sopacity=/);
  });
});

describe("Symbol integration", () => {
  it("round-trips Symbol through SceneDocument", () => {
    const vnode = Symbol({
      symbol: arrowSymbol,
      width: 160,
      height: 20,
      fill: "#111827",
    });

    const scene = toSceneDocument(vnode) as SymbolSceneNode;
    expect(scene.type).toBe("Symbol");
    expect(scene.symbol?.geometry.viewBox.width).toBe(100);

    const restored = fromSceneDocument(scene);
    expect(restored.type).toBe("Symbol");
  });

  it("renders registered symbols and applies elastic transforms", () => {
    const engine = createEngineFromHandle(handle, {
      symbols: [{ id: "arrow", def: arrowSymbol }],
    });
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 220,
      height: 80,
      children: [{ type: "Symbol", symbolId: "arrow", width: 160, height: 20, fill: "#111827" }],
    } as CanvasSceneNode);

    expect(svg).not.toContain("scale(");
    expect(svg).not.toContain("translate(");
    expect(svg).toContain("M10,8L130,8L130,12L10,12Z");
    expect(svg).toContain("M130,4L160,10L130,16Z");
    expect(svg).toContain("#111827");
  });

  it("registers and unregisters symbols after engine construction", () => {
    const engine = createEngineFromHandle(handle);
    const scene = {
      type: "Canvas",
      width: 220,
      height: 80,
      children: [{ type: "Symbol", symbolId: "runtime-arrow", width: 160, height: 20 }],
    } as CanvasSceneNode;

    engine.registerSymbol("runtime-arrow", arrowSymbol);
    expect(engine.renderToSvg(scene)).toContain("M130,4L160,10L130,16Z");

    engine.unregisterSymbol("runtime-arrow");
    expect(() => engine.renderToSvg(scene)).toThrowError(/unknown symbolId "runtime-arrow"/);
  });
});

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});
