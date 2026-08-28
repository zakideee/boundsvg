import { createPngObjectUrl, pngToDataUrl, revokePngObjectUrl } from "@boundsvg/browser/png";
import type {
  CompiledScene,
  CompileOptions,
  EmitPngOptions,
  EmitSvgOptions,
  VNode,
} from "@boundsvg/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBoundSvg } from "./hooks/use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./hooks/use-commit-phase-render-notifications.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./hooks/use-structurally-stable-value.js";
import { resolveMainThreadEngineError } from "./utils/main-thread-only.js";
import { pickCompileOptions, pickOutputCommonOptions } from "./utils/render-options.js";

export type UseCompiledSceneResult = {
  compiled: CompiledScene | null;
  error: Error | null;
  isReady: boolean;
};

export type UseRenderAssetOptions = {
  compileOptions?: CompileOptions;
  svgOptions?: EmitSvgOptions;
  pngOptions?: EmitPngOptions;
};

export type UseRenderAssetResult = {
  compiled: CompiledScene | null;
  svg: string | null;
  png: Uint8Array | null;
  dataUrl: string | null;
  error: Error | null;
  isReady: boolean;
};

type AssetRenderComputation = {
  result: UseRenderAssetResult;
  deliveries: readonly RenderNotificationDelivery[];
};

function arePngBytesEqual(leftPng: Uint8Array | null, rightPng: Uint8Array | null): boolean {
  if (leftPng === rightPng) {
    return true;
  }
  if (!leftPng || !rightPng || leftPng.length !== rightPng.length) {
    return false;
  }
  for (let byteIndex = 0; byteIndex < leftPng.length; byteIndex += 1) {
    if (leftPng[byteIndex] !== rightPng[byteIndex]) {
      return false;
    }
  }
  return true;
}

function useStablePngBytes(png: Uint8Array | null): Uint8Array | null {
  const stablePngRef = useRef(png);
  if (!arePngBytesEqual(stablePngRef.current, png)) {
    stablePngRef.current = png;
  }
  return stablePngRef.current;
}

/**
 * Create and clean up an object URL for PNG bytes rendered by boundsvg.
 */
export function usePngObjectUrl(png: Uint8Array | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const stablePng = useStablePngBytes(png);

  useEffect(() => {
    if (!stablePng) {
      setUrl(null);
      return;
    }

    const nextUrl = createPngObjectUrl(stablePng);
    setUrl(nextUrl);
    return () => {
      revokePngObjectUrl(nextUrl);
    };
  }, [stablePng]);

  return url;
}

/**
 * Compile a VNode with the Provider engine so multiple assets can share one IR.
 */
export function useCompiledScene(
  vnode: VNode | null,
  options?: CompileOptions,
): UseCompiledSceneResult {
  const { engine, workerEngine, status, defaultCommonOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableOptions = useStructurallyStableValue(options);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);

  return useMemo(() => {
    if (status !== "ready" || !engine || !stableVNode) {
      const error = resolveMainThreadEngineError("useCompiledScene", {
        status,
        engine,
        workerEngine,
      });
      return { compiled: null, error, isReady: false };
    }
    try {
      const compileOptions = {
        ...pickCompileOptions(stableDefaultCommonOptions),
        ...stableOptions,
      };
      const compiled = engine.compile(stableVNode, compileOptions);
      return { compiled, error: null, isReady: true };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { compiled: null, error, isReady: false };
    }
  }, [engine, workerEngine, status, stableVNode, stableOptions, stableDefaultCommonOptions]);
}

/**
 * Render SVG, PNG bytes, and a PNG data URL from one compiled scene.
 */
export function useRenderAsset(
  vnode: VNode | null,
  options?: UseRenderAssetOptions,
): UseRenderAssetResult {
  const { engine, workerEngine, status, defaultCommonOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableCompileOptions = useStructurallyStableValue(options?.compileOptions);
  const stableSvgOptions = useStructurallyStableRenderOptions(options?.svgOptions);
  const stablePngOptions = useStructurallyStableRenderOptions(options?.pngOptions);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);

  const computation = useMemo<AssetRenderComputation>(() => {
    if (status !== "ready" || !engine || !stableVNode) {
      const error = resolveMainThreadEngineError("useRenderAsset", {
        status,
        engine,
        workerEngine,
      });
      return {
        result: {
          compiled: null,
          svg: null,
          png: null,
          dataUrl: null,
          error,
          isReady: false,
        },
        deliveries: NO_RENDER_NOTIFICATION_DELIVERIES,
      };
    }

    const outputCommonOptions = pickOutputCommonOptions(stableDefaultCommonOptions);
    const svgOptions: EmitSvgOptions = { ...outputCommonOptions, ...stableSvgOptions };
    const pngOptions: EmitPngOptions = { ...outputCommonOptions, ...stablePngOptions };
    const capturedSvg = captureRenderNotifications(svgOptions);
    const capturedPng = captureRenderNotifications(pngOptions);
    try {
      const compileOptions = {
        ...pickCompileOptions(stableDefaultCommonOptions),
        ...stableCompileOptions,
      };
      const compiled = engine.compile(stableVNode, compileOptions);
      const svg = engine.renderCompiledToSvg(compiled, capturedSvg.options);
      const png = engine.renderCompiledToPng(compiled, capturedPng.options);
      return {
        result: {
          compiled,
          svg,
          png,
          dataUrl: pngToDataUrl(png),
          error: null,
          isReady: true,
        },
        deliveries: [capturedSvg.delivery, capturedPng.delivery],
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        result: {
          compiled: null,
          svg: null,
          png: null,
          dataUrl: null,
          error,
          isReady: false,
        },
        deliveries: [capturedSvg.delivery, capturedPng.delivery],
      };
    }
  }, [
    engine,
    workerEngine,
    status,
    stableVNode,
    stableCompileOptions,
    stableSvgOptions,
    stablePngOptions,
    stableDefaultCommonOptions,
  ]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  return computation.result;
}
