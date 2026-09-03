// Geometry input/authoring types are defined once in @boundsvg/shape (the TS
// mirror of the boundshape kernel). Core re-exports them so its public surface
// is unchanged.
export type {
  BooleanOp,
  ElasticSegment,
  GeometryDoc,
  GeometryNode,
  GeometryViewBox,
  SymbolDefinition,
  Transform2D,
} from "@boundsvg/shape";

// Kernel OUTPUT types (results of WASM evaluation) intentionally live here in
// core, next to the wasm bridge that produces them - @boundsvg/shape stays a
// pure authoring package with no knowledge of evaluation results.
export type CurvePoint = {
  x: number;
  y: number;
};

export type CurveSegment =
  | {
      kind: "line";
      p0: CurvePoint;
      p1: CurvePoint;
    }
  | {
      kind: "quad";
      p0: CurvePoint;
      p1: CurvePoint;
      p2: CurvePoint;
    }
  | {
      kind: "cubic";
      p0: CurvePoint;
      p1: CurvePoint;
      p2: CurvePoint;
      p3: CurvePoint;
    };

export type Contour = {
  segments: CurveSegment[];
  /** False only for authored stroke geometry; evaluated fill regions omit it. */
  closed?: boolean;
};

export type Region = {
  contours: Contour[];
};

export type GeometryIntersection = {
  point: CurvePoint;
  tA: number;
  tB: number;
  contourIndexA: number;
  segmentIndexA: number;
  contourIndexB: number;
  segmentIndexB: number;
};

/** Hit-test tuning, in geometry (viewBox) units. */
export type GeometryHitTestOptions = {
  /** Stroke band width; within `strokeWidth / 2 + tolerance` of a boundary reports a stroke hit. */
  strokeWidth?: number;
  /** Extra slop added to the stroke band. */
  tolerance?: number;
  /** Default fill rule for geometry paths that do not declare one. */
  fillRule?: "nonzero" | "evenodd";
};

/** One hit part, in document (paint) order - the topmost hit is last. */
export type GeometryPartHit = {
  partId: string;
  hit: "fill" | "stroke";
};

/**
 * One viewport-baked part from `compile_shape_paths`: path data in node-local
 * coordinates (origin 0,0 = the shape box), plus baked bounds.
 * `partId` is absent when the document compiled as a single fused region.
 */
export type CompiledShapePathPart = {
  partId?: string;
  d: string;
  /**
   * Path a stroke should follow, when it differs from `d`.
   *
   * Fill normalization drops zero-area contours and retraces
   * self-intersections, so `d` alone cannot stroke a line or a crossing
   * outline. Absent means `d` already is the stroke path.
   */
  strokeD?: string;
  bounds?: GeometryPartBounds;
};

export type GeometryPartBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** One addressable part of an evaluated geometry document (see evaluateGeometryParts). */
export type GeometryPart = {
  partId: string;
  region: Region;
  strokeRegion: Region;
  bounds?: GeometryPartBounds;
};

export type DivideRegions = {
  subtract: Region;
  intersect: Region;
};
