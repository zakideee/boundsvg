/**
 * Shared inspect-on-hover setup for playground apps.
 *
 * Attaches mousemove/mouseleave listeners to a rendered SVG container and
 * shows a DevTools-style highlight (semi-transparent blue fill + outline)
 * on the element under the cursor via EventEffectOverlay.setInspectHighlight().
 *
 * Hit-test logic is injected by the caller to avoid runtime imports from
 * `@boundsvg/browser` and `@boundsvg/core/scene` (playground-shared is not
 * a workspace package and cannot resolve those at build time).
 */

import type { IR } from "@boundsvg/core/scene";
import {
  buildNodeBBoxMap,
  EventEffectOverlay,
  type EventEffectOverlayDisplayOptions,
} from "./event-effects.js";

export type { EventEffectOverlayDisplayOptions } from "./event-effects.js";

/**
 * A function that hit-tests the rendered SVG at the given client coordinates
 * and returns the nodeId of the element under the cursor, or `null`.
 */
export type InspectHitTestFn = (
  svgEl: SVGSVGElement,
  clientX: number,
  clientY: number,
) => string | null;

/**
 * Handle returned by `setupInspectHover`.
 * Provides both cleanup and programmatic highlight (for code→SVG direction).
 */
export type InspectHoverHandle = {
  /** Remove listeners and destroy the overlay. */
  cleanup: () => void;
  /** Programmatically highlight a node (or clear with `null`). */
  highlight: (nodeId: string | null) => void;
};

/**
 * Set up DevTools-style inspect-on-hover for any rendered SVG.
 *
 * @param container - The DOM element containing the rendered `<svg>`.
 * @param ir - The IR tree returned by `engine.renderToSvgAndIR()`.
 * @param hitTest - Hit-test function that resolves a nodeId from client coords.
 * @param onHoverChange - Optional callback fired when the hovered nodeId changes.
 * @returns A handle with `cleanup()` and `highlight(nodeId)` methods.
 */
export function setupInspectHover(
  container: HTMLElement,
  ir: IR,
  hitTest: InspectHitTestFn,
  onHoverChange?: (nodeId: string | null) => void,
  display?: EventEffectOverlayDisplayOptions,
): InspectHoverHandle {
  const noop: InspectHoverHandle = {
    cleanup: () => {},
    highlight: () => {},
  };
  const svgEl = container.querySelector("svg") as SVGSVGElement | null;
  if (!svgEl) {
    return noop;
  }

  const bboxMap = buildNodeBBoxMap(ir);

  const overlay = new EventEffectOverlay({
    container,
    width: ir.width,
    height: ir.height,
    bboxMap,
    display,
  });

  let lastInspected: string | null = null;

  const onMouseMove = (e: MouseEvent): void => {
    const nodeId = hitTest(svgEl, e.clientX, e.clientY);

    if (nodeId !== lastInspected) {
      lastInspected = nodeId;
      overlay.setInspectHighlight(nodeId);
      onHoverChange?.(nodeId);
    }
  };

  const onMouseLeave = (): void => {
    if (lastInspected) {
      lastInspected = null;
      overlay.setInspectHighlight(null);
      onHoverChange?.(null);
    }
  };

  svgEl.addEventListener("mousemove", onMouseMove);
  svgEl.addEventListener("mouseleave", onMouseLeave);

  return {
    cleanup: () => {
      overlay.destroy();
      svgEl.removeEventListener("mousemove", onMouseMove);
      svgEl.removeEventListener("mouseleave", onMouseLeave);
    },
    highlight: (nodeId: string | null) => {
      if (nodeId !== lastInspected) {
        lastInspected = nodeId;
        overlay.setInspectHighlight(nodeId);
      }
    },
  };
}
