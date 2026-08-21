import type { RenderOptions } from "@boundsvg/core";
import { useLayoutEffect, useRef } from "react";

type StructuralComparisonState = {
  leftToRight: WeakMap<object, object>;
  rightToLeft: WeakMap<object, object>;
};

type WarningCallback = NonNullable<RenderOptions["onWarning"]>;
type PngResolutionAdjustedCallback = NonNullable<RenderOptions["onPngResolutionAdjusted"]>;
type RenderOptionCallbacks = Pick<RenderOptions, "onWarning" | "onPngResolutionAdjusted">;
type StableRenderOptionCallbacks = {
  onWarning: WarningCallback;
  onPngResolutionAdjusted: PngResolutionAdjustedCallback;
};

function areStructurallyEqual(
  leftValue: unknown,
  rightValue: unknown,
  comparisonState?: StructuralComparisonState,
): boolean {
  if (Object.is(leftValue, rightValue)) {
    return true;
  }
  if (
    typeof leftValue !== "object" ||
    leftValue === null ||
    typeof rightValue !== "object" ||
    rightValue === null
  ) {
    return false;
  }

  const activeComparisonState = comparisonState ?? {
    leftToRight: new WeakMap(),
    rightToLeft: new WeakMap(),
  };
  const mappedRightValue = activeComparisonState.leftToRight.get(leftValue);
  if (mappedRightValue !== undefined) {
    return mappedRightValue === rightValue;
  }
  const mappedLeftValue = activeComparisonState.rightToLeft.get(rightValue);
  if (mappedLeftValue !== undefined) {
    return mappedLeftValue === leftValue;
  }

  const leftIsArray = Array.isArray(leftValue);
  if (leftIsArray !== Array.isArray(rightValue)) {
    return false;
  }
  if (!leftIsArray) {
    const leftPrototype = Object.getPrototypeOf(leftValue);
    const rightPrototype = Object.getPrototypeOf(rightValue);
    if (
      leftPrototype !== rightPrototype ||
      (leftPrototype !== Object.prototype && leftPrototype !== null)
    ) {
      return false;
    }
  }

  activeComparisonState.leftToRight.set(leftValue, rightValue);
  activeComparisonState.rightToLeft.set(rightValue, leftValue);

  const leftKeys = Object.keys(leftValue);
  const rightKeys = Object.keys(rightValue);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightValue, key)) {
      return false;
    }
    if (
      !areStructurallyEqual(
        Reflect.get(leftValue, key),
        Reflect.get(rightValue, key),
        activeComparisonState,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function useStructurallyStableValue<T>(value: T): T {
  const stableValueRef = useRef(value);
  // This render-phase write may conservatively restart after an abandoned render,
  // but it cannot hide a supported structural value change.
  if (!areStructurallyEqual(stableValueRef.current, value)) {
    stableValueRef.current = value;
  }
  return stableValueRef.current;
}

function replaceOwnRenderCallbacks<O extends object>(
  options: O | undefined,
  stableCallbacks: StableRenderOptionCallbacks,
): O | undefined {
  if (!options) {
    return undefined;
  }
  const hasOnWarning = Object.hasOwn(options, "onWarning");
  const hasOnPngResolutionAdjusted = Object.hasOwn(options, "onPngResolutionAdjusted");
  if (!hasOnWarning && !hasOnPngResolutionAdjusted) {
    return options;
  }

  const normalizedOptions = { ...options } as O & RenderOptionCallbacks;
  if (hasOnWarning) {
    normalizedOptions.onWarning = stableCallbacks.onWarning;
  }
  if (hasOnPngResolutionAdjusted) {
    normalizedOptions.onPngResolutionAdjusted = stableCallbacks.onPngResolutionAdjusted;
  }
  return normalizedOptions;
}

export function useStructurallyStableRenderOptions<O extends object>(
  options: O | undefined,
): O | undefined {
  const currentCallbacks = options as (O & RenderOptionCallbacks) | undefined;
  const latestCallbacksRef = useRef<RenderOptionCallbacks>({});
  useLayoutEffect(() => {
    latestCallbacksRef.current = {
      onWarning: currentCallbacks?.onWarning,
      onPngResolutionAdjusted: currentCallbacks?.onPngResolutionAdjusted,
    };
  });

  const stableCallbacksRef = useRef<StableRenderOptionCallbacks | null>(null);
  stableCallbacksRef.current ??= {
    onWarning: (warning) => latestCallbacksRef.current.onWarning?.(warning),
    onPngResolutionAdjusted: (warning) =>
      latestCallbacksRef.current.onPngResolutionAdjusted?.(warning),
  };

  const normalizedOptions = replaceOwnRenderCallbacks(options, stableCallbacksRef.current);
  return useStructurallyStableValue(normalizedOptions);
}
