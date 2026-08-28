import type { RenderAnimatedSvgOptions, RenderSvgOptions, VNode } from "@boundsvg/core";
import { type ReactNode, useMemo } from "react";
import { useBoundSvg } from "../hooks/use-boundsvg.js";
import { useRenderToAnimatedSvg } from "../hooks/use-render-animated-svg.js";
import { useRenderToAnimatedSvgAsync } from "../hooks/use-render-animated-svg-async.js";
import { useRenderToSvg } from "../hooks/use-render-svg.js";
import { useRenderToSvgAsync } from "../hooks/use-render-svg-async.js";
import { toVNodeFromChildren } from "../utils/to-vnode.js";

const ERROR_FONT_SIZE_PX = 12;

type BoundSvgBaseProps = {
  /** VNode tree to render (legacy API — takes precedence over children) */
  vnode?: VNode | null;

  /** Canvas width (declarative API) */
  width?: number;
  /** Canvas height (declarative API) */
  height?: number;
  /** Canvas background color (declarative API) */
  background?: string;
  /** Declarative children (boundsvg phantom components) */
  children?: ReactNode;

  /** CSS class name for the wrapper div */
  className?: string;
  /** Fallback UI shown while engine is loading */
  fallback?: ReactNode;
  /** Fallback UI shown when rendering fails */
  errorFallback?: ReactNode | ((error: Error) => ReactNode);
};

export type BoundSvgProps = BoundSvgBaseProps & {
  /** Static SVG render options. Animated scenes require an explicit `timeMs`. */
  renderOptions?: RenderSvgOptions;
};

export type AnimatedBoundSvgProps = BoundSvgBaseProps & {
  /** Declarative SVG options, including the required playback contract. */
  renderOptions: RenderAnimatedSvgOptions;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function useResolvedVNode(props: BoundSvgBaseProps): { vnode: VNode | null; error: Error | null } {
  const { vnode, width, height, background, children } = props;
  return useMemo(() => {
    try {
      if (vnode !== undefined) {
        return { vnode, error: null };
      }
      if (width != null && height != null && children != null) {
        return {
          vnode: toVNodeFromChildren({ width, height, background }, children),
          error: null,
        };
      }
      return { vnode: null, error: null };
    } catch (error) {
      return { vnode: null, error: toError(error) };
    }
  }, [vnode, width, height, background, children]);
}

function renderResult(
  svg: string | null,
  error: Error | null,
  { isReady, props }: { isReady: boolean; props: BoundSvgBaseProps },
): React.JSX.Element {
  const { className, fallback, errorFallback } = props;

  if (error) {
    if (typeof errorFallback === "function") {
      return <>{errorFallback(error)}</>;
    }
    if (errorFallback != null) {
      return <>{errorFallback}</>;
    }
    return (
      <div role="alert" style={{ color: "#b91c1c", fontSize: ERROR_FONT_SIZE_PX }}>
        Render failed: {error.message}
      </div>
    );
  }

  if (!isReady || !svg) {
    return <>{fallback ?? null}</>;
  }

  // Engine-generated SVG is trusted (no user-controlled HTML injection)
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Sync rendering via main-thread Engine */
function BoundSvgSync(props: BoundSvgProps) {
  const resolved = useResolvedVNode(props);
  const { svg, error: renderError, isReady } = useRenderToSvg(resolved.vnode, props.renderOptions);
  return renderResult(svg, resolved.error ?? renderError, { isReady, props });
}

/** Async rendering via WorkerEngine */
function BoundSvgAsync(props: BoundSvgProps) {
  const resolved = useResolvedVNode(props);
  const {
    svg,
    error: renderError,
    isReady,
  } = useRenderToSvgAsync(resolved.vnode, props.renderOptions);
  return renderResult(svg, resolved.error ?? renderError, { isReady, props });
}

/**
 * Render a VNode tree and display the resulting SVG.
 * Must be used within a `<BoundSvgProvider>`.
 *
 * Supports two modes:
 * 1. **Legacy**: `<BoundSvg vnode={vnode} />`
 * 2. **Declarative**: `<BoundSvg width={960} height={320}><Flex>...</Flex></BoundSvg>`
 *
 * Automatically selects sync (main-thread Engine) or async (WorkerEngine)
 * rendering based on the Provider configuration.
 */
export function BoundSvg(props: BoundSvgProps) {
  const { workerEngine } = useBoundSvg();
  return workerEngine ? <BoundSvgAsync {...props} /> : <BoundSvgSync {...props} />;
}

function AnimatedBoundSvgSync(props: AnimatedBoundSvgProps) {
  const resolved = useResolvedVNode(props);
  const {
    svg,
    error: renderError,
    isReady,
  } = useRenderToAnimatedSvg(resolved.vnode, props.renderOptions);
  return renderResult(svg, resolved.error ?? renderError, { isReady, props });
}

function AnimatedBoundSvgAsync(props: AnimatedBoundSvgProps) {
  const resolved = useResolvedVNode(props);
  const {
    svg,
    error: renderError,
    isReady,
  } = useRenderToAnimatedSvgAsync(resolved.vnode, props.renderOptions);
  return renderResult(svg, resolved.error ?? renderError, { isReady, props });
}

/** Render authored animation tracks as declarative animated SVG. */
export function AnimatedBoundSvg(props: AnimatedBoundSvgProps) {
  const { workerEngine } = useBoundSvg();
  return workerEngine ? <AnimatedBoundSvgAsync {...props} /> : <AnimatedBoundSvgSync {...props} />;
}
