// ---------------------------------------------------------------------------
// convert subcommand handler + SVG/Scene conversion pipeline
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import {
  FatalError,
  fromSceneDocument,
  type RecoverableError,
  type SceneNode,
  toSceneDocument,
} from "@boundsvg/core";
import { type GenerateComponentOptions, generateReactComponent } from "@boundsvg/core/codegen";
import { type AnalyzeSvgOptions, analyzeSvg, buildHybridVNode } from "@boundsvg/core/svg";
import {
  deriveBatchOutputPath,
  deriveComponentName,
  deriveInputFormat,
  expandInputs,
  runBatchLoop,
} from "./batch.js";
import type { CliOptions } from "./cli.js";
import { parseConvertArgs } from "./cli.js";
import { reportDryRun } from "./dry-run.js";
import { parseSceneInput } from "./scene-input.js";
import type { CliIo } from "./types.js";
import { watchAndRun } from "./watch.js";

type ConvertResult = {
  code: string;
  warnings: RecoverableError[];
};

/**
 * Convert an SVG string into a React component source or SceneDocument JSON.
 */
export function convertSvgToComponent(svgString: string, options: CliOptions): ConvertResult {
  // 1. Analyze SVG
  const analyzeOptions: AnalyzeSvgOptions = {
    defaultFont: options.defaultFont,
    fontAliasMap: Object.keys(options.fontMap).length > 0 ? options.fontMap : undefined,
    wrap: options.wrap,
    fit: options.fit,
    inferBBox: true,
  };

  const analysis = analyzeSvg(svgString, analyzeOptions);

  // 2. Build hybrid VNode
  const { vnode, warnings } = buildHybridVNode(analysis, analyzeOptions);

  // 3a. SceneDocument JSON output
  if (options.format === "scene") {
    const scene = toSceneDocument(vnode);
    const code = JSON.stringify(scene, null, 2);
    return { code, warnings };
  }

  // 3b. Generate React component
  const codegenOptions: GenerateComponentOptions = {
    componentName: options.name,
    renderer: options.renderer,
    fonts: options.fontSources,
    dynamicTexts: options.dynamicTexts.length > 0 ? options.dynamicTexts : undefined,
    exportDefault: true,
    textPathMode: options.textPathMode,
    pngScale: options.pngScale,
  };

  const code = generateReactComponent(vnode, codegenOptions);

  return { code, warnings };
}

/**
 * Convert a SceneDocument JSON into a React component source.
 */
export function convertSceneToComponent(scene: SceneNode, options: CliOptions): ConvertResult {
  const vnode = fromSceneDocument(scene);

  const codegenOptions: GenerateComponentOptions = {
    componentName: options.name,
    renderer: options.renderer,
    fonts: options.fontSources,
    dynamicTexts: options.dynamicTexts.length > 0 ? options.dynamicTexts : undefined,
    exportDefault: true,
    textPathMode: options.textPathMode,
    pngScale: options.pngScale,
  };

  const code = generateReactComponent(vnode, codegenOptions);
  return { code, warnings: [] };
}

function formatError(err: unknown): string {
  if (err instanceof FatalError) {
    return `[${err.code}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Single-file conversion — I/O helpers
// ---------------------------------------------------------------------------

function readConvertInput(
  io: CliIo,
  options: CliOptions,
): { ok: true; content: string } | { ok: false; exitCode: number } {
  if (options.inputSource === "stdin") {
    try {
      return { ok: true, content: io.readStdin() };
    } catch {
      io.writeStderr("Error: Cannot read from stdin\n");
      return { ok: false, exitCode: 1 };
    }
  }

  const inputPath = resolve(options.input);
  try {
    return { ok: true, content: io.readTextFile(inputPath) };
  } catch {
    io.writeStderr(`Error: Cannot read file "${inputPath}"\n`);
    return { ok: false, exitCode: 1 };
  }
}

function writeConvertOutput(io: CliIo, options: CliOptions, code: string): number {
  if (options.dryRun) {
    const outputPath = resolve(options.output);
    reportDryRun(io, outputPath, code);
    return 0;
  }

  if (options.outputTarget === "stdout") {
    io.writeStdout(code);
  } else {
    const outputPath = resolve(options.output);
    try {
      io.writeTextFile(outputPath, code);
    } catch {
      io.writeStderr(`Error: Cannot write file "${outputPath}"\n`);
      return 1;
    }
    io.writeStdout(`Converted: ${outputPath}\n`);
  }

  return 0;
}

function reportConvertWarnings(
  io: CliIo,
  options: CliOptions,
  warnings: { code: string; message: string; fallback: string }[],
): void {
  if (warnings.length === 0) {
    return;
  }
  if (options.verbose) {
    io.writeStderr(`\nWarnings (${warnings.length}):\n`);
    for (const w of warnings) {
      io.writeStderr(`  [${w.code}] ${w.message}\n`);
      io.writeStderr(`    Fallback: ${w.fallback}\n`);
    }
  } else {
    io.writeStderr(`${warnings.length} warning(s) emitted. Use --verbose to see details.\n`);
  }
}

// ---------------------------------------------------------------------------
// Single-file conversion
// ---------------------------------------------------------------------------

/**
 * Process a single file conversion (read → convert → write).
 * Handles dry-run, stdin, and stdout.
 */
function convertSingleFile(io: CliIo, options: CliOptions): number {
  // Scene → Scene is a no-op; reject early
  if (options.inputFormat === "scene" && options.format === "scene") {
    io.writeStderr(
      "Error: Scene-to-Scene conversion is not supported. Input is already a SceneDocument.\n",
    );
    return 1;
  }

  // 1. Read input
  const inputResult = readConvertInput(io, options);
  if (!inputResult.ok) {
    return inputResult.exitCode;
  }

  // 2. Convert
  let code: string;
  let warnings: { code: string; message: string; fallback: string }[];
  if (options.inputFormat === "scene") {
    const sceneResult = parseSceneInput(inputResult.content);
    if (!sceneResult.ok) {
      io.writeStderr(`Error: ${sceneResult.message}\n`);
      return 1;
    }
    try {
      const result = convertSceneToComponent(sceneResult.scene, options);
      code = result.code;
      warnings = result.warnings;
    } catch (err) {
      io.writeStderr(`Error: Invalid SceneDocument: ${formatError(err)}\n`);
      return 1;
    }
  } else {
    try {
      const result = convertSvgToComponent(inputResult.content, options);
      code = result.code;
      warnings = result.warnings;
    } catch (err) {
      io.writeStderr(`Error: Conversion failed: ${formatError(err)}\n`);
      return 1;
    }
  }

  // 3. Write output (handles dry-run internally)
  const writeResult = writeConvertOutput(io, options, code);
  if (writeResult !== 0) {
    return writeResult;
  }

  // 4. Report warnings
  reportConvertWarnings(io, options, warnings);

  return 0;
}

// ---------------------------------------------------------------------------
// Batch conversion
// ---------------------------------------------------------------------------

function runConvertBatch(
  io: CliIo,
  {
    inputs,
    outputDir,
    baseOptions,
  }: { inputs: string[]; outputDir: string | null; baseOptions: CliOptions },
): Promise<number> {
  const extension = baseOptions.format === "scene" ? ".scene.json" : ".tsx";
  return runBatchLoop(io, inputs, {
    outputDir,
    extension,
    verb: "Converted",
    failureLabel: "conversion failed",
    processFn: (inputPath, outputPath) => {
      const fileOptions: CliOptions = {
        ...baseOptions,
        input: inputPath,
        output: outputPath,
        name: deriveComponentName(inputPath),
        inputFormat: deriveInputFormat(inputPath),
      };
      return convertSingleFile(io, fileOptions);
    },
  });
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function hasInputInArgs(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--input" || arg === "-i") {
      return true;
    }
    if (!arg.startsWith("-")) {
      return true;
    }
  }
  return false;
}

/**
 * Validate flag combinations that are mutually exclusive.
 * Returns an error message or null if valid.
 */
function validateConvertFlags(options: CliOptions, expandedInputs: string[]): string | null {
  if (options.inputSource === "stdin" && options.watch) {
    return "Error: --watch cannot be used with stdin input\n";
  }
  if (options.inputSource === "stdin" && expandedInputs.length > 0) {
    return "Error: stdin cannot be used with batch mode\n";
  }
  if (options.dryRun && options.outputTarget === "stdout") {
    return "Error: --dry-run cannot be used with stdout output\n";
  }
  if (options.dryRun && options.watch) {
    return "Error: --dry-run cannot be used with --watch\n";
  }
  return null;
}

function runConvertSingle(
  io: CliIo,
  options: CliOptions,
  expandedInputs: string[],
): number | Promise<number> {
  if (expandedInputs.length === 1) {
    const firstInput = expandedInputs[0];
    if (firstInput !== undefined) {
      options.input = firstInput;
    }
  }

  if (options.watch) {
    const inputPath = resolve(options.input);
    return watchAndRun(io, [inputPath], {
      runOnce: () => {
        convertSingleFile(io, options);
      },
      debounceMs: 150,
    });
  }

  return convertSingleFile(io, options);
}

function runConvertBatchWatch(
  io: CliIo,
  options: CliOptions,
  { expandedInputs, outputDir }: { expandedInputs: string[]; outputDir: string | null },
): Promise<number> {
  const resolvedPaths = expandedInputs.map((inputPath) => resolve(inputPath));
  const extension = options.format === "scene" ? ".scene.json" : ".tsx";
  return watchAndRun(io, resolvedPaths, {
    runOnce: (changedPath) => {
      convertSingleFile(io, {
        ...options,
        input: changedPath,
        output: deriveBatchOutputPath(changedPath, outputDir, extension),
        name: deriveComponentName(changedPath),
      });
    },
    debounceMs: 150,
  });
}

/**
 * Run the `convert` subcommand.
 * `args` should already have `node`, script path, and `convert` stripped.
 */
export function runConvert(io: CliIo, args: string[]): number | Promise<number> {
  const requestedHelp = args.includes("--help") || args.includes("-h");

  // Auto-detect stdin: no input specified + piped stdin
  let effectiveArgs = args;
  if (!hasInputInArgs(args) && !io.stdinIsTTY && !requestedHelp) {
    effectiveArgs = ["-i", "-", ...args];
  }

  const parsed = parseConvertArgs(effectiveArgs, io.writeStderr);
  if (!parsed) {
    return requestedHelp ? 0 : 1;
  }

  const { options, allInputs } = parsed;

  // Expand globs (skip for stdin)
  const expandedInputs = options.inputSource === "stdin" ? [] : expandInputs(allInputs);

  // Validate flag combinations
  const validationError = validateConvertFlags(options, expandedInputs);
  if (validationError) {
    io.writeStderr(validationError);
    return 1;
  }

  // --- stdin mode ---
  if (options.inputSource === "stdin") {
    return convertSingleFile(io, options);
  }

  // --- single file mode ---
  if (expandedInputs.length <= 1) {
    return runConvertSingle(io, options, expandedInputs);
  }

  // --- batch mode ---
  const outputDir = options.output && options.outputTarget === "file" ? options.output : null;

  if (options.watch) {
    return runConvertBatchWatch(io, options, { expandedInputs, outputDir });
  }

  return runConvertBatch(io, { inputs: expandedInputs, outputDir, baseOptions: options });
}
