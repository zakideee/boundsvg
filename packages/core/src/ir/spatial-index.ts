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
type Entry = {
  nodeId: string;
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
type QuadNode = {
  readonly bounds: BBox;
  readonly depth: number;
  items: Entry[];
  children: QuadNode[] | null;
};

/** Allocate an empty subdivision at the requested depth. */
function createQuadNode(bounds: BBox, depth: number): QuadNode {
  return { bounds, depth, items: [], children: null };
}

/** Descend into a fully containing child, retaining crossing items at their current node. */
function insertIntoNode(node: QuadNode, entry: Entry): void {
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
function queryNode(node: QuadNode, point: { x: number; y: number }, results: Entry[]): void {
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
function splitNode(node: QuadNode): void {
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

  const remaining: Entry[] = [];
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

/** Generic positioned-box queries; returned ids follow draw precedence. */
export type SpatialIndex = {
  insert: (nodeId: string, bbox: BBox, drawIndex: number) => void;
  queryTopmost: (x: number, y: number) => string | null;
  queryCandidates: (x: number, y: number) => string[];
};

/**
 * Create a spatial index wrapping a Quadtree for fast point queries.
 */
export function createSpatialIndex(bounds: BBox): SpatialIndex {
  const root = createQuadNode(bounds, 0);
  return wrapSpatialIndex(root);
}

/** Wrap one tree; each entry retains its own optional IR gate when ids repeat. */
function wrapSpatialIndex(root: QuadNode): SpatialIndex {
  return {
    insert(nodeId: string, bbox: BBox, drawIndex: number): void {
      insertIntoNode(root, { nodeId, bbox, drawIndex });
    },

    queryTopmost(x: number, y: number): string | null {
      const results: Entry[] = [];
      queryNode(root, { x, y }, results);

      if (results.length === 0) {
        return null;
      }

      let best: Entry | null = null;
      for (const entry of results) {
        if (entry.nodeId.endsWith(":bg") || entry.nodeId.endsWith(":border")) {
          continue;
        }
        if (best === null || entry.drawIndex > best.drawIndex) {
          best = entry;
        }
      }

      return best?.nodeId ?? null;
    },

    queryCandidates(x: number, y: number): string[] {
      const results: Entry[] = [];
      queryNode(root, { x, y }, results);

      if (results.length === 0) {
        return [];
      }

      return results
        .filter((entry) => !entry.nodeId.endsWith(":bg") && !entry.nodeId.endsWith(":border"))
        .sort((a, b) => b.drawIndex - a.drawIndex)
        .map((entry) => entry.nodeId);
    },
  };
}

/**
 * Build the internal IR hit index with entry-owned shape gates. Public insert
 * remains generic: newly inserted entries never inherit an IR clip by id.
 * This helper is not exported from the package's public entry points.
 */
export function buildFilteredSpatialIndex(bounds: BBox, entries: Entry[]): SpatialIndex {
  const root = createQuadNode(bounds, 0);
  for (const entry of entries) {
    insertIntoNode(root, entry);
  }
  return wrapSpatialIndex(root);
}

/**
 * Build a spatial index from an IR's drawOrder and node bboxes.
 */
export function buildSpatialIndex(
  bounds: { width: number; height: number },
  drawOrder: string[],
  bboxMap: Map<string, BBox>,
): SpatialIndex {
  const { width, height } = bounds;
  const index = createSpatialIndex({ x: 0, y: 0, w: width, h: height });

  for (const [i, nodeId] of drawOrder.entries()) {
    const bbox = bboxMap.get(nodeId);
    if (bbox) {
      index.insert(nodeId, bbox, i);
    }
  }

  return index;
}
