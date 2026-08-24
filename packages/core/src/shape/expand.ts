import { FatalError } from "../errors.js";
import type { VNode, VNodeFor } from "../vnode/types.js";
import { wasmCompileShapePaths } from "../wasm/index.js";
import { assertGeometryTreeDepth } from "./geometry-depth.js";
import type {
  CompiledShapePathPart,
  GeometryDoc,
  GeometryNode,
  SymbolDefinition,
} from "./types.js";

export type ShapeRegistry = {
  geometries: ReadonlyMap<string, GeometryDoc>;
  symbols: ReadonlyMap<string, SymbolDefinition>;
  /**
   * Optional per-engine memo for compiled part paths, keyed by the full
   * compile input (geometry content + paint + viewport + split mode), so
   * repeated identical shapes skip kernel evaluation. Deterministic: a hit
   * returns exactly what the compile produced.
   */
  compileCache?: Map<string, CompiledShapePathPart[]>;
};

const COMPILE_CACHE_MAX_ENTRIES = 128;

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

/**
 * Compile a Shape node's geometry into viewport-baked part paths.
 *
 * The viewport is the node's laid-out box, so flex/grid-resized shapes bake
 * at their actual size after layout.
 */
export function compileShapeParts(
  node: VNodeFor<"Shape">,
  registry: ShapeRegistry,
  viewport: { width: number; height: number },
): CompiledShapePathPart[] {
  const geometry = resolveGeometry(node, registry);
  return compileToParts(geometry, node.props, { viewport, cache: registry.compileCache });
}

/** Compile a Symbol node: elastic segments resolve at the laid-out size first. */
type ShapePaintProps = VNodeFor<"Shape">["props"] | VNodeFor<"Symbol">["props"];

type CompileToPartsOptions = {
  viewport: { width: number; height: number };
  cache?: Map<string, CompiledShapePathPart[]>;
};

function compileToParts(
  geometry: GeometryDoc,
  props: ShapePaintProps,
  options: CompileToPartsOptions,
): CompiledShapePathPart[] {
  const { viewport, cache } = options;
  const cacheKey = cache
    ? JSON.stringify([
        geometry,
        props.fill,
        props.stroke,
        props.strokeWidth,
        props.fillRule,
        props.strokeLinecap,
        props.strokeLinejoin,
        props.strokeDasharray,
        props.strokeMiterlimit,
        props.preserveAspectRatio ?? "none",
        props.emitPartIds ?? false,
        props.partPaint,
        viewport,
      ])
    : undefined;
  if (cache && cacheKey !== undefined) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const compiled = wasmCompileShapePathsWithProps(geometry, props, viewport);
  if (cache && cacheKey !== undefined) {
    if (cache.size >= COMPILE_CACHE_MAX_ENTRIES) {
      cache.clear();
    }
    cache.set(cacheKey, compiled);
  }
  return compiled;
}

function wasmCompileShapePathsWithProps(
  geometry: GeometryDoc,
  props: ShapePaintProps,
  viewport: { width: number; height: number },
): CompiledShapePathPart[] {
  let compileStroke = props.stroke;
  let compileStrokeWidth = props.strokeWidth;
  for (const override of Object.values(props.partPaint ?? {})) {
    const effectiveStroke = override.stroke ?? props.stroke;
    if (effectiveStroke === undefined || effectiveStroke === "none") {
      continue;
    }
    const effectiveWidth = override.strokeWidth ?? props.strokeWidth ?? 1;
    if (
      compileStroke === undefined ||
      compileStroke === "none" ||
      effectiveWidth > (compileStrokeWidth ?? 1)
    ) {
      compileStroke = effectiveStroke;
      compileStrokeWidth = effectiveWidth;
    }
  }
  return wasmCompileShapePaths(geometry, {
    // partPaint needs the parts split apart even when ids are not emitted.
    partIds: (props.emitPartIds ?? false) || props.partPaint !== undefined,
    preserveAspectRatio: props.preserveAspectRatio ?? "none",
    paint: {
      fill: props.fill,
      // Viewport baking needs the widest effective per-part stroke so it is
      // not clipped before partPaint is applied in the IR.
      stroke: compileStroke,
      strokeWidth: compileStrokeWidth,
      fillRule: props.fillRule,
      strokeLinecap: props.strokeLinecap,
      strokeLinejoin: props.strokeLinejoin,
      strokeDasharray: props.strokeDasharray,
      strokeMiterlimit: props.strokeMiterlimit,
    },
    viewport,
  });
}

function shapeNodeLabel(node: VNode): string {
  if ("id" in node.props && typeof node.props.id === "string") {
    return node.props.id;
  }
  return `<${node.type}>`;
}

function assertValidShapeGeometry(geometry: GeometryDoc, nodeId: string): void {
  assertGeometryTreeDepth(geometry, nodeId);
  const seenPartIds = new Set<string>();
  let nextPartIndex = 0;
  const visit = (geometryNode: GeometryNode): void => {
    switch (geometryNode.kind) {
      case "group":
        for (const child of geometryNode.children) {
          visit(child);
        }
        return;
      case "transform":
        visit(geometryNode.child);
        return;
      case "path":
      case "boolean": {
        const partId = geometryNode.nodeId ?? `part:${nextPartIndex}`;
        nextPartIndex += 1;
        if (seenPartIds.has(partId)) {
          throw new FatalError(
            "SHAPE_DUPLICATE_PART_ID",
            `Shape contains duplicate addressable part id "${partId}".`,
            { stage: "validate", nodeId, partId },
          );
        }
        seenPartIds.add(partId);
        // Boolean children fuse into this one addressable part.
        return;
      }
    }
  };
  visit(geometry.root);
}

function resolveGeometry(node: VNodeFor<"Shape">, registry: ShapeRegistry): GeometryDoc {
  const { geometry: inlineGeometry, geometryId } = node.props;
  const nodeId = shapeNodeLabel(node);
  if (inlineGeometry) {
    assertValidShapeGeometry(inlineGeometry, nodeId);
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
  assertValidShapeGeometry(geometry, nodeId);
  return geometry;
}

function resolveSymbol(node: VNodeFor<"Symbol">, registry: ShapeRegistry): SymbolDefinition {
  const { symbol: inlineSymbol, symbolId } = node.props;
  const nodeId = shapeNodeLabel(node);
  if (inlineSymbol) {
    assertValidShapeGeometry(inlineSymbol.geometry, nodeId);
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
  assertValidShapeGeometry(symbol.geometry, nodeId);
  return symbol;
}
