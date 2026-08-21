/**
 * diff-runner: validates boundtext CLI output against spec case expectations.
 *
 * Usage:
 *   tsx src/check.ts <boundtext-output.json> <spec-cases.json>
 *
 * Or pipe boundtext output:
 *   boundtext-cli --fonts ... --input spec.json | tsx src/check.ts - spec.json
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CliResult = {
  id: string;
  category?: string;
  status: string;
  error?: string;
  result?: {
    chosen_font_size_px: number;
    bbox: { x: number; y: number; w: number; h: number };
    overflow: { type: string; reason?: string };
    warnings?: Array<{
      code: string;
      message: string;
      fallback?: string;
    }>;
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
    lines: Array<{
      index: number;
      text: string;
      start_grapheme: number;
      end_grapheme: number;
      width: number;
      baseline_y: number;
      glyphs?: GlyphOutput[];
    }>;
  };
};

type GlyphOutput = {
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

type RelativePosition =
  | "above"
  | "below"
  | "left_of"
  | "right_of"
  | "same_origin_x"
  | "same_origin_y";

type GlyphAssertion = {
  text: string;
  occurrence?: number;
  font_size_px?: number;
  font_family?: string;
  fill?: string;
  rotation_deg?: number;
  outline_writing_mode?: string;
  absolute_position?: boolean;
  relative_to?: string;
  relative_occurrence?: number;
  position?: RelativePosition;
  min_delta_x?: number;
  max_delta_x?: number;
  min_delta_y?: number;
  max_delta_y?: number;
  tolerance_px?: number;
};

type SpecCase = {
  id: string;
  category?: string;
  description?: string;
  request: Record<string, unknown>;
  expected?: {
    overflow?: string;
    line_count?: number;
    break_indices?: number[];
    kinsoku_violations?: number;
    non_break_pair_violations?: number;
    forbid_line_start_chars?: string[];
    forbid_line_end_chars?: string[];
    column_count?: number;
    ends_with_ellipsis?: boolean;
    broken_grapheme?: boolean;
    chosen_font_size_px?: number;
    chosen_font_size_px_min?: number;
    chosen_font_size_px_max?: number;
    rotated_glyph_count_min?: number;
    bbox_w_max?: number;
    bbox_h_max?: number;
    warning_codes?: string[];
    glyph_assertions?: GlyphAssertion[];
    atomic_text_groups?: string[][];
  };
};

type CheckResult = {
  id: string;
  category?: string;
  status: "pass" | "fail" | "error";
  failures: string[];
};

type LocatedGlyph = {
  glyph: GlyphOutput;
  lineIndex: number;
  glyphIndex: number;
};

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation tool with many sequential checks
function checkCase(result: CliResult, spec: SpecCase): CheckResult {
  const failures: string[] = [];

  if (result.status !== "ok" || !result.result) {
    return {
      id: spec.id,
      category: spec.category,
      status: "error",
      failures: [`boundtext returned error: ${result.error ?? "unknown"}`],
    };
  }

  const r = result.result;
  const e = spec.expected;

  if (!e) {
    return { id: spec.id, category: spec.category, status: "pass", failures: [] };
  }

  // Overflow type
  if (e.overflow !== undefined) {
    if (r.overflow.type !== e.overflow) {
      failures.push(`overflow: expected "${e.overflow}", got "${r.overflow.type}"`);
    }
  }

  // Line count
  if (e.line_count !== undefined) {
    if (r.line_count !== e.line_count) {
      failures.push(`line_count: expected ${e.line_count}, got ${r.line_count}`);
    }
  }

  // Break indices
  // Note: For ellipsis + max_lines cases, boundtext only emits break_indices
  // for visible lines (it stops layout after truncation). Browser-runner reports
  // all DOM lines since -webkit-line-clamp hides overflow visually but keeps
  // the text in the DOM. The spec expected values should reflect boundtext's
  // behavior (visible-only breaks), not the browser's full break list.
  // The report-generator handles the bt-vs-browser comparison separately
  // using prefix matching (see breaksAgreeForCase in generate.ts).
  if (e.break_indices !== undefined) {
    const expected = JSON.stringify(e.break_indices);
    const actual = JSON.stringify(r.break_indices);
    if (expected !== actual) {
      failures.push(`break_indices: expected ${expected}, got ${actual}`);
    }
  }

  // Kinsoku violations count
  if (e.kinsoku_violations !== undefined) {
    if (r.kinsoku_violations.length !== e.kinsoku_violations) {
      failures.push(
        `kinsoku_violations: expected ${e.kinsoku_violations}, got ${r.kinsoku_violations.length}`,
      );
      for (const v of r.kinsoku_violations) {
        failures.push(
          `  violation: line ${v.line_index} ${v.violation_type} "${v.character}" at ${v.position}`,
        );
      }
    }
  }

  // Non-break pair violations (check if ellipsis pairs are split)
  if (e.non_break_pair_violations !== undefined) {
    const pairViolations = r.kinsoku_violations.filter(
      (v) => v.violation_type === "non_break_pair",
    );
    if (pairViolations.length !== e.non_break_pair_violations) {
      failures.push(
        `non_break_pair_violations: expected ${e.non_break_pair_violations}, got ${pairViolations.length}`,
      );
    }
  }

  // Forbidden line-start characters
  if (e.forbid_line_start_chars) {
    for (let i = 1; i < r.lines.length; i++) {
      const firstChar = r.lines[i].text.charAt(0);
      if (e.forbid_line_start_chars.includes(firstChar)) {
        failures.push(
          `line ${i} starts with forbidden char "${firstChar}" (text: "${r.lines[i].text}")`,
        );
      }
    }
  }

  // Forbidden line-end characters
  if (e.forbid_line_end_chars) {
    for (let i = 0; i < r.lines.length - 1; i++) {
      const text = r.lines[i].text;
      const lastChar = text.charAt(text.length - 1);
      if (e.forbid_line_end_chars.includes(lastChar)) {
        failures.push(`line ${i} ends with forbidden char "${lastChar}" (text: "${text}")`);
      }
    }
  }

  // Column count (vertical)
  if (e.column_count !== undefined) {
    if (r.column_count !== e.column_count) {
      failures.push(`column_count: expected ${e.column_count}, got ${r.column_count}`);
    }
  }

  // Ellipsis
  if (e.ends_with_ellipsis !== undefined) {
    const lastLine = r.lines[r.lines.length - 1];
    const endsWithEllipsis = lastLine?.text.endsWith("…") ?? false;
    if (endsWithEllipsis !== e.ends_with_ellipsis) {
      failures.push(
        `ends_with_ellipsis: expected ${e.ends_with_ellipsis}, got ${endsWithEllipsis}`,
      );
    }
  }

  // Chosen font size
  if (e.chosen_font_size_px !== undefined) {
    const diff = Math.abs(r.chosen_font_size_px - e.chosen_font_size_px);
    if (diff > 0.25) {
      failures.push(
        `chosen_font_size_px: expected ${e.chosen_font_size_px}, got ${r.chosen_font_size_px} (diff=${diff.toFixed(2)})`,
      );
    }
  }

  // Chosen font size range (for fit validation)
  if (e.chosen_font_size_px_min !== undefined) {
    if (r.chosen_font_size_px < e.chosen_font_size_px_min - 0.25) {
      failures.push(
        `chosen_font_size_px_min: expected >= ${e.chosen_font_size_px_min}, got ${r.chosen_font_size_px}`,
      );
    }
  }
  if (e.chosen_font_size_px_max !== undefined) {
    if (r.chosen_font_size_px > e.chosen_font_size_px_max + 0.25) {
      failures.push(
        `chosen_font_size_px_max: expected <= ${e.chosen_font_size_px_max}, got ${r.chosen_font_size_px}`,
      );
    }
  }

  // Rotated glyph count (for vertical validation)
  if (e.rotated_glyph_count_min !== undefined) {
    const actual = r.rotated_glyph_count ?? 0;
    if (actual < e.rotated_glyph_count_min) {
      failures.push(`rotated_glyph_count: expected >= ${e.rotated_glyph_count_min}, got ${actual}`);
    }
  }

  // Bounding box max (with 2px tolerance)
  if (e.bbox_w_max !== undefined) {
    if (r.bbox.w > e.bbox_w_max + 2) {
      failures.push(`bbox.w: expected <= ${e.bbox_w_max} (+2px tolerance), got ${r.bbox.w}`);
    }
  }
  if (e.bbox_h_max !== undefined) {
    if (r.bbox.h > e.bbox_h_max + 2) {
      failures.push(`bbox.h: expected <= ${e.bbox_h_max} (+2px tolerance), got ${r.bbox.h}`);
    }
  }

  if (e.warning_codes !== undefined) {
    const actualCodes = new Set((r.warnings ?? []).map((warning) => warning.code));
    for (const expectedCode of e.warning_codes) {
      if (!actualCodes.has(expectedCode)) {
        failures.push(
          `warning_codes: expected warning "${expectedCode}", got [${[...actualCodes].join(", ")}]`,
        );
      }
    }
  }

  if (e.glyph_assertions !== undefined) {
    checkGlyphAssertions(r, e.glyph_assertions, failures);
  }

  if (e.atomic_text_groups !== undefined) {
    checkAtomicTextGroups(r, e.atomic_text_groups, failures);
  }

  return {
    id: spec.id,
    category: spec.category,
    status: failures.length === 0 ? "pass" : "fail",
    failures,
  };
}

function checkGlyphAssertions(
  result: NonNullable<CliResult["result"]>,
  assertions: GlyphAssertion[],
  failures: string[],
): void {
  const glyphs = flattenGlyphs(result);
  for (const assertion of assertions) {
    const located = findGlyph(glyphs, assertion.text, assertion.occurrence ?? 0);
    if (!located) {
      failures.push(
        `glyph_assertions: missing glyph text "${assertion.text}" occurrence ${assertion.occurrence ?? 0}`,
      );
      continue;
    }

    const { glyph } = located;
    const tolerance = assertion.tolerance_px ?? 0.25;

    checkGlyphScalarAssertions(glyph, assertion, tolerance, failures);
    checkGlyphRelativeAssertion(glyphs, located, assertion, tolerance, failures);
  }
}

function checkGlyphScalarAssertions(
  glyph: GlyphOutput,
  assertion: GlyphAssertion,
  tolerance: number,
  failures: string[],
): void {
  if (assertion.font_size_px !== undefined) {
    checkOptionalNumber(
      glyph.font_size_px,
      assertion.font_size_px,
      tolerance,
      `glyph "${assertion.text}" font_size_px`,
      failures,
    );
  }
  checkOptionalString(
    glyph.font_family,
    assertion.font_family,
    `glyph "${assertion.text}" font_family`,
    failures,
  );
  checkOptionalString(glyph.fill, assertion.fill, `glyph "${assertion.text}" fill`, failures);
  checkOptionalNumberExact(
    glyph.rotation_deg,
    assertion.rotation_deg,
    `glyph "${assertion.text}" rotation_deg`,
    failures,
  );
  checkOptionalString(
    glyph.outline_writing_mode,
    assertion.outline_writing_mode,
    `glyph "${assertion.text}" outline_writing_mode`,
    failures,
  );
  if (
    assertion.absolute_position !== undefined &&
    glyph.absolute_position !== assertion.absolute_position
  ) {
    failures.push(
      `glyph "${assertion.text}" absolute_position: expected ${assertion.absolute_position}, got ${glyph.absolute_position ?? "missing"}`,
    );
  }
}

function checkGlyphRelativeAssertion(
  glyphs: LocatedGlyph[],
  located: LocatedGlyph,
  assertion: GlyphAssertion,
  tolerance: number,
  failures: string[],
): void {
  if (assertion.relative_to === undefined) {
    return;
  }
  const relative = findGlyph(glyphs, assertion.relative_to, assertion.relative_occurrence ?? 0);
  if (!relative) {
    failures.push(
      `glyph_assertions: missing relative glyph "${assertion.relative_to}" occurrence ${assertion.relative_occurrence ?? 0}`,
    );
    return;
  }
  checkRelativeGlyphPosition(located, relative, assertion, tolerance, failures);
}

function checkRelativeGlyphPosition(
  located: LocatedGlyph,
  relative: LocatedGlyph,
  assertion: GlyphAssertion,
  tolerance: number,
  failures: string[],
): void {
  const text = assertion.text;
  const relativeText = assertion.relative_to ?? "";
  const x = located.glyph.origin_x;
  const y = located.glyph.origin_y;
  const relativeX = relative.glyph.origin_x;
  const relativeY = relative.glyph.origin_y;

  if (x === undefined || y === undefined || relativeX === undefined || relativeY === undefined) {
    failures.push(`glyph "${text}" relative position needs origin_x/origin_y in CLI output`);
    return;
  }

  const deltaX = x - relativeX;
  const deltaY = y - relativeY;
  const delta = { x: deltaX, y: deltaY };

  if (assertion.position !== undefined) {
    const failure = relativePositionFailure(
      assertion.position,
      text,
      relativeText,
      delta,
      tolerance,
    );
    if (failure !== undefined) {
      failures.push(failure);
    }
  }

  checkDeltaRange(
    "deltaX",
    deltaX,
    assertion.min_delta_x,
    assertion.max_delta_x,
    tolerance,
    text,
    failures,
  );
  checkDeltaRange(
    "deltaY",
    deltaY,
    assertion.min_delta_y,
    assertion.max_delta_y,
    tolerance,
    text,
    failures,
  );
}

function relativePositionFailure(
  position: RelativePosition,
  text: string,
  relativeText: string,
  delta: { x: number; y: number },
  tolerance: number,
): string | undefined {
  const checks: Record<RelativePosition, { pass: boolean; message: string }> = {
    above: {
      pass: delta.y < -tolerance,
      message: `glyph "${text}" should be above "${relativeText}" (deltaY=${delta.y})`,
    },
    below: {
      pass: delta.y > tolerance,
      message: `glyph "${text}" should be below "${relativeText}" (deltaY=${delta.y})`,
    },
    left_of: {
      pass: delta.x < -tolerance,
      message: `glyph "${text}" should be left of "${relativeText}" (deltaX=${delta.x})`,
    },
    right_of: {
      pass: delta.x > tolerance,
      message: `glyph "${text}" should be right of "${relativeText}" (deltaX=${delta.x})`,
    },
    same_origin_x: {
      pass: Math.abs(delta.x) <= tolerance,
      message: `glyph "${text}" origin_x should match "${relativeText}" (deltaX=${delta.x})`,
    },
    same_origin_y: {
      pass: Math.abs(delta.y) <= tolerance,
      message: `glyph "${text}" origin_y should match "${relativeText}" (deltaY=${delta.y})`,
    },
  };
  return checks[position].pass ? undefined : checks[position].message;
}

function checkDeltaRange(
  label: "deltaX" | "deltaY",
  value: number,
  min: number | undefined,
  max: number | undefined,
  tolerance: number,
  text: string,
  failures: string[],
): void {
  if (min !== undefined && value < min - tolerance) {
    failures.push(`glyph "${text}" ${label}: expected >= ${min}, got ${value}`);
  }
  if (max !== undefined && value > max + tolerance) {
    failures.push(`glyph "${text}" ${label}: expected <= ${max}, got ${value}`);
  }
}

function checkAtomicTextGroups(
  result: NonNullable<CliResult["result"]>,
  groups: string[][],
  failures: string[],
): void {
  const glyphs = flattenGlyphs(result);
  for (const group of groups) {
    const located = group.map((text) => findGlyph(glyphs, text, 0));
    if (located.some((glyph) => glyph === undefined)) {
      failures.push(`atomic_text_groups: missing glyph in [${group.join(", ")}]`);
      continue;
    }
    const lineIndexes = new Set(located.map((glyph) => glyph?.lineIndex));
    if (lineIndexes.size > 1) {
      failures.push(`atomic_text_groups: [${group.join(", ")}] spans multiple lines`);
    }
  }
}

function checkOptionalString(
  actual: string | undefined,
  expected: string | undefined,
  label: string,
  failures: string[],
): void {
  if (expected !== undefined && actual !== expected) {
    failures.push(`${label}: expected "${expected}", got "${actual ?? ""}"`);
  }
}

function checkOptionalNumberExact(
  actual: number | undefined,
  expected: number | undefined,
  label: string,
  failures: string[],
): void {
  if (expected !== undefined && actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual ?? "missing"}`);
  }
}

function checkOptionalNumber(
  actual: number | undefined,
  expected: number,
  tolerance: number,
  label: string,
  failures: string[],
): void {
  if (actual === undefined) {
    failures.push(`${label}: expected ${expected}, got missing`);
    return;
  }
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    failures.push(`${label}: expected ${expected}, got ${actual} (diff=${diff.toFixed(2)})`);
  }
}

function flattenGlyphs(result: NonNullable<CliResult["result"]>): LocatedGlyph[] {
  const located: LocatedGlyph[] = [];
  for (const line of result.lines) {
    for (const [glyphIndex, glyph] of (line.glyphs ?? []).entries()) {
      located.push({ glyph, lineIndex: line.index, glyphIndex });
    }
  }
  return located;
}

function findGlyph(
  glyphs: LocatedGlyph[],
  text: string,
  occurrence: number,
): LocatedGlyph | undefined {
  let seen = 0;
  for (const located of glyphs) {
    if (located.glyph.text !== text) {
      continue;
    }
    if (seen === occurrence) {
      return located;
    }
    seen++;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: tsx src/check.ts <boundtext-output.json> <spec-cases.json>");
    process.exit(1);
  }

  const [resultPath, specPath] = args;

  const resultJson =
    resultPath === "-" ? readFileSync(0, "utf-8") : readFileSync(resultPath, "utf-8");

  const specJson = readFileSync(specPath, "utf-8");

  const results: CliResult[] = JSON.parse(resultJson);
  const specs: SpecCase[] = JSON.parse(specJson);

  // Build result map
  const resultMap = new Map<string, CliResult>();
  for (const r of results) {
    resultMap.set(r.id, r);
  }

  let passCount = 0;
  let failCount = 0;
  let errorCount = 0;
  const allChecks: CheckResult[] = [];

  for (const spec of specs) {
    const result = resultMap.get(spec.id);
    if (!result) {
      const check: CheckResult = {
        id: spec.id,
        category: spec.category,
        status: "error",
        failures: ["No result found for this spec case"],
      };
      allChecks.push(check);
      errorCount++;
      continue;
    }

    const check = checkCase(result, spec);
    allChecks.push(check);

    switch (check.status) {
      case "pass":
        passCount++;
        break;
      case "fail":
        failCount++;
        break;
      case "error":
        errorCount++;
        break;
    }
  }

  // Print results
  console.info("\n=== Spec Case Validation Results ===\n");

  for (const check of allChecks) {
    const icon = check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "ERR ";
    const category = check.category ? ` [${check.category}]` : "";
    console.info(`${icon} ${check.id}${category}`);
    for (const f of check.failures) {
      console.info(`     ${f}`);
    }
  }

  console.info(`\n--- Summary ---`);
  console.info(
    `Pass: ${passCount}  Fail: ${failCount}  Error: ${errorCount}  Total: ${specs.length}`,
  );

  if (failCount > 0 || errorCount > 0) {
    process.exit(1);
  }
}

main();
