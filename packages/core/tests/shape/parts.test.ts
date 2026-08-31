import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IRNode } from "../../src/ir/types.js";
import type { CanvasSceneNode } from "../../src/scene/types.js";
import {
  evaluateGeometryParts,
  hitTestGeometryParts,
  hitTestShapeAt,
} from "../../src/shape/compiler.js";
import { compileShapeParts } from "../../src/shape/expand.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

// group[ path#bg, boolean#ribbon(union, transversal overlap), unnamed path ]
const badgeGeometry = {
  viewBox: { width: 300, height: 200 },
  root: {
    kind: "group" as const,
    nodeId: "badge",
    children: [
      { kind: "path" as const, nodeId: "bg", d: "M0 0H300V200H0Z" },
      {
        kind: "boolean" as const,
        nodeId: "ribbon",
        op: "union" as const,
        children: [
          { kind: "path" as const, d: "M20 80H160V120H20Z" },
          { kind: "path" as const, d: "M140 70H280V110H140Z" },
        ],
      },
      { kind: "path" as const, d: "M250 20H290V60H250Z" },
    ],
  },
};

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

describe("evaluateGeometryParts", () => {
  it("returns addressable parts with documented attribution", () => {
    const parts = evaluateGeometryParts(badgeGeometry);
    expect(parts.map((part) => part.partId)).toEqual(["bg", "ribbon", "part:2"]);
    const ribbon = parts[1];
    expect(ribbon?.bounds).toMatchObject({ x: 20, width: 260 });
    // boolean children fused into one contour
    expect(ribbon?.region.contours).toHaveLength(1);
  });
});

describe("Shape emitPartIds", () => {
  function render(emitPartIds: boolean | undefined): string {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    return engine.renderToSvg({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Shape",
          geometryId: "badge",
          width: 300,
          height: 200,
          fill: "#1e293b",
          ...(emitPartIds === undefined ? {} : { emitPartIds }),
        },
      ],
    } as CanvasSceneNode);
  }

  it("tags one path per part when enabled", () => {
    const svg = render(true);
    expect(svg).toContain('data-boundsvg-part-id="bg"');
    expect(svg).toContain('data-boundsvg-part-id="ribbon"');
    expect(svg).toContain('data-boundsvg-part-id="part:2"');
  });

  it("keeps the fused single-path output by default", () => {
    const svg = render(undefined);
    expect(svg).not.toContain("data-boundsvg-part-id");
  });

  it("default output is byte-identical to pre-feature output shape", () => {
    expect(render(undefined)).toBe(render(false));
  });

  it("keeps part ids intact when the Shape has an id (contentIdPrefix must not rewrite data-*-id)", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Shape",
          id: "medal",
          geometryId: "badge",
          width: 300,
          height: 200,
          fill: "#1e293b",
          emitPartIds: true,
        },
      ],
    } as CanvasSceneNode);
    expect(svg).toContain('data-boundsvg-part-id="bg"');
    expect(svg).not.toContain('data-boundsvg-part-id="medal-');
  });
});

describe("Shape preserveAspectRatio", () => {
  const geometry = {
    viewBox: { width: 100, height: 50 },
    root: { kind: "path" as const, d: "M0 0H100V50H0Z" },
  };

  function render(preserveAspectRatio: "none" | "meet" | "slice"): string {
    const engine = createEngineFromHandle(handle);
    return engine.renderToSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      children: [
        {
          type: "Shape",
          geometry,
          width: 200,
          height: 200,
          fill: "#111111",
          preserveAspectRatio,
        },
      ],
    } as CanvasSceneNode);
  }

  it("bakes none, meet, and slice into distinct viewport paths", () => {
    expect(render("none")).toContain('d="M0,0L200,0L200,200L0,200Z"');
    expect(render("meet")).toContain('d="M0,50L200,50L200,150L0,150Z"');
    expect(render("slice")).toContain('d="M-100,0L300,0L300,200L-100,200Z"');
  });
});

describe("Shape layout survival", () => {
  it("keeps the Shape node through layout instead of pre-expanding to Svg", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    const layout = engine.renderToLayoutTree({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [{ type: "Shape", id: "medal", geometryId: "badge", width: 300, height: 200 }],
    } as CanvasSceneNode);
    expect(layout.root.children[0]?.vnode.type).toBe("Shape");
    expect(layout.root.children[0]?.bbox).toMatchObject({ width: 300, height: 200 });
  });

  it("still fails fast on an unknown geometryId before layout", () => {
    const engine = createEngineFromHandle(handle);
    expect(() =>
      engine.renderToSvg({
        type: "Canvas",
        width: 100,
        height: 100,
        children: [{ type: "Shape", geometryId: "nope", width: 50, height: 50 }],
      } as CanvasSceneNode),
    ).toThrowError(/unknown geometryId "nope"/);
  });
});

describe("hitTestGeometryParts / hitTestShapeAt", () => {
  it("returns hit parts in paint order with the topmost last", () => {
    const hits = hitTestGeometryParts(badgeGeometry, { x: 100, y: 100 });
    expect(hits).toEqual([
      { partId: "bg", hit: "fill" },
      { partId: "ribbon", hit: "fill" },
    ]);
    expect(hitTestGeometryParts(badgeGeometry, { x: -10, y: -10 })).toEqual([]);
  });

  it("reports stroke hits inside the stroke band", () => {
    const hits = hitTestGeometryParts(badgeGeometry, { x: 100, y: 80.5 }, { strokeWidth: 2 });
    expect(hits.find((hit) => hit.partId === "ribbon")).toEqual({
      partId: "ribbon",
      hit: "stroke",
    });
  });

  it("reports a stroke hit for an open stroke-only part", () => {
    const lineGeometry = {
      viewBox: { width: 200, height: 200 },
      root: { kind: "path" as const, nodeId: "wire", d: "M20 100L180 100" },
    };
    expect(
      hitTestGeometryParts(lineGeometry, { x: 100, y: 100 }, { strokeWidth: 6, tolerance: 0 }),
    ).toEqual([{ partId: "wire", hit: "stroke" }]);
  });

  it("applies the render-level default fill rule to hit testing", () => {
    const compoundGeometry = {
      viewBox: { width: 200, height: 200 },
      root: {
        kind: "path" as const,
        nodeId: "frame",
        d: "M20 20H180V180H20Z M60 60H140V140H60Z",
      },
    };
    expect(hitTestGeometryParts(compoundGeometry, { x: 100, y: 100 })).toEqual([
      { partId: "frame", hit: "fill" },
    ]);
    expect(
      hitTestGeometryParts(compoundGeometry, { x: 100, y: 100 }, { fillRule: "evenodd" }),
    ).toEqual([]);
    expect(
      hitTestShapeAt(
        compoundGeometry,
        { x: 100, y: 100 },
        {
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          fillRule: "evenodd",
        },
      ),
    ).toEqual([]);
  });

  it("maps canvas coordinates through the shape placement", () => {
    // Badge placed at (40, 10) scaled 2x: geometry (100, 100) -> canvas (240, 210).
    const placement = { x: 40, y: 10, width: 600, height: 400 };
    const hits = hitTestShapeAt(badgeGeometry, { x: 240, y: 210 }, placement);
    expect(hits.map((hit) => hit.partId)).toEqual(["bg", "ribbon"]);
  });

  it("accounts for the renderer's stroke inset when strokeWidthPx is set", () => {
    // strokeWidthPx=4 -> the renderer bakes with a 2px inset per side:
    // scale (600-4)/300, offset +2. The ribbon's top edge (geometry y=80)
    // paints at canvas y = 10 + 2 + 80 * (400-4)/200 = 170.4.
    const placement = { x: 40, y: 10, width: 600, height: 400, strokeWidthPx: 4 };
    const strokeHits = hitTestShapeAt(badgeGeometry, { x: 240, y: 170.4 }, placement);
    expect(strokeHits.find((hit) => hit.partId === "ribbon")?.hit).toBe("stroke");
    // 4px stroke = ~1 geometry unit band; 3px above the painted edge is out.
    const missHits = hitTestShapeAt(badgeGeometry, { x: 240, y: 166 }, placement);
    expect(missHits.find((hit) => hit.partId === "ribbon")).toBeUndefined();
  });
});

describe("structural shape emit", () => {
  it("emits one native path per part with no embedded svg document", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Shape",
          id: "medal",
          geometryId: "badge",
          width: 300,
          height: 200,
          fill: "#1e293b",
          emitPartIds: true,
        },
      ],
    } as CanvasSceneNode);

    // Positioned wrapper, structural paths - not a re-parsed compiled document.
    expect(svg).toContain('<svg data-boundsvg-node-id="medal" x="0" y="0" width="300"');
    expect((svg.match(/xmlns=/g) ?? []).length).toBe(1);
    expect((svg.match(/data-boundsvg-part-id=/g) ?? []).length).toBe(3);
    expect((svg.match(/fill="#1e293b"/g) ?? []).length).toBe(3);
  });

  it("bakes geometry at the laid-out box, not the requested props size", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    // Flex-shrunk Shape: props ask 300 wide, but a 150px row shrinks it to 150.
    const ir = engine.renderToIR({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Flex",
          direction: "row",
          width: 150,
          height: 200,
          alignItems: "stretch",
          children: [
            {
              type: "Shape",
              id: "shrunk",
              geometryId: "badge",
              width: 300,
              height: 200,
              flexShrink: 1,
            },
          ],
        },
      ],
    } as CanvasSceneNode);

    let shapeNode: IRNode | undefined;
    const walk = (node: IRNode): void => {
      if (node.type === "shape") {
        shapeNode = node;
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
    };
    walk(ir.root);

    expect(shapeNode?.type).toBe("shape");
    expect(shapeNode?.bbox).toMatchObject({ w: 150, h: 200 });
    const fused = shapeNode?.shapeParts?.[0];
    // bg spans the full geometry, so its baked bounds equal the laid-out box
    // (width 150, not the requested 300).
    expect(fused?.bounds).toMatchObject({ width: 150, height: 200 });
  });
});

describe("partPaint", () => {
  function renderWithPartPaint(input: {
    emitPartIds?: boolean;
    partPaint?: Record<string, { fill?: string; stroke?: string; strokeWidth?: number }>;
  }): { svg: string; warnings: string[] } {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    const compiled = engine.compile({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Shape",
          id: "medal",
          geometryId: "badge",
          width: 300,
          height: 200,
          fill: "#1e293b",
          stroke: "#94a3b8",
          strokeWidth: 2,
          ...input,
        },
      ],
    } as CanvasSceneNode);
    return {
      svg: engine.renderCompiledToSvg(compiled),
      warnings: engine.snapshotCompiledIR(compiled).warnings.map((warning) => warning.code),
    };
  }

  it("merges per-part overrides over the base paint", () => {
    const { svg } = renderWithPartPaint({
      emitPartIds: true,
      partPaint: { ribbon: { fill: "#f97316" }, "part:2": { stroke: "#22c55e", strokeWidth: 4 } },
    });
    // ribbon: fill overridden, stroke inherited
    expect(svg).toMatch(
      /fill="#f97316" stroke="#94a3b8" stroke-width="2" data-boundsvg-part-id="ribbon"/,
    );
    // part:2: fill inherited, stroke overridden
    expect(svg).toMatch(
      /fill="#1e293b" stroke="#22c55e" stroke-width="4" data-boundsvg-part-id="part:2"/,
    );
    // bg untouched
    expect(svg).toMatch(
      /fill="#1e293b" stroke="#94a3b8" stroke-width="2" data-boundsvg-part-id="bg"/,
    );
  });

  it("splits parts for partPaint without leaking ids when emitPartIds is off", () => {
    const { svg } = renderWithPartPaint({ partPaint: { ribbon: { fill: "#f97316" } } });
    expect(svg).not.toContain("data-boundsvg-part-id");
    expect(svg).toContain('fill="#f97316"');
    expect((svg.match(/<path d=/g) ?? []).length).toBe(3);
  });

  it("warns on unknown partIds and ignores the entry", () => {
    const { svg, warnings } = renderWithPartPaint({
      emitPartIds: true,
      partPaint: { nope: { fill: "#ff0000" } },
    });
    expect(warnings).toContain("SHAPE_PART_PAINT_UNKNOWN_PART");
    expect(svg).not.toContain("#ff0000");
  });
});

describe("defs/use sharing and compile cache", () => {
  function renderTwoBadges(options?: { secondFill?: string; resourceIdPrefix?: string }): string {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    return engine.renderToSvg(
      {
        type: "Canvas",
        width: 700,
        height: 300,
        children: [
          {
            type: "Shape",
            id: "left",
            geometryId: "badge",
            width: 300,
            height: 200,
            fill: "#1e293b",
            emitPartIds: true,
            position: "absolute",
            left: 0,
            top: 0,
          },
          {
            type: "Shape",
            id: "right",
            geometryId: "badge",
            width: 300,
            height: 200,
            fill: options?.secondFill ?? "#1e293b",
            emitPartIds: true,
            position: "absolute",
            left: 350,
            top: 0,
          },
        ],
      } as CanvasSceneNode,
      options?.resourceIdPrefix ? { resourceIdPrefix: options.resourceIdPrefix } : undefined,
    );
  }

  it("hoists byte-identical parts to defs and emits use references", () => {
    const svg = renderTwoBadges();
    expect((svg.match(/<defs>/g) ?? []).length).toBe(1);
    expect((svg.match(/<path id="sp-/g) ?? []).length).toBe(3);
    expect((svg.match(/<use href="#sp-/g) ?? []).length).toBe(6);
    // part ids ride on the use elements
    expect(svg).toMatch(/<use href="#sp-[a-z0-9]+" data-boundsvg-part-id="ribbon"\/>/);
  });

  it("does not share across different paint and emits inline for single occurrences", () => {
    const svg = renderTwoBadges({ secondFill: "#f97316" });
    expect(svg).not.toContain("<use href=");
    expect(svg).not.toContain("<defs>");
  });

  it("prefixes shared ids with resourceIdPrefix", () => {
    const svg = renderTwoBadges({ resourceIdPrefix: "doc1-" });
    expect(svg).toMatch(/<path id="doc1-sp-/);
    expect(svg).toMatch(/<use href="#doc1-sp-/);
  });

  it("memoizes compiled parts per registry cache", () => {
    const cache = new Map<string, never[]>();
    const registry = {
      geometries: new Map([["badge", badgeGeometry]]),
      symbols: new Map(),
      compileCache: cache as never,
    };
    const vnode = {
      type: "Shape",
      props: { geometryId: "badge", width: 300, height: 200, fill: "#1e293b" },
      children: [],
    } as never;
    const first = compileShapeParts(vnode, registry as never, { width: 300, height: 200 });
    const second = compileShapeParts(vnode, registry as never, { width: 300, height: 200 });
    expect(cache.size).toBe(1);
    expect(second).toBe(first);
    const scaled = compileShapeParts(vnode, registry as never, { width: 150, height: 100 });
    expect(scaled).not.toBe(first);
    expect(cache.size).toBe(2);
  });
});

describe("layered manifest parts", () => {
  it("keeps stroke-only part geometry in layered SVG and its manifest bounds", () => {
    const lineGeometry = {
      viewBox: { width: 200, height: 200 },
      root: { kind: "path" as const, nodeId: "wire", d: "M20 100L180 100" },
    };
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "line", doc: lineGeometry }],
    });
    const result = engine.renderToLayeredSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      children: [
        {
          type: "Shape",
          id: "line",
          geometryId: "line",
          width: 200,
          height: 200,
          fill: "none",
          stroke: "#ef4444",
          strokeWidth: 6,
          emitPartIds: true,
        },
      ],
    } as CanvasSceneNode);

    expect(result.layers[0]?.svg).toContain('stroke="#ef4444"');
    expect(result.layers[0]?.svg).toContain('data-boundsvg-part-id="wire"');
    expect(result.manifest.layers[0]?.parts?.[0]).toMatchObject({
      partId: "wire",
      nodeId: "line",
      bbox: { height: 0 },
    });
    expect(result.manifest.layers[0]?.parts?.[0]?.bbox?.width).toBeGreaterThan(150);
  });

  it("surfaces Shape parts in the layer manifest when emitPartIds is on", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    const result = engine.renderToLayeredSvg({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Shape",
          id: "medal",
          geometryId: "badge",
          width: 300,
          height: 200,
          fill: "#1e293b",
          emitPartIds: true,
        },
      ],
    } as CanvasSceneNode);

    expect(result.manifest.layers).toHaveLength(1);
    expect(result.manifest.layers[0]?.parts).toEqual([
      { partId: "bg", nodeId: "medal", bbox: { x: 0, y: 0, width: 300, height: 200 } },
      { partId: "ribbon", nodeId: "medal", bbox: { x: 20, y: 70, width: 260, height: 50 } },
      { partId: "part:2", nodeId: "medal", bbox: { x: 250, y: 20, width: 40, height: 40 } },
    ]);
  });

  it("honors the Shape layer prop through expansion", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    const result = engine.renderToLayeredSvg({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Shape",
          id: "medal",
          layer: "badge",
          geometryId: "badge",
          width: 300,
          height: 200,
          fill: "#1e293b",
          emitPartIds: true,
        },
      ],
    } as CanvasSceneNode);
    const badgeLayer = result.manifest.layers.find((layer) => layer.id === "badge");
    expect(badgeLayer?.parts?.map((part) => part.partId)).toEqual(["bg", "ribbon", "part:2"]);
  });

  it("omits parts when emitPartIds is off", () => {
    const engine = createEngineFromHandle(handle, {
      geometries: [{ id: "badge", doc: badgeGeometry }],
    });
    const result = engine.renderToLayeredSvg({
      type: "Canvas",
      width: 400,
      height: 300,
      children: [
        {
          type: "Shape",
          id: "medal",
          geometryId: "badge",
          width: 300,
          height: 200,
          fill: "#1e293b",
        },
      ],
    } as CanvasSceneNode);

    expect(result.manifest.layers[0]?.parts).toBeUndefined();
  });
});
