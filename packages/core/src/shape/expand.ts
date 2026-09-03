import { FatalError } from "../errors.js";
import type { VNode, VNodeFor } from "../vnode/types.js";
import { assertGeometryTreeDepth, assertSymbolDefinitionGeometryDepth } from "./geometry-depth.js";
import type { GeometryDoc, SymbolDefinition } from "./types.js";

export type ShapeRegistry = {
  geometries: ReadonlyMap<string, GeometryDoc>;
  symbols: ReadonlyMap<string, SymbolDefinition>;
};

/**
 * Walk the tree and resolve every Shape/Symbol registry reference, so
 * missing ids fail at validate time (Fatal), not after layout.
 */
export function assertShapeReferencesResolvable(node: VNode, registry: ShapeRegistry): void {
  switch (node.type) {
    case "Shape":
      resolveGeometry(node, registry);
      return;
    case "Symbol":
      resolveSymbol(node, registry);
      return;
    case "Canvas":
    case "Flex":
    case "Grid":
    case "Box":
      for (const child of node.children) {
        if (typeof child !== "string") {
          assertShapeReferencesResolvable(child, registry);
        }
      }
      return;
    default:
      return;
  }
}

function shapeNodeLabel(node: VNode): string {
  if ("id" in node.props && typeof node.props.id === "string") {
    return node.props.id;
  }
  return `<${node.type}>`;
}

function resolveGeometry(node: VNodeFor<"Shape">, registry: ShapeRegistry): GeometryDoc {
  const { geometry: inlineGeometry, geometryId } = node.props;
  const nodeId = shapeNodeLabel(node);
  if (inlineGeometry) {
    assertGeometryTreeDepth(inlineGeometry, { operation: "renderShape", nodeId });
    return inlineGeometry;
  }
  if (!geometryId) {
    throw new FatalError(
      "SHAPE_GEOMETRY_MISSING",
      "Shape requires either a geometry object or geometryId.",
      { stage: "validate", nodeId },
    );
  }
  const geometry = registry.geometries.get(geometryId);
  if (!geometry) {
    throw new FatalError(
      "SHAPE_GEOMETRY_NOT_FOUND",
      `Shape references unknown geometryId "${geometryId}".`,
      { stage: "validate", nodeId },
    );
  }
  assertGeometryTreeDepth(geometry, { operation: "renderShape", nodeId });
  return geometry;
}

function resolveSymbol(node: VNodeFor<"Symbol">, registry: ShapeRegistry): SymbolDefinition {
  const { symbol: inlineSymbol, symbolId } = node.props;
  const nodeId = shapeNodeLabel(node);
  if (inlineSymbol) {
    assertSymbolDefinitionGeometryDepth(inlineSymbol, { operation: "renderSymbol", nodeId });
    return inlineSymbol;
  }
  if (!symbolId) {
    throw new FatalError(
      "SHAPE_SYMBOL_MISSING",
      "Symbol requires either a symbol definition or symbolId.",
      { stage: "validate", nodeId },
    );
  }
  const symbol = registry.symbols.get(symbolId);
  if (!symbol) {
    throw new FatalError(
      "SHAPE_SYMBOL_NOT_FOUND",
      `Symbol references unknown symbolId "${symbolId}".`,
      { stage: "validate", nodeId },
    );
  }
  assertSymbolDefinitionGeometryDepth(symbol, { operation: "renderSymbol", nodeId });
  return symbol;
}
