import { cloneAnimationSpecForIR, cloneIRForLayeredTransform } from "./ir/clone.js";
import type { IR, IRGroupNode, IRNode } from "./ir/types.js";
import type { BBox, LayoutNode } from "./layout/types.js";
import { LAYOUT_TRANSITION_WRAPPER_META } from "./layout-transition.js";
import { toCssSafeResourceId } from "./svg/resource-id.js";
import type { DebugOverlayConfig } from "./svg/types.js";
import {
  type AffineMatrix,
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  hasTransform,
  multiplyAffineMatrices,
} from "./transform.js";
import type { VNode } from "./vnode/types.js";

export type LayerMode = "independent" | "atomic";

export type LayerWarning =
  | { code: "CROSSES_COMPOSITING_ISLAND"; nodeId: string; islandRootNodeId: string }
  | { code: "PARENT_OPACITY_PREVENTED_SPLIT"; nodeId: string; parentNodeId: string }
  | { code: "CLIP_FORCED_ATOMIC"; nodeId: string }
  | { code: "BOX_SHADOW_FORCED_ATOMIC"; nodeId: string }
  | { code: "SVG_SUBTREE_FORCED_ATOMIC"; nodeId: string };

export type LayerManifestPart = {
  partId: string;
  /** Source Shape/Symbol (or embedded Svg) node this part belongs to. */
  nodeId: string;
  /** Baked part bounds in canvas coordinates (structural shape parts only). */
  bbox?: BBox;
};

export type LayerManifestEntry = {
  id: string;
  bbox: BBox;
  nodeIds: string[];
  /** meta of the layer's nodes, keyed by nodeId (only nodes that carry meta). */
  nodeMeta?: Record<string, Record<string, string>>;
  /**
   * Addressable shape parts painted by this layer, transcribed from
   * `data-boundsvg-part-id` attributes in embedded svg content
   * (present when a Shape/Symbol rendered with `emitPartIds`).
   */
  parts?: LayerManifestPart[];
  mode: LayerMode;
  paintOrder: number;
  collapsedFromLayers?: string[];
  warnings: LayerWarning[];
};

export type LayerEntry = LayerManifestEntry & {
  svg: string;
};

export type LayeredCompositionValidationOptions = {
  enabled?: boolean;
  maxDifferentPixels?: number;
  maxDifferenceRatio?: number;
};

export type LayeredCompositionValidationResult = {
  status: "passed" | "mismatched" | "skipped";
  differentPixels: number;
  differenceRatio: number;
  thresholdPixels: number;
  thresholdRatio: number;
  width: number;
  height: number;
};

export type LayeredSvgResult = {
  width: number;
  height: number;
  layers: LayerEntry[];
  compositionValidation?: LayeredCompositionValidationResult;
  manifest: {
    width: number;
    height: number;
    animated?: true;
    timeMs?: number;
    layers: LayerManifestEntry[];
  };
};

export type LayerPngManifestEntry = LayerManifestEntry;

export type LayerPngEntry = LayerPngManifestEntry & {
  png: Uint8Array;
};

export type LayeredPngResult = {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  layers: LayerPngEntry[];
  compositionValidation?: LayeredCompositionValidationResult;
  manifest: {
    width: number;
    height: number;
    pixelWidth: number;
    pixelHeight: number;
    animated?: true;
    timeMs?: number;
    layers: LayerPngManifestEntry[];
  };
};

type RenderLayeredSvgOptions = {
  debug?: boolean | DebugOverlayConfig;
  resourceIdPrefix?: string;
  nodeIdMetadata?: "include" | "omit";
  scale?: number;
  timeMs?: number;
  generator?: {
    name: string;
    version: string;
  };
};

type SourceNodeInfo = {
  nodeId: string;
  nodeType: VNode["type"];
  requestedLayerId: string;
};

type LayerSourceMetadata = ReadonlyMap<string, SourceNodeInfo>;

type LayerFragment = {
  id: string;
  mode: LayerMode;
  node: IRNode;
  bbox: BBox;
  nodeIds: Set<string>;
  paintOrder: number | undefined;
  collapsedFromLayers: Set<string>;
  warnings: LayerWarning[];
};

type LayerSegment = {
  id: string;
  mode: LayerMode;
  nodes: IRNode[];
  bbox: BBox;
  nodeIds: Set<string>;
  paintOrder: number | undefined;
  collapsedFromLayers: Set<string>;
  warnings: LayerWarning[];
};

/** Options forwarded to the per-layer SVG emitter. */
export type LayerEmitOptions = {
  scale?: number;
  debug?: boolean | DebugOverlayConfig;
  resourceIdPrefix?: string;
  nodeIdMetadata?: "include" | "omit";
  timeMs?: number;
  generator?: {
    name: string;
    version: string;
  };
};

type RenderLayeredSvgInput = {
  ir: IR;
  sourceNodeMap: LayerSourceMetadata;
  options?: RenderLayeredSvgOptions;
  /**
   * Per-layer SVG emitter. The layered composition (layer separation
   * rules, manifest, atomic grouping) always runs here in TS; the
   * layer-to-SVG translation is injected so the engine routes it through
   * the WASM emitter.
   */
  emitLayerSvg: (layerIr: IR, emitOptions: LayerEmitOptions) => string;
};

type TransformAncestor = {
  nodeId: string;
  bbox: IRNode["bbox"];
  transform?: NonNullable<IRGroupNode["transform"]>;
  animation?: NonNullable<IRGroupNode["animation"]>;
};

const DEFAULT_LAYER_ID = "default";
const BG_NODE_SUFFIX = ":bg";
const BORDER_NODE_SUFFIX = ":border";
const INLINE_DECORATION_PATTERN = /^(.*):ibox\d+$/u;
const INLINE_RECT_FRAGMENT_PATTERN = /^(.*):inline-rect:\d+(?::rect)?$/u;
const GENERATED_LAYOUT_TRANSITION_PROVENANCE = LAYOUT_TRANSITION_WRAPPER_META.generatedValue;
const GENERATED_PROVENANCE_KEY = LAYOUT_TRANSITION_WRAPPER_META.generatedKey;
const GENERATED_SOURCE_NODE_ID_KEY = LAYOUT_TRANSITION_WRAPPER_META.sourceNodeIdKey;

/**
 * Return a new array of layer-like entries sorted by `paintOrder` ascending
 * (back-to-front). When `paintOrder` ties, the original relative order is
 * preserved (stable sort via `Array.prototype.sort`).
 *
 * Use this when composing layers in DOM / HTML / CLI — the back layer paints
 * first, the front layer paints last, matching `<img>` z-order when stacked
 * absolutely.
 */
export function sortLayersByPaintOrder<T extends { paintOrder: number }>(
  layers: readonly T[],
): T[] {
  return [...layers].sort((left, right) => left.paintOrder - right.paintOrder);
}

/**
 * Format a stable on-disk file name for a layer:
 *   `NNN-<sanitized-id>.<extension>`
 *
 * `NNN` is `index` zero-padded to 3 digits. The layer id is sanitized to
 * `[A-Za-z0-9_-]`; any other character becomes `-`, runs of `-` are collapsed,
 * and an empty sanitized id falls back to `layer`.
 *
 * Shared between CLI output and documentation/examples so the convention stays
 * in one place.
 */
export function formatLayerFileName(
  index: number,
  layerId: string,
  extension: "svg" | "png",
): string {
  return `${String(index).padStart(3, "0")}-${sanitizeLayerFileId(layerId)}.${extension}`;
}

function sanitizeLayerFileId(layerId: string): string {
  const sanitized = layerId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-");
  return sanitized.length > 0 ? sanitized : "layer";
}

export function renderLayeredSvg(input: RenderLayeredSvgInput): LayeredSvgResult {
  const { ir, sourceNodeMap, options, emitLayerSvg } = input;
  const drawIndexMap = buildDrawIndexMap(ir.drawOrder);
  const fragments = collectLayerFragments({
    node: ir.root,
    sourceNodeMap,
    drawIndexMap,
  });
  const segments = mergeAdjacentFragments(fragments);

  const metaByNodeId: Record<string, Record<string, string>> = {};
  collectNodeMeta(ir.root, metaByNodeId);
  const partIdsByNodeId: Record<string, CollectedPart[]> = {};
  collectNodeParts(ir.root, partIdsByNodeId, createIdentityAffineMatrix());
  const normalizedResourceIdPrefix =
    options?.resourceIdPrefix === undefined
      ? undefined
      : toCssSafeResourceId(options.resourceIdPrefix);

  const layers = segments.map((segment, layerIndex) => {
    const manifestEntry = buildManifestEntry(segment, metaByNodeId, partIdsByNodeId);
    // A non-empty document prefix gets a stable, delimiter-terminated numeric
    // sub-prefix per layer. `layer-1-` is not a prefix of `layer-10-`, so the
    // generated identifier sets remain disjoint across layered SVGs.
    const layerResourceIdPrefix =
      normalizedResourceIdPrefix !== undefined && normalizedResourceIdPrefix.length > 0
        ? `${normalizedResourceIdPrefix}layer-${layerIndex}-`
        : normalizedResourceIdPrefix;
    const layerSvg = emitLayerSvg(
      {
        root: {
          type: "group",
          nodeId: ir.root.nodeId,
          bbox: { ...ir.root.bbox },
          children: segment.nodes.map(cloneIRForLayeredTransform),
        },
        drawOrder: ir.drawOrder,
        width: ir.width,
        height: ir.height,
        warnings: ir.warnings,
      },
      {
        debug: options?.debug ?? ir.debug,
        resourceIdPrefix: layerResourceIdPrefix,
        nodeIdMetadata: options?.nodeIdMetadata,
        scale: options?.scale,
        timeMs: options?.timeMs,
        generator: options?.generator,
      },
    );
    return {
      ...manifestEntry,
      svg: layerSvg,
    };
  });

  const animated = hasAnimatedNode(ir.root);
  return {
    width: ir.width,
    height: ir.height,
    layers,
    manifest: {
      width: ir.width,
      height: ir.height,
      ...(animated ? { animated: true as const, timeMs: options?.timeMs ?? 0 } : {}),
      layers: layers.map(({ svg: _svg, ...entry }) => entry),
    },
  };
}

/**
 * Copy the VNode-backed fields needed for layer assignment into value metadata.
 * Callers retain this snapshot across warning callbacks instead of retaining a
 * live VNode reference through the layer split.
 */
export function snapshotLayerSourceMetadata(root: LayoutNode): LayerSourceMetadata {
  const sourceNodeMap = new Map<string, SourceNodeInfo>();

  const visit = (node: LayoutNode, inheritedLayerId: string): void => {
    const requestedLayerId = normalizeLayerId(readLayerProp(node.vnode)) ?? inheritedLayerId;
    sourceNodeMap.set(node.nodeId, {
      nodeId: node.nodeId,
      nodeType: node.vnode.type,
      requestedLayerId,
    });

    for (const child of node.children) {
      visit(child, requestedLayerId);
    }
  };

  visit(root, DEFAULT_LAYER_ID);
  return sourceNodeMap;
}

function readLayerProp(vnode: VNode): string | undefined {
  switch (vnode.type) {
    case "Flex":
    case "Grid":
    case "Box":
    case "Text":
    case "TextOnPath":
    case "Image":
    case "Path":
    case "Svg":
    case "Shape":
    case "Symbol":
      return vnode.props.layer;
    default:
      return undefined;
  }
}

function normalizeLayerId(layerId: string | undefined): string | undefined {
  const trimmed = layerId?.trim();
  if (!trimmed || trimmed === DEFAULT_LAYER_ID) {
    return trimmed ? DEFAULT_LAYER_ID : undefined;
  }
  return trimmed;
}

function buildDrawIndexMap(drawOrder: readonly string[]): ReadonlyMap<string, number> {
  const drawIndexMap = new Map<string, number>();
  for (const [index, nodeId] of drawOrder.entries()) {
    drawIndexMap.set(nodeId, index);
  }
  return drawIndexMap;
}

type CollectLayerFragmentsOptions = {
  node: IRNode;
  sourceNodeMap: ReadonlyMap<string, SourceNodeInfo>;
  drawIndexMap: ReadonlyMap<string, number>;
  transformAncestors?: readonly TransformAncestor[];
};

function collectLayerFragments(options: CollectLayerFragmentsOptions): LayerFragment[] {
  const { node, sourceNodeMap, drawIndexMap, transformAncestors = [] } = options;
  const sourceNodeId = getSourceNodeId(node, sourceNodeMap);
  const sourceNode = sourceNodeMap.get(sourceNodeId);
  if (!sourceNode) {
    return [];
  }

  if (isAtomicNode(node, sourceNode)) {
    return [
      createAtomicFragment({
        node,
        sourceNode,
        sourceNodeMap,
        drawIndexMap,
        transformAncestors,
      }),
    ];
  }

  if (node.type === "group") {
    const fragments: LayerFragment[] = [];
    const nextTransformAncestors =
      (node.transform && hasTransform(node.transform)) || node.animation
        ? [
            ...transformAncestors,
            {
              nodeId: node.nodeId,
              bbox: { ...node.bbox },
              ...(node.transform ? { transform: { ...node.transform } } : {}),
              ...(node.animation ? { animation: node.animation } : {}),
            },
          ]
        : transformAncestors;
    for (const child of node.children ?? []) {
      fragments.push(
        ...collectLayerFragments({
          node: child,
          sourceNodeMap,
          drawIndexMap,
          transformAncestors: nextTransformAncestors,
        }),
      );
    }
    return fragments;
  }

  return [
    createIndependentFragment({
      node,
      sourceNode,
      drawIndexMap,
      transformAncestors,
    }),
  ];
}

function isAtomicNode(node: IRNode, sourceNode: SourceNodeInfo): boolean {
  if (
    sourceNode.nodeType === "Svg" ||
    sourceNode.nodeType === "Shape" ||
    sourceNode.nodeType === "Symbol"
  ) {
    return true;
  }

  return (
    node.type === "group" &&
    (node.opacity != null ||
      targetsOpacity(node) ||
      node.clipPath != null ||
      node.clipBorderRadius != null ||
      node.boxShadow != null)
  );
}

function targetsOpacity(node: IRGroupNode): boolean {
  return node.animation?.keyframes.some((keyframe) => keyframe.opacity !== undefined) ?? false;
}

function createAtomicFragment(options: {
  node: IRNode;
  sourceNode: SourceNodeInfo;
  sourceNodeMap: ReadonlyMap<string, SourceNodeInfo>;
  drawIndexMap: ReadonlyMap<string, number>;
  transformAncestors: readonly TransformAncestor[];
}): LayerFragment {
  const { node, sourceNode, sourceNodeMap, drawIndexMap, transformAncestors } = options;
  const sourceNodeIds = collectSourceNodeIds(node, sourceNodeMap);
  const requestedLayerIds = new Set<string>();
  for (const nodeId of sourceNodeIds) {
    const requestedLayerId = sourceNodeMap.get(nodeId)?.requestedLayerId ?? DEFAULT_LAYER_ID;
    requestedLayerIds.add(requestedLayerId);
  }

  const warnings: LayerWarning[] = [];
  if (sourceNode.nodeType === "Svg") {
    warnings.push({ code: "SVG_SUBTREE_FORCED_ATOMIC", nodeId: sourceNode.nodeId });
  }
  if (node.type === "group") {
    if (node.clipPath != null || node.clipBorderRadius != null) {
      warnings.push({ code: "CLIP_FORCED_ATOMIC", nodeId: sourceNode.nodeId });
    }
    if (node.boxShadow != null) {
      warnings.push({ code: "BOX_SHADOW_FORCED_ATOMIC", nodeId: sourceNode.nodeId });
    }
  }

  for (const nodeId of sourceNodeIds) {
    if (nodeId === sourceNode.nodeId) {
      continue;
    }
    const requestedLayerId = sourceNodeMap.get(nodeId)?.requestedLayerId ?? DEFAULT_LAYER_ID;
    if (requestedLayerId === sourceNode.requestedLayerId) {
      continue;
    }
    warnings.push({
      code: "CROSSES_COMPOSITING_ISLAND",
      nodeId,
      islandRootNodeId: sourceNode.nodeId,
    });
    if (node.type === "group" && (node.opacity != null || targetsOpacity(node))) {
      warnings.push({
        code: "PARENT_OPACITY_PREVENTED_SPLIT",
        nodeId,
        parentNodeId: sourceNode.nodeId,
      });
    }
  }

  const collapsedFromLayers = new Set(
    [...requestedLayerIds].filter((layerId) => layerId !== sourceNode.requestedLayerId),
  );

  return {
    id: sourceNode.requestedLayerId,
    mode: "atomic",
    node: wrapWithTransformAncestors(cloneIRForLayeredTransform(node), transformAncestors),
    bbox: toLayoutBBox(node.bbox),
    nodeIds: sourceNodeIds,
    paintOrder: findPaintOrder(node, drawIndexMap),
    collapsedFromLayers,
    warnings: dedupeWarnings(warnings),
  };
}

function createIndependentFragment(options: {
  node: IRNode;
  sourceNode: SourceNodeInfo;
  drawIndexMap: ReadonlyMap<string, number>;
  transformAncestors: readonly TransformAncestor[];
}): LayerFragment {
  const { node, sourceNode, drawIndexMap, transformAncestors } = options;
  return {
    id: sourceNode.requestedLayerId,
    mode: "independent",
    node: wrapWithTransformAncestors(cloneIRForLayeredTransform(node), transformAncestors),
    bbox: toLayoutBBox(node.bbox),
    nodeIds: new Set([sourceNode.nodeId]),
    paintOrder: findPaintOrder(node, drawIndexMap),
    collapsedFromLayers: new Set(),
    warnings: [],
  };
}

function collectSourceNodeIds(
  node: IRNode,
  sourceNodeMap: ReadonlyMap<string, SourceNodeInfo>,
): Set<string> {
  const sourceNodeIds = new Set<string>();
  const visit = (currentNode: IRNode): void => {
    sourceNodeIds.add(getSourceNodeId(currentNode, sourceNodeMap));
    for (const child of currentNode.type === "group" ? (currentNode.children ?? []) : []) {
      visit(child);
    }
  };
  visit(node);
  return sourceNodeIds;
}

function mergeAdjacentFragments(fragments: readonly LayerFragment[]): LayerSegment[] {
  const segments: LayerSegment[] = [];

  for (const fragment of fragments) {
    const lastSegment = segments.at(-1);
    if (!lastSegment || lastSegment.id !== fragment.id) {
      segments.push({
        id: fragment.id,
        mode: fragment.mode,
        nodes: [fragment.node],
        bbox: fragment.bbox,
        nodeIds: new Set(fragment.nodeIds),
        paintOrder: fragment.paintOrder,
        collapsedFromLayers: new Set(fragment.collapsedFromLayers),
        warnings: [...fragment.warnings],
      });
      continue;
    }

    lastSegment.mode =
      lastSegment.mode === "atomic" || fragment.mode === "atomic" ? "atomic" : "independent";
    lastSegment.nodes.push(fragment.node);
    lastSegment.bbox = unionLayoutBBox(lastSegment.bbox, fragment.bbox);
    lastSegment.paintOrder = minPaintOrder(lastSegment.paintOrder, fragment.paintOrder);
    for (const nodeId of fragment.nodeIds) {
      lastSegment.nodeIds.add(nodeId);
    }
    for (const layerId of fragment.collapsedFromLayers) {
      lastSegment.collapsedFromLayers.add(layerId);
    }
    lastSegment.warnings = dedupeWarnings([...lastSegment.warnings, ...fragment.warnings]);
  }

  return segments;
}

function collectNodeMeta(node: IRNode, accumulator: Record<string, Record<string, string>>): void {
  if (node.type === "group" && node.meta) {
    accumulator[node.nodeId] = node.meta;
  }
  for (const child of node.type === "group" ? (node.children ?? []) : []) {
    collectNodeMeta(child, accumulator);
  }
}

const PART_ID_ATTR_PATTERN = /data-boundsvg-part-id="([^"]*)"/g;

type CollectedPart = { partId: string; bbox?: BBox };

/** Axis-aligned bounds of a bbox after an affine transform (corner sweep). */
function transformBBoxToAabb(matrix: AffineMatrix, bbox: BBox): BBox {
  const corners = [
    applyAffineMatrixToPoint(matrix, { x: bbox.x, y: bbox.y }),
    applyAffineMatrixToPoint(matrix, { x: bbox.x + bbox.width, y: bbox.y }),
    applyAffineMatrixToPoint(matrix, { x: bbox.x, y: bbox.y + bbox.height }),
    applyAffineMatrixToPoint(matrix, { x: bbox.x + bbox.width, y: bbox.y + bbox.height }),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// Shape nodes carry structural parts; embedded Svg content is still scanned
// for part-id attributes so the manifest can never disagree with what the
// layer paints. Part bboxes are documented as canvas coordinates, so the
// node's own transform and every ancestor transform must be applied.
function collectNodeParts(
  node: IRNode,
  accumulator: Record<string, CollectedPart[]>,
  ancestorMatrix: AffineMatrix,
): void {
  const matrix = multiplyAffineMatrices(
    ancestorMatrix,
    createResolvedTransformMatrix(getIRNodeTransform(node), node.bbox),
  );
  if (node.type === "shape" && node.shapeParts) {
    const collected: CollectedPart[] = [];
    for (const part of node.shapeParts) {
      if (part.partId === undefined) {
        continue;
      }
      collected.push({
        partId: part.partId,
        ...(part.bounds
          ? {
              bbox: transformBBoxToAabb(matrix, {
                x: node.bbox.x + part.bounds.x,
                y: node.bbox.y + part.bounds.y,
                width: part.bounds.width,
                height: part.bounds.height,
              }),
            }
          : {}),
      });
    }
    if (collected.length > 0) {
      accumulator[node.nodeId] = collected;
    }
  } else if (node.type === "svg" && node.svgContent) {
    const collected = [...node.svgContent.matchAll(PART_ID_ATTR_PATTERN)].map((match) => ({
      partId: unescapeXmlAttribute(match[1] ?? ""),
    }));
    if (collected.length > 0) {
      accumulator[node.nodeId] = collected;
    }
  }
  for (const child of node.type === "group" ? (node.children ?? []) : []) {
    collectNodeParts(child, accumulator, matrix);
  }
}

function getIRNodeTransform(node: IRNode): IRGroupNode["transform"] {
  return node.type === "group" ? node.transform : undefined;
}

// Inverse of escapeXml for attribute values; `&amp;` must be decoded last.
function unescapeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function buildManifestEntry(
  segment: LayerSegment,
  metaByNodeId: Record<string, Record<string, string>>,
  partIdsByNodeId: Record<string, CollectedPart[]>,
): LayerManifestEntry {
  const collapsedFromLayers =
    segment.collapsedFromLayers.size > 0
      ? [...segment.collapsedFromLayers].sort((left, right) => left.localeCompare(right))
      : undefined;

  // Per-layer SVGs flatten ancestor groups away, so meta is transcribed from
  // the source IR for every nodeId assigned to this layer.
  const nodeMeta: Record<string, Record<string, string>> = {};
  for (const nodeId of segment.nodeIds) {
    const meta = metaByNodeId[nodeId];
    if (meta) {
      nodeMeta[nodeId] = meta;
    }
  }

  const sortedNodeIds = [...segment.nodeIds].sort((left, right) => left.localeCompare(right));

  // Deterministic order: by nodeId (matching nodeIds), then document order
  // of the part paths within each node's svg content.
  const parts: LayerManifestPart[] = [];
  for (const nodeId of sortedNodeIds) {
    for (const part of partIdsByNodeId[nodeId] ?? []) {
      parts.push({ partId: part.partId, nodeId, ...(part.bbox ? { bbox: part.bbox } : {}) });
    }
  }

  return {
    id: segment.id,
    bbox: segment.bbox,
    nodeIds: sortedNodeIds,
    ...(Object.keys(nodeMeta).length > 0 ? { nodeMeta } : {}),
    ...(parts.length > 0 ? { parts } : {}),
    mode: segment.mode,
    paintOrder: segment.paintOrder ?? 0,
    collapsedFromLayers,
    warnings: dedupeWarnings(segment.warnings),
  };
}

function findPaintOrder(
  node: IRNode,
  drawIndexMap: ReadonlyMap<string, number>,
): number | undefined {
  let paintOrder: number | undefined;

  const visit = (currentNode: IRNode): void => {
    const drawIndex = drawIndexMap.get(currentNode.nodeId);
    if (drawIndex != null) {
      paintOrder = paintOrder === undefined ? drawIndex : Math.min(paintOrder, drawIndex);
    }
    for (const child of currentNode.type === "group" ? (currentNode.children ?? []) : []) {
      visit(child);
    }
  };

  visit(node);
  return paintOrder;
}

function minPaintOrder(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.min(left, right);
}

function getSourceNodeId(node: IRNode, sourceNodeMap: ReadonlyMap<string, SourceNodeInfo>): string {
  // Authored nodes always win by exact source-map membership. This keeps
  // user-authored meta from impersonating generated provenance; only an IR
  // node absent from the source layout may project through the marker below.
  if (sourceNodeMap.has(node.nodeId)) {
    return node.nodeId;
  }
  if (
    node.type === "group" &&
    node.meta?.[GENERATED_PROVENANCE_KEY] === GENERATED_LAYOUT_TRANSITION_PROVENANCE
  ) {
    const sourceNodeId = node.meta[GENERATED_SOURCE_NODE_ID_KEY];
    if (sourceNodeId !== undefined && sourceNodeMap.has(sourceNodeId)) {
      return sourceNodeId;
    }
  }
  const nodeId = node.nodeId;
  if (nodeId.endsWith(BG_NODE_SUFFIX)) {
    return nodeId.slice(0, -BG_NODE_SUFFIX.length);
  }
  if (nodeId.endsWith(BORDER_NODE_SUFFIX)) {
    return nodeId.slice(0, -BORDER_NODE_SUFFIX.length);
  }
  const inlineRectMatch = INLINE_RECT_FRAGMENT_PATTERN.exec(nodeId);
  if (inlineRectMatch?.[1]) {
    return inlineRectMatch[1];
  }
  const inlineDecorationMatch = INLINE_DECORATION_PATTERN.exec(nodeId);
  if (inlineDecorationMatch?.[1]) {
    return inlineDecorationMatch[1];
  }
  return nodeId;
}

function toLayoutBBox(bbox: IRNode["bbox"]): BBox {
  return {
    x: bbox.x,
    y: bbox.y,
    width: bbox.w,
    height: bbox.h,
  };
}

function unionLayoutBBox(left: BBox, right: BBox): BBox {
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function dedupeWarnings(warnings: readonly LayerWarning[]): LayerWarning[] {
  const seen = new Set<string>();
  const deduped: LayerWarning[] = [];

  for (const warning of warnings) {
    const key = JSON.stringify(warning);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(warning);
  }

  return deduped;
}

function wrapWithTransformAncestors(
  node: IRNode,
  transformAncestors: readonly TransformAncestor[],
): IRNode {
  let wrappedNode = node;
  for (let index = transformAncestors.length - 1; index >= 0; index -= 1) {
    const ancestor = transformAncestors[index];
    if (!ancestor) {
      continue;
    }
    wrappedNode = {
      type: "group",
      nodeId: ancestor.nodeId,
      bbox: { ...ancestor.bbox },
      ...(ancestor.transform ? { transform: { ...ancestor.transform } } : {}),
      ...(ancestor.animation ? { animation: cloneAnimationSpecForIR(ancestor.animation) } : {}),
      children: [wrappedNode],
    };
  }
  return wrappedNode;
}

export function hasAnimatedNode(node: IRNode): boolean {
  if (node.type === "text") {
    return node.unitAnimation !== undefined;
  }
  if (node.type !== "group") {
    return false;
  }
  if (node.animation) {
    return true;
  }
  return (node.children ?? []).some(hasAnimatedNode);
}
