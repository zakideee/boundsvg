import type { DebugOverlayPart, RenderOptions, VNode } from "@boundsvg/react";
import { useRenderToSvg } from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import { useEffect, useMemo } from "react";
import { resolveDebugOverlayConfig } from "../../lib/debug-overlay";

type Props = {
  buildVNode: () => VNode;
  debugOverlayParts: readonly DebugOverlayPart[];
  onVNodeChange?: (vnode: VNode | null) => void;
};

/** Renders a non-interactive Text Flow preset with the standard debug overlays. */
export function StaticFlowCanvas({ buildVNode, debugOverlayParts, onVNodeChange }: Props) {
  const { engine } = useBoundSvg();
  const vnode = useMemo(() => (engine ? buildVNode() : null), [engine, buildVNode]);
  const renderOptions = useMemo<RenderOptions>(
    () => ({ debug: resolveDebugOverlayConfig(debugOverlayParts), textPathMode: "merged" }),
    [debugOverlayParts],
  );
  const { svg } = useRenderToSvg(vnode, renderOptions);

  useEffect(() => {
    onVNodeChange?.(vnode);
  }, [vnode, onVNodeChange]);

  return (
    <div className="text-flow-canvas-wrapper">
      <div
        className="text-flow-canvas"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    </div>
  );
}
