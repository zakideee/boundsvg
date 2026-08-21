export type EmbeddedSvgReferenceKind = "url" | "href" | "xlink:href";

export type EmbeddedSvgIdReference = {
  id: string;
  kind: EmbeddedSvgReferenceKind;
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
  const ids = collectIds(svg);
  const duplicateIds = collectDuplicates(ids);
  const references = collectReferences(svg);
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

function collectIds(svg: string): string[] {
  const ids: string[] = [];
  const idRegex = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  for (const match of svg.matchAll(idRegex)) {
    const id = match[1] ?? match[2];
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

function collectReferences(svg: string): EmbeddedSvgIdReference[] {
  const references: EmbeddedSvgIdReference[] = [];

  const urlRegex = /url\(\s*(['"]?)#([^)'" \t\r\n]+)\1\s*\)/g;
  for (const match of svg.matchAll(urlRegex)) {
    const id = match[2];
    if (id) {
      references.push({ id, kind: "url", raw: match[0] });
    }
  }

  const hrefRegex = /\b(href|xlink:href)\s*=\s*(?:"#([^"]+)"|'#([^']+)')/g;
  for (const match of svg.matchAll(hrefRegex)) {
    const attributeName = match[1];
    const id = match[2] ?? match[3];
    if (attributeName && id) {
      references.push({
        id,
        kind: attributeName === "xlink:href" ? "xlink:href" : "href",
        raw: match[0],
      });
    }
  }

  return references;
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
