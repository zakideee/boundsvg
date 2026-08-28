// ---------------------------------------------------------------------------
// CLI argument parsing — export subcommand
// ---------------------------------------------------------------------------

import type { CodegenFontDef } from "@boundsvg/core/codegen";
import {
  DEFAULT_PNG_SCALE,
  parseFitArg,
  parseFontSourceArg,
  parseTextPathModeArg,
  parseWrapArg,
  toPascalCase,
} from "./cli.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportInputFormat = "svg" | "scene";
export type ExportOutputFormat =
  | "svg"
  | "png"
  | "webp"
  | "animated-webp"
  | "gif"
  | "layered-svg"
  | "layered-png"
  | "static-component"
  | "mp4";

export type ExportOptions = {
  input: string;
  output: string;
  inputFormat: ExportInputFormat;
  format: ExportOutputFormat;
  defaultFont: string;
  fontSources: CodegenFontDef[];
  fontMap: Record<string, string>;
  wrap: "none" | "word" | "char";
  fit: "none" | "shrink" | "grow";
  textPathMode: "merged" | "glyphs";
  scale: number;
  /** Animation sampling rate for animated formats. Undefined when not supplied. */
  fps: number | undefined;
  /** Raw `--fps` token. MP4 needs it to recover a rational rate a number cannot hold. */
  fpsArg: string | undefined;
  /** Animation length for animated formats. Undefined when not supplied. */
  durationMs: number | undefined;
  /** Total play count for animated raster formats. Omission resolves to infinite playback. */
  iterations: number | "infinite" | undefined;
  /** Target bitrate in bits per second for mp4. Undefined leaves the encoder on quality mode. */
  bitrate: number | undefined;
  debug: boolean;
  verbose: boolean;
  inspect: boolean;
  report: string;
  /** Component name for static-component output (PascalCase, derived from input filename) */
  componentName: string;
  dryRun: boolean;
  watch: boolean;
  inputSource: "file" | "stdin";
  outputTarget: "file" | "stdout";
};

type ParsedExportCommand = {
  options: ExportOptions;
  allInputs: string[];
};

type StderrWriter = (message: string) => void;

/** A retired flag seen on the command line, with the flag that replaced it. */
type RetiredFlagUse = {
  flag: string;
  replacement: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a numeric flag value, recording the flag when it is missing or not a
 * number. Silently falling back would render at options the caller never asked
 * for, which is exactly the failure the retired-flag guard above prevents.
 */
function readNumberArg(
  state: ExportParseState,
  flag: string,
  raw: string | undefined,
): number | undefined {
  if (raw === undefined || raw.startsWith("-") || raw.trim() === "") {
    state.invalidFlagValues.push(flag);
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    state.invalidFlagValues.push(flag);
    return undefined;
  }
  return parsed;
}

function readIterationsArg(
  state: ExportParseState,
  raw: string | undefined,
): number | "infinite" | undefined {
  if (raw === "infinite") {
    return raw;
  }
  return readNumberArg(state, "--iterations", raw);
}

/**
 * `export` flags that no longer exist, mapped to their replacement. Kept so a
 * stale invocation fails loudly instead of rendering with silently different
 * options.
 */
const RETIRED_EXPORT_FLAGS: Record<string, string> = {
  "--png-scale": "--scale",
};

/**
 * Match a token against the retired flags, accepting both the space-separated
 * and the `--flag=value` spelling so neither form can slip through unnoticed.
 */
function matchRetiredFlag(arg: string): RetiredFlagUse | undefined {
  const entry = Object.entries(RETIRED_EXPORT_FLAGS).find(
    ([flag]) => arg === flag || arg.startsWith(`${flag}=`),
  );
  return entry ? { flag: entry[0], replacement: entry[1] } : undefined;
}

function detectInputFormat(inputPath: string): ExportInputFormat {
  if (inputPath.endsWith(".scene.json") || inputPath.endsWith(".json")) {
    return "scene";
  }
  return "svg";
}

function deriveOutputPath(inputPath: string, format: ExportOutputFormat): string {
  const base = inputPath
    .replace(/\.scene\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/\.svg$/i, "");
  if (format === "png") {
    return `${base}.png`;
  }
  if (format === "webp" || format === "animated-webp") {
    return `${base}.webp`;
  }
  if (format === "gif") {
    return `${base}.gif`;
  }
  if (format === "mp4") {
    return `${base}.mp4`;
  }
  if (format === "layered-svg" || format === "layered-png") {
    return `${base}.layers`;
  }
  if (format === "static-component") {
    return `${base}.tsx`;
  }
  return `${base}.rendered.svg`;
}

export function deriveExportExtension(format: ExportOutputFormat): string {
  if (format === "png") {
    return ".png";
  }
  if (format === "webp" || format === "animated-webp") {
    return ".webp";
  }
  if (format === "gif") {
    return ".gif";
  }
  if (format === "mp4") {
    return ".mp4";
  }
  if (format === "layered-svg" || format === "layered-png") {
    return ".layers";
  }
  if (format === "static-component") {
    return ".tsx";
  }
  return ".rendered.svg";
}

function parseExportOutputFormatArg(value: string | undefined): ExportOutputFormat | undefined {
  if (
    value === "svg" ||
    value === "png" ||
    value === "webp" ||
    value === "animated-webp" ||
    value === "gif" ||
    value === "layered-svg" ||
    value === "layered-png" ||
    value === "static-component" ||
    value === "mp4"
  ) {
    return value;
  }
  return undefined;
}

function parseExportInputFormatArg(value: string, fallback: ExportInputFormat): ExportInputFormat {
  if (value === "svg" || value === "scene") {
    return value;
  }
  return fallback;
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

type ExportParseState = {
  inputs: string[];
  output: string;
  defaultFont: string;
  componentName: string;
  inputFormat: ExportInputFormat | undefined;
  format: ExportOutputFormat;
  fontSources: CodegenFontDef[];
  fontMap: Record<string, string>;
  wrap: "none" | "word" | "char";
  fit: "none" | "shrink" | "grow";
  textPathMode: "merged" | "glyphs";
  scale: number;
  fps: number | undefined;
  fpsArg: string | undefined;
  durationMs: number | undefined;
  iterations: number | "infinite" | undefined;
  /** Valid numeric value supplied through the removed `--loop` flag. */
  legacyLoop: number | undefined;
  bitrate: number | undefined;
  /** Whether --format was supplied, which suppresses output-extension inference. */
  formatExplicit: boolean;
  /** Flags whose value could not be parsed; reported as a usage error. */
  invalidFlagValues: string[];
  /** Boolean flags given a `=value`; reported as a usage error. */
  valuelessFlagsWithValue: string[];
  debug: boolean;
  verbose: boolean;
  inspect: boolean;
  report: string;
  dryRun: boolean;
  watch: boolean;
  /** Flags that were removed or renamed; reported as a usage error. */
  retiredFlags: RetiredFlagUse[];
};

/**
 * Flags that consume the next argument. Everything else in the handler table
 * is a switch, so a `=value` spelling of one is a mistake rather than a
 * setting to honor.
 */
const VALUE_FLAGS = new Set([
  "--input",
  "-i",
  "--output",
  "-o",
  "--default-font",
  "--name",
  "-n",
  "--input-format",
  "--format",
  "--font",
  "--font-map",
  "--wrap",
  "--fit",
  "--text-path-mode",
  "--scale",
  "--fps",
  "--duration-ms",
  "--iterations",
  "--loop",
  "--bitrate",
  "--report",
]);

/**
 * Lookup table mapping each CLI flag to a handler that mutates parse state
 * and returns the updated arg index.
 */
const exportArgHandlers: Record<
  string,
  (args: string[], i: number, state: ExportParseState) => number
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
  "--default-font": (args, i, state) => {
    state.defaultFont = args[i + 1] ?? "";
    return i + 1;
  },
  "--name": (args, i, state) => {
    state.componentName = args[i + 1] ?? "";
    return i + 1;
  },
  "-n": (args, i, state) => {
    state.componentName = args[i + 1] ?? "";
    return i + 1;
  },
  "--input-format": (args, i, state) => {
    state.inputFormat = parseExportInputFormatArg(args[i + 1] ?? "svg", "svg");
    return i + 1;
  },
  "--format": (args, i, state) => {
    const parsed = parseExportOutputFormatArg(args[i + 1]);
    if (parsed === undefined) {
      // Falling back to the default would write, say, SVG text into the .webp
      // path the caller asked for, with a zero exit code.
      state.invalidFlagValues.push("--format");
      return i + 1;
    }
    state.format = parsed;
    state.formatExplicit = true;
    return i + 1;
  },
  "--font": (args, i, state) => {
    state.fontSources.push(parseFontSourceArg(args[i + 1] ?? "", state.defaultFont));
    return i + 1;
  },
  "--font-map": (args, i, state) => {
    const mapping = parseFontMapArg(args[i + 1] ?? "");
    if (mapping) {
      state.fontMap[mapping.key] = mapping.value;
    }
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
  "--scale": (args, i, state) => {
    const scale = readNumberArg(state, "--scale", args[i + 1]);
    if (scale !== undefined) {
      state.scale = scale;
    }
    return i + 1;
  },
  "--fps": (args, i, state) => {
    const raw = args[i + 1];
    state.fpsArg = raw;
    if (raw?.includes("/")) {
      // Only mp4 takes a rational spelling, and --format may not have been seen
      // yet, so the decision is deferred to per-format validation rather than
      // made here from a half-parsed command line.
      state.fps = undefined;
      return i + 1;
    }
    state.fps = readNumberArg(state, "--fps", raw);
    return i + 1;
  },
  "--duration-ms": (args, i, state) => {
    state.durationMs = readNumberArg(state, "--duration-ms", args[i + 1]);
    return i + 1;
  },
  "--iterations": (args, i, state) => {
    state.iterations = readIterationsArg(state, args[i + 1]);
    return i + 1;
  },
  "--loop": (args, i, state) => {
    state.legacyLoop = readNumberArg(state, "--loop", args[i + 1]);
    return i + 1;
  },
  "--bitrate": (args, i, state) => {
    state.bitrate = readNumberArg(state, "--bitrate", args[i + 1]);
    return i + 1;
  },
  "--debug": (_args, i, state) => {
    state.debug = true;
    return i;
  },
  "--verbose": (_args, i, state) => {
    state.verbose = true;
    return i;
  },
  "-v": (_args, i, state) => {
    state.verbose = true;
    return i;
  },
  "--inspect": (_args, i, state) => {
    state.inspect = true;
    return i;
  },
  "--report": (args, i, state) => {
    state.report = args[i + 1] ?? "";
    return i + 1;
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

function scanExportArgs(args: string[]): ExportParseState {
  const state: ExportParseState = {
    inputs: [],
    output: "",
    defaultFont: "",
    componentName: "",
    inputFormat: undefined,
    format: "svg",
    fontSources: [],
    fontMap: {},
    wrap: "word",
    fit: "shrink",
    textPathMode: "merged",
    scale: DEFAULT_PNG_SCALE,
    fps: undefined,
    fpsArg: undefined,
    bitrate: undefined,
    durationMs: undefined,
    iterations: undefined,
    legacyLoop: undefined,
    formatExplicit: false,
    invalidFlagValues: [],
    valuelessFlagsWithValue: [],
    debug: false,
    verbose: false,
    inspect: false,
    report: "",
    dryRun: false,
    watch: false,
    retiredFlags: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const retiredFlag = matchRetiredFlag(arg);
    if (retiredFlag) {
      state.retiredFlags.push(retiredFlag);
      continue;
    }
    // `--flag=value` reaches the same handler as `--flag value` by splicing the
    // inline value in. Dropping it would render at options the caller thinks
    // they set — the failure this scanner otherwise reports.
    const equalsIndex = arg.startsWith("-") ? arg.indexOf("=") : -1;
    if (equalsIndex > 0) {
      const flag = arg.slice(0, equalsIndex);
      const inlineHandler = exportArgHandlers[flag];
      if (inlineHandler && VALUE_FLAGS.has(flag)) {
        inlineHandler([flag, arg.slice(equalsIndex + 1)], 0, state);
        continue;
      }
      if (inlineHandler) {
        // A boolean flag with a value: accepting it would let `--dry-run=false`
        // read as "dry run on".
        state.valuelessFlagsWithValue.push(flag);
        continue;
      }
    }
    const handler = exportArgHandlers[arg];
    if (handler) {
      i = handler(args, i, state);
    } else if (state.inputs.length === 0 && !arg.startsWith("-")) {
      state.inputs.push(arg);
    }
  }

  return state;
}

function resolveExportIoSources(state: ExportParseState): {
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

function buildExportOptions(
  state: ExportParseState,
  {
    input,
    output,
    resolvedInputFormat,
    inputSource,
    outputTarget,
  }: {
    input: string;
    output: string;
    resolvedInputFormat: ExportInputFormat;
    inputSource: "file" | "stdin";
    outputTarget: "file" | "stdout";
  },
): ExportOptions {
  return {
    input,
    output,
    inputFormat: resolvedInputFormat,
    format: state.format,
    defaultFont: state.defaultFont,
    fontSources: state.fontSources,
    fontMap: state.fontMap,
    wrap: state.wrap,
    fit: state.fit,
    textPathMode: state.textPathMode,
    scale: state.scale,
    fps: state.fps,
    fpsArg: state.fpsArg,
    bitrate: state.bitrate,
    durationMs: state.durationMs,
    iterations: state.iterations,
    debug: state.debug,
    verbose: state.verbose,
    inspect: state.inspect,
    report: state.report,
    componentName: state.componentName,
    dryRun: state.dryRun,
    watch: state.watch,
    inputSource,
    outputTarget,
  };
}

function validateExportRequirements(
  {
    resolvedInputFormat,
    defaultFont,
    fontSources,
  }: {
    resolvedInputFormat: ExportInputFormat;
    defaultFont: string;
    fontSources: CodegenFontDef[];
  },
  writeStderr: StderrWriter,
): boolean {
  if (resolvedInputFormat === "svg" && !defaultFont) {
    writeStderr("Error: --default-font is required for SVG input\n");
    printExportUsage(writeStderr);
    return false;
  }
  if (fontSources.length === 0) {
    writeStderr("Error: at least one --font is required for rendering\n");
    printExportUsage(writeStderr);
    return false;
  }
  return true;
}

function resolveStdinExport(
  state: ExportParseState,
  initialOutputTarget: "file" | "stdout",
  writeStderr: StderrWriter,
): ParsedExportCommand | null {
  if (!state.inputFormat) {
    state.inputFormat = "svg";
  }
  if (!state.componentName) {
    state.componentName = "Component";
  }
  const outputTarget = !state.output ? "stdout" : initialOutputTarget;

  const resolvedInputFormat = state.inputFormat;

  if (
    !validateExportRequirements(
      { resolvedInputFormat, defaultFont: state.defaultFont, fontSources: state.fontSources },
      writeStderr,
    )
  ) {
    return null;
  }

  return {
    options: buildExportOptions(state, {
      input: "",
      output: "",
      resolvedInputFormat,
      inputSource: "stdin",
      outputTarget,
    }),
    allInputs: [],
  };
}

function resolveFileExport(
  state: ExportParseState,
  outputTarget: "file" | "stdout",
  writeStderr: StderrWriter,
): ParsedExportCommand | null {
  const input = state.inputs[0] ?? "";

  if (!input) {
    writeStderr("Error: --input is required\n");
    printExportUsage(writeStderr);
    return null;
  }

  const resolvedInputFormat = state.inputFormat ?? detectInputFormat(input);

  if (
    !validateExportRequirements(
      { resolvedInputFormat, defaultFont: state.defaultFont, fontSources: state.fontSources },
      writeStderr,
    )
  ) {
    return null;
  }

  // A `.webp` output path selects the still WebP encoder on its own, so the
  // extension cannot silently end up holding SVG text. Animated output always
  // needs `--format animated-webp`, since the extension is the same. Other
  // extensions keep their existing behavior of following `--format` only.
  const lowerCaseOutputPath = state.output.toLowerCase();
  if (!state.formatExplicit && lowerCaseOutputPath.endsWith(".webp")) {
    state.format = "webp";
  }
  if (!state.formatExplicit && lowerCaseOutputPath.endsWith(".gif")) {
    // Unambiguous: there is no still-GIF format.
    state.format = "gif";
  }
  if (!state.formatExplicit && lowerCaseOutputPath.endsWith(".mp4")) {
    // Also unambiguous, and without it an `.mp4` path quietly receives SVG text.
    state.format = "mp4";
  }

  let { output } = state;
  if (!output) {
    output = deriveOutputPath(input, state.format);
  }

  if (!state.componentName && state.format === "static-component") {
    const inputBasename = input.split("/").pop() ?? input;
    state.componentName = toPascalCase(
      inputBasename
        .replace(/\.scene\.json$/i, "")
        .replace(/\.json$/i, "")
        .replace(/\.svg$/i, ""),
    );
  }

  return {
    options: buildExportOptions(state, {
      input,
      output,
      resolvedInputFormat,
      inputSource: "file",
      outputTarget,
    }),
    allInputs: state.inputs,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const defaultWriteStderr: StderrWriter = (message) => process.stderr.write(message);

function legacyLoopMigrationError(format: ExportOutputFormat, loop: number): string {
  if (format === "animated-webp") {
    const replacement = loop === 0 ? "infinite" : String(loop);
    return `Error: --loop was removed; animated-webp --loop ${loop} maps to --iterations ${replacement}\n`;
  }
  if (format === "gif") {
    const replacement = loop === 0 ? "infinite" : String(loop + 1);
    return `Error: --loop was removed; gif --loop ${loop} maps to --iterations ${replacement}\n`;
  }
  if (format === "mp4") {
    return "Error: --loop was removed and does not apply to mp4 export; video has no play-count field\n";
  }
  return "Error: --loop was removed; use --iterations only with animated-webp or gif export\n";
}

/**
 * Parse export subcommand arguments.
 * `args` should already have `node`, script path, and `export` stripped.
 */
export function parseExportArgs(
  args: string[],
  writeStderr: StderrWriter = defaultWriteStderr,
): ParsedExportCommand | null {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printExportUsage(writeStderr);
    return null;
  }

  const state = scanExportArgs(args);
  for (const retired of state.retiredFlags) {
    writeStderr(`Error: ${retired.flag} was renamed to ${retired.replacement}\n`);
  }
  for (const flag of state.invalidFlagValues) {
    writeStderr(`Error: ${flag} needs a valid value\n`);
  }
  for (const flag of state.valuelessFlagsWithValue) {
    writeStderr(`Error: ${flag} does not take a value\n`);
  }
  if (
    state.retiredFlags.length > 0 ||
    state.invalidFlagValues.length > 0 ||
    state.valuelessFlagsWithValue.length > 0
  ) {
    printExportUsage(writeStderr);
    return null;
  }
  const { inputSource, outputTarget } = resolveExportIoSources(state);

  const parsed =
    inputSource === "stdin"
      ? resolveStdinExport(state, outputTarget, writeStderr)
      : resolveFileExport(state, outputTarget, writeStderr);
  if (parsed && state.legacyLoop !== undefined) {
    writeStderr(legacyLoopMigrationError(parsed.options.format, state.legacyLoop));
    printExportUsage(writeStderr);
    return null;
  }
  return parsed;
}

function printExportUsage(writeStderr: StderrWriter = defaultWriteStderr): void {
  writeStderr(`
Usage: boundsvg export [options]

Options:
  --input, -i <file>           Input SVG or .scene.json file (required, repeatable for batch)
  --output, -o <file|dir>      Output file or directory for batch (default: derived from input)
                               a .webp, .gif or .mp4 path selects that format unless --format says otherwise
  --input-format <fmt>         svg | scene (default: auto-detect from extension)
  --format <fmt>               svg | png | webp | animated-webp | gif | mp4 | layered-svg |
                                 layered-png | static-component (default: svg)
                               webp: lossless (VP8L) still image
                               animated-webp: samples a declarative animation; needs --duration-ms
                               gif: animated GIF (256 colors, 1-bit alpha); needs --duration-ms
                               mp4: H.264 video via an external ffmpeg; needs --duration-ms
                                 (install ffmpeg yourself, or set FFMPEG_PATH; boundsvg doctor reports it)
                               layered-svg / layered-png: write one file per layer plus manifest.json
                                 into <output>.layers/ (stdout is not supported)
                               static-component: React component (zero @boundsvg dependency, text baked as paths)
  --default-font <font>        Default font alias (required for SVG input)
  --font <spec>                Font file (alias:weight:style:path) (repeatable, required)
  --font-map <SVGFamily=alias> Map SVG font-family to alias (repeatable)
  --name, -n <name>            Component name for static-component output (default: PascalCase of filename)
  --wrap <mode>                none | word | char (default: word)
  --fit <mode>                 none | shrink | grow (default: shrink)
  --text-path-mode <mode>      merged | glyphs (default: merged)
  --scale <n>                  Raster scale 1-4 for png / webp / animated-webp / gif /
                                 layered-png output (default: 2)
  --fps <n>                    Animation sampling rate 1-60 for animated formats (default: 20)
                               mp4 takes a whole number, 23.976 / 29.97 / 59.94, or a rational
                                 such as 30000/1001, up to 120fps (default: 30)
  --duration-ms <n>            Animation length for animated formats (required)
  --iterations <n|infinite>    Total plays for animated-webp (1-65535) or gif (1-65536)
                                 (default: infinite; not accepted for mp4)
  --bitrate <n>                Target bits per second for mp4 (default: constant quality)
  --dry-run                    Preview changes without writing files
  --watch                      Watch input files and re-export on change
  --debug                      Enable debug output
  --verbose, -v                Show warnings on stderr
  --inspect                    Print a JSON render inspection report to stderr
  --report <file>              Write a JSON render inspection report to file
  --help, -h                   Show this help message

Stdin/stdout:
  -i -                         Read from stdin
  -o -                         Write to stdout
  Piped input auto-detected when --input is omitted

Examples:
  boundsvg export -i card.svg --default-font NotoSansJP --font NotoSansJP:400:normal:./font.woff2
  boundsvg export -i card.svg --default-font NotoSansJP --font NotoSansJP:400:normal:./font.woff2 --format png
  boundsvg export -i card.scene.json --font NotoSansJP:400:normal:./font.woff2 --format static-component
  boundsvg export -i card.svg --default-font NotoSansJP --font NotoSansJP:400:normal:./font.woff2 --format webp
  boundsvg export -i card.scene.json --font NotoSansJP:400:normal:./font.woff2 --format animated-webp --duration-ms 2000 -o card.webp
  boundsvg export -i card.scene.json --font NotoSansJP:400:normal:./font.woff2 --format gif --duration-ms 2000 -o card.gif
  boundsvg export -i card.svg --default-font NotoSansJP --font NotoSansJP:400:normal:./font.woff2 --dry-run
`);
}
