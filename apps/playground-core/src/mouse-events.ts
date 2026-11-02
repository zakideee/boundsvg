import {
  bindIRToSvg,
  nativePathCandidates,
  resolveHitTarget,
  translateSvgCoords,
} from "@boundsvg/browser";
import {
  buildTextMap,
  findLineAtPoint,
  getAllText,
  getAncestorText,
  getNodeText,
  type HandlersRef,
  type IR,
  type IRHitIndex,
  type IRSourceRef,
  type TextMap,
} from "@boundsvg/core/scene";
import { getElement } from "../../playground-shared/dom.js";
import {
  buildNodeBBoxMap,
  EVENT_COLORS,
  EventEffectOverlay,
  FLASH_EVENTS,
} from "../../playground-shared/event-effects.js";

import type {
  EventEffectOverlayDisplayOptions,
  InspectHoverHandle,
} from "../../playground-shared/inspect-hover.js";

function addEventLogEntry(event: string, nodeId: string, x: number, y: number): void {
  const logEl = getElement("event-log-entries");
  const date = new Date();
  const time = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
  const color = EVENT_COLORS[event] ?? "var(--muted)";
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span style="color:var(--muted)">${time}</span><span style="color:${color}">${event}</span><span style="color:var(--accent)">${nodeId}</span><span style="color:var(--muted)">(${Math.round(x)}, ${Math.round(y)})</span>`;
  logEl.prepend(entry);
  // Keep max 30 entries
  while (logEl.children.length > 30 && logEl.lastChild) {
    logEl.removeChild(logEl.lastChild);
  }
}

function getSvgCoords(
  svgEl: SVGSVGElement,
  e: MouseEvent | PointerEvent,
): { x: number; y: number } {
  return translateSvgCoords(svgEl, e.clientX, e.clientY) ?? { x: 0, y: 0 };
}

// ---------------------------------------------------------------------------
// Text copy menu (vanilla DOM)
// ---------------------------------------------------------------------------

async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy fallback
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function buildCopyMenuItems(
  textMap: TextMap,
  textSource: IRSourceRef,
  svgX: number,
  svgY: number,
): Array<{ label: string; text: string }> {
  const items: Array<{ label: string; text: string }> = [];

  const lineEntry = findLineAtPoint(textMap, textSource.sourceIndex, { svgX, svgY });
  if (lineEntry) {
    items.push({ label: `Copy line: ${truncate(lineEntry.text, 24)}`, text: lineEntry.text });
  }

  const nodeText = getNodeText(textMap, textSource.sourceIndex);
  if (nodeText) {
    items.push({ label: `Copy text: ${truncate(nodeText, 24)}`, text: nodeText });
  }

  const ancestorText = getAncestorText(textMap, textSource.sourceIndex);
  if (ancestorText) {
    items.push({ label: "Copy parent text", text: ancestorText });
  }

  const allText = getAllText(textMap);
  if (allText) {
    items.push({ label: "Copy all text", text: allText });
  }

  return items;
}

function truncate(text: string, maxLen: number): string {
  const single = text.replace(/\n/g, " ");
  if (single.length <= maxLen) {
    return single;
  }
  return `${single.slice(0, maxLen)}...`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type CopyMenuState = {
  menuEl: HTMLDivElement;
  toastEl: HTMLDivElement;
  dismiss: () => void;
  toastTimer: ReturnType<typeof setTimeout>;
};

function showCopyMenu(
  state: CopyMenuState,
  clientX: number,
  clientY: number,
  items: Array<{ label: string; text: string }>,
): void {
  const { menuEl } = state;
  menuEl.innerHTML = "";

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "text-copy-menu-item";
    btn.innerHTML = escapeHtml(item.label);
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", () => {
      void (async () => {
        const ok = await writeClipboard(item.text);
        state.dismiss();
        showToast(
          state,
          clientX,
          clientY,
          ok ? `Copied: ${item.label.split(":")[0]}` : "Copy failed",
        );
      })();
    });
    menuEl.appendChild(btn);
  }

  menuEl.style.left = `${clientX}px`;
  menuEl.style.top = `${clientY}px`;
  menuEl.style.display = "block";
}

/** Spacing between copy feedback and the pointer. */
const TOAST_OFFSET_PX = 12;
/** Time copy feedback remains visible. */
const TOAST_DURATION_MS = 1200;

function showToast(state: CopyMenuState, clientX: number, clientY: number, message: string): void {
  const { toastEl } = state;
  toastEl.textContent = message;
  toastEl.style.left = `${clientX + TOAST_OFFSET_PX}px`;
  toastEl.style.top = `${clientY + TOAST_OFFSET_PX}px`;
  toastEl.setAttribute("data-visible", "true");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toastEl.setAttribute("data-visible", "false");
  }, TOAST_DURATION_MS);
}

function createCopyMenuState(): CopyMenuState {
  const menuEl = document.createElement("div");
  menuEl.className = "text-copy-menu";
  menuEl.style.display = "none";
  document.body.appendChild(menuEl);

  const toastEl = document.createElement("div");
  toastEl.className = "text-copy-toast";
  document.body.appendChild(toastEl);

  const dismiss = () => {
    menuEl.style.display = "none";
    menuEl.innerHTML = "";
  };

  const onMouseDown = () => dismiss();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      dismiss();
    }
  };

  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("keydown", onKeyDown);

  const state: CopyMenuState = {
    menuEl,
    toastEl,
    dismiss,
    toastTimer: 0 as never,
  };

  return state;
}

function destroyCopyMenuState(state: CopyMenuState): void {
  state.dismiss();
  state.menuEl.remove();
  state.toastEl.remove();
}

// ---------------------------------------------------------------------------
// Main setup
// ---------------------------------------------------------------------------

/** Connect event effects and inspection to the mouse sample SVG. */
export function setupMouseEvents(
  svgContainer: HTMLElement,
  ir: IR,
  index: IRHitIndex,
  display: EventEffectOverlayDisplayOptions,
  onInspectChange: (source: IRSourceRef | null) => void,
): InspectHoverHandle {
  const svgEl = svgContainer.querySelector("svg") as SVGSVGElement | null;
  if (!svgEl) {
    return { cleanup: () => {}, highlight: () => {}, updateDisplay: () => {} };
  }

  const binding = bindIRToSvg(svgEl, index.sourceIndex);
  function handlersFor(source: IRSourceRef): HandlersRef | undefined {
    const node = index.sourceIndex.sources.get(source.sourceIndex)?.node;
    return node?.ownership.role === "source" ? node.ownership.on : undefined;
  }
  function primaryType(source: IRSourceRef) {
    const info = index.sourceIndex.sources.get(source.sourceIndex);
    return info?.primaryNodeIndex === null || info?.primaryNodeIndex === undefined
      ? undefined
      : index.sourceIndex.nodes.get(info.primaryNodeIndex)?.node.type;
  }
  const textMap = buildTextMap(ir, index.sourceIndex);
  let lastHovered: IRSourceRef | null = null;
  const hoverEl = getElement("event-log-hover");

  // Event effect overlay (constructor wraps <svg> in a tight position:relative container)
  const bboxMap = buildNodeBBoxMap(ir);
  const overlay = new EventEffectOverlay({
    container: svgContainer,
    width: ir.width,
    height: ir.height,
    bboxMap,
    display,
  });

  // Text copy menu state
  const copyMenuState = createCopyMenuState();

  const resolveHit = (e: MouseEvent | PointerEvent): IRSourceRef | null => {
    const { x, y } = getSvgCoords(svgEl, e);
    const candidates = index.queryCandidates(x, y);
    for (const candidate of nativePathCandidates(binding, index, {
      clientX: e.clientX,
      clientY: e.clientY,
      x,
      y,
    })) {
      if (!candidates.some((entry) => entry.source === candidate.source)) {
        candidates.push(candidate);
      }
    }
    candidates.sort((left, right) => right.order - left.order);
    return resolveHitTarget(binding, candidates, e.clientX, e.clientY);
  };

  /** Resolve text node for context menu, falling through group wrappers. */
  const resolveTextTarget = (e: MouseEvent | PointerEvent): IRSourceRef | null => {
    const { x, y } = getSvgCoords(svgEl, e);
    const candidates = index.queryCandidates(x, y);
    for (const candidate of nativePathCandidates(binding, index, {
      clientX: e.clientX,
      clientY: e.clientY,
      x,
      y,
    })) {
      if (!candidates.some((entry) => entry.source === candidate.source)) {
        candidates.push(candidate);
      }
    }
    candidates.sort((left, right) => right.order - left.order);
    const resolved = resolveHitTarget(binding, candidates, e.clientX, e.clientY);

    const resolvedType = resolved ? primaryType(resolved) : undefined;
    if (resolvedType === "text") {
      return resolved;
    }
    // Non-text leaf: don't fall through
    if (resolvedType !== undefined) {
      return null;
    }
    // Group wrapper: find first text leaf in candidates
    for (const candidate of candidates) {
      if (primaryType(candidate.source) === "text") {
        return candidate.source;
      }
    }
    return null;
  };

  /** Fire a log entry + visual effect if handler exists on the hit node. */
  function fireIfHandler(
    source: IRSourceRef,
    eventKey: keyof HandlersRef,
    logName: string,
    x: number,
    y: number,
  ): void {
    const irHandlers = handlersFor(source);
    if (irHandlers?.[eventKey]) {
      addEventLogEntry(logName, source.nodeId, x, y);
      if (FLASH_EVENTS.has(logName)) {
        overlay.flashNode(source, EVENT_COLORS[logName] ?? "#fff");
      }
    }
  }

  const onClick = (e: MouseEvent) => {
    const source = resolveHit(e);
    if (source) {
      const { x, y } = getSvgCoords(svgEl, e);
      const irHandlers = handlersFor(source);
      if (irHandlers?.onClick) {
        if (irHandlers.onClick === "github-open") {
          window.open("https://github.com/zakideee/boundsvg", "_blank", "noopener,noreferrer");
        }
        addEventLogEntry("click", source.nodeId, x, y);
        overlay.flashNode(source, EVENT_COLORS.click ?? "#22d3ee");
      }
    }
  };

  const onDblClick = (e: MouseEvent) => {
    const source = resolveHit(e);
    if (source) {
      const { x, y } = getSvgCoords(svgEl, e);
      fireIfHandler(source, "onDoubleClick", "dblclick", x, y);
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const source = resolveHit(e);

    // User-defined onContextMenu handler takes priority
    if (source) {
      const irHandlers = handlersFor(source);
      if (irHandlers?.onContextMenu) {
        const { x, y } = getSvgCoords(svgEl, e);
        addEventLogEntry("contextMenu", source.nodeId, x, y);
        if (FLASH_EVENTS.has("contextMenu")) {
          overlay.flashNode(source, EVENT_COLORS.contextMenu ?? "#fff");
        }
        return;
      }
    }

    // Text copy menu
    const textSource = resolveTextTarget(e);
    if (!textSource) {
      return;
    }

    // Check text node doesn't have its own onContextMenu
    const textHandlers = handlersFor(textSource);
    if (textHandlers?.onContextMenu) {
      const { x, y } = getSvgCoords(svgEl, e);
      addEventLogEntry("contextMenu", textSource.nodeId, x, y);
      return;
    }

    const { x: svgX, y: svgY } = getSvgCoords(svgEl, e);
    const items = buildCopyMenuItems(textMap, textSource, svgX, svgY);
    if (items.length > 0) {
      showCopyMenu(copyMenuState, e.clientX, e.clientY, items);
    }
  };

  // -----------------------------------------------------------------------
  // Touch events (onTouchStart/End/Move) are fired via Pointer Events.
  //
  // Known issue: Native TouchEvent (touchstart/touchmove/touchend) does not
  // reliably fire on real mobile browsers for SVG elements. Browsers may
  // silently fire touchcancel, and touchmove may stop after the first event.
  // This is a known cross-browser issue; modern libraries (D3, Konva,
  // @use-gesture) all default to Pointer Events for this reason.
  //
  // PointerEvent.pointerType === "touch" identifies touch-originated events.
  // -----------------------------------------------------------------------

  const onPointerDown = (e: PointerEvent) => {
    const source = resolveHit(e);
    if (source) {
      const { x, y } = getSvgCoords(svgEl, e);
      fireIfHandler(source, "onPointerDown", "pointerDown", x, y);
      if (e.pointerType === "touch") {
        fireIfHandler(source, "onTouchStart", "touchStart", x, y);
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const source = resolveHit(e);
    if (source) {
      const { x, y } = getSvgCoords(svgEl, e);
      fireIfHandler(source, "onPointerUp", "pointerUp", x, y);
      if (e.pointerType === "touch") {
        fireIfHandler(source, "onTouchEnd", "touchEnd", x, y);
      }
    }
  };

  const onMouseDown = (e: MouseEvent) => {
    const source = resolveHit(e);
    if (source) {
      const { x, y } = getSvgCoords(svgEl, e);
      fireIfHandler(source, "onMouseDown", "mouseDown", x, y);
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    const source = resolveHit(e);
    if (source) {
      const { x, y } = getSvgCoords(svgEl, e);
      fireIfHandler(source, "onMouseUp", "mouseUp", x, y);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    const source = resolveHit(e);
    const { x, y } = getSvgCoords(svgEl, e);

    // Hover transition: fire enter/leave + over/out for both pointer and mouse
    if (source !== lastHovered) {
      if (lastHovered) {
        fireIfHandler(lastHovered, "onPointerLeave", "pointerLeave", x, y);
        fireIfHandler(lastHovered, "onPointerOut", "pointerOut", x, y);
        fireIfHandler(lastHovered, "onMouseLeave", "mouseLeave", x, y);
        fireIfHandler(lastHovered, "onMouseOut", "mouseOut", x, y);
      }
      lastHovered = source;
      if (source) {
        fireIfHandler(source, "onPointerEnter", "pointerEnter", x, y);
        fireIfHandler(source, "onPointerOver", "pointerOver", x, y);
        fireIfHandler(source, "onMouseEnter", "mouseEnter", x, y);
        fireIfHandler(source, "onMouseOver", "mouseOver", x, y);
      }
      overlay.setHoverGlow(source);
      overlay.setInspectHighlight(source);
      onInspectChange(source);
      hoverEl.textContent = source?.nodeId ?? "none";
    }

    // Continuous move handlers
    if (source) {
      fireIfHandler(source, "onPointerMove", "pointerMove", x, y);
      fireIfHandler(source, "onMouseMove", "mouseMove", x, y);
    }
  };

  // Touch-originated move: uses pointermove to detect pointerType
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch") {
      return; // mouse/pen handled by onMouseMove
    }
    const source = resolveHit(e);
    if (source) {
      const { x, y } = getSvgCoords(svgEl, e);
      fireIfHandler(source, "onTouchMove", "touchMove", x, y);
    }
  };

  const onMouseLeave = () => {
    if (lastHovered) {
      fireIfHandler(lastHovered, "onPointerLeave", "pointerLeave", 0, 0);
      fireIfHandler(lastHovered, "onPointerOut", "pointerOut", 0, 0);
      fireIfHandler(lastHovered, "onMouseLeave", "mouseLeave", 0, 0);
      fireIfHandler(lastHovered, "onMouseOut", "mouseOut", 0, 0);
      lastHovered = null;
      overlay.setHoverGlow(null);
      overlay.setInspectHighlight(null);
      onInspectChange(null);
      hoverEl.textContent = "none";
    }
  };

  svgEl.addEventListener("click", onClick);
  svgEl.addEventListener("dblclick", onDblClick);
  svgEl.addEventListener("contextmenu", onContextMenu);
  svgEl.addEventListener("pointerdown", onPointerDown);
  svgEl.addEventListener("pointerup", onPointerUp);
  svgEl.addEventListener("pointermove", onPointerMove);
  svgEl.addEventListener("mousedown", onMouseDown);
  svgEl.addEventListener("mouseup", onMouseUp);
  svgEl.addEventListener("mousemove", onMouseMove);
  svgEl.addEventListener("mouseleave", onMouseLeave);
  svgEl.style.cursor = "pointer";
  svgEl.style.touchAction = "none";
  svgEl.style.userSelect = "none";
  svgEl.style.setProperty("-webkit-user-select", "none");

  const cleanup = (): void => {
    overlay.destroy();
    destroyCopyMenuState(copyMenuState);
    svgEl.removeEventListener("click", onClick);
    svgEl.removeEventListener("dblclick", onDblClick);
    svgEl.removeEventListener("contextmenu", onContextMenu);
    svgEl.removeEventListener("pointerdown", onPointerDown);
    svgEl.removeEventListener("pointerup", onPointerUp);
    svgEl.removeEventListener("pointermove", onPointerMove);
    svgEl.removeEventListener("mousedown", onMouseDown);
    svgEl.removeEventListener("mouseup", onMouseUp);
    svgEl.removeEventListener("mousemove", onMouseMove);
    svgEl.removeEventListener("mouseleave", onMouseLeave);
    svgEl.style.cursor = "";
    svgEl.style.touchAction = "";
    svgEl.style.userSelect = "";
    svgEl.style.setProperty("-webkit-user-select", "");
  };
  return {
    cleanup,
    highlight: (source) => overlay.setInspectHighlight(source),
    updateDisplay: (nextDisplay) => overlay.updateDisplay(nextDisplay),
  };
}
