import type {
  IRHitIndex,
  IRNodeOccurrence,
  IRSourceIndex,
  IRSourceRef,
} from "@boundsvg/core/scene";

/** Scoped correspondence between one emitted SVG document and its exact IR snapshot. */
export type IRDomBinding = {
  sourceIndex: IRSourceIndex;
  root: SVGSVGElement;
  occurrenceForElement: (target: Element) => IRNodeOccurrence | null;
  elementForNode: (nodeIndex: number) => Element | null;
  sourceForElement: (target: Element) => IRSourceRef | null;
};

/** Decode an untrusted DOM ordinal without rounding, clamping or alternate spellings. */
function readIndex(value: string | null, size: number): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/u.test(value)) {
    return null;
  }
  const ordinal = Number(value);
  return Number.isSafeInteger(ordinal) && ordinal < size ? ordinal : null;
}

/** Match only the element kind emitted for a physical IR endpoint. */
function matchesEndpoint(element: Element, occurrence: IRNodeOccurrence): boolean {
  const tag = element.localName;
  const node = occurrence.node;
  if (
    tag === "g" &&
    ((node.type === "path" && node.pathData.length === 0) ||
      (node.type === "image" && node.src.length === 0) ||
      (node.type === "svg" && node.svgContent.length === 0) ||
      (node.type === "shape" && node.shapeParts.length === 0) ||
      (node.type === "text" &&
        node.textLayoutKind === "path" &&
        !node.glyphPaths?.length &&
        !node.textDecorations?.some((fragment) => fragment.paths.length > 0)))
  ) {
    return true;
  }
  switch (occurrence.node.type) {
    case "group":
    case "text":
      return tag === "g";
    case "rect":
      return tag === "rect" || tag === "path";
    case "image":
      return tag === "image";
    case "path":
    case "svg":
    case "shape":
      return tag === "svg";
  }
}

/**
 * Bind the emitter's preorder endpoints in one SVG scope to the matching IR.
 * Embedded Svg content is opaque: user attributes never register as endpoints.
 * Metadata from another SVG document or a detached earlier snapshot is not used.
 */
export function bindIRToSvg(root: SVGSVGElement, sourceIndex: IRSourceIndex): IRDomBinding {
  const endpoints = new Map<number, Element>();
  const associations = new WeakMap<Element, IRNodeOccurrence>();
  let nextIndex = 0;
  function visit(element: Element, textOwner: IRNodeOccurrence | null): void {
    let resolvedTextOwner = textOwner;
    const nodeIndex = readIndex(
      element.getAttribute("data-boundsvg-node-index"),
      sourceIndex.nodes.size,
    );
    const occurrence = nodeIndex === nextIndex ? sourceIndex.nodes.get(nodeIndex) : undefined;
    if (
      occurrence &&
      matchesEndpoint(element, occurrence) &&
      element.getAttribute("data-boundsvg-role") === occurrence.node.ownership.role &&
      readIndex(element.getAttribute("data-boundsvg-source-index"), sourceIndex.nodes.size) ===
        occurrence.source.sourceIndex &&
      (occurrence.node.ownership.role !== "source" ||
        element.getAttribute("data-boundsvg-node-id") === occurrence.node.nodeId)
    ) {
      endpoints.set(occurrence.nodeIndex, element);
      associations.set(element, occurrence);
      nextIndex++;
      if (occurrence.node.type === "svg") {
        return;
      }
      if (occurrence.node.type === "text") {
        resolvedTextOwner = occurrence;
      }
    } else if (
      textOwner &&
      element.localName === "g" &&
      readIndex(element.getAttribute("data-boundsvg-unit-source-index"), sourceIndex.nodes.size) ===
        textOwner.source.sourceIndex
    ) {
      associations.set(element, textOwner);
    }
    for (const child of element.children) {
      visit(child, resolvedTextOwner);
    }
  }
  for (const child of root.children) {
    visit(child, null);
  }
  // A partial/mismatched document must not borrow endpoints from a different tree.
  const isComplete = nextIndex === sourceIndex.nodes.size;
  function occurrenceForElement(target: Element): IRNodeOccurrence | null {
    if (!isComplete || !root.contains(target)) {
      return null;
    }
    let current: Element | null = target;
    while (current && current !== root) {
      const occurrence = associations.get(current);
      if (occurrence) {
        return occurrence;
      }
      current = current.parentElement;
    }
    return null;
  }
  return {
    root,
    sourceIndex,
    occurrenceForElement,
    elementForNode(nodeIndex) {
      return isComplete ? (endpoints.get(nodeIndex) ?? null) : null;
    },
    sourceForElement(target) {
      return occurrenceForElement(target)?.source ?? null;
    },
  };
}

/** Read native Path hits in the same scope, retaining the prepared canvas/clip gates. */
export function nativePathCandidates(
  binding: IRDomBinding,
  index: IRHitIndex,
  point: { clientX: number; clientY: number; x: number; y: number },
): ReturnType<IRHitIndex["queryCandidates"]> {
  if (index.sourceIndex !== binding.sourceIndex) {
    return [];
  }
  const rootNode = binding.root.getRootNode() as Document | ShadowRoot;
  const hitRoot =
    typeof rootNode.elementsFromPoint === "function" ? rootNode : binding.root.ownerDocument;
  if (typeof hitRoot.elementsFromPoint !== "function") {
    return [];
  }
  const candidates: ReturnType<IRHitIndex["queryCandidates"]> = [];
  for (const element of hitRoot.elementsFromPoint(point.clientX, point.clientY)) {
    const occurrence = binding.occurrenceForElement(element);
    if (!occurrence || occurrence.node.type !== "path") {
      continue;
    }
    const endpoint = binding.elementForNode(occurrence.nodeIndex);
    // Path paint is the direct child of its emitted viewport, never embedded markup.
    if (element.localName !== "path" || element.parentElement !== endpoint) {
      continue;
    }
    const candidate = index.pathCandidateForSource(occurrence.source.sourceIndex, point.x, point.y);
    if (
      candidate &&
      !candidates.some((entry) => entry.source.sourceIndex === candidate.source.sourceIndex)
    ) {
      candidates.push(candidate);
    }
  }
  return candidates;
}
