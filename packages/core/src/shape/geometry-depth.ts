import { FatalError } from "../errors.js";
import type { ElasticSegment, GeometryDoc, GeometryNode, SymbolDefinition } from "./types.js";

/** Geometry root is depth 0; recursive nodes through depth 48 are accepted. */
export const MAX_GEOMETRY_TREE_DEPTH = 48;

type GeometryDepthFrame = {
  node: GeometryNode;
  depth: number;
};

function throwGeometryDepthError(nodeId: string, actualDepth: number): never {
  throw new FatalError(
    "SHAPE_GEOMETRY_MAX_DEPTH",
    `Validation error: shape geometry exceeds max depth (${MAX_GEOMETRY_TREE_DEPTH})`,
    {
      stage: "validate",
      nodeId,
      context: {
        maxDepth: MAX_GEOMETRY_TREE_DEPTH,
        actualDepth,
      },
    },
  );
}

function pushGeometryChildren(frame: GeometryDepthFrame, pending: GeometryDepthFrame[]): void {
  switch (frame.node.kind) {
    case "path":
      break;
    case "transform":
      pending.push({ node: frame.node.child, depth: frame.depth + 1 });
      break;
    case "group":
    case "boolean":
      for (const child of frame.node.children) {
        pending.push({ node: child, depth: frame.depth + 1 });
      }
      break;
  }
}

/** Guard authored geometry before recursive validation or bridge serialization. */
export function assertGeometryTreeDepth(geometry: GeometryDoc, nodeId = "<geometry>"): void {
  const pending: GeometryDepthFrame[] = [{ node: geometry.root, depth: 0 }];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) {
      break;
    }
    if (frame.depth > MAX_GEOMETRY_TREE_DEPTH) {
      throwGeometryDepthError(nodeId, frame.depth);
    }
    pushGeometryChildren(frame, pending);
  }
}

function segmentAddsWrapper(
  segment: ElasticSegment,
  widthDelta: number,
  heightDelta: number,
): boolean {
  if (segment.role === "fixed-start") {
    return false;
  }
  const delta = segment.axis === "x" ? widthDelta : heightDelta;
  if (delta === 0) {
    return false;
  }
  if (segment.role === "fixed-end") {
    return true;
  }
  const frameSize = segment.axis === "x" ? segment.frame.width : segment.frame.height;
  if (frameSize <= 0) {
    return false;
  }
  return true;
}

/** Guard the concrete tree produced when elastic symbol segments add transforms. */
export function assertResolvedSymbolGeometryDepth(
  definition: SymbolDefinition,
  options: { width: number; height: number },
  nodeId = "<Symbol>",
): void {
  const targetWidth = options.width > 0 ? options.width : definition.geometry.viewBox.width;
  const targetHeight = options.height > 0 ? options.height : definition.geometry.viewBox.height;
  const widthDelta = targetWidth - definition.geometry.viewBox.width;
  const heightDelta = targetHeight - definition.geometry.viewBox.height;
  const wrapperCountsByNodeId = new Map<string, number>();
  for (const segment of definition.elasticSegments ?? []) {
    if (segmentAddsWrapper(segment, widthDelta, heightDelta)) {
      wrapperCountsByNodeId.set(
        segment.nodeId,
        (wrapperCountsByNodeId.get(segment.nodeId) ?? 0) + 1,
      );
    }
  }
  const pending: GeometryDepthFrame[] = [{ node: definition.geometry.root, depth: 0 }];

  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) {
      break;
    }
    const currentNodeId = frame.node.nodeId;
    const wrapperCount =
      currentNodeId === undefined ? 0 : (wrapperCountsByNodeId.get(currentNodeId) ?? 0);
    const resolvedDepth = frame.depth + wrapperCount;
    if (resolvedDepth > MAX_GEOMETRY_TREE_DEPTH) {
      throwGeometryDepthError(nodeId, resolvedDepth);
    }
    pushGeometryChildren({ node: frame.node, depth: resolvedDepth }, pending);
  }
}
