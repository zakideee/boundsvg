import {
  type ScannedEmbeddedSvgReferenceKind,
  type ScannedEmbeddedSvgReferenceSyntax,
  scanEmbeddedSvgIds,
} from "./embedded-id-scanner.js";

export type EmbeddedSvgReferenceKind = ScannedEmbeddedSvgReferenceKind;

export type EmbeddedSvgReferenceSyntax = ScannedEmbeddedSvgReferenceSyntax;

export type EmbeddedSvgIdReference = {
  id: string;
  kind: EmbeddedSvgReferenceKind;
  attribute: string;
  syntax: EmbeddedSvgReferenceSyntax;
  raw: string;
};

export type AnalyzeEmbeddedSvgIdsResult = {
  ids: string[];
  duplicateIds: string[];
  references: EmbeddedSvgIdReference[];
  unresolvedReferences: string[];
  hasPotentialCollisions: boolean;
};

export function analyzeEmbeddedSvgIds(svg: string): AnalyzeEmbeddedSvgIdsResult {
  const scan = scanEmbeddedSvgIds(svg);
  const ids = scan.ids;
  const duplicateIds = collectDuplicates(ids);
  const references = scan.references.map((reference) => ({
    id: reference.id,
    kind: reference.kind,
    attribute: reference.attribute,
    syntax: reference.syntax,
    raw: reference.raw,
  }));
  const idSet = new Set(ids);
  const unresolvedReferences = uniqueSorted(
    references.map((reference) => reference.id).filter((referenceId) => !idSet.has(referenceId)),
  );

  return {
    ids,
    duplicateIds,
    references,
    unresolvedReferences,
    hasPotentialCollisions: ids.length > 0,
  };
}

function collectDuplicates(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates].sort();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
