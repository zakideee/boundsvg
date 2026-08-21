import { useCallback, useEffect, useRef, useState } from "react";
import type { HitResult } from "./obstacle-types";

type UseDragOptions<T> = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  obstaclesRef: React.RefObject<T>;
  hitTest: (x: number, y: number, obstacles: T) => HitResult | null;
  applyDrag: (obstacles: T, section: string, x: number, y: number) => T;
  /** Called on each RAF frame during drag — should render directly to DOM. */
  onDragFrame: (obstacles: T) => void;
  /** Called on pointerup — should sync obstacles back to React state. */
  onDragEnd: (obstacles: T) => void;
};

function getSvgPoint(container: HTMLElement, e: PointerEvent): { x: number; y: number } {
  const svg = container.querySelector("svg");
  if (svg instanceof SVGSVGElement) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const svgPt = pt.matrixTransform(ctm.inverse());
      return { x: svgPt.x, y: svgPt.y };
    }
  }
  const rect = container.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function useDrag<T>(options: UseDragOptions<T>): {
  isDragging: boolean;
} {
  const { containerRef } = options;
  const [isDragging, setIsDragging] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const dragStateRef = useRef<{
    section: string;
    offsetX: number;
    offsetY: number;
    pointerId: number;
  } | null>(null);
  const pendingPtRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef(0);

  const flushDrag = useCallback(() => {
    rafIdRef.current = 0;
    const drag = dragStateRef.current;
    const pt = pendingPtRef.current;
    if (!drag || !pt) {
      return;
    }
    const { obstaclesRef, applyDrag, onDragFrame } = optionsRef.current;
    const nx = pt.x - drag.offsetX;
    const ny = pt.y - drag.offsetY;
    pendingPtRef.current = null;
    const newObstacles = applyDrag(obstaclesRef.current, drag.section, nx, ny);
    obstaclesRef.current = newObstacles;
    onDragFrame(newObstacles);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: containerRef is a stable ref — .current is read at execution time, not at effect creation time
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onDown = (e: PointerEvent): void => {
      const pt = getSvgPoint(container, e);
      const obs = optionsRef.current.obstaclesRef.current;
      const hit = optionsRef.current.hitTest(pt.x, pt.y, obs);
      if (hit) {
        dragStateRef.current = {
          section: hit.section,
          offsetX: hit.offsetX,
          offsetY: hit.offsetY,
          pointerId: e.pointerId,
        };
        container.setPointerCapture(e.pointerId);
        container.style.cursor = "grabbing";
        setIsDragging(true);
        e.preventDefault();
      }
    };

    const onMove = (e: PointerEvent): void => {
      if (!dragStateRef.current) {
        const pt = getSvgPoint(container, e);
        const obs = optionsRef.current.obstaclesRef.current;
        const hit = optionsRef.current.hitTest(pt.x, pt.y, obs);
        container.style.cursor = hit ? "grab" : "";
        return;
      }
      e.preventDefault();
      pendingPtRef.current = getSvgPoint(container, e);
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(flushDrag);
      }
    };

    const onUp = (e: PointerEvent): void => {
      const drag = dragStateRef.current;
      if (drag) {
        if (pendingPtRef.current) {
          if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = 0;
          }
          const pt = pendingPtRef.current;
          const { obstaclesRef, applyDrag } = optionsRef.current;
          const nx = pt.x - drag.offsetX;
          const ny = pt.y - drag.offsetY;
          pendingPtRef.current = null;
          const newObstacles = applyDrag(obstaclesRef.current, drag.section, nx, ny);
          obstaclesRef.current = newObstacles;
        }
        container.releasePointerCapture(e.pointerId);
        optionsRef.current.onDragEnd(optionsRef.current.obstaclesRef.current);
      }
      dragStateRef.current = null;
      container.style.cursor = "";
      setIsDragging(false);
    };

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      container.style.cursor = "";
    };
  }, [flushDrag]);

  return { isDragging };
}
