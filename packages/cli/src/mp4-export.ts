import { spawn } from "node:child_process";
import type { Engine, RecoverableError, VNode } from "@boundsvg/core";
import type { CliFrameRate } from "./frame-rate.js";

/** Longest MP4 export accepted, in frames. */
export const MAX_MP4_FRAMES = 3600;

/** Shortest MP4 export accepted; a single frame has no duration to play. */
const MIN_MP4_FRAMES = 2;

const MILLIS_PER_SECOND = 1000;

/** Colour painted behind every frame; H.264 carries no alpha channel. */
const MP4_BACKGROUND = "#ffffff";

/** Constant-rate-factor used when the caller does not pin a bitrate. */
const DEFAULT_CRF = "18";

type FfmpegArgsOptions = {
  frameRate: CliFrameRate;
  bitrate: number | undefined;
  outputPath: string;
};

/**
 * The ffmpeg invocation for a PNG-sequence-to-MP4 export.
 *
 * Kept pure and exported so a test can pin the argument list without running
 * ffmpeg: the flags are the contract with an external binary, and a silent
 * change to them is a change to the output nobody would notice.
 */
export function buildFfmpegArgs({ frameRate, bitrate, outputPath }: FfmpegArgsOptions): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    // Rational rather than decimal, so 30000/1001 stays exact.
    "-framerate",
    `${frameRate.numerator}/${frameRate.denominator}`,
    "-i",
    "-",
    "-c:v",
    "libx264",
    ...(bitrate === undefined ? ["-crf", DEFAULT_CRF] : ["-b:v", String(bitrate)]),
    // H.264 in yuv420 needs even dimensions and has no alpha; padding right and
    // bottom keeps the frame at the top left where it was rendered.
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=white",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];
}

/**
 * Frames an export of this length will sample.
 *
 * Separate from building the schedule so a duration far past the ceiling is a
 * usage error rather than a failed array allocation.
 */
export function mp4FrameCount(frameRate: CliFrameRate, durationMs: number): number {
  const framesPerSecond = frameRate.numerator / frameRate.denominator;
  return Math.max(MIN_MP4_FRAMES, Math.ceil((durationMs / MILLIS_PER_SECOND) * framesPerSecond));
}

/**
 * Sample times for an MP4 export, derived the same way the browser exporter
 * derives them.
 *
 * The rate is rational, so each time is computed from its own index rather than
 * accumulated — adding a fixed step would drift at 30000/1001.
 */
export function buildMp4Schedule(frameRate: CliFrameRate, durationMs: number): number[] {
  const frameCount = mp4FrameCount(frameRate, durationMs);
  return Array.from(
    { length: frameCount },
    (_unused, index) => (index * MILLIS_PER_SECOND * frameRate.denominator) / frameRate.numerator,
  );
}

type Mp4EncodeOptions = {
  command: string;
  args: string[];
  frames: Iterable<{ data: Uint8Array }>;
};

export type Mp4EncodeResult = { ok: true } | { ok: false; message: string };

/** Exit and stderr of a finished ffmpeg run, however it finished. */
type FfmpegOutcome = {
  code: number | null;
  stderr: string;
  /** Set when the process could not be started or died before it could report. */
  failure?: Error;
};

/**
 * Pipe a PNG frame sequence through ffmpeg into an MP4 file.
 *
 * Frames are written one at a time and the writer waits for `drain`, so a long
 * export does not buffer the whole clip in memory ahead of the encoder.
 */
export async function encodeMp4WithFfmpeg({
  command,
  args,
  frames,
}: Mp4EncodeOptions): Promise<Mp4EncodeResult> {
  const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });

  let stderrText = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrText += chunk;
  });

  // Writing to a dead child raises on the stream rather than throwing, and the
  // reason it died is in its stderr, not in the EPIPE.
  child.stdin.on("error", () => {});

  // `close` fires after the stdio streams have flushed, so stderr is complete by
  // the time it resolves. `error` covers a process that never started at all.
  const finished = new Promise<FfmpegOutcome>((resolveOutcome) => {
    child.once("error", (failure: Error) => {
      resolveOutcome({ code: null, stderr: stderrText, failure });
    });
    child.once("close", (code) => {
      resolveOutcome({ code, stderr: stderrText });
    });
  });

  /**
   * Wait for the pipe to drain, or for the child to be gone.
   *
   * Deliberately not `events.once`: that installs its own error listener and
   * rejects on EPIPE, which would turn "ffmpeg died and said why" into a bare
   * write error and discard the reason. Resolves either way; the caller decides
   * what a false means.
   */
  const waitForDrain = (): Promise<boolean> =>
    new Promise((resolveDrain) => {
      const onDrain = (): void => {
        cleanup();
        resolveDrain(true);
      };
      const onGone = (): void => {
        cleanup();
        resolveDrain(false);
      };
      const cleanup = (): void => {
        child.stdin.off("drain", onDrain);
        child.stdin.off("close", onGone);
        child.stdin.off("error", onGone);
      };
      child.stdin.once("drain", onDrain);
      child.stdin.once("close", onGone);
      child.stdin.once("error", onGone);
      void finished.then(onGone);
    });

  let samplingError: unknown;
  let written = 0;
  // Set when the loop stops because the child is gone rather than because the
  // frames ran out. Counting written frames cannot detect this: the frame that
  // triggers the break has already been counted.
  let abandoned = false;
  try {
    for (const frame of frames) {
      if (child.stdin.destroyed || child.stdin.writableEnded) {
        abandoned = true;
        break;
      }
      const flushed = child.stdin.write(frame.data);
      written += 1;
      if (!flushed && !(await waitForDrain())) {
        abandoned = true;
        break;
      }
    }
    child.stdin.end();
  } catch (error) {
    // The frame generator threw — sampling or rasterization failed, not ffmpeg.
    samplingError = error;
    child.stdin.destroy();
    child.kill();
  }

  const outcome = await finished;
  if (samplingError !== undefined) {
    return { ok: false, message: describe(samplingError) };
  }
  if (outcome.code !== 0) {
    return { ok: false, message: describeOutcome(command, outcome) };
  }
  if (abandoned) {
    // ffmpeg stopped reading but still exited cleanly; the file it wrote is
    // shorter than the animation and would silently play as a truncated clip.
    // Its stderr usually says why, and is more useful than the frame count.
    const detail = outcome.stderr.trim();
    const frames = written === 1 ? "1 frame" : `${written} frames`;
    return {
      ok: false,
      message:
        detail === ""
          ? `ffmpeg stopped reading after ${frames}`
          : `ffmpeg stopped reading after ${frames}: ${detail}`,
    };
  }
  return { ok: true };
}

/**
 * Explain a failed run from what ffmpeg itself reported.
 *
 * Its stderr names the real cause — an unwritable output path, a build with no
 * libx264 — where the write-side symptom is only ever "EPIPE".
 */
function describeOutcome(command: string, outcome: FfmpegOutcome): string {
  const detail = outcome.stderr.trim();
  if (detail !== "") {
    return detail;
  }
  if (outcome.failure) {
    return `could not run ${command}: ${outcome.failure.message}`;
  }
  return `ffmpeg exited with code ${String(outcome.code)}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Frames for an MP4 export, sampled through the deterministic frame sampler.
 *
 * A generator rather than the sampler's own iterable so the PNG payload is
 * narrowed here, at the one place that knows the request asked for PNG.
 */
export function* sampleMp4Frames(
  engine: Engine,
  input: VNode,
  options: {
    timesMs: number[];
    scale: number;
    textPathMode: "merged" | "glyphs";
    debug: boolean;
    onWarning: (warning: RecoverableError) => void;
  },
): Generator<{ data: Uint8Array }> {
  const frames = engine.renderFrames(input, {
    timesMs: options.timesMs,
    format: "png",
    scale: options.scale,
    textPathMode: options.textPathMode,
    debug: options.debug,
    onWarning: options.onWarning,
    // H.264 has no alpha, and an unpainted scene would reach yuv420p as black
    // while the even-size padding stays white. Opaque white matches the browser
    // exporter's default and the colour the pad filter uses.
    rasterBackground: MP4_BACKGROUND,
  });
  for (const frame of frames) {
    if (frame.format !== "png") {
      throw new Error(`MP4 export needs PNG frames but received a ${frame.format} frame`);
    }
    yield { data: frame.data };
  }
}
