export type BooleanOp = "union" | "subtract" | "intersect" | "xor";

export type GeometryViewBox = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type Transform2D = {
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotateDeg?: number;
  originX?: number;
  originY?: number;
};

export type GeometryPathNode = {
  kind: "path";
  nodeId?: string;
  d: string;
  fillRule?: "nonzero" | "evenodd";
};

export type GeometryGroupNode = {
  kind: "group";
  nodeId?: string;
  children: GeometryNode[];
};

export type GeometryTransformNode = {
  kind: "transform";
  nodeId?: string;
  transform: Transform2D;
  child: GeometryNode;
};

export type GeometryBooleanNode = {
  kind: "boolean";
  nodeId?: string;
  op: BooleanOp;
  children: GeometryNode[];
};

export type GeometryNode =
  | GeometryPathNode
  | GeometryGroupNode
  | GeometryTransformNode
  | GeometryBooleanNode;

export type GeometryDoc = {
  viewBox: GeometryViewBox;
  root: GeometryNode;
};

export type ElasticSegmentRole = "fixed-start" | "stretch" | "fixed-end";

export type ElasticSegment = {
  nodeId: string;
  axis: "x" | "y";
  role: ElasticSegmentRole;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type SymbolDefinition = {
  geometry: GeometryDoc;
  elasticSegments?: ElasticSegment[];
};

export function geometryDoc(viewBox: GeometryViewBox, root: GeometryNode): GeometryDoc {
  return { viewBox, root };
}

export function pathGeometry(
  pathData: string,
  options?: {
    nodeId?: string;
    fillRule?: "nonzero" | "evenodd";
  },
): GeometryPathNode {
  return {
    kind: "path",
    d: pathData,
    ...(options?.nodeId === undefined ? {} : { nodeId: options.nodeId }),
    ...(options?.fillRule === undefined ? {} : { fillRule: options.fillRule }),
  };
}

export function groupGeometry(
  children: GeometryNode[],
  options?: { nodeId?: string },
): GeometryGroupNode {
  return {
    kind: "group",
    children,
    ...(options?.nodeId === undefined ? {} : { nodeId: options.nodeId }),
  };
}

export function transformGeometry(
  transform: Transform2D,
  child: GeometryNode,
  options?: { nodeId?: string },
): GeometryTransformNode {
  return {
    kind: "transform",
    transform,
    child,
    ...(options?.nodeId === undefined ? {} : { nodeId: options.nodeId }),
  };
}

export function booleanGeometry(
  operation: BooleanOp,
  children: GeometryNode[],
  options?: { nodeId?: string },
): GeometryBooleanNode {
  return {
    kind: "boolean",
    op: operation,
    children,
    ...(options?.nodeId === undefined ? {} : { nodeId: options.nodeId }),
  };
}

export function symbolDefinition(definition: SymbolDefinition): SymbolDefinition {
  return definition;
}
