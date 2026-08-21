import { describe, expect, it } from "vitest";
import { ffmpegNotFoundMessage, resolveFfmpegCommand } from "../src/ffmpeg-locator.js";
import { CLI_FRAME_RATE_HELP, parseCliFrameRate } from "../src/frame-rate.js";
import { buildFfmpegArgs, buildMp4Schedule, encodeMp4WithFfmpeg } from "../src/mp4-export.js";

/**
 * Frames large enough to exceed the pipe's high-water mark.
 *
 * Below it every write is buffered and returns true, so the drain path — where
 * a dead child raises EPIPE — is never reached. A previous fix looked correct
 * against small frames for exactly this reason.
 */
function largeFrames(count: number): Array<{ data: Uint8Array }> {
  return Array.from({ length: count }, () => ({ data: new Uint8Array(200_000) }));
}

describe("encodeMp4WithFfmpeg failure reporting", () => {
  it("reports what the encoder said, not the EPIPE its death caused", async () => {
    // A child that exits before reading turns the next drain wait into EPIPE.
    // The reason it exited is in its stderr, and that is what the user needs.
    const result = await encodeMp4WithFfmpeg({
      command: "sh",
      args: ["-c", "echo 'Unknown encoder libx264' >&2; exit 3"],
      frames: largeFrames(20),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Unknown encoder libx264");
      expect(result.message).not.toContain("EPIPE");
    }
  });

  it("falls back to the exit code when the encoder said nothing", async () => {
    const result = await encodeMp4WithFfmpeg({
      command: "sh",
      args: ["-c", "exit 7"],
      frames: largeFrames(20),
    });

    expect(result).toEqual({ ok: false, message: "ffmpeg exited with code 7" });
  });

  it("reports a command that cannot be started", async () => {
    const result = await encodeMp4WithFfmpeg({
      command: "/nonexistent/ffmpeg",
      args: [],
      frames: largeFrames(2),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("could not run /nonexistent/ffmpeg");
    }
  });

  it("refuses a run that exited cleanly without taking every frame", async () => {
    // A truncated read that still exits 0 would otherwise produce a clip
    // shorter than the animation and report success.
    const result = await encodeMp4WithFfmpeg({
      command: "sh",
      args: ["-c", "exit 0"],
      frames: largeFrames(20),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("stopped reading after");
    }
  });

  it("surfaces a frame source that throws mid-stream", async () => {
    function* failing(): Generator<{ data: Uint8Array }> {
      yield { data: new Uint8Array(10) };
      throw new Error("rasterization failed");
    }

    const result = await encodeMp4WithFfmpeg({
      command: "sh",
      args: ["-c", "cat > /dev/null"],
      frames: failing(),
    });

    expect(result).toEqual({ ok: false, message: "rasterization failed" });
  });
});

describe("parseCliFrameRate", () => {
  it.each([
    ["30", { numerator: 30, denominator: 1 }],
    ["1", { numerator: 1, denominator: 1 }],
    ["120", { numerator: 120, denominator: 1 }],
    ["29.97", { numerator: 30000, denominator: 1001 }],
    ["23.976", { numerator: 24000, denominator: 1001 }],
    ["59.94", { numerator: 60000, denominator: 1001 }],
    ["30000/1001", { numerator: 30000, denominator: 1001 }],
    ["  60  ", { numerator: 60, denominator: 1 }],
  ])("accepts %s", (value, expected) => {
    expect(parseCliFrameRate(value)).toEqual(expected);
  });

  it.each([
    "0",
    "-30",
    "abc",
    "",
    "  ",
    // Not an NTSC alias, and no rational spells it — approximating would drift.
    "29.5",
    "45.5",
    // Above the ceiling, in both spellings.
    "121",
    "121/1",
    // Malformed rationals.
    "30/0",
    "30/",
    "/1001",
    "30/1001/2",
    "30.5/2",
  ])("refuses %s", (value) => {
    expect(parseCliFrameRate(value)).toBeNull();
  });

  it("names every accepted spelling in the help text", () => {
    // The usage message is the only place a caller learns what is accepted, so
    // a spelling missing from it is as good as unsupported.
    expect(CLI_FRAME_RATE_HELP).toContain("29.97");
    expect(CLI_FRAME_RATE_HELP).toContain("30000/1001");
  });
});

describe("buildMp4Schedule", () => {
  it("derives whole-millisecond times for an integer rate", () => {
    expect(buildMp4Schedule({ numerator: 30, denominator: 1 }, 100)).toEqual([
      0,
      1000 / 30,
      2000 / 30,
    ]);
  });

  it("never schedules fewer than two frames", () => {
    // A single-frame MP4 has no duration to play.
    expect(buildMp4Schedule({ numerator: 30, denominator: 1 }, 1)).toHaveLength(2);
  });

  it("does not drift at 30000/1001", () => {
    // Each time is derived from its own index; accumulating a fixed step would
    // accrue error across a long clip.
    const rate = { numerator: 30000, denominator: 1001 };
    const times = buildMp4Schedule(rate, 60_000);
    const last = times.length - 1;
    expect(times[last]).toBeCloseTo((last * 1000 * 1001) / 30000, 9);
  });
});

describe("buildFfmpegArgs", () => {
  const outputPath = "/tmp/out.mp4";

  it("pins the invocation for a quality-mode export", () => {
    // These flags are the contract with an external binary: a silent change to
    // any of them changes the output with nothing to notice it.
    expect(
      buildFfmpegArgs({
        frameRate: { numerator: 30, denominator: 1 },
        bitrate: undefined,
        outputPath,
      }),
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      "30/1",
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=white",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ]);
  });

  it("passes a rational rate to ffmpeg rather than a decimal", () => {
    const args = buildFfmpegArgs({
      frameRate: { numerator: 30000, denominator: 1001 },
      bitrate: undefined,
      outputPath,
    });
    expect(args[args.indexOf("-framerate") + 1]).toBe("30000/1001");
  });

  it("swaps the quality target for a bitrate when one is given", () => {
    const args = buildFfmpegArgs({
      frameRate: { numerator: 30, denominator: 1 },
      bitrate: 2_000_000,
      outputPath,
    });
    expect(args).toContain("-b:v");
    expect(args[args.indexOf("-b:v") + 1]).toBe("2000000");
    expect(args).not.toContain("-crf");
  });

  it("always asks for faststart", () => {
    // A non-faststart file has to be fully downloaded before it starts playing.
    const args = buildFfmpegArgs({
      frameRate: { numerator: 30, denominator: 1 },
      bitrate: undefined,
      outputPath,
    });
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
  });
});

describe("ffmpeg location", () => {
  it("prefers FFMPEG_PATH over the bare command name", () => {
    expect(resolveFfmpegCommand({ FFMPEG_PATH: "/opt/ffmpeg/bin/ffmpeg" })).toBe(
      "/opt/ffmpeg/bin/ffmpeg",
    );
  });

  it.each([
    {},
    { FFMPEG_PATH: "" },
    { FFMPEG_PATH: "   " },
  ])("falls back to PATH resolution for %j", (env) => {
    expect(resolveFfmpegCommand(env)).toBe("ffmpeg");
  });

  it("tells the caller how to install ffmpeg on each platform", () => {
    // Nothing is bundled or downloaded, so the guidance is the whole recovery
    // path for a user who has no ffmpeg.
    const message = ffmpegNotFoundMessage("ffmpeg");
    expect(message).toContain("brew install ffmpeg");
    expect(message).toContain("sudo apt install ffmpeg");
    expect(message).toContain("winget install Gyan.FFmpeg");
    expect(message).toContain("FFMPEG_PATH");
  });

  it("names the command it actually tried", () => {
    expect(ffmpegNotFoundMessage("/opt/missing/ffmpeg")).toContain("/opt/missing/ffmpeg");
  });
});
