import type { DebugOverlayPart, Engine, RenderOptions, VNode } from "@boundsvg/react";
import { useRenderToSvg } from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveDebugOverlayConfig } from "../../lib/debug-overlay";
import type { HitResult } from "./obstacle-types";
import { useDrag } from "./use-drag";

type Props<T> = {
  initialObstacles: T;
  hitTest: (x: number, y: number, obstacles: T) => HitResult | null;
  applyDrag: (obstacles: T, section: string, x: number, y: number) => T;
  buildVNode: (engine: Engine, obstacles: T) => VNode;
  debugOverlayParts: readonly DebugOverlayPart[];
  onVNodeChange?: (vnode: VNode | null) => void;
};

export function FlowCanvas<T>({
  initialObstacles,
  hitTest,
  applyDrag,
  buildVNode,
  debugOverlayParts,
  onVNodeChange,
}: Props<T>) {
  const { engine } = useBoundSvg();
  const [obstacles, setObstacles] = useState<T>(initialObstacles);

  // Mutable ref keeps obstacles in sync for drag without React re-renders.
  const obstaclesRef = useRef<T>(obstacles);
  obstaclesRef.current = obstacles;

  const vnode = useMemo(() => {
    if (!engine) {
      return null;
    }
    return buildVNode(engine, obstacles);
  }, [engine, obstacles, buildVNode]);

  const renderOptions = useMemo<RenderOptions>(
    () => ({ debug: resolveDebugOverlayConfig(debugOverlayParts), textPathMode: "merged" }),
    [debugOverlayParts],
  );
  const { svg } = useRenderToSvg(vnode, renderOptions);

  useEffect(() => {
    onVNodeChange?.(vnode);
  }, [vnode, onVNodeChange]);

  // Refs for direct render during drag — avoids React re-render cycle.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderOptionsRef = useRef(renderOptions);
  renderOptionsRef.current = renderOptions;
  const buildVNodeRef = useRef(buildVNode);
  buildVNodeRef.current = buildVNode;

  // Called on each RAF frame during drag — bypasses React, writes to DOM directly.
  const onDragFrame = useCallback(
    (newObstacles: T) => {
      if (!engine) {
        return;
      }
      const vnode = buildVNodeRef.current(engine, newObstacles);
      const svgStr = engine.renderToSvg(vnode, renderOptionsRef.current);
      const container = containerRef.current;
      if (container) {
        container.innerHTML = svgStr;
      }
    },
    [engine],
  );

  // Called on pointerup — syncs mutable ref back to React state.
  const onDragEnd = useCallback((finalObstacles: T) => {
    setObstacles(finalObstacles);
  }, []);

  useDrag({
    containerRef,
    obstaclesRef,
    hitTest,
    applyDrag,
    onDragFrame,
    onDragEnd,
  });

  const reset = () => setObstacles(initialObstacles);

  return (
    <div className="text-flow-canvas-wrapper">
      <div className="text-flow-canvas-toolbar">
        <button type="button" className="text-flow-reset-btn" onClick={reset}>
          Reset obstacles
        </button>
      </div>
      <div
        ref={containerRef}
        className="text-flow-canvas"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    </div>
  );
}
