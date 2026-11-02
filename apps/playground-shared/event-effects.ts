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
import { buildIRSourceIndex, type IR, type IRSourceRef } from "@boundsvg/core/scene";

import { DEFAULT_INSPECTION_FRAME_MODE } from "./inspection-frame.js";

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
/** Stroke color for transformed inspection quads. */
const TRANSFORM_COLOR = "#22d3ee";
/** Stroke color for visual AABB corner markers. */
const VISUAL_COLOR = "#f472b6";
/** Stroke color for transform origin markers. */
const ORIGIN_COLOR = "#f59e0b";
/** Background halo behind transform origin markers. */
const ORIGIN_HALO_COLOR = "#0f172a";
/** Fill color for transformed quad corner handles. */
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

/** Inspection geometry and tooltip metadata for one rendered node. */
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

/** Source element details shown by the inspection tooltip. */
export type NodeSemantics = {
  /** Human element kind derived from the IR children: Text / Shape / Image / ... */
  kind: string;
  /** Semantic source label, including generated authoring IDs. */
  nodeId: string;
  /** Text excerpt for text nodes. */
  text?: string;
  /** Addressable shape part ids (emitPartIds / partPaint). */
  partIds?: string[];
  /** Author metadata, key-sorted. */
  meta?: Array<[string, string]>;
};

/** Select the inspection geometry to display. */
export type OverlayDisplayMode = "off" | "layout" | "transform" | "visual" | "all";

/** Inspection display overrides; transformed quads are shown by default. */
export type EventEffectOverlayDisplayOptions = {
  mode?: OverlayDisplayMode;
  showOrigin?: boolean;
};

/** Drawable parts of an inspection highlight. */
export type InspectOverlayPart = "layout" | "transform" | "handles" | "visual" | "origin";

/**
 * Decide which overlay parts to draw for a single node.
 *
 * Explicit modes (`layout` / `transform` / `visual`) always draw their parts
 * regardless of node geometry so users can compare identically across nodes.
 *
 * `all` mode additionally suppresses redundant parts to keep the composite
 * readable:
 * - When the resolved transform quad coincides with layout, only layout is drawn.
 * - When the quad is axis-aligned, visual corners coincide with it and are omitted.
 * Ancestor transforms are already included in the supplied inspection geometry.
 */
export function resolveInspectOverlayParts(options: {
  mode: OverlayDisplayMode;
  showOrigin: boolean;
  hasOrigin: boolean;
  layoutBBox: InspectionRect;
  transformBox: InspectionTransformBox;
}): InspectOverlayPart[] {
  const parts: InspectOverlayPart[] = [];
  const inAll = options.mode === "all";
  const isLayoutMatch = isTransformBoxEqualToLayout(options.transformBox, options.layoutBBox);
  const isAxisAligned = isTransformBoxAxisAligned(options.transformBox);

  if (options.mode === "layout" || inAll) {
    parts.push("layout");
  }
  if (options.mode === "transform" || (inAll && !isLayoutMatch)) {
    parts.push("transform", "handles");
  }
  if (options.mode === "visual" || (inAll && !isAxisAligned)) {
    parts.push("visual");
  }
  if (options.showOrigin && options.hasOrigin && options.mode !== "off") {
    parts.push("origin");
  }

  return parts;
}

function isTransformBoxEqualToLayout(
  transformBox: InspectionTransformBox,
  layoutBBox: InspectionRect,
): boolean {
  const { x, y, w, h } = layoutBBox;
  const layoutPoints = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  // Compare corner sets so a mirror or reordered quad can still describe the same box.
  return (
    layoutPoints.every((corner) =>
      transformBox.points.some((point) => point.x === corner.x && point.y === corner.y),
    ) &&
    transformBox.points.every((point) =>
      layoutPoints.some((corner) => corner.x === point.x && corner.y === point.y),
    )
  );
}

function buildNodeSemantics(
  source: import("@boundsvg/core/scene").IRSourceInfo,
  primary: import("@boundsvg/core/scene").IRNode | undefined,
): NodeSemantics {
  const semantics: NodeSemantics = {
    kind: primary ? primary.type[0]?.toUpperCase() + primary.type.slice(1) : "Box",
    nodeId: source.source.nodeId,
  };
  if (primary?.type === "text") {
    semantics.text = primary.displayText ?? primary.lines.map((line) => line.text).join(" ");
  }
  if (primary?.type === "shape") {
    semantics.partIds = primary.shapeParts.flatMap((part) =>
      part.partId === undefined ? [] : [part.partId],
    );
  }
  if (source.node.ownership.role === "source" && source.node.ownership.meta) {
    semantics.meta = Object.entries(source.node.ownership.meta);
  }
  return semantics;
}

/**
 * Build a map of source occurrence ordinals to prepared inspection geometry from the IR tree.
 * Uses resolved inspection geometry and adds corner radii and tooltip semantics
 * without recomputing transforms.
 */
export function buildNodeBBoxMap(ir: IR): Map<number, NodeBBox> {
  const sourceIndex = buildIRSourceIndex(ir);
  const geometry = new Map(
    collectInspectionBBoxes(ir, sourceIndex).map((entry) => [entry.nodeIndex, entry]),
  );
  const map = new Map<number, NodeBBox>();
  for (const source of sourceIndex.sources.values()) {
    const bbox = geometry.get(source.primaryNodeIndex ?? source.source.sourceIndex);
    const sourceBBox = geometry.get(source.source.sourceIndex);
    if (!bbox) {
      continue;
    }
    const primary =
      source.primaryNodeIndex === null
        ? undefined
        : sourceIndex.nodes.get(source.primaryNodeIndex)?.node;
    const semantics = buildNodeSemantics(source, primary);
    const radius = primary?.type === "rect" ? primary.borderRadius : undefined;
    map.set(source.source.sourceIndex, {
      semantics,
      ...bbox.layoutBBox,
      rx:
        typeof radius === "number"
          ? radius
          : radius
            ? Math.max(radius.tl, radius.tr, radius.br, radius.bl)
            : undefined,
      layoutBBox: bbox.layoutBBox,
      transformBox: bbox.transformBox,
      visualBBox: bbox.visualBBox,
      origin: sourceBBox?.origin ?? bbox.origin,
      hasOwnTransform: sourceBBox?.hasOwnTransform ?? bbox.hasOwnTransform,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Overlay manager
// ---------------------------------------------------------------------------

/** Namespace used for overlay elements. */
const SVG_NS = "http://www.w3.org/2000/svg";

/** Host, scene dimensions, and inspection geometry for an overlay. */
export type EventEffectOverlayOptions = {
  /** Container element wrapping the main SVG output. Must have position:relative. */
  container: HTMLElement;
  /** Canvas width in SVG user units (from IR.width) */
  width: number;
  /** Canvas height in SVG user units (from IR.height) */
  height: number;
  /** Map of nodeId → bbox, built from IR */
  bboxMap: Map<number, NodeBBox>;
  display?: EventEffectOverlayDisplayOptions;
};

/** Manage inspection and event highlights without rerendering the scene. */
export class EventEffectOverlay {
  private readonly overlaySvg: SVGSVGElement;
  private readonly wrapper: HTMLElement;
  private readonly width: number;
  private readonly height: number;
  private readonly tooltipEl: HTMLDivElement;
  private overlayMode: OverlayDisplayMode;
  private showOrigin: boolean;
  private readonly resizeObserver: ResizeObserver | null;
  /** True when this instance created the wrapper `<div>` around the SVG. */
  private readonly createdWrapper: boolean;
  private bboxMap: Map<number, NodeBBox>;
  private hoverRect: SVGElement | null = null;
  private inspectRect: SVGElement | null = null;
  private inspectSource: IRSourceRef | null = null;
  private tooltipHideTimeout: number | null = null;
  private pendingTimeouts: number[] = [];
  private originLayer: SVGElement | null = null;

  /** Attach the overlay to its host; destroy it when the host is released. */
  constructor(options: EventEffectOverlayOptions) {
    this.width = options.width;
    this.height = options.height;
    this.bboxMap = options.bboxMap;
    this.overlayMode = options.display?.mode ?? DEFAULT_INSPECTION_FRAME_MODE;
    this.showOrigin = options.display?.showOrigin ?? false;

    // Determine the wrapper element for the overlay.
    // If the container already has position:relative (caller-managed),
    // use it directly. Otherwise, wrap the inner <svg> in a tight
    // position:relative container so the overlay aligns with the SVG,
    // not the (possibly larger/flex-centered) outer container.
    const mainSvg = options.container.querySelector("svg");
    let wrapper: HTMLElement;
    let didCreateWrapper = false;
    if (options.container.style.position === "relative") {
      wrapper = options.container;
    } else {
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
    if (mainSvg) {
      const alignViewport = (): void => {
        const sourceBounds = mainSvg.getBoundingClientRect();
        const wrapperBounds = wrapper.getBoundingClientRect();
        svg.style.left = `${sourceBounds.left - wrapperBounds.left - wrapper.clientLeft}px`;
        svg.style.top = `${sourceBounds.top - wrapperBounds.top - wrapper.clientTop}px`;
        svg.style.width = `${sourceBounds.width}px`;
        svg.style.height = `${sourceBounds.height}px`;
      };
      // A wrapper can include baseline spacing or differ from the SVG by a CSS layout unit.
      // Match the rendered viewport instead of stretching inspection geometry to the wrapper.
      alignViewport();
      this.resizeObserver = new ResizeObserver(alignViewport);
      this.resizeObserver.observe(mainSvg);
    } else {
      this.resizeObserver = null;
    }
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
  flashNode(source: IRSourceRef, color: string, durationMs = 500): void {
    const bbox = this.resolveBBox(source);
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
  setHoverGlow(source: IRSourceRef | null, color = "#4ade80"): void {
    // Remove existing glow
    if (this.hoverRect) {
      this.hoverRect.remove();
      this.hoverRect = null;
    }

    if (!source) {
      return;
    }

    const bbox = this.resolveBBox(source);
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
   * Highlight the selected inspection geometry without animation.
   * Pass `null` to clear.
   */
  setInspectHighlight(source: IRSourceRef | null): void {
    if (this.inspectRect) {
      this.inspectRect.remove();
      this.inspectRect = null;
    }
    this.inspectSource = source;

    if (!source) {
      this.hideTooltip();
      return;
    }

    if (this.overlayMode === "off") {
      this.hideTooltip();
      return;
    }

    const bbox = this.resolveBBox(source);
    if (!bbox) {
      this.hideTooltip();
      return;
    }

    const rect = this.createInspectShape(bbox);
    this.overlaySvg.appendChild(rect);
    this.inspectRect = rect;
    this.showTooltip(bbox);
  }

  /** Change inspection display in place, preserving the source SVG and active node. */
  updateDisplay(display?: EventEffectOverlayDisplayOptions): void {
    this.overlayMode = display?.mode ?? DEFAULT_INSPECTION_FRAME_MODE;
    this.showOrigin = display?.showOrigin ?? false;
    this.renderPersistentOrigins();
    this.setInspectHighlight(this.inspectSource);
  }

  /** Replace snapshot geometry and clear effects whose references belong to the previous IR. */
  updateBBoxMap(bboxMap: Map<number, NodeBBox>): void {
    this.setHoverGlow(null);
    this.setInspectHighlight(null);
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts.length = 0;
    this.overlaySvg.replaceChildren();
    this.bboxMap = bboxMap;
    this.renderPersistentOrigins();
  }

  /** Remove the overlay SVG, unwrap the main SVG if we wrapped it, and clean up timers. */
  destroy(): void {
    this.resizeObserver?.disconnect();
    for (const tid of this.pendingTimeouts) {
      clearTimeout(tid);
    }
    this.pendingTimeouts.length = 0;
    if (this.tooltipHideTimeout != null) {
      clearTimeout(this.tooltipHideTimeout);
      this.tooltipHideTimeout = null;
    }
    this.hoverRect = null;
    this.inspectRect = null;
    this.inspectSource = null;
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
   * Resolve the prepared geometry for one source occurrence.
   */
  private resolveBBox(source: IRSourceRef): NodeBBox | null {
    return this.bboxMap.get(source.sourceIndex) ?? null;
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
      layoutBBox: bbox.layoutBBox,
      transformBox: bbox.transformBox,
    });

    for (const part of parts) {
      if (part === "layout") {
        group.appendChild(this.createLayoutRect(bbox));
      } else if (part === "transform") {
        group.appendChild(this.createTransformPolygon(bbox));
      } else if (part === "handles") {
        group.appendChild(this.createHandleGroup(bbox));
      } else if (part === "visual") {
        group.appendChild(
          this.overlayMode === "visual"
            ? this.createModeRect(bbox.visualBBox, VISUAL_COLOR, false, "8 3")
            : this.createVisualCorners(bbox),
        );
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
    const geometryLabel = this.overlayMode === "layout" ? "Layout" : "AABB";
    const sizeLabel = `${geometryLabel}: ${formatTooltipNumber(activeRect.w)} x ${formatTooltipNumber(activeRect.h)} px`;
    const semantics = bbox.semantics;
    const lines: string[] = [];
    const kind = semantics?.kind ?? "Node";
    const kindColor = tooltipKindColor(kind);
    const titleParts = [
      `<span style="color:${kindColor};font-weight:700">${escapeTooltipText(kind)}</span>`,
    ];
    if (semantics?.nodeId) {
      titleParts.push(`<span style="color:#7dd3fc">#${escapeTooltipText(semantics.nodeId)}</span>`);
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
    this.appendOriginMarkerLayer(group, origin, ORIGIN_HALO_COLOR, 5, 4);
    this.appendOriginMarkerLayer(group, origin, ORIGIN_COLOR, 2, 2.5);
    return group;
  }

  private appendOriginMarkerLayer(
    group: SVGElement,
    origin: OverlayPoint,
    color: string,
    strokeWidth: number,
    dotRadius: number,
  ): void {
    const horizontalLine = document.createElementNS(SVG_NS, "line");
    horizontalLine.setAttribute("x1", String(origin.x - 6));
    horizontalLine.setAttribute("y1", String(origin.y));
    horizontalLine.setAttribute("x2", String(origin.x + 6));
    horizontalLine.setAttribute("y2", String(origin.y));
    horizontalLine.setAttribute("stroke", color);
    horizontalLine.setAttribute("stroke-width", String(strokeWidth));
    horizontalLine.setAttribute("stroke-linecap", "round");
    horizontalLine.setAttribute("vector-effect", "non-scaling-stroke");
    const verticalLine = document.createElementNS(SVG_NS, "line");
    verticalLine.setAttribute("x1", String(origin.x));
    verticalLine.setAttribute("y1", String(origin.y - 6));
    verticalLine.setAttribute("x2", String(origin.x));
    verticalLine.setAttribute("y2", String(origin.y + 6));
    verticalLine.setAttribute("stroke", color);
    verticalLine.setAttribute("stroke-width", String(strokeWidth));
    verticalLine.setAttribute("stroke-linecap", "round");
    verticalLine.setAttribute("vector-effect", "non-scaling-stroke");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(origin.x));
    dot.setAttribute("cy", String(origin.y));
    dot.setAttribute("r", String(dotRadius));
    dot.setAttribute("fill", color);
    group.appendChild(horizontalLine);
    group.appendChild(verticalLine);
    group.appendChild(dot);
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
 * their own axis-aligned bounding box. The comparison uses resolved coordinates
 * exactly, retaining any residual skew or rotation. In those cases the transform
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
  for (const point of box.points) {
    const atCornerX = point.x === minX || point.x === maxX;
    const atCornerY = point.y === minY || point.y === maxY;
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
