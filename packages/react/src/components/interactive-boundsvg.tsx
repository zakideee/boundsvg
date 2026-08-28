import type { IR, RenderAnimatedSvgOptions, RenderSvgOptions, VNode } from "@boundsvg/core";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type TextContextMenuHit,
  type UseInteractiveSvgOptions,
  useInteractiveSvg,
} from "../hooks/use-interactive-svg.js";
import type { TextCopyMenuInfo } from "../hooks/use-text-copy.js";
import { useTextCopy } from "../hooks/use-text-copy.js";
import type { EventCallback } from "../types.js";
import { toInteractiveVNodeFromChildren } from "../utils/to-interactive-vnode.js";

const ERROR_FONT_SIZE_PX = 12;

type InteractiveBoundSvgBaseProps = {
  /** VNode tree to render (explicit mode) */
  vnode?: VNode | null;
  /**
   * Handler map for explicit VNode mode.
   * Maps handler ID strings (from VNode onClick etc.) → callback functions.
   */
  handlers?: Map<string, EventCallback>;
  /** Canvas width (declarative mode) */
  width?: number;
  /** Canvas height (declarative mode) */
  height?: number;
  /** Canvas background color (declarative mode) */
  background?: string;
  /** Declarative children — boundsvg phantom components with function handlers */
  children?: ReactNode;
  /** CSS class name for the wrapper div */
  className?: string;
  /** Whether to show pointer cursor on interactive elements (default: true) */
  showPointerCursor?: boolean;
  /** Callback when hover state changes */
  onHoverChange?: (nodeId: string | null) => void;
  /** Callback when rendering completes, providing the IR for advanced consumers */
  onRender?: (ir: IR) => void;
  /**
   * Enable text copy feature. When true, right-clicking on a text node
   * (without a user-defined onContextMenu handler) fires `onTextCopyMenu`.
   */
  enableTextCopy?: boolean;
  /**
   * Called when a text node is right-clicked and text copy is enabled.
   * The consumer is responsible for rendering their own context menu UI.
   */
  onTextCopyMenu?: (info: TextCopyMenuInfo) => void;
  /** Fallback UI shown while engine is loading */
  fallback?: ReactNode;
  /** Fallback UI shown when rendering fails */
  errorFallback?: ReactNode | ((error: Error) => ReactNode);
};

export type InteractiveBoundSvgProps = InteractiveBoundSvgBaseProps &
  (
    | { renderMode?: "static"; renderOptions?: RenderSvgOptions }
    | { renderMode: "animated"; renderOptions: RenderAnimatedSvgOptions }
  );

const EMPTY_HANDLERS = new Map<string, EventCallback>();

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function InteractiveBoundSvg({
  vnode,
  handlers: explicitHandlers,
  width,
  height,
  background,
  children,
  renderMode,
  renderOptions,
  className,
  showPointerCursor,
  onHoverChange,
  onRender,
  enableTextCopy,
  onTextCopyMenu,
  fallback,
  errorFallback,
}: InteractiveBoundSvgProps) {
  // Resolve VNode and handlers from either mode
  const resolved = useMemo(() => {
    try {
      // Explicit VNode mode
      if (vnode !== undefined) {
        return {
          vnode,
          handlers: explicitHandlers ?? EMPTY_HANDLERS,
          error: null,
        };
      }
      // Declarative JSX mode
      if (width != null && height != null && children != null) {
        const result = toInteractiveVNodeFromChildren({ width, height, background }, children);
        return { vnode: result.vnode, handlers: result.handlers, error: null };
      }
      return { vnode: null, handlers: EMPTY_HANDLERS, error: null };
    } catch (error) {
      return {
        vnode: null,
        handlers: EMPTY_HANDLERS,
        error: toError(error),
      };
    }
  }, [vnode, explicitHandlers, width, height, background, children]);

  // Text copy hook — always called (hooks cannot be conditional)
  const textCopyRef = useRef<ReturnType<typeof useTextCopy> | null>(null);
  const onTextCopyMenuRef = useRef(onTextCopyMenu);
  useLayoutEffect(() => {
    onTextCopyMenuRef.current = onTextCopyMenu;
  }, [onTextCopyMenu]);

  // Bridge: hook's onTextContextMenu → build menu info → fire onTextCopyMenu
  const handleTextContextMenu = useCallback((hit: TextContextMenuHit) => {
    if (!onTextCopyMenuRef.current || !textCopyRef.current) {
      return;
    }
    const menuInfo = textCopyRef.current.buildMenuInfo({
      nodeId: hit.nodeId,
      svgX: hit.svgX,
      svgY: hit.svgY,
      clientX: hit.clientX,
      clientY: hit.clientY,
    });
    onTextCopyMenuRef.current(menuInfo);
  }, []);

  const options: UseInteractiveSvgOptions = useMemo(
    () =>
      renderMode === "animated"
        ? {
            renderMode,
            renderOptions: renderOptions as RenderAnimatedSvgOptions,
            showPointerCursor,
            enableTextCopy,
            onTextContextMenu: handleTextContextMenu,
          }
        : {
            renderMode,
            renderOptions: renderOptions as RenderSvgOptions | undefined,
            showPointerCursor,
            enableTextCopy,
            onTextContextMenu: handleTextContextMenu,
          },
    [renderMode, renderOptions, showPointerCursor, enableTextCopy, handleTextContextMenu],
  );

  const { svg, ir, textMap, error, isReady, hoverNodeId, containerRef } = useInteractiveSvg(
    resolved.vnode,
    resolved.handlers,
    options,
  );

  const textCopy = useTextCopy(ir, textMap);
  useLayoutEffect(() => {
    textCopyRef.current = textCopy;
  }, [textCopy]);

  // Fire onRender callback when IR changes
  const onRenderRef = useRef(onRender);
  useLayoutEffect(() => {
    onRenderRef.current = onRender;
  }, [onRender]);
  useEffect(() => {
    if (ir && onRenderRef.current) {
      onRenderRef.current(ir);
    }
  }, [ir]);

  // Fire onHoverChange callback when hover changes
  const prevHoverRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onHoverChange || hoverNodeId === prevHoverRef.current) {
      return;
    }
    prevHoverRef.current = hoverNodeId;
    onHoverChange(hoverNodeId);
  }, [hoverNodeId, onHoverChange]);

  // Error state
  if (resolved.error != null || error != null) {
    const resolvedError = resolved.error ?? error ?? new Error("Unknown render error");
    if (typeof errorFallback === "function") {
      return <>{errorFallback(resolvedError)}</>;
    }
    if (errorFallback != null) {
      return <>{errorFallback}</>;
    }
    return (
      <div role="alert" style={{ color: "#b91c1c", fontSize: ERROR_FONT_SIZE_PX }}>
        Render failed: {resolvedError.message}
      </div>
    );
  }

  // Loading state
  if (!isReady || !svg) {
    return <>{fallback ?? null}</>;
  }

  return <div ref={containerRef} className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
