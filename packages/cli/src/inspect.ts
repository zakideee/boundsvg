import { resolve } from "node:path";
import { parseExportArgs } from "./cli-export.js";
import { buildExportVNode, formatError, initEngine, readExportInput } from "./export.js";
import {
  type CliSceneInspection,
  formatInspectionJson,
  inspectCliScene,
} from "./inspection-report.js";
import type { CliIo } from "./types.js";

type InspectOutputFormat = "json" | "table";

function stripInspectFlags(args: string[]): {
  args: string[];
  outputFormat: InspectOutputFormat;
  hasOutput: boolean;
} {
  const nextArgs: string[] = [];
  let outputFormat: InspectOutputFormat = "table";
  let hasOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--output-format") {
      const value = args[i + 1] ?? "";
      outputFormat = value === "json" ? "json" : "table";
      i++;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      hasOutput = true;
    }
    nextArgs.push(arg);
  }

  return { args: nextArgs, outputFormat, hasOutput };
}

function toTableReport(inspection: CliSceneInspection): string {
  const lines = [
    `canvas: ${inspection.stats.width}x${inspection.stats.height}`,
    `nodes: ${inspection.stats.nodeCount} (${inspection.stats.textNodeCount} text, ${inspection.stats.handlerNodeCount} handlers)`,
    `drawOrder: ${inspection.stats.drawNodeCount}`,
    `measureCalls: ${inspection.stats.measureCallCount}`,
    `warnings: ${inspection.stats.warningCount}`,
    `nodeIds: ${inspection.nodeIds.valid ? "valid" : "duplicates found"}`,
  ];

  if (inspection.nodeIds.duplicates.length > 0) {
    lines.push(
      `duplicates: ${inspection.nodeIds.duplicates.map((duplicate) => duplicate.id).join(", ")}`,
    );
  }

  if (inspection.stats.missingGlyphCount > 0) {
    lines.push(`missingGlyphs: ${inspection.stats.missingGlyphCount}`);
  }
  if (inspection.stats.overflowTextNodeCount > 0) {
    lines.push(`overflowTextNodes: ${inspection.stats.overflowTextNodeCount}`);
  }
  return `${lines.join("\n")}\n`;
}

function printInspectUsage(io: CliIo): void {
  io.writeStderr(`
Usage: boundsvg inspect [options]

Options:
  --input, -i <file>           Input SVG or .scene.json file
  --input-format <fmt>         svg | scene (default: auto-detect from extension)
  --default-font <font>        Default font alias (required for SVG input)
  --font <spec>                Font file (alias:weight:style:path) (repeatable, required)
  --font-map <SVGFamily=alias> Map SVG font-family to alias (repeatable)
  --wrap <mode>                none | word | char (default: word)
  --fit <mode>                 none | shrink | grow (default: shrink)
  --text-path-mode <mode>      merged | glyphs (default: merged)
  --output-format <fmt>        table | json (default: table)
  --help, -h                   Show this help message
`);
}

export async function runInspect(io: CliIo, args: string[]): Promise<number> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printInspectUsage(io);
    return args.length === 0 ? 1 : 0;
  }

  const { args: exportLikeArgs, outputFormat, hasOutput } = stripInspectFlags(args);
  const parsed = parseExportArgs(exportLikeArgs, io.writeStderr);
  if (!parsed) {
    return 1;
  }
  if (!hasOutput) {
    parsed.options.output = "";
    parsed.options.outputTarget = "stdout";
  }

  const engine = await initEngine(io, parsed.options);
  if (!engine) {
    return 1;
  }

  try {
    const inputResult = readExportInput(io, parsed.options);
    if (!inputResult.ok) {
      return inputResult.exitCode;
    }
    const vnodeResult = buildExportVNode(io, parsed.options, inputResult.content);
    if (!vnodeResult.ok) {
      return vnodeResult.exitCode;
    }

    const inspection = inspectCliScene(engine, vnodeResult.vnode, {
      textPathMode: parsed.options.textPathMode,
      debug: parsed.options.debug,
    });
    const report =
      outputFormat === "json" ? `${formatInspectionJson(inspection)}\n` : toTableReport(inspection);
    if (parsed.options.outputTarget === "stdout" || !parsed.options.output) {
      io.writeStdout(report);
    } else {
      io.writeTextFile(resolve(parsed.options.output), report);
    }
    return 0;
  } catch (err) {
    io.writeStderr(`Error: inspect failed: ${formatError(err)}\n`);
    return 1;
  } finally {
    engine.dispose();
  }
}
