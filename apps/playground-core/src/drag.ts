import { createPngObjectUrl, revokePngObjectUrl, translateSvgCoords } from "@boundsvg/browser";
import type { Engine } from "@boundsvg/core";
import type { IR } from "@boundsvg/core/scene";
import { getElement } from "../../playground-shared/dom.js";
import { flowObstacles, flowRichObstacles } from "./obstacle-state";
import { presets } from "./presets/index";
import { coreState, resolveDebugOverlayConfig } from "./state";
import type { DragTarget, HitResult } from "./types";

function getSvgPoint(svgEl: Element, e: PointerEvent): { x: number; y: number } {
  const svg = svgEl.querySelector("svg") ?? svgEl;
  if (svg instanceof SVGSVGElement) {
    const result = translateSvgCoords(svg, e.clientX, e.clientY);
    if (result) {
      return result;
    }
  }
  const rect = svgEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function hitCircle(
  x: number,
  y: number,
  circle: { cx: number; cy: number; r: number },
  section: string,
): HitResult | null {
  if ((x - circle.cx) ** 2 + (y - circle.cy) ** 2 <= circle.r ** 2) {
    return { section, offsetX: x - circle.cx, offsetY: y - circle.cy };
  }
  return null;
}

function hitRect(
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
  section: string,
): HitResult | null {
  if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
    return { section, offsetX: x - r.x, offsetY: y - r.y };
  }
  return null;
}

function hitTestObstacle(x: number, y: number, preset: string): HitResult | null {
  if (preset === "text-flow") {
    const obstacles = flowObstacles;
    return (
      hitRect(x, y, obstacles.left.rect, "left-rect") ??
      hitCircle(x, y, obstacles.left.circ, "left-circ") ??
      hitRect(x, y, obstacles.right.rect, "right-rect")
    );
  }
  if (preset === "flow-rich") {
    const obstacles = flowRichObstacles;
    return (
      hitCircle(x, y, obstacles.rich, "rich-circ") ??
      hitRect(x, y, obstacles.vertical, "vert-rect") ??
      hitRect(x, y, obstacles.ruby, "ruby-rect")
    );
  }
  return null;
}

function applyDrag(target: DragTarget, x: number, y: number): void {
  const nx = x - target.offsetX;
  const ny = y - target.offsetY;
  if (target.preset === "text-flow") {
    const obstacles = flowObstacles;
    if (target.section === "left-rect") {
      obstacles.left.rect.x = nx;
      obstacles.left.rect.y = ny;
    } else if (target.section === "left-circ") {
      obstacles.left.circ.cx = nx;
      obstacles.left.circ.cy = ny;
    } else if (target.section === "right-rect") {
      obstacles.right.rect.x = nx;
      obstacles.right.rect.y = ny;
    }
  }
  if (target.preset === "flow-rich") {
    const obstacles = flowRichObstacles;
    if (target.section === "rich-circ") {
      obstacles.rich.cx = nx;
      obstacles.rich.cy = ny;
    } else if (target.section === "vert-rect") {
      obstacles.vertical.x = nx;
      obstacles.vertical.y = ny;
    } else if (target.section === "ruby-rect") {
      obstacles.ruby.x = nx;
      obstacles.ruby.y = ny;
    }
  }
}

export function setupFlowDrag(
  container: HTMLElement,
  presetKey: string,
  engine: Engine,
  onPostRender?: (ir: IR) => void,
): () => void {
  let dragTarget: DragTarget | null = null;
  let rafId = 0;
  let pendingPt: { x: number; y: number } | null = null;

  const rerenderInPlace = (): void => {
    const preset = presets[presetKey];
    if (!preset) {
      return;
    }
    const vnode = preset.build(engine);
    const { svg, ir } = engine.renderToSvgAndIR(vnode, {
      debug: resolveDebugOverlayConfig(),
      textPathMode: coreState.textPathMode,
      showMissingGlyphs: true,
    });
    coreState.cachedSvgString = svg;
    container.innerHTML = svg;
    onPostRender?.(ir);
  };

  const flushDrag = (): void => {
    rafId = 0;
    if (!pendingPt || !dragTarget) {
      return;
    }
    applyDrag(dragTarget, pendingPt.x, pendingPt.y);
    pendingPt = null;
    rerenderInPlace();
  };

  const onDown = (e: PointerEvent): void => {
    const pt = getSvgPoint(container, e);
    const hit = hitTestObstacle(pt.x, pt.y, presetKey);
    if (hit) {
      dragTarget = { preset: presetKey, ...hit };
      container.setPointerCapture(e.pointerId);
      container.style.cursor = "grabbing";
      e.preventDefault();
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (!dragTarget) {
      const pt = getSvgPoint(container, e);
      const hit = hitTestObstacle(pt.x, pt.y, presetKey);
      container.style.cursor = hit ? "grab" : "";
      return;
    }
    e.preventDefault();
    pendingPt = getSvgPoint(container, e);
    if (!rafId) {
      rafId = requestAnimationFrame(flushDrag);
    }
  };

  const rerenderPng = (): void => {
    const preset = presets[presetKey];
    if (!preset) {
      return;
    }
    const vnode = preset.build(engine);
    // Same options as the initial render, `showMissingGlyphs` included, so
    // the panel keeps its tofu boxes after a drag and matches the download.
    const pngOpts = {
      debug: resolveDebugOverlayConfig(),
      textPathMode: coreState.textPathMode,
      showMissingGlyphs: true,
      ...(coreState.pngScale > 1 && { scale: coreState.pngScale }),
    };
    const pngBytes = engine.renderToPng(vnode, pngOpts);
    const url = createPngObjectUrl(pngBytes);
    const pngOutput = getElement("png-output");
    const existingImg = pngOutput.querySelector("img");
    if (existingImg) {
      const oldUrl = existingImg.src;
      existingImg.src = url;
      existingImg.alt = preset.title;
      revokePngObjectUrl(oldUrl);
    } else {
      const img = document.createElement("img");
      img.src = url;
      img.alt = preset.title;
      pngOutput.appendChild(img);
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (dragTarget) {
      if (pendingPt) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        applyDrag(dragTarget, pendingPt.x, pendingPt.y);
        pendingPt = null;
        rerenderInPlace();
      }
      container.releasePointerCapture(e.pointerId);
      rerenderPng();
    }
    dragTarget = null;
    container.style.cursor = "";
  };

  container.addEventListener("pointerdown", onDown);
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerup", onUp);
  container.addEventListener("pointercancel", onUp);

  return () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    container.removeEventListener("pointerdown", onDown);
    container.removeEventListener("pointermove", onMove);
    container.removeEventListener("pointerup", onUp);
    container.removeEventListener("pointercancel", onUp);
    container.style.cursor = "";
  };
}
