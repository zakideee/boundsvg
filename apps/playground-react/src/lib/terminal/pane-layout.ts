import type { ResolvedTerminalPaneLayout, TerminalPaneLayoutInput } from "./types";

const DEFAULT_SPLIT_DIRECTION: "row" | "column" = "row";
const DEFAULT_GAP_PX = 14;
const DEFAULT_WEIGHT = 1;

function sanitizeWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WEIGHT;
  }
  return value;
}

function sanitizeGap(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_GAP_PX;
  }
  return Math.floor(value);
}

function splitMajorAxis(
  majorSize: number,
  sourceWeight: number,
  outputWeight: number,
): { sourceMajor: number; outputMajor: number } {
  const totalWeight = sourceWeight + outputWeight;
  const sourceRatio = sourceWeight / totalWeight;
  const sourceMajor = Math.max(1, Math.min(majorSize - 1, Math.round(majorSize * sourceRatio)));
  const outputMajor = Math.max(1, majorSize - sourceMajor);
  return { sourceMajor, outputMajor };
}

export function resolveTerminalPaneLayout(
  contentWidth: number,
  contentHeight: number,
  layout?: TerminalPaneLayoutInput,
): ResolvedTerminalPaneLayout {
  const splitDirection = layout?.splitDirection ?? DEFAULT_SPLIT_DIRECTION;
  const gapPx = sanitizeGap(layout?.gapPx);
  const sourceWeight = sanitizeWeight(layout?.sourceWeight);
  const outputWeight = sanitizeWeight(layout?.outputWeight);

  if (splitDirection === "column") {
    const availableMajor = Math.max(2, contentHeight - gapPx);
    const split = splitMajorAxis(availableMajor, sourceWeight, outputWeight);
    return {
      splitDirection,
      gapPx,
      source: { width: contentWidth, height: split.sourceMajor },
      output: { width: contentWidth, height: split.outputMajor },
    };
  }

  const availableMajor = Math.max(2, contentWidth - gapPx);
  const split = splitMajorAxis(availableMajor, sourceWeight, outputWeight);
  return {
    splitDirection,
    gapPx,
    source: { width: split.sourceMajor, height: contentHeight },
    output: { width: split.outputMajor, height: contentHeight },
  };
}
