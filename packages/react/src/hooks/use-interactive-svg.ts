import {
  bindIRToSvg,
  createSvgInteractionController,
  type IRDomBinding,
  type SvgHoverState,
  type SvgInteractionController,
  type TextContextMenuHit,
} from "@boundsvg/browser/events";
import type { IR, RenderAnimatedSvgOptions, RenderSvgOptions, VNode } from "@boundsvg/core";
import {
  buildIRSourceIndex,
  buildTextMap,
  type IRSourceIndex,
  type IRSourceRef,
  type TextMap,
} from "@boundsvg/core/scene";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EventCallback, RenderInputOptions } from "../types.js";
import { resolveMainThreadEngineError } from "../utils/main-thread-only.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./use-commit-phase-render-notifications.js";
import { useRenderInput } from "./use-render-input.js";
import { useStructurallyStableRenderOptions } from "./use-structurally-stable-value.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { TextContextMenuHit } from "@boundsvg/browser/events";

/** Cursor and text-copy behavior independent of the selected document family. */
type InteractiveBehaviorOptions = {
  /** Whether to show cursor:pointer on interactive elements (default: true) */
  showPointerCursor?: boolean;
  /** Notify committed logical target changes; canonical ref updates do not repeat it. */
  onHoverChange?: (source: IRSourceRef | null) => void;
  /** When true, right-click on text nodes fires onTextContextMenu instead of browser default */
  enableTextCopy?: boolean;
  /** Callback fired when a text node is right-clicked (requires enableTextCopy) */
  onTextContextMenu?: (hit: TextContextMenuHit) => void;
};

/** Interactive behavior and input revision with either static sampling or declarative SVG playback. */
export type UseInteractiveSvgOptions = InteractiveBehaviorOptions &
  RenderInputOptions &
  (
    | {
        /** Static sampled SVG is the default interactive document family. */
        renderMode?: "static";
        renderOptions?: RenderSvgOptions;
      }
    | {
        /** Preserve authored tracks in the interactive SVG document. */
        renderMode: "animated";
        renderOptions: RenderAnimatedSvgOptions;
      }
  );

/** Rendered SVG and inspection data with hover state and a container attachment callback. */
export type UseInteractiveSvgResult = {
  /** Rendered SVG string (null while engine is not ready or on error) */
  svg: string | null;
  /** Full IR for advanced consumers (null while not ready) */
  ir: IR | null;
  /** Text structure map for text copy features (null while not ready) */
  textMap: TextMap | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether the engine is ready and rendering succeeded */
  isReady: boolean;
  /** Committed hover for this IR, including pending and query failures. */
  hover: SvgHoverState;
  /** Ref callback to attach to the container div */
  containerRef: (node: HTMLDivElement | null) => void;
};

// ---------------------------------------------------------------------------
// Internal render artifacts
// ---------------------------------------------------------------------------

/** One render revision's matching SVG, IR and immutable source/text lookup maps. */
type RenderArtifacts = {
  svg: string | null;
  ir: IR | null;
  sourceIndex: IRSourceIndex | null;
  textMap: TextMap | null;
  error: Error | null;
  isReady: boolean;
};

/** Empty interactive render state shared before a successful main-thread render. */
const EMPTY_ARTIFACTS: RenderArtifacts = {
  svg: null,
  ir: null,
  sourceIndex: null,
  textMap: null,
  error: null,
  isReady: false,
};

/** Render state plus notifications delivered only after that revision commits. */
type InteractiveRenderComputation = {
  artifacts: RenderArtifacts;
  deliveries: readonly RenderNotificationDelivery[];
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Render through the Provider's main-thread Engine and attach hit-tested pointer handlers to the returned container ref. */
export function useInteractiveSvg(
  vnode: VNode | null,
  handlers: Map<string, EventCallback>,
  options?: UseInteractiveSvgOptions,
): UseInteractiveSvgResult {
  const { engine, workerEngine, status, defaultCommonOptions } = useBoundSvg();
  const renderInput = useRenderInput(vnode, engine, options);
  const stableRenderOptions = useStructurallyStableRenderOptions(options?.renderOptions);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);
  const renderMode = options?.renderMode ?? "static";
  const [committedHover, setCommittedHover] = useState<{ ir: IR | null; hover: SvgHoverState }>({
    ir: null,
    hover: { status: "inactive" },
  });

  // Memoize render artifacts — uses engine.renderToSvgAndIR() for single layout pass
  const computation = useMemo<InteractiveRenderComputation>(() => {
    if (status !== "ready" || !engine || !renderInput.vnode) {
      const error = resolveMainThreadEngineError("useInteractiveSvg", {
        status,
        engine,
        workerEngine,
      });
      return {
        artifacts: error ? { ...EMPTY_ARTIFACTS, error } : EMPTY_ARTIFACTS,
        deliveries: NO_RENDER_NOTIFICATION_DELIVERIES,
      };
    }
    const mergedOptions = {
      ...stableDefaultCommonOptions,
      ...stableRenderOptions,
      nodeIdMetadata: "include" as const,
    };
    const captured = captureRenderNotifications(mergedOptions);
    try {
      const { svg, ir } =
        renderMode === "animated"
          ? engine.renderToAnimatedSvgAndIR(
              renderInput.vnode,
              captured.options as RenderAnimatedSvgOptions,
            )
          : engine.renderToSvgAndIR(renderInput.vnode, captured.options as RenderSvgOptions);
      const sourceIndex = buildIRSourceIndex(ir);
      const textMap = buildTextMap(sourceIndex);
      return {
        artifacts: {
          svg,
          ir,
          sourceIndex,
          textMap,
          error: null,
          isReady: true,
        },
        deliveries: [captured.delivery],
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        artifacts: { ...EMPTY_ARTIFACTS, error },
        deliveries: [captured.delivery],
      };
    }
  }, [
    engine,
    workerEngine,
    status,
    renderInput,
    stableRenderOptions,
    stableDefaultCommonOptions,
    renderMode,
  ]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  const artifacts = computation.artifacts;
  // Handler-only commits share the IR's projection receiver instead of feeding state back into it.
  const onHoverState = useMemo(() => {
    const ir = artifacts.ir;
    return (hover: SvgHoverState): void => {
      setCommittedHover((previous) =>
        previous.ir === ir && sameHoverState(previous.hover, hover) ? previous : { ir, hover },
      );
    };
  }, [artifacts.ir]);

  const controllerRef = useRef<SvgInteractionController | null>(null);
  const bindingRef = useRef<IRDomBinding | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // The attachment ends with the actual node, including replacement and React 18 unmount.
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    controllerRef.current?.dispose();
    controllerRef.current = node ? createSvgInteractionController(node) : null;
    bindingRef.current = null;
    setContainerEl(node);
  }, []);

  // A caller may replace its SVG during any commit, even with unchanged render artifacts.
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !containerEl) {
      return;
    }
    if (!artifacts.isReady || !artifacts.sourceIndex || !artifacts.ir) {
      controller.setScene(null);
      return;
    }
    const roots = [...containerEl.querySelectorAll("svg")].filter(
      (root) => root.ownerSVGElement === null,
    );
    const root = roots.length === 1 ? roots[0] : null;
    let binding = bindingRef.current;
    if (!root) {
      binding = null;
    } else if (binding?.root !== root || binding.sourceIndex !== artifacts.sourceIndex) {
      binding = bindIRToSvg(root, artifacts.sourceIndex);
    }
    bindingRef.current = binding;
    controller.setScene({
      binding,
      renderMode,
      handlers,
      textMap: artifacts.textMap,
      showPointerCursor: options?.showPointerCursor,
      enableTextCopy: options?.enableTextCopy,
      onTextContextMenu: options?.onTextContextMenu,
      onHoverChange: options?.onHoverChange,
      onHoverState,
    });
  });

  return {
    svg: artifacts.svg,
    ir: artifacts.ir,
    textMap: artifacts.textMap,
    error: artifacts.error,
    isReady: artifacts.isReady,
    hover:
      committedHover.ir === artifacts.ir
        ? committedHover.hover
        : { status: artifacts.isReady ? "pending" : "inactive" },
    containerRef,
  };
}

/** Compare only the public projection; scene correspondence remains controller-owned. */
function sameHoverState(previous: SvgHoverState, next: SvgHoverState): boolean {
  if (previous.status !== next.status) {
    return false;
  }
  if (previous.status === "ready" && next.status === "ready") {
    return previous.source === next.source;
  }
  if ("reason" in previous && "reason" in next) {
    return previous.reason === next.reason;
  }
  return true;
}
