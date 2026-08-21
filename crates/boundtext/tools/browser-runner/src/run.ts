/**
 * browser-runner: Runs spec cases in Chromium/Firefox via Playwright.
 *
 * Usage:
 *   tsx src/run.ts --spec <spec-cases.json> --fonts <fonts-dir> [--browser chromium|firefox|both] [--output <output.json>] [--screenshots <dir>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { type Browser, chromium, firefox, type Page } from "playwright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpecCase = {
  id: string;
  category?: string;
  request: {
    text: string;
    font_family: string;
    font_size_px: number;
    max_width: number;
    max_height?: number;
    wrap?: string;
    fit?: string;
    max_lines?: number;
    ellipsis?: boolean;
    language?: string;
    writing_mode?: string;
    line_height?: number;
    line_height_px?: number;
    letter_spacing_px?: number;
    hanging_punctuation?: boolean;
    font_variation_settings?: Record<string, number>;
  };
};

type BrowserResult = {
  id: string;
  engine: string;
  break_indices: number[];
  line_count: number;
  overflow: boolean;
  bbox: { x: number; y: number; w: number; h: number };
  client_rects: Array<{ x: number; y: number; w: number; h: number }>;
  screenshot_path?: string;
};

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

/** Map font_family alias to actual CSS font-family name. */
function mapFontFamily(alias: string): string {
  const map: Record<string, string> = {
    NotoSansJP: "Noto Sans JP",
    NotoSerifJP: "Noto Serif JP",
    NotoSans: "Noto Sans",
    NotoSerif: "Noto Serif",
    NotoSansCJKjp: "Noto Sans CJK JP",
    ZenMaruGothic: "Zen Maru Gothic",
    Inter: "Inter",
  };
  return map[alias] ?? alias;
}

/** Map font alias to font file name. */
function mapFontFile(alias: string): string {
  const map: Record<string, string> = {
    NotoSansJP: "NotoSansJP-Regular.subset.ttf",
    NotoSerifJP: "NotoSerifJP-Regular.subset.ttf",
    NotoSansCJKjp: "NotoSansCJKjp-VF.subset.ttf",
    ZenMaruGothic: "ZenMaruGothic-Regular.subset.ttf",
    Inter: "Inter-Variable.ttf",
  };
  return map[alias] ?? `${alias}-Regular.ttf`;
}

/** Read font file and return base64 data URI. */
function fontToDataUri(fontPath: string): string | undefined {
  if (!existsSync(fontPath)) {
    return undefined;
  }
  const buf = readFileSync(fontPath);
  return `data:font/ttf;base64,${buf.toString("base64")}`;
}

function buildCSS(req: SpecCase["request"], overrides?: { fontSizePx?: number }): string {
  const isVertical = req.writing_mode === "VerticalRl";
  const writingMode = isVertical ? "vertical-rl" : "horizontal-tb";
  const wrap = (req.wrap ?? "Word").toLowerCase();

  let wrapCSS: string;
  switch (wrap) {
    case "none":
      wrapCSS = "white-space: pre; word-break: normal; overflow-wrap: normal;";
      break;
    case "char":
      wrapCSS = "word-break: break-all; line-break: anywhere; overflow-wrap: anywhere;";
      break;
    default: // Word
      // boundtext's Word mode breaks at word boundaries but also force-breaks
      // words that exceed max_width (like CSS overflow-wrap: break-word).
      wrapCSS = "word-break: normal; line-break: strict; overflow-wrap: break-word;";
      break;
  }

  const lineHeight = req.line_height_px ? `${req.line_height_px}px` : `${req.line_height ?? 1.2}`;

  // boundtext always interprets max_width/max_height as physical dimensions,
  // regardless of writing_mode.  No swap needed for vertical-rl.
  //
  // Known cross-browser inconsistency for vertical-rl:
  // CSS `width` is always the physical horizontal dimension.  In vertical-rl
  // the block axis is horizontal, so `width: 200px` sets the block-size to
  // 200px while the inline-size (physical height) is auto and collapses to
  // content height.  Chromium honours this literally, producing a wide
  // element (e.g. 200×72 for short text).  Firefox appears to shrink the
  // physical width to fit the content columns (e.g. 36×200), behaving as if
  // `width` maps to inline-size.  This causes the Chromium screenshot to be
  // a horizontal rectangle while Firefox/boundtext screenshots are vertical
  // for the same spec case.  The difference is a browser-level
  // interpretation gap, not a bug in the CSS mapping here.
  let sizeCSS = `width: ${req.max_width}px;`;
  if (req.max_height) {
    sizeCSS += ` max-height: ${req.max_height}px;`;
  }

  // Ellipsis CSS
  let ellipsisCSS = "";
  if (req.ellipsis) {
    if ((req.max_lines ?? 1) === 1) {
      // Single-line ellipsis
      ellipsisCSS = "white-space: nowrap; text-overflow: ellipsis;";
    } else {
      // Multi-line ellipsis via -webkit-line-clamp
      ellipsisCSS = `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${req.max_lines};`;
    }
  }

  // font-variation-settings CSS (e.g. 'wght' 700, 'wdth' 125)
  let variationCSS = "";
  if (req.font_variation_settings && Object.keys(req.font_variation_settings).length > 0) {
    const parts = Object.entries(req.font_variation_settings).map(
      ([tag, value]) => `'${tag}' ${value}`,
    );
    variationCSS = `font-variation-settings: ${parts.join(", ")};`;
  }

  return `
    .target {
      ${sizeCSS}
      font-family: "${mapFontFamily(req.font_family)}";
      font-size: ${overrides?.fontSizePx ?? req.font_size_px}px;
      line-height: ${lineHeight};
      letter-spacing: ${req.letter_spacing_px ?? 0}px;
      writing-mode: ${writingMode};
      text-orientation: mixed;
      overflow: hidden;
      ${wrapCSS}
      ${ellipsisCSS}
      ${variationCSS}
      margin: 0;
      padding: 0;
    }
  `.trim();
}

// ---------------------------------------------------------------------------
// Break index extraction (runs in browser context)
// ---------------------------------------------------------------------------

const EXTRACT_BREAK_INDICES_FN = `
  function extractBreakIndices(el) {
    const textNode = el.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return { breaks: [], rects: [] };

    const text = textNode.textContent || "";
    const range = document.createRange();
    const breaks = [];
    const rects = [];
    let prevMajor = null;
    const isVertical = getComputedStyle(el).writingMode.startsWith("vertical");

    // Collect per-character rects using Intl.Segmenter for grapheme accuracy
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const graphemes = [...segmenter.segment(text)];

    for (let gi = 0; gi < graphemes.length; gi++) {
      const seg = graphemes[gi];
      const charEnd = seg.index + seg.segment.length;

      range.setStart(textNode, seg.index);
      range.setEnd(textNode, charEnd);
      const rectList = Array.from(range.getClientRects());
      if (rectList.length === 0) continue;

      // Chromium returns two rects for trailing whitespace at line breaks:
      // one on the current line (with the actual width) and one on the next
      // line (with width=0).  Using the last rect would incorrectly assign
      // the space to the next line, producing break indices 1 less than
      // Firefox/boundtext.  To normalise, prefer the first rect with
      // non-zero size in the inline direction.
      //
      // Additionally, CSS-collapsed whitespace (e.g. consecutive spaces
      // under white-space:normal) may have ALL rects with zero inline size.
      // These graphemes have no visible rendering and their line assignment
      // differs between Chromium and Firefox.  Skip them entirely so that
      // the break index lands on the next visible grapheme instead.
      const inlineDim = isVertical ? "height" : "width";
      const effective = rectList.find(r => r[inlineDim] > 0);
      if (!effective) continue; // collapsed whitespace — skip

      const major = isVertical
        ? Math.round(effective.left * 10) / 10
        : Math.round(effective.top * 10) / 10;

      if (prevMajor !== null && major !== prevMajor) {
        breaks.push(gi);
      }
      prevMajor = major;
    }

    // Collect line rects
    range.setStart(textNode, 0);
    range.setEnd(textNode, text.length);
    const allRects = Array.from(range.getClientRects());
    for (const r of allRects) {
      rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }

    return { breaks, rects, lineCount: new Set(allRects.map(r => isVertical ? Math.round(r.left) : Math.round(r.top))).size };
  }
`;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runCase(
  page: Page,
  spec: SpecCase,
  fontsDir: string,
  engine: string,
  screenshotsDir?: string,
): Promise<BrowserResult> {
  const fontFile = mapFontFile(spec.request.font_family);
  const fontPath = resolve(fontsDir, fontFile);
  const fontFamily = mapFontFamily(spec.request.font_family);
  const fontDataUri = fontToDataUri(fontPath);
  const css = buildCSS(spec.request);

  const fontFaceRule = fontDataUri
    ? `@font-face {
          font-family: "${fontFamily}";
          src: url("${fontDataUri}") format("truetype");
          font-weight: 1 999;
          font-style: normal;
        }`
    : "";

  if (!fontDataUri) {
    console.warn(`  Font file not found: ${fontPath}`);
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        ${fontFaceRule}
        ${css}
        body { margin: 20px; background: white; }
      </style>
    </head>
    <body>
      <div class="target" id="target">${escapeHtml(spec.request.text)}</div>
    </body>
    </html>
  `;

  await page.setContent(html, { waitUntil: "networkidle" });

  // Wait for font to load
  await page.evaluate(async (family: string) => {
    await document.fonts.ready;
    const loaded = document.fonts.check(`16px "${family}"`);
    if (!loaded) {
      console.warn(`Font "${family}" may not have loaded`);
    }
  }, fontFamily);

  // Extract break indices and bbox
  const extracted = await page.evaluate((fn: string) => {
    // biome-ignore lint/security/noGlobalEval: injecting extraction function into Playwright browser context
    eval(fn);
    const el = document.getElementById("target");
    if (!el) {
      return { breaks: [], rects: [], lineCount: 0, bbox: { x: 0, y: 0, w: 0, h: 0 } };
    }
    // @ts-expect-error injected function
    const result = extractBreakIndices(el);
    const rect = el.getBoundingClientRect();
    return { ...result, bbox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  }, EXTRACT_BREAK_INDICES_FN);

  // Check overflow
  const overflow = await page.evaluate(() => {
    const el = document.getElementById("target");
    if (!el) {
      return false;
    }
    return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
  });

  // Screenshot
  let screenshotPath: string | undefined;
  if (screenshotsDir) {
    mkdirSync(screenshotsDir, { recursive: true });
    screenshotPath = resolve(screenshotsDir, `${spec.id}.${engine}.png`);
    const el = await page.$("#target");
    if (el) {
      await el.screenshot({ path: screenshotPath });
    }
  }

  return {
    id: spec.id,
    engine,
    break_indices: extracted.breaks as number[],
    line_count: extracted.lineCount as number,
    overflow,
    bbox: extracted.bbox as { x: number; y: number; w: number; h: number },
    client_rects: extracted.rects as Array<{ x: number; y: number; w: number; h: number }>,
    screenshot_path: screenshotPath ? basename(screenshotPath) : undefined,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// boundtext screenshot rendering
// ---------------------------------------------------------------------------

/**
 * Render boundtext layout results as screenshots via headless Chromium.
 *
 * boundtext is a Rust layout engine — it has no visual output of its own.
 * To produce a fair visual comparison we render boundtext's line-break
 * decisions (joined with <br>) in headless Chromium using the **same font
 * and CSS** as the browser comparison panels.  This ensures font rendering
 * is identical across all three columns (boundtext / Chromium / Firefox)
 * and avoids the report-viewer's browser influencing the comparison.
 *
 * Limitation: glyph shaping is still performed by the screenshot browser
 * (Chromium), not by boundtext's HarfBuzz.  The comparison therefore
 * validates line-break positions and bounding boxes, not per-glyph
 * metrics.
 *
 * **bbox vs screenshot size**: Screenshot dimensions reflect the CSS
 * element box (`width: max_width`), whereas boundtext's `bbox` reports
 * the actual text extent.  When text does not fill the full container
 * width the screenshot will be wider than the bbox (e.g. bbox.w = 96
 * but screenshot width = 100 for max_width = 100).  Browser bbox values
 * (from `getBoundingClientRect()`) always equal the element box, so they
 * match the screenshot dimensions.  This is an inherent difference in
 * what each bbox measures, not a rendering error.
 */

type BtCliResult = {
  id: string;
  result?: {
    lines: Array<{ text: string }>;
    chosen_font_size_px: number;
  };
};

async function renderBtScreenshots(
  btResultsPath: string,
  specPath: string,
  fontsDir: string,
  screenshotsDir: string,
  filterIds?: Set<string>,
): Promise<void> {
  let btResults: BtCliResult[] = JSON.parse(readFileSync(btResultsPath, "utf-8"));
  if (filterIds) {
    btResults = btResults.filter((r) => filterIds.has(r.id));
  }
  const specs: SpecCase[] = JSON.parse(readFileSync(specPath, "utf-8"));
  const specMap = new Map(specs.map((s) => [s.id, s]));

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error(`Failed to launch chromium for bt screenshots: ${error}`);
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  mkdirSync(screenshotsDir, { recursive: true });

  for (const bt of btResults) {
    if (!bt.result?.lines?.length) {
      continue;
    }
    const spec = specMap.get(bt.id);
    if (!spec) {
      continue;
    }

    const fontFile = mapFontFile(spec.request.font_family);
    const fontPath = resolve(fontsDir, fontFile);
    const fontFamily = mapFontFamily(spec.request.font_family);
    const fontDataUri = fontToDataUri(fontPath);
    // Use boundtext's actual chosen font size (may differ from spec due to fit)
    const css = buildCSS(spec.request, {
      fontSizePx: bt.result.chosen_font_size_px,
    });

    const fontFaceRule = fontDataUri
      ? `@font-face {
            font-family: "${fontFamily}";
            src: url("${fontDataUri}") format("truetype");
            font-weight: 1 999;
            font-style: normal;
          }`
      : "";

    const lineTexts = bt.result.lines.map((l) => escapeHtml(l.text)).join("<br>");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          ${fontFaceRule}
          ${css}
          body { margin: 20px; background: white; }
        </style>
      </head>
      <body>
        <div class="target" id="target">${lineTexts}</div>
      </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const el = await page.$("#target");
    if (el) {
      const outPath = resolve(screenshotsDir, `${bt.id}.boundtext.png`);
      await el.screenshot({ path: outPath });
    }
  }

  await browser.close();
}

/** Check if a spec case uses fit (Shrink/Grow) which has no CSS equivalent. */
function isFitCase(spec: SpecCase): boolean {
  const fit = String(spec.request.fit ?? "None");
  return fit !== "None";
}

/** Collect fit cases whose chosen_font_size_px differs from the spec's original. */
function collectFitCases(
  btResultsPath: string,
  specPath: string,
  filterIds?: Set<string>,
): Array<{ spec: SpecCase; chosenFontSizePx: number }> {
  let btResults: BtCliResult[] = JSON.parse(readFileSync(btResultsPath, "utf-8"));
  if (filterIds) {
    btResults = btResults.filter((r) => filterIds.has(r.id));
  }
  const specs: SpecCase[] = JSON.parse(readFileSync(specPath, "utf-8"));
  const specMap = new Map(specs.map((s) => [s.id, s]));

  const fitCases: Array<{ spec: SpecCase; chosenFontSizePx: number }> = [];
  for (const bt of btResults) {
    if (!bt.result) {
      continue;
    }
    const spec = specMap.get(bt.id);
    if (!spec || !isFitCase(spec)) {
      continue;
    }
    if (bt.result.chosen_font_size_px === spec.request.font_size_px) {
      continue;
    }
    fitCases.push({ spec, chosenFontSizePx: bt.result.chosen_font_size_px });
  }
  return fitCases;
}

/** Re-render a single fit case at the given font size and save a screenshot. */
async function renderFitCaseScreenshot(
  page: Page,
  spec: SpecCase,
  chosenFontSizePx: number,
  fontsDir: string,
  engine: string,
  screenshotsDir: string,
): Promise<void> {
  const fontFile = mapFontFile(spec.request.font_family);
  const fontPath = resolve(fontsDir, fontFile);
  const fontFamily = mapFontFamily(spec.request.font_family);
  const fontDataUri = fontToDataUri(fontPath);
  const css = buildCSS(spec.request, { fontSizePx: chosenFontSizePx });

  const fontFaceRule = fontDataUri
    ? `@font-face {
          font-family: "${fontFamily}";
          src: url("${fontDataUri}") format("truetype");
          font-weight: 1 999;
          font-style: normal;
        }`
    : "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        ${fontFaceRule}
        ${css}
        body { margin: 20px; background: white; }
      </style>
    </head>
    <body>
      <div class="target" id="target">${escapeHtml(spec.request.text)}</div>
    </body>
    </html>
  `;

  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(async (family: string) => {
    await document.fonts.ready;
    const loaded = document.fonts.check(`16px "${family}"`);
    if (!loaded) {
      console.warn(`Font "${family}" may not have loaded`);
    }
  }, fontFamily);

  const el = await page.$("#target");
  if (el) {
    const outPath = resolve(screenshotsDir, `${spec.id}.${engine}.png`);
    await el.screenshot({ path: outPath });
    console.info(
      `  ${spec.id}.${engine}: re-rendered at ${chosenFontSizePx}px (was ${spec.request.font_size_px}px)`,
    );
  }
}

/**
 * Re-render browser screenshots for fit cases at boundtext's chosen_font_size_px.
 *
 * For fit/shrink/grow cases, the initial browser screenshots use the spec's
 * original font_size_px because CSS has no equivalent of fit.  This produces
 * a meaningless visual comparison.  By re-rendering at the font size that
 * boundtext actually chose, we can verify that boundtext's line-break
 * decisions are correct *at that size*, separating fit-algorithm verification
 * (bbox check) from line-break verification (browser comparison).
 */
async function rerenderFitBrowserScreenshots(
  btResultsPath: string,
  specPath: string,
  fontsDir: string,
  screenshotsDir: string,
  engines: string[],
  filterIds?: Set<string>,
): Promise<void> {
  const fitCases = collectFitCases(btResultsPath, specPath, filterIds);
  if (fitCases.length === 0) {
    return;
  }

  console.info(
    `Re-rendering ${fitCases.length} fit case(s) at chosen_font_size_px for: ${engines.join(", ")}`,
  );

  for (const engine of engines) {
    const launcher = engine === "firefox" ? firefox : chromium;
    let browser: Browser;
    try {
      browser = await launcher.launch({ headless: true });
    } catch (error) {
      console.error(`Failed to launch ${engine} for fit re-render: ${error}`);
      continue;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    for (const { spec, chosenFontSizePx } of fitCases) {
      await renderFitCaseScreenshot(page, spec, chosenFontSizePx, fontsDir, engine, screenshotsDir);
    }

    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type CliArgs = {
  specPath: string;
  fontsDir: string;
  browserType: string;
  outputPath: string;
  screenshotsDir: string;
  btResultsPath: string;
  filterIds?: Set<string>;
  skipBrowser: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const options: CliArgs = {
    specPath: "",
    fontsDir: "",
    browserType: "chromium",
    outputPath: "",
    screenshotsDir: "",
    btResultsPath: "",
    skipBrowser: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--spec":
        options.specPath = argv[++i];
        break;
      case "--fonts":
        options.fontsDir = argv[++i];
        break;
      case "--browser":
        options.browserType = argv[++i];
        break;
      case "--output":
        options.outputPath = argv[++i];
        break;
      case "--screenshots":
        options.screenshotsDir = argv[++i];
        break;
      case "--bt-results":
        options.btResultsPath = argv[++i];
        break;
      case "--ids":
        options.filterIds = new Set(argv[++i].split(","));
        break;
      case "--bt-only":
        options.skipBrowser = true;
        break;
    }
  }
  return options;
}

async function runBrowserSpecs(
  specs: SpecCase[],
  engines: string[],
  fontsDir: string,
  screenshotsDir: string,
): Promise<BrowserResult[]> {
  const allResults: BrowserResult[] = [];

  for (const engine of engines) {
    console.info(`\nLaunching ${engine}...`);
    const launcher = engine === "firefox" ? firefox : chromium;
    let browser: Browser;
    try {
      browser = await launcher.launch({ headless: true });
    } catch (error) {
      console.error(`Failed to launch ${engine}: ${error}`);
      console.error(`Run: npx playwright install ${engine}`);
      continue;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    for (const spec of specs) {
      try {
        const result = await runCase(page, spec, fontsDir, engine, screenshotsDir);
        allResults.push(result);
        console.info(
          `  ${result.id}: ${result.line_count} lines, breaks=[${result.break_indices}]`,
        );
      } catch (error) {
        console.error(`  ${spec.id}: ERROR - ${error}`);
        allResults.push({
          id: spec.id,
          engine,
          break_indices: [],
          line_count: 0,
          overflow: false,
          bbox: { x: 0, y: 0, w: 0, h: 0 },
          client_rects: [],
        });
      }
    }

    await browser.close();
  }

  return allResults;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const {
    specPath,
    browserType,
    outputPath,
    screenshotsDir,
    btResultsPath,
    filterIds,
    skipBrowser,
  } = options;
  let { fontsDir } = options;

  if (!specPath || !fontsDir) {
    console.error(
      [
        "Usage: tsx src/run.ts --spec <spec.json> --fonts <fonts-dir>",
        "  [--browser chromium|firefox|both] [--output <out.json>]",
        "  [--screenshots <dir>] [--bt-results <boundtext-output.json>]",
        "  [--ids id1,id2,...] [--bt-only]",
        "",
        "Options:",
        "  --ids      Run only the specified case IDs (comma-separated)",
        "  --bt-only  Skip browser runs, only regenerate boundtext screenshots",
      ].join("\n"),
    );
    process.exit(1);
  }

  let specs: SpecCase[] = JSON.parse(readFileSync(specPath, "utf-8"));
  if (filterIds) {
    specs = specs.filter((s) => filterIds.has(s.id));
    if (specs.length === 0) {
      console.error(`No spec cases matched --ids filter`);
      process.exit(1);
    }
    console.info(`Filtered to ${specs.length} case(s): ${specs.map((s) => s.id).join(", ")}`);
  }
  fontsDir = resolve(fontsDir);

  if (skipBrowser) {
    console.info("Skipping browser runs (--bt-only)");
  }

  const engines = skipBrowser
    ? []
    : browserType === "both"
      ? ["chromium", "firefox"]
      : [browserType];
  const allResults = await runBrowserSpecs(specs, engines, fontsDir, screenshotsDir);

  const json = JSON.stringify(allResults, null, 2);

  if (outputPath) {
    writeFileSync(outputPath, json);
    console.info(`\nResults written to ${outputPath}`);
  } else if (!skipBrowser) {
    console.info("\n=== Browser Results ===");
    console.info(json);
  }

  // Render boundtext results as screenshots via headless Chromium
  if (btResultsPath && screenshotsDir) {
    console.info("\nRendering boundtext screenshots via headless Chromium...");
    await renderBtScreenshots(btResultsPath, specPath, fontsDir, screenshotsDir, filterIds);
    console.info("boundtext screenshots done.");

    // Re-render browser screenshots for fit cases at chosen_font_size_px.
    // This overwrites the initial screenshots (captured at the spec's original
    // font_size_px) so the visual comparison shows all engines at the same size.
    if (engines.length > 0) {
      await rerenderFitBrowserScreenshots(
        btResultsPath,
        specPath,
        fontsDir,
        screenshotsDir,
        engines,
        filterIds,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
