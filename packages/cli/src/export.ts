// ---------------------------------------------------------------------------
// export subcommand handler
// ---------------------------------------------------------------------------

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createEngineAsync,
  type Engine,
  FatalError,
  formatLayerFileName,
  fromSceneDocument,
  MAX_ANIMATION_FRAMES,
  type RecoverableError,
  type VNode,
} from "@boundsvg/core";
import { generatePlainSvgComponent } from "@boundsvg/core/codegen";
import { initNodeWasm } from "@boundsvg/core/node";
import { type AnalyzeSvgOptions, analyzeSvg, buildHybridVNode } from "@boundsvg/core/svg";
import {
  deriveBatchOutputPath,
  deriveComponentName,
  deriveInputFormat,
  expandInputs,
  runBatchLoop,
} from "./batch.js";
import { PNG_SCALE_MAX, PNG_SCALE_MIN } from "./cli.js";
import type { ExportOptions } from "./cli-export.js";
import { deriveExportExtension, parseExportArgs } from "./cli-export.js";
import { reportDryRun, reportDryRunBinary, reportDryRunDirectory } from "./dry-run.js";
import { ffmpegNotFoundMessage, probeFfmpeg, resolveFfmpegCommand } from "./ffmpeg-locator.js";
import { CLI_FRAME_RATE_HELP, type CliFrameRate, parseCliFrameRate } from "./frame-rate.js";
import { formatInspectionJson, inspectCliScene } from "./inspection-report.js";
import {
  buildFfmpegArgs,
  buildMp4Schedule,
  encodeMp4WithFfmpeg,
  MAX_MP4_FRAMES,
  type Mp4EncodeResult,
  mp4FrameCount,
  sampleMp4Frames,
} from "./mp4-export.js";
import { parseSceneInput } from "./scene-input.js";
import type { CliIo } from "./types.js";
import { watchAndRun } from "./watch.js";

export function formatError(err: unknown): string {
  if (err instanceof FatalError) {
    return `[${err.code}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Single-file export — I/O helpers
// ---------------------------------------------------------------------------

export function readExportInput(
  io: CliIo,
  options: ExportOptions,
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

export function buildExportVNode(
  io: CliIo,
  options: ExportOptions,
  inputContent: string,
): { ok: true; vnode: VNode } | { ok: false; exitCode: number } {
  if (options.inputFormat === "scene") {
    const sceneResult = parseSceneInput(inputContent);
    if (!sceneResult.ok) {
      io.writeStderr(`Error: ${sceneResult.message}\n`);
      return { ok: false, exitCode: 1 };
    }

    try {
      return { ok: true, vnode: fromSceneDocument(sceneResult.scene) };
    } catch (err) {
      io.writeStderr(`Error: Invalid SceneDocument: ${formatError(err)}\n`);
      return { ok: false, exitCode: 1 };
    }
  }

  const analyzeOptions: AnalyzeSvgOptions = {
    defaultFont: options.defaultFont,
    fontAliasMap: Object.keys(options.fontMap).length > 0 ? options.fontMap : undefined,
    wrap: options.wrap,
    fit: options.fit,
    inferBBox: true,
  };

  try {
    const analysis = analyzeSvg(inputContent, analyzeOptions);
    const { vnode, warnings } = buildHybridVNode(analysis, analyzeOptions);

    if (options.verbose && warnings.length > 0) {
      io.writeStderr(`Warnings (${warnings.length}):\n`);
      for (const w of warnings) {
        io.writeStderr(`  [${w.code}] ${w.message}\n`);
      }
    }

    return { ok: true, vnode };
  } catch (err) {
    io.writeStderr(`Error: SVG analysis failed: ${formatError(err)}\n`);
    return { ok: false, exitCode: 1 };
  }
}

/**
 * Render warnings (MISSING_GLYPH, PNG_RESOLUTION_ADJUSTED, ...) go to stderr.
 * They were previously discarded entirely: exports reported success while
 * dropping glyphs with no trace, even under --verbose.
 */
function createRenderWarningReporter(io: CliIo): (warning: RecoverableError) => void {
  return (warning) => {
    const nodeSuffix = warning.nodeId ? ` (node "${warning.nodeId}")` : "";
    io.writeStderr(`Warning [${warning.code}] ${warning.message}${nodeSuffix}\n`);
  };
}

function writeExportPng(
  io: CliIo,
  options: ExportOptions,
  { outputPath, engine, input }: { outputPath: string; engine: Engine; input: VNode },
): number {
  let pngData: Uint8Array;
  try {
    pngData = engine.renderToPng(input, {
      scale: options.scale,
      debug: options.debug,
      onWarning: createRenderWarningReporter(io),
      textPathMode: options.textPathMode,
    });
  } catch (err) {
    io.writeStderr(`Error: PNG rendering failed: ${formatError(err)}\n`);
    return 1;
  }

  if (options.dryRun) {
    reportDryRunBinary(io, outputPath, pngData);
    return 0;
  }

  if (options.outputTarget === "stdout") {
    io.writeBinaryStdout(pngData);
  } else {
    try {
      io.writeBinaryFile(outputPath, pngData);
    } catch {
      io.writeStderr(`Error: Cannot write file "${outputPath}"\n`);
      return 1;
    }
    io.writeStdout(`Exported: ${outputPath}\n`);
  }

  return 0;
}

function renderExportRaster(
  options: ExportOptions,
  {
    engine,
    input,
    onWarning,
  }: { engine: Engine; input: VNode; onWarning: (warning: RecoverableError) => void },
): Uint8Array {
  const shared = {
    scale: options.scale,
    debug: options.debug,
    textPathMode: options.textPathMode,
    onWarning,
  };
  const animated = {
    ...shared,
    durationMs: options.durationMs ?? 0,
    iterations: options.iterations ?? "infinite",
    ...(options.fps !== undefined && { fps: options.fps }),
  };
  if (options.format === "animated-webp") {
    return engine.renderToAnimatedWebp(input, animated);
  }
  if (options.format === "gif") {
    return engine.renderToAnimatedGif(input, animated);
  }
  return engine.renderToWebp(input, shared);
}

/** Shared writer for the single-file raster formats other than PNG. */
function writeExportRaster(
  io: CliIo,
  options: ExportOptions,
  { outputPath, engine, input }: { outputPath: string; engine: Engine; input: VNode },
): number {
  let data: Uint8Array;
  try {
    data = renderExportRaster(options, {
      engine,
      input,
      onWarning: createRenderWarningReporter(io),
    });
  } catch (err) {
    io.writeStderr(`Error: ${options.format} rendering failed: ${formatError(err)}\n`);
    return 1;
  }

  if (options.dryRun) {
    reportDryRunBinary(io, outputPath, data);
    return 0;
  }

  if (options.outputTarget === "stdout") {
    io.writeBinaryStdout(data);
  } else {
    try {
      io.writeBinaryFile(outputPath, data);
    } catch {
      io.writeStderr(`Error: Cannot write file "${outputPath}"\n`);
      return 1;
    }
    io.writeStdout(`Exported: ${outputPath}\n`);
  }

  return 0;
}

type LayeredSvgCliManifest = {
  width: number;
  height: number;
  compositionValidation?: ReturnType<Engine["renderToLayeredSvg"]>["compositionValidation"];
  layers: Array<
    ReturnType<Engine["renderToLayeredSvg"]>["manifest"]["layers"][number] & {
      fileName: string;
    }
  >;
};

type LayeredPngCliManifest = {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  compositionValidation?: ReturnType<Engine["renderToLayeredPng"]>["compositionValidation"];
  layers: Array<
    ReturnType<Engine["renderToLayeredPng"]>["manifest"]["layers"][number] & {
      fileName: string;
    }
  >;
};

function writeExportLayeredSvg(
  io: CliIo,
  options: ExportOptions,
  { outputPath, engine, input }: { outputPath: string; engine: Engine; input: VNode },
): number {
  let layeredSvgResult: ReturnType<Engine["renderToLayeredSvg"]>;
  try {
    layeredSvgResult = engine.renderToLayeredSvg(input, {
      debug: options.debug,
      textPathMode: options.textPathMode,
      onWarning: createRenderWarningReporter(io),
    });
  } catch (err) {
    io.writeStderr(`Error: layered SVG rendering failed: ${formatError(err)}\n`);
    return 1;
  }

  const layerFiles = layeredSvgResult.layers.map((layer, index) => ({
    fileName: formatLayerFileName(index, layer.id, "svg"),
    svg: layer.svg,
  }));
  const manifest: LayeredSvgCliManifest = {
    width: layeredSvgResult.width,
    height: layeredSvgResult.height,
    ...(layeredSvgResult.compositionValidation
      ? { compositionValidation: layeredSvgResult.compositionValidation }
      : {}),
    layers: layeredSvgResult.manifest.layers.map((layer, index) => ({
      ...layer,
      fileName: formatLayerFileName(index, layer.id, "svg"),
    })),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  if (options.dryRun) {
    reportDryRunDirectory(io, outputPath);
    reportDryRun(io, join(outputPath, "manifest.json"), manifestJson);
    for (const { fileName, svg } of layerFiles) {
      reportDryRun(io, join(outputPath, fileName), svg);
    }
    return 0;
  }

  try {
    io.ensureDir(outputPath);
    io.writeTextFile(join(outputPath, "manifest.json"), manifestJson);
    for (const { fileName, svg } of layerFiles) {
      io.writeTextFile(join(outputPath, fileName), svg);
    }
  } catch {
    io.writeStderr(`Error: Cannot write layered SVG output "${outputPath}"\n`);
    return 1;
  }

  io.writeStdout(`Exported: ${outputPath}\n`);
  return 0;
}

function writeExportLayeredPng(
  io: CliIo,
  options: ExportOptions,
  { outputPath, engine, input }: { outputPath: string; engine: Engine; input: VNode },
): number {
  let layeredPngResult: ReturnType<Engine["renderToLayeredPng"]>;
  try {
    layeredPngResult = engine.renderToLayeredPng(input, {
      scale: options.scale,
      debug: options.debug,
      textPathMode: options.textPathMode,
      onWarning: createRenderWarningReporter(io),
    });
  } catch (err) {
    io.writeStderr(`Error: layered PNG rendering failed: ${formatError(err)}\n`);
    return 1;
  }

  const layerFiles = layeredPngResult.layers.map((layer, index) => ({
    fileName: formatLayerFileName(index, layer.id, "png"),
    png: layer.png,
  }));
  const manifest: LayeredPngCliManifest = {
    width: layeredPngResult.width,
    height: layeredPngResult.height,
    pixelWidth: layeredPngResult.pixelWidth,
    pixelHeight: layeredPngResult.pixelHeight,
    ...(layeredPngResult.compositionValidation
      ? { compositionValidation: layeredPngResult.compositionValidation }
      : {}),
    layers: layeredPngResult.manifest.layers.map((layer, index) => ({
      ...layer,
      fileName: formatLayerFileName(index, layer.id, "png"),
    })),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  if (options.dryRun) {
    reportDryRunDirectory(io, outputPath);
    reportDryRun(io, join(outputPath, "manifest.json"), manifestJson);
    for (const { fileName, png } of layerFiles) {
      reportDryRunBinary(io, join(outputPath, fileName), png);
    }
    return 0;
  }

  try {
    io.ensureDir(outputPath);
    io.writeTextFile(join(outputPath, "manifest.json"), manifestJson);
    for (const { fileName, png } of layerFiles) {
      io.writeBinaryFile(join(outputPath, fileName), png);
    }
  } catch {
    io.writeStderr(`Error: Cannot write layered PNG output "${outputPath}"\n`);
    return 1;
  }

  io.writeStdout(`Exported: ${outputPath}\n`);
  return 0;
}

function writeInspectionReport(
  io: CliIo,
  options: ExportOptions,
  {
    engine,
    input,
  }: {
    engine: Engine;
    input: VNode;
  },
): number {
  if (!options.inspect && !options.report) {
    return 0;
  }

  let report: string;
  try {
    const inspection = inspectCliScene(engine, input, {
      textPathMode: options.textPathMode,
    });
    report = formatInspectionJson(inspection);
  } catch (err) {
    io.writeStderr(`Error: inspection failed: ${formatError(err)}\n`);
    return 1;
  }

  if (options.inspect) {
    io.writeStderr(`${report}\n`);
  }

  if (options.report) {
    try {
      io.writeTextFile(resolve(options.report), `${report}\n`);
    } catch {
      io.writeStderr(`Error: Cannot write report file "${resolve(options.report)}"\n`);
      return 1;
    }
  }

  return 0;
}

function writeExportText(
  io: CliIo,
  options: ExportOptions,
  { outputPath, engine, input }: { outputPath: string; engine: Engine; input: VNode },
): number {
  let svgOutput: string;
  try {
    svgOutput = engine.renderToSvg(input, {
      debug: options.debug,
      textPathMode: options.textPathMode,
      onWarning: createRenderWarningReporter(io),
    });
  } catch (err) {
    io.writeStderr(`Error: SVG rendering failed: ${formatError(err)}\n`);
    return 1;
  }

  const outputContent =
    options.format === "static-component"
      ? generatePlainSvgComponent(svgOutput, {
          componentName: options.componentName,
        })
      : svgOutput;

  if (options.dryRun) {
    reportDryRun(io, outputPath, outputContent);
    return 0;
  }

  if (options.outputTarget === "stdout") {
    io.writeStdout(outputContent);
  } else {
    try {
      io.writeTextFile(outputPath, outputContent);
    } catch {
      io.writeStderr(`Error: Cannot write file "${outputPath}"\n`);
      return 1;
    }
    io.writeStdout(`Exported: ${outputPath}\n`);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Single-file export
// ---------------------------------------------------------------------------

/**
 * Export a single file. The engine must be initialized by the caller.
 */
async function exportSingleFile(
  io: CliIo,
  options: ExportOptions,
  engine: Engine,
): Promise<number> {
  // 1. Read input
  const inputResult = readExportInput(io, options);
  if (!inputResult.ok) {
    return inputResult.exitCode;
  }

  // 2. Build input VNode
  const vnodeResult = buildExportVNode(io, options, inputResult.content);
  if (!vnodeResult.ok) {
    return vnodeResult.exitCode;
  }

  // 3. Export
  const outputPath = resolve(options.output);

  if (options.format === "png") {
    const reportExitCode = writeInspectionReport(io, options, { engine, input: vnodeResult.vnode });
    if (reportExitCode !== 0) {
      return reportExitCode;
    }
    return writeExportPng(io, options, { outputPath, engine, input: vnodeResult.vnode });
  }

  if (options.format === "mp4") {
    const reportExitCode = writeInspectionReport(io, options, { engine, input: vnodeResult.vnode });
    if (reportExitCode !== 0) {
      return reportExitCode;
    }
    return await writeExportMp4(io, options, { outputPath, engine, input: vnodeResult.vnode });
  }

  if (options.format === "webp" || options.format === "animated-webp" || options.format === "gif") {
    const reportExitCode = writeInspectionReport(io, options, { engine, input: vnodeResult.vnode });
    if (reportExitCode !== 0) {
      return reportExitCode;
    }
    return writeExportRaster(io, options, { outputPath, engine, input: vnodeResult.vnode });
  }

  if (options.format === "layered-svg") {
    const reportExitCode = writeInspectionReport(io, options, { engine, input: vnodeResult.vnode });
    if (reportExitCode !== 0) {
      return reportExitCode;
    }
    return writeExportLayeredSvg(io, options, {
      outputPath,
      engine,
      input: vnodeResult.vnode,
    });
  }

  if (options.format === "layered-png") {
    const reportExitCode = writeInspectionReport(io, options, { engine, input: vnodeResult.vnode });
    if (reportExitCode !== 0) {
      return reportExitCode;
    }
    return writeExportLayeredPng(io, options, {
      outputPath,
      engine,
      input: vnodeResult.vnode,
    });
  }

  const reportExitCode = writeInspectionReport(io, options, { engine, input: vnodeResult.vnode });
  if (reportExitCode !== 0) {
    return reportExitCode;
  }
  return writeExportText(io, options, { outputPath, engine, input: vnodeResult.vnode });
}

// ---------------------------------------------------------------------------
// Batch export
// ---------------------------------------------------------------------------

async function runExportBatch(
  io: CliIo,
  {
    inputs,
    outputDir,
    baseOptions,
    engine,
  }: { inputs: string[]; outputDir: string | null; baseOptions: ExportOptions; engine: Engine },
): Promise<number> {
  const extension = deriveExportExtension(baseOptions.format);
  return runBatchLoop(io, inputs, {
    outputDir,
    extension,
    verb: "Exported",
    failureLabel: "export failed",
    processFn: async (inputPath, outputPath) => {
      const fileOptions: ExportOptions = {
        ...baseOptions,
        input: inputPath,
        output: outputPath,
        report: baseOptions.report ? `${outputPath}.report.json` : "",
        componentName: deriveComponentName(inputPath),
        inputFormat: deriveInputFormat(inputPath),
      };
      return exportSingleFile(io, fileOptions, engine);
    },
  });
}

// ---------------------------------------------------------------------------
// Engine initialization helper
// ---------------------------------------------------------------------------

export async function initEngine(io: CliIo, options: ExportOptions): Promise<Engine | null> {
  const fonts: Array<{
    alias: string;
    weight: number;
    style: "normal" | "italic";
    data: Uint8Array;
  }> = [];

  for (const fontDef of options.fontSources) {
    const fontPath = resolve(fontDef.source);
    try {
      const data = io.readBinaryFile(fontPath);
      fonts.push({
        alias: fontDef.alias,
        weight: fontDef.weight,
        style: fontDef.style,
        data,
      });
    } catch {
      io.writeStderr(`Error: Cannot read font file "${fontPath}"\n`);
      return null;
    }
  }

  try {
    await initNodeWasm();
    return await createEngineAsync({ fonts });
  } catch (err) {
    io.writeStderr(`Error: Failed to initialize engine: ${formatError(err)}\n`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function hasInputInArgs(args: string[]): boolean {
  for (const arg of args) {
    // The `=value` spellings count too: missing them made an all-`=` argv look
    // input-less, which silently switched the export to stdin.
    if (arg === "--input" || arg === "-i" || arg.startsWith("--input=") || arg.startsWith("-i=")) {
      return true;
    }
    if (!arg.startsWith("-")) {
      return true;
    }
  }
  return false;
}

/** Inclusive ranges the core animation schedule accepts. */
const MIN_ANIMATION_FPS = 1;
const MAX_ANIMATION_FPS = 60;
const MAX_ANIMATED_WEBP_ITERATIONS = 65_535;
const MAX_GIF_ITERATIONS = 65_536;

/** Frame rate used for MP4 when the caller does not ask for one. */
const MP4_FRAME_RATE_DEFAULT = 30;

/** Highest bitrate accepted, matching the ceiling the browser exporter clamps to. */
const MAX_MP4_BITRATE = 50_000_000;

/**
 * Validate the MP4 flags.
 *
 * MP4 takes a rational `--fps` the other animated formats have never accepted,
 * and its frame ceiling is the external encoder's, not the engine's — so it
 * gets its own check rather than bending the shared one.
 */
function validateMp4Flags(options: ExportOptions): string | null {
  if (options.iterations !== undefined) {
    return "Error: --iterations does not apply to mp4 export; video has no play-count field\n";
  }
  if (options.durationMs === undefined) {
    return "Error: --duration-ms is required for mp4 export\n";
  }
  if (options.durationMs <= 0) {
    return "Error: --duration-ms must be greater than zero\n";
  }
  if (options.fpsArg !== undefined && parseCliFrameRate(options.fpsArg) === null) {
    return `Error: --fps for mp4 must be ${CLI_FRAME_RATE_HELP}\n`;
  }
  if (
    options.bitrate !== undefined &&
    (!Number.isSafeInteger(options.bitrate) ||
      options.bitrate <= 0 ||
      options.bitrate > MAX_MP4_BITRATE)
  ) {
    return `Error: --bitrate must be a whole number of bits per second between 1 and ${MAX_MP4_BITRATE}\n`;
  }
  const frameRate = resolveMp4FrameRate(options);
  // Counted arithmetically rather than by building the schedule: a duration far
  // past the ceiling would fail on array allocation before this check ran.
  const frameCount = mp4FrameCount(frameRate, options.durationMs);
  if (frameCount > MAX_MP4_FRAMES) {
    return `Error: --duration-ms and --fps ask for ${frameCount} frames; the limit is ${MAX_MP4_FRAMES}\n`;
  }
  return null;
}

/** Frame rate for an MP4 export; 30 when the caller does not pin one. */
function resolveMp4FrameRate(options: ExportOptions): CliFrameRate {
  const parsed = options.fpsArg === undefined ? null : parseCliFrameRate(options.fpsArg);
  return parsed ?? { numerator: MP4_FRAME_RATE_DEFAULT, denominator: 1 };
}

/**
 * Encode an MP4 by piping sampled PNG frames through an external ffmpeg.
 *
 * No codec ships with boundsvg, so the encoder is the user's own ffmpeg. Frame
 * sampling stays deterministic; the encoded bytes are not part of that contract.
 */
async function writeExportMp4(
  io: CliIo,
  options: ExportOptions,
  { outputPath, engine, input }: { outputPath: string; engine: Engine; input: VNode },
): Promise<number> {
  const command = resolveFfmpegCommand();
  if (!probeFfmpeg(command)) {
    io.writeStderr(ffmpegNotFoundMessage(command));
    return 1;
  }

  const frameRate = resolveMp4FrameRate(options);
  const timesMs = buildMp4Schedule(frameRate, options.durationMs ?? 0);

  // ffmpeg writes its own output, and `-y` creates it before it knows whether
  // it can finish. Encoding to a scratch file keeps a failed run from touching
  // the destination at all — including an earlier export that is still good —
  // and lets the finished bytes go out through CliIo like every other format.
  const scratchDir = mkdtempSync(join(tmpdir(), "boundsvg-mp4-"));
  const scratchPath = join(scratchDir, "out.mp4");

  try {
    let result: Mp4EncodeResult;
    try {
      result = await encodeMp4WithFfmpeg({
        command,
        args: buildFfmpegArgs({ frameRate, bitrate: options.bitrate, outputPath: scratchPath }),
        frames: sampleMp4Frames(engine, input, {
          timesMs,
          scale: options.scale,
          textPathMode: options.textPathMode,
          debug: options.debug,
          onWarning: createRenderWarningReporter(io),
        }),
      });
    } catch (err) {
      io.writeStderr(`Error: ${formatError(err)}\n`);
      return 1;
    }

    if (!result.ok) {
      io.writeStderr(`Error: ffmpeg failed: ${result.message}\n`);
      return 1;
    }

    let encoded: Uint8Array;
    try {
      // Buffer is already a Uint8Array; copying it would hold the whole encode
      // twice, which at the frame ceiling is not a rounding error.
      encoded = readFileSync(scratchPath);
    } catch {
      io.writeStderr("Error: ffmpeg failed: it exited successfully without writing a file\n");
      return 1;
    }

    if (options.dryRun) {
      reportDryRunBinary(io, outputPath, encoded);
      return 0;
    }

    // Every throw from here has to be caught: watch mode calls this writer
    // fire-and-forget, so an escaping rejection takes the watcher down.
    try {
      io.ensureDir(dirname(outputPath));
      io.writeBinaryFile(outputPath, encoded);
    } catch {
      io.writeStderr(`Error: Cannot write file "${outputPath}"\n`);
      return 1;
    }
    io.writeStdout(`Exported: ${outputPath}\n`);
    return 0;
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/** Reject the animation flags on a format that has no timeline to apply them to. */
function rejectAnimationFlagsOnStillFormat(options: ExportOptions): string | null {
  for (const [flag, value] of [
    ["--duration-ms", options.durationMs],
    // fpsArg rather than fps: a rational spelling parses to no number, and a
    // flag that was given still has to be rejected here.
    ["--fps", options.fpsArg],
    ["--iterations", options.iterations],
    ["--bitrate", options.bitrate],
  ] as const) {
    if (value !== undefined) {
      return `Error: ${flag} only applies to an animated --format\n`;
    }
  }
  return null;
}

/**
 * Validate the animated-format flags before WASM initialization, so a bad
 * value is a usage error rather than a render-stage failure.
 */
function validateAnimationFlags(options: ExportOptions): string | null {
  if (options.format === "mp4") {
    return validateMp4Flags(options);
  }
  if (options.format !== "animated-webp" && options.format !== "gif") {
    return rejectAnimationFlagsOnStillFormat(options);
  }

  if (options.durationMs === undefined) {
    return `Error: --duration-ms is required for ${options.format} export\n`;
  }
  if (options.durationMs <= 0) {
    return "Error: --duration-ms must be greater than zero\n";
  }
  if (options.fpsArg !== undefined && options.fps === undefined) {
    return `Error: --fps for ${options.format} must be a number between ${MIN_ANIMATION_FPS} and ${MAX_ANIMATION_FPS}\n`;
  }
  if (
    options.fps !== undefined &&
    (options.fps < MIN_ANIMATION_FPS || options.fps > MAX_ANIMATION_FPS)
  ) {
    return `Error: --fps must be between ${MIN_ANIMATION_FPS} and ${MAX_ANIMATION_FPS}\n`;
  }
  if (options.bitrate !== undefined) {
    // gif and animated-webp have no bitrate control; accepting the flag and
    // ignoring it would look like it took effect.
    return `Error: --bitrate does not apply to ${options.format} export\n`;
  }
  const maxIterations =
    options.format === "animated-webp" ? MAX_ANIMATED_WEBP_ITERATIONS : MAX_GIF_ITERATIONS;
  if (
    options.iterations !== undefined &&
    options.iterations !== "infinite" &&
    (!Number.isSafeInteger(options.iterations) ||
      options.iterations < 1 ||
      options.iterations > maxIterations)
  ) {
    return `Error: --iterations for ${options.format} must be "infinite" or a whole number between 1 and ${maxIterations}\n`;
  }
  const frameCount = Math.max(2, Math.ceil((options.durationMs * (options.fps ?? 20)) / 1000));
  if (frameCount > MAX_ANIMATION_FRAMES) {
    return `Error: --duration-ms and --fps ask for ${frameCount} frames; the limit is ${MAX_ANIMATION_FRAMES}\n`;
  }
  return null;
}

/**
 * Validate flag combinations that are mutually exclusive.
 * Returns an error message or null if valid.
 */
function validateExportFlags(options: ExportOptions, expandedInputs: string[]): string | null {
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
  if (
    !Number.isInteger(options.scale) ||
    options.scale < PNG_SCALE_MIN ||
    options.scale > PNG_SCALE_MAX
  ) {
    return `Error: --scale must be a whole number between ${PNG_SCALE_MIN} and ${PNG_SCALE_MAX}\n`;
  }
  const animationFlagError = validateAnimationFlags(options);
  if (animationFlagError) {
    return animationFlagError;
  }
  if (options.format === "layered-svg" && options.outputTarget === "stdout") {
    return "Error: layered-svg export does not support stdout output\n";
  }
  if (options.format === "layered-png" && options.outputTarget === "stdout") {
    return "Error: layered-png export does not support stdout output\n";
  }
  if (options.format === "mp4" && options.outputTarget === "stdout") {
    // ffmpeg writes the container itself and needs a seekable destination for
    // the faststart pass; a pipe cannot provide one.
    return "Error: mp4 export does not support stdout output\n";
  }
  return null;
}

async function runExportSingle(
  io: CliIo,
  options: ExportOptions,
  { expandedInputs, engine }: { expandedInputs: string[]; engine: Engine },
): Promise<number> {
  if (expandedInputs.length === 1) {
    const firstInput = expandedInputs[0];
    if (firstInput !== undefined) {
      options.input = firstInput;
    }
  }

  if (options.watch) {
    const inputPath = resolve(options.input);
    return await watchAndRun(io, [inputPath], {
      runOnce: (changedPath) => {
        // exportSingleFile is async but watchAndRun callback is sync.
        // We fire-and-forget; errors are reported inside exportSingleFile.
        void exportSingleFile(io, { ...options, input: changedPath }, engine);
      },
      debounceMs: 150,
    });
  }

  return await exportSingleFile(io, options, engine);
}

async function runExportBatchWatch(
  io: CliIo,
  options: ExportOptions,
  {
    expandedInputs,
    outputDir,
    engine,
  }: { expandedInputs: string[]; outputDir: string | null; engine: Engine },
): Promise<number> {
  const resolvedPaths = expandedInputs.map((inputPath) => resolve(inputPath));
  const extension = deriveExportExtension(options.format);
  return await watchAndRun(io, resolvedPaths, {
    runOnce: (changedPath) => {
      void exportSingleFile(
        io,
        {
          ...options,
          input: changedPath,
          output: deriveBatchOutputPath(changedPath, outputDir, extension),
          report: options.report
            ? `${deriveBatchOutputPath(changedPath, outputDir, extension)}.report.json`
            : "",
          componentName: deriveComponentName(changedPath),
        },
        engine,
      );
    },
    debounceMs: 150,
  });
}

/**
 * Run the `export` subcommand.
 * `args` should already have `node`, script path, and `export` stripped.
 */
export async function runExport(io: CliIo, args: string[]): Promise<number> {
  const requestedHelp = args.includes("--help") || args.includes("-h");

  // Auto-detect stdin: no input specified + piped stdin
  let effectiveArgs = args;
  if (!hasInputInArgs(args) && !io.stdinIsTTY && !requestedHelp) {
    effectiveArgs = ["-i", "-", ...args];
  }

  const parsed = parseExportArgs(effectiveArgs, io.writeStderr);
  if (!parsed) {
    return requestedHelp ? 0 : 1;
  }

  const { options, allInputs } = parsed;

  // Expand globs (skip for stdin)
  const expandedInputs = options.inputSource === "stdin" ? [] : expandInputs(allInputs);

  // Validate flag combinations
  const validationError = validateExportFlags(options, expandedInputs);
  if (validationError) {
    io.writeStderr(validationError);
    return 1;
  }

  // Initialize engine
  const engine = await initEngine(io, options);
  if (!engine) {
    return 1;
  }

  try {
    // --- stdin mode ---
    if (options.inputSource === "stdin") {
      return await exportSingleFile(io, options, engine);
    }

    // --- single file mode ---
    if (expandedInputs.length <= 1) {
      return await runExportSingle(io, options, { expandedInputs, engine });
    }

    // --- batch mode ---
    const outputDir = options.output && options.outputTarget === "file" ? options.output : null;

    if (options.watch) {
      return await runExportBatchWatch(io, options, { expandedInputs, outputDir, engine });
    }

    return await runExportBatch(io, {
      inputs: expandedInputs,
      outputDir,
      baseOptions: options,
      engine,
    });
  } finally {
    engine.dispose();
  }
}
