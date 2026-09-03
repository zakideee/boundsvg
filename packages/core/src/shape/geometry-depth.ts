import {
  SHAPE_GEOMETRY_DEPTH_LIMIT,
  type ShapeOperand,
  type ShapeOperation,
  shapeDepthBoundaryFailure,
  shapeInputBoundaryFailure,
} from "../wasm/shape-fatal-decoder.js";
import type { GeometryDoc, SymbolDefinition } from "./types.js";

/** Geometry root is depth 0; recursive nodes through depth 48 are accepted. */
export const MAX_GEOMETRY_TREE_DEPTH = SHAPE_GEOMETRY_DEPTH_LIMIT;

type GeometryDepthGuardContext = {
  operation: ShapeOperation;
  operand?: ShapeOperand;
  nodeId?: string;
};

type GeometryDepthFrame = {
  node: unknown;
  depth: number;
};

function invalidGeometry(context: GeometryDepthGuardContext): never {
  throw shapeInputBoundaryFailure(context.operation, "invalidRequestShape", context.nodeId);
}

function unreadableGeometry(context: GeometryDepthGuardContext): never {
  throw shapeInputBoundaryFailure(context.operation, "serializationFailed", context.nodeId);
}

function isObject(value: unknown, context: GeometryDepthGuardContext): value is object {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    unreadableGeometry(context);
  }
}

function readProperty(
  object: object,
  property: string,
  context: GeometryDepthGuardContext,
): unknown {
  try {
    return Reflect.get(object, property);
  } catch {
    unreadableGeometry(context);
  }
}

function pushArrayChildren(
  value: unknown,
  options: {
    childDepth: number;
    pending: GeometryDepthFrame[];
    context: GeometryDepthGuardContext;
  },
): void {
  const { childDepth, pending, context } = options;
  let children: unknown[] | undefined;
  try {
    if (Array.isArray(value)) {
      children = value;
    }
  } catch {
    unreadableGeometry(context);
  }
  if (!children) {
    invalidGeometry(context);
  }
  const length = readProperty(children, "length", context);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalidGeometry(context);
  }
  for (let childIndex = 0; childIndex < length; childIndex += 1) {
    pending.push({
      node: readProperty(children, String(childIndex), context),
      depth: childDepth,
    });
  }
}

/** Guard authored geometry before recursive validation or bridge serialization. */
export function assertGeometryTreeDepth(
  geometry: unknown,
  context: GeometryDepthGuardContext,
): asserts geometry is GeometryDoc {
  if (!isObject(geometry, context)) {
    invalidGeometry(context);
  }

  const pending: GeometryDepthFrame[] = [
    { node: readProperty(geometry, "root", context), depth: 0 },
  ];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) {
      break;
    }
    if (!isObject(frame.node, context)) {
      invalidGeometry(context);
    }

    const kind = readProperty(frame.node, "kind", context);
    if (kind !== "path" && kind !== "transform" && kind !== "group" && kind !== "boolean") {
      invalidGeometry(context);
    }
    if (frame.depth > MAX_GEOMETRY_TREE_DEPTH) {
      throw shapeDepthBoundaryFailure({
        operation: context.operation,
        actual: frame.depth,
        operand: context.operand,
        nodeId: context.nodeId,
      });
    }
    switch (kind) {
      case "path":
        break;
      case "transform":
        pending.push({
          node: readProperty(frame.node, "child", context),
          depth: frame.depth + 1,
        });
        break;
      case "group":
      case "boolean":
        pushArrayChildren(readProperty(frame.node, "children", context), {
          childDepth: frame.depth + 1,
          pending,
          context,
        });
        break;
    }
  }
}

/** Guard only the authored geometry contained by a symbol definition. */
export function assertSymbolDefinitionGeometryDepth(
  definition: unknown,
  context: GeometryDepthGuardContext,
): asserts definition is SymbolDefinition {
  if (!isObject(definition, context)) {
    invalidGeometry(context);
  }
  assertGeometryTreeDepth(readProperty(definition, "geometry", context), context);
}
