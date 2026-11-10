import {
  bindIRToSvg,
  createSvgInteractionController,
  type EventCallback,
} from "@boundsvg/browser/events";
import {
  buildTextMap,
  findLineAtPoint,
  getAllText,
  getAncestorText,
  getNodeText,
  type IR,
  type IRSourceIndex,
  type IRSourceRef,
  type SvgPoint,
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

function addEventLogEntry(event: string, nodeId: string, point: SvgPoint | null): void {
  const logEl = getElement("event-log-entries");
  const date = new Date();
  const time = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
  const color = EVENT_COLORS[event] ?? "var(--muted)";
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span style="color:var(--muted)">${time}</span><span style="color:${color}">${event}</span><span style="color:var(--accent)">${nodeId}</span><span style="color:var(--muted)">(${point ? Math.round(point.svgX) : "?"}, ${point ? Math.round(point.svgY) : "?"})</span>`;
  logEl.prepend(entry);
  // Keep max 30 entries
  while (logEl.children.length > 30 && logEl.lastChild) {
    logEl.removeChild(logEl.lastChild);
  }
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
  point: SvgPoint | null,
): Array<{ label: string; text: string }> {
  const items: Array<{ label: string; text: string }> = [];

  const lineEntry = point ? findLineAtPoint(textMap, textSource, point) : null;
  if (lineEntry) {
    items.push({ label: `Copy line: ${truncate(lineEntry.text, 24)}`, text: lineEntry.text });
  }

  const nodeText = getNodeText(textMap, textSource);
  if (nodeText) {
    items.push({ label: `Copy text: ${truncate(nodeText, 24)}`, text: nodeText });
  }

  const ancestorText = getAncestorText(textMap, textSource);
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
  dispose: () => void;
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
    dispose() {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    },
    toastTimer: 0 as never,
  };

  return state;
}

function destroyCopyMenuState(state: CopyMenuState): void {
  state.dismiss();
  state.dispose();
  clearTimeout(state.toastTimer);
  state.menuEl.remove();
  state.toastEl.remove();
}

// ---------------------------------------------------------------------------
// Main setup
// ---------------------------------------------------------------------------

/** Connect the sample to the same current-scene controller used by React. */
export function setupMouseEvents(
  svgContainer: HTMLElement,
  ir: IR,
  sourceIndex: IRSourceIndex,
  display: EventEffectOverlayDisplayOptions,
  onInspectChange: (source: IRSourceRef | null) => void,
  renderMode: "static" | "animated",
): InspectHoverHandle {
  const roots = [...svgContainer.querySelectorAll("svg")].filter(
    (root) => root.ownerSVGElement === null,
  );
  const root = roots.length === 1 ? roots[0] : null;
  const textMap = buildTextMap(sourceIndex);
  const hoverEl = getElement("event-log-hover");
  const overlay = new EventEffectOverlay({
    container: svgContainer,
    width: ir.width,
    height: ir.height,
    bboxMap: buildNodeBBoxMap(ir),
    display,
  });
  const copyMenuState = createCopyMenuState();
  const handlers = new Map<string, EventCallback>();
  for (const info of sourceIndex.sources.values()) {
    if (info.node.ownership.role !== "source") {
      continue;
    }
    for (const [eventKey, reference] of Object.entries(info.node.ownership.on ?? {})) {
      if (handlers.has(reference)) {
        continue;
      }
      const logName =
        eventKey === "onDoubleClick"
          ? "dblclick"
          : eventKey.slice(2, 3).toLowerCase() + eventKey.slice(3);
      handlers.set(reference, (callbackInfo) => {
        if (reference === "github-open" && callbackInfo.cause === "input") {
          window.open("https://github.com/zakideee/boundsvg", "_blank", "noopener,noreferrer");
        }
        addEventLogEntry(logName, callbackInfo.nodeId, callbackInfo.point);
        if (FLASH_EVENTS.has(logName)) {
          overlay.flashNode(callbackInfo.source, EVENT_COLORS[logName] ?? "#fff");
        }
      });
    }
  }
  const controller = createSvgInteractionController(svgContainer);
  controller.setScene({
    binding: root ? bindIRToSvg(root, sourceIndex) : null,
    renderMode,
    handlers,
    textMap,
    enableTextCopy: true,
    onHoverState(hover) {
      const source = hover.status === "ready" ? hover.source : null;
      overlay.setHoverGlow(source);
      overlay.setInspectHighlight(source);
      onInspectChange(source);
      hoverEl.textContent = hover.status === "ready" ? (source?.nodeId ?? "none") : hover.status;
    },
    onTextContextMenu(hit) {
      const items = buildCopyMenuItems(textMap, hit.source, hit.point);
      if (items.length) {
        showCopyMenu(copyMenuState, hit.clientX, hit.clientY, items);
      }
    },
  });
  return {
    cleanup() {
      controller.dispose();
      overlay.destroy();
      destroyCopyMenuState(copyMenuState);
    },
    highlight: (source) => overlay.setInspectHighlight(source),
    updateDisplay: (nextDisplay) => overlay.updateDisplay(nextDisplay),
  };
}
