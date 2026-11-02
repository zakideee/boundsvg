import type { SceneInspection } from "@boundsvg/core/inspect";

/** Serialize the common scene inspection into a JSON-safe command-line report. */
export function formatInspectionJson(inspection: SceneInspection): string {
  return JSON.stringify(
    {
      stats: inspection.stats,
      nodeIds: {
        valid: inspection.nodeIds.valid,
        duplicates: inspection.nodeIds.duplicates,
        explicitIds: inspection.nodeIds.explicitIds,
        autoIds: inspection.nodeIds.autoIds,
      },
      warnings: inspection.warnings.map((warning) => ({
        name: warning.name,
        message: warning.message,
      })),
      bboxes: inspection.bboxes,
      sources: [...inspection.sourceIndex.sources.values()].map(
        ({ source, parentSourceIndex, primaryNodeIndex }) => ({
          source,
          parentSourceIndex,
          primaryNodeIndex,
        }),
      ),
    },
    null,
    2,
  );
}
