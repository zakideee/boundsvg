/**
 * Quadtree spatial index for O(log N) point queries on bounding boxes.
 *
 * - Max depth: 5
 * - Max items per node before split: 8
 * - Supports insert + point query
 */

type BBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** One positioned item with draw precedence and an optional entry-owned hit gate. */
type Entry<T> = {
  value: T;
  bbox: BBox;
  /** Draw order index (higher = more to front) */
  drawIndex: number;
  /** IR-owned clip/frame gate; ordinary inserted entries have no gate. */
  accepts?: (x: number, y: number) => boolean;
};

/** Existing quadtree subdivision limit. */
const MAX_DEPTH = 5;
/** Existing item threshold before a node subdivides. */
const MAX_ITEMS = 8;

/** One subdivision retaining items that cross its child boundaries. */
type QuadNode<T> = {
  readonly bounds: BBox;
  readonly depth: number;
  items: Entry<T>[];
  children: QuadNode<T>[] | null;
};

/** Allocate an empty subdivision at the requested depth. */
function createQuadNode<T>(bounds: BBox, depth: number): QuadNode<T> {
  return { bounds, depth, items: [], children: null };
}

/** Descend into a fully containing child, retaining crossing items at their current node. */
function insertIntoNode<T>(node: QuadNode<T>, entry: Entry<T>): void {
  if (node.children) {
    for (const child of node.children) {
      if (contains(child.bounds, entry.bbox)) {
        insertIntoNode(child, entry);
        return;
      }
    }
    node.items.push(entry);
    return;
  }

  node.items.push(entry);

  if (node.items.length > MAX_ITEMS && node.depth < MAX_DEPTH) {
    splitNode(node);
  }
}

/** Collect point-containing entries after applying each entry's own optional hit gate. */
function queryNode<T>(
  node: QuadNode<T>,
  point: { x: number; y: number },
  results: Entry<T>[],
): void {
  if (!pointInBBox(point.x, point.y, node.bounds)) {
    return;
  }

  for (const item of node.items) {
    if (
      pointInBBox(point.x, point.y, item.bbox) &&
      (!item.accepts || item.accepts(point.x, point.y))
    ) {
      results.push(item);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      queryNode(child, point, results);
    }
  }
}

/** Partition into four children and move only fully contained items into them. */
function splitNode<T>(node: QuadNode<T>): void {
  const { x, y, w, h } = node.bounds;
  const hw = w / 2;
  const hh = h / 2;
  const childDepth = node.depth + 1;

  node.children = [
    createQuadNode({ x, y, w: hw, h: hh }, childDepth),
    createQuadNode({ x: x + hw, y, w: hw, h: hh }, childDepth),
    createQuadNode({ x, y: y + hh, w: hw, h: hh }, childDepth),
    createQuadNode({ x: x + hw, y: y + hh, w: hw, h: hh }, childDepth),
  ];

  const remaining: Entry<T>[] = [];
  for (const item of node.items) {
    let placed = false;
    for (const child of node.children) {
      if (contains(child.bounds, item.bbox)) {
        insertIntoNode(child, item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      remaining.push(item);
    }
  }
  node.items = remaining;
}

/** Check if point (x,y) is inside bbox */
function pointInBBox(x: number, y: number, bbox: BBox): boolean {
  return x >= bbox.x && x <= bbox.x + bbox.w && y >= bbox.y && y <= bbox.y + bbox.h;
}

/** Check if inner bbox is fully contained within outer bbox */
function contains(outer: BBox, inner: BBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Generic positioned-box queries; IDs are opaque and never classified by suffix. */
export type SpatialIndex = {
  insert: (nodeId: string, bbox: BBox, drawIndex: number) => void;
  queryTopmost: (x: number, y: number) => string | null;
  queryCandidates: (x: number, y: number) => string[];
};

/** Shared quadtree query projection used by generic boxes and IR-owned candidates. */
export function buildFilteredSpatialIndex<T>(
  bounds: BBox,
  entries: Entry<T>[],
): {
  queryCandidates: (x: number, y: number) => T[];
} {
  const root = createQuadNode<T>(bounds, 0);
  for (const entry of entries) {
    insertIntoNode(root, entry);
  }
  return {
    queryCandidates(x, y) {
      const results: Entry<T>[] = [];
      queryNode(root, { x, y }, results);
      return results
        .sort((left, right) => right.drawIndex - left.drawIndex)
        .map((entry) => entry.value);
    },
  };
}

/** Create an insertable index for arbitrary caller-provided IDs and bounding boxes. */
export function createSpatialIndex(bounds: BBox): SpatialIndex {
  const root = createQuadNode<string>(bounds, 0);
  function queryCandidates(x: number, y: number): string[] {
    const results: Entry<string>[] = [];
    queryNode(root, { x, y }, results);
    return results
      .sort((left, right) => right.drawIndex - left.drawIndex)
      .map((entry) => entry.value);
  }
  return {
    insert(nodeId, bbox, drawIndex) {
      insertIntoNode(root, { value: nodeId, bbox, drawIndex });
    },
    queryTopmost(x, y) {
      return queryCandidates(x, y)[0] ?? null;
    },
    queryCandidates,
  };
}
