/**
 * JLREQ regression snapshot tool.
 *
 * This compares logical boundtext output, not browser output. A changed
 * snapshot is review-required whether the change is an improvement or a
 * regression.
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type SpecCase = {
  id: string;
  category?: string;
  description?: string;
  request: Record<string, unknown>;
};

type CliWarning = {
  code: string;
  message: string;
  fallback?: string;
};

type CliGlyph = {
  glyph_id: number;
  cluster: number;
  text?: string;
  cluster_start?: number;
  cluster_end?: number;
  x_advance: number;
  y_advance: number;
  x_offset: number;
  y_offset: number;
  font_family?: string;
  font_size_px?: number;
  fill?: string;
  origin_x?: number;
  origin_y?: number;
  rotation_deg?: number;
  outline_writing_mode?: string;
  absolute_position?: boolean;
};

type CliLine = {
  index: number;
  text: string;
  start_grapheme: number;
  end_grapheme: number;
  width: number;
  baseline_y: number;
  glyphs?: CliGlyph[];
};

type CliResult = {
  id: string;
  category?: string;
  status: string;
  error?: string;
  result?: {
    chosen_font_size_px: number;
    bbox: { x: number; y: number; w: number; h: number };
    overflow: { type: string; reason?: string };
    warnings?: CliWarning[];
    line_count: number;
    column_count: number;
    break_indices: number[];
    ellipsis_index?: number;
    kinsoku_violations: Array<{
      line_index: number;
      violation_type: string;
      character: string;
      position: string;
    }>;
    rotated_glyph_count?: number;
    lines: CliLine[];
  };
};

type Snapshot = {
  schema: "boundsvg-jlreq-layout-snapshot-v1";
  cases: SnapshotCase[];
};

type SnapshotCase = {
  id: string;
  category?: string;
  description?: string;
  request_hash: string;
  request: {
    font_family?: string;
    font_size_px?: number;
    max_width?: number;
    max_height?: number;
    writing_mode?: string;
    language?: string;
    wrap?: string;
  };
  logical: {
    status: string;
    chosen_font_size_px?: number;
    bbox?: { x: number; y: number; w: number; h: number };
    overflow?: { type: string; reason?: string };
    warnings: string[];
    line_count?: number;
    column_count?: number;
    break_indices?: number[];
    ellipsis_index?: number;
    kinsoku_violations?: number;
    rotated_glyph_count?: number;
  };
  lines: Array<{
    index: number;
    text: string;
    start_grapheme: number;
    end_grapheme: number;
    width: number;
    baseline_y: number;
  }>;
  glyphs: Array<{
    line_index: number;
    glyph_index: number;
    text?: string;
    glyph_id: number;
    cluster_start?: number;
    cluster_end?: number;
    font_family?: string;
    font_size_px?: number;
    origin_x?: number;
    origin_y?: number;
    x_advance: number;
    y_advance: number;
    x_offset: number;
    y_offset: number;
    rotation_deg?: number;
    outline_writing_mode?: string;
    absolute_position?: boolean;
    fill?: string;
  }>;
};

type AcceptManifest = {
  schema: "boundsvg-jlreq-baseline-update-v1";
  classification: string;
  reason: string;
  cases: string[];
};

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseFlags(rest);

  switch (command) {
    case "snapshot":
      runSnapshot(args);
      break;
    case "compare":
      runCompare(args);
      break;
    case "accept":
      runAccept(args);
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

function runSnapshot(args: Map<string, string>): void {
  const specPath = required(args, "spec");
  const resultsPath = required(args, "results");
  const outPath = required(args, "out");
  const specs = readJson<SpecCase[]>(specPath);
  const results = readJson<CliResult[]>(resultsPath);
  const resultMap = new Map(results.map((result) => [result.id, result]));

  const snapshot: Snapshot = {
    schema: "boundsvg-jlreq-layout-snapshot-v1",
    cases: specs.map((spec) => normalizeCase(spec, resultMap.get(spec.id))),
  };

  writeJson(outPath, snapshot);
  console.info(`snapshot: ${snapshot.cases.length} cases -> ${outPath}`);
}

function runCompare(args: Map<string, string>): void {
  const baseline = readJson<Snapshot>(required(args, "baseline"));
  const current = readJson<Snapshot>(required(args, "current"));
  assertSnapshotSchema(baseline);
  assertSnapshotSchema(current);

  const baselineMap = new Map(baseline.cases.map((entry) => [entry.id, entry]));
  const currentMap = new Map(current.cases.map((entry) => [entry.id, entry]));
  const allIds = [...new Set([...baselineMap.keys(), ...currentMap.keys()])].sort();
  const changed: string[] = [];

  for (const id of allIds) {
    const before = baselineMap.get(id);
    const after = currentMap.get(id);
    if (stableStringify(before) !== stableStringify(after)) {
      changed.push(id);
    }
  }

  if (changed.length === 0) {
    console.info(`JLREQ layout snapshot stable (${current.cases.length} cases)`);
    return;
  }

  console.error(`JLREQ layout snapshot changed (${changed.length} cases):`);
  for (const id of changed) {
    console.error(`  - ${id}`);
  }
  process.exit(1);
}

function runAccept(args: Map<string, string>): void {
  const currentPath = required(args, "current");
  const baselinePath = required(args, "baseline");
  const manifestPath = required(args, "manifest");
  const classification = required(args, "classification");
  const reason = required(args, "reason");
  const current = readJson<Snapshot>(currentPath);
  assertSnapshotSchema(current);

  mkdirSync(dirname(resolve(baselinePath)), { recursive: true });
  copyFileSync(currentPath, baselinePath);

  const manifest: AcceptManifest = {
    schema: "boundsvg-jlreq-baseline-update-v1",
    classification,
    reason,
    cases: current.cases.map((entry) => entry.id),
  };
  writeJson(manifestPath, manifest);
  console.info(`accepted ${current.cases.length} cases -> ${baselinePath}`);
}

function normalizeCase(spec: SpecCase, result: CliResult | undefined): SnapshotCase {
  const req = spec.request;
  const normalized: SnapshotCase = {
    id: spec.id,
    category: spec.category,
    description: spec.description,
    request_hash: hashRequest(req),
    request: {
      font_family: stringValue(req.font_family),
      font_size_px: numberValue(req.font_size_px),
      max_width: numberValue(req.max_width),
      max_height: numberValue(req.max_height),
      writing_mode: stringValue(req.writing_mode),
      language: stringValue(req.language),
      wrap: stringValue(req.wrap),
    },
    logical: {
      status: result?.status ?? "missing",
      warnings: [],
    },
    lines: [],
    glyphs: [],
  };

  if (!result?.result) {
    return normalized;
  }

  const layout = result.result;
  normalized.logical = {
    status: result.status,
    chosen_font_size_px: round(layout.chosen_font_size_px),
    bbox: {
      x: round(layout.bbox.x),
      y: round(layout.bbox.y),
      w: round(layout.bbox.w),
      h: round(layout.bbox.h),
    },
    overflow: layout.overflow,
    warnings: (layout.warnings ?? []).map((warning) => warning.code).sort(),
    line_count: layout.line_count,
    column_count: layout.column_count,
    break_indices: layout.break_indices,
    ellipsis_index: layout.ellipsis_index,
    kinsoku_violations: layout.kinsoku_violations.length,
    rotated_glyph_count: layout.rotated_glyph_count ?? 0,
  };
  normalized.lines = layout.lines.map((line) => ({
    index: line.index,
    text: line.text,
    start_grapheme: line.start_grapheme,
    end_grapheme: line.end_grapheme,
    width: round(line.width),
    baseline_y: round(line.baseline_y),
  }));
  normalized.glyphs = layout.lines.flatMap((line) =>
    (line.glyphs ?? []).map((glyph, glyphIndex) => ({
      line_index: line.index,
      glyph_index: glyphIndex,
      text: glyph.text,
      glyph_id: glyph.glyph_id,
      cluster_start: glyph.cluster_start,
      cluster_end: glyph.cluster_end,
      font_family: glyph.font_family,
      font_size_px: optionalRound(glyph.font_size_px),
      origin_x: optionalRound(glyph.origin_x),
      origin_y: optionalRound(glyph.origin_y),
      x_advance: round(glyph.x_advance),
      y_advance: round(glyph.y_advance),
      x_offset: round(glyph.x_offset),
      y_offset: round(glyph.y_offset),
      rotation_deg: glyph.rotation_deg,
      outline_writing_mode: glyph.outline_writing_mode,
      absolute_position: glyph.absolute_position,
      fill: glyph.fill,
    })),
  );
  return normalized;
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    flags.set(key.slice(2), args[index + 1] ?? "");
    index++;
  }
  return flags;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
  const outPath = resolve(path);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function assertSnapshotSchema(snapshot: Snapshot): void {
  if (snapshot.schema !== "boundsvg-jlreq-layout-snapshot-v1") {
    throw new Error(`Unsupported snapshot schema: ${snapshot.schema}`);
  }
}

function hashRequest(request: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(stableStringify(request)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function optionalRound(value: number | undefined): number | undefined {
  return value === undefined ? undefined : round(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function printUsage(): void {
  console.error(`Usage:
  tsx src/run.ts snapshot --spec cases.json --results boundtext.json --out current.json
  tsx src/run.ts compare --baseline baseline.json --current current.json
  tsx src/run.ts accept --current current.json --baseline baseline.json --manifest update.json --classification intended-improvement --reason "..."
`);
}

main();
