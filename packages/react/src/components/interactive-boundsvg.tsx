import type { IR, RenderAnimatedSvgOptions, RenderSvgOptions, VNode } from "@boundsvg/core";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type TextContextMenuHit,
  type UseInteractiveSvgOptions,
  useInteractiveSvg,
} from "../hooks/use-interactive-svg.js";
import type { TextCopyMenuInfo } from "../hooks/use-text-copy.js";
import { useTextCopy } from "../hooks/use-text-copy.js";
import type { EventCallback } from "../types.js";
import { toInteractiveVNodeFromChildren } from "../utils/to-interactive-vnode.js";

/** Font size used by the default visible render failure message. */
const ERROR_FONT_SIZE_PX = 12;

/** Scene input, event callbacks, and loading/error presentation shared across render modes. */
type InteractiveBoundSvgBaseProps = {
  // Scene input
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
  // Interaction and presentation
  /** CSS class name for the wrapper div */
  className?: string;
  /** Whether to show pointer cursor on interactive elements (default: true) */
  showPointerCursor?: boolean;
  /** Notify committed logical-target changes; canonical ref replacement and pending do not emit it. */
  onHoverChange?: (source: import("@boundsvg/core/scene").IRSourceRef | null) => void;
  /** Callback when rendering completes, providing the IR for advanced consumers */
  onRender?: (ir: IR) => void;
  // Text actions
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
  // Loading and errors
  /** Fallback UI shown while engine is loading */
  fallback?: ReactNode;
  /** Fallback UI shown when rendering fails */
  errorFallback?: ReactNode | ((error: Error) => ReactNode);
};

/** Interactive display input with either static sampling or authored SVG animation playback. */
export type InteractiveBoundSvgProps = InteractiveBoundSvgBaseProps &
  (
    | { renderMode?: "static"; renderOptions?: RenderSvgOptions }
    | { renderMode: "animated"; renderOptions: RenderAnimatedSvgOptions }
  );

/** Stable handler map for explicit scenes without registered callbacks. */
const EMPTY_HANDLERS = new Map<string, EventCallback>();

/** Preserve caught Error identities while normalizing other thrown values for display. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Display an SVG with hit-tested events and optional text-copy actions on the main engine. */
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

  const options: UseInteractiveSvgOptions =
    renderMode === "animated"
      ? {
          renderMode,
          renderOptions: renderOptions as RenderAnimatedSvgOptions,
          showPointerCursor,
          onHoverChange,
          enableTextCopy,
          onTextContextMenu: handleTextContextMenu,
        }
      : {
          renderMode,
          renderOptions: renderOptions as RenderSvgOptions | undefined,
          showPointerCursor,
          onHoverChange,
          enableTextCopy,
          onTextContextMenu: handleTextContextMenu,
        };

  const { svg, ir, textMap, error, isReady, containerRef } = useInteractiveSvg(
    resolved.vnode,
    resolved.handlers,
    options,
  );

  // Hover and callback updates must not reinsert an unchanged SVG document.
  const svgMarkup = useMemo(() => ({ __html: svg ?? "" }), [svg]);

  const textCopy = useTextCopy(textMap);

  // The controller retains this render's callback and matching TextMap across reentrant commits.
  function handleTextContextMenu(hit: TextContextMenuHit): void {
    onTextCopyMenu?.(textCopy.buildMenuInfo(hit));
  }

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

  return <div ref={containerRef} className={className} dangerouslySetInnerHTML={svgMarkup} />;
}
