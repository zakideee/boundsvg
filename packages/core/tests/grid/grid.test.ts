import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { mapToLayoutStyle } from "../../src/layout/taffy-style-mapper.js";
import { validate } from "../../src/validate/index.js";
import { Box, Canvas, Flex, Grid } from "../../src/vnode/components.js";
import type { VNode } from "../../src/vnode/types.js";
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

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe("Grid validation", () => {
  it("accepts a valid Grid node", () => {
    const tree = Canvas(
      { width: 400, height: 300 },
      Grid(
        { templateColumns: "100px 1fr 2fr", templateRows: "auto 100px" },
        Box({ width: 100, height: 100 }),
        Box({ width: 100, height: 100 }),
      ),
    );
    expect(() => validate(tree)).not.toThrow();
  });

  it("accepts Grid without template props", () => {
    const tree = Canvas({ width: 400, height: 300 }, Grid({}, Box({ width: 100, height: 100 })));
    expect(() => validate(tree)).not.toThrow();
  });

  it("rejects Grid with non-string templateColumns", () => {
    const tree: VNode = {
      type: "Canvas",
      props: { width: 400, height: 300 },
      children: [
        {
          type: "Grid",
          props: {
            // @ts-expect-error intentional invalid runtime validation case
            templateColumns: 123,
          },
          children: [],
        },
      ],
    };
    expect(() => validate(tree)).toThrow("templateColumns");
  });

  it("rejects Grid with non-string templateRows", () => {
    const tree: VNode = {
      type: "Canvas",
      props: { width: 400, height: 300 },
      children: [
        {
          type: "Grid",
          props: {
            // @ts-expect-error intentional invalid runtime validation case
            templateRows: [100, 200],
          },
          children: [],
        },
      ],
    };
    expect(() => validate(tree)).toThrow("templateRows");
  });
});

// ---------------------------------------------------------------------------
// Style mapper tests
// ---------------------------------------------------------------------------

describe("Grid style mapping", () => {
  it("maps Grid to display: grid", () => {
    const vnode: VNode = {
      type: "Grid",
      props: { templateColumns: "100px 1fr", templateRows: "auto" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.display).toBe("grid");
  });

  it("parses templateColumns into array", () => {
    const vnode: VNode = {
      type: "Grid",
      props: { templateColumns: "100px  1fr  2fr" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridTemplateColumns).toEqual(["100px", "1fr", "2fr"]);
  });

  it("parses templateRows into array", () => {
    const vnode: VNode = {
      type: "Grid",
      props: { templateRows: "auto 100px" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridTemplateRows).toEqual(["auto", "100px"]);
  });

  it("maps gap/rowGap/columnGap", () => {
    const vnode: VNode = {
      type: "Grid",
      props: { gap: 10 },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gap.top).toBe(10);
    expect(style.gap.right).toBe(10);
  });

  it("maps separate rowGap and columnGap", () => {
    const vnode: VNode = {
      type: "Grid",
      props: { rowGap: 8, columnGap: 16 },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gap.top).toBe(8);
    expect(style.gap.right).toBe(16);
  });

  it("maps alignItems and justifyItems", () => {
    const vnode: VNode = {
      type: "Grid",
      props: { alignItems: "center", justifyItems: "end" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.alignItems).toBe("center");
    expect(style.justifyItems).toBe("end");
  });

  it("maps Grid size, padding, margin, overflow", () => {
    const vnode: VNode = {
      type: "Grid",
      props: {
        width: 400,
        height: 300,
        padding: 10,
        margin: [5, 10, 15, 20],
        overflow: "clip",
      },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.size.width).toBe(400);
    expect(style.size.height).toBe(300);
    expect(style.padding).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
    expect(style.margin).toEqual({ top: 5, right: 10, bottom: 15, left: 20 });
    expect(style.overflow).toBe("hidden");
  });
});

// ---------------------------------------------------------------------------
// Grid item placement (gridColumn/gridRow) tests
// ---------------------------------------------------------------------------

describe("Grid item placement mapping", () => {
  it("parses gridColumn '1 / 3' on a Box child", () => {
    const vnode: VNode = {
      type: "Box",
      props: { gridColumn: "1 / 3", width: 100, height: 50 },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridColumnStart).toBe(1);
    expect(style.gridColumnEnd).toBe(3);
  });

  it("parses gridRow '2 / 4' on a Flex child", () => {
    const vnode: VNode = {
      type: "Flex",
      props: { gridRow: "2 / 4" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridRowStart).toBe(2);
    expect(style.gridRowEnd).toBe(4);
  });

  it("parses gridColumn span shorthand '2 / span 3'", () => {
    const vnode: VNode = {
      type: "Box",
      props: { gridColumn: "2 / span 3", width: 100, height: 50 },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridColumnStart).toBe(2);
    expect(style.gridColumnEnd).toBe(5);
  });

  it("parses gridRow span shorthand '1 / span 2'", () => {
    const vnode: VNode = {
      type: "Flex",
      props: { gridRow: "1 / span 2" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridRowStart).toBe(1);
    expect(style.gridRowEnd).toBe(3);
  });

  it("parses gridColumn with single value", () => {
    const vnode: VNode = {
      type: "Box",
      props: { gridColumn: "2", width: 100, height: 50 },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridColumnStart).toBe(2);
    expect(style.gridColumnEnd).toBeUndefined();
  });

  it("does not set grid placement when not provided", () => {
    const vnode: VNode = {
      type: "Box",
      props: { width: 100, height: 50 },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridColumnStart).toBeUndefined();
    expect(style.gridRowStart).toBeUndefined();
  });

  it("applies gridColumn/gridRow to Text nodes", () => {
    const vnode: VNode = {
      type: "Text",
      props: { font: "sans", fontSizePx: 16, gridColumn: "1 / 2", gridRow: "1" },
      children: ["hello"],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridColumnStart).toBe(1);
    expect(style.gridColumnEnd).toBe(2);
    expect(style.gridRowStart).toBe(1);
  });

  it("applies gridColumn/gridRow to Image nodes", () => {
    const vnode: VNode = {
      type: "Image",
      props: { src: "test.png", width: 100, height: 100, gridColumn: "3" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridColumnStart).toBe(3);
  });

  it("applies gridColumn/gridRow to Path nodes", () => {
    const vnode: VNode = {
      type: "Path",
      props: { d: "M0 0L10 10", width: 10, height: 10, gridRow: "2 / 3" },
      children: [],
    };
    const style = mapToLayoutStyle(vnode);
    expect(style.gridRowStart).toBe(2);
    expect(style.gridRowEnd).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Layout integration (real WASM layout)
// ---------------------------------------------------------------------------

describe("Grid layout integration", () => {
  it("computes layout with Grid container", () => {
    const tree = Canvas(
      { width: 400, height: 300 },
      Grid(
        { templateColumns: "200px 200px", templateRows: "150px 150px" },
        Box({ width: 200, height: 150 }),
        Box({ width: 200, height: 150 }),
        Box({ width: 200, height: 150 }),
        Box({ width: 200, height: 150 }),
      ),
    );

    const result = engine.renderToLayoutTree(tree);

    expect(result.root).toBeDefined();
    expect(result.root.children.length).toBe(1); // Grid container
    const gridNode = result.root.children[0]!;
    expect(gridNode.children.length).toBe(4); // 4 boxes
    // Real grid layout: 2x2 tracks of 200x150 place the boxes at the track origins.
    expect(gridNode.children.map((child) => child.bbox)).toEqual([
      { x: 0, y: 0, width: 200, height: 150 },
      { x: 200, y: 0, width: 200, height: 150 },
      { x: 0, y: 150, width: 200, height: 150 },
      { x: 200, y: 150, width: 200, height: 150 },
    ]);
  });

  it("builds IR from Grid layout", () => {
    const tree = Canvas(
      { width: 400, height: 300 },
      Grid(
        {
          templateColumns: "200px 200px",
          background: "#ffffff",
        },
        Box({ width: 200, height: 150, background: "#ff0000" }),
        Box({ width: 200, height: 150, background: "#00ff00" }),
      ),
    );

    const ir = engine.renderToIR(tree);

    expect(ir.root).toBeDefined();
    expect(ir.width).toBe(400);
    expect(ir.height).toBe(300);
  });

  it("passes Grid with Flex nested inside", () => {
    const tree = Canvas(
      { width: 600, height: 400 },
      Grid(
        { templateColumns: "300px 300px" },
        Flex(
          { direction: "row", width: 300, height: 200, gridColumn: "1" },
          Box({ width: 100, height: 100 }),
          Box({ width: 100, height: 100 }),
        ),
        Box({ width: 300, height: 200, gridColumn: "2" }),
      ),
    );

    expect(() => validate(tree)).not.toThrow();

    const result = engine.renderToLayoutTree(tree);
    expect(result.root.children.length).toBe(1); // Grid
    const gridNode = result.root.children[0]!;
    expect(gridNode.children.length).toBe(2); // Flex + Box
    // gridColumn "1" and "2" place the Flex and Box in the two 300px columns.
    const [flexNode, boxNode] = gridNode.children;
    expect(flexNode!.bbox.x).toBe(0);
    expect(boxNode!.bbox.x).toBe(300);
    // The Flex lays out its two boxes in a row.
    expect(flexNode!.children.map((child) => child.bbox.x)).toEqual([0, 100]);
  });
});

// ---------------------------------------------------------------------------
// Grid SVG output
// ---------------------------------------------------------------------------

describe("Grid SVG output", () => {
  it("renders Grid with background and children", () => {
    const tree = Canvas(
      { width: 400, height: 300 },
      Grid(
        { templateColumns: "200px 200px", background: "#eeeeee" },
        Box({ width: 200, height: 150, background: "#ff0000" }),
        Box({ width: 200, height: 150, background: "#00ff00" }),
      ),
    );

    const svg = engine.renderToSvg(tree);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    // Grid background
    expect(svg).toContain("#eeeeee");
    // Child backgrounds
    expect(svg).toContain("#ff0000");
    expect(svg).toContain("#00ff00");
  });
});
