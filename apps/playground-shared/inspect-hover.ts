/**
 * Shared inspect-on-hover setup for playground apps.
 *
 * Attaches mousemove/mouseleave listeners to a rendered SVG container and
 * shows the transformed inspection quad for the element under the cursor via
 * EventEffectOverlay.setInspectHighlight(). Callers can select other geometry.
 *
 * Callers inject their snapshot hit test. The shared presentation imports the
 * Browser result type only; it does not own a second live query implementation.
 */

import type { SvgHitQueryResult } from "@boundsvg/browser/events";
import type { IR, IRSourceRef } from "@boundsvg/core/scene";
import {
  buildNodeBBoxMap,
  EventEffectOverlay,
  type EventEffectOverlayDisplayOptions,
} from "./event-effects.js";

export type { EventEffectOverlayDisplayOptions } from "./event-effects.js";

/**
 * A function that hit-tests the rendered SVG at the given client coordinates
 * and returns snapshot containment separately from coordinate failures.
 */
export type InspectHitTestFn = (
  svgEl: SVGSVGElement,
  clientX: number,
  clientY: number,
) => SvgHitQueryResult;

/**
 * Handle returned by `setupInspectHover`.
 * Provides both cleanup and programmatic highlight (for code→SVG direction).
 */
export type InspectHoverHandle = {
  /** Remove listeners and destroy the overlay. */
  cleanup: () => void;
  /** Programmatically highlight a node (or clear with `null`). */
  highlight: (source: IRSourceRef | null) => void;
  /** Change display without replacing the SVG or resetting the selected node. */
  updateDisplay: (display?: EventEffectOverlayDisplayOptions) => void;
};

/**
 * Set up inspect-on-hover with transformed quads by default.
 *
 * @param container - The DOM element containing the rendered `<svg>`.
 * @param ir - The IR tree returned by `engine.renderToSvgAndIR()`.
 * @param hitTest - Hit-test function that resolves a source from client coords.
 * @param onHoverChange - Optional callback fired when the hovered source occurrence changes.
 * @returns A handle with `cleanup()` and `highlight(source)` methods.
 */
export function setupInspectHover(
  container: HTMLElement,
  ir: IR,
  hitTest: InspectHitTestFn,
  onHoverChange?: (source: IRSourceRef | null) => void,
  display?: EventEffectOverlayDisplayOptions,
): InspectHoverHandle {
  const noop: InspectHoverHandle = {
    cleanup: () => {},
    highlight: () => {},
    updateDisplay: () => {},
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

  let lastInspected: IRSourceRef | null = null;
  let hasCoordinateFailure = false;

  const onMouseMove = (e: MouseEvent): void => {
    const query = hitTest(svgEl, e.clientX, e.clientY);
    if (query.status !== "ready") {
      hasCoordinateFailure = true;
      overlay.setInspectHighlight(null);
      return;
    }
    const source = query.hit;
    if (hasCoordinateFailure || source !== lastInspected) {
      hasCoordinateFailure = false;
      lastInspected = source;
      overlay.setInspectHighlight(source);
      onHoverChange?.(source);
    }
  };

  const onMouseLeave = (): void => {
    hasCoordinateFailure = false;
    if (lastInspected) {
      lastInspected = null;
      overlay.setInspectHighlight(null);
      onHoverChange?.(null);
    }
  };

  svgEl.addEventListener("mousemove", onMouseMove);
  svgEl.addEventListener("mouseleave", onMouseLeave);

  return {
    updateDisplay: (nextDisplay) => overlay.updateDisplay(nextDisplay),
    cleanup: () => {
      overlay.destroy();
      svgEl.removeEventListener("mousemove", onMouseMove);
      svgEl.removeEventListener("mouseleave", onMouseLeave);
    },
    highlight: (source: IRSourceRef | null) => {
      hasCoordinateFailure = false;
      if (source !== lastInspected) {
        lastInspected = source;
        overlay.setInspectHighlight(source);
      }
    },
  };
}
