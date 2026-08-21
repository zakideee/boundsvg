// ---------------------------------------------------------------------------
// CLI argument parsing — convert subcommand
// ---------------------------------------------------------------------------

import type { CodegenFontDef, CodegenRendererMode, DynamicTextSpec } from "@boundsvg/core/codegen";

export const DEFAULT_FONT_WEIGHT = 400;
export const DEFAULT_PNG_SCALE = 2;
export const PNG_SCALE_MIN = 1;
export const PNG_SCALE_MAX = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConvertFormat = "bound-component" | "scene";
export type ConvertInputFormat = "svg" | "scene";

export type CliOptions = {
  input: string;
  output: string;
  name: string;
  inputFormat: ConvertInputFormat;
  defaultFont: string;
  fontMap: Record<string, string>;
  fontSources: CodegenFontDef[];
  dynamicTexts: DynamicTextSpec[];
  renderer: CodegenRendererMode;
  wrap: "none" | "word" | "char";
  fit: "none" | "shrink" | "grow";
  textPathMode: "merged" | "glyphs";
  pngScale: number;
  format: ConvertFormat;
  verbose: boolean;
  dryRun: boolean;
  watch: boolean;
  inputSource: "file" | "stdin";
  outputTarget: "file" | "stdout";
};

type ParsedConvertCommand = {
  options: CliOptions;
  allInputs: string[];
};

type StderrWriter = (message: string) => void;

// ---------------------------------------------------------------------------
// Shared argument sub-parsers (exported for reuse in export CLI)
// ---------------------------------------------------------------------------

function parseRendererArg(value: string, fallback: CodegenRendererMode): CodegenRendererMode {
  if (value === "boundsvg" || value === "svg-hook" || value === "png-hook") {
    return value;
  }
  return fallback;
}

export function parseWrapArg(
  value: string,
  fallback: "none" | "word" | "char",
): "none" | "word" | "char" {
  if (value === "none" || value === "word" || value === "char") {
    return value;
  }
  return fallback;
}

export function parseFitArg(
  value: string,
  fallback: "none" | "shrink" | "grow",
): "none" | "shrink" | "grow" {
  if (value === "none" || value === "shrink" || value === "grow") {
    return value;
  }
  return fallback;
}

export function parseTextPathModeArg(
  value: string,
  fallback: "merged" | "glyphs",
): "merged" | "glyphs" {
  if (value === "merged" || value === "glyphs") {
    return value;
  }
  return fallback;
}

export function parsePngScaleArg(input: string, fallback: number): number {
  const parsed = parseInt(input, 10);
  if (Number.isFinite(parsed) && parsed >= PNG_SCALE_MIN && parsed <= PNG_SCALE_MAX) {
    return parsed;
  }
  return fallback;
}

export function parseFontSourceArg(sourceStr: string, defaultFont: string): CodegenFontDef {
  // Parse "alias:weight:style:path" or just treat as path
  const parts = sourceStr.split(":");
  if (parts.length >= 4) {
    return {
      alias: parts[0] ?? "",
      weight: parseInt(parts[1] ?? String(DEFAULT_FONT_WEIGHT), 10) || DEFAULT_FONT_WEIGHT,
      style: parts[2] === "italic" ? "italic" : "normal",
      source: parts.slice(3).join(":"),
    };
  }
  // Simple path — use defaultFont alias
  return {
    alias: defaultFont || "default",
    weight: DEFAULT_FONT_WEIGHT,
    style: "normal",
    source: sourceStr,
  };
}

export function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function applyFontMap(fontMap: Record<string, string>, mapStr: string): void {
  const mapping = parseFontMapArg(mapStr);
  if (mapping) {
    fontMap[mapping.key] = mapping.value;
  }
}

function applyDynamicText(dynamicTexts: DynamicTextSpec[], dynStr: string): void {
  const spec = parseDynamicTextArg(dynStr);
  if (spec) {
    dynamicTexts.push(spec);
  }
}

function parseConvertFormatArg(value: string, fallback: ConvertFormat): ConvertFormat {
  if (value === "bound-component" || value === "scene") {
    return value;
  }
  return fallback;
}

function parseConvertInputFormatArg(
  value: string,
  fallback: ConvertInputFormat,
): ConvertInputFormat {
  if (value === "svg" || value === "scene") {
    return value;
  }
  return fallback;
}

function detectConvertInputFormat(inputPath: string): ConvertInputFormat {
  if (inputPath.endsWith(".scene.json") || inputPath.endsWith(".json")) {
    return "scene";
  }
  return "svg";
}

function resolveCliDefaults(
  raw: {
    input: string;
    output: string;
    name: string;
    inputFormat: ConvertInputFormat;
    defaultFont: string;
    fontSources: CodegenFontDef[];
    format: ConvertFormat;
  },
  writeStderr: StderrWriter,
): {
  input: string;
  output: string;
  name: string;
  inputFormat: ConvertInputFormat;
  fontSources: CodegenFontDef[];
} | null {
  if (!raw.input) {
    writeStderr("Error: --input is required\n");
    printConvertUsage(writeStderr);
    return null;
  }

  // SVG input requires --default-font; scene input does not
  if (raw.inputFormat === "svg" && !raw.defaultFont) {
    writeStderr("Error: --default-font is required for SVG input\n");
    printConvertUsage(writeStderr);
    return null;
  }

  let { output, name } = raw;
  const { input, inputFormat, defaultFont, fontSources, format } = raw;

  // Derive output path
  if (!output) {
    const base = input
      .replace(/\.scene\.json$/i, "")
      .replace(/\.json$/i, "")
      .replace(/\.svg$/i, "");
    if (format === "scene") {
      output = `${base}.scene.json`;
    } else {
      output = `${base}.tsx`;
    }
  }

  // Derive component name
  if (!name) {
    const inputBasename = input.split("/").pop() ?? input;
    name = toPascalCase(
      inputBasename
        .replace(/\.scene\.json$/i, "")
        .replace(/\.json$/i, "")
        .replace(/\.svg$/i, ""),
    );
  }

  // Auto-create default font source for SVG input
  if (fontSources.length === 0 && defaultFont) {
    fontSources.push({
      alias: defaultFont,
      weight: DEFAULT_FONT_WEIGHT,
      style: "normal",
      source: `/fonts/${defaultFont}.woff2`,
    });
  }

  return { input, output, name, inputFormat, fontSources };
}

function parseDynamicTextArg(dynStr: string): DynamicTextSpec | null {
  const colonIdx = dynStr.indexOf(":");
  if (colonIdx <= 0) {
    return null;
  }
  const textIndex = parseInt(dynStr.slice(0, colonIdx), 10);
  const rest = dynStr.slice(colonIdx + 1);
  const secondColon = rest.indexOf(":");
  if (secondColon <= 0) {
    return null;
  }
  return {
    textIndex,
    propName: rest.slice(0, secondColon),
    defaultValue: rest.slice(secondColon + 1),
  };
}

function parseFontMapArg(mapStr: string): { key: string; value: string } | null {
  const eqIdx = mapStr.indexOf("=");
  if (eqIdx <= 0) {
    return null;
  }
  return { key: mapStr.slice(0, eqIdx), value: mapStr.slice(eqIdx + 1) };
}

// ---------------------------------------------------------------------------
// Mutable parse state used during argument scanning
// ---------------------------------------------------------------------------

type ConvertParseState = {
  inputs: string[];
  output: string;
  name: string;
  defaultFont: string;
  inputFormat: ConvertInputFormat | undefined;
  fontMap: Record<string, string>;
  fontSources: CodegenFontDef[];
  dynamicTexts: DynamicTextSpec[];
  renderer: CodegenRendererMode;
  wrap: "none" | "word" | "char";
  fit: "none" | "shrink" | "grow";
  textPathMode: "merged" | "glyphs";
  pngScale: number;
  format: ConvertFormat;
  verbose: boolean;
  dryRun: boolean;
  watch: boolean;
};

/**
 * Lookup table mapping each CLI flag to a handler that mutates parse state
 * and returns the updated arg index.
 */
const convertArgHandlers: Record<
  string,
  (args: string[], i: number, state: ConvertParseState) => number
> = {
  "--input": (args, i, state) => {
    state.inputs.push(args[i + 1] ?? "");
    return i + 1;
  },
  "-i": (args, i, state) => {
    state.inputs.push(args[i + 1] ?? "");
    return i + 1;
  },
  "--output": (args, i, state) => {
    state.output = args[i + 1] ?? "";
    return i + 1;
  },
  "-o": (args, i, state) => {
    state.output = args[i + 1] ?? "";
    return i + 1;
  },
  "--name": (args, i, state) => {
    state.name = args[i + 1] ?? "";
    return i + 1;
  },
  "-n": (args, i, state) => {
    state.name = args[i + 1] ?? "";
    return i + 1;
  },
  "--default-font": (args, i, state) => {
    state.defaultFont = args[i + 1] ?? "";
    return i + 1;
  },
  "--input-format": (args, i, state) => {
    state.inputFormat = parseConvertInputFormatArg(args[i + 1] ?? "svg", "svg");
    return i + 1;
  },
  "--font-map": (args, i, state) => {
    applyFontMap(state.fontMap, args[i + 1] ?? "");
    return i + 1;
  },
  "--font-source": (args, i, state) => {
    state.fontSources.push(parseFontSourceArg(args[i + 1] ?? "", state.defaultFont));
    return i + 1;
  },
  "--dynamic": (args, i, state) => {
    applyDynamicText(state.dynamicTexts, args[i + 1] ?? "");
    return i + 1;
  },
  "-d": (args, i, state) => {
    applyDynamicText(state.dynamicTexts, args[i + 1] ?? "");
    return i + 1;
  },
  "--renderer": (args, i, state) => {
    state.renderer = parseRendererArg(args[i + 1] ?? "boundsvg", state.renderer);
    return i + 1;
  },
  "--wrap": (args, i, state) => {
    state.wrap = parseWrapArg(args[i + 1] ?? "word", state.wrap);
    return i + 1;
  },
  "--fit": (args, i, state) => {
    state.fit = parseFitArg(args[i + 1] ?? "shrink", state.fit);
    return i + 1;
  },
  "--text-path-mode": (args, i, state) => {
    state.textPathMode = parseTextPathModeArg(args[i + 1] ?? "merged", state.textPathMode);
    return i + 1;
  },
  "--png-scale": (args, i, state) => {
    state.pngScale = parsePngScaleArg(args[i + 1] ?? String(DEFAULT_PNG_SCALE), state.pngScale);
    return i + 1;
  },
  "--format": (args, i, state) => {
    state.format = parseConvertFormatArg(args[i + 1] ?? "bound-component", state.format);
    return i + 1;
  },
  "--verbose": (_args, i, state) => {
    state.verbose = true;
    return i;
  },
  "-v": (_args, i, state) => {
    state.verbose = true;
    return i;
  },
  "--dry-run": (_args, i, state) => {
    state.dryRun = true;
    return i;
  },
  "--watch": (_args, i, state) => {
    state.watch = true;
    return i;
  },
};

function scanConvertArgs(args: string[]): ConvertParseState {
  const state: ConvertParseState = {
    inputs: [],
    output: "",
    name: "",
    defaultFont: "",
    inputFormat: undefined,
    fontMap: {},
    fontSources: [],
    dynamicTexts: [],
    renderer: "boundsvg",
    wrap: "word",
    fit: "shrink",
    textPathMode: "merged",
    pngScale: DEFAULT_PNG_SCALE,
    format: "bound-component",
    verbose: false,
    dryRun: false,
    watch: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const handler = convertArgHandlers[arg];
    if (handler) {
      i = handler(args, i, state);
    } else if (state.inputs.length === 0 && !arg.startsWith("-")) {
      state.inputs.push(arg);
    }
  }

  return state;
}

function resolveIoSources(state: ConvertParseState): {
  inputSource: "file" | "stdin";
  outputTarget: "file" | "stdout";
} {
  let inputSource: "file" | "stdin" = "file";
  let outputTarget: "file" | "stdout" = "file";

  if (state.inputs.length > 0 && state.inputs[0] === "-") {
    inputSource = "stdin";
    state.inputs.length = 0;
  }

  if (state.output === "-") {
    outputTarget = "stdout";
    state.output = "";
  }

  return { inputSource, outputTarget };
}

function resolveStdinConvert(
  state: ConvertParseState,
  initialOutputTarget: "file" | "stdout",
  writeStderr: StderrWriter,
): ParsedConvertCommand | null {
  if (!state.name) {
    state.name = "Component";
  }
  if (!state.inputFormat) {
    state.inputFormat = "svg";
  }
  const outputTarget = !state.output ? "stdout" : initialOutputTarget;

  const resolvedInputFormat = state.inputFormat;

  if (resolvedInputFormat === "svg" && !state.defaultFont) {
    writeStderr("Error: --default-font is required for SVG input\n");
    printConvertUsage(writeStderr);
    return null;
  }

  if (state.fontSources.length === 0 && state.defaultFont) {
    state.fontSources.push({
      alias: state.defaultFont,
      weight: DEFAULT_FONT_WEIGHT,
      style: "normal",
      source: `/fonts/${state.defaultFont}.woff2`,
    });
  }

  return {
    options: {
      input: "",
      output: "",
      name: state.name,
      inputFormat: resolvedInputFormat,
      defaultFont: state.defaultFont,
      fontMap: state.fontMap,
      fontSources: state.fontSources,
      dynamicTexts: state.dynamicTexts,
      renderer: state.renderer,
      wrap: state.wrap,
      fit: state.fit,
      textPathMode: state.textPathMode,
      pngScale: state.pngScale,
      format: state.format,
      verbose: state.verbose,
      dryRun: state.dryRun,
      watch: state.watch,
      inputSource: "stdin",
      outputTarget,
    },
    allInputs: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const defaultWriteStderr: StderrWriter = (message) => process.stderr.write(message);

/**
 * Parse convert subcommand arguments.
 * `args` should already have `node`, script path, and `convert` subcommand stripped.
 */
export function parseConvertArgs(
  args: string[],
  writeStderr: StderrWriter = defaultWriteStderr,
): ParsedConvertCommand | null {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printConvertUsage(writeStderr);
    return null;
  }

  const state = scanConvertArgs(args);
  const { inputSource, outputTarget } = resolveIoSources(state);

  // stdin path
  if (inputSource === "stdin") {
    return resolveStdinConvert(state, outputTarget, writeStderr);
  }

  // Normal (file) path
  const input = state.inputs[0] ?? "";

  // Auto-detect input format if not specified
  const resolvedInputFormat = state.inputFormat ?? detectConvertInputFormat(input);

  const resolved = resolveCliDefaults(
    {
      input,
      output: state.output,
      name: state.name,
      inputFormat: resolvedInputFormat,
      defaultFont: state.defaultFont,
      fontSources: state.fontSources,
      format: state.format,
    },
    writeStderr,
  );
  if (!resolved) {
    return null;
  }

  return {
    options: {
      input: resolved.input,
      output: resolved.output,
      name: resolved.name,
      inputFormat: resolved.inputFormat,
      defaultFont: state.defaultFont,
      fontMap: state.fontMap,
      fontSources: resolved.fontSources,
      dynamicTexts: state.dynamicTexts,
      renderer: state.renderer,
      wrap: state.wrap,
      fit: state.fit,
      textPathMode: state.textPathMode,
      pngScale: state.pngScale,
      format: state.format,
      verbose: state.verbose,
      dryRun: state.dryRun,
      watch: state.watch,
      inputSource,
      outputTarget,
    },
    allInputs: state.inputs,
  };
}

/** @deprecated Use parseConvertArgs instead. Kept for backward compatibility. */
export function parseArgs(argv: string[]): CliOptions | null {
  const parsed = parseConvertArgs(argv.slice(2));
  return parsed ? parsed.options : null;
}

function printConvertUsage(writeStderr: StderrWriter = defaultWriteStderr): void {
  writeStderr(`
Usage: boundsvg convert [options]

Options:
  --input, -i <file>           Input SVG or .scene.json file (required, repeatable for batch)
  --output, -o <file|dir>      Output file or directory for batch (default: derived from input)
  --input-format <fmt>         svg | scene (default: auto-detect from extension)
  --name, -n <name>            Component name (default: PascalCase of filename)
  --default-font <font>        Default font alias (required for SVG input)
  --font-map <SVGFamily=alias> Map SVG font-family to alias (repeatable)
  --font-source <spec>         Font source (alias:weight:style:path or just path)
  --dynamic, -d <spec>         Dynamic text (index:propName:default) (repeatable)
  --renderer <mode>            boundsvg | svg-hook | png-hook (default: boundsvg)
  --format <fmt>               bound-component | scene (default: bound-component)
                               bound-component: React component with @boundsvg/react runtime
                               scene: Scene Document JSON (input for 'boundsvg export')
  --wrap <mode>                none | word | char (default: word)
  --fit <mode>                 none | shrink | grow (default: shrink)
  --text-path-mode <mode>      merged | glyphs (default: merged)
  --png-scale <n>              PNG scale 1-4 for png-hook (default: 2)
  --dry-run                    Preview changes without writing files
  --watch                      Watch input files and re-convert on change
  --verbose, -v                Show warnings on stderr
  --help, -h                   Show this help message

Stdin/stdout:
  -i -                         Read from stdin
  -o -                         Write to stdout
  Piped input auto-detected when --input is omitted

Examples:
  boundsvg convert --input card.svg --default-font NotoSansJP
  boundsvg convert -i card.svg --default-font NotoSansJP --format scene
  boundsvg convert -i card.scene.json --format bound-component
  boundsvg convert -i card.svg --default-font NotoSansJP --dry-run
  boundsvg convert -i 'fixtures/*.svg' --default-font NotoSansJP
  cat card.svg | boundsvg convert --default-font NotoSansJP --format scene
  boundsvg convert -i card.svg --default-font NotoSansJP --watch
`);
}
