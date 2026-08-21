/**
 * harfbuzz-runner: compares boundtext (rustybuzz) shaping output against HarfBuzz hb-shape.
 *
 * Usage:
 *   tsx src/compare.ts --spec <spec.json> --fonts <fonts-dir> [--bt-output <boundtext-output.json>] [--output <output.json>]
 *
 * If hb-shape is not installed, all HarfBuzz comparisons are skipped (SKIP).
 * The tool still outputs boundtext glyph data for future comparison.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HBGlyph = {
  /** Glyph name */
  g: string;
  /** Cluster index */
  cl: number;
  /** x_offset */
  dx: number;
  /** y_offset */
  dy: number;
  /** x_advance */
  ax: number;
  /** y_advance */
  ay: number;
};

type BtGlyph = {
  glyph_id: number;
  cluster: number;
  x_advance: number;
  y_advance: number;
  x_offset: number;
  y_offset: number;
};

type ShapingMatch = {
  glyph_count: boolean;
  cluster_sequence: boolean;
  advance_within_tolerance: boolean;
  max_advance_diff: number;
};

type ShapingComparison = {
  id: string;
  text: string;
  font: string;
  font_size_px: number;
  hb_available: boolean;
  hb_glyphs?: HBGlyph[];
  bt_glyphs?: BtGlyph[];
  match: ShapingMatch;
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
    max_height: number;
    wrap: string;
    fit: string;
    language: string;
    writing_mode: string;
    line_height: number;
    letter_spacing_px: number;
    hanging_punctuation: boolean;
  };
  expected?: Record<string, unknown>;
};

type CliResult = {
  id: string;
  result?: {
    lines: Array<{
      index: number;
      text: string;
      glyphs?: BtGlyph[];
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Font file mapping
// ---------------------------------------------------------------------------

const FONT_FILE_MAP: Record<string, string> = {
  NotoSansJP: "NotoSansJP-Regular.subset.ttf",
  NotoSerifJP: "NotoSerifJP-Regular.subset.ttf",
  ZenMaruGothic: "ZenMaruGothic-Regular.subset.ttf",
  Inter: "Inter-Variable.ttf",
  NotoSansCJKjp: "NotoSansCJKjp-VF.subset.ttf",
  JetBrainsMono: "JetBrainsMono-Regular.woff2",
  MonaspaceNeon: "MonaspaceNeon-Regular.woff2",
};

// ---------------------------------------------------------------------------
// HarfBuzz shaping
// ---------------------------------------------------------------------------

function runHbShape(fontPath: string, fontSize: number, text: string): HBGlyph[] | null {
  try {
    // Escape the text for shell usage
    const escapedText = text.replace(/'/g, "'\\''");
    const cmd = `hb-shape --font-file='${fontPath}' --font-size=${fontSize} --output-format=json '${escapedText}'`;
    const output = execSync(cmd, { encoding: "utf-8", timeout: 10_000 });
    return JSON.parse(output) as HBGlyph[];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compareGlyphs(
  hbGlyphs: HBGlyph[] | null,
  btGlyphs: BtGlyph[],
  fontSize: number,
): ShapingMatch {
  if (!hbGlyphs || btGlyphs.length === 0) {
    return {
      glyph_count: false,
      cluster_sequence: false,
      advance_within_tolerance: false,
      max_advance_diff: 0,
    };
  }

  const glyphCountMatch = hbGlyphs.length === btGlyphs.length;

  // Compare cluster sequences
  const hbClusters = hbGlyphs.map((g) => g.cl);
  const btClusters = btGlyphs.map((g) => g.cluster);
  const clusterMatch = JSON.stringify(hbClusters) === JSON.stringify(btClusters);

  // Compare advances
  let maxAdvanceDiff = 0;
  const minLen = Math.min(hbGlyphs.length, btGlyphs.length);
  for (let i = 0; i < minLen; i++) {
    const diff = Math.abs(hbGlyphs[i].ax - btGlyphs[i].x_advance);
    maxAdvanceDiff = Math.max(maxAdvanceDiff, diff);
  }

  // Tolerance: 0.01em (0.01 * fontSize)
  const tolerance = 0.01 * fontSize;
  const advanceWithinTolerance = maxAdvanceDiff <= tolerance;

  return {
    glyph_count: glyphCountMatch,
    cluster_sequence: clusterMatch,
    advance_within_tolerance: advanceWithinTolerance,
    max_advance_diff: maxAdvanceDiff,
  };
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

type Args = {
  specPath: string;
  fontsDir: string;
  btOutputPath: string;
  outputPath: string;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let specPath = "";
  let fontsDir = "";
  let btOutputPath = "";
  let outputPath = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--spec":
        specPath = args[++i];
        break;
      case "--fonts":
        fontsDir = args[++i];
        break;
      case "--bt-output":
        btOutputPath = args[++i];
        break;
      case "--output":
        outputPath = args[++i];
        break;
    }
  }

  if (!specPath || !fontsDir) {
    console.error(
      "Usage: tsx src/compare.ts --spec <spec.json> --fonts <fonts-dir> " +
        "[--bt-output <boundtext-output.json>] [--output <output.json>]",
    );
    process.exit(1);
  }

  return { specPath, fontsDir, btOutputPath, outputPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation tool with many sequential checks
async function main(): Promise<void> {
  const { specPath, fontsDir, btOutputPath, outputPath } = parseArgs();

  // Check hb-shape availability
  let hbAvailable = false;
  try {
    execSync("hb-shape --version", { encoding: "utf-8", timeout: 5_000 });
    hbAvailable = true;
    console.info("hb-shape found.");
  } catch {
    console.warn(
      "WARNING: hb-shape not found. Install libharfbuzz-bin (or harfbuzz) for shaping comparison.",
    );
    console.warn("         All HarfBuzz comparisons will be SKIP.\n");
  }

  // Read spec cases
  const specs: SpecCase[] = JSON.parse(readFileSync(resolve(specPath), "utf-8"));

  // Read boundtext output if available
  const btResults = new Map<string, CliResult>();
  if (btOutputPath && existsSync(btOutputPath)) {
    try {
      const btData: CliResult[] = JSON.parse(readFileSync(resolve(btOutputPath), "utf-8"));
      for (const entry of btData) {
        btResults.set(entry.id, entry);
      }
      console.info(`Loaded ${btResults.size} boundtext results from ${btOutputPath}`);
    } catch (err) {
      console.warn(`Could not read boundtext output: ${err}`);
    }
  } else if (btOutputPath) {
    console.warn(`Boundtext output file not found: ${btOutputPath}`);
  }

  const comparisons: ShapingComparison[] = [];

  for (const spec of specs) {
    const fontAlias = spec.request.font_family;
    const fontFile = FONT_FILE_MAP[fontAlias] ?? `${fontAlias}-Regular.ttf`;
    const fontPath = resolve(fontsDir, fontFile);
    const fontSize = spec.request.font_size_px;
    const text = spec.request.text;

    // Check font file exists
    if (!existsSync(fontPath)) {
      console.warn(`SKIP ${spec.id} (font not found: ${fontPath})`);
      comparisons.push({
        id: spec.id,
        text,
        font: fontAlias,
        font_size_px: fontSize,
        hb_available: hbAvailable,
        match: {
          glyph_count: false,
          cluster_sequence: false,
          advance_within_tolerance: false,
          max_advance_diff: 0,
        },
      });
      continue;
    }

    // Get HarfBuzz glyphs
    const hbGlyphs = hbAvailable ? runHbShape(fontPath, fontSize, text) : null;

    // Get boundtext glyphs from all lines
    const btEntry = btResults.get(spec.id);
    const btGlyphs: BtGlyph[] = btEntry?.result?.lines?.flatMap((l) => l.glyphs ?? []) ?? [];

    // Compare
    const match = compareGlyphs(hbGlyphs, btGlyphs, fontSize);

    comparisons.push({
      id: spec.id,
      text,
      font: fontAlias,
      font_size_px: fontSize,
      hb_available: hbAvailable,
      hb_glyphs: hbGlyphs ?? undefined,
      bt_glyphs: btGlyphs.length > 0 ? btGlyphs : undefined,
      match,
    });

    // Status line
    const status = !hbAvailable
      ? "SKIP(no hb)"
      : match.glyph_count && match.cluster_sequence && match.advance_within_tolerance
        ? "MATCH"
        : "DIFF";
    const hbCount = hbGlyphs?.length ?? "?";
    const btCount = btGlyphs.length;
    console.info(
      `${status} ${spec.id} (glyphs: hb=${hbCount} bt=${btCount}, maxAdvDiff=${match.max_advance_diff.toFixed(3)})`,
    );
  }

  // Write output
  if (outputPath) {
    writeFileSync(resolve(outputPath), JSON.stringify(comparisons, null, 2));
    console.info(`\nResults written to ${outputPath}`);
  }

  // Summary
  const total = comparisons.length;
  const matched = comparisons.filter(
    (c) => c.match.glyph_count && c.match.cluster_sequence && c.match.advance_within_tolerance,
  ).length;
  const skipped = comparisons.filter((c) => !c.hb_available).length;
  const diffed = total - matched - skipped;

  console.info(`\n--- Summary ---`);
  console.info(`Total: ${total}  Match: ${matched}  Diff: ${diffed}  Skip: ${skipped}`);
}

main().catch(console.error);
