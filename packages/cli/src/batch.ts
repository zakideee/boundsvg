// ---------------------------------------------------------------------------
// Batch processing utilities — glob expansion, collision detection, summary
// ---------------------------------------------------------------------------

import { basename, join, resolve } from "node:path";
import { globSync } from "tinyglobby";
import { toPascalCase } from "./cli.js";
import type { CliIo } from "./types.js";

export type BatchResult = {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ input: string; error: string }>;
};

/**
 * Expand raw input paths: glob patterns are expanded, plain paths kept as-is.
 */
export function expandInputs(rawInputs: string[]): string[] {
  const result: string[] = [];
  for (const input of rawInputs) {
    if (/[*?[\]]/.test(input)) {
      const matches = globSync([input], { absolute: true });
      result.push(...matches.sort());
    } else {
      result.push(input);
    }
  }
  return result;
}

/**
 * Format a batch execution summary for stderr output.
 */
export function formatBatchSummary(result: BatchResult, verb: string): string {
  const lines: string[] = [];
  if (result.errors.length > 0) {
    lines.push("\nErrors:");
    for (const { input, error } of result.errors) {
      lines.push(`  ${input}: ${error}`);
    }
  }
  lines.push(`\n${verb} ${result.succeeded}/${result.total} files`);
  if (result.failed > 0) {
    lines.push(` (${result.failed} failed)`);
  }
  lines.push("\n");
  return lines.join("");
}

/**
 * Detect output path collisions — multiple inputs mapping to the same output.
 * Returns an error message if collisions are found, null otherwise.
 */
export function detectOutputCollisions(
  inputs: string[],
  deriveOutputPath: (input: string) => string,
): string | null {
  const outputMap = new Map<string, string[]>();
  for (const input of inputs) {
    const output = resolve(deriveOutputPath(input));
    const existing = outputMap.get(output);
    if (existing) {
      existing.push(input);
    } else {
      outputMap.set(output, [input]);
    }
  }

  const collisions: string[] = [];
  for (const [output, sources] of outputMap) {
    if (sources.length > 1) {
      collisions.push(`  ${output} ← ${sources.join(", ")}`);
    }
  }

  if (collisions.length > 0) {
    return `Error: Output path collision detected:\n${collisions.join("\n")}\n`;
  }
  return null;
}

/**
 * Strip known input extensions (.scene.json, .json, .svg) from a file's basename.
 */
function stripInputExtension(inputPath: string): string {
  return basename(inputPath)
    .replace(/\.scene\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/\.svg$/i, "");
}

/**
 * Derive a PascalCase component name from an input file path.
 */
export function deriveComponentName(inputPath: string): string {
  return toPascalCase(stripInputExtension(inputPath));
}

/**
 * Detect input format from file extension.
 */
export function deriveInputFormat(inputPath: string): "scene" | "svg" {
  return inputPath.endsWith(".scene.json") || inputPath.endsWith(".json") ? "scene" : "svg";
}

/**
 * Derive output path for a single file in batch mode.
 * If outputDir is given, output goes there; otherwise, output is next to input.
 */
export function deriveBatchOutputPath(
  inputPath: string,
  outputDir: string | null,
  extension: string,
): string {
  const outputName = `${stripInputExtension(inputPath)}${extension}`;
  if (outputDir) {
    return join(outputDir, outputName);
  }
  const inputDir = resolve(inputPath, "..");
  return join(inputDir, outputName);
}

/**
 * Generic batch loop: detect collisions, iterate inputs, call processFn, collect results.
 */
export async function runBatchLoop(
  io: CliIo,
  inputs: string[],
  config: {
    outputDir: string | null;
    extension: string;
    verb: string;
    failureLabel: string;
    processFn: (inputPath: string, outputPath: string) => number | Promise<number>;
  },
): Promise<number> {
  const collision = detectOutputCollisions(inputs, (input) =>
    deriveBatchOutputPath(input, config.outputDir, config.extension),
  );
  if (collision) {
    io.writeStderr(collision);
    return 1;
  }

  const result: BatchResult = { total: inputs.length, succeeded: 0, failed: 0, errors: [] };

  for (const inputPath of inputs) {
    const outputPath = deriveBatchOutputPath(inputPath, config.outputDir, config.extension);
    const exitCode = await config.processFn(inputPath, outputPath);
    if (exitCode === 0) {
      result.succeeded++;
    } else {
      result.failed++;
      result.errors.push({ input: inputPath, error: config.failureLabel });
    }
  }

  io.writeStderr(formatBatchSummary(result, config.verb));
  return result.failed > 0 ? 1 : 0;
}
