import { FatalError } from "./errors.js";
import { cloneIRForLayeredTransform } from "./ir/clone.js";
import {
  buildIRSourceIndex,
  type IRNodeOccurrence,
  type IRSourceIndex,
  type IRSourceRef,
} from "./ir/source-index.js";
import type { IR, IRGroupNode, IRNode } from "./ir/types.js";
import {
  DEFAULT_LAYER_ID,
  type LayerSourceMetadata,
  type SourceNodeInfo,
} from "./layer-source-metadata.js";
import type { BBox } from "./layout/types.js";
import { toCssSafeResourceId } from "./svg/resource-id.js";
import type { DebugOverlayConfig } from "./svg/types.js";
import {
  type AffineMatrix,
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
} from "./transform.js";

/** Whether a layer can split independently or must preserve one compositing subtree. */
export type LayerMode = "independent" | "atomic";

/** Reason that compositing or clipping prevented the requested layer separation. */
export type LayerWarning =
  | { code: "CROSSES_COMPOSITING_ISLAND"; nodeId: string; islandRootNodeId: string }
  | { code: "PARENT_OPACITY_PREVENTED_SPLIT"; nodeId: string; parentNodeId: string }
  | { code: "CLIP_FORCED_ATOMIC"; nodeId: string }
  | { code: "BOX_SHADOW_FORCED_ATOMIC"; nodeId: string }
  | { code: "SVG_SUBTREE_FORCED_ATOMIC"; nodeId: string };

/** An addressable shape part and its source node, with canvas-space bounds when available. */
export type LayerManifestPart = {
  partId: string;
  /** Source Shape/Symbol (or embedded Svg) node this part belongs to. */
  source: IRSourceRef;
  /** Baked part bounds in canvas coordinates (structural shape parts only). */
  bbox?: BBox;
};

/** One composited layer, its sources, layout-space bounds, paint order and separation warnings. */
export type LayerManifestEntry = {
  id: string;
  bbox: BBox;
  /** Original source occurrence and its index in this layer's extracted tree. */
  sources: { source: IRSourceRef; layerSourceIndex: number; meta?: Record<string, string> }[];
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

/** A layer manifest entry together with its self-contained SVG document. */
export type LayerEntry = LayerManifestEntry & {
  svg: string;
};

/** Optional pixel-comparison limits for validating the recomposed layers. */
export type LayeredCompositionValidationOptions = {
  enabled?: boolean;
  maxDifferentPixels?: number;
  maxDifferenceRatio?: number;
};

/** Outcome and measured differences from comparing recomposed layers with the full render. */
export type LayeredCompositionValidationResult = {
  status: "passed" | "mismatched" | "skipped";
  differentPixels: number;
  differenceRatio: number;
  thresholdPixels: number;
  thresholdRatio: number;
  width: number;
  height: number;
};

/** Canvas dimensions, SVG layers, and the manifest needed to recompose them in paint order. */
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

/** Source and compositing metadata for one rasterized layer. */
export type LayerPngManifestEntry = LayerManifestEntry;

/** A raster layer with its manifest metadata and owned PNG byte buffer. */
export type LayerPngEntry = LayerPngManifestEntry & {
  png: Uint8Array;
};

/** Raster layers and logical/pixel canvas dimensions used to recompose their output. */
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

type LayerSegment = {
  id: string;
  mode: LayerMode;
  selected: Set<number>;
  bbox: BBox;
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

/** Separate an IR into compositing-safe layers and emit each through the supplied SVG emitter.
 * @throws {FatalError} VALIDATION for malformed source ownership or an invalid ancestor closure.
 */
export function renderLayeredSvg(input: RenderLayeredSvgInput): LayeredSvgResult {
  const { ir, sourceNodeMap, options, emitLayerSvg } = input;
  const sourceIndex = buildIRSourceIndex(ir);
  const partsBySource = new Map<number, CollectedPart[]>();
  collectNodeParts(sourceIndex, partsBySource);
  const fragments = collectLayerFragments(sourceIndex, sourceNodeMap);
  const segments: LayerSegment[] = [];
  for (const fragment of fragments) {
    const previous = segments.at(-1);
    if (!previous || previous.id !== fragment.id) {
      segments.push(fragment);
      continue;
    }
    previous.mode =
      previous.mode === "atomic" || fragment.mode === "atomic" ? "atomic" : "independent";
    for (const selected of fragment.selected) {
      previous.selected.add(selected);
    }
    for (const collapsed of fragment.collapsedFromLayers) {
      previous.collapsedFromLayers.add(collapsed);
    }
    previous.bbox = unionLayoutBBox(previous.bbox, fragment.bbox);
    previous.paintOrder =
      previous.paintOrder === undefined
        ? fragment.paintOrder
        : fragment.paintOrder === undefined
          ? previous.paintOrder
          : Math.min(previous.paintOrder, fragment.paintOrder);
    previous.warnings = dedupeWarnings([...previous.warnings, ...fragment.warnings]);
  }
  const prefix =
    options?.resourceIdPrefix === undefined
      ? undefined
      : toCssSafeResourceId(options.resourceIdPrefix);
  const layers = segments.map((segment, layerIndex) => {
    const { root, contributing, originalSourceByClone } = buildLayerTree(segment, sourceIndex);
    const layerIr = { ...ir, root };
    const layerIndexProjection = buildIRSourceIndex(layerIr);
    const { sources, parts } = collectLayerSources(layerIndexProjection, sourceIndex, {
      originalSourceByClone,
      contributing,
      partsBySource,
    });
    const svg = emitLayerSvg(layerIr, {
      debug: options?.debug ?? ir.debug,
      resourceIdPrefix: prefix ? `${prefix}layer-${layerIndex}-` : prefix,
      nodeIdMetadata: options?.nodeIdMetadata,
      scale: options?.scale,
      timeMs: options?.timeMs,
      generator: options?.generator,
    });
    return {
      id: segment.id,
      bbox: segment.bbox,
      sources,
      ...(parts.length ? { parts } : {}),
      mode: segment.mode,
      paintOrder: segment.paintOrder ?? 0,
      ...(segment.collapsedFromLayers.size
        ? { collapsedFromLayers: [...segment.collapsedFromLayers].sort() }
        : {}),
      warnings: segment.warnings,
      svg,
    };
  });
  return {
    width: ir.width,
    height: ir.height,
    layers,
    manifest: {
      width: ir.width,
      height: ir.height,
      ...(hasAnimatedNode(ir.root)
        ? { animated: true as const, timeMs: options?.timeMs ?? 0 }
        : {}),
      layers: layers.map(({ svg: _svg, ...entry }) => entry),
    },
  };
}

function collectLayerFragments(
  sourceIndex: IRSourceIndex,
  sourceNodeMap: RenderLayeredSvgInput["sourceNodeMap"],
): LayerSegment[] {
  const fragments: LayerSegment[] = [];
  const infoFor = (occurrence: IRNodeOccurrence): SourceNodeInfo =>
    sourceNodeMap.get(occurrence.source.nodeId) ?? {
      nodeId: occurrence.source.nodeId,
      nodeType: "Box",
      requestedLayerId: DEFAULT_LAYER_ID,
    };

  let skippedSubtreeEnd: number | null = null;
  for (const occurrence of sourceIndex.nodes.values()) {
    if (skippedSubtreeEnd !== null && occurrence.enterOrder < skippedSubtreeEnd) {
      continue;
    }
    const node = occurrence.node;
    const sourceInfo = infoFor(occurrence);
    const isAtomic = isAtomicLayerNode(node);
    if (node.type === "group" && !isAtomic) {
      continue;
    }
    skippedSubtreeEnd = occurrence.leaveOrder;
    const { selected, collapsedFromLayers, warnings, paintOrder } = collectFragment(
      occurrence,
      sourceIndex,
      infoFor,
    );
    fragments.push({
      id: sourceInfo.requestedLayerId,
      mode: isAtomic ? "atomic" : "independent",
      selected,
      bbox: toLayoutBBox(node.bbox),
      paintOrder,
      collapsedFromLayers,
      warnings: dedupeWarnings(warnings),
    });
  }
  return fragments;
}

function isAtomicLayerNode(node: IRNode): boolean {
  return (
    node.type === "svg" ||
    node.type === "shape" ||
    (node.type === "group" &&
      (node.opacity !== undefined ||
        targetsOpacity(node) ||
        node.clip !== undefined ||
        node.boxShadow !== undefined))
  );
}
function appendIslandWarnings(node: IRNode, nodeId: string, warnings: LayerWarning[]): void {
  if (node.type === "svg") {
    warnings.push({ code: "SVG_SUBTREE_FORCED_ATOMIC", nodeId: nodeId });
  }
  if (node.type === "group" && node.clip) {
    warnings.push({ code: "CLIP_FORCED_ATOMIC", nodeId: nodeId });
  }
  if (node.type === "group" && node.boxShadow) {
    warnings.push({ code: "BOX_SHADOW_FORCED_ATOMIC", nodeId: nodeId });
  }
}

function collectFragment(
  occurrence: IRNodeOccurrence,
  sourceIndex: IRSourceIndex,
  sourceInfoFor: (occurrence: IRNodeOccurrence) => SourceNodeInfo,
) {
  const node = occurrence.node;
  const islandInfo = sourceInfoFor(occurrence);
  const isOpacityIsland =
    node.type === "group" && (node.opacity !== undefined || targetsOpacity(node));
  const selected = new Set<number>();
  const collapsedFromLayers = new Set<string>();
  const warnings: LayerWarning[] = [];
  let paintOrder: number | undefined;
  for (
    let descendantIndex = occurrence.nodeIndex;
    descendantIndex < sourceIndex.nodes.size;
    descendantIndex++
  ) {
    const descendant = sourceIndex.nodes.get(descendantIndex);
    if (!descendant || descendant.enterOrder > occurrence.leaveOrder) {
      break;
    }
    selected.add(descendant.nodeIndex);
    if (descendant.paintOrder !== null) {
      paintOrder =
        paintOrder === undefined
          ? descendant.paintOrder
          : Math.min(paintOrder, descendant.paintOrder);
    }
    const requested = sourceInfoFor(descendant);
    if (requested.requestedLayerId !== islandInfo.requestedLayerId) {
      collapsedFromLayers.add(requested.requestedLayerId);
      warnings.push({
        code: "CROSSES_COMPOSITING_ISLAND",
        nodeId: descendant.source.nodeId,
        islandRootNodeId: islandInfo.nodeId,
      });
      if (isOpacityIsland) {
        warnings.push({
          code: "PARENT_OPACITY_PREVENTED_SPLIT",
          nodeId: descendant.source.nodeId,
          parentNodeId: islandInfo.nodeId,
        });
      }
    }
  }
  appendIslandWarnings(node, islandInfo.nodeId, warnings);
  return { selected, collapsedFromLayers, warnings, paintOrder };
}

function appendLayerClone(
  occurrence: IRNodeOccurrence,
  clones: Map<number, IRNode>,
  {
    contributing,
    originalSourceByClone,
  }: { contributing: ReadonlySet<number>; originalSourceByClone: Map<IRNode, number> },
): IRNode | null {
  const node = occurrence.node;
  const cloned = cloneIRForLayeredTransform(
    node.type === "group" ? { ...node, children: [] } : node,
  );
  if (cloned.ownership.role === "source") {
    originalSourceByClone.set(cloned, occurrence.nodeIndex);
    if (!contributing.has(occurrence.nodeIndex)) {
      cloned.ownership = { role: "source" };
    }
  }
  clones.set(occurrence.nodeIndex, cloned);
  if (occurrence.parentNodeIndex === null) {
    return cloned;
  } else {
    const parent = clones.get(occurrence.parentNodeIndex);
    if (parent?.type !== "group") {
      throw new FatalError("VALIDATION", "Layer extraction lost a structural parent.", {
        stage: "ir",
      });
    }
    parent.children?.push(cloned);
  }
  return null;
}
function buildLayerTree(segment: LayerSegment, sourceIndex: IRSourceIndex) {
  const contributing = new Set<number>();
  for (const selected of segment.selected) {
    const occurrence = sourceIndex.nodes.get(selected);
    if (occurrence) {
      contributing.add(occurrence.source.sourceIndex);
    }
  }
  const clones = new Map<number, IRNode>();
  const originalSourceByClone = new Map<IRNode, number>();
  let root: IRNode | null = null;
  for (const selected of segment.selected) {
    const pending: IRNodeOccurrence[] = [];
    let ancestor = sourceIndex.nodes.get(selected);
    while (ancestor && !clones.has(ancestor.nodeIndex)) {
      pending.push(ancestor);
      ancestor =
        ancestor.parentNodeIndex === null
          ? undefined
          : sourceIndex.nodes.get(ancestor.parentNodeIndex);
    }
    for (const occurrence of pending.reverse()) {
      const rootClone = appendLayerClone(occurrence, clones, {
        contributing,
        originalSourceByClone,
      });
      if (rootClone) {
        root = rootClone;
      }
    }
  }
  if (!root) {
    throw new FatalError("VALIDATION", "Layer extraction requires the original root closure.", {
      stage: "ir",
    });
  }
  return { root, contributing, originalSourceByClone };
}
function collectLayerSources(
  layerIndexProjection: IRSourceIndex,
  sourceIndex: IRSourceIndex,
  {
    originalSourceByClone,
    contributing,
    partsBySource,
  }: {
    originalSourceByClone: ReadonlyMap<IRNode, number>;
    contributing: ReadonlySet<number>;
    partsBySource: ReadonlyMap<number, CollectedPart[]>;
  },
) {
  const sources: LayerManifestEntry["sources"] = [];
  const parts: LayerManifestPart[] = [];
  for (const localSource of layerIndexProjection.sources.values()) {
    const originalSourceIndex = originalSourceByClone.get(localSource.node);
    if (originalSourceIndex === undefined || !contributing.has(originalSourceIndex)) {
      continue;
    }
    const source = sourceIndex.sources.get(originalSourceIndex);
    if (!source) {
      throw new FatalError("VALIDATION", "Missing contributing layer source.", { stage: "ir" });
    }
    sources.push({
      source: source.source,
      layerSourceIndex: localSource.source.sourceIndex,
      ...(source.node.ownership.role === "source" && source.node.ownership.meta
        ? { meta: { ...source.node.ownership.meta } }
        : {}),
    });
    for (const part of partsBySource.get(originalSourceIndex) ?? []) {
      parts.push({ ...part, source: source.source });
    }
  }
  return { sources, parts };
}
function targetsOpacity(node: IRGroupNode): boolean {
  return node.animation?.keyframes.some((keyframe) => keyframe.opacity !== undefined) ?? false;
}

/** Quoted SVG part-ID attributes transcribed into layer manifests. */
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
  const xCoordinates = corners.map((corner) => corner.x);
  const yCoordinates = corners.map((corner) => corner.y);
  const minX = Math.min(...xCoordinates);
  const minY = Math.min(...yCoordinates);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xCoordinates) - minX,
    height: Math.max(...yCoordinates) - minY,
  };
}

// Shape nodes carry structural parts; embedded Svg content is still scanned
// for part-id attributes so the manifest can never disagree with what the
// layer paints. Part bboxes are documented as canvas coordinates, so the
// node's own transform and every ancestor transform must be applied.
function collectNodeParts(
  sourceIndex: IRSourceIndex,
  accumulator: Map<number, CollectedPart[]>,
): void {
  const matrices = new Map<number, AffineMatrix>();
  for (const occurrence of sourceIndex.nodes.values()) {
    const node = occurrence.node;
    const ancestorMatrix =
      occurrence.parentNodeIndex === null
        ? createIdentityAffineMatrix()
        : (matrices.get(occurrence.parentNodeIndex) ?? createIdentityAffineMatrix());
    const matrix = multiplyAffineMatrices(
      ancestorMatrix,
      createResolvedTransformMatrix(getIRNodeTransform(node), node.bbox),
    );
    matrices.set(occurrence.nodeIndex, matrix);
    const collected = partsForNode(node, matrix);
    if (collected.length > 0) {
      const owner = occurrence.source.sourceIndex;
      accumulator.set(owner, [...(accumulator.get(owner) ?? []), ...collected]);
    }
  }
}

function partsForNode(node: IRNode, matrix: AffineMatrix): CollectedPart[] {
  if (node.type === "shape") {
    return node.shapeParts.flatMap((part) =>
      part.partId === undefined
        ? []
        : [
            {
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
            },
          ],
    );
  }
  if (node.type === "svg") {
    return [...node.svgContent.matchAll(PART_ID_ATTR_PATTERN)].map((match) => ({
      partId: unescapeXmlAttribute(match[1] ?? ""),
    }));
  }
  return [];
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

/** Detect node or text-unit animation recursively when constructing layered output metadata. */
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
