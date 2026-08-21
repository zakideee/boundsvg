/** Used height measured from the flow-box origin, matching the engine DTO. */
export function horizontalFlowCrossExtent(
  result: {
    lines: Array<{ crossSize: number; fragments: Array<{ y: number }> }>;
  },
  flowBoxY: number,
): number {
  if (result.lines.length === 0) {
    return 0;
  }
  const lineBottoms = result.lines.flatMap((line) =>
    line.fragments.slice(0, 1).map(({ y }) => y + line.crossSize),
  );
  if (lineBottoms.length === 0) {
    return 0;
  }
  return Math.max(0, Math.max(...lineBottoms) - flowBoxY);
}
