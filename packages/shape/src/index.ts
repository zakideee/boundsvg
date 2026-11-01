/** Boolean composition applied to the child regions of a geometry node. */
export type BooleanOp = "union" | "subtract" | "intersect" | "xor";

/** Logical coordinate rectangle for a geometry document; omitted x/y default to zero. */
export type GeometryViewBox = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

/** Post-layout transform composed as translate, origin-relative rotate, skew X, skew Y, then scale. */
export type Transform2D = {
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  /** Rotation in degrees, before the shear channels. */
  rotateDeg?: number;
  /** Horizontal shear angle in the inclusive range -60..60 degrees. */
  skewXDeg?: number;
  /** Vertical shear angle in the inclusive range -60..60 degrees. */
  skewYDeg?: number;
  originX?: number;
  originY?: number;
};

/** Authored SVG path leaf with an optional part ID and fill rule. */
export type GeometryPathNode = {
  kind: "path";
  nodeId?: string;
  d: string;
  fillRule?: "nonzero" | "evenodd";
};

/** Ordered geometry children sharing a composition parent. */
export type GeometryGroupNode = {
  kind: "group";
  nodeId?: string;
  children: GeometryNode[];
};

/** An authored affine transform applied to one geometry subtree. */
export type GeometryTransformNode = {
  kind: "transform";
  nodeId?: string;
  transform: Transform2D;
  child: GeometryNode;
};

/** Boolean composition of child geometry regions, including transformed subtrees. */
export type GeometryBooleanNode = {
  kind: "boolean";
  nodeId?: string;
  op: BooleanOp;
  children: GeometryNode[];
};

/** Authored geometry tree supporting paths, groups, transforms, and boolean composition. */
export type GeometryNode =
  | GeometryPathNode
  | GeometryGroupNode
  | GeometryTransformNode
  | GeometryBooleanNode;

/** Geometry root together with the logical viewBox used for placement. */
export type GeometryDoc = {
  viewBox: GeometryViewBox;
  root: GeometryNode;
};

/** Fixed-leading, stretchable, or fixed-trailing behavior of a symbol segment. */
export type ElasticSegmentRole = "fixed-start" | "stretch" | "fixed-end";

/** Named geometry segment and its source frame used during elastic symbol resizing. */
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

/** Reusable geometry with optional elastic resize segments. */
export type SymbolDefinition = {
  geometry: GeometryDoc;
  elasticSegments?: ElasticSegment[];
};

/** Assemble a geometry document without parsing or copying the supplied tree. */
export function geometryDoc(viewBox: GeometryViewBox, root: GeometryNode): GeometryDoc {
  return { viewBox, root };
}

/** Create a path geometry leaf; path parsing occurs when the engine evaluates it. */
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

/** Group the supplied geometry children in their authored order without copying the array. */
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

/** Wrap a geometry subtree in authored affine channels; engine validation occurs at use. */
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

/** Create a boolean composition record; evaluation and child-count validation occur at use. */
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

/** Return a typed symbol definition without copying or resolving its geometry. */
export function symbolDefinition(definition: SymbolDefinition): SymbolDefinition {
  return definition;
}
