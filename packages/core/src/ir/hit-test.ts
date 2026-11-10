import {
  type AffineMatrix,
  applyInverseAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
} from "../transform.js";
import {
  bboxHitBounds,
  evaluateHitClips,
  type HitBounds,
  type HitClip,
  intersectHitBounds,
  isPointInViewport,
  pathWorldHitBounds,
  pointInHitBBox,
  queryFrameContainment,
  worldHitBounds,
} from "./hit-geometry.js";
import {
  buildIRSourceIndex,
  type IRSourceIndex,
  type IRSourceRef,
  isSemanticFrame,
} from "./source-index.js";
import { buildFilteredSpatialIndex } from "./spatial-index.js";
import type { BBox, IR, IRNode } from "./types.js";

/** One source candidate with its physical geometry and tree-derived query rank. */
export type IRHitCandidate = Readonly<{
  source: IRSourceRef;
  geometryNodeIndex: number;
  order: number;
}>;

/** Prepared snapshot queries sharing the same source, canvas and clip gates. */
export type IRHitIndex = {
  sourceIndex: IRSourceIndex;
  queryTopmost: (x: number, y: number) => IRSourceRef | null;
  queryCandidates: (x: number, y: number) => IRHitCandidate[];
};

type HitEntry = {
  value: IRHitCandidate;
  bbox: BBox;
  drawIndex: number;
  accepts: (x: number, y: number) => boolean;
};
type HitContext = { matrix: AffineMatrix; clip: HitClip | null; visible: HitBounds | null };

function resolveNodeHitGeometry(
  node: IRNode,
  parent: HitContext | undefined,
  {
    policy,
    canvas,
    isFrame,
  }: { policy: "interaction" | "inspection"; canvas: BBox; isFrame: boolean },
) {
  const matrix = multiplyAffineMatrices(
    parent?.matrix ?? createIdentityAffineMatrix(),
    createResolvedTransformMatrix(node.type === "group" ? node.transform : undefined, node.bbox),
  );
  let clip = parent?.clip ?? null;
  let visible = parent ? parent.visible : bboxHitBounds(canvas);
  if (node.type === "group" && node.clip) {
    clip = { parent: clip, pose: { matrix, linearWitnesses: [] }, geometry: node.clip };
    visible =
      visible && node.clip.kind === "boxContour"
        ? intersectHitBounds(visible, worldHitBounds(matrix, bboxHitBounds(node.clip.bbox)))
        : null;
  }

  const local =
    node.type === "path"
      ? null
      : policy === "inspection"
        ? bboxHitBounds(node.bbox)
        : localHitBounds(node);
  const world =
    node.type === "path" && policy === "interaction"
      ? pathWorldHitBounds(node, matrix)
      : worldHitBounds(matrix, local ?? bboxHitBounds(node.bbox));
  const bounds = visible && world ? intersectHitBounds(visible, world) : null;
  return {
    context: { matrix, clip, visible },
    geometry: {
      bbox:
        bounds && bounds.minX < bounds.maxX && bounds.minY < bounds.maxY
          ? {
              x: bounds.minX,
              y: bounds.minY,
              w: bounds.maxX - bounds.minX,
              h: bounds.maxY - bounds.minY,
            }
          : null,
      accepts(x: number, y: number) {
        const point = { x, y };
        if (isFrame) {
          const contained = queryFrameContainment(
            node.bbox,
            { matrix, linearWitnesses: [] },
            clip,
            point,
          );
          return contained.status === "ready" && contained.contains;
        }
        const localPoint = applyInverseAffineMatrixToPoint(matrix, point);
        // Snapshot selection retains its conservative miss policy for failed projections.
        if (
          localPoint.status !== "ready" ||
          (node.type === "group" && !pointInHitBBox(localPoint.point, node.bbox))
        ) {
          return false;
        }
        const clipped = evaluateHitClips(clip, point);
        return clipped.status === "ready" && clipped.contains;
      },
    },
  };
}

/** Find the topmost source in an IR snapshot, including conservative Path bounds.
 * @throws {FatalError} VALIDATION for invalid ownership or Path output geometry.
 */
export function hitTest(ir: IR, x: number, y: number): IRSourceRef | null {
  return buildHitTestIndex(ir).queryTopmost(x, y);
}

/** Prepare interaction queries once per IR snapshot.
 * @throws {FatalError} VALIDATION for invalid ownership or Path output geometry.
 */
export function buildHitTestIndex(ir: IR): IRHitIndex {
  return prepareHitIndex(ir, "interaction");
}

/** Prepare the shared geometry with an interaction or inspection selection policy.
 * @throws {FatalError} VALIDATION for invalid ownership or Path output geometry.
 */
export function prepareHitIndex(ir: IR, policy: "interaction" | "inspection"): IRHitIndex {
  const sourceIndex = buildIRSourceIndex(ir);
  const frameNodes = new Set<number>();
  if (policy === "interaction") {
    for (const source of sourceIndex.sources.values()) {
      if (isSemanticFrame(source)) {
        frameNodes.add(source.source.sourceIndex);
      }
    }
  }
  const canvas = { x: 0, y: 0, w: ir.width, h: ir.height };
  const contexts = new Map<number, HitContext>();
  const geometry = new Map<
    number,
    { bbox: BBox | null; accepts: (x: number, y: number) => boolean }
  >();
  for (const occurrence of sourceIndex.nodes.values()) {
    const parent =
      occurrence.parentNodeIndex === null ? undefined : contexts.get(occurrence.parentNodeIndex);
    const resolved = resolveNodeHitGeometry(occurrence.node, parent, {
      policy,
      canvas,
      isFrame: frameNodes.has(occurrence.nodeIndex),
    });
    contexts.set(occurrence.nodeIndex, resolved.context);
    geometry.set(occurrence.nodeIndex, resolved.geometry);
  }
  const entries: HitEntry[] = [];
  for (const source of sourceIndex.sources.values()) {
    if (
      source.primaryNodeIndex === null &&
      policy === "interaction" &&
      !frameNodes.has(source.source.sourceIndex)
    ) {
      continue;
    }
    const geometryNodeIndex = source.primaryNodeIndex ?? source.source.sourceIndex;
    const occurrence = sourceIndex.nodes.get(geometryNodeIndex);
    const sourceOccurrence = sourceIndex.nodes.get(source.source.sourceIndex);
    const resolved = geometry.get(geometryNodeIndex);
    if (!occurrence || !sourceOccurrence || !resolved) {
      continue;
    }
    const candidate = {
      source: source.source,
      geometryNodeIndex,
      order:
        source.primaryNodeIndex === null && policy === "interaction"
          ? sourceOccurrence.leaveOrder
          : occurrence.enterOrder,
    };
    if (resolved.bbox) {
      entries.push({
        value: candidate,
        bbox: resolved.bbox,
        drawIndex: candidate.order,
        accepts: resolved.accepts,
      });
    }
  }
  const spatial = buildFilteredSpatialIndex(canvas, entries);
  const queryCandidates = (x: number, y: number): IRHitCandidate[] =>
    isPointInViewport(ir, { x, y }) ? spatial.queryCandidates(x, y) : [];
  return {
    sourceIndex,
    queryTopmost(x, y) {
      return queryCandidates(x, y)[0]?.source ?? null;
    },
    queryCandidates,
  };
}

/** Union text-unit samples without changing their layout/inspection frames. */
function localHitBounds(node: IRNode): HitBounds | null {
  if (node.type !== "text" || !node.unitAnimation || !node.unitAnimationSamples) {
    return bboxHitBounds(node.bbox);
  }
  let sampled: HitBounds | null = null;
  for (const sample of node.unitAnimationSamples) {
    if (!sample.bbox) {
      continue;
    }
    const bounds = worldHitBounds(
      createResolvedTransformMatrix(sample.transform, sample.bbox),
      bboxHitBounds(sample.bbox),
    );
    sampled = sampled
      ? {
          minX: Math.min(sampled.minX, bounds.minX),
          minY: Math.min(sampled.minY, bounds.minY),
          maxX: Math.max(sampled.maxX, bounds.maxX),
          maxY: Math.max(sampled.maxY, bounds.maxY),
        }
      : bounds;
  }
  return sampled;
}
