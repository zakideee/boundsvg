import {
  type AnimatedRasterCollector,
  type AnimatedRasterWriteResult,
  createAnimatedRasterCollector,
} from "../../src/animation-output.js";
import type {
  AnimatedRasterSessionHandle,
  AnimationSessionOpenInput,
} from "../../src/wasm/animation-session.js";

/** Exercise the required sink contract with the explicit memory destination used by byte fixtures. */
export async function collectAnimatedRaster(
  write: (sink: AnimatedRasterCollector) => Promise<AnimatedRasterWriteResult>,
): Promise<Uint8Array> {
  const collector = createAnimatedRasterCollector();
  try {
    await write(collector);
    return collector.takeBytes();
  } catch (error) {
    collector.abort(error);
    throw error;
  }
}

/** Test observation retained by the caller, never a bulk production transport payload. */
export type CapturedRasterSession = AnimationSessionOpenInput & {
  frames: Array<{ svg: string; durationMs: number }>;
};

/** Observe single-frame pushes while preserving the authentic session's method receiver. */
export function captureRasterSession(
  open: (input: AnimationSessionOpenInput) => AnimatedRasterSessionHandle,
  observations: CapturedRasterSession[],
): (input: AnimationSessionOpenInput) => AnimatedRasterSessionHandle {
  return (input) => {
    const observation: CapturedRasterSession = { ...input, frames: [] };
    observations.push(observation);
    const session = open(input);
    return {
      push(scene, timeMs, durationMs) {
        // This independent test observation exercises the shared emitter; production transports no SVG.
        observation.frames.push({
          svg: scene.renderToSvg(JSON.stringify({ ...input.renderOptions, timeMs })),
          durationMs,
        });
        session.push(scene, timeMs, durationMs);
      },
      readChunk: () => session.readChunk(),
      finish: () => session.finish(),
      abort: () => session.abort(),
      dispose: () => session.dispose(),
    };
  };
}

/** Minimal session for tests of scheduling/emitted SVG ownership rather than codec output. */
export function createMockRasterSession(
  input: AnimationSessionOpenInput,
): AnimatedRasterSessionHandle {
  let pending: Uint8Array | null = null;
  let frameCount = 0;
  let bytesWritten = 0;
  return {
    push() {
      frameCount += 1;
      pending = new Uint8Array(input.format === "webp" ? 12 : 3);
      bytesWritten += pending.length;
    },
    readChunk() {
      const chunk = pending;
      pending = null;
      return chunk;
    },
    finish: () => ({
      format: input.format,
      frameCount,
      bytesWritten,
      ...(input.format === "webp"
        ? { patch: { offset: 4 as const, bytes: Uint8Array.of(bytesWritten - 8, 0, 0, 0) } }
        : {}),
    }),
    abort() {
      pending = null;
    },
    dispose() {
      pending = null;
    },
  };
}
