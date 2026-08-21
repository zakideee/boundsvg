import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

/**
 * A subpath that drew nothing aborted the whole shape. `M400 400Z` raised
 * EmptyPath ("geometry path data must not be empty" — while the path plainly
 * was not empty) and a trailing `M400 400` raised OpenSubpath, so a single
 * stray subpath from an SVG exporter threw away an otherwise valid square.
 * Both are valid SVG that renders the square.
 */

const geometry = (d: string) => ({
  viewBox: { width: 400, height: 400 },
  root: { kind: "path" as const, d },
});

const SQUARE = "M100 100H300V300H100Z";

describe("degenerate subpaths do not destroy a valid shape", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "JP", weight: 400, style: "normal", data: loadSubsetFont() }],
      geometries: [
        { id: "clean", doc: geometry(SQUARE) },
        { id: "collapsed-subpath", doc: geometry(`${SQUARE} M400 400Z`) },
        { id: "trailing-moveto", doc: geometry(`${SQUARE} M400 400`) },
        { id: "collapsed-first", doc: geometry(`M400 400Z ${SQUARE}`) },
        { id: "form-feed", doc: geometry("M100\f100H300V300H100Z") },
        { id: "close-followed-by-close", doc: geometry(`${SQUARE}Z`) },
        { id: "empty", doc: geometry("\n\t\r\f") },
        { id: "non-finite", doc: geometry("M1e309 0L0 0Z") },
        { id: "open-subpath", doc: geometry("M100 100H300V300") },
        // `S`/`T` are SVG path commands the parser rejected outright, so a
        // Shape whose geometry used a smooth curve — what editors emit — threw.
        { id: "smooth-cubic", doc: geometry("M20 20C40 10 60 10 80 20S140 60 160 20Z") },
        { id: "smooth-quad", doc: geometry("M20 50Q60 10 100 50T180 50Z") },
      ],
    });
  });

  const render = (geometryId: string) =>
    engine.renderToSvg({
      type: "Canvas",
      width: 400,
      height: 400,
      children: [{ type: "Shape", geometryId, width: 400, height: 400, fill: "#111111" }],
    } as never);

  for (const geometryId of [
    "clean",
    "collapsed-subpath",
    "trailing-moveto",
    "collapsed-first",
    "form-feed",
    "close-followed-by-close",
  ]) {
    it(`${geometryId}: renders a path`, () => {
      const svg = render(geometryId);
      expect(svg).toContain("<path");
      expect(svg).toContain("#111111");
    });
  }

  it("empty SVG path data renders nothing without throwing", () => {
    expect(render("empty")).not.toContain("<path");
  });

  it("non-finite numeric results are rejected before SVG emission", () => {
    expect(() => render("non-finite")).toThrow(/invalid path data/i);
  });

  it("an open subpath is implicitly closed for fill", () => {
    const svg = render("open-subpath");
    expect(svg).toContain("<path");
    expect(svg).toContain("#111111");
  });
});
