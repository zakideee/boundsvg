import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Types
type BtLine = {
  index: number;
  text: string;
  start_grapheme: number;
  end_grapheme: number;
  width: number;
  baseline_y: number;
};

type BtEntry = {
  id: string;
  result: {
    break_indices: number[];
    line_count: number;
    overflow: string | { type: string };
    chosen_font_size_px: number;
    bbox: { x: number; y: number; w: number; h: number };
    column_count: number;
    kinsoku_violations: unknown[];
    rotated_glyph_count: number;
    lines: BtLine[];
  };
};

type BrowserEntry = {
  id: string;
  engine: string;
  break_indices: number[];
  line_count: number;
  overflow: boolean;
  bbox?: { x: number; y: number; w: number; h: number };
  client_rects: unknown[];
};

type SpecCase = {
  id: string;
  category?: string;
  description?: string;
  request: {
    text: string;
    font_family: string;
    font_size_px: number;
    max_width: number;
    max_height?: number;
    line_height?: number;
    line_height_px?: number;
    letter_spacing_px?: number;
    writing_mode?: string;
    wrap?: string;
    [key: string]: unknown;
  };
  expected?: Record<string, unknown>;
};

type ReportRow = {
  id: string;
  category: string;
  description: string;
  text: string;
  status: "PASS" | "FAIL" | "DIFF" | "SKIP";
  spec: SpecCase;
  bt?: BtEntry["result"];
  chromium?: BrowserEntry;
  firefox?: BrowserEntry;
  diffs: string[];
  screenshotBoundtext?: string;
  screenshotBoundsvg?: string;
  screenshotChromium?: string;
  screenshotFirefox?: string;
  rerunCommand: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\u2026` : s;
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Comparison-aware break_indices matching for boundtext vs browser.
 *
 * Some boundtext features have no direct CSS equivalent, causing structural
 * differences between boundtext and browser output even when the visible
 * result is correct:
 *
 * **Ellipsis + max_lines**: boundtext stops layout after truncation and only
 * emits break_indices for visible lines (e.g. [5]).  Browsers apply
 * -webkit-line-clamp which keeps the full DOM text, so their break_indices
 * contain all lines (e.g. [5,10,15,20]).  → prefix match.
 *
 * **Fit (Shrink/Grow)**: boundtext adjusts font_size_px to fit the bounding
 * box, which changes line breaks.  Browsers render at the original
 * font_size_px (CSS has no equivalent of fit), producing different breaks.
 * → skip bt-vs-browser break comparison entirely.
 *
 * Note: browser-runner re-renders fit-case browser screenshots at
 * boundtext's chosen_font_size_px (when --bt-results is provided).
 * This makes the visual comparison meaningful for verifying line-break
 * correctness at the chosen size, while the break_indices comparison
 * remains skipped because the data JSON still reflects the original run.
 */
function breaksAgreeForCase(btBreaks: number[], browserBreaks: number[], spec: SpecCase): boolean {
  const fit = String(spec.request.fit ?? "None");
  if (fit !== "None") {
    // Browser can't replicate fit; skip break comparison
    return true;
  }
  const isEllipsis = Boolean(spec.request.ellipsis) && Number(spec.request.max_lines ?? 0) > 1;
  if (isEllipsis) {
    // boundtext emits fewer breaks (only visible lines); check prefix match
    if (btBreaks.length > browserBreaks.length) {
      return false;
    }
    return btBreaks.every((v, i) => v === browserBreaks[i]);
  }
  return arraysEqual(btBreaks, browserBreaks);
}

/** Check if a spec case uses features that browsers cannot replicate via CSS. */
function isBrowserIncomparableCase(spec: SpecCase): boolean {
  const fit = String(spec.request.fit ?? "None");
  if (fit !== "None") {
    return true;
  }
  if (Boolean(spec.request.ellipsis) && Number(spec.request.max_lines ?? 0) > 1) {
    return true;
  }
  // Spec cases explicitly marked as browser-incomparable (e.g. kinsoku_unresolved
  // where boundtext force-breaks but browsers overflow without breaking)
  if (spec.expected?._browser_incomparable) {
    return true;
  }
  return false;
}

// Fonts are only needed for screenshot rendering (handled by browser-runner),
// not for the report HTML — which keeps the report itself small.

/** Build screenshot+meta HTML for a browser column. */
function buildBrowserColumnHtml(
  screenshotRelPath: string | undefined,
  label: string,
  entry: BrowserEntry | undefined,
  bt: BtEntry["result"] | undefined,
  spec: SpecCase,
): string {
  if (!screenshotRelPath) {
    return `<div class="visual-empty">No ${label} screenshot</div>`;
  }
  const bbox = entry?.bbox;

  let matchBadge = "";
  if (bt && entry) {
    const breaksOk = breaksAgreeForCase(bt.break_indices, entry.break_indices, spec);
    const skip = isBrowserIncomparableCase(spec);
    const linesOk = skip || bt.line_count === entry.line_count;
    if (breaksOk && linesOk) {
      matchBadge = '<span class="match-marker">MATCH</span>';
    }
  }

  return `<img data-src="${screenshotRelPath}" class="visual-screenshot lazy" alt="${label}">
    <div class="visual-meta">
      <span class="mono">breaks: ${entry ? JSON.stringify(entry.break_indices) : "-"}</span><br>
      <span class="mono">lines: ${entry?.line_count ?? "-"}</span>
      ${bbox ? `<span class="mono"> | bbox: ${bbox.w.toFixed(1)}x${bbox.h.toFixed(1)}</span>` : ""}
      ${matchBadge}
    </div>`;
}

/** Build screenshot+meta HTML for the boundsvg WASM-rendered column. */
function buildBoundsvgColumnHtml(row: ReportRow): string {
  if (!row.screenshotBoundsvg) {
    return '<div class="visual-empty">No boundsvg screenshot</div>';
  }
  return `<img data-src="${row.screenshotBoundsvg}" class="visual-screenshot lazy" alt="boundsvg">
    <div class="visual-meta">
      <span class="mono">WASM pipeline (rustybuzz + tiny_skia)</span>
    </div>`;
}

/** Build screenshot+meta HTML for the boundtext column. */
function buildBtColumnHtml(row: ReportRow): string {
  if (row.screenshotBoundtext && row.bt) {
    const crBreaks = row.chromium?.break_indices ?? [];
    const hasDiff = !breaksAgreeForCase(row.bt.break_indices, crBreaks, row.spec);
    return `<img data-src="${row.screenshotBoundtext}" class="visual-screenshot lazy" alt="boundtext">
    <div class="visual-meta">
      <span class="mono">breaks: ${JSON.stringify(row.bt.break_indices)}</span><br>
      <span class="mono">lines: ${row.bt.line_count}</span>
      <span class="mono"> | font: ${row.bt.chosen_font_size_px}px</span>
      <span class="mono"> | bbox: ${row.bt.bbox.w.toFixed(1)}x${row.bt.bbox.h.toFixed(1)}</span>
      ${hasDiff ? '<span class="diff-marker">DIFF</span>' : ""}
    </div>`;
  }
  if (row.bt) {
    const btLines = (row.bt.lines as BtLine[]).map((l) => escapeHtml(l.text));
    return `<div class="visual-empty">
      <em>No screenshot — showing line texts:</em><br>
      <span class="mono">${btLines.join(" | ")}</span>
    </div>
    <div class="visual-meta">
      <span class="mono">breaks: ${JSON.stringify(row.bt.break_indices)}</span><br>
      <span class="mono">lines: ${row.bt.line_count}</span>
      <span class="mono"> | font: ${row.bt.chosen_font_size_px}px</span>
      <span class="mono"> | bbox: ${row.bt.bbox.w.toFixed(1)}x${row.bt.bbox.h.toFixed(1)}</span>
    </div>`;
  }
  return '<div class="visual-empty">No boundtext data</div>';
}

/**
 * Build the visual comparison panel.
 *
 * The boundtext column uses a **pre-rendered screenshot** (generated by
 * browser-runner --bt-results) instead of an inline HTML div.  This is
 * important because rendering boundtext lines as HTML in the report viewer
 * would make the result depend on the viewer's browser, defeating the
 * purpose of a cross-engine comparison.  By screenshotting via headless
 * Chromium with the same font/CSS, all three columns are rendered under
 * identical conditions.
 *
 * **bbox vs screenshot size discrepancy**: Screenshots capture the full
 * CSS element box (`width: max_width`), so their pixel dimensions always
 * equal `max_width × height`.  Browser bbox (from `getBoundingClientRect`)
 * also returns the element box, so browser bbox == screenshot size.
 * However, boundtext's bbox reports the **text extent** — the area
 * actually occupied by glyphs — which can be narrower than `max_width`.
 * This means boundtext bbox.w ≤ screenshot width.  The difference is
 * not a bug; it reflects the different semantics of each measurement.
 */
function buildVisualPanel(row: ReportRow): string {
  const crMatch = browserMatchesBt(row.bt, row.chromium, row.spec);
  const ffMatch = browserMatchesBt(row.bt, row.firefox, row.spec);

  return `<div class="visual-comparison">
  <div class="visual-column">
    <div class="visual-label">boundtext</div>
    ${buildBtColumnHtml(row)}
  </div>
  <div class="visual-column">
    <div class="visual-label">boundsvg</div>
    ${buildBoundsvgColumnHtml(row)}
  </div>
  <div class="visual-column${crMatch ? " browser-match" : ""}">
    <div class="visual-label">Chromium</div>
    ${buildBrowserColumnHtml(row.screenshotChromium, "Chromium", row.chromium, row.bt, row.spec)}
  </div>
  <div class="visual-column${ffMatch ? " browser-match" : ""}">
    <div class="visual-label">Firefox</div>
    ${buildBrowserColumnHtml(row.screenshotFirefox, "Firefox", row.firefox, row.bt, row.spec)}
  </div>
</div>`;
}

/** Check if a browser result agrees with boundtext. */
function browserMatchesBt(
  bt: BtEntry["result"] | undefined,
  browser: BrowserEntry | undefined,
  spec: SpecCase,
): boolean {
  if (!bt || !browser) {
    return false;
  }
  const breaksOk = breaksAgreeForCase(bt.break_indices, browser.break_indices, spec);
  const skip = isBrowserIncomparableCase(spec);
  const linesOk = skip || bt.line_count === browser.line_count;
  return breaksOk && linesOk;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation tool with many sequential checks
async function main() {
  const args = process.argv.slice(2);
  let btDir = "/tmp";
  let browserDir = "/tmp";
  let specDir = "";
  let screenshotsDir = "";
  // --fonts is accepted but unused (fonts are embedded in screenshots, not
  // in the report HTML).
  let outputPath = "/tmp/layout-report.html";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--bt-dir":
        btDir = args[++i];
        break;
      case "--browser-dir":
        browserDir = args[++i];
        break;
      case "--hb-dir":
        ++i; // accepted but unused
        break;
      case "--spec-dir":
        specDir = args[++i];
        break;
      case "--screenshots":
        screenshotsDir = args[++i];
        break;
      case "--fonts":
        ++i; // accepted but unused
        break;
      case "--output":
        outputPath = args[++i];
        break;
    }
  }

  if (!specDir) {
    console.error(
      "Usage: tsx src/generate.ts --spec-dir <path> [--bt-dir <path>] [--browser-dir <path>] [--fonts <path>] [--output <path>]",
    );
    process.exit(1);
  }

  // Load all data
  const btMap = new Map<string, BtEntry["result"]>();
  const crMap = new Map<string, BrowserEntry>();
  const ffMap = new Map<string, BrowserEntry>();
  const specMap = new Map<string, SpecCase>();

  // Load spec cases
  const specFiles = readdirSync(specDir).filter((f) => f.endsWith(".json"));
  for (const f of specFiles) {
    const cases: SpecCase[] = JSON.parse(readFileSync(resolve(specDir, f), "utf-8"));
    for (const c of cases) {
      specMap.set(c.id, c);
    }
  }

  // Load boundtext outputs
  const btFiles = readdirSync(btDir).filter(
    (f) => f.startsWith("boundtext-") && f.endsWith(".json"),
  );
  for (const f of btFiles) {
    try {
      const entries: BtEntry[] = JSON.parse(readFileSync(resolve(btDir, f), "utf-8"));
      for (const e of entries) {
        btMap.set(e.id, e.result);
      }
    } catch {
      /* skip */
    }
  }

  // Load browser outputs
  const browserFiles = readdirSync(browserDir).filter(
    (f) => f.startsWith("browser-") && f.endsWith(".json"),
  );
  for (const f of browserFiles) {
    try {
      const entries: BrowserEntry[] = JSON.parse(readFileSync(resolve(browserDir, f), "utf-8"));
      for (const e of entries) {
        if (e.engine === "chromium") {
          crMap.set(e.id, e);
        } else if (e.engine === "firefox") {
          ffMap.set(e.id, e);
        }
      }
    } catch {
      /* skip */
    }
  }

  // Build report rows
  const rows: ReportRow[] = [];

  for (const [id, spec] of specMap) {
    const bt = btMap.get(id);
    const cr = crMap.get(id);
    const ff = ffMap.get(id);
    const diffs: string[] = [];

    // Compare break_indices
    // For ellipsis cases, boundtext only emits breaks for visible lines (prefix match).
    // See breaksAgreeForCase() for details.
    if (bt && cr) {
      if (!breaksAgreeForCase(bt.break_indices, cr.break_indices, spec)) {
        diffs.push(
          `break_indices: bt=${JSON.stringify(bt.break_indices)} cr=${JSON.stringify(cr.break_indices)}`,
        );
      }
    }
    if (bt && ff) {
      if (!breaksAgreeForCase(bt.break_indices, ff.break_indices, spec)) {
        diffs.push(
          `break_indices: bt=${JSON.stringify(bt.break_indices)} ff=${JSON.stringify(ff.break_indices)}`,
        );
      }
    }
    if (cr && ff) {
      if (!arraysEqual(cr.break_indices, ff.break_indices)) {
        diffs.push(
          `break_indices: cr=${JSON.stringify(cr.break_indices)} ff=${JSON.stringify(ff.break_indices)}`,
        );
      }
    }

    // Compare line_count
    // Skip bt-vs-browser line_count diff for cases where the browser cannot
    // replicate boundtext's behavior (ellipsis truncation, fit size change).
    const skipBtBrowserLineCount = isBrowserIncomparableCase(spec);
    if (bt && cr && bt.line_count !== cr.line_count && !skipBtBrowserLineCount) {
      diffs.push(`line_count: bt=${bt.line_count} cr=${cr.line_count}`);
    }
    if (bt && ff && bt.line_count !== ff.line_count && !skipBtBrowserLineCount) {
      diffs.push(`line_count: bt=${bt.line_count} ff=${ff.line_count}`);
    }

    // Note: bbox dimensions are NOT compared for PASS/DIFF status.
    // They are only used in the Agreement table (≤2px tolerance).
    // This means cases where the screenshot shapes differ significantly
    // (e.g. vertical-rl Chromium renders a horizontal rectangle while
    // Firefox/boundtext render a vertical one) will still be PASS if
    // break_indices, line_count, and overflow all agree.

    // Compare overflow
    if (bt && cr) {
      const btOverflowType =
        typeof bt.overflow === "object" && bt.overflow !== null
          ? (bt.overflow as { type: string }).type
          : String(bt.overflow);
      const btOverflow = btOverflowType !== "none";
      if (btOverflow !== cr.overflow) {
        diffs.push(`overflow: bt=${btOverflowType} cr=${cr.overflow}`);
      }
    }

    let status: ReportRow["status"] = "SKIP";
    if (bt && (cr || ff)) {
      status = diffs.length === 0 ? "PASS" : "DIFF";
    } else if (bt) {
      status = "SKIP"; // No browser data
    }

    // Check spec expectations
    if (bt && spec.expected) {
      const e = spec.expected;
      if (
        e.kinsoku_violations !== undefined &&
        bt.kinsoku_violations.length !== e.kinsoku_violations
      ) {
        status = "FAIL";
        diffs.push(
          `kinsoku_violations: expected=${e.kinsoku_violations} actual=${bt.kinsoku_violations.length}`,
        );
      }
    }

    // Store relative paths for screenshots (relative to outputPath directory)
    const outputDir = resolve(outputPath, "..");
    const relScreenshot = (suffix: string): string | undefined => {
      if (!screenshotsDir) {
        return undefined;
      }
      const abs = resolve(screenshotsDir, `${id}.${suffix}.png`);
      if (!existsSync(abs)) {
        return undefined;
      }
      // Compute path relative to the directory containing the report HTML
      const rel = abs.startsWith(`${outputDir}/`) ? abs.slice(outputDir.length + 1) : abs;
      return rel;
    };

    rows.push({
      id,
      category: spec.category || "unknown",
      description: spec.description || "",
      text: spec.request.text,
      status,
      spec,
      bt,
      chromium: cr,
      firefox: ff,
      diffs,
      screenshotBoundtext: relScreenshot("boundtext"),
      screenshotBoundsvg: relScreenshot("boundsvg"),
      screenshotChromium: relScreenshot("chromium"),
      screenshotFirefox: relScreenshot("firefox"),
      rerunCommand: `boundtext-cli --fonts fixtures/fonts --input spec_cases/${spec.category}.json`,
    });
  }

  // Sort by category then id
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

  // Generate summary stats
  const categories = [...new Set(rows.map((r) => r.category))];
  const totalPass = rows.filter((r) => r.status === "PASS").length;
  const totalFail = rows.filter((r) => r.status === "FAIL").length;
  const totalDiff = rows.filter((r) => r.status === "DIFF").length;
  const totalSkip = rows.filter((r) => r.status === "SKIP").length;

  // bt vs cr agreement
  // For ellipsis cases, use prefix matching (see breaksAgreeForCase).
  const btCrCompared = rows.filter((r) => r.bt && r.chromium);
  const btCrAgree = btCrCompared.filter((r) => {
    if (!r.bt || !r.chromium) {
      return false;
    }
    const skip = isBrowserIncomparableCase(r.spec);
    const breaksOk = breaksAgreeForCase(r.bt.break_indices, r.chromium.break_indices, r.spec);
    const linesOk = skip || r.bt.line_count === r.chromium.line_count;
    return breaksOk && linesOk;
  });

  // bt vs ff agreement
  const btFfCompared = rows.filter((r) => r.bt && r.firefox);
  const btFfAgree = btFfCompared.filter((r) => {
    if (!r.bt || !r.firefox) {
      return false;
    }
    const skip = isBrowserIncomparableCase(r.spec);
    const breaksOk = breaksAgreeForCase(r.bt.break_indices, r.firefox.break_indices, r.spec);
    const linesOk = skip || r.bt.line_count === r.firefox.line_count;
    return breaksOk && linesOk;
  });

  // cr vs ff agreement
  const crFfCompared = rows.filter((r) => r.chromium && r.firefox);
  const crFfAgree = crFfCompared.filter((r) => {
    if (!r.chromium || !r.firefox) {
      return false;
    }
    return (
      arraysEqual(r.chromium.break_indices, r.firefox.break_indices) &&
      r.chromium.line_count === r.firefox.line_count
    );
  });

  // bbox agreement (within 2px tolerance)
  const bboxClose = (
    a: { w: number; h: number } | undefined,
    b: { w: number; h: number } | undefined,
  ) => {
    if (!a || !b) {
      return false;
    }
    return Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2;
  };
  const btCrBboxAgree = btCrCompared.filter(
    (r) => r.bt && r.chromium?.bbox && bboxClose(r.bt.bbox, r.chromium.bbox),
  );
  const btFfBboxAgree = btFfCompared.filter(
    (r) => r.bt && r.firefox?.bbox && bboxClose(r.bt.bbox, r.firefox.bbox),
  );

  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>boundtext Layout Validation Report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #f5f5f5; }
  h1 { color: #333; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 20px 0; }
  .card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card h3 { margin: 0 0 8px; font-size: 14px; color: #666; }
  .card .value { font-size: 28px; font-weight: bold; }
  .pass { color: #22c55e; }
  .fail { color: #ef4444; }
  .diff { color: #f59e0b; }
  .skip { color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-top: 20px; }
  th { background: #1e293b; color: white; padding: 12px 8px; text-align: left; font-size: 13px; }
  td { padding: 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; }
  tr:hover td { background: #f8fafc; }
  .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .status-PASS { background: #dcfce7; color: #166534; }
  .status-FAIL { background: #fee2e2; color: #991b1b; }
  .status-DIFF { background: #fef3c7; color: #92400e; }
  .status-SKIP { background: #f1f5f9; color: #475569; }
  .diff-detail { font-size: 11px; color: #dc2626; font-family: monospace; }
  .text-preview { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: monospace; font-size: 12px; }
  .category-header td { background: #f1f5f9; font-weight: 600; font-size: 14px; }
  .agreement { margin: 20px 0; }
  .agreement table { max-width: 500px; }
  details { font-size: 12px; }
  details summary { cursor: pointer; color: #2563eb; }
  .filter-bar { margin: 16px 0; }
  .filter-bar button { padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 4px; background: white; cursor: pointer; margin-right: 4px; }
  .filter-bar button.active { background: #1e293b; color: white; border-color: #1e293b; }

  /* Visual comparison panel */
  .visual-comparison { display: flex; gap: 16px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; margin-top: 4px; }
  .visual-column { flex: 1; min-width: 0; }
  .visual-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .visual-render { background: white; border: 1px solid #cbd5e1; padding: 4px; margin: 0; box-sizing: content-box; }
  .visual-screenshot { outline: 1px solid #cbd5e1; display: block; }
  .visual-screenshot.lazy { min-height: 40px; background: #f1f5f9; }
  .visual-meta { margin-top: 4px; font-size: 11px; color: #475569; }
  .visual-empty { color: #94a3b8; font-size: 12px; font-style: italic; padding: 20px; text-align: center; background: white; border: 1px dashed #cbd5e1; border-radius: 4px; }
  .diff-marker { display: inline-block; background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }
  .match-marker { display: inline-block; background: #dcfce7; color: #166534; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }
  .visual-column.browser-match { border: 2px solid #22c55e; border-radius: 6px; padding: 6px; background: #f0fdf4; }
  .visual-column.browser-match .visual-label { color: #166534; }
  .case-card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 12px; }
  .case-header { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
  .case-header:hover { opacity: 0.8; }
  .case-body { display: none; margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  .case-body.open { display: block; }
  .case-id { font-family: monospace; font-size: 13px; font-weight: 600; }
  .copy-btn { font-size: 10px; padding: 1px 5px; border: 1px solid #cbd5e1; border-radius: 3px; background: #f8fafc; color: #64748b; cursor: pointer; margin-left: 4px; vertical-align: middle; line-height: 1; }
  .copy-btn:hover { background: #e2e8f0; color: #334155; }
  .case-cat { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; }
  .case-text { font-size: 12px; color: #475569; margin-left: auto; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .case-desc { font-size: 12px; color: #64748b; margin-top: 2px; }
  .case-diffs { margin-top: 8px; }
</style>
</head>
<body>
<h1>boundtext Layout Validation Report</h1>
<p>Generated: ${new Date().toISOString()}</p>

<div class="summary">
  <div class="card"><h3>Total Cases</h3><div class="value">${rows.length}</div></div>
  <div class="card"><h3>Pass</h3><div class="value pass">${totalPass}</div></div>
  <div class="card"><h3>Diff</h3><div class="value diff">${totalDiff}</div></div>
  <div class="card"><h3>Fail</h3><div class="value fail">${totalFail}</div></div>
  <div class="card"><h3>Skip</h3><div class="value skip">${totalSkip}</div></div>
</div>

<div class="agreement">
<h2>Engine Agreement</h2>
<table>
  <tr><th>Comparison</th><th>Metric</th><th>Compared</th><th>Agree</th><th>Rate</th></tr>
  <tr><td>boundtext vs Chromium</td><td>breaks + lines</td><td>${btCrCompared.length}</td><td>${btCrAgree.length}</td><td>${btCrCompared.length ? ((btCrAgree.length / btCrCompared.length) * 100).toFixed(1) : "N/A"}%</td></tr>
  <tr><td>boundtext vs Chromium</td><td>bbox (&le;2px)</td><td>${btCrCompared.length}</td><td>${btCrBboxAgree.length}</td><td>${btCrCompared.length ? ((btCrBboxAgree.length / btCrCompared.length) * 100).toFixed(1) : "N/A"}%</td></tr>
  <tr><td>boundtext vs Firefox</td><td>breaks + lines</td><td>${btFfCompared.length}</td><td>${btFfAgree.length}</td><td>${btFfCompared.length ? ((btFfAgree.length / btFfCompared.length) * 100).toFixed(1) : "N/A"}%</td></tr>
  <tr><td>boundtext vs Firefox</td><td>bbox (&le;2px)</td><td>${btFfCompared.length}</td><td>${btFfBboxAgree.length}</td><td>${btFfCompared.length ? ((btFfBboxAgree.length / btFfCompared.length) * 100).toFixed(1) : "N/A"}%</td></tr>
  <tr><td>Chromium vs Firefox</td><td>breaks + lines</td><td>${crFfCompared.length}</td><td>${crFfAgree.length}</td><td>${crFfCompared.length ? ((crFfAgree.length / crFfCompared.length) * 100).toFixed(1) : "N/A"}%</td></tr>
</table>
</div>

<h2>Per-Category Summary</h2>
<table>
  <tr><th>Category</th><th>Total</th><th>Pass</th><th>Diff</th><th>Fail</th><th>Skip</th></tr>
  ${categories
    .map((cat) => {
      const catRows = rows.filter((r) => r.category === cat);
      return `<tr>
      <td>${escapeHtml(cat)}</td>
      <td>${catRows.length}</td>
      <td class="pass">${catRows.filter((r) => r.status === "PASS").length}</td>
      <td class="diff">${catRows.filter((r) => r.status === "DIFF").length}</td>
      <td class="fail">${catRows.filter((r) => r.status === "FAIL").length}</td>
      <td class="skip">${catRows.filter((r) => r.status === "SKIP").length}</td>
    </tr>`;
    })
    .join("\n")}
</table>

<h2>Visual Comparison</h2>

<div class="filter-bar">
  <button class="active" onclick="filterCards('all')">All</button>
  <button onclick="filterCards('DIFF')">Diff Only</button>
  <button onclick="filterCards('FAIL')">Fail Only</button>
  <button onclick="filterCards('PASS')">Pass Only</button>
  <button onclick="toggleAll(true)" style="margin-left:12px">Expand All</button>
  <button onclick="toggleAll(false)">Collapse All</button>
</div>

<div id="results">
${rows
  .map(
    (r) => `<div class="case-card" data-status="${r.status}" data-category="${r.category}">
  <div class="case-header" onclick="toggleCard(this)">
    <span class="status-badge status-${r.status}">${r.status}</span>
    <span class="case-id">${escapeHtml(r.id)}</span><button class="copy-btn" title="Copy ID" onclick="event.stopPropagation();navigator.clipboard.writeText('${escapeHtml(r.id)}');this.textContent='done';setTimeout(()=>this.textContent='copy',800)">copy</button>
    <span class="case-cat">${escapeHtml(r.category)}</span>
    ${r.diffs.length > 0 ? `<span class="diff-marker">${r.diffs.length} diff(s)</span>` : ""}
    <span class="case-text" title="${escapeHtml(r.text)}">${escapeHtml(truncate(r.text, 40))}</span>
  </div>
  <div class="case-body${r.status === "DIFF" || r.status === "FAIL" ? " open" : ""}">
    ${r.description ? `<div class="case-desc">${escapeHtml(r.description)}</div>` : ""}
    ${r.diffs.length > 0 ? `<div class="case-diffs"><div class="diff-detail">${r.diffs.map((d) => escapeHtml(d)).join("<br>")}</div></div>` : ""}
    ${buildVisualPanel(r)}
  </div>
</div>`,
  )
  .join("\n")}
</div>

<script>
// Lazy-load images: only load when the card body is opened.
// Images use data-src instead of src to avoid loading every PNG at once.
function loadLazyImages(container) {
  container.querySelectorAll('img.lazy[data-src]').forEach(img => {
    if (!img.src || img.src === location.href) {
      img.src = img.dataset.src;
      img.classList.remove('lazy');
    }
  });
}
function toggleCard(header) {
  const body = header.nextElementSibling;
  body.classList.toggle('open');
  if (body.classList.contains('open')) loadLazyImages(body);
}
function filterCards(status) {
  document.querySelectorAll('#results .case-card').forEach(card => {
    card.style.display = (status === 'all' || card.dataset.status === status) ? '' : 'none';
  });
  document.querySelectorAll('.filter-bar button').forEach(btn => {
    const text = btn.textContent;
    if (text === 'Expand All' || text === 'Collapse All') return;
    btn.classList.toggle('active', text.toLowerCase().includes(status.toLowerCase()) || (status === 'all' && text === 'All'));
  });
}
function toggleAll(open) {
  document.querySelectorAll('#results .case-body').forEach(body => {
    body.classList.toggle('open', open);
    if (open) loadLazyImages(body);
  });
}
// Load images for initially-expanded cards (DIFF/FAIL)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#results .case-body.open').forEach(loadLazyImages);
});
</script>

</body>
</html>`;

  writeFileSync(outputPath, html);
  console.info(`Report generated: ${outputPath}`);
  console.info(
    `Total: ${rows.length} | Pass: ${totalPass} | Diff: ${totalDiff} | Fail: ${totalFail} | Skip: ${totalSkip}`,
  );
}

main().catch(console.error);
