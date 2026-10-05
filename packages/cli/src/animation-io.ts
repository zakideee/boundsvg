import {
  type AnimatedRasterSink,
  type AnimatedWebpSink,
  createAnimatedWebpSpoolSink,
} from "@boundsvg/core";
import { createAnimatedRasterFileSink, createAnimatedRasterSpool } from "./animation-file.js";
import { createAnimatedRasterStdoutSink } from "./animation-stdout.js";
import type { AnimatedRasterCliTarget } from "./types.js";

/** Encode dry-run output without collecting or writing container bytes. */
function createDiscardSink(): AnimatedWebpSink {
  return {
    write: () => undefined,
    patch: () => undefined,
    finish: () => undefined,
    abort: () => undefined,
  };
}

/** Open a patchable animated WebP destination. */
export function openAnimatedRasterSink(
  target: AnimatedRasterCliTarget,
  format: "webp",
): Promise<AnimatedWebpSink>;
/** Open a sequential animated GIF destination. */
export function openAnimatedRasterSink(
  target: AnimatedRasterCliTarget,
  format: "gif",
): Promise<AnimatedRasterSink>;
/** Choose file replacement, shared stdout forwarding, or length-only dry-run output. */
export async function openAnimatedRasterSink(
  target: AnimatedRasterCliTarget,
  format: "webp" | "gif",
): Promise<AnimatedRasterSink> {
  if (target.kind === "discard") {
    return createDiscardSink();
  }
  if (target.kind === "file") {
    return createAnimatedRasterFileSink(target.path);
  }
  if (format === "gif") {
    return createAnimatedRasterStdoutSink(process.stdout, "gif");
  }
  const spool = await createAnimatedRasterSpool();
  try {
    return createAnimatedWebpSpoolSink(
      spool,
      createAnimatedRasterStdoutSink(process.stdout, "webp"),
    );
  } catch (error) {
    try {
      await spool.dispose();
    } catch {
      // Preserve the construction failure.
    }
    throw error;
  }
}
