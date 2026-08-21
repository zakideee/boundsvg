/**
 * Event visual effects overlay for playground apps.
 *
 * Creates a transparent SVG overlay on top of the rendered boundsvg output
 * and injects animated effects (flash, hover glow) when events fire.
 * All effects are pure DOM manipulation — no React state, no WASM re-render.
 */

import {
  collectInspectionBBoxes,
  type InspectionRect,
  type InspectionTransformBox,
} from "@boundsvg/core/inspect";
import type { IR, IRGroupNode, IRNode } from "@boundsvg/core/scene";

type OverlayPoint = {
  x: number;
  y: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Color map for each event type (shared between playground-react & playground-core) */
export const EVENT_COLORS: Record<string, string> = {
  click: "#22d3ee",
  dblclick: "#06b6d4",
  contextMenu: "#fbbf24",
  pointerDown: "#f472b6",
  pointerUp: "#fb7185",
  pointerEnter: "#4ade80",
  pointerLeave: "#f87171",
  pointerOver: "#86efac",
  pointerOut: "#fca5a5",
  pointerMove: "#64748b",
  mouseDown: "#c084fc",
  mouseUp: "#d8b4fe",
  mouseMove: "#64748b",
  mouseEnter: "#34d399",
  mouseLeave: "#fda4af",
  mouseOver: "#6ee7b7",
  mouseOut: "#feb2b2",
  touchStart: "#ff6b6b",
  touchEnd: "#ee5a24",
  touchMove: "#f9ca24",
};

/**
 * Inspect-overlay palette.
 *
 * Each role gets both a distinct hue and a distinct form so overlapping parts
 * stay readable: slate dashed rectangle for the pre-transform layout bbox,
 * cyan solid quad for the transform box, pink L-markers at the visual AABB
 * corners, and amber crosshair at the origin.
 */
const LAYOUT_COLOR = "#94a3b8";
const TRANSFORM_COLOR = "#22d3ee";
const VISUAL_COLOR = "#f472b6";
const ORIGIN_COLOR = "#f59e0b";
const HANDLE_FILL = "#0f172a";

/** Events that trigger a brief flash effect (discrete events only). */
export const FLASH_EVENTS = new Set([
  "click",
  "dblclick",
  "contextMenu",
  "pointerDown",
  "pointerUp",
  "mouseDown",
  "mouseUp",
  "touchStart",
  "touchEnd",
]);

// ---------------------------------------------------------------------------
// BBox map builder
// ---------------------------------------------------------------------------

export type NodeBBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
  layoutBBox: InspectionRect;
  transformBox: InspectionTransformBox;
  visualBBox: InspectionRect;
  origin: OverlayPoint | null;
  hasOwnTransform: boolean;
  /** DevTools-style semantics for the hover tooltip. */
  semantics?: NodeSemantics;
};

export type NodeSemantics = {
  /** Human element kind derived from the IR children: Text / Shape / Image / ... */
  kind: string;
  /** Author-assigned id (absent for auto-generated node ids). */
  explicitId?: string;
  /** Text excerpt for text nodes. */
  text?: string;
  /** Addressable shape part ids (emitPartIds / partPaint). */
  partIds?: string[];
  /** Author metadata, key-sorted. */
  meta?: Array<[string, string]>;
};

export type OverlayDisplayMode = "off" | "layout" | "transform" | "visual" | "all";

export type EventEffectOverlayDisplayOptions = {
  mode?: OverlayDisplayMode;
  showOrigin?: boolean;
};

export type InspectOverlayPart = "layout" | "transform" | "handles" | "visual" | "origin";

/**
 * Decide which overlay parts to draw for a single node.
 *
 * Explicit modes (`layout` / `transform` / `visual`) always draw their parts
 * regardless of node geometry so users can compare identically across nodes.
 *
 * `all` mode additionally suppresses redundant parts to keep the composite
 * readable:
 * - When the node has no own transform (`hasOwnTransform=false`), the
 *   transform quad, handles, and visual corners all coincide with layout, so
 *   only `layout` is drawn.
 * - When the transform quad is axis-aligned (pure translate/scale),
 *   `visualBBox` equals the quad, so visual corners are suppressed to avoid
 *   doubled outlines.
 */
export function resolveInspectOverlayParts(options: {
  mode: OverlayDisplayMode;
  showOrigin: boolean;
  hasOrigin: boolean;
  hasOwnTransform?: boolean;
  isTransformAxisAligned?: boolean;
}): InspectOverlayPart[] {
  const parts: InspectOverlayPart[] = [];
  const inAll = options.mode === "all";
  const hasOwnTransform = options.hasOwnTransform ?? true;
  const isAxisAligned = options.isTransformAxisAligned ?? false;

  if (options.mode === "layout" || inAll) {
    parts.push("layout");
  }
  if (options.mode === "transform" || (inAll && hasOwnTransform)) {
    parts.push("transform", "handles");
  }
  if (options.mode === "visual" || (inAll && hasOwnTransform && !isAxisAligned)) {
    parts.push("visual");
  }
  if (options.showOrigin && options.hasOrigin && options.mode !== "off") {
    parts.push("origin");
  }

  return parts;
}

/**
 * Build a flat map of nodeId → bounding box from the IR tree.
 * Replicates the `collectBboxes` pattern in `@boundsvg/core/ir/hit-test.ts`
 * and additionally extracts borderRadius for overlay rendering.
 */
export function buildNodeBBoxMap(ir: IR): Map<string, NodeBBox> {
  const inspectionBBoxes = collectInspectionBBoxes(ir);
  const borderRadiusMap = collectBorderRadiusMap(ir.root);
  const semanticsMap = collectNodeSemantics(ir.root);
  const map = new Map<string, NodeBBox>();
  for (const bbox of inspectionBBoxes) {
    map.set(bbox.nodeId, {
      semantics: semanticsMap.get(bbox.nodeId),
      x: bbox.x,
      y: bbox.y,
      w: bbox.w,
      h: bbox.h,
      rx: borderRadiusMap.get(bbox.nodeId),
      layoutBBox: { ...bbox.layoutBBox },
      transformBox: {
        points: bbox.transformBox.points.map((point) => ({
          ...point,
        })) as InspectionTransformBox["points"],
      },
      visualBBox: { ...bbox.visualBBox },
      origin: bbox.origin ? { ...bbox.origin } : null,
      hasOwnTransform: bbox.hasOwnTransform,
    });
  }
  return map;
}

function collectBorderRadiusMap(node: IRNode): Map<string, number> {
  const map = new Map<string, number>();

  const walk = (currentNode: IRNode): void => {
    if (currentNode.type === "rect" && currentNode.borderRadius != null) {
      if (typeof currentNode.borderRadius === "number") {
        map.set(currentNode.nodeId, currentNode.borderRadius);
      } else {
        const { tl, tr, br, bl } = currentNode.borderRadius;
        map.set(currentNode.nodeId, Math.max(tl, tr, br, bl));
      }
    }

    for (const child of currentNode.type === "group" ? (currentNode.children ?? []) : []) {
      walk(child);
    }
  };

  walk(node);
  return map;
}

/**
 * Derive DevTools-style semantics per source node: the element kind (from the
 * node's leaf children), a text excerpt, addressable shape part ids, and the
 * author metadata bag - so hover labels read like an element inspector
 * instead of raw auto:* node ids.
 */
function collectNodeSemantics(root: IRNode): Map<string, NodeSemantics> {
  const map = new Map<string, NodeSemantics>();

  const kindOfChildren = (node: IRGroupNode): string => {
    const children = node.children ?? [];
    const childTypes = new Set(children.map((child) => child.type));
    if (childTypes.has("text")) {
      return "Text";
    }
    if (childTypes.has("shape")) {
      return "Shape";
    }
    if (childTypes.has("svg")) {
      return "Svg";
    }
    if (childTypes.has("image")) {
      return "Image";
    }
    if (childTypes.has("path")) {
      return "Path";
    }
    if (children.some((child) => child.type === "group")) {
      return "Box";
    }
    return node.type === "group" ? "Box" : node.type;
  };

  const semanticsForGroup = (node: IRGroupNode): NodeSemantics => {
    const semantics: NodeSemantics = { kind: kindOfChildren(node) };
    if (!node.nodeId.startsWith("auto:")) {
      semantics.explicitId = node.nodeId;
    }
    for (const child of node.children ?? []) {
      if (child.type === "text") {
        semantics.text = child.lines.map((line) => line.text).join(" ");
      }
      if (child.type === "shape") {
        const partIds = child.shapeParts.flatMap((part) =>
          part.partId === undefined ? [] : [part.partId],
        );
        if (partIds.length > 0) {
          semantics.partIds = partIds;
        }
      }
    }
    if (node.meta) {
      semantics.meta = Object.entries(node.meta);
    }
    return semantics;
  };

  const walk = (node: IRNode): void => {
    if (node.type === "group") {
      map.set(node.nodeId, semanticsForGroup(node));
    }
    for (const child of node.type === "group" ? (node.children ?? []) : []) {
      walk(child);
    }
  };

  walk(root);
  return map;
}

// ---------------------------------------------------------------------------
// Overlay manager
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

export type EventEffectOverlayOptions = {
  /** Container element wrapping the main SVG output. Must have position:relative. */
  container: HTMLElement;
  /** Canvas width in SVG user units (from IR.width) */
  width: number;
  /** Canvas height in SVG user units (from IR.height) */
  height: number;
  /** Map of nodeId → bbox, built from IR */
  bboxMap: Map<string, NodeBBox>;
  display?: EventEffectOverlayDisplayOptions;
};

export class EventEffectOverlay {
  private readonly overlaySvg: SVGSVGElement;
  private readonly wrapper: HTMLElement;
  private readonly width: number;
  private readonly height: number;
  private readonly tooltipEl: HTMLDivElement;
  private readonly overlayMode: OverlayDisplayMode;
  private readonly showOrigin: boolean;
  /** True when this instance created the wrapper `<div>` around the SVG. */
  private readonly createdWrapper: boolean;
  private bboxMap: Map<string, NodeBBox>;
  private hoverRect: SVGElement | null = null;
  private hoverNodeId: string | null = null;
  private hoverColor = "#4ade80";
  private inspectRect: SVGElement | null = null;
  private inspectNodeId: string | null = null;
  private tooltipHideTimeout: number | null = null;
  private pendingTimeouts: number[] = [];
  private originLayer: SVGElement | null = null;

  constructor(options: EventEffectOverlayOptions) {
    this.width = options.width;
    this.height = options.height;
    this.bboxMap = options.bboxMap;
    this.overlayMode = options.display?.mode ?? "layout";
    this.showOrigin = options.display?.showOrigin ?? false;

    // Determine the wrapper element for the overlay.
    // If the container already has position:relative (caller-managed),
    // use it directly. Otherwise, wrap the inner <svg> in a tight
    // position:relative container so the overlay aligns with the SVG,
    // not the (possibly larger/flex-centered) outer container.
    let wrapper: HTMLElement;
    let didCreateWrapper = false;
    if (options.container.style.position === "relative") {
      wrapper = options.container;
    } else {
      const mainSvg = options.container.querySelector("svg");
      if (mainSvg && !mainSvg.dataset.effectWrapper) {
        wrapper = document.createElement("div");
        wrapper.style.cssText = "position:relative;display:inline-block";
        const parent = mainSvg.parentNode ?? mainSvg.parentElement;
        if (parent) {
          parent.insertBefore(wrapper, mainSvg);
          wrapper.appendChild(mainSvg);
          mainSvg.dataset.effectWrapper = "1";
          didCreateWrapper = true;
        }
      } else {
        wrapper = options.container;
        wrapper.style.position = "relative";
      }
    }
    this.createdWrapper = didCreateWrapper;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${options.width} ${options.height}`);
    svg.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible";
    wrapper.appendChild(svg);
    this.wrapper = wrapper;
    this.overlaySvg = svg;
    this.tooltipEl = this.createTooltipElement();
    wrapper.appendChild(this.tooltipEl);
    this.renderPersistentOrigins();
  }

  /**
   * "Show origin anchor" is a persistent toggle, not a hover affordance:
   * when enabled, every node that has a transform origin gets its marker
   * drawn immediately (hover additionally re-draws it on the inspected node).
   */
  private renderPersistentOrigins(): void {
    this.originLayer?.remove();
    this.originLayer = null;
    if (!this.showOrigin || this.overlayMode === "off") {
      return;
    }
    const layer = document.createElementNS(SVG_NS, "g");
    for (const bbox of this.bboxMap.values()) {
      if (bbox.origin) {
        layer.appendChild(this.createOriginMarker(bbox.origin));
      }
    }
    if (layer.childNodes.length > 0) {
      this.overlaySvg.appendChild(layer);
      this.originLayer = layer;
    }
  }

  /**
   * Flash effect: brief colored rect that fades out over `durationMs`.
   * Used for discrete events (click, press, etc.).
   */
  flashNode(nodeId: string, color: string, durationMs = 500): void {
    const bbox = this.resolveBBox(nodeId);
    if (!bbox) {
      return;
    }

    const rect = this.createModeRect(
      this.getInteractiveRect(bbox),
      color,
      true,
      undefined,
      this.getInteractiveRadius(bbox),
    );
    const anim = document.createElementNS(SVG_NS, "animate");
    anim.setAttribute("attributeName", "opacity");
    anim.setAttribute("from", "1");
    anim.setAttribute("to", "0");
    anim.setAttribute("dur", `${durationMs / 1000}s`);
    anim.setAttribute("fill", "freeze");
    rect.appendChild(anim);
    this.overlaySvg.appendChild(rect);

    // Self-remove after animation
    const remove = () => {
      if (rect.parentNode) {
        rect.remove();
      }
    };
    anim.addEventListener("endEvent", remove, { once: true });
    const tid = window.setTimeout(remove, durationMs + 100);
    this.pendingTimeouts.push(tid);
  }

  /**
   * Hover glow: persistent pulsing outline while a node is hovered.
   * Pass `null` to clear the glow.
   */
  setHoverGlow(nodeId: string | null, color = "#4ade80"): void {
    // Remove existing glow
    if (this.hoverRect) {
      this.hoverRect.remove();
      this.hoverRect = null;
    }
    this.hoverNodeId = nodeId;
    this.hoverColor = color;

    if (!nodeId) {
      return;
    }

    const bbox = this.resolveBBox(nodeId);
    if (!bbox) {
      return;
    }

    const rect = this.createModeRect(
      this.getInteractiveRect(bbox),
      color,
      false,
      undefined,
      this.getInteractiveRadius(bbox),
    );
    const anim = document.createElementNS(SVG_NS, "animate");
    anim.setAttribute("attributeName", "stroke-opacity");
    anim.setAttribute("values", "1;0.4;1");
    anim.setAttribute("dur", "1.2s");
    anim.setAttribute("repeatCount", "indefinite");
    rect.appendChild(anim);
    this.overlaySvg.appendChild(rect);
    this.hoverRect = rect;
  }

  /**
   * DevTools-style inspect highlight: semi-transparent blue fill + solid outline.
   * No animation. Pass `null` to clear.
   */
  setInspectHighlight(nodeId: string | null): void {
    if (this.inspectRect) {
      this.inspectRect.remove();
      this.inspectRect = null;
    }
    this.inspectNodeId = nodeId;

    if (!nodeId) {
      this.hideTooltip();
      return;
    }

    if (this.overlayMode === "off") {
      this.hideTooltip();
      return;
    }

    const bbox = this.resolveBBox(nodeId);
    if (!bbox) {
      this.hideTooltip();
      return;
    }

    const rect = this.createInspectShape(bbox);
    this.overlaySvg.appendChild(rect);
    this.inspectRect = rect;
    this.showTooltip(bbox);
  }

  /** Update the bbox map (e.g. after IR re-render). Preserves active effects. */
  updateBBoxMap(bboxMap: Map<string, NodeBBox>): void {
    this.bboxMap = bboxMap;
    this.renderPersistentOrigins();
    if (this.hoverNodeId) {
      this.setHoverGlow(this.hoverNodeId, this.hoverColor);
    }
    if (this.inspectNodeId) {
      this.setInspectHighlight(this.inspectNodeId);
    }
  }

  /** Remove the overlay SVG, unwrap the main SVG if we wrapped it, and clean up timers. */
  destroy(): void {
    for (const tid of this.pendingTimeouts) {
      clearTimeout(tid);
    }
    this.pendingTimeouts.length = 0;
    if (this.tooltipHideTimeout != null) {
      clearTimeout(this.tooltipHideTimeout);
      this.tooltipHideTimeout = null;
    }
    this.hoverRect = null;
    this.hoverNodeId = null;
    this.inspectRect = null;
    this.inspectNodeId = null;
    if (this.overlaySvg.parentNode) {
      this.overlaySvg.remove();
    }
    if (this.tooltipEl.parentNode) {
      this.tooltipEl.remove();
    }

    // If we created a wrapper div around the main SVG, move the SVG back
    // to the wrapper's parent and remove the wrapper so the DOM is restored
    // to its original structure.
    if (this.createdWrapper && this.wrapper.parentNode) {
      const mainSvg = this.wrapper.querySelector<SVGSVGElement>("svg[data-effect-wrapper]");
      if (mainSvg) {
        delete mainSvg.dataset.effectWrapper;
        this.wrapper.parentNode.insertBefore(mainSvg, this.wrapper);
      }
      this.wrapper.remove();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the bbox for a nodeId.
   * If the nodeId itself isn't found, falls back to the `:bg` suffixed node
   * (background rect created by the IR builder for Box/Flex containers).
   */
  private resolveBBox(nodeId: string): NodeBBox | null {
    return this.bboxMap.get(nodeId) ?? this.bboxMap.get(`${nodeId}:bg`) ?? null;
  }

  private createModeRect(
    bbox: InspectionRect,
    color: string,
    withFill: boolean,
    dashArray?: string,
    radius?: number,
  ): SVGRectElement {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(bbox.x));
    rect.setAttribute("y", String(bbox.y));
    rect.setAttribute("width", String(bbox.w));
    rect.setAttribute("height", String(bbox.h));
    rect.setAttribute("stroke", color);
    rect.setAttribute("stroke-width", "2");
    rect.setAttribute("vector-effect", "non-scaling-stroke");
    if (dashArray) {
      rect.setAttribute("stroke-dasharray", dashArray);
    }
    if (radius != null) {
      rect.setAttribute("rx", String(radius));
      rect.setAttribute("ry", String(radius));
    }
    if (withFill) {
      rect.setAttribute("fill", color);
      rect.setAttribute("fill-opacity", "0.1");
    } else {
      rect.setAttribute("fill", "none");
    }
    return rect;
  }

  private createInspectShape(bbox: NodeBBox): SVGElement {
    const group = document.createElementNS(SVG_NS, "g");
    const parts = resolveInspectOverlayParts({
      mode: this.overlayMode,
      showOrigin: this.showOrigin,
      hasOrigin: bbox.origin != null,
      hasOwnTransform: bbox.hasOwnTransform,
      isTransformAxisAligned: isTransformBoxAxisAligned(bbox.transformBox),
    });

    for (const part of parts) {
      if (part === "layout") {
        group.appendChild(this.createLayoutRect(bbox));
      } else if (part === "transform") {
        group.appendChild(this.createTransformPolygon(bbox));
      } else if (part === "handles") {
        group.appendChild(this.createHandleGroup(bbox));
      } else if (part === "visual") {
        group.appendChild(this.createVisualCorners(bbox));
      } else if (part === "origin" && bbox.origin) {
        group.appendChild(this.createOriginMarker(bbox.origin));
      }
    }

    return group;
  }

  private createTooltipElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.style.cssText = [
      "position:absolute",
      "top:0",
      "left:0",
      "pointer-events:none",
      "z-index:2",
      "padding:8px 10px",
      "border-radius:10px",
      "background:rgba(15,23,42,0.9)",
      "color:#f8fafc",
      "border:1px solid rgba(148,163,184,0.24)",
      "box-shadow:0 12px 32px rgba(15,23,42,0.22)",
      "backdrop-filter:blur(8px)",
      "font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace",
      "font-size:11px",
      "line-height:1.35",
      "white-space:nowrap",
      "opacity:0",
      "transform:translate3d(0,8px,0) scale(0.98)",
      "transform-origin:top left",
      "transition:opacity 180ms ease, transform 220ms cubic-bezier(0.22,1,0.36,1)",
    ].join(";");
    return element;
  }

  private showTooltip(bbox: NodeBBox): void {
    const activeRect = this.getInteractiveRect(bbox);
    const sizeLabel = `${formatTooltipNumber(activeRect.w)} x ${formatTooltipNumber(activeRect.h)} px`;
    const semantics = bbox.semantics;
    const lines: string[] = [];
    const kind = semantics?.kind ?? "Node";
    const kindColor = tooltipKindColor(kind);
    const titleParts = [
      `<span style="color:${kindColor};font-weight:700">${escapeTooltipText(kind)}</span>`,
    ];
    if (semantics?.explicitId) {
      titleParts.push(
        `<span style="color:#7dd3fc">#${escapeTooltipText(semantics.explicitId)}</span>`,
      );
    }
    if (semantics?.text) {
      const excerpt =
        semantics.text.length > 26 ? `${semantics.text.slice(0, 26)}…` : semantics.text;
      titleParts.push(`<span style="color:#e2e8f0">"${escapeTooltipText(excerpt)}"</span>`);
    }
    lines.push(`<div style="font-weight:600;letter-spacing:0.01em">${titleParts.join(" ")}</div>`);
    if (semantics?.partIds?.length) {
      lines.push(
        `<div style="margin-top:2px;color:#a5b4fc">parts: ${semantics.partIds
          .map((partId) => escapeTooltipText(partId))
          .join(" · ")}</div>`,
      );
    }
    if (semantics?.meta?.length) {
      lines.push(
        `<div style="margin-top:2px;color:#6ee7b7">${semantics.meta
          .map(([key, value]) => `${escapeTooltipText(key)}=${escapeTooltipText(value)}`)
          .join(" ")}</div>`,
      );
    }
    lines.push(`<div style="margin-top:2px;color:#94a3b8">${sizeLabel}</div>`);
    this.tooltipEl.innerHTML = lines.join("");

    if (this.tooltipHideTimeout != null) {
      clearTimeout(this.tooltipHideTimeout);
      this.tooltipHideTimeout = null;
    }

    this.positionTooltip(activeRect);
    requestAnimationFrame(() => {
      this.tooltipEl.style.opacity = "1";
      this.tooltipEl.style.transform = "translate3d(0,0,0) scale(1)";
      this.positionTooltip(activeRect);
    });

    this.tooltipHideTimeout = window.setTimeout(() => {
      this.hideTooltip();
    }, 1400);
  }

  private hideTooltip(): void {
    if (this.tooltipHideTimeout != null) {
      clearTimeout(this.tooltipHideTimeout);
      this.tooltipHideTimeout = null;
    }
    this.tooltipEl.style.opacity = "0";
    this.tooltipEl.style.transform = "translate3d(0,8px,0) scale(0.98)";
  }

  private positionTooltip(bbox: InspectionRect): void {
    const wrapperWidth = this.wrapper.clientWidth;
    const wrapperHeight = this.wrapper.clientHeight;
    if (wrapperWidth <= 0 || wrapperHeight <= 0 || this.width <= 0 || this.height <= 0) {
      return;
    }

    const scaleX = wrapperWidth / this.width;
    const scaleY = wrapperHeight / this.height;
    const margin = 12;
    const anchorX = bbox.x * scaleX;
    const anchorY = bbox.y * scaleY;
    const tooltipWidth = this.tooltipEl.offsetWidth;
    const tooltipHeight = this.tooltipEl.offsetHeight;

    let left = anchorX + margin;
    let top = anchorY - tooltipHeight - margin;

    if (left + tooltipWidth > wrapperWidth - margin) {
      left = Math.max(margin, wrapperWidth - tooltipWidth - margin);
    }
    if (top < margin) {
      top = Math.min(wrapperHeight - tooltipHeight - margin, anchorY + bbox.h * scaleY + margin);
    }
    if (top < margin) {
      top = margin;
    }

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  private getInteractiveRect(bbox: NodeBBox): InspectionRect {
    if (
      this.overlayMode === "transform" ||
      this.overlayMode === "visual" ||
      this.overlayMode === "all"
    ) {
      return bbox.visualBBox;
    }
    return bbox.layoutBBox;
  }

  private getInteractiveRadius(bbox: NodeBBox): number | undefined {
    if (this.overlayMode === "layout") {
      return bbox.rx;
    }
    return undefined;
  }

  private createLayoutRect(bbox: NodeBBox): SVGRectElement {
    const rect = this.createModeRect(bbox.layoutBBox, LAYOUT_COLOR, true, "4 3", bbox.rx);
    rect.setAttribute("stroke-width", "1.5");
    rect.setAttribute("fill-opacity", "0.05");
    return rect;
  }

  private createTransformPolygon(bbox: NodeBBox): SVGPolygonElement {
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute(
      "points",
      bbox.transformBox.points.map((point) => `${point.x},${point.y}`).join(" "),
    );
    polygon.setAttribute("stroke", TRANSFORM_COLOR);
    polygon.setAttribute("stroke-width", "2");
    polygon.setAttribute("vector-effect", "non-scaling-stroke");
    polygon.setAttribute("fill", "none");
    return polygon;
  }

  private createVisualCorners(bbox: NodeBBox): SVGElement {
    const { x, y, w, h } = bbox.visualBBox;
    const markerLength = Math.max(2, Math.min(10, w / 4, h / 4));
    const group = document.createElementNS(SVG_NS, "g");

    const appendSegment = (x1: number, y1: number, x2: number, y2: number): void => {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", VISUAL_COLOR);
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      group.appendChild(line);
    };

    // Top-left
    appendSegment(x, y, x + markerLength, y);
    appendSegment(x, y, x, y + markerLength);
    // Top-right
    appendSegment(x + w, y, x + w - markerLength, y);
    appendSegment(x + w, y, x + w, y + markerLength);
    // Bottom-right
    appendSegment(x + w, y + h, x + w - markerLength, y + h);
    appendSegment(x + w, y + h, x + w, y + h - markerLength);
    // Bottom-left
    appendSegment(x, y + h, x + markerLength, y + h);
    appendSegment(x, y + h, x, y + h - markerLength);

    return group;
  }

  private createOriginMarker(origin: OverlayPoint): SVGElement {
    const group = document.createElementNS(SVG_NS, "g");
    const hLine = document.createElementNS(SVG_NS, "line");
    hLine.setAttribute("x1", String(origin.x - 6));
    hLine.setAttribute("y1", String(origin.y));
    hLine.setAttribute("x2", String(origin.x + 6));
    hLine.setAttribute("y2", String(origin.y));
    hLine.setAttribute("stroke", ORIGIN_COLOR);
    hLine.setAttribute("stroke-width", "2");
    hLine.setAttribute("vector-effect", "non-scaling-stroke");
    const vLine = document.createElementNS(SVG_NS, "line");
    vLine.setAttribute("x1", String(origin.x));
    vLine.setAttribute("y1", String(origin.y - 6));
    vLine.setAttribute("x2", String(origin.x));
    vLine.setAttribute("y2", String(origin.y + 6));
    vLine.setAttribute("stroke", ORIGIN_COLOR);
    vLine.setAttribute("stroke-width", "2");
    vLine.setAttribute("vector-effect", "non-scaling-stroke");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(origin.x));
    dot.setAttribute("cy", String(origin.y));
    dot.setAttribute("r", "2.5");
    dot.setAttribute("fill", ORIGIN_COLOR);
    group.appendChild(hLine);
    group.appendChild(vLine);
    group.appendChild(dot);
    return group;
  }

  private createHandleGroup(bbox: NodeBBox): SVGElement {
    const group = document.createElementNS(SVG_NS, "g");
    for (const point of bbox.transformBox.points) {
      const handle = document.createElementNS(SVG_NS, "circle");
      handle.setAttribute("cx", String(point.x));
      handle.setAttribute("cy", String(point.y));
      handle.setAttribute("r", "3");
      handle.setAttribute("fill", HANDLE_FILL);
      handle.setAttribute("stroke", TRANSFORM_COLOR);
      handle.setAttribute("stroke-width", "1.5");
      handle.setAttribute("vector-effect", "non-scaling-stroke");
      group.appendChild(handle);
    }
    return group;
  }
}

/**
 * True when the four corners of a transform box coincide with the corners of
 * their own axis-aligned bounding box (i.e. pure translate / scale or 90°
 * rotation — no skew and no off-axis rotation). In those cases the transform
 * quad and the visual AABB are identical, so the `all`-mode overlay
 * suppresses the visual corner markers to avoid doubled outlines.
 */
export function isTransformBoxAxisAligned(box: InspectionTransformBox): boolean {
  const xCoordinates = box.points.map((point) => point.x);
  const yCoordinates = box.points.map((point) => point.y);
  const minX = Math.min(...xCoordinates);
  const maxX = Math.max(...xCoordinates);
  const minY = Math.min(...yCoordinates);
  const maxY = Math.max(...yCoordinates);
  const EPS = 1e-6;
  for (const point of box.points) {
    const atCornerX = Math.abs(point.x - minX) < EPS || Math.abs(point.x - maxX) < EPS;
    const atCornerY = Math.abs(point.y - minY) < EPS || Math.abs(point.y - maxY) < EPS;
    if (!atCornerX || !atCornerY) {
      return false;
    }
  }
  return true;
}

function escapeTooltipText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tooltipKindColor(kind: string): string {
  switch (kind) {
    case "Text":
      return "#f59e0b";
    case "Shape":
      return "#a855f7";
    case "Image":
      return "#84cc16";
    case "Svg":
      return "#38bdf8";
    case "Path":
      return "#14b8a6";
    default:
      return "#94a3b8";
  }
}

function formatTooltipNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
