import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

/**
 * A Shape's stroke followed the fill-normalized region, which drops
 * zero-area contours and retraces self-intersections. A stroked line vanished
 * entirely — `<path>` count 0, no warning — and a stroked bowtie was drawn as
 * the two retraced triangles instead of the crossing outline the author wrote.
 *
 * Neither was a limitation of the rasterizer: handing the same path data to
 * resvg through a raw `Svg` node draws both. The kernel dropped them first.
 *
 * A part now carries `strokeD` when fill normalization changed the geometry,
 * and the emitter strokes that instead. Shapes whose fill region already is
 * their outline — the overwhelming majority — carry no `strokeD` and emit
 * exactly the same single path as before.
 */

const geometry = (d: string) => ({
  viewBox: { width: 200, height: 200 },
  root: { kind: "path" as const, d },
});

function captureFatal(callback: () => unknown): FatalError {
  let capturedError: unknown;
  try {
    callback();
  } catch (error) {
    capturedError = error;
  }
  expect(capturedError).toBeInstanceOf(FatalError);
  return capturedError as FatalError;
}

describe("a Shape strokes what its author drew", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "JP", weight: 400, style: "normal", data: loadSubsetFont() }],
      geometries: [
        { id: "box", doc: geometry("M20 20H180V180H20Z") },
        { id: "line", doc: geometry("M20 100L180 100Z") },
        { id: "open-line", doc: geometry("M20 100L180 100") },
        { id: "bowtie", doc: geometry("M20 20L180 180L180 20L20 180Z") },
        {
          id: "part-line",
          doc: {
            viewBox: { width: 200, height: 200 },
            root: {
              kind: "group",
              children: [{ kind: "path", nodeId: "wire", d: "M20 100L180 100" }],
            },
          },
        },
        {
          id: "edge-part-line",
          doc: {
            viewBox: { width: 200, height: 200 },
            root: {
              kind: "group",
              children: [{ kind: "path", nodeId: "wire", d: "M0 0L200 0" }],
            },
          },
        },
        {
          id: "aspect-part",
          doc: {
            viewBox: { width: 100, height: 50 },
            root: {
              kind: "path",
              nodeId: "frame",
              d: "M0 0H100V50H0Z",
            },
          },
        },
        {
          id: "duplicate-parts",
          doc: {
            viewBox: { width: 100, height: 50 },
            root: {
              kind: "group",
              children: [
                { kind: "path", nodeId: "same", d: "M0 0H40V40H0Z" },
                { kind: "path", nodeId: "same", d: "M60 0H100V40H60Z" },
              ],
            },
          },
        },
        {
          id: "generated-id-collision",
          doc: {
            viewBox: { width: 100, height: 50 },
            root: {
              kind: "group",
              children: [
                { kind: "path", nodeId: "part:1", d: "M0 0H40V40H0Z" },
                { kind: "path", d: "M60 0H100V40H60Z" },
              ],
            },
          },
        },
      ],
      symbols: [
        {
          id: "wire-symbol",
          def: { geometry: geometry("M20 100L180 100"), elasticSegments: [] },
        },
      ],
    });
  });

  const strokedSvg = (geometryId: string) =>
    engine.renderToSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      background: "#ffffff",
      children: [
        {
          type: "Shape",
          geometryId,
          width: 200,
          height: 200,
          fill: "none",
          stroke: "#e11d48",
          strokeWidth: 6,
        },
      ],
    } as never);

  it("a zero-area contour is still stroked", () => {
    const svg = strokedSvg("line");
    expect(svg, "the stroked line vanished").toContain("<path");
    expect(svg).toContain("#e11d48");
    // The path is the line the author drew, not an empty d.
    expect(svg).toMatch(/d="M[\d.]+,100L[\d.]+,100Z"/);
  });

  it("a self-crossing outline is stroked as drawn, not as its retraced fill", () => {
    const svg = strokedSvg("bowtie");
    const strokePath = svg.match(/<path d="([^"]+)"[^/]*stroke="#e11d48"/)?.[1];
    expect(strokePath, "no stroked path emitted").toBeDefined();
    // The authored bowtie is one crossing contour; the fill region is two
    // triangles. The stroke must follow the former.
    expect(strokePath).not.toContain("Z M");
  });

  it("an ordinary shape still emits a single path", () => {
    const svg = strokedSvg("box");
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
    expect(svg).toContain("#e11d48");
  });

  it("keeps an open line open", () => {
    const svg = strokedSvg("open-line");
    const strokePath = svg.match(/<path d="([^"]+)"[^/]*stroke="#e11d48"/)?.[1];
    expect(strokePath).toBeDefined();
    expect(strokePath).not.toContain("Z");
    for (let iteration = 0; iteration < 10; iteration += 1) {
      expect(strokedSvg("open-line")).toBe(svg);
    }
  });

  it("preserves the default fill when split geometry has no explicit paint", () => {
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      children: [{ type: "Shape", geometryId: "bowtie", width: 200, height: 200 }],
    } as never);
    expect(svg).toContain("<path");
    expect((svg.match(/<path d=/g) ?? []).length).toBe(1);
  });

  it("honors a per-part stroke override on stroke-only geometry", () => {
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      children: [
        {
          type: "Shape",
          geometryId: "part-line",
          width: 200,
          height: 200,
          partPaint: { wire: { stroke: "#22c55e", strokeWidth: 8 } },
        },
      ],
    } as never);
    expect(svg).toContain('stroke="#22c55e"');
    expect(svg).toContain('stroke-width="8"');
  });

  it("insets the viewport for the widest per-part stroke", () => {
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      children: [
        {
          type: "Shape",
          geometryId: "edge-part-line",
          width: 200,
          height: 200,
          partPaint: { wire: { stroke: "#22c55e", strokeWidth: 20 } },
        },
      ],
    } as never);
    expect(svg).toContain('d="M10,10L190,10"');
    expect(svg).toContain('stroke-width="20"');
  });

  it("preserves open stroke geometry through Symbol resolution", () => {
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      children: [
        {
          type: "Symbol",
          symbolId: "wire-symbol",
          width: 200,
          height: 200,
          fill: "none",
          stroke: "#2563eb",
          strokeWidth: 6,
        },
      ],
    } as never);
    const strokePath = svg.match(/<path d="([^"]+)"[^/]*stroke="#2563eb"/)?.[1];
    expect(strokePath).toBeDefined();
    expect(strokePath).not.toContain("Z");
  });

  it.each([
    ["none", 'd="M10,10L190,10L190,190L10,190Z"'],
    ["meet", 'd="M10,55L190,55L190,145L10,145Z"'],
    ["slice", 'd="M-80,10L280,10L280,190L-80,190Z"'],
  ] as const)("combines preserveAspectRatio=%s with per-part stroke padding", (preserveAspectRatio, expectedPath) => {
    const svg = engine.renderToSvg({
      type: "Canvas",
      width: 200,
      height: 200,
      children: [
        {
          type: "Shape",
          geometryId: "aspect-part",
          width: 200,
          height: 200,
          preserveAspectRatio,
          partPaint: { frame: { fill: "none", stroke: "#7c3aed", strokeWidth: 20 } },
        },
      ],
    } as never);
    expect(svg).toContain(expectedPath);
    expect(svg).toContain('stroke="#7c3aed"');
    expect(svg).toContain('stroke-width="20"');
  });

  it("rejects duplicate addressable part ids even without emitted part attributes", () => {
    const fatalError = captureFatal(() =>
      engine.renderToSvg({
        type: "Canvas",
        width: 100,
        height: 50,
        children: [
          {
            type: "Shape",
            geometryId: "duplicate-parts",
            width: 100,
            height: 50,
          },
        ],
      } as never),
    );
    expect(fatalError).toMatchObject({
      code: "SHAPE_DUPLICATE_PART_ID",
      message: "Shape contains a duplicate addressable part id.",
      stage: "validate",
      context: {
        operation: "renderShape",
        partIdPrefix: "same",
        omittedPartIdByteCount: 0,
      },
    });
  });

  it("rejects explicit part ids that collide with generated positional ids", () => {
    const fatalError = captureFatal(() =>
      engine.renderToSvg({
        type: "Canvas",
        width: 100,
        height: 50,
        children: [
          {
            type: "Shape",
            geometryId: "generated-id-collision",
            width: 100,
            height: 50,
          },
        ],
      } as never),
    );
    expect(fatalError).toMatchObject({
      code: "SHAPE_DUPLICATE_PART_ID",
      message: "Shape contains a duplicate addressable part id.",
      stage: "validate",
      context: {
        operation: "renderShape",
        partIdPrefix: "part:1",
        omittedPartIdByteCount: 0,
      },
    });
  });
});
