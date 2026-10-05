import type {
  AnimatedRasterSink,
  AnimatedWebpSink,
  Engine,
  RecoverableError,
  VNode,
} from "@boundsvg/core";
import type { ExportOptions } from "./cli-export.js";
import { reportDryRunAnimatedRaster } from "./dry-run.js";
import type { AnimatedRasterCliTarget, CliIo } from "./types.js";

/** Stream one animated CLI export through its explicit IO destination. */
export async function writeExportAnimatedRaster(
  io: CliIo,
  options: ExportOptions,
  args: {
    outputPath: string;
    engine: Engine;
    input: VNode;
    onWarning: (warning: RecoverableError) => void;
  },
): Promise<number> {
  const format = options.format === "animated-webp" ? "webp" : "gif";
  const target: AnimatedRasterCliTarget = options.dryRun
    ? { kind: "discard" }
    : options.outputTarget === "stdout"
      ? { kind: "stdout" }
      : { kind: "file", path: args.outputPath };
  const renderOptions = {
    scale: options.scale,
    debug: options.debug,
    textPathMode: options.textPathMode,
    onWarning: args.onWarning,
    durationMs: options.durationMs ?? 0,
    iterations: options.iterations ?? "infinite",
    ...(options.fps === undefined ? {} : { fps: options.fps }),
  };
  let sink: AnimatedRasterSink | undefined;
  let isCommitted = false;
  let primary: unknown;
  try {
    if (format === "webp") {
      const destination = await io.openAnimatedRasterSink(target, "webp");
      let isAborted = false;
      const adopted: AnimatedWebpSink = {
        write: (chunk) => destination.write(chunk),
        patch: (offset, chunk) => destination.patch(offset, chunk),
        finish: () => destination.finish(),
        abort: (reason) => {
          if (!isAborted) {
            isAborted = true;
            return destination.abort(reason);
          }
        },
      };
      sink = adopted;
      const result = await args.engine.renderToAnimatedWebp(args.input, renderOptions, adopted);
      isCommitted = true;
      if (options.dryRun) {
        reportDryRunAnimatedRaster(io, args.outputPath, result.bytesWritten);
      }
    } else {
      const destination = await io.openAnimatedRasterSink(target, "gif");
      let isAborted = false;
      const adopted: AnimatedRasterSink = {
        write: (chunk) => destination.write(chunk),
        finish: () => destination.finish(),
        abort: (reason) => {
          if (!isAborted) {
            isAborted = true;
            return destination.abort(reason);
          }
        },
      };
      sink = adopted;
      const result = await args.engine.renderToAnimatedGif(args.input, renderOptions, adopted);
      isCommitted = true;
      if (options.dryRun) {
        reportDryRunAnimatedRaster(io, args.outputPath, result.bytesWritten);
      }
    }
    if (!options.dryRun && options.outputTarget !== "stdout") {
      io.writeStdout(`Exported: ${args.outputPath}\n`);
    }
    return 0;
  } catch (error) {
    primary = error;
    io.writeStderr(
      `Error: ${options.format} rendering failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    // Entry authentication can fail before Core adopts this fresh IO sink.
    if (!isCommitted) {
      try {
        await sink?.abort(primary);
      } catch {
        // Keep the export failure.
      }
    }
  }
}
