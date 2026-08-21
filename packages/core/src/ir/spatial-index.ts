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

type Entry = {
  nodeId: string;
  bbox: BBox;
  /** Draw order index (higher = more to front) */
  drawIndex: number;
};

const MAX_DEPTH = 5;
const MAX_ITEMS = 8;

type QuadNode = {
  readonly bounds: BBox;
  readonly depth: number;
  items: Entry[];
  children: QuadNode[] | null;
};

function createQuadNode(bounds: BBox, depth: number): QuadNode {
  return { bounds, depth, items: [], children: null };
}

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

function queryNode(node: QuadNode, point: { x: number; y: number }, results: Entry[]): void {
  if (!pointInBBox(point.x, point.y, node.bounds)) {
    return;
  }

  for (const item of node.items) {
    if (pointInBBox(point.x, point.y, item.bbox)) {
      results.push(item);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      queryNode(child, point, results);
    }
  }
}

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
