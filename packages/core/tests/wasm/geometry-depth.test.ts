import {
  type GeometryDoc,
  type GeometryNode,
  geometryDoc,
  groupGeometry,
  pathGeometry,
  type SymbolDefinition,
} from "@boundsvg/shape";
import { beforeAll, describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import { compileGeometryToSvgDocument, resolveSymbolGeometry } from "../../src/shape/compiler.js";
import {
  assertGeometryTreeDepth,
  MAX_GEOMETRY_TREE_DEPTH,
} from "../../src/shape/geometry-depth.js";
import { getWasm } from "../../src/wasm/index.js";
import { assertWasmPkgAvailable } from "./test-prerequisites.js";

function nestedGroupGeometry(depth: number, leafId?: string): GeometryDoc {
  let root: GeometryNode = pathGeometry("M0 0H10V10H0Z", { nodeId: leafId });
  for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
    root = groupGeometry([root]);
  }
  return geometryDoc({ width: 10, height: 10 }, root);
}

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

describe("geometry depth through WASM", () => {
  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
  });

  it("compiles a group tree at the maximum accepted depth", () => {
    const svg = compileGeometryToSvgDocument(nestedGroupGeometry(MAX_GEOMETRY_TREE_DEPTH));

    expect(svg).toContain('<path d="M0,0L10,0L10,10L0,10Z"');
  });

  it("keeps elastic wrapper accounting aligned at the accepted boundary", () => {
    const symbol: SymbolDefinition = {
      geometry: nestedGroupGeometry(MAX_GEOMETRY_TREE_DEPTH - 1, "elastic"),
      elasticSegments: [
        {
          nodeId: "elastic",
          axis: "x",
          role: "fixed-end",
          frame: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
    };

    const resolved = resolveSymbolGeometry(symbol, { width: 20, height: 10 });

    expect(() => assertGeometryTreeDepth(resolved, { operation: "compileShapeSvg" })).not.toThrow();
    expect(compileGeometryToSvgDocument(resolved)).toContain('<path d="M10,0L20,0L20,10L10,10Z"');
  });

  it("reports depth introduced by symbol resolution from the Rust boundary", () => {
    const definition: SymbolDefinition = {
      geometry: nestedGroupGeometry(MAX_GEOMETRY_TREE_DEPTH, "elastic"),
      elasticSegments: [
        {
          nodeId: "elastic",
          axis: "x",
          role: "fixed-end",
          frame: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
    };

    const fatalError = captureFatal(() =>
      resolveSymbolGeometry(definition, { width: 20, height: 10 }),
    );
    expect(fatalError.toJSON()).toEqual({
      severity: "fatal",
      code: "SHAPE_GEOMETRY_MAX_DEPTH",
      message: "Shape geometry exceeds the maximum tree depth.",
      stage: "validate",
      context: {
        operation: "resolveSymbolGeometry",
        actual: MAX_GEOMETRY_TREE_DEPTH + 1,
        limit: MAX_GEOMETRY_TREE_DEPTH,
      },
    });
  });

  it("keeps the authored-depth tuple identical across Core and raw WASM", () => {
    const overDepth = nestedGroupGeometry(MAX_GEOMETRY_TREE_DEPTH + 1);
    const coreFatal = captureFatal(() => compileGeometryToSvgDocument(overDepth));
    const rawCompile = getWasm().compile_shape_svg;
    expect(rawCompile).toBeTypeOf("function");

    let rawThrown: unknown;
    try {
      rawCompile?.(
        JSON.stringify({
          geometry: overDepth,
          preserveAspectRatio: "none",
          partIds: false,
        }),
      );
    } catch (error) {
      rawThrown = error;
    }
    expect(typeof rawThrown).toBe("string");
    expect(JSON.parse(rawThrown as string)).toEqual(coreFatal.toJSON());
  });
});
